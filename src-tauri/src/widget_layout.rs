use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::{
    AppHandle, Manager, Monitor, PhysicalPosition, PhysicalSize, Position, Size, WebviewWindow,
};

use crate::{config_store, models::AppConfig, ui_scale};

const WIDGET_LAYOUTS_FILE: &str = "widget_layouts.json";
const SAVE_DEBOUNCE_MS: u64 = 300;
// Applying a saved layout and changing a widget's parent both emit native
// move/resize events. Keep those events out of the user-layout debounce so a
// transient DPI-adjusted size cannot overwrite the normalized layout.
// Must cover the longest first-run desktop-lock stagger in the frontend
// (quota at 1900ms) plus SetParent/DPI settle time.
const PROGRAMMATIC_LAYOUT_SETTLE_MS: u64 = 2500;
const MONITOR_POLL_INTERVAL_MS: u64 = 2000;
const MIN_WIDGET_WIDTH: u32 = 220;
const MIN_WIDGET_HEIGHT: u32 = 180;

// First-run target sizes in logical CSS pixels (before OS DPI / UI scale).
const DEFAULT_TARGET_WIDTH_LOGICAL: f64 = 400.0;
const DEFAULT_TARGET_HEIGHT_TALL_LOGICAL: f64 = 460.0;
const DEFAULT_TARGET_HEIGHT_SHORT_LOGICAL: f64 = 340.0;
const MACOS_TARGET_HEIGHT_SHORT_LOGICAL: f64 = 260.0;
const DEFAULT_MARGIN_X_FRAC: f64 = 0.018;
const DEFAULT_MARGIN_Y_FRAC: f64 = 0.028;
const DEFAULT_COLUMN_GAP_FRAC: f64 = 0.014;
const DEFAULT_ROW_GAP_FRAC: f64 = 0.018;
const DEFAULT_RIGHT_MARGIN_FRAC: f64 = 0.02;
const DEFAULT_BOTTOM_MARGIN_FRAC: f64 = 0.02;

pub const TRACKED_WIDGET_IDS: [&str; 4] = [
    "widget-gpu-default",
    "widget-deadlines-default",
    "widget-arxiv-default",
    "widget-quota-default",
];

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct NormalizedWidgetLayout {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct WidgetLayoutStore {
    #[serde(default)]
    pub monitors: HashMap<String, HashMap<String, NormalizedWidgetLayout>>,
    #[serde(default)]
    pub active_monitor_by_widget: HashMap<String, String>,
}

#[derive(Default)]
pub struct WidgetLayoutSaveState {
    pub pending: Mutex<HashMap<String, tauri::async_runtime::JoinHandle<()>>>,
    pub suppress_events_until: Mutex<HashMap<String, Instant>>,
}

#[derive(Debug, Clone, Copy)]
struct MonitorWorkArea {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

pub fn is_tracked_widget(label: &str) -> bool {
    TRACKED_WIDGET_IDS.contains(&label)
}

pub fn spawn_monitor_watchdog(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut last_signature = monitor_signature(&app).unwrap_or_default();
        loop {
            tokio::time::sleep(Duration::from_millis(MONITOR_POLL_INTERVAL_MS)).await;
            let next_signature = match monitor_signature(&app) {
                Ok(signature) => signature,
                Err(err) => {
                    log::warn!("Monitor signature refresh failed: {}", err);
                    continue;
                }
            };
            if next_signature != last_signature {
                log::info!(
                    "Monitor topology changed from '{}' to '{}'",
                    last_signature,
                    next_signature
                );
                if let Err(err) = restore_widgets_after_monitor_change(&app).await {
                    log::warn!(
                        "Failed to restore widget layouts after monitor change: {}",
                        err
                    );
                }
                last_signature = next_signature;
            }
        }
    });
}

