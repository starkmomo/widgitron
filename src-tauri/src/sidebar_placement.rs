//! Position along a dock edge, independent of monitor DPI and edge orientation.

pub fn sanitize_offset(offset: Option<f64>) -> f64 {
    offset
        .filter(|value| value.is_finite())
        .unwrap_or(0.5)
        .clamp(0.0, 1.0)
}

pub fn edge_origin(start: f64, span: f64, length: f64, offset: f64) -> f64 {
    start + (span - length).max(0.0) * sanitize_offset(Some(offset))
}

pub fn offset_from_origin(start: f64, span: f64, length: f64, origin: f64) -> f64 {
    let travel = span - length;
    if travel <= 0.0 {
        0.5
    } else {
        sanitize_offset(Some((origin - start) / travel))
    }
}

/// Keep long-axis movement attached to the current edge. A deliberate movement
/// away from it releases that constraint so another edge can be targeted.
pub fn stays_on_edge(vertical: bool, dx: f64, dy: f64, dpi: f64) -> bool {
    let perpendicular = if vertical { dx } else { dy };
    perpendicular.abs() <= 48.0 * dpi.max(0.5)
}

/// Constrain size and origin together; limiting size alone can still leave the
/// far edge off screen when resizing a sidebar that was moved toward one end.
pub fn bounded_span(origin: f64, length: f64, start: f64, span: f64, minimum: f64) -> (f64, f64) {
    let span = span.max(1.0);
    let length = length.clamp(minimum.clamp(1.0, span), span);
    (origin.clamp(start, start + span - length), length)
}

/// Keep the pointer attached to the same logical position in the grip while
/// the preview changes size or crosses displays with a different DPI.
pub fn preview_grab(
    width: f64,
    height: f64,
    original: (f64, f64),
    grip_inset: Option<(f64, f64)>,
    scale: f64,
) -> (f64, f64) {
    let (x, y) = grip_inset
        .map(|(left, top)| (left * scale, top * scale))
        .unwrap_or(original);
    (
        x.clamp(0.0, (width - 1.0).max(0.0)),
        y.clamp(0.0, (height - 1.0).max(0.0)),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_and_invalid_offsets_center_old_profiles() {
        for offset in [None, Some(f64::NAN), Some(f64::INFINITY)] {
            assert_eq!(sanitize_offset(offset), 0.5);
        }
        assert_eq!(sanitize_offset(Some(-1.0)), 0.0);
        assert_eq!(sanitize_offset(Some(2.0)), 1.0);
    }

    #[test]
    fn short_sidebars_move_between_both_ends_and_remain_on_screen() {
        for (start, span, length) in [(0.0, 1000.0, 400.0), (-1920.0, 1920.0, 800.0)] {
            for offset in [0.0, 0.25, 0.5, 1.0] {
                let origin = edge_origin(start, span, length, offset);
                assert!(origin >= start && origin + length <= start + span);
                assert!((offset_from_origin(start, span, length, origin) - offset).abs() < 1e-9);
            }
        }
        assert_eq!(edge_origin(0.0, 1000.0, 1000.0, 0.9), 0.0);
        assert_eq!(offset_from_origin(0.0, 1000.0, 1000.0, 0.0), 0.5);
    }

    #[test]
    fn position_survives_dpi_changes_and_clamps_after_resize() {
        let offset = offset_from_origin(50.0, 1000.0, 400.0, 200.0);
        assert_eq!(edge_origin(100.0, 2000.0, 800.0, offset), 400.0);
        assert_eq!(offset_from_origin(0.0, 1000.0, 800.0, 500.0), 1.0);
    }

    #[test]
    fn parallel_drag_stays_attached_but_perpendicular_drag_can_redock() {
        assert!(stays_on_edge(true, 10.0, 600.0, 1.0));
        assert!(stays_on_edge(false, 600.0, 10.0, 1.0));
        assert!(!stays_on_edge(true, 100.0, 10.0, 1.0));
        assert!(!stays_on_edge(false, 10.0, 100.0, 1.0));
        assert!(stays_on_edge(true, 90.0, 600.0, 2.0));
    }

    #[test]
    fn resizing_at_either_end_never_pushes_the_other_end_off_screen() {
        assert_eq!(
            bounded_span(700.0, 1500.0, 50.0, 1000.0, 360.0),
            (50.0, 1000.0)
        );
        assert_eq!(
            bounded_span(-400.0, 500.0, 50.0, 1000.0, 360.0),
            (50.0, 500.0)
        );
        assert_eq!(
            bounded_span(900.0, 500.0, 50.0, 1000.0, 360.0),
            (550.0, 500.0)
        );
        assert_eq!(
            bounded_span(-2500.0, 4000.0, -1920.0, 1920.0, 360.0),
            (-1920.0, 1920.0)
        );
        assert_eq!(bounded_span(10.0, 100.0, 0.0, 300.0, 360.0), (0.0, 300.0));
    }

    #[test]
    fn compact_preview_keeps_the_grip_under_the_pointer_after_shrinking() {
        let original = (26.0, 22.0);
        assert_eq!(
            preview_grab(420.0, 600.0, original, Some((26.0, 22.0)), 1.0),
            (26.0, 22.0)
        );
        assert_eq!(
            preview_grab(840.0, 1200.0, original, Some((26.0, 22.0)), 2.0),
            (52.0, 44.0)
        );
        assert_eq!(
            preview_grab(420.0, 600.0, (120.0, 22.0), None, 1.0),
            (120.0, 22.0)
        );
    }
}
