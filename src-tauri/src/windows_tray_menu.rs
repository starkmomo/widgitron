//! A persistent Windows menu. Updating entries never replaces its HMENU.
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::AppHandle;

pub(crate) struct TrayItems {
    pub(crate) menu: Menu<tauri::Wry>,
    sidebar: MenuItem<tauri::Wry>,
    dashboard: MenuItem<tauri::Wry>,
    widgets: MenuItem<tauri::Wry>,
    quit: MenuItem<tauri::Wry>,
}

impl TrayItems {
    pub(crate) fn new(app: &AppHandle, labels: &[(&str, &str)]) -> tauri::Result<Self> {
        let sidebar = MenuItem::with_id(app, labels[0].0, labels[0].1, true, None::<&str>)?;
        let dashboard = MenuItem::with_id(app, labels[1].0, labels[1].1, true, None::<&str>)?;
        let widgets =
            MenuItem::with_id(app, "win_tray_widgets", "Hide Widgets", true, None::<&str>)?;
        let quit = MenuItem::with_id(
            app,
            "win_tray_quit",
            labels.last().unwrap().1,
            true,
            None::<&str>,
        )?;
        let menu = Menu::with_items(app, &[&sidebar, &dashboard])?;
        if let Some((_, label)) = labels.iter().find(|(id, _)| *id == "win_tray_widgets") {
            widgets.set_text(*label)?;
            menu.append(&widgets)?;
        }
        menu.append(&PredefinedMenuItem::separator(app)?)?;
        menu.append(&quit)?;
        Ok(Self {
            menu,
            sidebar,
            dashboard,
            widgets,
            quit,
        })
    }

    pub(crate) fn update(&self, labels: &[(&str, &str)]) -> tauri::Result<()> {
        // Keep the original HMENU alive. Replacing it from a queued right-click
        // event can destroy a popup already opened by Windows on button release.
        // Update item labels/visibility in place instead, including on config events.
        self.sidebar.set_text(labels[0].1)?;
        self.dashboard.set_text(labels[1].1)?;
        self.quit.set_text(labels.last().unwrap().1)?;
        let wanted = labels.iter().find(|(id, _)| *id == "win_tray_widgets");
        let present = self
            .menu
            .items()?
            .iter()
            .any(|item| item.id().0 == "win_tray_widgets");
        if let Some((_, label)) = wanted {
            self.widgets.set_text(*label)?;
            if !present {
                self.menu.insert(&self.widgets, 2)?;
            }
        } else if present {
            self.menu.remove(&self.widgets)?;
        }
        Ok(())
    }
}
