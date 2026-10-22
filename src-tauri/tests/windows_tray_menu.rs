#![cfg(windows)]
#[path = "../src/windows_tray_menu.rs"]
mod windows_tray_menu;
use windows_tray_menu::TrayItems;

fn labels(zh: bool, selected: bool, hidden: bool) -> Vec<(&'static str, &'static str)> {
    let mut items = vec![
        ("win_tray_sidebar", if zh { "侧边栏" } else { "Sidebar" }),
        (
            "win_tray_dashboard",
            if zh { "主界面" } else { "Dashboard" },
        ),
    ];
    if selected {
        items.push((
            "win_tray_widgets",
            if hidden {
                "Show Widgets"
            } else {
                "Hide Widgets"
            },
        ));
    }
    items.push(("win_tray_quit", if zh { "退出" } else { "Quit" }));
    items
}

#[test]
fn refreshing_native_menu_preserves_its_handle_and_quit_item() {
    use tauri::menu::ContextMenu;
    use windows::Win32::UI::WindowsAndMessaging::{GetMenuItemCount, GetMenuItemID, IsMenu, HMENU};
    // Build only a runtime/manager: no webviews, tray icons, config files or
    // user windows. Inspect real HMENUs as their contents change.
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    let app = tauri::Builder::default()
        .any_thread()
        .build(context)
        .expect("test runtime");
    let items = TrayItems::new(app.handle(), &labels(false, false, false)).expect("native menu");
    let original = items.menu.hpopupmenu().expect("HMENU");
    let native = HMENU(original as *mut _);
    let quit_id = unsafe { GetMenuItemID(native, GetMenuItemCount(Some(native)) - 1) };
    for language in ["zh-CN", "en", "zh-CN"] {
        for selected in [true, false, true] {
            for hidden in [true, false] {
                items
                    .update(&labels(language != "en", selected, hidden))
                    .expect("update native menu");
                assert_eq!(items.menu.hpopupmenu().unwrap(), original);
                unsafe {
                    assert!(
                        IsMenu(native).as_bool(),
                        "the open popup's HMENU must remain alive"
                    );
                    let count = GetMenuItemCount(Some(native));
                    assert_eq!(count, if selected { 5 } else { 4 });
                    assert_eq!(GetMenuItemID(native, count - 1), quit_id);
                }
            }
        }
    }
}
