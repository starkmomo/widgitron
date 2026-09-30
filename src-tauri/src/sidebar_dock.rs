use once_cell::sync::OnceCell;
use serde::Serialize;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use windows::Win32::Foundation::{HWND, POINT, RECT};
use windows::Win32::Graphics::Gdi::{
    GetMonitorInfoW, MonitorFromPoint, MONITORINFO, MONITOR_DEFAULTTONEAREST,
};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, VK_LBUTTON, VK_MBUTTON, VK_RBUTTON, VK_XBUTTON1, VK_XBUTTON2,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetCursorPos, GetWindowRect, IsChild, IsWindowVisible, SetWindowPos, ShowWindow,
    WindowFromPoint, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOZORDER, SWP_SHOWWINDOW, SW_HIDE,
};

use crate::config_store;
use crate::models::AppConfig;

const SIDEBAR_LABEL: &str = "sidebar";
// A generous initial cross-axis size. The edge-axis length remains dynamic so
// a newly docked sidebar nearly fills whichever monitor edge it uses.
const DEFAULT_THICKNESS_LOGICAL: f64 = 320.0;
const MIN_THICKNESS_LOGICAL: f64 = 320.0;
const MIN_EDGE_LENGTH_LOGICAL: f64 = 360.0;
const CROSS_AXIS_MARGIN_LOGICAL: f64 = 6.0;
const EDGE_TRIGGER_LOGICAL: f64 = 3.0;
const EDGE_CORNER_GUARD_LOGICAL: f64 = 56.0;
const SNAP_DISTANCE_LOGICAL: f64 = 120.0;
const DRAG_PREVIEW_MIN_WIDTH_LOGICAL: f64 = 280.0;
const DRAG_PREVIEW_MAX_WIDTH_LOGICAL: f64 = 520.0;
const DRAG_PREVIEW_MIN_HEIGHT_LOGICAL: f64 = 360.0;
const DRAG_PREVIEW_MAX_HEIGHT_LOGICAL: f64 = 680.0;
const DRAG_PREVIEW_MARGIN_LOGICAL: f64 = 18.0;
const DRAG_ACTIVATION_DISTANCE_LOGICAL: f64 = 12.0;
const SHOW_GRACE: Duration = Duration::from_millis(850);
/// Default reveal feel: deliberately less sensitive than hide.
pub const DEFAULT_REVEAL_SENSITIVITY: u8 = 4;
/// Default hide feel: collapses quickly after the pointer leaves.
pub const DEFAULT_HIDE_SENSITIVITY: u8 = 8;

fn clamp_sensitivity(value: Option<u8>, default: u8) -> u8 {
    value.unwrap_or(default).clamp(1, 10)
}

/// Map 1..=10 → edge dwell + post-hide cooldown. Level 4 matches the prior
/// constants (500 ms dwell / 900 ms cooldown).
fn reveal_timings(sensitivity: u8) -> (Duration, Duration) {
    let (dwell_ms, cooldown_ms) = match sensitivity.clamp(1, 10) {
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
        Duration::from_millis(dwell_ms),
        Duration::from_millis(cooldown_ms),
    )
}