/// Ignore native move/resize notifications caused by an internal layout or
/// desktop-parent transition. Existing debounced writes are cancelled as well,
/// because they can otherwise run after the transition and save its temporary
/// dimensions as a user resize.
pub fn suppress_layout_event_persist(app: &AppHandle, label: &str) {
    if !is_tracked_widget(label) {
        return;
    }

    let state = app.state::<WidgetLayoutSaveState>();
    let until = Instant::now() + Duration::from_millis(PROGRAMMATIC_LAYOUT_SETTLE_MS);
    {
        let mut suppressed = match state.suppress_events_until.lock() {
            Ok(guard) => guard,
            Err(poisoned) => {
                log::warn!("Widget layout suppression mutex poisoned, recovering");
                poisoned.into_inner()
            }
        };
        let entry = suppressed.entry(label.to_string()).or_insert(until);
        if *entry < until {
            *entry = until;
        }
    }

    let mut pending = match state.pending.lock() {
        Ok(guard) => guard,
        Err(poisoned) => {
            log::warn!("WidgetLayoutSaveState mutex poisoned, recovering");
            poisoned.into_inner()
        }
    };
    if let Some(handle) = pending.remove(label) {
        handle.abort();
    }
}

fn layout_event_persist_is_suppressed(app: &AppHandle, label: &str) -> bool {
    let state = app.state::<WidgetLayoutSaveState>();
    let mut suppressed = match state.suppress_events_until.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    let now = Instant::now();
    match suppressed.get(label).copied() {
        Some(until) if until > now => true,
        Some(_) => {
            suppressed.remove(label);
            false
        }
        None => false,
    }
}

pub fn schedule_layout_persist(app: AppHandle, label: String) {
    if !is_tracked_widget(&label)
        || crate::desktop::is_desktop_mode(&app, &label)
        || layout_event_persist_is_suppressed(&app, &label)
    {
        return;
    }

    let state = app.state::<WidgetLayoutSaveState>();
    let mut pending = match state.pending.lock() {
        Ok(guard) => guard,
        Err(poisoned) => {
            log::warn!("WidgetLayoutSaveState mutex poisoned, recovering");
            poisoned.into_inner()
        }
    };

    if let Some(handle) = pending.remove(&label) {
        handle.abort();
    }

    let app_clone = app.clone();
    let label_clone = label.clone();
    let handle = tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(SAVE_DEBOUNCE_MS)).await;
        if !crate::desktop::is_desktop_mode(&app_clone, &label_clone)
            && !layout_event_persist_is_suppressed(&app_clone, &label_clone)
        {
            if let Some(win) = app_clone.get_webview_window(&label_clone) {
                if let Err(err) = persist_layout_for_window(&app_clone, &win, &label_clone) {
                    log::warn!(
                        "Failed to persist widget layout for {}: {}",
                        label_clone,
                        err
                    );
                }
            }
        }
        let state = app_clone.state::<WidgetLayoutSaveState>();
        let mut pending = match state.pending.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        pending.remove(&label_clone);
    });

    pending.insert(label, handle);
}

pub fn persist_layout_now(app: &AppHandle, label: &str) -> Result<(), String> {
    if !is_tracked_widget(label) || crate::desktop::is_desktop_mode(app, label) {
        return Ok(());
    }
    if let Some(win) = app.get_webview_window(label) {
        persist_layout_for_window(app, &win, label)?;
    }
    Ok(())
}

/// Restores zoom and physical bounds while preserving the widget's current
/// desktop-embedded state. A desktop child window must be made top-level for
/// the update, otherwise Windows may apply the parent DPI scale a second time.
pub fn restore_widget_layout_preserving_desktop_mode(
    app: &AppHandle,
    label: &str,
) -> Result<(), String> {
    let Some(win) = app.get_webview_window(label) else {
        return Ok(());
    };
    with_top_level_widget_layout(app, label, || {
        ensure_widget_layout_for_window(app, &win, label)
    })
}

pub fn persist_open_widget_layouts_at_scale(app: &AppHandle, scale: f64) {
    for label in TRACKED_WIDGET_IDS {
        let Some(win) = app.get_webview_window(label) else {
            continue;
        };
        if let Err(err) = with_top_level_widget_layout(app, label, || {
            persist_layout_for_window_at_scale(app, &win, label, scale)
        }) {
            log::warn!(
                "Failed to preserve widget layout for {} before scaling: {}",
                label,
                err
            );
        }
    }
}

