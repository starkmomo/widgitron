use serde::{Deserialize, Serialize};

/// The edge attached to the display stays square; the opposite two corners
/// are rounded. Independent widgets pass None and round all four corners.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GlassDockEdge {
    Left,
    Top,
    Right,
    Bottom,
}
