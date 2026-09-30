use once_cell::sync::OnceCell;
use serde::Serialize;
use std::sync::Mutex;
#[cfg(target_os = "macos")]
use std::time::{Duration, Instant};
#[cfg(not(target_os = "macos"))]
use tauri::WindowEvent;
use tauri::{
    AppHandle, Emitter, Manager, Monitor, PhysicalPosition, PhysicalSize, WebviewUrl,
    WebviewWindow, WebviewWindowBuilder,
};

use crate::config_store;
use crate::models::AppConfig;

const SIDEBAR_LABEL: &str = "sidebar";
const DEFAULT_THICKNESS_LOGICAL: f64 = 320.0;
pub const DEFAULT_REVEAL_SENSITIVITY: u8 = 4;
pub const DEFAULT_HIDE_SENSITIVITY: u8 = 8;
#[cfg(target_os = "macos")]
const MAC_HOVER_POLL: Duration = Duration::from_millis(75);
#[cfg(target_os = "macos")]
const MAC_SHOW_GRACE: Duration = Duration::from_millis(850);

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct SidebarDockState {
    pub edge: String,
    pub pinned: bool,
    pub expanded: bool,
    pub dragging: bool,
    pub preview_edge: Option<String>,
}

struct DockRuntime {
    state: SidebarDockState,
    thickness: f64,
    length: Option<f64>,
    monitor_anchor: Option<(i32, i32)>,
    #[cfg(target_os = "macos")]
    reveal_sensitivity: u8,
    #[cfg(target_os = "macos")]
    hide_sensitivity: u8,
    #[cfg(target_os = "macos")]
    hover: MacHoverState,
}

#[cfg(target_os = "macos")]
#[derive(Default)]
struct MacHoverState {
    reveal_started: Option<Instant>,
    leave_started: Option<Instant>,
    grace_until: Option<Instant>,
    cooldown_until: Option<Instant>,
    awaiting_pointer_entry: bool,
    suppress_until_edge_leave: bool,
}

impl DockRuntime {
    fn from_config(config: &AppConfig) -> Self {
        Self {
            state: SidebarDockState {
                edge: parse_edge(config.sidebar_edge.as_deref()).into(),
                pinned: config.sidebar_pinned.unwrap_or(false),
                expanded: config.sidebar_pinned.unwrap_or(false),
                dragging: false,
                preview_edge: None,
            },
            thickness: config.sidebar_width.unwrap_or(DEFAULT_THICKNESS_LOGICAL),
            length: config.sidebar_length,
            monitor_anchor: config.sidebar_monitor_x.zip(config.sidebar_monitor_y),
            #[cfg(target_os = "macos")]
            reveal_sensitivity: config
                .sidebar_reveal_sensitivity
                .unwrap_or(DEFAULT_REVEAL_SENSITIVITY)
                .clamp(1, 10),
            #[cfg(target_os = "macos")]
            hide_sensitivity: config
                .sidebar_hide_sensitivity
                .unwrap_or(DEFAULT_HIDE_SENSITIVITY)
                .clamp(1, 10),
            #[cfg(target_os = "macos")]
            hover: MacHoverState::default(),
        }
    }
}

static DOCK_RUNTIME: OnceCell<Mutex<DockRuntime>> = OnceCell::new();

fn parse_edge(value: Option<&str>) -> &'static str {
    match value {
        Some("left") => "left",
        Some("top") => "top",
        Some("bottom") => "bottom",
        _ => "right",
    }
}

fn lock_runtime() -> Result<std::sync::MutexGuard<'static, DockRuntime>, String> {
    DOCK_RUNTIME
        .get()
        .ok_or_else(|| "Sidebar dock controller is unavailable".to_string())?
        .lock()
        .map_err(|_| "Sidebar dock controller lock is poisoned".to_string())
}