pub fn apply_scale_to_open_widgets(app: &AppHandle, scale: f64) {
    for label in TRACKED_WIDGET_IDS {
        let Some(win) = app.get_webview_window(label) else {
            continue;
        };
        if let Err(err) = with_top_level_widget_layout(app, label, || {
            ensure_widget_layout_for_window_at_scale(app, &win, label, scale)
        }) {
            log::warn!("Failed to apply UI scale to {}: {}", label, err);
        }
    }
}

/// Desktop-locked widgets are Win32 child windows. Apply geometry updates only
/// while they are top-level windows, otherwise Windows can apply the desktop
/// parent's DPI transform a second time and make a scale change visibly larger.
fn with_top_level_widget_layout<T>(
    app: &AppHandle,
    label: &str,
    operation: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    suppress_layout_event_persist(app, label);
    let was_desktop_embedded = crate::desktop::is_desktop_mode(app, label);
    if was_desktop_embedded {
        crate::desktop::set_desktop_mode_now(app, label, false)?;
    }

    let result = operation();

    if was_desktop_embedded {
        if let Err(err) = crate::desktop::set_desktop_mode_now(app, label, true) {
            log::warn!(
                "Failed to restore desktop mode for {} after layout update: {}",
                label,
                err
            );
        }
    }

    result
}

pub fn ensure_widget_layout_for_window(
    app: &AppHandle,
    win: &WebviewWindow,
    label: &str,
) -> Result<(), String> {
    let config = config_store::read_config::<AppConfig>(app, "app_config.json");
    ensure_widget_layout_for_window_at_scale(app, win, label, ui_scale::from_config(&config))
}

fn ensure_widget_layout_for_window_at_scale(
    app: &AppHandle,
    win: &WebviewWindow,
    label: &str,
    scale: f64,
) -> Result<(), String> {
    if !is_tracked_widget(label) {
        return Ok(());
    }

    suppress_layout_event_persist(app, label);

    let mut store = read_layout_store(app);
    let active_key = store.active_monitor_by_widget.get(label).cloned();
    let target_monitor = match active_key
        .as_deref()
        .and_then(|key| find_monitor_by_key(app, key).ok().flatten())
    {
        Some(monitor) => monitor,
        None => resolve_window_monitor(app, win)?
            .or_else(|| preferred_monitor(app))
            .ok_or_else(|| "No available monitor found for widget layout".to_string())?,
    };

    let target_key = monitor_key(&target_monitor);
    let source_layout = active_key
        .as_deref()
        .and_then(|key| store.monitors.get(key))
        .and_then(|widgets| widgets.get(label))
        .copied();
    let target_layout = store
        .monitors
        .get(&target_key)
        .and_then(|widgets| widgets.get(label))
        .copied();
    let layout = source_layout
        .or(target_layout)
        .or_else(|| default_layout_for_widget_on_monitor(label, &target_monitor, scale))
        .ok_or_else(|| format!("No default widget layout for {}", label))?;

    ui_scale::apply_to_window(win, scale)?;
    apply_layout_to_window(win, &target_monitor, layout, scale)?;

    // Persist the post-clamp geometry so stored fractions match what is on screen
    // (UI scale / min-size clamps can otherwise drift from the ideal default).
    let (applied_position, applied_size) = normalized_to_physical(layout, &target_monitor, scale);
    let applied_layout =
        physical_to_normalized(applied_position, applied_size, &target_monitor, scale);

    store
        .monitors
        .entry(target_key.clone())
        .or_default()
        .insert(label.to_string(), applied_layout);
    store
        .active_monitor_by_widget
        .insert(label.to_string(), target_key.clone());
    write_layout_store(app, &store)?;

    log::info!(
        "Applied widget layout for {} on monitor '{}'",
        label,
        target_key
    );
    Ok(())
}

async fn restore_widgets_after_monitor_change(app: &AppHandle) -> Result<(), String> {
    let store = read_layout_store(app);
    if store.active_monitor_by_widget.is_empty() {
        return Ok(());
    }

    let available_keys = available_monitor_keys(app)?;
    for label in TRACKED_WIDGET_IDS {
        let Some(source_key) = store.active_monitor_by_widget.get(label) else {
            continue;
        };
        if available_keys.contains(source_key) {
            continue;
        }
        if app.get_webview_window(label).is_none() {
            continue;
        }

        restore_widget_layout_preserving_desktop_mode(app, label)?;
    }

    Ok(())
}

