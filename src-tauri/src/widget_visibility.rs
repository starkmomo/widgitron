use crate::models::AppConfig;

/// The user's selected floating modules, independent of temporary visibility.
pub fn selected_widgets(config: &AppConfig) -> Vec<(&'static str, &'static str)> {
    [
        ("widget-quota-default", "Quota Monitor", config.quota_enabled),
        ("widget-gpu-default", "GPU Monitor", config.gpu_enabled),
        ("widget-deadlines-default", "Deadlines", config.deadline_enabled),
        ("widget-arxiv-default", "Arxiv Radar", config.arxiv_enabled),
    ]
    .into_iter()
    .filter(|(id, _, enabled)| {
        enabled.unwrap_or(true)
            && config.active_widgets.as_ref().and_then(|values| values.get(*id)) == Some(&true)
    })
    .map(|(id, title, _)| (id, title))
    .collect()
}

pub fn reset_hidden_when_empty(config: &mut AppConfig) {
    if selected_widgets(config).is_empty() {
        config.widgets_hidden = Some(false);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hide_and_restore_keep_only_the_users_selected_modules() {
        let mut config = AppConfig::default();
        config.active_widgets.as_mut().unwrap().extend([
            ("widget-quota-default".into(), true),
            ("widget-arxiv-default".into(), true),
            ("widget-gpu-default".into(), false),
        ]);
        let selected = config.active_widgets.clone();
        for hidden in [true, false, true, false] {
            config.widgets_hidden = Some(hidden);
            assert_eq!(selected_widgets(&config), vec![
                ("widget-quota-default", "Quota Monitor"),
                ("widget-arxiv-default", "Arxiv Radar"),
            ]);
            assert_eq!(config.active_widgets, selected);
        }
        // Selections changed while hidden determine the next restore.
        config.widgets_hidden = Some(true);
        config.active_widgets.as_mut().unwrap().insert("widget-arxiv-default".into(), false);
        config.active_widgets.as_mut().unwrap().insert("widget-gpu-default".into(), true);
        config.widgets_hidden = Some(false);
        assert_eq!(selected_widgets(&config), vec![
            ("widget-quota-default", "Quota Monitor"), ("widget-gpu-default", "GPU Monitor"),
        ]);
    }

    #[test]
    fn no_selection_and_disabled_services_never_open_extra_windows() {
        let mut config = AppConfig::default();
        assert!(selected_widgets(&config).is_empty());
        config.active_widgets.as_mut().unwrap().insert("widget-gpu-default".into(), true);
        config.gpu_enabled = Some(false);
        assert!(selected_widgets(&config).is_empty());
        config.active_widgets = None;
        assert!(selected_widgets(&config).is_empty());
    }

    #[test]
    fn closing_the_last_selection_resets_hidden_before_any_new_window_opens() {
        let mut config = AppConfig::default();
        config.active_widgets.as_mut().unwrap().insert("widget-quota-default".into(), true);
        config.widgets_hidden = Some(true);
        reset_hidden_when_empty(&mut config);
        assert_eq!(config.widgets_hidden, Some(true));
        config.active_widgets.as_mut().unwrap().insert("widget-quota-default".into(), false);
        reset_hidden_when_empty(&mut config);
        assert_eq!(config.widgets_hidden, Some(false));
        config.active_widgets.as_mut().unwrap().insert("widget-arxiv-default".into(), true);
        assert_eq!(config.widgets_hidden, Some(false));
        assert_eq!(selected_widgets(&config), vec![("widget-arxiv-default", "Arxiv Radar")]);
        config.arxiv_enabled = Some(false);
        config.widgets_hidden = Some(true);
        reset_hidden_when_empty(&mut config);
        assert_eq!(config.widgets_hidden, Some(false));
    }

    #[test]
    fn temporary_visibility_survives_restart_and_legacy_configs_still_load() {
        let mut config = AppConfig::default();
        config.active_widgets.as_mut().unwrap().insert("widget-quota-default".into(), true);
        config.widgets_hidden = Some(true);
        let mut json = serde_json::to_value(&config).unwrap();
        let restored: AppConfig = serde_json::from_value(json.clone()).unwrap();
        assert_eq!(restored.widgets_hidden, Some(true));
        assert_eq!(selected_widgets(&restored), selected_widgets(&config));
        json.as_object_mut().unwrap().remove("widgets_hidden");
        let legacy: AppConfig = serde_json::from_value(json).unwrap();
        assert!(!legacy.widgets_hidden.unwrap_or(false));
        assert_eq!(selected_widgets(&legacy), selected_widgets(&config));
    }
}