#[cfg(target_os = "macos")]
fn show_without_focus(window: &WebviewWindow) -> Result<(), String> {
    use objc2_app_kit::NSWindow;

    let window = window.clone();
    let native_window = window.clone();
    window
        .run_on_main_thread(move || {
            let result = (|| -> Result<(), String> {
                let native = native_window
                    .ns_window()
                    .map_err(|error| error.to_string())?;
                if native.is_null() {
                    return Err("macOS sidebar has no native window".to_string());
                }
                let native: &NSWindow = unsafe { &*native.cast() };
                native.orderFront(None);
                Ok(())
            })();
            if let Err(error) = result {
                log::warn!("Failed to show macOS sidebar without focus: {error}");
            }
        })
        .map_err(|error| error.to_string())
}

pub fn ensure_sidebar_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(SIDEBAR_LABEL) {
        return Ok(window);
    }

    WebviewWindowBuilder::new(app, SIDEBAR_LABEL, WebviewUrl::App("index.html".into()))
        .title("Widgitron Sidebar")
        .inner_size(DEFAULT_THICKNESS_LOGICAL, 900.0)
        .decorations(false)
        .resizable(true)
        .maximizable(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .build()
        .map_err(|err| err.to_string())
}

pub fn start(app: AppHandle, config: &AppConfig) -> Result<(), String> {
    if DOCK_RUNTIME.get().is_some() {
        apply_config(&app, config);
        return Ok(());
    }

    let window = ensure_sidebar_window(&app)?;
    crate::ui_scale::apply_to_window(&window, crate::ui_scale::from_config(config))?;
    let runtime = DockRuntime::from_config(config);
    let expanded = runtime.state.expanded;
    DOCK_RUNTIME
        .set(Mutex::new(runtime))
        .map_err(|_| "Sidebar dock controller is already running".to_string())?;

    #[cfg(not(target_os = "macos"))]
    {
        let blur_app = app.clone();
        window.on_window_event(move |event| {
            if matches!(event, WindowEvent::Focused(false)) {
                let should_collapse = lock_runtime()
                    .map(|runtime| runtime.state.expanded && !runtime.state.pinned)
                    .unwrap_or(false);
                if should_collapse {
                    let _ = collapse(&blur_app);
                }
            }
        });
    }

    position_sidebar(&app, &window)?;
    if expanded {
        #[cfg(target_os = "macos")]
        show_without_focus(&window)?;
        #[cfg(not(target_os = "macos"))]
        window.show().map_err(|err| err.to_string())?;
    }
    emit_state(&app);
    #[cfg(target_os = "macos")]
    std::thread::Builder::new()
        .name("widgitron-macos-sidebar-hover".into())
        .spawn(move || run_macos_hover_loop(app, window))
        .map_err(|error| format!("Failed to start macOS sidebar hover controller: {error}"))?;
    Ok(())
}

pub fn apply_config(app: &AppHandle, config: &AppConfig) {
    let Ok(mut runtime) = lock_runtime() else {
        return;
    };
    let expanded = runtime.state.expanded;
    #[cfg(target_os = "macos")]
    let hover = std::mem::take(&mut runtime.hover);
    *runtime = DockRuntime::from_config(config);
    runtime.state.expanded = runtime.state.pinned || expanded;
    #[cfg(target_os = "macos")]
    {
        runtime.hover = hover;
        if runtime.state.pinned {
            runtime.hover.reveal_started = None;
            runtime.hover.leave_started = None;
        }
    }
    let expanded = runtime.state.expanded;
    drop(runtime);

    if let Ok(window) = ensure_sidebar_window(app) {
        if let Err(err) =
            crate::ui_scale::apply_to_window(&window, crate::ui_scale::from_config(config))
        {
            log::warn!("Failed to apply UI scale to sidebar: {err}");
        }
        if let Err(err) = position_sidebar(app, &window) {
            log::warn!("Failed to position sidebar: {err}");
        }
        let visibility_result: Result<(), String> = if expanded {
            #[cfg(target_os = "macos")]
            {
                if window.is_visible().unwrap_or(false) {
                    Ok(())
                } else {
                    show_without_focus(&window)
                }
            }
            #[cfg(not(target_os = "macos"))]
            window.show().map_err(|error| error.to_string())
        } else {
            window.hide().map_err(|error| error.to_string())
        };
        if let Err(err) = visibility_result {
            log::warn!("Failed to update sidebar visibility: {err}");
        }
    }
    emit_state(app);
}

