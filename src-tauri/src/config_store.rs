use std::fs;
use std::sync::Mutex;
use once_cell::sync::Lazy;
use serde::de::DeserializeOwned;
use serde::Serialize;
use tauri::AppHandle;
use crate::utils::get_config_path;
use crate::models::{AppConfig, WidgetThemeConfig};

static CONFIG_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

/// Read configuration of type T. If the file doesn't exist, returns default value.
/// If parsing fails, logs error, renames file to <filename>.corrupt.json, and returns default value.
pub fn read_config<T: DeserializeOwned + Default>(app: &AppHandle, filename: &str) -> T {
    let _guard = CONFIG_LOCK.lock().unwrap();
    let path = get_config_path(app, filename);
    if !path.exists() {
        return T::default();
    }

    match fs::read_to_string(&path) {
        Ok(content) => {
            match serde_json::from_str::<T>(&content) {
                Ok(config) => config,
                Err(e) => {
                    log::error!(
                        "Failed to parse config file '{}': {}. Backing up and returning defaults.",
                        filename,
                        e
                    );
                    let backup_path = path.with_extension("corrupt.json");
                    let _ = fs::rename(&path, &backup_path);
                    T::default()
                }
            }
        }
        Err(e) => {
            log::error!("Failed to read config file '{}': {}. Returning defaults.", filename, e);
            T::default()
        }
    }
}

/// Write configuration of type T atomically.
pub fn write_config<T: Serialize>(app: &AppHandle, filename: &str, config: &T) -> Result<(), String> {
    let _guard = CONFIG_LOCK.lock().unwrap();
    let path = get_config_path(app, filename);
    
    let content = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    
    let parent = path.parent().ok_or_else(|| "No parent directory for config path".to_string())?;
    let temp_filename = format!("{}.tmp", filename);
    let temp_path = parent.join(temp_filename);
    
    // Write to temp file
    fs::write(&temp_path, &content).map_err(|e| format!("Failed to write to temp file: {}", e))?;
    
    // On Windows, rename fails if destination exists.
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("Failed to remove old config file: {}", e))?;
    }
    
    // Move temp file to actual file path
    fs::rename(&temp_path, &path).map_err(|e| format!("Failed to rename config file: {}", e))?;
    
    Ok(())
}

/// Specialized theme configuration loader that handles legacy format migration.
pub fn read_theme_config(app: &AppHandle) -> WidgetThemeConfig {
    let _guard = CONFIG_LOCK.lock().unwrap();
    let path = get_config_path(app, "widget_themes.json");
    if !path.exists() {
        return WidgetThemeConfig::default();
    }

    let config_str = match fs::read_to_string(&path) {
        Ok(s) => s,
        Err(e) => {
            log::error!("Failed to read widget_themes.json: {}. Returning default theme config.", e);
            return WidgetThemeConfig::default();
        }
    };

    // Try normal deserialization
    match serde_json::from_str::<WidgetThemeConfig>(&config_str) {
        Ok(mut config) => {
            // Sync default themes and assignments if missing
            let defaults = WidgetThemeConfig::default();
            config.themes.retain(|t| !t.id.ends_with("-transparent"));
            
            for default_theme in defaults.themes {
                if !config.themes.iter().any(|t| t.id == default_theme.id) {
                    config.themes.push(default_theme);
                }
            }

            // Sync missing default assignments
            for (widget_id, default_theme_id) in defaults.assignments {
                if !config.assignments.contains_key(&widget_id)
                    || config.assignments.get(&widget_id).map_or(true, |s| s.is_empty())
                {
                    config.assignments.insert(widget_id, default_theme_id);
                }
            }
            config
        }
        Err(_) => {
            // Migration from old format (text_color: String)
            match serde_json::from_str::<serde_json::Value>(&config_str) {
                Ok(mut val) => {
                    if let Some(themes) = val.get_mut("themes").and_then(|t| t.as_array_mut()) {
                        for theme in themes {
                            let old_color = theme.get("text_color").cloned();
                            if let Some(color_val) = old_color {
                                if color_val.is_string() {
                                    let obj = theme.as_object_mut().unwrap();
                                    obj.insert(
                                        "text_colors".into(),
                                        serde_json::json!([
                                            { "name": "Main Text", "value": color_val, "opacity": 1.0 },
                                            { "name": "Sub Text", "value": "#94a3b8", "opacity": 0.6 }
                                        ]),
                                    );
                                    obj.remove("text_color");
                                }
                            }
                        }
                    }
                    match serde_json::from_value::<WidgetThemeConfig>(val) {
                        Ok(mut migrated) => {
                            let defaults = WidgetThemeConfig::default();
                            migrated.themes.retain(|t| !t.id.ends_with("-transparent"));
                            
                            for default_theme in defaults.themes {
                                if !migrated.themes.iter().any(|t| t.id == default_theme.id) {
                                    migrated.themes.push(default_theme);
                                }
                            }

                            for (widget_id, default_theme_id) in defaults.assignments {
                                if !migrated.assignments.contains_key(&widget_id)
                                    || migrated.assignments.get(&widget_id).map_or(true, |s| s.is_empty())
                                {
                                    migrated.assignments.insert(widget_id, default_theme_id);
                                }
                            }
                            
                            // Save migrated config atomically
                            let parent = path.parent().unwrap();
                            let temp_path = parent.join("widget_themes.json.tmp");
                            if let Ok(content) = serde_json::to_string_pretty(&migrated) {
                                if fs::write(&temp_path, &content).is_ok() {
                                    let _ = fs::remove_file(&path);
                                    let _ = fs::rename(&temp_path, &path);
                                }
                            }
                            migrated
                        }
                        Err(e) => {
                            log::error!("Failed to migrate widget_themes.json: {}. Backing up and returning defaults.", e);
                            let backup_path = path.with_extension("corrupt.json");
                            let _ = fs::rename(&path, &backup_path);
                            WidgetThemeConfig::default()
                        }
                    }
                }
                Err(e) => {
                    log::error!("Failed to parse widget_themes.json as JSON: {}. Backing up and returning defaults.", e);
                    let backup_path = path.with_extension("corrupt.json");
                    let _ = fs::rename(&path, &backup_path);
                    WidgetThemeConfig::default()
                }
            }
        }
    }
}

/// Specialized theme configuration writer.
pub fn write_theme_config(app: &AppHandle, config: &WidgetThemeConfig) -> Result<(), String> {
    write_config(app, "widget_themes.json", config)
}

/// Atomic helper to update widget visibility inside AppConfig.
pub async fn update_widget_visibility_config(
    app: &AppHandle,
    id: &str,
    visible: bool,
) -> Result<(), String> {
    let mut config = read_config::<AppConfig>(app, "app_config.json");
    let mut active = config.active_widgets.unwrap_or_default();
    active.insert(id.to_string(), visible);
    config.active_widgets = Some(active);
    write_config(app, "app_config.json", &config)
}
