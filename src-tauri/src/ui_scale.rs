use tauri::WebviewWindow;

use crate::models::AppConfig;

pub const DEFAULT_UI_SCALE: f64 = 1.0;
pub const MIN_UI_SCALE: f64 = 0.5;
pub const MAX_UI_SCALE: f64 = 2.0;

pub fn sanitize(value: Option<f64>) -> f64 {
    let value = value.unwrap_or(DEFAULT_UI_SCALE);
    if !value.is_finite() {
        return DEFAULT_UI_SCALE;
    }
    value.clamp(MIN_UI_SCALE, MAX_UI_SCALE)
}

pub fn from_config(config: &AppConfig) -> f64 {
    sanitize(config.global_scale)
}

pub fn apply_to_window(window: &WebviewWindow, scale: f64) -> Result<(), String> {
    let zoom = sanitize(Some(scale));
    window.set_zoom(zoom).map_err(|err| err.to_string())?;
    #[cfg(windows)]
    if window.label() == "sidebar" || crate::widget_layout::is_tracked_widget(window.label()) {
        crate::windows_glass::remember_zoom(window, zoom);
    }
    Ok(())
}

/// Apply user UI scale with an extra DPI ratio. Used when a desktop-locked
/// child window inherits a different host DPI than the monitor it sits on
/// (common with mixed-scale multi-monitor setups under Progman/WorkerW).
pub fn apply_to_window_with_dpi_ratio(
    window: &WebviewWindow,
    user_scale: f64,
    dpi_ratio: f64,
) -> Result<(), String> {
    let ratio = if dpi_ratio.is_finite() && dpi_ratio > 0.0 {
        dpi_ratio.clamp(0.25, 4.0)
    } else {
        1.0
    };
    let zoom = (sanitize(Some(user_scale)) * ratio).clamp(0.25, MAX_UI_SCALE * 2.0);
    window.set_zoom(zoom).map_err(|err| err.to_string())?;
    #[cfg(windows)]
    if window.label() == "sidebar" || crate::widget_layout::is_tracked_widget(window.label()) {
        crate::windows_glass::remember_zoom(window, zoom);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scale_is_sanitized_to_supported_range() {
        assert_eq!(sanitize(None), 1.0);
        assert_eq!(sanitize(Some(f64::NAN)), 1.0);
        assert_eq!(sanitize(Some(0.1)), MIN_UI_SCALE);
        assert_eq!(sanitize(Some(3.0)), MAX_UI_SCALE);
        assert_eq!(sanitize(Some(1.25)), 1.25);
    }

    #[test]
    fn mixed_dpi_compensation_ratio_shrinks_when_host_dpi_is_higher() {
        // Widget monitor 100%, desktop host 150% → zoom must shrink by 2/3.
        let user = 1.0;
        let pre = 1.0;
        let post = 1.5;
        let zoom = (sanitize(Some(user)) * (pre / post)).clamp(0.25, MAX_UI_SCALE * 2.0);
        assert!((zoom - (2.0 / 3.0)).abs() < 1e-9);
    }
}