pub fn show(app: &AppHandle, focus: bool) -> Result<(), String> {
    show_with_hover(app, focus, true)
}

fn show_with_hover(
    app: &AppHandle,
    focus: bool,
    wait_for_pointer_entry: bool,
) -> Result<(), String> {
    #[cfg(not(target_os = "macos"))]
    let _ = wait_for_pointer_entry;
    ensure_started(app)?;
    let window = ensure_sidebar_window(app)?;
    position_sidebar(app, &window)?;
    #[cfg(target_os = "macos")]
    if focus {
        window.show().map_err(|err| err.to_string())?;
        window.set_focus().map_err(|err| err.to_string())?;
    } else if !window.is_visible().map_err(|err| err.to_string())? {
        show_without_focus(&window)?;
    }
    #[cfg(not(target_os = "macos"))]
    {
        window.show().map_err(|err| err.to_string())?;
        if focus {
            window.set_focus().map_err(|err| err.to_string())?;
        }
    }
    let mut runtime = lock_runtime()?;
    runtime.state.expanded = true;
    #[cfg(target_os = "macos")]
    {
        runtime.hover.awaiting_pointer_entry = wait_for_pointer_entry && !runtime.state.pinned;
        runtime.hover.grace_until = Some(Instant::now() + MAC_SHOW_GRACE);
        runtime.hover.leave_started = None;
        runtime.hover.reveal_started = None;
    }
    drop(runtime);
    emit_state(app);
    Ok(())
}

pub fn collapse(app: &AppHandle) -> Result<(), String> {
    ensure_started(app)?;
    {
        let mut runtime = lock_runtime()?;
        runtime.state.expanded = false;
        runtime.state.pinned = false;
        #[cfg(target_os = "macos")]
        {
            runtime.hover.awaiting_pointer_entry = false;
            runtime.hover.leave_started = None;
            runtime.hover.reveal_started = None;
            runtime.hover.suppress_until_edge_leave = true;
        }
    }
    if let Some(window) = app.get_webview_window(SIDEBAR_LABEL) {
        window.hide().map_err(|err| err.to_string())?;
    }
    persist_pinned(app);
    emit_state(app);
    Ok(())
}

pub fn set_pinned(app: &AppHandle, pinned: bool, focus: bool) -> Result<SidebarDockState, String> {
    ensure_started(app)?;
    {
        let mut runtime = lock_runtime()?;
        runtime.state.pinned = pinned;
        #[cfg(target_os = "macos")]
        {
            runtime.hover.awaiting_pointer_entry = false;
            runtime.hover.leave_started = None;
            runtime.hover.grace_until = Some(Instant::now() + MAC_SHOW_GRACE);
        }
    }
    if pinned {
        show(app, focus)?;
    } else {
        emit_state(app);
    }
    persist_pinned(app);
    get_state(app)
}

pub fn toggle_pinned(
    app: &AppHandle,
    focus_when_pinning: bool,
) -> Result<SidebarDockState, String> {
    ensure_started(app)?;
    let pinned = !lock_runtime()?.state.pinned;
    set_pinned(app, pinned, focus_when_pinning && pinned)
}

pub fn begin_drag(app: &AppHandle) -> Result<SidebarDockState, String> {
    ensure_started(app)?;
    ensure_sidebar_window(app)?
        .start_dragging()
        .map_err(|err| err.to_string())?;
    get_state(app)
}

