//! Windows owns the popup's layout, DPI scaling and screen-edge placement.
//! A dynamic widget row must never push Quit outside a fixed-size webview.
use crate::windows_tray_menu::TrayItems;
use tauri::menu::{Menu, MenuEvent};
use tauri::{AppHandle, Manager};

use crate::{commands, config_store, models, widget_visibility};

pub const TRAY_ID: &str = "windows-main-tray";

fn entries(config: &models::AppConfig, expanded: bool) -> Vec<(&'static str, &'static str)> {
    let zh = config.language.as_deref() != Some("en");
    let mut entries = vec![
        (
            "win_tray_sidebar",
            match (zh, expanded) {
                (true, true) => "隐藏侧边栏",
                (true, false) => "打开侧边栏",
                (false, true) => "Hide Sidebar",
                (false, false) => "Open Sidebar",
            },
        ),
        (
            "win_tray_dashboard",
            if zh { "打开主界面" } else { "Dashboard" },
        ),
    ];
    if !widget_visibility::selected_widgets(config).is_empty() {
        let hidden = config.widgets_hidden.unwrap_or(false);
        entries.push((
            "win_tray_widgets",
            match (zh, hidden) {
                (true, true) => "显示浮窗",
                (true, false) => "隐藏浮窗",
                (false, true) => "Show Widgets",
                (false, false) => "Hide Widgets",
            },
        ));
    }
    entries.push(("win_tray_quit", if zh { "退出" } else { "Quit" }));
    entries
}

pub fn create_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let config = config_store::read_config::<models::AppConfig>(app, "app_config.json");
    let expanded = crate::sidebar_dock::get_state(app)
        .map(|state| state.expanded)
        .unwrap_or(false);
    let items = TrayItems::new(app, &entries(&config, expanded))?;
    let menu = items.menu.clone();
    app.manage(items);
    Ok(menu)
}

pub fn refresh(app: &AppHandle) {
    let Some(items) = app.try_state::<TrayItems>() else {
        return;
    };
    let config = config_store::read_config::<models::AppConfig>(app, "app_config.json");
    let expanded = crate::sidebar_dock::get_state(app)
        .map(|state| state.expanded)
        .unwrap_or(false);
    if let Err(error) = items.update(&entries(&config, expanded)) {
        log::warn!("Could not refresh tray menu: {error}");
    }
}

pub fn handle_menu_event(app: &AppHandle, event: MenuEvent) {
    let app = app.clone();
    match event.id().0.as_str() {
        "win_tray_quit" => app.exit(0),
        "win_tray_sidebar" => {
            tauri::async_runtime::spawn(async move {
                if let Err(error) = commands::toggle_sidebar_visibility(app).await {
                    log::warn!("Tray sidebar action failed: {error}");
                }
            });
        }
        "win_tray_dashboard" => {
            tauri::async_runtime::spawn(async move {
                if let Err(error) = commands::show_main(app).await {
                    log::warn!("Tray dashboard action failed: {error}");
                }
            });
        }
        "win_tray_widgets" => {
            tauri::async_runtime::spawn(async move {
                let state = app.state::<models::GlobalState>();
                if let Err(error) = commands::toggle_widgets_visibility(app.clone(), state).await {
                    log::warn!("Tray widget action failed: {error}");
                }
            });
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quit_stays_visible_with_no_widgets_shown_widgets_and_hidden_widgets() {
        for language in ["zh-CN", "en"] {
            for selected in [false, true] {
                for hidden in [false, true] {
                    let config: models::AppConfig = serde_json::from_value(serde_json::json!({
                        "language": language,
                        "active_widgets": { "widget-quota-default": selected },
                        "widgets_hidden": hidden
                    }))
                    .expect("config");
                    let items = entries(&config, false);
                    assert_eq!(
                        items.last(),
                        Some(&(
                            "win_tray_quit",
                            if language == "en" { "Quit" } else { "退出" }
                        ))
                    );
                    assert_eq!(items.len(), if selected { 4 } else { 3 });
                    assert_eq!(
                        items
                            .iter()
                            .filter(|item| item.0 == "win_tray_widgets")
                            .count(),
                        usize::from(selected)
                    );
                    if selected {
                        assert_eq!(
                            items[2].1,
                            match (language, hidden) {
                                ("en", true) => "Show Widgets",
                                ("en", false) => "Hide Widgets",
                                (_, true) => "显示浮窗",
                                (_, false) => "隐藏浮窗",
                            }
                        );
                    }
                }
            }
        }
    }
}