fn persist_layout_for_window(
    app: &AppHandle,
    win: &WebviewWindow,
    label: &str,
) -> Result<(), String> {
    let config = config_store::read_config::<AppConfig>(app, "app_config.json");
    persist_layout_for_window_at_scale(app, win, label, ui_scale::from_config(&config))
}

fn persist_layout_for_window_at_scale(
    app: &AppHandle,
    win: &WebviewWindow,
    label: &str,
    scale: f64,
) -> Result<(), String> {
    let Some(monitor) = resolve_window_monitor(app, win)? else {
        return Ok(());
    };

    let position = win.outer_position().map_err(|e| e.to_string())?;
    let size = win.inner_size().map_err(|e| e.to_string())?;
    if size.width == 0 || size.height == 0 {
        return Ok(());
    }

    let key = monitor_key(&monitor);
    let mut store = read_layout_store(app);
    let stored_layout = store
        .monitors
        .get(&key)
        .and_then(|widgets| widgets.get(label))
        .copied()
        .or_else(|| {
            store
                .active_monitor_by_widget
                .get(label)
                .and_then(|active_key| store.monitors.get(active_key))
                .and_then(|widgets| widgets.get(label))
                .copied()
        });

    if let Some(stored_layout) = stored_layout {
        let (expected_position, expected_size) =
            normalized_to_physical(stored_layout, &monitor, scale);
        if geometry_matches(position, size, expected_position, expected_size) {
            return Ok(());
        }
    }

    let layout = physical_to_normalized(position, size, &monitor, scale);
    store
        .monitors
        .entry(key.clone())
        .or_default()
        .insert(label.to_string(), layout);
    store
        .active_monitor_by_widget
        .insert(label.to_string(), key.clone());
    write_layout_store(app, &store)?;

    log::debug!("Persisted widget layout for {} on '{}'", label, key);
    Ok(())
}