pub fn get_state(app: &AppHandle) -> Result<SidebarDockState, String> {
    ensure_started(app)?;
    Ok(lock_runtime()?.state.clone())
}

fn ensure_started(app: &AppHandle) -> Result<(), String> {
    if DOCK_RUNTIME.get().is_none() {
        let config = config_store::read_config::<AppConfig>(app, "app_config.json");
        start(app.clone(), &config)?;
    }
    Ok(())
}

fn emit_state(app: &AppHandle) {
    if let Ok(runtime) = lock_runtime() {
        let state = runtime.state.clone();
        drop(runtime);
        let _ = app.emit("sidebar_state_update", state.clone());
        #[cfg(target_os = "macos")]
        crate::macos_tray::refresh_labels(app, state.expanded);
    }
}

fn persist_pinned(app: &AppHandle) {
    let Ok(runtime) = lock_runtime() else {
        return;
    };
    let pinned = runtime.state.pinned;
    drop(runtime);
    let mut config = config_store::read_config::<AppConfig>(app, "app_config.json");
    config.sidebar_pinned = Some(pinned);
    if let Err(err) = config_store::write_config(app, "app_config.json", &config) {
        log::warn!("Failed to persist sidebar pin state: {err}");
    }
}

#[cfg(target_os = "macos")]
#[derive(Clone, Copy)]
struct MacSidebarBounds {
    left: f64,
    top: f64,
    right: f64,
    bottom: f64,
}

#[cfg(target_os = "macos")]
impl MacSidebarBounds {
    fn from_window(window: &WebviewWindow) -> Option<Self> {
        let position = window.outer_position().ok()?;
        let size = window.outer_size().ok()?;
        Some(Self {
            left: position.x as f64,
            top: position.y as f64,
            right: position.x as f64 + size.width as f64,
            bottom: position.y as f64 + size.height as f64,
        })
    }

    fn contains(self, x: f64, y: f64) -> bool {
        x >= self.left && x < self.right && y >= self.top && y < self.bottom
    }

    fn from_monitor_work_area(monitor: &Monitor) -> Self {
        let area = monitor.work_area();
        Self {
            left: area.position.x as f64,
            top: area.position.y as f64,
            right: area.position.x as f64 + area.size.width as f64,
            bottom: area.position.y as f64 + area.size.height as f64,
        }
    }
}

#[cfg(target_os = "macos")]
fn mac_edge_hovered(
    area: MacSidebarBounds,
    scale: f64,
    edge: &str,
    x: f64,
    y: f64,
    sidebar: MacSidebarBounds,
) -> bool {
    let trigger = (3.0 * scale).max(2.0);
    let guard = 56.0 * scale;

    match edge {
        "left" => {
            x >= area.left
                && x < area.left + trigger
                && y >= sidebar.top.max(area.top + guard)
                && y < sidebar.bottom.min(area.bottom - guard)
        }
        "top" => {
            y >= area.top
                && y < area.top + trigger
                && x >= sidebar.left.max(area.left + guard)
                && x < sidebar.right.min(area.right - guard)
        }
        "bottom" => {
            y >= area.bottom - trigger
                && y < area.bottom
                && x >= sidebar.left.max(area.left + guard)
                && x < sidebar.right.min(area.right - guard)
        }
        _ => {
            x >= area.right - trigger
                && x < area.right
                && y >= sidebar.top.max(area.top + guard)
                && y < sidebar.bottom.min(area.bottom - guard)
        }
    }
}

#[cfg(target_os = "macos")]
fn mac_reveal_timing(level: u8) -> (Duration, Duration) {
    let (dwell, cooldown) = match level.clamp(1, 10) {
        1 => (1200, 1600),
        2 => (900, 1300),
        3 => (700, 1100),
        4 => (500, 900),
        5 => (380, 720),
        6 => (280, 560),
        7 => (200, 420),
        8 => (140, 300),
        9 => (90, 180),
        _ => (50, 100),
    };
    (
        Duration::from_millis(dwell),
        Duration::from_millis(cooldown),
    )
}

