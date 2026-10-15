use serde::Serialize;
use std::sync::Mutex;
#[cfg(target_os = "macos")]
use tauri::{Emitter, Manager};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum MainDestination {
    Quota,
    Gpu,
    Deadlines,
}

impl MainDestination {
    #[cfg(any(target_os = "macos", test))]
    fn from_widget_url(url: &tauri::Url) -> Option<Self> {
        if url.scheme() != "widgitron" || url.host_str() != Some("open") {
            return None;
        }
        match url.path() {
            "/quota" => Some(Self::Quota),
            "/gpu" => Some(Self::Gpu),
            "/deadlines" => Some(Self::Deadlines),
            _ => None,
        }
    }
}

// Keep the last request until the main webview can consume it. Widget URLs can
// arrive before React has registered its event listener during a cold launch.
#[derive(Default)]
pub struct MainNavigation(Mutex<Option<MainDestination>>);

impl MainNavigation {
    #[cfg(any(target_os = "macos", test))]
    fn request(&self, destination: MainDestination) -> Result<(), String> {
        *self.0.lock().map_err(|error| error.to_string())? = Some(destination);
        Ok(())
    }

    fn take(&self) -> Result<Option<MainDestination>, String> {
        Ok(self.0.lock().map_err(|error| error.to_string())?.take())
    }
}

#[cfg(target_os = "macos")]
pub fn handle_widget_url(app: &tauri::AppHandle, url: &tauri::Url) -> bool {
    if url.scheme() != "widgitron" || url.host_str() != Some("open") {
        return false;
    }
    if let Some(destination) = MainDestination::from_widget_url(url) {
        match app.state::<MainNavigation>().request(destination) {
            Ok(()) => {
                if let Err(error) = app.emit_to("main", "main_navigation_pending", ()) {
                    log::warn!("Failed to notify main window of widget navigation: {error}");
                }
            }
            Err(error) => log::warn!("Failed to queue widget navigation: {error}"),
        }
    }
    true
}

#[tauri::command]
pub fn take_pending_main_navigation(
    window: tauri::WebviewWindow,
    navigation: tauri::State<'_, MainNavigation>,
) -> Result<Option<MainDestination>, String> {
    if window.label() != "main" {
        return Err("Only the main window can consume navigation requests".into());
    }
    navigation.take()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn widget_urls_select_only_known_module_pages() {
        for (path, expected) in [
            ("quota", MainDestination::Quota),
            ("gpu", MainDestination::Gpu),
            ("deadlines", MainDestination::Deadlines),
        ] {
            let url = tauri::Url::parse(&format!("widgitron://open/{path}")).unwrap();
            assert_eq!(MainDestination::from_widget_url(&url), Some(expected));
        }
        for value in [
            "widgitron://open",
            "widgitron://open/settings",
            "https://open/gpu",
            "widgitron://other/gpu",
        ] {
            assert_eq!(
                MainDestination::from_widget_url(&tauri::Url::parse(value).unwrap()),
                None
            );
        }
    }

    #[test]
    fn cold_launch_keeps_the_latest_request_until_consumed_once() {
        let navigation = MainNavigation::default();
        navigation.request(MainDestination::Quota).unwrap();
        navigation.request(MainDestination::Deadlines).unwrap();
        assert_eq!(navigation.take().unwrap(), Some(MainDestination::Deadlines));
        assert_eq!(navigation.take().unwrap(), None);
        navigation.request(MainDestination::Gpu).unwrap();
        assert_eq!(navigation.take().unwrap(), Some(MainDestination::Gpu));
    }
}