fn apply_layout_to_window(
    win: &WebviewWindow,
    monitor: &Monitor,
    layout: NormalizedWidgetLayout,
    scale: f64,
) -> Result<(), String> {
    let (position, size) = normalized_to_physical(layout, monitor, scale);
    win.set_size(Size::Physical(size))
        .map_err(|e| e.to_string())?;
    win.set_position(Position::Physical(position))
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn default_layout_for_widget_on_monitor(
    label: &str,
    monitor: &Monitor,
    scale: f64,
) -> Option<NormalizedWidgetLayout> {
    default_layout_for_widget(
        label,
        monitor_work_area(monitor),
        monitor.scale_factor(),
        scale,
    )
}

/// First-run desktop layout: left-aligned 2×2 grid sized from logical pixel
/// targets, capped so UI scale cannot push the four panels outside the work area.
fn default_layout_for_widget(
    label: &str,
    area: MonitorWorkArea,
    dpi: f64,
    scale: f64,
) -> Option<NormalizedWidgetLayout> {
    let dpi = if dpi.is_finite() && dpi > 0.0 {
        dpi
    } else {
        1.0
    };
    let scale = ui_scale::sanitize(Some(scale));
    let area_w = area.width.max(1) as f64;
    let area_h = area.height.max(1) as f64;

    let left = DEFAULT_MARGIN_X_FRAC * area_w;
    let top = DEFAULT_MARGIN_Y_FRAC * area_h;
    let column_gap = DEFAULT_COLUMN_GAP_FRAC * area_w;
    let row_gap = DEFAULT_ROW_GAP_FRAC * area_h;
    let right_margin = DEFAULT_RIGHT_MARGIN_FRAC * area_w;
    let bottom_margin = DEFAULT_BOTTOM_MARGIN_FRAC * area_h;

    let min_w = (MIN_WIDGET_WIDTH as f64 * scale).max(1.0);
    let min_h = (MIN_WIDGET_HEIGHT as f64 * scale).max(1.0);

    let max_cell_w = ((area_w - left - right_margin - column_gap) / 2.0).max(min_w);
    let available_h = (area_h - top - bottom_margin - row_gap).max(min_h * 2.0);

    let want_w = (DEFAULT_TARGET_WIDTH_LOGICAL * dpi * scale)
        .min(max_cell_w)
        .max(min_w);
    let mut tall_h = DEFAULT_TARGET_HEIGHT_TALL_LOGICAL * dpi * scale;
    let mut short_h = if cfg!(target_os = "macos") {
        MACOS_TARGET_HEIGHT_SHORT_LOGICAL
    } else {
        DEFAULT_TARGET_HEIGHT_SHORT_LOGICAL
    } * dpi
        * scale;
    let row_total = tall_h + short_h;
    if row_total > available_h && row_total > 0.0 {
        let fit = available_h / row_total;
        tall_h *= fit;
        short_h *= fit;
    }
    tall_h = tall_h.clamp(min_h, available_h);
    short_h = short_h.clamp(min_h, (available_h - tall_h).max(min_h));

    let right = left + want_w + column_gap;
    let bottom = top + tall_h + row_gap;

    let (x, y, height) = match label {
        "widget-gpu-default" => (left, top, tall_h),
        "widget-arxiv-default" => (right, top, tall_h),
        "widget-quota-default" => (left, bottom, short_h),
        "widget-deadlines-default" => (right, bottom, short_h),
        _ => return None,
    };

    Some(sanitize_layout(NormalizedWidgetLayout {
        x: x / area_w,
        y: y / area_h,
        width: want_w / scale / area_w,
        height: height / scale / area_h,
    }))
}

fn physical_to_normalized(
    position: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
    monitor: &Monitor,
    scale: f64,
) -> NormalizedWidgetLayout {
    let area = monitor_work_area(monitor);
    let width = area.width.max(1) as f64;
    let height = area.height.max(1) as f64;
    let scale = ui_scale::sanitize(Some(scale));

    sanitize_layout(NormalizedWidgetLayout {
        x: (position.x - area.x) as f64 / width,
        y: (position.y - area.y) as f64 / height,
        width: size.width as f64 / scale / width,
        height: size.height as f64 / scale / height,
    })
}

fn normalized_to_physical(
    layout: NormalizedWidgetLayout,
    monitor: &Monitor,
    scale: f64,
) -> (PhysicalPosition<i32>, PhysicalSize<u32>) {
    normalized_to_physical_in_area(layout, monitor_work_area(monitor), scale)
}

fn normalized_to_physical_in_area(
    layout: NormalizedWidgetLayout,
    area: MonitorWorkArea,
    scale: f64,
) -> (PhysicalPosition<i32>, PhysicalSize<u32>) {
    let layout = sanitize_layout(layout);
    let scale = ui_scale::sanitize(Some(scale));
    let min_width = ((MIN_WIDGET_WIDTH as f64 * scale).round() as u32).max(1);
    let min_height = ((MIN_WIDGET_HEIGHT as f64 * scale).round() as u32).max(1);

    let width = ((layout.width * area.width as f64 * scale).round() as u32)
        .max(min_width)
        .min(area.width.max(1));
    let height = ((layout.height * area.height as f64 * scale).round() as u32)
        .max(min_height)
        .min(area.height.max(1));

    let desired_x = area.x + (layout.x * area.width as f64).round() as i32;
    let desired_y = area.y + (layout.y * area.height as f64).round() as i32;
    let max_x = area.x + area.width as i32 - width as i32;
    let max_y = area.y + area.height as i32 - height as i32;

    let x = desired_x.clamp(area.x, max_x.max(area.x));
    let y = desired_y.clamp(area.y, max_y.max(area.y));

    (
        PhysicalPosition::new(x, y),
        PhysicalSize::new(width, height),
    )
}

fn geometry_matches(
    actual_position: PhysicalPosition<i32>,
    actual_size: PhysicalSize<u32>,
    expected_position: PhysicalPosition<i32>,
    expected_size: PhysicalSize<u32>,
) -> bool {
    actual_position.x.abs_diff(expected_position.x) <= 2
        && actual_position.y.abs_diff(expected_position.y) <= 2
        && actual_size.width.abs_diff(expected_size.width) <= 2
        && actual_size.height.abs_diff(expected_size.height) <= 2
}

fn sanitize_layout(layout: NormalizedWidgetLayout) -> NormalizedWidgetLayout {
    let width = layout.width.clamp(0.08, 1.0);
    let height = layout.height.clamp(0.08, 1.0);
    let x = layout.x.clamp(0.0, (1.0 - width).max(0.0));
    let y = layout.y.clamp(0.0, (1.0 - height).max(0.0));

    NormalizedWidgetLayout {
        x,
        y,
        width,
        height,
    }
}

fn monitor_signature(app: &AppHandle) -> Result<String, String> {
    let mut monitors = app.available_monitors().map_err(|e| e.to_string())?;
    monitors.sort_by(|a, b| monitor_key(a).cmp(&monitor_key(b)));
    Ok(monitors
        .into_iter()
        .map(|monitor| {
            let key = monitor_key(&monitor);
            let area = monitor_work_area(&monitor);
            format!(
                "{}@{},{}:{}x{}",
                key, area.x, area.y, area.width, area.height
            )
        })
        .collect::<Vec<_>>()
        .join("|"))
}

fn available_monitor_keys(app: &AppHandle) -> Result<HashSet<String>, String> {
    Ok(app
        .available_monitors()
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|monitor| monitor_key(&monitor))
        .collect())
}

