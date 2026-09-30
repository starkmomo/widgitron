use tauri::AppHandle;

pub const DEFAULT_SIDEBAR_HOTKEY: &str = "Ctrl+Alt+W";

// The Win32 hotkey implementation uses RegisterHotKey. The sidebar remains
// available from the tray and app controls on other platforms.
pub fn start_global_sidebar_hotkey(_app: AppHandle, _hotkey: Option<String>) {}

pub fn update_global_sidebar_hotkey(_hotkey: Option<String>) {}
