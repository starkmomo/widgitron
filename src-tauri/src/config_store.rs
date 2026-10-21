use crate::models::{AppConfig, WidgetThemeConfig, WidgetVisibilityPayload};
use crate::utils::get_config_path;
use once_cell::sync::Lazy;
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::path::Path;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

static CONFIG_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

fn config_lock() -> std::sync::MutexGuard<'static, ()> {
    match CONFIG_LOCK.lock() {
        Ok(guard) => guard,
        Err(poisoned) => {
            log::warn!("Config mutex poisoned, recovering");
            poisoned.into_inner()
        }
    }
}

fn merge_json(base: &mut Value, overlay: &Value) {
    match (base, overlay) {
        (Value::Object(base_map), Value::Object(overlay_map)) => {
            for (key, value) in overlay_map {
                match base_map.get_mut(key) {
                    Some(existing) => merge_json(existing, value),
                    None => {
                        base_map.insert(key.clone(), value.clone());
                    }
                }
            }
        }
        (base_slot, overlay_value) => {
            *base_slot = overlay_value.clone();
        }
    }
}

fn recover_config_via_soft_merge<T: DeserializeOwned + Default + Serialize>(
    content: &str,
) -> Option<T> {
    let overlay: Value = serde_json::from_str(content).ok()?;
    let mut merged = serde_json::to_value(T::default()).ok()?;
    merge_json(&mut merged, &overlay);
    serde_json::from_value(merged).ok()
}

/// Read configuration of type T. If the file doesn't exist, returns default value.
/// On parse failure, soft-merges known fields onto defaults so upgrades do not wipe
/// user settings; only falls back to a full default (+ corrupt backup) if recovery fails.
pub fn read_config<T: DeserializeOwned + Default + Serialize>(app: &AppHandle, filename: &str) -> T {
    let _guard = config_lock();
    read_config_unlocked(app, filename)
}

// Call only while holding CONFIG_LOCK (including update_config transactions).
fn read_config_unlocked<T: DeserializeOwned + Default + Serialize>(
    app: &AppHandle,
    filename: &str,
) -> T {
    let path = get_config_path(app, filename);
    if !path.exists() {
        return T::default();
    }

    match fs::read_to_string(&path) {
        Ok(content) => match serde_json::from_str::<T>(&content) {
            Ok(config) => config,
            Err(e) => {
                if let Some(recovered) = recover_config_via_soft_merge::<T>(&content) {
                    log::warn!(
                        "Config '{}' had incompatible fields ({}). Recovered via soft merge.",
                        filename,
                        e
                    );
                    if let Err(error) = write_config_unlocked(app, filename, &recovered) {
                        log::warn!("Could not persist recovered config '{}': {}", filename, error);
                    }
                    return recovered;
                }
                log::error!(
                    "Failed to parse config file '{}': {}. Backing up and returning defaults.",
                    filename,
                    e
                );
                let backup_path = path.with_extension("corrupt.json");
                let _ = fs::rename(&path, &backup_path);
                T::default()
            }
        },
        Err(e) => {
            log::error!(
                "Failed to read config file '{}': {}. Returning defaults.",
                filename,
                e
            );
            T::default()
        }
    }
}

/// Write configuration of type T atomically.
pub fn write_config<T: Serialize>(
    app: &AppHandle,
    filename: &str,
    config: &T,
) -> Result<(), String> {
    let _guard = config_lock();
    write_config_unlocked(app, filename, config)
}

// Call only while holding CONFIG_LOCK (including update_config transactions).
fn write_config_unlocked<T: Serialize>(
    app: &AppHandle,
    filename: &str,
    config: &T,
) -> Result<(), String> {
    let path = get_config_path(app, filename);
    let content = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    stage_and_replace_config(&path, &content, |from, to| fs::rename(from, to))
}

/// Modify the latest persisted config without losing concurrent changes to other
/// fields. The callback must not call another config-store function (the shared
/// lock is intentionally held through reading, mutation, and atomic replacement).
pub fn update_config<T: DeserializeOwned + Default + Serialize>(
    app: &AppHandle,
    filename: &str,
    update: impl FnOnce(&mut T),
) -> Result<T, String> {
    update_config_transaction(
        || read_config_unlocked(app, filename),
        update,
        |config| write_config_unlocked(app, filename, config),
    )
}

fn update_config_transaction<T>(
    read: impl FnOnce() -> T,
    update: impl FnOnce(&mut T),
    write: impl FnOnce(&T) -> Result<(), String>,
) -> Result<T, String> {
    let _guard = config_lock();
    let mut config = read();
    update(&mut config);
    write(&config)?;
    Ok(config)
}

fn stage_and_replace_config(
    path: &Path,
    content: &str,
    replace: impl FnOnce(&Path, &Path) -> std::io::Result<()>,
) -> Result<(), String> {
    let parent = path.parent()
        .ok_or_else(|| "No parent directory for config path".to_string())?;
    let filename = path.file_name()
        .ok_or_else(|| "No file name for config path".to_string())?;
    let mut temp_filename = filename.to_os_string();
    temp_filename.push(".tmp");
    let temp_path = parent.join(temp_filename);
    fs::write(&temp_path, content)
        .map_err(|e| format!("Failed to write to temp file: {}", e))?;

    // std::fs::rename replaces an existing file on Windows as well as Unix.
    // Keep the previous config intact if replacement fails, or the app exits
    // after staging the new file. Never unlink the destination first.
    replace(&temp_path, path)
        .map_err(|e| format!("Failed to rename config file: {}", e))
}