fn preferred_monitor(app: &AppHandle) -> Option<Monitor> {
    if let Some(main) = app.get_webview_window("main") {
        if let Ok(Some(monitor)) = main.current_monitor() {
            return Some(monitor);
        }
    }
    if let Ok(Some(primary)) = app.primary_monitor() {
        return Some(primary);
    }
    app.available_monitors()
        .ok()
        .and_then(|monitors| monitors.into_iter().next())
}

fn resolve_window_monitor(app: &AppHandle, win: &WebviewWindow) -> Result<Option<Monitor>, String> {
    if let Ok(Some(monitor)) = win.current_monitor() {
        return Ok(Some(monitor));
    }

    let position = win.outer_position().map_err(|e| e.to_string())?;
    let size = win.inner_size().map_err(|e| e.to_string())?;
    let center_x = position.x + (size.width as i32 / 2);
    let center_y = position.y + (size.height as i32 / 2);

    for monitor in app.available_monitors().map_err(|e| e.to_string())? {
        let origin = monitor.position();
        let monitor_size = monitor.size();
        if center_x >= origin.x
            && center_x < origin.x + monitor_size.width as i32
            && center_y >= origin.y
            && center_y < origin.y + monitor_size.height as i32
        {
            return Ok(Some(monitor));
        }
    }

    Ok(None)
}

fn find_monitor_by_key(app: &AppHandle, key: &str) -> Result<Option<Monitor>, String> {
    for monitor in app.available_monitors().map_err(|e| e.to_string())? {
        if monitor_key(&monitor) == key {
            return Ok(Some(monitor));
        }
    }
    Ok(None)
}

fn monitor_key(monitor: &Monitor) -> String {
    if let Some(name) = monitor.name() {
        let trimmed = name.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }

    let area = monitor_work_area(monitor);
    format!(
        "display@{},{}:{}x{}",
        area.x, area.y, area.width, area.height
    )
}

fn monitor_work_area(monitor: &Monitor) -> MonitorWorkArea {
    let area = monitor.work_area();
    MonitorWorkArea {
        x: area.position.x,
        y: area.position.y,
        width: area.size.width.max(1),
        height: area.size.height.max(1),
    }
}

fn read_layout_store(app: &AppHandle) -> WidgetLayoutStore {
    config_store::read_config::<WidgetLayoutStore>(app, WIDGET_LAYOUTS_FILE)
}

