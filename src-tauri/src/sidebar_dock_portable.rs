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
    enabled: bool,
    state: SidebarDockState,
    thickness: f64,
    length: Option<f64>,
    offset: f64,
    monitor_anchor: Option<(i32, i32)>,
    #[cfg(target_os = "macos")]
    interacting: bool,
    #[cfg(target_os = "macos")]
    ui_scale: f64,
    #[cfg(target_os = "macos")]
    move_gesture: Option<MacMoveGesture>,
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

#[cfg(target_os = "macos")]
#[derive(Clone, Copy)]
struct MacMoveGesture {
    start: (f64, f64),
    grab: (f64, f64),
    grip_inset: (f64, f64),
    allow_undock: bool,
    moved: bool,
    preview: Option<(&'static str, f64, (i32, i32))>,
}

impl DockRuntime {
    #[cfg(target_os = "macos")]
    fn remember_native_size(&mut self, width: u32, height: u32, scale: f64) {
        if !scale.is_finite() || scale <= 0.0 || width == 0 || height == 0 { return; }
        let vertical = matches!(self.state.edge.as_str(), "left" | "right");
        self.thickness = if vertical { width } else { height } as f64 / scale;
        self.length = Some(if vertical { height } else { width } as f64 / scale);
    }

    fn from_config(config: &AppConfig) -> Self {
        Self {
            enabled: config.sidebar_enabled.unwrap_or(true),
            state: SidebarDockState {
                edge: parse_edge(config.sidebar_edge.as_deref()).into(),
                pinned: config.sidebar_pinned.unwrap_or(false),
                expanded: config.sidebar_enabled.unwrap_or(true) && config.sidebar_pinned.unwrap_or(false),
                dragging: false,
                preview_edge: None,
            },
            thickness: config.sidebar_width.unwrap_or(DEFAULT_THICKNESS_LOGICAL),
            length: config.sidebar_length,
            offset: crate::sidebar_placement::sanitize_offset(config.sidebar_offset),
            monitor_anchor: config.sidebar_monitor_x.zip(config.sidebar_monitor_y),
            #[cfg(target_os = "macos")]
            interacting: false,
            #[cfg(target_os = "macos")]
            ui_scale: crate::ui_scale::from_config(config),
            #[cfg(target_os = "macos")]
            move_gesture: None,
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

    fn apply_config(&mut self, config: &AppConfig) {
        let expanded = self.state.expanded;
        #[cfg(target_os = "macos")]
        let interaction = (self.interacting, self.move_gesture, self.state.dragging, self.monitor_anchor);
        #[cfg(target_os = "macos")]
        let hover = std::mem::take(&mut self.hover);
        *self = Self::from_config(config);
        self.state.expanded = self.enabled && (self.state.pinned || expanded);
        #[cfg(target_os = "macos")]
        {
            self.interacting = interaction.0 && self.enabled;
            self.move_gesture = interaction.1;
            self.state.dragging = interaction.2 && self.enabled;
            self.monitor_anchor = self.monitor_anchor.or(interaction.3);
            self.hover = if self.enabled { hover } else { MacHoverState::default() };
            if self.state.pinned {
                self.hover.reveal_started = None;
                self.hover.leave_started = None;
            }
        }
    }
}

static DOCK_RUNTIME: OnceCell<Mutex<DockRuntime>> = OnceCell::new();
static STARTUP: crate::sidebar_startup::StartupGate = crate::sidebar_startup::StartupGate::new();

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
                crate::desktop::configure_macos_desktop_spaces(native);
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

    let builder = WebviewWindowBuilder::new(app, SIDEBAR_LABEL, WebviewUrl::App("index.html".into()))
        .title("Widgitron Sidebar")
        .inner_size(DEFAULT_THICKNESS_LOGICAL, 900.0)
        .decorations(false)
        .resizable(true)
        .maximizable(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false);
    // Edge reveal must not steal focus, but the first click should still reach
    // the requested button (for example, expanding a conference timeline).
    #[cfg(target_os = "macos")]
    let builder = builder.accept_first_mouse(true).on_page_load(|window, payload| {
        if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
            if let Err(error) = crate::macos_widget_hover::install(&window) {
                log::warn!("Failed to initialize sidebar frame controls: {error}");
            }
            if let Err(error) = crate::macos_sidebar_ordering::install(&window) {
                log::warn!("Failed to initialize sidebar drag ordering: {error}");
            }
        }
    });
    let window = builder
        .build()
        .map_err(|err| err.to_string())?;
    #[cfg(target_os = "macos")]
    {
        let native_window = window.clone();
        window.run_on_main_thread(move || {
            if let Ok(pointer) = native_window.ns_window() {
                if !pointer.is_null() {
                    let native: &objc2_app_kit::NSWindow = unsafe { &*pointer.cast() };
                    crate::desktop::configure_macos_desktop_spaces(native);
                }
            }
        }).map_err(|error| error.to_string())?;
    }
    Ok(window)
}

pub fn start(app: AppHandle, config: &AppConfig) -> Result<(), String> {
    let Some(_owner) = STARTUP.try_enter() else {
        return Ok(());
    };
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
    runtime.apply_config(config);
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
    require_started()?;
    if !is_enabled() { return Ok(()); }
    let window = ensure_sidebar_window(app)?;
    position_sidebar(app, &window)?;
    let mut runtime = lock_runtime()?;
    if !runtime.enabled { return Ok(()); }
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
    require_started()?;
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
    require_started()?;
    {
        let mut runtime = lock_runtime()?;
        if !runtime.enabled { return Ok(runtime.state.clone()); }
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
    require_started()?;
    let pinned = !lock_runtime()?.state.pinned;
    set_pinned(app, pinned, focus_when_pinning && pinned)
}

pub fn begin_drag(app: &AppHandle, _allow_undock: bool) -> Result<SidebarDockState, String> {
    require_started()?;
    if !is_enabled() { return get_state(app); }
    ensure_sidebar_window(app)?
        .start_dragging()
        .map_err(|err| err.to_string())?;
    get_state(app)
}

#[cfg(target_os = "macos")]
pub fn native_header_hit(x: f64, y: f64, width: f64) -> bool {
    let scale = lock_runtime().map(|runtime| runtime.ui_scale).unwrap_or(1.0);
    y >= 6.0 && y < 44.0 * scale && x >= 6.0 && x < width - 84.0 * scale
}

#[cfg(target_os = "macos")]
pub fn native_undock_hit(x: f64, y: f64, width: f64) -> bool {
    let scale = lock_runtime().map(|runtime| runtime.ui_scale).unwrap_or(1.0);
    x >= 12.0 * scale && x < 40.0 * scale && x < width - 84.0 * scale
        && y >= 8.0 * scale && y < 36.0 * scale
}

#[cfg(target_os = "macos")]
pub fn native_vertical() -> bool {
    lock_runtime().map(|runtime| matches!(runtime.state.edge.as_str(), "left" | "right")).unwrap_or(true)
}

#[cfg(target_os = "macos")]
pub fn native_resize_band() -> f64 {
    let scale = lock_runtime().map(|runtime| runtime.ui_scale).unwrap_or(1.0);
    (14.0 * scale).clamp(12.0, 24.0)
}

#[cfg(target_os = "macos")]
pub fn native_header_metrics() -> (f64, f64) {
    let scale = lock_runtime().map(|runtime| runtime.ui_scale).unwrap_or(1.0);
    (44.0 * scale, 84.0 * scale)
}

#[cfg(target_os = "macos")]
pub fn begin_native_interaction(app: &AppHandle, moving: bool, allow_undock: bool) {
    let start = (|| {
        let anchor = lock_runtime().ok()?.monitor_anchor;
        let monitor = sidebar_monitor(app, anchor).ok()?;
        let pointer = mac_cursor_for_monitor(app, &monitor).ok()?;
        let window = app.get_webview_window(SIDEBAR_LABEL)?;
        let origin = window.outer_position().ok()?;
        let grab = (pointer.x - origin.x as f64, pointer.y - origin.y as f64);
        Some(MacMoveGesture { start: (pointer.x, pointer.y), grab,
            grip_inset: (grab.0 / monitor.scale_factor(), grab.1 / monitor.scale_factor()),
            allow_undock, moved: false, preview: None })
    })();
    if let Ok(mut runtime) = lock_runtime() {
        runtime.interacting = true;
        // Repositioning along the edge must not display redocking guidance.
        // Only an actual drag from the dedicated grip exposes that overlay.
        runtime.state.dragging = false;
        runtime.move_gesture = if moving { start } else { None };
    }
    emit_state(app);
}

#[cfg(target_os = "macos")]
pub fn protect_after_content_drag() {
    if let Ok(mut runtime) = lock_runtime() {
        runtime.hover.awaiting_pointer_entry = true;
        runtime.hover.leave_started = None;
        runtime.hover.grace_until = Some(Instant::now() + MAC_SHOW_GRACE);
    }
}

#[cfg(target_os = "macos")]
fn nearest_edge(area: MacSidebarBounds, x: f64, y: f64) -> (&'static str, f64) {
    [("left", (x - area.left).abs()), ("right", (area.right - x).abs()),
     ("top", (y - area.top).abs()), ("bottom", (area.bottom - y).abs())]
        .into_iter().min_by(|a, b| a.1.total_cmp(&b.1)).unwrap()
}

#[cfg(target_os = "macos")]
fn mac_cursor_for_monitor(app: &AppHandle, monitor: &Monitor) -> Result<PhysicalPosition<f64>, String> {
    let pointer = app.cursor_position().map_err(|error| error.to_string())?;
    // Tao returns cursor coordinates scaled by the primary display, whereas
    // each monitor's frame uses that monitor's scale. Keep them in one space.
    let primary_scale = app.primary_monitor().map_err(|error| error.to_string())?
        .map(|monitor| monitor.scale_factor()).unwrap_or(1.0);
    Ok(PhysicalPosition::new(pointer.x / primary_scale * monitor.scale_factor(),
        pointer.y / primary_scale * monitor.scale_factor()))
}

#[cfg(target_os = "macos")]
pub fn update_native_move(window: &WebviewWindow) -> Result<(), String> {
    let app = window.app_handle();
    let mut runtime = lock_runtime()?;
    let Some(mut gesture) = runtime.move_gesture else { return Ok(()); };
    let original_monitor = sidebar_monitor(app, runtime.monitor_anchor)?;
    let original_pointer = mac_cursor_for_monitor(app, &original_monitor)?;
    let dx = original_pointer.x - gesture.start.0;
    let dy = original_pointer.y - gesture.start.1;
    gesture.moved |= dx.hypot(dy) >= 6.0 * original_monitor.scale_factor();
    if !gesture.moved { return Ok(()); }
    let vertical = matches!(runtime.state.edge.as_str(), "left" | "right");
    let parallel = !gesture.allow_undock || crate::sidebar_placement::stays_on_edge(vertical, dx, dy, original_monitor.scale_factor());
    let monitor = if parallel { original_monitor } else {
        let primary_scale = app.primary_monitor().map_err(|error| error.to_string())?
            .map(|monitor| monitor.scale_factor()).unwrap_or(1.0);
        let pointer = app.cursor_position().map_err(|error| error.to_string())?;
        // monitor_from_point expects Quartz logical coordinates, not the
        // physical cursor coordinates returned by Tauri (notably on Retina).
        app.monitor_from_point(pointer.x / primary_scale, pointer.y / primary_scale)
            .map_err(|error| error.to_string())?.unwrap_or(original_monitor)
    };
    let pointer = mac_cursor_for_monitor(app, &monitor)?;
    let scale = monitor.scale_factor();
    let area = MacSidebarBounds::from_work_area(&monitor);
    let (nearest, distance) = nearest_edge(MacSidebarBounds::from_monitor(&monitor), pointer.x, pointer.y);
    let edge = if parallel { Some(parse_edge(Some(&runtime.state.edge))) }
        else { (distance <= 120.0 * scale).then_some(nearest) };
    let target = if let Some(edge) = edge {
        let centered = mac_docked_bounds(area, scale, edge, runtime.thickness, runtime.length, 0.5);
        let vertical = matches!(edge, "left" | "right");
        let grab = crate::sidebar_placement::preview_grab(centered.width(), centered.height(), gesture.grab,
            gesture.allow_undock.then_some(gesture.grip_inset), scale);
        let offset = crate::sidebar_placement::offset_from_origin(
            if vertical { area.top } else { area.left },
            if vertical { area.height() } else { area.width() },
            if vertical { centered.height() } else { centered.width() },
            if vertical { pointer.y - grab.1 } else { pointer.x - grab.0 });
        gesture.preview = Some((edge, offset, (monitor.work_area().position.x, monitor.work_area().position.y)));
        mac_docked_bounds(area, scale, edge, runtime.thickness, runtime.length, offset)
    } else {
        gesture.preview = None;
        let size = window.outer_size().map_err(|error| error.to_string())?;
        let (_, width) = crate::sidebar_placement::bounded_span(area.left,
            (size.width as f64).min(520.0 * scale), area.left, area.width(), 280.0 * scale);
        let (_, height) = crate::sidebar_placement::bounded_span(area.top,
            (size.height as f64).min(680.0 * scale), area.top, area.height(), 360.0 * scale);
        let grab = crate::sidebar_placement::preview_grab(width, height, gesture.grab,
            gesture.allow_undock.then_some(gesture.grip_inset), scale);
        let (left, _) = crate::sidebar_placement::bounded_span(pointer.x - grab.0, width, area.left, area.width(), 1.0);
        let (top, _) = crate::sidebar_placement::bounded_span(pointer.y - grab.1, height, area.top, area.height(), 1.0);
        MacSidebarBounds { left, top, right: left + width, bottom: top + height }
    };
    let show_redocking = gesture.allow_undock && gesture.moved;
    let preview = gesture.preview.filter(|_| show_redocking).map(|(edge, _, _)| edge.into());
    let preview_changed = runtime.state.preview_edge != preview || runtime.state.dragging != show_redocking;
    runtime.state.preview_edge = preview;
    runtime.state.dragging = show_redocking;
    runtime.move_gesture = Some(gesture);
    drop(runtime);
    let primary_height = app.primary_monitor().map_err(|error| error.to_string())?
        .map(|monitor| monitor.size().height as f64 / monitor.scale_factor()).unwrap_or(0.0);
    let pointer = window.ns_window().map_err(|error| error.to_string())?;
    if pointer.is_null() { return Err("Sidebar has no native window".into()); }
    let native: &objc2_app_kit::NSWindow = unsafe { &*pointer.cast() };
    native.setFrame_display(objc2_foundation::NSRect::new(
        objc2_foundation::NSPoint::new(target.left / scale, primary_height - target.bottom / scale),
        objc2_foundation::NSSize::new(target.width() / scale, target.height() / scale)), true);
    if preview_changed { emit_state(app); }
    Ok(())
}

/// Only completed native gestures update saved geometry. Programmatic frame
/// changes during reveal/theme updates must never overwrite the user's size.
#[cfg(target_os = "macos")]
pub fn finish_native_interaction(window: &WebviewWindow, moving: bool, changed: bool) {
    let app = window.app_handle();
    let result = (|| -> Result<(), String> {
        let mut runtime = lock_runtime()?;
        runtime.interacting = false;
        runtime.state.dragging = false;
        runtime.hover.leave_started = None;
        // A released resize handle is commonly just outside the new frame.
        // Arm auto-hide only after the pointer re-enters the completed layout.
        runtime.hover.awaiting_pointer_entry = true;
        runtime.hover.grace_until = Some(Instant::now() + MAC_SHOW_GRACE);
        if changed && moving {
            if let Some((edge, offset, anchor)) = runtime.move_gesture.and_then(|gesture| gesture.preview) {
                runtime.state.edge = edge.into();
                runtime.offset = offset;
                runtime.monitor_anchor = Some(anchor);
            }
        } else if changed {
            let size = window.outer_size().map_err(|error| error.to_string())?;
            let scale = window.scale_factor().map_err(|error| error.to_string())?;
            runtime.remember_native_size(size.width, size.height, scale);
            if let Ok(origin) = window.outer_position() {
                let monitor = sidebar_monitor(app, runtime.monitor_anchor)?;
                let area = monitor.work_area();
                let vertical = matches!(runtime.state.edge.as_str(), "left" | "right");
                runtime.offset = crate::sidebar_placement::offset_from_origin(
                    if vertical { area.position.y } else { area.position.x } as f64,
                    if vertical { area.size.height } else { area.size.width } as f64,
                    if vertical { size.height } else { size.width } as f64,
                    if vertical { origin.y } else { origin.x } as f64);
            }
        }
        runtime.move_gesture = None;
        runtime.state.preview_edge = None;
        let (edge, thickness, length, offset, anchor) = (runtime.state.edge.clone(), runtime.thickness,
            runtime.length, runtime.offset, runtime.monitor_anchor);
        drop(runtime);
        position_sidebar(app, window)?;
        if changed {
            let config = config_store::update_config::<AppConfig>(app, "app_config.json", |config| {
                config.sidebar_edge = Some(edge);
                config.sidebar_width = Some(thickness);
                config.sidebar_length = length;
                config.sidebar_offset = Some(offset);
                if let Some((x, y)) = anchor {
                    config.sidebar_monitor_x = Some(x);
                    config.sidebar_monitor_y = Some(y);
                }
            })?;
            let _ = app.emit("app_config_update", config);
        }
        Ok(())
    })();
    if let Err(error) = result { log::warn!("Failed to finish macOS sidebar gesture: {error}"); }
    emit_state(app);
}

pub fn get_state(app: &AppHandle) -> Result<SidebarDockState, String> {
    if DOCK_RUNTIME.get().is_some() {
        return Ok(lock_runtime()?.state.clone());
    }
    // Do not create another WebView while application setup is building one.
    let config = config_store::read_config::<AppConfig>(app, "app_config.json");
    let mut state = DockRuntime::from_config(&config).state;
    state.expanded = false;
    Ok(state)
}

fn require_started() -> Result<(), String> {
    DOCK_RUNTIME.get().map(|_| ())
        .ok_or_else(|| "Sidebar dock controller is not ready".into())
}

fn is_enabled() -> bool {
    lock_runtime().map(|runtime| runtime.enabled).unwrap_or(false)
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
    let config = match config_store::update_config::<AppConfig>(app, "app_config.json", |config| {
        config.sidebar_pinned = Some(pinned);
    }) {
        Ok(config) => config,
        Err(err) => {
            log::warn!("Failed to persist sidebar pin state: {err}");
            return;
        }
    };
    let _ = app.emit("app_config_update", config);
}

#[cfg(target_os = "macos")]
#[derive(Clone, Copy, Debug, PartialEq)]
struct MacSidebarBounds {
    left: f64,
    top: f64,
    right: f64,
    bottom: f64,
}

#[cfg(target_os = "macos")]
impl MacSidebarBounds {
    fn width(self) -> f64 { self.right - self.left }
    fn height(self) -> f64 { self.bottom - self.top }

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

    fn from_work_area(monitor: &Monitor) -> Self {
        let area = monitor.work_area();
        Self { left: area.position.x as f64, top: area.position.y as f64,
            right: area.position.x as f64 + area.size.width as f64,
            bottom: area.position.y as f64 + area.size.height as f64 }
    }

    fn from_monitor(monitor: &Monitor) -> Self {
        let position = monitor.position();
        let size = monitor.size();
        Self {
            left: position.x as f64,
            top: position.y as f64,
            right: position.x as f64 + size.width as f64,
            bottom: position.y as f64 + size.height as f64,
        }
    }
}

#[cfg(target_os = "macos")]
fn mac_docked_bounds(area: MacSidebarBounds, scale: f64, edge: &str, thickness: f64,
    length: Option<f64>, offset: f64) -> MacSidebarBounds {
    let vertical = matches!(edge, "left" | "right");
    let (cross, span) = if vertical { (area.width(), area.height()) } else { (area.height(), area.width()) };
    let thickness = (thickness.max(320.0) * scale).round().clamp(1.0, cross.max(1.0));
    let length = length.map(|length| (length * scale).round()).unwrap_or(span)
        .clamp((360.0 * scale).min(span).max(1.0), span.max(1.0));
    let (width, height) = if vertical { (thickness, length) } else { (length, thickness) };
    let left = match edge { "left" => area.left, "right" => area.right - width,
        _ => crate::sidebar_placement::edge_origin(area.left, area.width(), width, offset).round() };
    let top = match edge { "top" => area.top, "bottom" => area.bottom - height,
        _ => crate::sidebar_placement::edge_origin(area.top, area.height(), height, offset).round() };
    MacSidebarBounds { left, top, right: left + width, bottom: top + height }
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
        if !is_enabled() {
            std::thread::sleep(Duration::from_millis(250));
            continue;
        }
        let monitor = sidebar_monitor(&app, lock_runtime().ok().and_then(|runtime| runtime.monitor_anchor));
        let Ok(monitor) = monitor else {
            std::thread::sleep(MAC_HOVER_POLL);
            continue;
        };
        let (Ok(position), Some(sidebar)) = (mac_cursor_for_monitor(&app, &monitor), MacSidebarBounds::from_window(&window)) else {
            std::thread::sleep(MAC_HOVER_POLL);
            continue;
        };
        let now = Instant::now();
        let action = match lock_runtime() {
            Ok(mut runtime) => {
                if !runtime.enabled { continue; }
                if runtime.interacting || objc2_app_kit::NSEvent::pressedMouseButtons() & 1 != 0 {
                    drop(runtime);
                    std::thread::sleep(MAC_HOVER_POLL);
                    continue;
                }
                let pinned = runtime.state.pinned;
                let expanded = runtime.state.expanded;
                let at_edge = mac_edge_hovered(
                    // The menu bar and Dock are excluded from work_area. Edge
                    // reveal belongs to the physical screen perimeter instead.
                    MacSidebarBounds::from_monitor(&monitor),
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
        if let Some((x, y)) = anchor {
            for monitor in app.available_monitors().map_err(|error| error.to_string())? {
                if MacSidebarBounds::from_monitor(&monitor).contains(x as f64, y as f64) { return Ok(monitor); }
            }
        }
        return app.primary_monitor().map_err(|error| error.to_string())?
            .ok_or_else(|| "No monitor available for sidebar docking".into());
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
    #[cfg(target_os = "macos")]
    if runtime.interacting { return Ok(()); }
    let edge = runtime.state.edge.clone();
    let thickness = runtime.thickness.max(DEFAULT_THICKNESS_LOGICAL);
    let length = runtime.length;
    let offset = runtime.offset;
    let anchor = runtime.monitor_anchor;
    drop(runtime);

    let monitor = sidebar_monitor(app, anchor)?;
    let area = monitor.work_area();
    let scale = monitor.scale_factor();
    #[cfg(target_os = "macos")]
    {
        if let Ok(mut runtime) = lock_runtime() {
            runtime.monitor_anchor.get_or_insert((area.position.x, area.position.y));
        }
    }
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
        .clamp(((360.0 * scale).round() as u32).min(edge_size).max(1), edge_size);
    let (width, height) = if vertical {
        (thickness_px, length_px)
    } else {
        (length_px, thickness_px)
    };
    let x = match edge.as_str() {
        "left" => area.position.x,
        "right" => area.position.x + area.size.width as i32 - width as i32,
        _ => crate::sidebar_placement::edge_origin(area.position.x as f64, area.size.width as f64, width as f64, offset).round() as i32,
    };
    let y = match edge.as_str() {
        "top" => area.position.y,
        "bottom" => area.position.y + area.size.height as i32 - height as i32,
        _ => crate::sidebar_placement::edge_origin(area.position.y as f64, area.size.height as f64, height as f64, offset).round() as i32,
    };
    // Preview and committed geometry use the same calculation on macOS.
    #[cfg(target_os = "macos")]
    let (x, y, width, height) = {
        let bounds = mac_docked_bounds(MacSidebarBounds::from_work_area(&monitor), scale,
            &edge, thickness, length, offset);
        debug_assert_eq!((x, y), (bounds.left as i32, bounds.top as i32));
        (bounds.left as i32, bounds.top as i32, bounds.width() as u32, bounds.height() as u32)
    };
    #[cfg(target_os = "macos")]
    {
        let minimum: (f64, f64) = if vertical { (width as f64 / scale, 360.0) } else { (360.0, height as f64 / scale) };
        window.set_min_size(Some(tauri::LogicalSize::new(
            minimum.0.min(area.size.width as f64 / scale),
            minimum.1.min(area.size.height as f64 / scale),
        ))).map_err(|error| error.to_string())?;
        window.set_max_size(Some(PhysicalSize::new(
            if vertical { width } else { area.size.width },
            if vertical { area.size.height } else { height })))
            .map_err(|error| error.to_string())?;
    }
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

    #[test]
    fn top_reveal_uses_the_screen_edge_above_the_menu_bar() {
        let screen = MacSidebarBounds { left: 0.0, top: 0.0, right: 2880.0, bottom: 1800.0 };
        let sidebar = MacSidebarBounds { left: 500.0, top: 50.0, right: 2380.0, bottom: 690.0 };
        assert!(mac_edge_hovered(screen, 2.0, "top", 1400.0, 0.0, sidebar));
        assert!(!mac_edge_hovered(screen, 2.0, "top", 1400.0, 50.0, sidebar));
        assert!(!mac_edge_hovered(screen, 2.0, "top", 200.0, 0.0, sidebar));
    }

    #[test]
    fn shortened_sidebar_only_reveals_along_its_saved_span() {
        let screen = MacSidebarBounds { left: -1920.0, top: 0.0, right: 0.0, bottom: 1080.0 };
        let sidebar = MacSidebarBounds { left: -320.0, top: 250.0, right: 0.0, bottom: 750.0 };
        assert!(mac_edge_hovered(screen, 1.0, "right", -1.0, 450.0, sidebar));
        assert!(!mac_edge_hovered(screen, 1.0, "right", -1.0, 900.0, sidebar));
        assert_eq!(nearest_edge(screen, -1918.0, 450.0), ("left", 2.0));
        assert_eq!(nearest_edge(screen, -900.0, 2.0), ("top", 2.0));
    }

    #[test]
    fn resized_length_survives_config_round_trip_and_reveal() {
        for (edge, width, height, thickness, length) in [
            ("right", 640, 1000, 320.0, 500.0),
            ("top", 1600, 640, 320.0, 800.0),
        ] {
            let mut config = AppConfig { sidebar_edge: Some(edge.into()), ..AppConfig::default() };
            let mut runtime = DockRuntime::from_config(&config);
            runtime.remember_native_size(width, height, 2.0);
            config.sidebar_width = Some(runtime.thickness);
            config.sidebar_length = runtime.length;
            config.sidebar_offset = Some(0.72);
            // collapse, persisted profile reload, then edge reveal
            runtime.state.expanded = false;
            let saved: AppConfig = serde_json::from_str(&serde_json::to_string(&config).unwrap()).unwrap();
            runtime.apply_config(&saved);
            runtime.state.expanded = true;
            assert_eq!(runtime.thickness, thickness);
            assert_eq!(runtime.length, Some(length));
            assert_eq!(runtime.state.edge, edge);
            assert_eq!(runtime.offset, 0.72);
        }
    }

    #[test]
    fn preview_and_saved_docking_keep_all_four_edges_inside_work_area() {
        let area = MacSidebarBounds { left: -1920.0, top: 50.0, right: 0.0, bottom: 1080.0 };
        for edge in ["left", "right", "top", "bottom"] {
            for offset in [0.0, 0.4, 1.0] {
                for length in [Some(400.0), Some(10000.0), None] {
                    let frame = mac_docked_bounds(area, 2.0, edge, 320.0, length, offset);
                    assert!(frame.left >= area.left && frame.right <= area.right);
                    assert!(frame.top >= area.top && frame.bottom <= area.bottom);
                    let vertical = matches!(edge, "left" | "right");
                    let saved = crate::sidebar_placement::offset_from_origin(
                        if vertical { area.top } else { area.left },
                        if vertical { area.height() } else { area.width() },
                        if vertical { frame.height() } else { frame.width() },
                        if vertical { frame.top } else { frame.left });
                    let restored = mac_docked_bounds(area, 2.0, edge, 320.0, length, saved);
                    assert_eq!(restored, frame);
                }
            }
        }
    }

    #[test]
    fn invalid_native_geometry_does_not_replace_saved_size() {
        let mut runtime = DockRuntime::from_config(&AppConfig::default());
        runtime.remember_native_size(320, 500, 1.0);
        runtime.remember_native_size(0, 500, 1.0);
        runtime.remember_native_size(640, 1000, 0.0);
        runtime.remember_native_size(640, 1000, f64::NAN);
        assert_eq!(runtime.thickness, 320.0);
        assert_eq!(runtime.length, Some(500.0));
    }
}

#[cfg(test)]
mod sidebar_enable_tests {
    use super::*;

    #[test]
    fn disabled_sidebar_stays_hidden_even_when_pin_preference_is_preserved() {
        let mut config = AppConfig { sidebar_enabled: Some(false), sidebar_pinned: Some(true), ..AppConfig::default() };
        let mut runtime = DockRuntime::from_config(&config);
        assert!(!runtime.enabled);
        assert!(!runtime.state.expanded);
        assert!(runtime.state.pinned);
        config.sidebar_width = Some(420.0);
        runtime.apply_config(&config);
        assert!(!runtime.state.expanded);
        assert_eq!(runtime.thickness, 420.0);
        config.sidebar_enabled = Some(true);
        runtime.apply_config(&config);
        assert!(runtime.enabled && runtime.state.expanded);
    }

    #[test]
    fn disabling_an_open_unpinned_sidebar_clears_reveal_intent() {
        let mut config = AppConfig::default();
        let mut runtime = DockRuntime::from_config(&config);
        runtime.state.expanded = true;
        #[cfg(target_os = "macos")]
        { runtime.hover.reveal_started = Some(Instant::now()); }
        config.sidebar_enabled = Some(false);
        runtime.apply_config(&config);
        assert!(!runtime.enabled && !runtime.state.expanded);
        #[cfg(target_os = "macos")]
        assert!(runtime.hover.reveal_started.is_none());
        config.sidebar_enabled = Some(true);
        runtime.apply_config(&config);
        assert!(runtime.enabled);
        assert!(!runtime.state.expanded);
    }

    #[test]
    fn old_profiles_keep_sidebar_enabled_without_a_new_setting() {
        let config: AppConfig = serde_json::from_str(r#"{"sidebar_pinned":true}"#).unwrap();
        let runtime = DockRuntime::from_config(&config);
        assert!(runtime.enabled && runtime.state.expanded);
    }
}