#[cfg(target_os = "macos")]
fn mac_hide_delay(level: u8) -> Duration {
    let millis = match level.clamp(1, 10) {
        1 => 1200,
        2 => 900,
        3 => 700,
        4 => 550,
        5 => 450,
        6 => 360,
        7 => 300,
        8 => 260,
        9 => 150,
        _ => 80,
    };
    Duration::from_millis(millis)
}

#[cfg(target_os = "macos")]
fn hide_unpinned_sidebar(app: &AppHandle, window: &WebviewWindow) -> Result<(), String> {
    {
        let mut runtime = lock_runtime()?;
        if runtime.state.pinned || !runtime.state.expanded {
            return Ok(());
        }
        window.hide().map_err(|error| error.to_string())?;
        runtime.state.expanded = false;
        runtime.hover.leave_started = None;
        runtime.hover.awaiting_pointer_entry = false;
        runtime.hover.reveal_started = None;
        runtime.hover.cooldown_until =
            Some(Instant::now() + mac_reveal_timing(runtime.reveal_sensitivity).1);
    }
    emit_state(app);
    Ok(())
}

#[cfg(target_os = "macos")]
fn run_macos_hover_loop(app: AppHandle, window: WebviewWindow) {
    enum Action {
        Show,
        Hide,
    }

    loop {
        let (Ok(position), Ok(Some(monitor)), Some(sidebar)) = (
            app.cursor_position(),
            app.primary_monitor(),
            MacSidebarBounds::from_window(&window),
        ) else {
            std::thread::sleep(MAC_HOVER_POLL);
            continue;
        };
        let now = Instant::now();
        let action = match lock_runtime() {
            Ok(mut runtime) => {
                let pinned = runtime.state.pinned;
                let expanded = runtime.state.expanded;
                let at_edge = mac_edge_hovered(
                    MacSidebarBounds::from_monitor_work_area(&monitor),
                    monitor.scale_factor(),
                    &runtime.state.edge,
                    position.x,
                    position.y,
                    sidebar,
                );
                let inside = sidebar.contains(position.x, position.y);
                let reveal_delay = mac_reveal_timing(runtime.reveal_sensitivity).0;
                let hide_delay = mac_hide_delay(runtime.hide_sensitivity);
                let hover = &mut runtime.hover;

                if pinned {
                    hover.reveal_started = None;
                    hover.leave_started = None;
                    None
                } else if expanded {
                    hover.reveal_started = None;
                    if inside {
                        hover.awaiting_pointer_entry = false;
                        hover.leave_started = None;
                        None
                    } else if hover.awaiting_pointer_entry
                        || hover.grace_until.is_some_and(|until| now < until)
                    {
                        hover.leave_started = None;
                        None
                    } else if hover
                        .leave_started
                        .is_some_and(|since| now.duration_since(since) >= hide_delay)
                    {
                        Some(Action::Hide)
                    } else {
                        hover.leave_started.get_or_insert(now);
                        None
                    }
                } else if hover.suppress_until_edge_leave {
                    if !at_edge {
                        hover.suppress_until_edge_leave = false;
                    }
                    hover.reveal_started = None;
                    None
                } else if hover.cooldown_until.is_some_and(|until| now < until) || !at_edge {
                    hover.reveal_started = None;
                    None
                } else if hover
                    .reveal_started
                    .is_some_and(|since| now.duration_since(since) >= reveal_delay)
                {
                    hover.reveal_started = None;
                    Some(Action::Show)
                } else {
                    hover.reveal_started.get_or_insert(now);
                    None
                }
            }
            Err(_) => None,
        };

        let result = match action {
            Some(Action::Show) => show_with_hover(&app, false, false),
            Some(Action::Hide) => hide_unpinned_sidebar(&app, &window),
            None => Ok(()),
        };
        if let Err(error) = result {
            log::warn!("macOS sidebar hover action failed: {error}");
        }
        std::thread::sleep(MAC_HOVER_POLL);
    }
}