fn write_layout_store(app: &AppHandle, store: &WidgetLayoutStore) -> Result<(), String> {
    config_store::write_config(app, WIDGET_LAYOUTS_FILE, store)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_area(width: u32, height: u32) -> MonitorWorkArea {
        MonitorWorkArea {
            x: 0,
            y: 0,
            width,
            height,
        }
    }

    fn layouts_for(area: MonitorWorkArea, dpi: f64, scale: f64) -> [NormalizedWidgetLayout; 4] {
        [
            default_layout_for_widget("widget-gpu-default", area, dpi, scale).unwrap(),
            default_layout_for_widget("widget-arxiv-default", area, dpi, scale).unwrap(),
            default_layout_for_widget("widget-quota-default", area, dpi, scale).unwrap(),
            default_layout_for_widget("widget-deadlines-default", area, dpi, scale).unwrap(),
        ]
    }

    fn physical_rect(
        layout: NormalizedWidgetLayout,
        area: MonitorWorkArea,
        scale: f64,
    ) -> (i32, i32, u32, u32) {
        let (pos, size) = normalized_to_physical_in_area(layout, area, scale);
        (pos.x, pos.y, size.width, size.height)
    }

    fn rects_overlap(a: (i32, i32, u32, u32), b: (i32, i32, u32, u32)) -> bool {
        let (ax, ay, aw, ah) = a;
        let (bx, by, bw, bh) = b;
        ax < bx + bw as i32 && bx < ax + aw as i32 && ay < by + bh as i32 && by < ay + ah as i32
    }

    #[test]
    fn default_layout_is_a_left_aligned_two_by_two_grid() {
        let area = sample_area(1920, 1040);
        let [gpu, arxiv, quota, deadlines] = layouts_for(area, 1.0, 1.0);

        assert_eq!(gpu.x, quota.x);
        assert_eq!(arxiv.x, deadlines.x);
        assert!(gpu.x < arxiv.x);
        assert_eq!(gpu.y, arxiv.y);
        assert_eq!(quota.y, deadlines.y);
        assert!(gpu.y < quota.y);

        assert_eq!(gpu.width, arxiv.width);
        assert_eq!(quota.width, deadlines.width);
        assert_eq!(gpu.width, quota.width);
        assert_eq!(gpu.height, arxiv.height);
        assert_eq!(quota.height, deadlines.height);
        assert!(gpu.height > quota.height);
    }

    #[test]
    fn default_layout_at_elevated_ui_scale_does_not_overlap() {
        let area = sample_area(1920, 1040);
        let scale = 1.5;
        let layouts = layouts_for(area, 1.0, scale);
        let rects: Vec<_> = layouts
            .iter()
            .map(|layout| physical_rect(*layout, area, scale))
            .collect();

        for rect in &rects {
            let (x, y, w, h) = *rect;
            assert!(x >= area.x);
            assert!(y >= area.y);
            assert!(x + w as i32 <= area.x + area.width as i32);
            assert!(y + h as i32 <= area.y + area.height as i32);
        }

        for i in 0..rects.len() {
            for j in (i + 1)..rects.len() {
                assert!(
                    !rects_overlap(rects[i], rects[j]),
                    "widgets {i} and {j} overlap at scale {scale}: {:?} vs {:?}",
                    rects[i],
                    rects[j]
                );
            }
        }
    }

    #[test]
    fn default_layout_shrinks_to_fit_small_work_areas() {
        let area = sample_area(1280, 720);
        let scale = 1.25;
        let layouts = layouts_for(area, 1.0, scale);
        let rects: Vec<_> = layouts
            .iter()
            .map(|layout| physical_rect(*layout, area, scale))
            .collect();

        for rect in &rects {
            let (x, y, w, h) = *rect;
            assert!(x + w as i32 <= area.x + area.width as i32);
            assert!(y + h as i32 <= area.y + area.height as i32);
            assert!(w >= ((MIN_WIDGET_WIDTH as f64 * scale).round() as u32).min(area.width));
            assert!(h >= ((MIN_WIDGET_HEIGHT as f64 * scale).round() as u32).min(area.height));
        }

        for i in 0..rects.len() {
            for j in (i + 1)..rects.len() {
                assert!(!rects_overlap(rects[i], rects[j]));
            }
        }
    }

    #[test]
    fn default_layout_targets_grow_with_ui_scale_when_space_allows() {
        let area = sample_area(2560, 1440);
        let at_1 = physical_rect(
            default_layout_for_widget("widget-gpu-default", area, 1.0, 1.0).unwrap(),
            area,
            1.0,
        );
        let at_125 = physical_rect(
            default_layout_for_widget("widget-gpu-default", area, 1.0, 1.25).unwrap(),
            area,
            1.25,
        );

        assert!(at_125.2 > at_1.2);
        assert!(at_125.3 > at_1.3);
    }
}
