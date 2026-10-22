//! Keep the window's vertical and horizontal dimensions independent of its edge.
use crate::models::{AppConfig, SidebarAxisGeometry};

#[derive(Debug, Clone, Copy)]
pub struct SidebarGeometryMemory {
    vertical: SidebarAxisGeometry,
    horizontal: SidebarAxisGeometry,
}

fn vertical(edge: &str) -> bool { !matches!(edge, "top" | "bottom") }

fn sanitized(value: SidebarAxisGeometry) -> SidebarAxisGeometry {
    SidebarAxisGeometry {
        thickness: if value.thickness.is_finite() && value.thickness > 0.0 { value.thickness } else { 320.0 },
        length: value.length.filter(|length| length.is_finite() && *length > 0.0),
        offset: crate::sidebar_placement::sanitize_offset(Some(value.offset)),
    }
}

impl SidebarGeometryMemory {
    pub fn from_config(config: &AppConfig) -> Self {
        let mut memory = Self { vertical: SidebarAxisGeometry::default(), horizontal: SidebarAxisGeometry::default() };
        if let Some(axes) = &config.sidebar_axis_geometry {
            memory.vertical = sanitized(axes.get("vertical").copied().unwrap_or_default());
            memory.horizontal = sanitized(axes.get("horizontal").copied().unwrap_or_default());
        } else {
            // A legacy single length belongs only to its saved orientation.
            // The other orientation is initially full-span, not a rotated copy.
            memory.remember(config.sidebar_edge.as_deref().unwrap_or("right"), SidebarAxisGeometry {
                thickness: config.sidebar_width.unwrap_or(320.0), length: config.sidebar_length,
                offset: crate::sidebar_placement::sanitize_offset(config.sidebar_offset),
            });
        }
        memory
    }

    pub fn for_edge(&self, edge: &str) -> SidebarAxisGeometry {
        if vertical(edge) { self.vertical } else { self.horizontal }
    }

    pub fn remember(&mut self, edge: &str, geometry: SidebarAxisGeometry) {
        if vertical(edge) { self.vertical = sanitized(geometry); }
        else { self.horizontal = sanitized(geometry); }
    }

    pub fn write_config(&self, config: &mut AppConfig) {
        config.sidebar_axis_geometry = Some(std::collections::HashMap::from([
            ("vertical".into(), self.vertical), ("horizontal".into(), self.horizontal),
        ]));
        // Preserve compatibility with older builds and existing UI snapshots.
        let active = self.for_edge(config.sidebar_edge.as_deref().unwrap_or("right"));
        config.sidebar_width = Some(active.thickness);
        config.sidebar_length = active.length;
        config.sidebar_offset = Some(active.offset);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_geometry_migrates_only_into_its_original_axis() {
        for edge in ["left", "right", "top", "bottom"] {
            let config = AppConfig { sidebar_edge: Some(edge.into()), sidebar_width: Some(380.0),
                sidebar_length: Some(620.0), sidebar_offset: Some(0.8), ..AppConfig::default() };
            let memory = SidebarGeometryMemory::from_config(&config);
            assert_eq!(memory.for_edge(edge), SidebarAxisGeometry { thickness: 380.0, length: Some(620.0), offset: 0.8 });
            let other = if vertical(edge) { "bottom" } else { "right" };
            assert_eq!(memory.for_edge(other), SidebarAxisGeometry::default());
        }
    }

    #[test]
    fn both_axes_survive_repeated_redocking_serialization_and_restart() {
        let mut config = AppConfig::default();
        let mut memory = SidebarGeometryMemory::from_config(&config);
        let tall = SidebarAxisGeometry { thickness: 340.0, length: Some(710.0), offset: 0.2 };
        let wide = SidebarAxisGeometry { thickness: 410.0, length: Some(1400.0), offset: 0.7 };
        memory.remember("right", tall);
        memory.remember("bottom", wide);
        for edge in ["top", "left", "bottom", "right"] {
            config.sidebar_edge = Some(edge.into());
            memory.write_config(&mut config);
            config = serde_json::from_str(&serde_json::to_string(&config).unwrap()).unwrap();
            memory = SidebarGeometryMemory::from_config(&config);
            assert_eq!(memory.for_edge(edge), if vertical(edge) { tall } else { wide });
            assert_eq!(config.sidebar_length, if vertical(edge) { tall.length } else { wide.length });
            assert_eq!(memory.for_edge("left"), tall);
            assert_eq!(memory.for_edge("top"), wide);
        }
    }

    #[test]
    fn unsized_axis_stays_full_span_after_migration_and_save() {
        let mut config = AppConfig { sidebar_length: Some(600.0), ..AppConfig::default() };
        let memory = SidebarGeometryMemory::from_config(&config);
        memory.write_config(&mut config);
        config.sidebar_edge = Some("top".into());
        let reloaded = SidebarGeometryMemory::from_config(&config);
        assert_eq!(reloaded.for_edge("top").length, None);
        assert_eq!(reloaded.for_edge("right").length, Some(600.0));
    }
}
