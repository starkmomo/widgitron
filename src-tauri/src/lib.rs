#[macro_export]
macro_rules! println {
    () => {
        log::info!("");
    };
    ($($arg:tt)*) => {
        log::info!($($arg)*);
    };
}

#[macro_export]
macro_rules! eprintln {
    () => {
        log::error!("");
    };
    ($($arg:tt)*) => {
        log::error!($($arg)*);
    };
}

use std::collections::HashMap;
use std::sync::Arc;
use tauri::Manager;
use tauri::tray::TrayIconBuilder;

mod models;
mod utils;
mod config_store;
mod desktop;
mod gpu;
mod deadlines;
mod arxiv;
mod commands;
mod logger;
mod quota;
mod vscode_secrets;
mod antigravity;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec!["--minimized"])))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            commands::create_widget,
            commands::close_widget,
            commands::toggle_widget,
            desktop::set_desktop_mode,
            commands::save_gpu_config,
            commands::save_paper_config,
            commands::get_gpu_config,
            commands::get_paper_config,
            commands::get_app_config,
            commands::save_app_config,
            commands::get_deadlines,
            commands::get_gpu_data,
            commands::show_main,
            commands::exit_app,
            commands::get_theme_config,
            commands::save_theme_config,
            commands::save_arxiv_config,
            commands::get_arxiv_config,
            commands::get_arxiv_papers,
            commands::mark_arxiv_seen,
            commands::get_arxiv_saved_papers,
            commands::get_arxiv_discarded_papers,
            commands::open_link,
            commands::remove_arxiv_saved_paper,
            commands::remove_arxiv_discarded_paper,
            commands::refresh_arxiv,
            commands::open_log_dir,
            commands::save_quota_config,
            commands::get_quota_config,
            commands::get_quota_data,
            commands::refresh_quota,
            commands::update_manual_quota,
            commands::restore_widget_position,
            commands::log_frontend_error
        ])
        .setup(|app| {
            // Initialize Logger & Panic Hook
            let _ = logger::init(app.handle());

            let handle = app.handle().clone();
            
            // Global State
            // Pre-load cached quota data from disk for instant widget display
            let cached_quota_items: Vec<models::QuotaItem> = {
                let mut cfg: models::QuotaConfig = config_store::read_config(&handle, "quota_config.json");
                for item in &mut cfg.items {
                    if item.provider == "antigravity" {
                        quota::group_antigravity_bars(item);
                    }
                }
                cfg.items
            };
            let state = Arc::new(models::GlobalState {
                deadlines: Arc::new(std::sync::Mutex::new(Vec::new())),
                gpu_data: Arc::new(std::sync::Mutex::new(HashMap::new())),
                last_yaml: Arc::new(std::sync::Mutex::new(None)),
                active_monitors: Arc::new(std::sync::Mutex::new(HashMap::new())),
                active_workers: Arc::new(std::sync::Mutex::new(HashMap::new())),
                arxiv_papers: Arc::new(std::sync::Mutex::new(Vec::new())),
                quota_data: Arc::new(std::sync::Mutex::new(cached_quota_items)),
                widget_toggle_lock: Arc::new(tokio::sync::Mutex::new(())),
            });
            app.manage(models::GlobalState {
                deadlines: state.deadlines.clone(),
                gpu_data: state.gpu_data.clone(),
                last_yaml: state.last_yaml.clone(),
                active_monitors: state.active_monitors.clone(),
                active_workers: state.active_workers.clone(),
                arxiv_papers: state.arxiv_papers.clone(),
                quota_data: state.quota_data.clone(),
                widget_toggle_lock: state.widget_toggle_lock.clone(),
            });
            
            // Tray
            let mut tray_builder = TrayIconBuilder::new()
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, event| {
                    use tauri::tray::{TrayIconEvent, MouseButton};
                    match event {
                        TrayIconEvent::Click { button: MouseButton::Right, .. } => {
                            if let Some(window) = tray.app_handle().get_webview_window("tray-menu") {
                                // Get cursor position to place the menu
                                use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;
                                use windows::Win32::Foundation::POINT;
                                let mut pt = POINT::default();
                                unsafe { let _ = GetCursorPos(&mut pt); }
                                
                                // Find the scale factor of the monitor containing the cursor position
                                let mut scale_factor = 1.0;
                                let mut monitor_pos = tauri::PhysicalPosition::<i32>::new(0, 0);
                                let mut monitor_size = tauri::PhysicalSize::<u32>::new(1920, 1080);
                                let mut found_monitor = false;
                                
                                if let Ok(monitors) = tray.app_handle().available_monitors() {
                                    for m in &monitors {
                                        let pos = m.position();
                                        let size = m.size();
                                        let x = pt.x;
                                        let y = pt.y;
                                        if x >= pos.x && x < pos.x + size.width as i32 &&
                                           y >= pos.y && y < pos.y + size.height as i32 {
                                            scale_factor = m.scale_factor();
                                            monitor_pos = *pos;
                                            monitor_size = *size;
                                            found_monitor = true;
                                            break;
                                        }
                                    }
                                    
                                    // Fallback to primary monitor if cursor is outside all monitors
                                    if !found_monitor {
                                        if let Ok(Some(m)) = tray.app_handle().primary_monitor() {
                                            scale_factor = m.scale_factor();
                                            monitor_pos = *m.position();
                                            monitor_size = *m.size();
                                        }
                                    }
                                }

                                let physical_width = (140.0 * scale_factor) as i32;
                                let physical_height = (70.0 * scale_factor) as i32;

                                // Adjust X so the window doesn't overflow the right edge of the monitor
                                let mut x = pt.x;
                                if x + physical_width > monitor_pos.x + monitor_size.width as i32 {
                                    x = monitor_pos.x + monitor_size.width as i32 - physical_width;
                                }
                                if x < monitor_pos.x {
                                    x = monitor_pos.x;
                                }

                                // Adjust Y so the window doesn't overflow the bottom or top of the monitor
                                let mut y = pt.y - physical_height;
                                if y + physical_height > monitor_pos.y + monitor_size.height as i32 {
                                    y = monitor_pos.y + monitor_size.height as i32 - physical_height;
                                }
                                if y < monitor_pos.y {
                                    y = monitor_pos.y;
                                }

                                // Apply size first so Windows/Tauri knows the dimensions before placing it
                                let _ = window.set_size(tauri::Size::Physical(tauri::PhysicalSize::new(physical_width as u32, physical_height as u32)));
                                
                                // Set position
                                let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
                                
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        },
                        TrayIconEvent::Click { button: MouseButton::Left, .. } => {
                             // Left click can also toggle or do nothing, keeping it clean
                        },
                        TrayIconEvent::DoubleClick { button: MouseButton::Left, .. } => {
                            if let Some(window) = tray.app_handle().get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        },
                        _ => {}
                    }
                });

            if let Some(icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(icon.clone());
            }
            let _tray = tray_builder.build(&handle)?;

            // Bug fix: Explicitly hide tray-menu window on startup
            if let Some(tray_menu) = app.get_webview_window("tray-menu") {
                let _ = tray_menu.hide();
            }

            // Background Workers
            let app_clone1 = handle.clone();
            let state_clone1 = state.clone();
            tauri::async_runtime::spawn(async move {
                gpu::start_gpu_monitor(app_clone1, state_clone1).await;
            });

            let app_clone2 = handle.clone();
            let state_clone2 = state.clone();
            tauri::async_runtime::spawn(async move {
                deadlines::start_paper_monitor(app_clone2, state_clone2).await;
            });

            let app_clone4 = handle.clone();
            let state_clone4 = state.clone();
            tauri::async_runtime::spawn(async move {
                quota::start_quota_monitor(app_clone4, state_clone4).await;
            });

            // Auto-start Widgets (respecting Master Switch)
            let app_config = config_store::read_config::<models::AppConfig>(&handle, "app_config.json");

            // Ensure Main Window is visible (or hidden based on config)
            if let Some(main_win) = handle.get_webview_window("main") {
                if !app_config.hide_on_startup.unwrap_or(false) {
                    let _ = main_win.show();
                    let _ = main_win.set_focus();
                } else {
                    let _ = main_win.hide();
                }
            }
            
            let handle_gpu = handle.clone();
            let handle_deadline = handle.clone();
            let handle_arxiv = handle.clone();
            let handle_quota = handle.clone();
            
            tauri::async_runtime::spawn(async move {
                let active_map = app_config.active_widgets.unwrap_or_default();
                if app_config.gpu_enabled.unwrap_or(true) && *active_map.get("widget-gpu-default").unwrap_or(&true) {
                    let _ = commands::create_widget_impl(handle_gpu, "widget-gpu-default".into(), "GPU Monitor".into()).await;
                }
                if app_config.deadline_enabled.unwrap_or(true) && *active_map.get("widget-deadlines-default").unwrap_or(&true) {
                    let _ = commands::create_widget_impl(handle_deadline, "widget-deadlines-default".into(), "Deadlines".into()).await;
                }
                if app_config.arxiv_enabled.unwrap_or(true) && *active_map.get("widget-arxiv-default").unwrap_or(&true) {
                    let _ = commands::create_widget_impl(handle_arxiv, "widget-arxiv-default".into(), "Arxiv Radar".into()).await;
                }
                if app_config.quota_enabled.unwrap_or(true) && *active_map.get("widget-quota-default").unwrap_or(&true) {
                    let _ = commands::create_widget_impl(handle_quota, "widget-quota-default".into(), "Quota Monitor".into()).await;
                }
            });

            let app_clone3 = handle.clone();
            let state_clone3 = state.clone();
            tauri::async_runtime::spawn(async move {
                arxiv::start_arxiv_monitor(app_clone3, state_clone3).await;
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_)) {
                use tauri_plugin_window_state::{AppHandleExt, StateFlags};
                let _ = window.app_handle().save_window_state(StateFlags::all());
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
