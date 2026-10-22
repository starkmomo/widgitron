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

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ConferenceView {
    All,
    Followed,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct MainNavigationRequest {
    destination: MainDestination,
    conference_view: Option<ConferenceView>,
}

impl MainNavigationRequest {
    #[cfg(any(target_os = "macos", test))]
    fn for_widget(destination: MainDestination, config: &crate::models::PaperConfig) -> Self {
        let conference_view = (destination == MainDestination::Deadlines).then(|| {
            // Use current preferences rather than the widget's older snapshot.
            // Expired follows still belong in the Followed tab.
            let mut config = config.clone();
            crate::deadlines::normalize_paper_config(&mut config);
            let has_follows = config.followed_conference_ids.as_ref().is_some_and(|ids| !ids.is_empty())
                || config.subscribed_titles.as_ref().is_some_and(|titles| !titles.is_empty());
            if has_follows { ConferenceView::Followed } else { ConferenceView::All }
        });
        Self { destination, conference_view }
    }
}

// Keep the last request until the main webview can consume it. Widget URLs can
// arrive before React has registered its event listener during a cold launch.
#[derive(Default)]
pub struct MainNavigation(Mutex<Option<MainNavigationRequest>>);

impl MainNavigation {
    #[cfg(any(target_os = "macos", test))]
    fn request(&self, request: MainNavigationRequest) -> Result<(), String> {
        *self.0.lock().map_err(|error| error.to_string())? = Some(request);
        Ok(())
    }

    fn take(&self) -> Result<Option<MainNavigationRequest>, String> {
        Ok(self.0.lock().map_err(|error| error.to_string())?.take())
    }
}

#[cfg(target_os = "macos")]
pub fn handle_widget_url(app: &tauri::AppHandle, url: &tauri::Url) -> bool {
    if url.scheme() != "widgitron" || url.host_str() != Some("open") {
        return false;
    }
    if let Some(destination) = MainDestination::from_widget_url(url) {
        let config = if destination == MainDestination::Deadlines {
            crate::deadlines::read_paper_config(app)
        } else {
            crate::models::PaperConfig::default()
        };
        let request = MainNavigationRequest::for_widget(destination, &config);
        match app.state::<MainNavigation>().request(request) {
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
) -> Result<Option<MainNavigationRequest>, String> {
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
        let config = crate::models::PaperConfig::default();
        let quota = MainNavigationRequest::for_widget(MainDestination::Quota, &config);
        let deadlines = MainNavigationRequest::for_widget(MainDestination::Deadlines, &config);
        let gpu = MainNavigationRequest::for_widget(MainDestination::Gpu, &config);
        navigation.request(quota).unwrap();
        navigation.request(deadlines).unwrap();
        assert_eq!(navigation.take().unwrap(), Some(deadlines));
        assert_eq!(navigation.take().unwrap(), None);
        navigation.request(gpu).unwrap();
        assert_eq!(navigation.take().unwrap(), Some(gpu));
    }

    #[test]
    fn deadline_clicks_route_by_follows_including_expired_and_legacy_preferences() {
        use crate::models::PaperConfig;
        for config in [
            PaperConfig { followed_conference_ids: Some(vec!["acl|2020".into()]), ..Default::default() },
            PaperConfig { subscribed_titles: Some(vec!["ACL".into()]), ..Default::default() },
            PaperConfig { pinned_titles: Some(vec!["ACL".into()]), ..Default::default() },
            PaperConfig { pinned_deadline_ids: Some(vec!["acl|2020|old-date".into()]), ..Default::default() },
        ] {
            let request = MainNavigationRequest::for_widget(MainDestination::Deadlines, &config);
            assert_eq!(request.conference_view, Some(ConferenceView::Followed));
        }
        for config in [
            PaperConfig::default(),
            PaperConfig { followed_conference_ids: Some(vec![" ".into()]), ..Default::default() },
            PaperConfig { followed_conference_ids: Some(vec!["acl|2020".into()]),
                ignored_conference_ids: Some(vec!["acl|2020".into()]), ..Default::default() },
        ] {
            assert_eq!(MainNavigationRequest::for_widget(MainDestination::Deadlines, &config).conference_view,
                Some(ConferenceView::All));
            assert_eq!(MainNavigationRequest::for_widget(MainDestination::Quota, &config).conference_view, None);
            assert_eq!(MainNavigationRequest::for_widget(MainDestination::Gpu, &config).conference_view, None);
        }
    }

    #[test]
    fn cold_launch_preserves_the_requested_conference_list() {
        let navigation = MainNavigation::default();
        let config = crate::models::PaperConfig {
            followed_conference_ids: Some(vec!["cvpr|2027".into()]), ..Default::default()
        };
        let request = MainNavigationRequest::for_widget(MainDestination::Deadlines, &config);
        navigation.request(request).unwrap();
        assert_eq!(navigation.take().unwrap().unwrap().conference_view, Some(ConferenceView::Followed));
        assert_eq!(navigation.take().unwrap(), None);
        assert_eq!(serde_json::to_value(request).unwrap(),
            serde_json::json!({ "destination": "deadlines", "conference_view": "followed" }));
    }
}