fn sidebar_monitor(app: &AppHandle, anchor: Option<(i32, i32)>) -> Result<Monitor, String> {
    #[cfg(target_os = "macos")]
    {
        let _ = anchor;
        return app
            .primary_monitor()
            .map_err(|error| error.to_string())?
            .ok_or_else(|| "No primary monitor available for sidebar docking".to_string());
    }
    #[cfg(not(target_os = "macos"))]
    {
        let point = anchor.or_else(|| {
            app.cursor_position()
                .ok()
                .map(|position| (position.x as i32, position.y as i32))
        });
        if let Some((x, y)) = point {
            if let Ok(Some(monitor)) = app.monitor_from_point(x as f64, y as f64) {
                return Ok(monitor);
            }
        }
        app.primary_monitor()
            .map_err(|err| err.to_string())?
            .ok_or_else(|| "No monitor available for sidebar docking".to_string())
    }
}

fn position_sidebar(app: &AppHandle, window: &WebviewWindow) -> Result<(), String> {
    let runtime = lock_runtime()?;
    let edge = runtime.state.edge.clone();
    let thickness = runtime.thickness.max(DEFAULT_THICKNESS_LOGICAL);
    let length = runtime.length;
    let anchor = runtime.monitor_anchor;
    drop(runtime);

    let monitor = sidebar_monitor(app, anchor)?;
    let area = monitor.work_area();
    let scale = monitor.scale_factor();
    let vertical = edge == "left" || edge == "right";
    let cross_size = if vertical {
        area.size.width
    } else {
        area.size.height
    };
    let edge_size = if vertical {
        area.size.height
    } else {
        area.size.width
    };
    let thickness_px = ((thickness * scale).round() as u32).clamp(1, cross_size);
    let length_px = length
        .map(|value| (value * scale).round() as u32)
        .unwrap_or(edge_size)
        .clamp(1, edge_size);
    let (width, height) = if vertical {
        (thickness_px, length_px)
    } else {
        (length_px, thickness_px)
    };
    let x = match edge.as_str() {
        "left" => area.position.x,
        "right" => area.position.x + area.size.width as i32 - width as i32,
        _ => area.position.x + (area.size.width as i32 - width as i32) / 2,
    };
    let y = match edge.as_str() {
        "top" => area.position.y,
        "bottom" => area.position.y + area.size.height as i32 - height as i32,
        _ => area.position.y + (area.size.height as i32 - height as i32) / 2,
    };
    window
        .set_size(PhysicalSize::new(width, height))
        .map_err(|err| err.to_string())?;
    window
        .set_position(PhysicalPosition::new(x, y))
        .map_err(|err| err.to_string())
}

#[cfg(all(test, target_os = "macos"))]
mod mac_hover_tests {
    use super::*;

    #[test]
    fn reveal_requires_the_primary_edge_and_sidebar_span() {
        let area = MacSidebarBounds {
            left: 0.0,
            top: 24.0,
            right: 1440.0,
            bottom: 900.0,
        };
        let sidebar = MacSidebarBounds {
            left: 1120.0,
            top: 80.0,
            right: 1440.0,
            bottom: 850.0,
        };

        assert!(mac_edge_hovered(area, 1.0, "right", 1439.0, 450.0, sidebar));
        assert!(!mac_edge_hovered(
            area, 1.0, "right", 1420.0, 450.0, sidebar
        ));
        assert!(!mac_edge_hovered(area, 1.0, "right", 1439.0, 30.0, sidebar));
        assert!(!mac_edge_hovered(
            area, 1.0, "right", 1500.0, 450.0, sidebar
        ));
    }
}
