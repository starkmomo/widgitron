pub const MIN_WIDTH_CSS: u32 = 300;
// Until content is loaded, permit restoring a previously saved compact window.
pub const FALLBACK_HEIGHT_CSS: u32 = 96;
pub const ARXIV_HEIGHT_CSS: u32 = 440;

pub fn sanitize_content_height(height: f64) -> Option<f64> {
    (height.is_finite() && height > 0.0).then(|| height.ceil().clamp(64.0, 8192.0))
}

/// The measured CSS height already includes the first card, header and framing.
/// Apply native DPI/UI zoom once, then keep the limit inside the work area.
pub fn minimum_size(
    label: &str,
    measured_height: Option<f64>,
    zoom: f64,
    work_width: u32,
    work_height: u32,
) -> (u32, u32) {
    let height = if label == "widget-arxiv-default" {
        ARXIV_HEIGHT_CSS as f64
    } else {
        measured_height.and_then(sanitize_content_height)
            .unwrap_or(FALLBACK_HEIGHT_CSS as f64)
    };
    let zoom = if zoom.is_finite() && zoom > 0.0 { zoom } else { 1.0 };
    (
        ((MIN_WIDTH_CSS as f64 * zoom).ceil() as u32).max(1).min(work_width.max(1)),
        ((height * zoom).ceil() as u32).max(1).min(work_height.max(1)),
    )
}

pub fn required_growth(current: (u32, u32), minimum: (u32, u32)) -> Option<(u32, u32)> {
    (current.0 < minimum.0 || current.1 < minimum.1)
        .then(|| (current.0.max(minimum.0), current.1.max(minimum.1)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_bar_and_two_bar_content_get_different_minima() {
        assert_eq!(minimum_size("widget-quota-default", Some(148.0), 1.0, 1920, 1080), (300, 148));
        assert_eq!(minimum_size("widget-quota-default", Some(188.0), 1.0, 1920, 1080), (300, 188));
        assert_eq!(minimum_size("widget-gpu-default", Some(176.0), 1.0, 1920, 1080), (300, 176));
        assert_eq!(minimum_size("widget-deadlines-default", Some(205.0), 1.0, 1920, 1080), (300, 205));
    }

    #[test]
    fn dpi_and_ui_zoom_apply_once_with_outward_pixel_rounding() {
        assert_eq!(minimum_size("widget-quota-default", Some(149.0), 2.0 * 1.25, 2560, 1440), (750, 373));
        assert_eq!(minimum_size("widget-quota-default", Some(149.0), 1.0 * 0.75, 1920, 1080), (225, 112));
    }

    #[test]
    fn tall_first_servers_and_timelines_are_limited_by_the_screen() {
        assert_eq!(minimum_size("widget-gpu-default", Some(1800.0), 2.0, 500, 700), (500, 700));
        assert_eq!(minimum_size("widget-deadlines-default", Some(950.0), 1.0, 1920, 800), (300, 800));
    }

    #[test]
    fn arxiv_keeps_a_large_reading_area_and_ignores_short_content_measurements() {
        assert_eq!(minimum_size("widget-arxiv-default", Some(100.0), 1.0, 1920, 1080), (300, 440));
        assert_eq!(minimum_size("widget-arxiv-default", None, 2.5, 2560, 1440), (750, 1100));
    }

    #[test]
    fn startup_does_not_force_a_saved_compact_widget_back_to_220() {
        assert_eq!(minimum_size("widget-quota-default", None, 1.0, 1920, 1080), (300, 96));
        for value in [f64::NAN, f64::INFINITY, -1.0, 0.0] {
            assert_eq!(sanitize_content_height(value), None);
        }
    }

    #[test]
    fn content_changes_never_shrink_a_window_the_user_made_taller() {
        assert_eq!(required_growth((400, 600), (300, 148)), None);
        assert_eq!(required_growth((400, 148), (300, 188)), Some((400, 188)));
        assert_eq!(required_growth((400, 188), (300, 148)), None);
        assert_eq!(required_growth((250, 600), (300, 148)), Some((300, 600)));
    }
}