/// Map 1..=10 → leave delay before auto-hide. Level 8 matches the prior 260 ms.
fn hide_leave_delay(sensitivity: u8) -> Duration {
    let leave_ms = match sensitivity.clamp(1, 10) {
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
    Duration::from_millis(leave_ms)
}

static DOCK_RUNTIME: OnceCell<Arc<Mutex<DockRuntime>>> = OnceCell::new();

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DockEdge {
    Left,
    Top,
    Right,
    Bottom,
}

impl DockEdge {
    fn parse(value: Option<&str>) -> Self {
        match value.map(str::trim).map(str::to_ascii_lowercase).as_deref() {
            Some("left") => Self::Left,
            Some("top") => Self::Top,
            Some("bottom") => Self::Bottom,
            _ => Self::Right,
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Left => "left",
            Self::Top => "top",
            Self::Right => "right",
            Self::Bottom => "bottom",
        }
    }

    fn is_vertical(self) -> bool {
        matches!(self, Self::Left | Self::Right)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct RectPx {
    left: i32,
    top: i32,
    width: i32,
    height: i32,
}

impl RectPx {
    fn right(self) -> i32 {
        self.left.saturating_add(self.width)
    }

    fn bottom(self) -> i32 {
        self.top.saturating_add(self.height)
    }

    fn contains(self, point: POINT) -> bool {
        point.x >= self.left
            && point.x < self.right()
            && point.y >= self.top
            && point.y < self.bottom()
    }
}

#[derive(Debug, Clone, Copy)]
struct WorkArea {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
    scale_factor: f64,
}

#[derive(Debug, Default)]
struct EdgeRevealIntent {
    armed: bool,
    dwell_started_at: Option<Instant>,
}

impl EdgeRevealIntent {
    fn reset(&mut self) {
        self.armed = false;
        self.dwell_started_at = None;
    }

    fn update(
        &mut self,
        now: Instant,
        edge_hovered: bool,
        entered_with_intent: bool,
        blocked: bool,
        dwell: Duration,
    ) -> bool {
        if blocked || !edge_hovered {
            self.reset();
            return false;
        }

        if !self.armed {
            if !entered_with_intent {
                return false;
            }
            self.armed = true;
            self.dwell_started_at = Some(now);
        }

        let ready = self
            .dwell_started_at
            .is_some_and(|started_at| now.duration_since(started_at) >= dwell);
        if ready {
            self.reset();
        }
        ready
    }
}

impl WorkArea {
    fn width(self) -> i32 {
        (self.right - self.left).max(1)
    }

    fn height(self) -> i32 {
        (self.bottom - self.top).max(1)
    }

    fn contains(self, point: POINT) -> bool {
        point.x >= self.left && point.x < self.right && point.y >= self.top && point.y < self.bottom
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct SidebarDockState {
    pub edge: String,
    pub pinned: bool,
    pub expanded: bool,
    pub dragging: bool,
    pub preview_edge: Option<String>,
}

#[derive(Debug)]
struct DockRuntime {
    edge: DockEdge,
    pinned: bool,
    requested_expanded: bool,
    visual_expanded: bool,
    native_visible: bool,
    thickness_logical: f64,
    edge_length_logical: Option<f64>,
    ui_scale: f64,
    reveal_dwell: Duration,
    reveal_cooldown: Duration,
    hide_leave_delay: Duration,
    work_area: WorkArea,
    leave_at: Option<Instant>,
    grace_until: Instant,
    suppress_reveal_until_edge_leave: bool,
    edge_reveal_intent: EdgeRevealIntent,
    reveal_cooldown_until: Instant,
    last_cursor: Option<POINT>,
    focus_requested: bool,
    raise_requested: bool,
    awaiting_pointer_entry: bool,
    layout_dirty: bool,
    dragging: bool,
    drag_start: Option<POINT>,
    drag_has_moved: bool,
    drag_offset: Option<POINT>,
    drag_preview_edge: Option<DockEdge>,
    drag_preview_area: Option<WorkArea>,
    resizing: bool,
    was_left_down: bool,
    managed_rect: Option<RectPx>,
    last_emitted: Option<SidebarDockState>,
}

impl DockRuntime {
    fn payload(&self) -> SidebarDockState {
        SidebarDockState {
            edge: self.edge.as_str().to_string(),
            pinned: self.pinned,
            expanded: self.visual_expanded,
            dragging: self.dragging,
            preview_edge: self.drag_preview_edge.map(|edge| edge.as_str().to_string()),
        }
    }

    fn reset_edge_reveal(&mut self) {
        self.edge_reveal_intent.reset();
    }

    fn start_reveal_cooldown(&mut self, now: Instant) {
        self.reset_edge_reveal();
        self.reveal_cooldown_until = now + self.reveal_cooldown;
    }

    fn apply_sensitivity(&mut self, config: &AppConfig) {
        let reveal = clamp_sensitivity(
            config.sidebar_reveal_sensitivity,
            DEFAULT_REVEAL_SENSITIVITY,
        );
        let hide =
            clamp_sensitivity(config.sidebar_hide_sensitivity, DEFAULT_HIDE_SENSITIVITY);
        let (dwell, cooldown) = reveal_timings(reveal);
        self.reveal_dwell = dwell;
        self.reveal_cooldown = cooldown;
        self.hide_leave_delay = hide_leave_delay(hide);
    }
}

pub fn ensure_sidebar_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(SIDEBAR_LABEL) {
        let _ = window.set_maximizable(false);
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
    let ui_scale = crate::ui_scale::from_config(config);
    crate::ui_scale::apply_to_window(&window, ui_scale)?;
    let cursor = cursor_position();
    let anchor = match (config.sidebar_monitor_x, config.sidebar_monitor_y) {
        (Some(x), Some(y)) => POINT { x, y },
        _ => cursor.unwrap_or(POINT { x: 0, y: 0 }),
    };
    let work_area = work_area_near_point(&app, anchor)
        .ok_or_else(|| "No monitor work area available for sidebar docking".to_string())?;
    let pinned = config.sidebar_pinned.unwrap_or(false);
    let now = Instant::now();
    let reveal_sensitivity = clamp_sensitivity(
        config.sidebar_reveal_sensitivity,
        DEFAULT_REVEAL_SENSITIVITY,
    );
    let hide_sensitivity =
        clamp_sensitivity(config.sidebar_hide_sensitivity, DEFAULT_HIDE_SENSITIVITY);
    let (reveal_dwell, reveal_cooldown) = reveal_timings(reveal_sensitivity);
    let hide_leave = hide_leave_delay(hide_sensitivity);
    let runtime = Arc::new(Mutex::new(DockRuntime {
        edge: DockEdge::parse(config.sidebar_edge.as_deref()),
        pinned,
        requested_expanded: pinned,
        visual_expanded: false,
        native_visible: false,
        thickness_logical: config.sidebar_width.unwrap_or(DEFAULT_THICKNESS_LOGICAL),
        edge_length_logical: config.sidebar_length,
        ui_scale,
        reveal_dwell,
        reveal_cooldown,
        hide_leave_delay: hide_leave,
        work_area,
        leave_at: None,
        grace_until: now + SHOW_GRACE,
        suppress_reveal_until_edge_leave: false,
        edge_reveal_intent: EdgeRevealIntent::default(),
        reveal_cooldown_until: now + reveal_cooldown,
        last_cursor: cursor,
        focus_requested: false,
        raise_requested: pinned,
        awaiting_pointer_entry: false,
        layout_dirty: true,
        dragging: false,
        drag_start: None,
        drag_has_moved: false,
        drag_offset: None,
        drag_preview_edge: None,
        drag_preview_area: None,
        resizing: false,
        was_left_down: false,
        managed_rect: None,
        last_emitted: None,
    }));

    DOCK_RUNTIME
        .set(runtime.clone())
        .map_err(|_| "Sidebar dock controller is already running".to_string())?;

    std::thread::Builder::new()
        .name("widgitron-sidebar-dock".into())
        .spawn(move || run_dock_loop(app, window, runtime))
        .map_err(|err| format!("Failed to start sidebar dock controller: {err}"))?;

    Ok(())
}

pub fn apply_config(app: &AppHandle, config: &AppConfig) {
    let Some(runtime) = DOCK_RUNTIME.get() else {
        return;
    };
    let next_ui_scale = crate::ui_scale::from_config(config);
    if let Some(window) = app.get_webview_window(SIDEBAR_LABEL) {
        if let Err(err) = crate::ui_scale::apply_to_window(&window, next_ui_scale) {
            log::warn!("Failed to apply UI scale to sidebar: {err}");
        }
    }
    let mut state = lock_runtime(runtime);
    state.apply_sensitivity(config);
    let next_edge = DockEdge::parse(config.sidebar_edge.as_deref());
    let next_pinned = config.sidebar_pinned.unwrap_or(false);
    let next_thickness = config.sidebar_width.unwrap_or(DEFAULT_THICKNESS_LOGICAL);
    let next_edge_length = config.sidebar_length;
    let now = Instant::now();

    if state.edge != next_edge {
        state.edge = next_edge;
        state.layout_dirty = true;
        state.requested_expanded = true;
        state.raise_requested = true;
        state.grace_until = now + SHOW_GRACE;
        state.start_reveal_cooldown(now);
    }
    if (state.thickness_logical - next_thickness).abs() >= 1.0 {
        state.thickness_logical = next_thickness;
        state.layout_dirty = true;
    }
    if edge_length_changed(state.edge_length_logical, next_edge_length) {
        state.edge_length_logical = next_edge_length;
        state.layout_dirty = true;
    }
    if (state.ui_scale - next_ui_scale).abs() >= 0.001 {
        state.ui_scale = next_ui_scale;
        state.layout_dirty = true;
    }
    if let (Some(x), Some(y)) = (config.sidebar_monitor_x, config.sidebar_monitor_y) {
        if let Some(area) = work_area_near_point(app, POINT { x, y }) {
            if area.left != state.work_area.left || area.top != state.work_area.top {
                state.work_area = area;
                state.layout_dirty = true;
                state.start_reveal_cooldown(now);
            }
        }
    }
    if state.pinned != next_pinned {
        state.pinned = next_pinned;
        state.reset_edge_reveal();
        if next_pinned {
            state.requested_expanded = true;
            state.raise_requested = true;
            state.grace_until = now + SHOW_GRACE;
        } else {
            state.grace_until = now + state.hide_leave_delay;
            state.start_reveal_cooldown(now);
        }
    }
}

pub fn show(app: &AppHandle, focus: bool) -> Result<(), String> {
    ensure_started(app)?;
    let runtime = DOCK_RUNTIME
        .get()
        .ok_or_else(|| "Sidebar dock controller is unavailable".to_string())?;
    let mut state = lock_runtime(runtime);
    let anchor = POINT {
        x: state.work_area.left + state.work_area.width() / 2,
        y: state.work_area.top + state.work_area.height() / 2,
    };
    if let Some(area) = work_area_near_point(app, anchor) {
        if area.left != state.work_area.left
            || area.top != state.work_area.top
            || area.right != state.work_area.right
            || area.bottom != state.work_area.bottom
            || (area.scale_factor - state.work_area.scale_factor).abs() >= 0.001
        {
            state.work_area = area;
            state.layout_dirty = true;
        }
    }
    state.requested_expanded = true;
    state.focus_requested |= focus;
    state.raise_requested = true;
    state.awaiting_pointer_entry = !state.pinned;
    state.suppress_reveal_until_edge_leave = false;
    state.reset_edge_reveal();
    state.grace_until = Instant::now() + SHOW_GRACE;
    Ok(())
}

pub fn collapse(app: &AppHandle) -> Result<(), String> {
    ensure_started(app)?;
    let runtime = DOCK_RUNTIME
        .get()
        .ok_or_else(|| "Sidebar dock controller is unavailable".to_string())?;
    {
        let mut state = lock_runtime(runtime);
        state.pinned = false;
        state.requested_expanded = false;
        state.focus_requested = false;
        state.raise_requested = false;
        state.awaiting_pointer_entry = false;
        state.leave_at = None;
        state.suppress_reveal_until_edge_leave = true;
        state.start_reveal_cooldown(Instant::now());
    }
    persist_runtime_config(app);
    Ok(())
}

pub fn set_pinned(app: &AppHandle, pinned: bool, focus: bool) -> Result<SidebarDockState, String> {
    ensure_started(app)?;
    let runtime = DOCK_RUNTIME
        .get()
        .ok_or_else(|| "Sidebar dock controller is unavailable".to_string())?;
    let payload = {
        let mut state = lock_runtime(runtime);
        let now = Instant::now();
        state.pinned = pinned;
        state.reset_edge_reveal();
        if pinned {
            state.requested_expanded = true;
            state.focus_requested |= focus;
            state.raise_requested = true;
            state.awaiting_pointer_entry = false;
            state.suppress_reveal_until_edge_leave = false;
            state.grace_until = now + SHOW_GRACE;
        } else {
            state.grace_until = now + state.hide_leave_delay;
            state.start_reveal_cooldown(now);
        }
        state.payload()
    };
    persist_runtime_config(app);
    Ok(payload)
}

pub fn toggle_pinned(
    app: &AppHandle,
    focus_when_pinning: bool,
) -> Result<SidebarDockState, String> {
    ensure_started(app)?;
    let pinned = DOCK_RUNTIME
        .get()
        .map(|runtime| !lock_runtime(runtime).pinned)
        .unwrap_or(true);
    set_pinned(app, pinned, focus_when_pinning && pinned)
}

pub fn begin_drag(app: &AppHandle) -> Result<SidebarDockState, String> {
    ensure_started(app)?;
    let runtime = DOCK_RUNTIME
        .get()
        .ok_or_else(|| "Sidebar dock controller is unavailable".to_string())?;
    let window = ensure_sidebar_window(app)?;
    let cursor = cursor_position();
    let current_rect = native_window_rect(&window);
    let mut state = lock_runtime(runtime);
    state.dragging = true;
    state.drag_start = cursor;
    state.drag_has_moved = false;
    state.drag_offset = match (cursor, current_rect) {
        (Some(cursor), Some(rect)) => Some(POINT {
            x: cursor.x.saturating_sub(rect.left),
            y: cursor.y.saturating_sub(rect.top),
        }),
        _ => None,
    };
    state.drag_preview_edge = None;
    state.drag_preview_area = None;
    state.resizing = false;
    state.requested_expanded = true;
    state.awaiting_pointer_entry = false;
    state.reset_edge_reveal();
    state.grace_until = Instant::now() + SHOW_GRACE;
    Ok(state.payload())
}

pub fn get_state(app: &AppHandle) -> Result<SidebarDockState, String> {
    ensure_started(app)?;
    DOCK_RUNTIME
        .get()
        .map(|runtime| lock_runtime(runtime).payload())
        .ok_or_else(|| "Sidebar dock controller is unavailable".to_string())
}

fn ensure_started(app: &AppHandle) -> Result<(), String> {
    if DOCK_RUNTIME.get().is_some() {
        return Ok(());
    }
    let config = config_store::read_config::<AppConfig>(app, "app_config.json");
    start(app.clone(), &config)
}

fn run_dock_loop(app: AppHandle, window: WebviewWindow, runtime: Arc<Mutex<DockRuntime>>) {
    let _ = window.set_always_on_top(true);

    loop {
        let now = Instant::now();
        let cursor = cursor_position();
        let left_down = is_left_button_down();
        let pointer_button_down = left_down || is_other_pointer_button_down();
        let current_rect = native_window_rect(&window);
        let mut should_persist = false;
        let mut event_payload = None;

        {
            let mut state = lock_runtime(&runtime);
            let shown_rect = sidebar_rect(
                state.work_area,
                state.edge,
                state.thickness_logical,
                state.edge_length_logical,
                state.ui_scale,
            );
            if state.native_visible && !native_is_visible(&window) {
                state.native_visible = false;
                state.visual_expanded = false;
            }

            if state.dragging {
                if let Some(point) = cursor {
                    let activation_distance = (DRAG_ACTIVATION_DISTANCE_LOGICAL
                        * state.work_area.scale_factor)
                        .round() as i32;
                    if let Some(start) = state.drag_start {
                        let delta_x = point.x.saturating_sub(start.x) as i64;
                        let delta_y = point.y.saturating_sub(start.y) as i64;
                        let threshold = activation_distance.max(4) as i64;
                        state.drag_has_moved |=
                            delta_x * delta_x + delta_y * delta_y >= threshold * threshold;
                    } else {
                        state.drag_has_moved = true;
                    }

                    if state.drag_has_moved {
                        if let Some(next_area) = work_area_near_point(&app, point) {
                            let (edge, distance) = nearest_edge(next_area, point);
                            let snap_distance =
                                (SNAP_DISTANCE_LOGICAL * next_area.scale_factor).round() as i32;
                            let preview_edge = (distance <= snap_distance.max(24)).then_some(edge);
                            let source_rect =
                                state.managed_rect.or(current_rect).unwrap_or(shown_rect);
                            let preview_rect = match preview_edge {
                                Some(edge) => sidebar_rect(
                                    next_area,
                                    edge,
                                    state.thickness_logical,
                                    state.edge_length_logical,
                                    state.ui_scale,
                                ),
                                None => floating_drag_preview_rect(
                                    next_area,
                                    point,
                                    state.drag_offset,
                                    source_rect,
                                    state.ui_scale,
                                ),
                            };

                            if state.managed_rect != Some(preview_rect) {
                                if native_set_window_rect(&window, preview_rect).is_ok() {
                                    state.managed_rect = Some(preview_rect);
                                }
                            }
                            state.drag_preview_edge = preview_edge;
                            state.drag_preview_area = Some(next_area);
                        }
                    }
                }

                if !left_down {
                    if let (Some(edge), Some(next_area)) =
                        (state.drag_preview_edge, state.drag_preview_area)
                    {
                        state.edge = edge;
                        state.work_area = next_area;
                    }
                    state.dragging = false;
                    state.drag_start = None;
                    state.drag_has_moved = false;
                    state.drag_offset = None;
                    state.drag_preview_edge = None;
                    state.drag_preview_area = None;
                    state.layout_dirty = true;
                    state.requested_expanded = true;
                    state.grace_until = now + SHOW_GRACE;
                    state.start_reveal_cooldown(now);
                    should_persist = true;
                }
            } else if left_down {
                if let (Some(actual), Some(managed)) = (current_rect, state.managed_rect) {
                    if (actual.width - managed.width).abs() > 2
                        || (actual.height - managed.height).abs() > 2
                    {
                        state.resizing = true;
                    }
                }
            } else if state.was_left_down && state.resizing {
                if let (Some(actual), Some(managed)) = (current_rect, state.managed_rect) {
                    let thickness_changed = if state.edge.is_vertical() {
                        (actual.width - managed.width).abs() > 2
                    } else {
                        (actual.height - managed.height).abs() > 2
                    };
                    let edge_length_changed = if state.edge.is_vertical() {
                        (actual.height - managed.height).abs() > 2
                    } else {
                        (actual.width - managed.width).abs() > 2
                    };

                    if thickness_changed {
                        state.thickness_logical = logical_thickness_for_rect(
                            state.work_area,
                            state.edge,
                            actual,
                            state.ui_scale,
                        );
                    }
                    if edge_length_changed {
                        state.edge_length_logical = Some(logical_edge_length_for_rect(
                            state.work_area,
                            state.edge,
                            actual,
                            state.ui_scale,
                        ));
                    }
                    state.layout_dirty = true;
                    should_persist = true;
                }
                state.resizing = false;
            }

            state.was_left_down = left_down;

            let previous_cursor = state.last_cursor;
            state.last_cursor = cursor;
            let edge_hovered = cursor
                .map(|point| cursor_in_edge_trigger(state.work_area, shown_rect, state.edge, point))
                .unwrap_or(false);
            let entered_with_intent = match (previous_cursor, cursor) {
                (Some(previous), Some(current)) => cursor_entered_edge_with_intent(
                    state.work_area,
                    shown_rect,
                    state.edge,
                    previous,
                    current,
                ),
                _ => false,
            };
            if state.suppress_reveal_until_edge_leave {
                state.reset_edge_reveal();
                if !edge_hovered {
                    state.suppress_reveal_until_edge_leave = false;
                }
            } else {
                let reveal_blocked = state.pinned
                    || state.requested_expanded
                    || state.native_visible
                    || state.dragging
                    || pointer_button_down
                    || now < state.reveal_cooldown_until;
                let reveal_dwell = state.reveal_dwell;
                if state.edge_reveal_intent.update(
                    now,
                    edge_hovered,
                    entered_with_intent,
                    reveal_blocked,
                    reveal_dwell,
                ) {
                    state.requested_expanded = true;
                    state.awaiting_pointer_entry = false;
                    state.grace_until = now + SHOW_GRACE;
                    state.leave_at = None;
                }
            }

            if state.pinned {
                state.requested_expanded = true;
                state.awaiting_pointer_entry = false;
                state.leave_at = None;
            } else if state.requested_expanded && !state.dragging && !left_down {
                let pointer_inside = cursor
                    .map(|point| pointer_inside_sidebar(&window, shown_rect, point))
                    .unwrap_or(false);
                if pointer_inside {
                    state.awaiting_pointer_entry = false;
                }
                if pointer_inside || state.awaiting_pointer_entry || now < state.grace_until {
                    state.leave_at = None;
                } else if let Some(deadline) = state.leave_at {
                    if now >= deadline {
                        state.requested_expanded = false;
                        state.leave_at = None;
                        state.start_reveal_cooldown(now);
                    }
                } else {
                    state.leave_at = Some(now + state.hide_leave_delay);
                }
            }

            if state.requested_expanded
                && state.native_visible
                && !state.dragging
                && !state.resizing
            {
                if current_rect.is_none_or(|actual| !rects_close(actual, shown_rect)) {
                    state.layout_dirty = true;
                }
            }

            if state.layout_dirty && !state.dragging && !left_down {
                let target = sidebar_rect(
                    state.work_area,
                    state.edge,
                    state.thickness_logical,
                    state.edge_length_logical,
                    state.ui_scale,
                );
                if native_set_window_rect(&window, target).is_ok() {
                    state.managed_rect = Some(target);
                    state.layout_dirty = false;
                }
            }

            if state.requested_expanded {
                if !state.native_visible || state.raise_requested {
                    let target = sidebar_rect(
                        state.work_area,
                        state.edge,
                        state.thickness_logical,
                        state.edge_length_logical,
                        state.ui_scale,
                    );
                    match show_sidebar_window(&window, target, state.focus_requested) {
                        Ok(()) => {
                            state.managed_rect = Some(target);
                            state.native_visible = true;
                            state.visual_expanded = true;
                            state.raise_requested = false;
                        }
                        Err(error) => log::warn!("Failed to show Windows sidebar: {error}"),
                    }
                } else if !state.visual_expanded {
                    state.visual_expanded = true;
                }

                if state.focus_requested && state.native_visible {
                    let _ = window.set_focus();
                    state.focus_requested = false;
                }
            } else {
                state.focus_requested = false;
                state.raise_requested = false;
                state.visual_expanded = false;
                if state.native_visible {
                    native_hide(&window);
                    state.native_visible = false;
                }
            }

            let payload = state.payload();
            if state.last_emitted.as_ref() != Some(&payload) {
                state.last_emitted = Some(payload.clone());
                event_payload = Some(payload);
            }
        }

        if should_persist {
            persist_runtime_config(&app);
        }
        if let Some(payload) = event_payload {
            let _ = app.emit("sidebar_state_update", payload);
        }

        std::thread::sleep(Duration::from_millis(16));
    }
}

fn lock_runtime(runtime: &Arc<Mutex<DockRuntime>>) -> MutexGuard<'_, DockRuntime> {
    match runtime.lock() {
        Ok(guard) => guard,
        Err(poisoned) => {
            log::warn!("Sidebar dock state mutex poisoned, recovering");
            poisoned.into_inner()
        }
    }
}

fn persist_runtime_config(app: &AppHandle) {
    let Some(runtime) = DOCK_RUNTIME.get() else {
        return;
    };
    let (edge, pinned, thickness, edge_length, monitor_x, monitor_y) = {
        let state = lock_runtime(runtime);
        (
            state.edge.as_str().to_string(),
            state.pinned,
            state.thickness_logical,
            state.edge_length_logical,
            state.work_area.left,
            state.work_area.top,
        )
    };

    let mut config = config_store::read_config::<AppConfig>(app, "app_config.json");
    config.sidebar_edge = Some(edge);
    config.sidebar_pinned = Some(pinned);
    config.sidebar_width = Some(thickness.round());
    if let Some(edge_length) = edge_length {
        config.sidebar_length = Some(edge_length.round());
    }
    config.sidebar_monitor_x = Some(monitor_x);
    config.sidebar_monitor_y = Some(monitor_y);
    if let Err(err) = config_store::write_config(app, "app_config.json", &config) {
        log::warn!("Failed to persist sidebar dock state: {err}");
        return;
    }
    let _ = app.emit("app_config_update", config);
}

fn work_area_near_point(app: &AppHandle, point: POINT) -> Option<WorkArea> {
    let monitor_handle = unsafe { MonitorFromPoint(point, MONITOR_DEFAULTTONEAREST) };
    if monitor_handle.is_invalid() {
        return None;
    }

    let mut info = MONITORINFO {
        cbSize: std::mem::size_of::<MONITORINFO>() as u32,
        ..Default::default()
    };
    if !unsafe { GetMonitorInfoW(monitor_handle, &mut info).as_bool() } {
        return None;
    }

    let scale_factor = app
        .available_monitors()
        .ok()
        .and_then(|monitors| {
            monitors.into_iter().find_map(|monitor| {
                let position = monitor.position();
                let size = monitor.size();
                let contains = point.x >= position.x
                    && point.x < position.x + size.width as i32
                    && point.y >= position.y
                    && point.y < position.y + size.height as i32;
                contains.then_some(monitor.scale_factor())
            })
        })
        .unwrap_or(1.0);

    Some(WorkArea {
        left: info.rcWork.left,
        top: info.rcWork.top,
        right: info.rcWork.right,
        bottom: info.rcWork.bottom,
        scale_factor,
    })
}

fn sidebar_rect(
    area: WorkArea,
    edge: DockEdge,
    thickness_logical: f64,
    edge_length_logical: Option<f64>,
    ui_scale: f64,
) -> RectPx {
    let dpi_scale = area.scale_factor.max(0.5);
    let content_scale = dpi_scale * crate::ui_scale::sanitize(Some(ui_scale));
    let margin = (CROSS_AXIS_MARGIN_LOGICAL * dpi_scale).round() as i32;
    let max_thickness_px = if edge.is_vertical() {
        (area.width() as f64 * 0.82).round() as i32
    } else {
        (area.height() as f64 * 0.82).round() as i32
    }
    .max(1);
    let min_thickness_px = (MIN_THICKNESS_LOGICAL * content_scale).round() as i32;
    let requested_px = (thickness_logical * content_scale).round() as i32;
    let thickness = requested_px.clamp(min_thickness_px.min(max_thickness_px), max_thickness_px);

    if edge.is_vertical() {
        let height = resolve_edge_length_px(
            (area.height() - margin * 2).max(1),
            edge_length_logical,
            content_scale,
        );
        let top = area.top + (area.height() - height) / 2;
        return RectPx {
            left: if matches!(edge, DockEdge::Left) {
                area.left
            } else {
                area.right - thickness
            },
            top,
            width: thickness,
            height,
        };
    }

    let width = resolve_edge_length_px(
        (area.width() - margin * 2).max(1),
        edge_length_logical,
        content_scale,
    );
    let left = area.left + (area.width() - width) / 2;
    RectPx {
        left,
        top: if matches!(edge, DockEdge::Top) {
            area.top
        } else {
            area.bottom - thickness
        },
        width,
        height: thickness,
    }
}

fn resolve_edge_length_px(
    available: i32,
    edge_length_logical: Option<f64>,
    content_scale: f64,
) -> i32 {
    let available = available.max(1);
    let min_length = (MIN_EDGE_LENGTH_LOGICAL * content_scale).round() as i32;
    let requested = edge_length_logical
        .map(|length| (length * content_scale).round() as i32)
        .unwrap_or(available);
    requested.clamp(min_length.min(available), available)
}

fn edge_length_changed(current: Option<f64>, next: Option<f64>) -> bool {
    match (current, next) {
        (Some(current), Some(next)) => (current - next).abs() >= 1.0,
        (None, None) => false,
        _ => true,
    }
}

fn floating_drag_preview_rect(
    area: WorkArea,
    cursor: POINT,
    drag_offset: Option<POINT>,
    source: RectPx,
    ui_scale: f64,
) -> RectPx {
    let scale = area.scale_factor.max(0.5) * crate::ui_scale::sanitize(Some(ui_scale));
    let margin = (DRAG_PREVIEW_MARGIN_LOGICAL * area.scale_factor).round() as i32;
    let available_width = (area.width() - margin * 2).max(1);
    let available_height = (area.height() - margin * 2).max(1);
    let min_width = (DRAG_PREVIEW_MIN_WIDTH_LOGICAL * scale).round() as i32;
    let max_width = ((DRAG_PREVIEW_MAX_WIDTH_LOGICAL * scale).round() as i32)
        .min(available_width)
        .max(1);
    let min_height = (DRAG_PREVIEW_MIN_HEIGHT_LOGICAL * scale).round() as i32;
    let max_height = ((DRAG_PREVIEW_MAX_HEIGHT_LOGICAL * scale).round() as i32)
        .min(available_height)
        .max(1);
    let width = source.width.clamp(min_width.min(max_width), max_width);
    let height = source.height.clamp(min_height.min(max_height), max_height);
    let offset_x = drag_offset
        .map(|offset| offset.x.clamp(0, width.saturating_sub(1)))
        .unwrap_or(width / 2);
    let offset_y = drag_offset
        .map(|offset| offset.y.clamp(0, height.saturating_sub(1)))
        .unwrap_or(height / 2);
    let min_left = area.left + margin;
    let max_left = (area.right - margin - width).max(min_left);
    let min_top = area.top + margin;
    let max_top = (area.bottom - margin - height).max(min_top);

    RectPx {
        left: cursor.x.saturating_sub(offset_x).clamp(min_left, max_left),
        top: cursor.y.saturating_sub(offset_y).clamp(min_top, max_top),
        width,
        height,
    }
}

fn logical_thickness_for_rect(area: WorkArea, edge: DockEdge, rect: RectPx, ui_scale: f64) -> f64 {
    let physical = if edge.is_vertical() {
        rect.width
    } else {
        rect.height
    };
    let scale = area.scale_factor.max(0.5) * crate::ui_scale::sanitize(Some(ui_scale));
    physical.max(1) as f64 / scale
}

fn logical_edge_length_for_rect(
    area: WorkArea,
    edge: DockEdge,
    rect: RectPx,
    ui_scale: f64,
) -> f64 {
    let physical = if edge.is_vertical() {
        rect.height
    } else {
        rect.width
    };
    let scale = area.scale_factor.max(0.5) * crate::ui_scale::sanitize(Some(ui_scale));
    physical.max(1) as f64 / scale
}

fn cursor_in_edge_trigger(area: WorkArea, sidebar: RectPx, edge: DockEdge, point: POINT) -> bool {
    if !area.contains(point) {
        return false;
    }
    let trigger = (EDGE_TRIGGER_LOGICAL * area.scale_factor).round().max(2.0) as i32;
    let vertical_guard = ((EDGE_CORNER_GUARD_LOGICAL * area.scale_factor).round() as i32)
        .min(area.height() / 4)
        .max(0);
    let horizontal_guard = ((EDGE_CORNER_GUARD_LOGICAL * area.scale_factor).round() as i32)
        .min(area.width() / 4)
        .max(0);
    let vertical_start = sidebar.top.max(area.top + vertical_guard);
    let vertical_end = sidebar.bottom().min(area.bottom - vertical_guard);
    let horizontal_start = sidebar.left.max(area.left + horizontal_guard);
    let horizontal_end = sidebar.right().min(area.right - horizontal_guard);

    match edge {
        DockEdge::Left => {
            point.x < area.left + trigger && point.y >= vertical_start && point.y < vertical_end
        }
        DockEdge::Right => {
            point.x >= area.right - trigger && point.y >= vertical_start && point.y < vertical_end
        }
        DockEdge::Top => {
            point.y < area.top + trigger && point.x >= horizontal_start && point.x < horizontal_end
        }
        DockEdge::Bottom => {
            point.y >= area.bottom - trigger
                && point.x >= horizontal_start
                && point.x < horizontal_end
        }
    }
}

fn cursor_entered_edge_with_intent(
    area: WorkArea,
    sidebar: RectPx,
    edge: DockEdge,
    previous: POINT,
    current: POINT,
) -> bool {
    if !area.contains(previous)
        || !cursor_in_edge_trigger(area, sidebar, edge, current)
        || cursor_in_edge_trigger(area, sidebar, edge, previous)
    {
        return false;
    }

    edge_distance(area, edge, previous) > edge_distance(area, edge, current)
}

fn edge_distance(area: WorkArea, edge: DockEdge, point: POINT) -> i32 {
    match edge {
        DockEdge::Left => point.x - area.left,
        DockEdge::Top => point.y - area.top,
        DockEdge::Right => area.right - 1 - point.x,
        DockEdge::Bottom => area.bottom - 1 - point.y,
    }
}

fn nearest_edge(area: WorkArea, point: POINT) -> (DockEdge, i32) {
    let candidates = [
        (DockEdge::Left, (point.x - area.left).abs()),
        (DockEdge::Top, (point.y - area.top).abs()),
        (DockEdge::Right, (area.right - 1 - point.x).abs()),
        (DockEdge::Bottom, (area.bottom - 1 - point.y).abs()),
    ];
    candidates
        .into_iter()
        .min_by_key(|(_, distance)| *distance)
        .unwrap_or((DockEdge::Right, i32::MAX))
}

fn cursor_position() -> Option<POINT> {
    let mut point = POINT::default();
    unsafe { GetCursorPos(&mut point).is_ok() }.then_some(point)
}

fn is_left_button_down() -> bool {
    (unsafe { GetAsyncKeyState(VK_LBUTTON.0 as i32) }) < 0
}

fn is_other_pointer_button_down() -> bool {
    [VK_RBUTTON.0, VK_MBUTTON.0, VK_XBUTTON1.0, VK_XBUTTON2.0]
        .into_iter()
        .any(|key| (unsafe { GetAsyncKeyState(key as i32) }) < 0)
}

fn native_hwnd(window: &WebviewWindow) -> Result<HWND, String> {
    let raw = window.hwnd().map_err(|err| err.to_string())?;
    Ok(HWND(raw.0 as *mut _))
}

fn native_window_rect(window: &WebviewWindow) -> Option<RectPx> {
    let hwnd = native_hwnd(window).ok()?;
    let mut rect = RECT::default();
    unsafe { GetWindowRect(hwnd, &mut rect).is_ok() }.then_some(RectPx {
        left: rect.left,
        top: rect.top,
        width: (rect.right - rect.left).max(1),
        height: (rect.bottom - rect.top).max(1),
    })
}

fn rects_close(actual: RectPx, expected: RectPx) -> bool {
    (actual.left - expected.left).abs() <= 2
        && (actual.top - expected.top).abs() <= 2
        && (actual.width - expected.width).abs() <= 2
        && (actual.height - expected.height).abs() <= 2
}

fn native_is_visible(window: &WebviewWindow) -> bool {
    native_hwnd(window)
        .is_ok_and(|hwnd| unsafe { IsWindowVisible(hwnd).as_bool() })
}

fn pointer_inside_sidebar(window: &WebviewWindow, rect: RectPx, point: POINT) -> bool {
    if !rect.contains(point) {
        return false;
    }
    let Ok(hwnd) = native_hwnd(window) else {
        return false;
    };
    let hovered = unsafe { WindowFromPoint(point) };
    hovered == hwnd || unsafe { IsChild(hwnd, hovered).as_bool() }
}

fn native_set_window_rect(window: &WebviewWindow, rect: RectPx) -> Result<(), String> {
    let hwnd = native_hwnd(window)?;
    unsafe {
        SetWindowPos(
            hwnd,
            None,
            rect.left,
            rect.top,
            rect.width,
            rect.height,
            SWP_NOACTIVATE | SWP_NOZORDER,
        )
    }
    .map_err(|err| err.to_string())
}

fn show_sidebar_window(window: &WebviewWindow, rect: RectPx, focus: bool) -> Result<(), String> {
    // Tauri tracks visibility separately from Win32. Calling ShowWindow alone
    // leaves that state stale, so subsequent focus and show calls can fail.
    if !focus {
        window.set_focusable(false).map_err(|error| error.to_string())?;
    }
    let show_result = window.show().map_err(|error| error.to_string());
    if !focus {
        window.set_focusable(true).map_err(|error| error.to_string())?;
    }
    show_result?;

    let hwnd = native_hwnd(window)?;
    unsafe {
        SetWindowPos(
            hwnd,
            Some(HWND_TOPMOST),
            rect.left,
            rect.top,
            rect.width,
            rect.height,
            SWP_NOACTIVATE | SWP_SHOWWINDOW,
        )
    }
    .map_err(|error| error.to_string())?;
    if native_is_visible(window) {
        Ok(())
    } else {
        Err("Windows did not make the sidebar visible".into())
    }
}

fn native_hide(window: &WebviewWindow) {
    if let Err(error) = window.hide() {
        log::warn!("Failed to hide Windows sidebar: {error}");
    }
    if let Ok(hwnd) = native_hwnd(window) {
        unsafe {
            let _ = ShowWindow(hwnd, SW_HIDE);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn area() -> WorkArea {
        WorkArea {
            left: 0,
            top: 0,
            right: 1920,
            bottom: 1040,
            scale_factor: 1.0,
        }
    }

    #[test]
    fn vertical_edges_use_sidebar_thickness_and_work_height() {
        let right = sidebar_rect(area(), DockEdge::Right, 420.0, None, 1.0);
        assert_eq!(right.left, 1500);
        assert_eq!(right.width, 420);
        assert_eq!(right.top, 6);
        assert_eq!(right.height, 1028);
    }

    #[test]
    fn horizontal_edges_rotate_sidebar_into_a_drawer() {
        let bottom = sidebar_rect(area(), DockEdge::Bottom, 420.0, None, 1.0);
        assert_eq!(bottom.left, 6);
        assert_eq!(bottom.width, 1908);
        assert_eq!(bottom.top, 620);
        assert_eq!(bottom.height, 420);
    }

    #[test]
    fn trigger_only_matches_the_docked_edge() {
        let right = sidebar_rect(area(), DockEdge::Right, 420.0, None, 1.0);
        assert!(cursor_in_edge_trigger(
            area(),
            right,
            DockEdge::Right,
            POINT { x: 1919, y: 500 }
        ));
        assert!(!cursor_in_edge_trigger(
            area(),
            right,
            DockEdge::Right,
            POINT { x: 1500, y: 500 }
        ));
        assert!(!cursor_in_edge_trigger(
            area(),
            right,
            DockEdge::Right,
            POINT { x: 1916, y: 500 }
        ));
    }

    #[test]
    fn trigger_avoids_screen_corners() {
        let right = sidebar_rect(area(), DockEdge::Right, 420.0, None, 1.0);
        assert!(!cursor_in_edge_trigger(
            area(),
            right,
            DockEdge::Right,
            POINT { x: 1919, y: 20 }
        ));
        assert!(cursor_in_edge_trigger(
            area(),
            right,
            DockEdge::Right,
            POINT { x: 1919, y: 100 }
        ));
    }

    #[test]
    fn reveal_intent_requires_approaching_from_inside_the_screen() {
        let right = sidebar_rect(area(), DockEdge::Right, 420.0, None, 1.0);
        assert!(cursor_entered_edge_with_intent(
            area(),
            right,
            DockEdge::Right,
            POINT { x: 1900, y: 500 },
            POINT { x: 1919, y: 500 }
        ));
        assert!(!cursor_entered_edge_with_intent(
            area(),
            right,
            DockEdge::Right,
            POINT { x: 1919, y: 20 },
            POINT { x: 1919, y: 100 }
        ));
        assert!(!cursor_entered_edge_with_intent(
            area(),
            right,
            DockEdge::Right,
            POINT { x: 1920, y: 500 },
            POINT { x: 1919, y: 500 }
        ));
    }

    #[test]
    fn reveal_intent_waits_for_a_complete_dwell() {
        let started_at = Instant::now();
        let dwell = Duration::from_millis(500);
        let mut intent = EdgeRevealIntent::default();

        assert!(!intent.update(started_at, true, true, false, dwell));
        assert!(!intent.update(
            started_at + dwell - Duration::from_millis(1),
            true,
            false,
            false,
            dwell
        ));
        assert!(intent.update(started_at + dwell, true, false, false, dwell));
    }

    #[test]
    fn pointer_interaction_cancels_the_current_reveal_attempt() {
        let started_at = Instant::now();
        let dwell = Duration::from_millis(500);
        let mut intent = EdgeRevealIntent::default();

        assert!(!intent.update(started_at, true, true, false, dwell));
        assert!(!intent.update(
            started_at + Duration::from_millis(100),
            true,
            false,
            true,
            dwell
        ));
        assert!(!intent.update(
            started_at + dwell + Duration::from_millis(100),
            true,
            false,
            false,
            dwell
        ));
    }

    #[test]
    fn default_sensitivity_matches_legacy_timings() {
        let (dwell, cooldown) = reveal_timings(DEFAULT_REVEAL_SENSITIVITY);
        assert_eq!(dwell, Duration::from_millis(500));
        assert_eq!(cooldown, Duration::from_millis(900));
        assert_eq!(
            hide_leave_delay(DEFAULT_HIDE_SENSITIVITY),
            Duration::from_millis(260)
        );
    }

    #[test]
    fn user_scale_changes_sidebar_thickness_without_scaling_screen_margin() {
        let right = sidebar_rect(area(), DockEdge::Right, 420.0, None, 1.25);
        assert_eq!(right.left, 1395);
        assert_eq!(right.width, 525);
        assert_eq!(right.top, 6);
        assert_eq!(right.height, 1028);
        assert_eq!(
            logical_thickness_for_rect(area(), DockEdge::Right, right, 1.25),
            420.0
        );
    }

    #[test]
    fn vertical_edges_support_a_centered_adjustable_height() {
        let right = sidebar_rect(area(), DockEdge::Right, 420.0, Some(600.0), 1.0);
        assert_eq!(right.left, 1500);
        assert_eq!(right.top, 220);
        assert_eq!(right.width, 420);
        assert_eq!(right.height, 600);
        assert_eq!(
            logical_edge_length_for_rect(area(), DockEdge::Right, right, 1.0),
            600.0
        );
    }

    #[test]
    fn horizontal_edges_support_a_centered_adjustable_width() {
        let top = sidebar_rect(area(), DockEdge::Top, 420.0, Some(800.0), 1.0);
        assert_eq!(top.left, 560);
        assert_eq!(top.top, 0);
        assert_eq!(top.width, 800);
        assert_eq!(top.height, 420);
        assert_eq!(
            logical_edge_length_for_rect(area(), DockEdge::Top, top, 1.0),
            800.0
        );
    }

    #[test]
    fn default_sidebar_is_large_and_nearly_fills_the_docked_edge() {
        let right = sidebar_rect(
            area(),
            DockEdge::Right,
            DEFAULT_THICKNESS_LOGICAL,
            None,
            1.0,
        );
        let top = sidebar_rect(area(), DockEdge::Top, DEFAULT_THICKNESS_LOGICAL, None, 1.0);

        assert_eq!(right.width, 320);
        assert_eq!(right.height, 1028);
        assert_eq!(top.width, 1908);
        assert_eq!(top.height, 320);
    }

    #[test]
    fn floating_drag_preview_follows_cursor_and_stays_inside_work_area() {
        let preview = floating_drag_preview_rect(
            area(),
            POINT { x: 960, y: 520 },
            Some(POINT { x: 210, y: 20 }),
            sidebar_rect(area(), DockEdge::Right, 420.0, None, 1.0),
            1.0,
        );
        assert_eq!(preview.width, 420);
        assert_eq!(preview.height, 680);
        assert_eq!(preview.left, 750);
        assert_eq!(preview.top, 342);
        assert!(preview.left >= area().left);
        assert!(preview.right() <= area().right);
        assert!(preview.top >= area().top);
        assert!(preview.bottom() <= area().bottom);
    }
}
