use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tauri::{AppHandle, Manager};

use crate::{commands, config_store, models};

struct TrayItems {
    menu: Menu<tauri::Wry>,
    dashboard: MenuItem<tauri::Wry>,
    sidebar: MenuItem<tauri::Wry>,
    hide_widgets: MenuItem<tauri::Wry>,
    quit: MenuItem<tauri::Wry>,
}

fn chinese(app: &AppHandle) -> bool {
    config_store::read_config::<models::AppConfig>(app, "app_config.json")
        .language
        .as_deref()
        != Some("en")
}

pub fn create_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let zh = chinese(app);
    let pinned = config_store::read_config::<models::AppConfig>(app, "app_config.json")
        .sidebar_pinned
        .unwrap_or(false);
    let dashboard = MenuItem::with_id(
        app,
        "tray_dashboard",
        if zh {
            "打开主界面"
        } else {
            "Open Dashboard"
        },
        true,
        None::<&str>,
    )?;
    let sidebar = MenuItem::with_id(
        app,
        "tray_sidebar",
        sidebar_label(zh, pinned),
        true,
        None::<&str>,
    )?;
    let hide_widgets = MenuItem::with_id(
        app,
        "tray_hide_widgets",
        widgets_label(zh, false),
        true,
        None::<&str>,
    )?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(
        app,
        "tray_quit",
        if zh { "退出" } else { "Quit" },
        true,
        None::<&str>,
    )?;
    let menu = Menu::with_items(
        app,
        &[&dashboard, &sidebar, &hide_widgets, &separator, &quit],
    )?;
    let config = config_store::read_config::<models::AppConfig>(app, "app_config.json");
    hide_widgets.set_text(widgets_label(zh, config.widgets_hidden.unwrap_or(false)))?;
    if crate::widget_visibility::selected_widgets(&config).is_empty() {
        menu.remove(&hide_widgets)?;
    }
    app.manage(TrayItems {
        menu: menu.clone(),
        dashboard,
        sidebar,
        hide_widgets,
        quit,
    });
    Ok(menu)
}

fn widgets_label(zh: bool, hidden: bool) -> &'static str {
    match (zh, hidden) {
        (true, true) => "显示浮窗",
        (true, false) => "隐藏浮窗",
        (false, true) => "Show Widgets",
        (false, false) => "Hide Widgets",
    }
}

fn sidebar_label(zh: bool, expanded: bool) -> &'static str {
    match (zh, expanded) {
        (true, true) => "隐藏侧边栏",
        (true, false) => "打开侧边栏",
        (false, true) => "Hide Sidebar",
        (false, false) => "Open Sidebar",
    }
}

pub fn refresh_labels(app: &AppHandle, expanded: bool) {
    let Some(items) = app.try_state::<TrayItems>() else {
        return;
    };
    let zh = chinese(app);
    let _ = items.dashboard.set_text(if zh {
        "打开主界面"
    } else {
        "Open Dashboard"
    });
    let _ = items.sidebar.set_text(sidebar_label(zh, expanded));
    let config = config_store::read_config::<models::AppConfig>(app, "app_config.json");
    let _ = items.hide_widgets.set_text(widgets_label(zh, config.widgets_hidden.unwrap_or(false)));
    let wanted = !crate::widget_visibility::selected_widgets(&config).is_empty();
    if let Ok(entries) = items.menu.items() {
        let present = entries.iter().any(|entry| entry.id().0 == "tray_hide_widgets");
        if wanted && !present {
            let _ = items.menu.insert(&items.hide_widgets, 2);
        } else if !wanted && present {
            let _ = items.menu.remove(&items.hide_widgets);
        }
    }
    let _ = items.quit.set_text(if zh { "退出" } else { "Quit" });
}

pub fn refresh(app: &AppHandle) {
    let expanded = crate::sidebar_dock::get_state(app)
        .map(|state| state.expanded)
        .unwrap_or(false);
    refresh_labels(app, expanded);
}

pub fn handle_menu_event(app: &AppHandle, event: MenuEvent) {
    match event.id().0.as_str() {
        "tray_dashboard" => {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(error) = commands::show_main(app).await {
                    log::warn!("Failed to open dashboard from menu bar: {error}");
                }
            });
        }
        "tray_sidebar" => {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(error) = commands::toggle_sidebar_visibility(app).await {
                    log::warn!("Failed to toggle sidebar from menu bar: {error}");
                }
            });
        }
        "tray_hide_widgets" => {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                let state = app.state::<models::GlobalState>();
                if let Err(error) = commands::toggle_widgets_visibility(app.clone(), state).await {
                    log::warn!("Failed to toggle widget visibility from menu bar: {error}");
                }
            });
        }
        "tray_quit" => app.exit(0),
        _ => {}
    }
}