#[cfg(test)]
mod atomic_config_tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};

    struct TestDir(PathBuf);
    impl TestDir {
        fn new() -> Self {
            static COUNTER: AtomicU64 = AtomicU64::new(0);
            let path = std::env::temp_dir().join(format!(
                "widgitron-config-write-{}-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos(),
                COUNTER.fetch_add(1, Ordering::Relaxed),
            ));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn successful_replace_updates_an_existing_config() {
        let dir = TestDir::new();
        let path = dir.0.join("settings.json");
        fs::write(&path, "old settings").unwrap();
        stage_and_replace_config(&path, "new settings", |from, to| fs::rename(from, to)).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "new settings");
        assert!(!dir.0.join("settings.json.tmp").exists());
    }

    #[test]
    fn concurrent_transactions_keep_all_updates() {
        let dir = TestDir::new();
        let path = dir.0.join("counter.txt");
        fs::write(&path, "0").unwrap();
        let threads: Vec<_> = (0..4).map(|_| {
            let path = path.clone();
            std::thread::spawn(move || {
                for _ in 0..25 {
                    update_config_transaction(
                        || fs::read_to_string(&path).unwrap().parse::<u32>().unwrap(),
                        |value| {
                            // Widen the race window between read and write.
                            std::thread::yield_now();
                            *value += 1;
                        },
                        |value| stage_and_replace_config(
                            &path, &value.to_string(), |from, to| fs::rename(from, to),
                        ),
                    ).unwrap();
                }
            })
        }).collect();
        for thread in threads {
            thread.join().unwrap();
        }
        assert_eq!(fs::read_to_string(&path).unwrap(), "100");
    }

    #[test]
    fn transaction_reports_write_failure() {
        let result = update_config_transaction(
            || 1u32,
            |value| *value = 2,
            |_| Err("disk write failed".to_string()),
        );
        assert_eq!(result, Err("disk write failed".to_string()));
    }

    #[test]
    fn failed_replace_preserves_the_previous_config() {
        let dir = TestDir::new();
        let path = dir.0.join("settings.json");
        fs::write(&path, "old settings").unwrap();
        let result = stage_and_replace_config(&path, "new settings", |_, _| {
            Err(std::io::Error::new(std::io::ErrorKind::PermissionDenied, "file is busy"))
        });
        assert!(result.is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "old settings");
        assert_eq!(fs::read_to_string(dir.0.join("settings.json.tmp")).unwrap(), "new settings");
    }
}

/// Specialized theme configuration loader that handles legacy format migration.
fn refresh_builtin_macos_widget_opacity(config: &mut WidgetThemeConfig) {
    if !cfg!(target_os = "macos") {
        return;
    }
    for theme in &mut config.themes {
        if theme.is_default
            && theme.id.ends_with("-light")
            && theme.bg_color == "#ffffff"
            && (theme.bg_opacity - 0.94).abs() < 0.001
        {
            theme.bg_opacity = 0.84;
        }
    }
}

pub fn read_theme_config(app: &AppHandle) -> WidgetThemeConfig {
    let _guard = config_lock();
    let path = get_config_path(app, "widget_themes.json");
    if !path.exists() {
        return WidgetThemeConfig::default();
    }

    let config_str = match fs::read_to_string(&path) {
        Ok(s) => s,
        Err(e) => {
            log::error!(
                "Failed to read widget_themes.json: {}. Returning default theme config.",
                e
            );
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
                    || config
                        .assignments
                        .get(&widget_id)
                        .map_or(true, |s| s.is_empty())
                {
                    config.assignments.insert(widget_id, default_theme_id);
                }
            }
            refresh_builtin_macos_widget_opacity(&mut config);
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
                                    if let Some(obj) = theme.as_object_mut() {
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
                                    || migrated
                                        .assignments
                                        .get(&widget_id)
                                        .map_or(true, |s| s.is_empty())
                                {
                                    migrated.assignments.insert(widget_id, default_theme_id);
                                }
                            }

                            refresh_builtin_macos_widget_opacity(&mut migrated);

                            if let Err(error) = write_config_unlocked(
                                app, "widget_themes.json", &migrated,
                            ) {
                                log::warn!("Could not persist migrated widget themes: {error}");
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

/// Seed default widget themes on first install when no bundled copy exists.
pub fn seed_default_theme_config_if_missing(app: &AppHandle) {
    let path = get_config_path(app, "widget_themes.json");
    if path.exists() {
        return;
    }
    let default = WidgetThemeConfig::default();
    if let Err(e) = write_theme_config(app, &default) {
        log::warn!("Failed to seed widget_themes.json: {}", e);
    } else {
        log::info!("Seeded default widget_themes.json");
    }
}

/// List backup files created when a config JSON failed to parse.
pub fn list_corrupt_config_files(app: &AppHandle) -> Vec<String> {
    let dir = crate::utils::get_config_dir(app);
    let mut files = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if name.ends_with(".corrupt.json") {
                files.push(name.to_string());
            }
        }
    }
    files.sort();
    files
}

/// Atomic helper to update widget visibility inside AppConfig.
pub async fn update_widget_visibility_config(
    app: &AppHandle,
    id: &str,
    visible: bool,
) -> Result<(), String> {
    let config = update_config(app, "app_config.json", |config: &mut AppConfig| {
        config.active_widgets.get_or_insert_with(Default::default).insert(id.to_string(), visible);
        crate::widget_visibility::reset_hidden_when_empty(config);
    })?;
    let _ = app.emit(
        "widget_visibility_changed",
        WidgetVisibilityPayload {
            id: id.to_string(),
            visible,
        },
    );
    let _ = app.emit("app_config_update", &config);
    #[cfg(target_os = "macos")]
    crate::macos_tray::refresh(app);
    Ok(())
}
