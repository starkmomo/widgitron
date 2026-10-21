//! Logical-point geometry for the macOS widget frame. No monitor DPI or WebView
//! zoom belongs here: AppKit mouse locations and window frames already use points.

pub const EDGE_WIDTH: f64 = 6.0;
pub const CORNER_WIDTH: f64 = 16.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ResizeEdge {
    North,
    South,
    East,
    West,
    NorthEast,
    NorthWest,
    SouthEast,
    SouthWest,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Frame {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// The hit-test coordinate origin is the top left, matching visible frame edges.
pub fn edge_at(x: f64, y: f64, width: f64, height: f64) -> Option<ResizeEdge> {
    if ![x, y, width, height].iter().all(|value| value.is_finite())
        || width <= 0.0
        || height <= 0.0
        || x < 0.0
        || y < 0.0
        || x > width
        || y > height
    {
        return None;
    }
    let left = x <= CORNER_WIDTH;
    let right = x >= width - CORNER_WIDTH;
    let top = y <= CORNER_WIDTH;
    let bottom = y >= height - CORNER_WIDTH;
    match (left, right, top, bottom) {
        (true, _, true, _) => Some(ResizeEdge::NorthWest),
        (_, true, true, _) => Some(ResizeEdge::NorthEast),
        (true, _, _, true) => Some(ResizeEdge::SouthWest),
        (_, true, _, true) => Some(ResizeEdge::SouthEast),
        _ if y <= EDGE_WIDTH => Some(ResizeEdge::North),
        _ if y >= height - EDGE_WIDTH => Some(ResizeEdge::South),
        _ if x <= EDGE_WIDTH => Some(ResizeEdge::West),
        _ if x >= width - EDGE_WIDTH => Some(ResizeEdge::East),
        _ => None,
    }
}

/// Frame origins and deltas use AppKit's bottom-left screen coordinates.
pub fn resize_frame(
    start: Frame,
    edge: ResizeEdge,
    dx: f64,
    dy: f64,
    minimum: (f64, f64),
    maximum: (f64, f64),
) -> Frame {
    use ResizeEdge::*;
    if !dx.is_finite() || !dy.is_finite() {
        return start;
    }
    let west = matches!(edge, West | NorthWest | SouthWest);
    let east = matches!(edge, East | NorthEast | SouthEast);
    let north = matches!(edge, North | NorthWest | NorthEast);
    let south = matches!(edge, South | SouthWest | SouthEast);
    let constrain = |value: f64, min: f64, max: f64| {
        let min = if min.is_finite() { min.max(1.0) } else { 1.0 };
        let max = if max.is_finite() && max > 0.0 {
            max.max(min)
        } else {
            f64::INFINITY
        };
        value.clamp(min, max)
    };
    let width = if west || east {
        constrain(
            start.width + if west { -dx } else { dx },
            minimum.0,
            maximum.0,
        )
    } else {
        start.width
    };
    let height = if north || south {
        constrain(
            start.height + if south { -dy } else { dy },
            minimum.1,
            maximum.1,
        )
    } else {
        start.height
    };
    Frame {
        x: if west {
            start.x + start.width - width
        } else {
            start.x
        },
        y: if south {
            start.y + start.height - height
        } else {
            start.y
        },
        width,
        height,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const START: Frame = Frame {
        x: 100.0,
        y: 200.0,
        width: 320.0,
        height: 400.0,
    };

    #[test]
    fn all_eight_directions_are_reachable_without_covering_content() {
        use ResizeEdge::*;
        for (x, y, edge) in [
            (160.0, 3.0, North),
            (160.0, 397.0, South),
            (3.0, 200.0, West),
            (317.0, 200.0, East),
            (10.0, 10.0, NorthWest),
            (310.0, 10.0, NorthEast),
            (10.0, 390.0, SouthWest),
            (310.0, 390.0, SouthEast),
        ] {
            assert_eq!(edge_at(x, y, 320.0, 400.0), Some(edge));
        }
        assert_eq!(edge_at(30.0, 30.0, 320.0, 400.0), None);
        assert_eq!(edge_at(160.0, 200.0, 320.0, 400.0), None);
        assert_eq!(edge_at(7.0, 100.0, 320.0, 400.0), None);
        assert_eq!(edge_at(-1.0, 100.0, 320.0, 400.0), None);
    }

    #[test]
    fn every_direction_moves_only_the_selected_edges() {
        use ResizeEdge::*;
        for (edge, expected) in [
            (North, Frame { height: 420.0, ..START }),
            (South, Frame { y: 220.0, height: 380.0, ..START }),
            (East, Frame { width: 350.0, ..START }),
            (West, Frame { x: 130.0, width: 290.0, ..START }),
            (NorthEast, Frame { width: 350.0, height: 420.0, ..START }),
            (NorthWest, Frame { x: 130.0, width: 290.0, height: 420.0, ..START }),
            (SouthEast, Frame { y: 220.0, width: 350.0, height: 380.0, ..START }),
            (SouthWest, Frame { x: 130.0, y: 220.0, width: 290.0, height: 380.0 }),
        ] {
            assert_eq!(resize_frame(START, edge, 30.0, 20.0, (1.0, 1.0), (0.0, 0.0)), expected);
        }
    }

    #[test]
    fn opposite_edges_stay_anchored_at_minimum_size() {
        let next = resize_frame(
            START,
            ResizeEdge::SouthWest,
            1000.0,
            1000.0,
            (240.0, 160.0),
            (f64::INFINITY, f64::INFINITY),
        );
        assert_eq!(
            next,
            Frame {
                x: 180.0,
                y: 440.0,
                width: 240.0,
                height: 160.0
            }
        );
        assert_eq!(next.x + next.width, START.x + START.width);
        assert_eq!(next.y + next.height, START.y + START.height);
    }

    #[test]
    fn top_right_resize_honors_native_maximum_and_preserves_origin() {
        let next = resize_frame(
            START,
            ResizeEdge::NorthEast,
            2000.0,
            2000.0,
            (240.0, 160.0),
            (1000.0, 800.0),
        );
        assert_eq!(
            next,
            Frame {
                x: 100.0,
                y: 200.0,
                width: 1000.0,
                height: 800.0
            }
        );
    }

    #[test]
    fn edge_resize_changes_only_its_axis_in_points() {
        assert_eq!(
            resize_frame(
                START,
                ResizeEdge::North,
                50.0,
                25.0,
                (100.0, 100.0),
                (0.0, 0.0)
            ),
            Frame {
                height: 425.0,
                ..START
            }
        );
        assert_eq!(
            resize_frame(
                START,
                ResizeEdge::West,
                -25.0,
                50.0,
                (100.0, 100.0),
                (0.0, 0.0)
            ),
            Frame {
                x: 75.0,
                width: 345.0,
                ..START
            }
        );
    }
}
