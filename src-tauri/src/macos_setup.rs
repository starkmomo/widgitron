use tauri::AppHandle;

use crate::config_store;
use crate::models::AppConfig;

const WIDGETS: [(&str, &str); 4] = [
    ("widget-gpu-default", "theme-gpu-default"),
    ("widget-deadlines-default", "theme-deadline-default"),
    ("widget-arxiv-default", "theme-arxiv-default"),
    ("widget-quota-default", "theme-quota-default"),
];

pub fn apply_first_run_defaults(app: &AppHandle) -> Result<(), String> {
    let mut config = config_store::read_config::<AppConfig>(app, "app_config.json");
    let setup_version = config.macos_setup_version.unwrap_or_default();
    if setup_version >= 3 {
        return Ok(());
    }

    if setup_version < 1 {
        let mut active = config.active_widgets.take().unwrap_or_default();
        let legacy_auto_opened_all = WIDGETS
            .iter()
            .all(|(widget, _)| active.get(*widget) == Some(&true));
        for (widget, _) in WIDGETS {
            if legacy_auto_opened_all {
                let explicitly_pinned = config
                    .always_on_top
                    .as_ref()
                    .and_then(|values| values.get(widget))
                    .copied()
                    .unwrap_or(false);
                active.insert(widget.to_string(), explicitly_pinned);
            } else {
                active.entry(widget.to_string()).or_insert(false);
            }
        }
        config.active_widgets = Some(active);

        if config.language.is_none() {
            config.language = Some("zh-CN".into());
        }
        if let Some(theme) = config.sidebar_theme.as_mut() {
            if theme.background_opacity == Some(0.84) {
                theme.background_opacity = Some(0.96);
            }
            if theme.header_opacity == Some(0.9) {
                theme.header_opacity = Some(0.98);
            }
            if theme.card_opacity == Some(0.76) {
                theme.card_opacity = Some(0.94);
            }
        }

        let mut themes = config_store::read_theme_config(app);
        for (widget, opaque_theme) in WIDGETS {
            if themes
                .assignments
                .get(widget)
                .is_some_and(|theme| theme.ends_with("-transparent"))
            {
                themes
                    .assignments
                    .insert(widget.to_string(), opaque_theme.to_string());
            }
        }
        config_store::write_theme_config(app, &themes)?;
        config.macos_setup_version = Some(1);
        config_store::write_config(app, "app_config.json", &config)?;
    }

    // Version 1 replaced the old white transparent appearance with the dark
    // presets. Correct that migration only when all four assignments still
    // match the generated defaults, leaving mixed/custom choices untouched.
    if setup_version < 2 {
        let mut themes = config_store::read_theme_config(app);
        let all_dark_defaults = WIDGETS.iter().all(|(widget, dark_theme)| {
            themes.assignments.get(*widget).map(String::as_str) == Some(*dark_theme)
        });
        if all_dark_defaults {
            for (widget, dark_theme) in WIDGETS {
                themes
                    .assignments
                    .insert(widget.into(), dark_theme.replace("-default", "-light"));
            }
            config_store::write_theme_config(app, &themes)?;
        }
    }
    apply_desktop_widget_defaults(&mut config);
    config.macos_setup_version = Some(3);
    config_store::write_config(app, "app_config.json", &config)
}

fn apply_desktop_widget_defaults(config: &mut AppConfig) {
    // Ordinary floating windows become desktop widgets. Preserve an explicit
    // always-on-top choice, along with visibility, geometry and appearance.
    for (widget, _) in WIDGETS {
        let pinned = config.always_on_top.as_ref()
            .and_then(|values| values.get(widget)).copied().unwrap_or(false);
        config.embedded.get_or_insert_with(Default::default)
            .insert(widget.to_string(), !pinned);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn desktop_default_migrates_ordinary_windows_and_preserves_pinned_widgets() {
        let mut config = AppConfig::default();
        config.always_on_top.as_mut().unwrap().insert("widget-gpu-default".into(), true);
        config.embedded.as_mut().unwrap().insert("widget-quota-default".into(), false);
        config.embedded.as_mut().unwrap().insert("widget-gpu-default".into(), true);
        let visible = config.active_widgets.clone();
        apply_desktop_widget_defaults(&mut config);
        apply_desktop_widget_defaults(&mut config);
        for (widget, _) in WIDGETS {
            assert_eq!(config.embedded.as_ref().unwrap().get(widget), Some(&(widget != "widget-gpu-default")));
        }
        assert_eq!(config.always_on_top.as_ref().unwrap().get("widget-gpu-default"), Some(&true));
        assert_eq!(config.active_widgets, visible);
    }
}
