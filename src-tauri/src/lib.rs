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
use tauri::tray::TrayIconBuilder;
use tauri::Manager;

mod antigravity;
mod arxiv;
mod commands;
mod config_store;
mod deadlines;
mod desktop;
mod gpu;
mod logger;
#[cfg(target_os = "macos")]
mod macos_setup;
#[cfg(target_os = "macos")]
mod macos_tray;
#[cfg(target_os = "macos")]
mod macos_widget_snapshot;
mod models;
mod ota;
mod quota;
mod quota_analytics;
mod secrets;
#[cfg(windows)]
mod sidebar_dock;
#[cfg(not(windows))]
#[path = "sidebar_dock_portable.rs"]
mod sidebar_dock;
#[cfg(windows)]
mod sidebar_hotkey;
#[cfg(not(windows))]
#[path = "sidebar_hotkey_portable.rs"]
mod sidebar_hotkey;
mod sqlite_state;
mod ui_scale;
mod utils;
mod vscode_secrets;
mod widget_layout;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_filter(|label| label == "main")
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::SIZE
                        | tauri_plugin_window_state::StateFlags::POSITION
                        | tauri_plugin_window_state::StateFlags::MAXIMIZED,
                )
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            commands::create_widget,
            commands::close_widget,
            commands::hide_all_widgets,
            commands::toggle_widget,
            desktop::set_desktop_mode,
            commands::save_gpu_config,
            commands::save_paper_config,
            commands::get_gpu_config,
            commands::ssh_config_has_host,
            commands::get_paper_config,
            commands::get_app_config,
            commands::save_app_config,
            commands::save_sidebar_tile_layout,
            commands::set_widget_always_on_top,
            commands::set_widget_desktop_fixed,
            commands::get_deadlines,
            commands::refresh_paper_deadlines,
            commands::get_gpu_data,
            commands::refresh_gpu_data,
            commands::show_main,
            commands::show_sidebar,
            commands::hide_sidebar,
            commands::toggle_sidebar_visibility,
            commands::get_native_quota_widget_status,
            commands::toggle_sidebar,
            commands::get_sidebar_state,
            commands::set_sidebar_pinned,
            commands::begin_sidebar_drag,
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
            commands::open_config_dir,
            commands::get_config_dir_path,
            commands::get_corrupt_config_files,
            commands::save_quota_config,
            commands::get_quota_config,
            commands::get_quota_data,
            commands::refresh_quota,
            commands::update_manual_quota,
            commands::get_antigravity_setup_status,
            commands::restore_widget_position,
            commands::log_frontend_error,
            ota::check_for_updates,
            ota::download_and_install_update
        ])
        .setup(|app| {
            // Initialize Logger & Panic Hook
            let _ = logger::init(app.handle());

            let handle = app.handle().clone();
            let config_dir = crate::utils::get_config_dir(&handle);
            crate::utils::ensure_default_configs(&handle);
            config_store::seed_default_theme_config_if_missing(&handle);
            #[cfg(target_os = "macos")]
            if let Err(err) = macos_setup::apply_first_run_defaults(&handle) {
                log::warn!("Failed to apply macOS display defaults: {err}");
            }
            log::info!("Using config directory: {}", config_dir.display());
            #[cfg(target_os = "macos")]
            if let Err(error) = macos_widget_snapshot::start_snapshot_server(&handle) {
                log::warn!("Failed to start local macOS widget feed: {error}");
            }

            // Global State
            // Pre-load cached quota data from disk for instant widget display
            let cached_quota_items: Vec<models::QuotaItem> = {
                let mut cfg = quota::read_quota_config(&handle);
                #[cfg(target_os = "macos")]
                if let Err(error) = macos_widget_snapshot::publish_quota_snapshot(&handle, &cfg) {
                    log::warn!("Failed to publish macOS quota widget snapshot: {error}");
                }
                for item in &mut cfg.items {
                    if item.provider == "antigravity" {
                        quota::group_antigravity_bars(item);
                    }
                }
                cfg.items
            };
            let cached_deadlines: Vec<models::PaperDeadlineInfo> =
                config_store::read_config(&handle, "paper_deadlines_cache.json");
            let cached_arxiv: Vec<models::ArxivPaper> =
                config_store::read_config(&handle, "arxiv_cache.json");
            let cached_gpu = gpu::load_gpu_cache(&handle);
            #[cfg(target_os = "macos")]
            {
                let gpu_config = gpu::read_gpu_config(&handle);
                if let Err(error) = macos_widget_snapshot::publish_gpu_snapshot(&handle, &gpu_config, &cached_gpu) {
                    log::warn!("Failed to publish macOS GPU widget snapshot: {error}");
                }
                let paper_config = config_store::read_config::<models::PaperConfig>(&handle, "paper_deadline.json");
                if let Err(error) = macos_widget_snapshot::publish_deadline_snapshot(&handle, &paper_config, &cached_deadlines) {
                    log::warn!("Failed to publish macOS deadline widget snapshot: {error}");
                }
            }
            let state = Arc::new(models::GlobalState {
                deadlines: Arc::new(std::sync::Mutex::new(cached_deadlines)),
                gpu_data: Arc::new(std::sync::Mutex::new(cached_gpu)),
                gpu_last_emitted: Arc::new(std::sync::Mutex::new(HashMap::new())),
                last_yaml: Arc::new(std::sync::Mutex::new(None)),
                active_monitors: Arc::new(std::sync::Mutex::new(HashMap::new())),
                active_workers: Arc::new(std::sync::Mutex::new(HashMap::new())),
                arxiv_papers: Arc::new(std::sync::Mutex::new(cached_arxiv)),
                quota_data: Arc::new(std::sync::Mutex::new(cached_quota_items)),
                quota_fetch_lock: Arc::new(tokio::sync::Mutex::new(())),
                widget_toggle_lock: Arc::new(tokio::sync::Mutex::new(())),
            });
            app.manage(models::GlobalState {
                deadlines: state.deadlines.clone(),
                gpu_data: state.gpu_data.clone(),
                gpu_last_emitted: state.gpu_last_emitted.clone(),
                last_yaml: state.last_yaml.clone(),
                active_monitors: state.active_monitors.clone(),
                active_workers: state.active_workers.clone(),
                arxiv_papers: state.arxiv_papers.clone(),
                quota_data: state.quota_data.clone(),
                quota_fetch_lock: state.quota_fetch_lock.clone(),
                widget_toggle_lock: state.widget_toggle_lock.clone(),
            });
            app.manage(widget_layout::WidgetLayoutSaveState::default());
            widget_layout::spawn_monitor_watchdog(handle.clone());

            // Emit preloaded cache to widgets that connect shortly after startup
            // (removed: each monitor emits its own cache; avoids startup event storm)

            // Tray
            #[cfg(target_os = "macos")]
            {
                let menu = macos_tray::create_menu(&handle)?;
                let context_menu = menu.clone();
                let mut tray_builder = TrayIconBuilder::new()
                    .show_menu_on_left_click(false)
                    .on_menu_event(macos_tray::handle_menu_event)
                    .on_tray_icon_event(move |tray, event| {
                        use tauri::tray::{MouseButton, MouseButtonState, TrayIconEvent};
                        match event {
                            TrayIconEvent::Click {
                                button: MouseButton::Left,
                                button_state: MouseButtonState::Down,
                                ..
                            } => {
                                let app = tray.app_handle().clone();
                                tauri::async_runtime::spawn(async move {
                                    let _ = commands::show_main(app).await;
                                });
                            }
                            TrayIconEvent::Click {
                                button: MouseButton::Right,
                                button_state: MouseButtonState::Down,
                                ..
                            } => {
                                macos_tray::refresh(tray.app_handle());
                                if let Some(window) = tray.app_handle().get_webview_window("main") {
                                    if let Err(error) = window.popup_menu(&context_menu) {
                                        log::warn!("Failed to open macOS menu bar menu: {error}");
                                    }
                                }
                            }
                            _ => {}
                        }
                    });
                // Derived from icon.png with its opaque background removed for macOS tinting.
                let tray_icon =
                    tauri::image::Image::from_bytes(include_bytes!("../icons/tray-template.png"))?;
                tray_builder = tray_builder.icon(tray_icon).icon_as_template(true);
                let tray = tray_builder.build(&handle)?;
                tray.set_show_menu_on_left_click(false)?;
            }

            #[cfg(not(target_os = "macos"))]
            {
                let mut tray_builder = TrayIconBuilder::new()
                    .show_menu_on_left_click(false)
                    .on_tray_icon_event(|tray, event| {
                        use tauri::tray::{MouseButton, MouseButtonState, TrayIconEvent};
                        match event {
                            TrayIconEvent::Click {
                                button: MouseButton::Right,
                                button_state: MouseButtonState::Down,
                                position,
                                ..
                            } => {
                                if let Some(window) =
                                    tray.app_handle().get_webview_window("tray-menu")
                                {
                                    // Find the scale factor of the monitor containing the cursor position
                                    let mut scale_factor = 1.0;
                                    let mut monitor_pos = tauri::PhysicalPosition::<i32>::new(0, 0);
                                    let mut monitor_size =
                                        tauri::PhysicalSize::<u32>::new(1920, 1080);
                                    let mut found_monitor = false;

                                    if let Ok(monitors) = tray.app_handle().available_monitors() {
                                        for m in &monitors {
                                            let pos = m.position();
                                            let size = m.size();
                                            let x = position.x as i32;
                                            let y = position.y as i32;
                                            if x >= pos.x
                                                && x < pos.x + size.width as i32
                                                && y >= pos.y
                                                && y < pos.y + size.height as i32
                                            {
                                                scale_factor = m.scale_factor();
                                                monitor_pos = *pos;
                                                monitor_size = *size;
                                                found_monitor = true;
                                                break;
                                            }
                                        }

                                        // Fallback to primary monitor if cursor is outside all monitors
                                        if !found_monitor {
                                            if let Ok(Some(m)) = tray.app_handle().primary_monitor()
                                            {
                                                scale_factor = m.scale_factor();
                                                monitor_pos = *m.position();
                                                monitor_size = *m.size();
                                            }
                                        }
                                    }

                                    let physical_width = (150.0 * scale_factor) as i32;
                                    let physical_height = (104.0 * scale_factor) as i32;

                                    // Adjust X so the window doesn't overflow the right edge of the monitor
                                    let mut x = position.x as i32;
                                    if x + physical_width
                                        > monitor_pos.x + monitor_size.width as i32
                                    {
                                        x = monitor_pos.x + monitor_size.width as i32
                                            - physical_width;
                                    }
                                    if x < monitor_pos.x {
                                        x = monitor_pos.x;
                                    }

                                    // Adjust Y so the window doesn't overflow the bottom or top of the monitor
                                    let mut y = position.y as i32 - physical_height;
                                    if y + physical_height
                                        > monitor_pos.y + monitor_size.height as i32
                                    {
                                        y = monitor_pos.y + monitor_size.height as i32
                                            - physical_height;
                                    }
                                    if y < monitor_pos.y {
                                        y = monitor_pos.y;
                                    }

                                    // Apply size first so Windows/Tauri knows the dimensions before placing it
                                    let _ = window.set_size(tauri::Size::Physical(
                                        tauri::PhysicalSize::new(
                                            physical_width as u32,
                                            physical_height as u32,
                                        ),
                                    ));

                                    // Set position
                                    let _ = window.set_position(tauri::PhysicalPosition::new(x, y));

                                    let _ = window.show();
                                    let _ = window.set_focus();
                                }
                            }
                            TrayIconEvent::Click {
                                button: MouseButton::Left,
                                button_state: MouseButtonState::Down,
                                ..
                            } => {
                                let app_handle = tray.app_handle().clone();
                                tauri::async_runtime::spawn(async move {
                                    let _ = commands::show_main(app_handle).await;
                                });
                            }
                            TrayIconEvent::DoubleClick {
                                button: MouseButton::Left,
                                ..
                            } => {
                                let app_handle = tray.app_handle().clone();
                                tauri::async_runtime::spawn(async move {
                                    let _ = commands::show_main(app_handle).await;
                                });
                            }
                            _ => {}
                        }
                    });

                if let Some(icon) = app.default_window_icon() {
                    tray_builder = tray_builder.icon(icon.clone());
                }
                let _tray = tray_builder.build(&handle)?;
            }

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
            let app_config =
                config_store::read_config::<models::AppConfig>(&handle, "app_config.json");
            sidebar_hotkey::start_global_sidebar_hotkey(
                handle.clone(),
                app_config.sidebar_hotkey.clone(),
            );
            if let Err(err) = sidebar_dock::start(handle.clone(), &app_config) {
                log::warn!("Failed to initialize sidebar docking: {}", err);
            }

            let handle_main = handle.clone();
            let handle_gpu = handle.clone();
            let handle_deadline = handle.clone();
            let handle_arxiv = handle.clone();
            let handle_quota = handle.clone();

            // Ensure Main Window is visible (or hidden based on config).
            // NOTE: We intentionally delay this by 200ms to ensure tauri-plugin-window-state's
            // async restore callback (on_webview_created) has already fired before we show/hide.
            // Without the delay, window-state may re-apply an old `visible: false` after our show().
            let hide_on_startup = app_config.hide_on_startup.unwrap_or(false);
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_millis(200)).await;
                log::warn!(
                    "[DIAG] Attempting to show main window (hide_on_startup={})",
                    hide_on_startup
                );
                match handle_main.get_webview_window("main") {
                    None => log::warn!("[DIAG] get_webview_window('main') returned None!"),
                    Some(main_win) => {
                        // Saved window state can restore a size from before the minimum
                        // changed. Reapply it after the plugin finishes restoring.
                        let min_size = tauri::LogicalSize::new(900.0, 680.0);
                        let _ = main_win.set_min_size(Some(tauri::Size::Logical(min_size)));
                        if let (Ok(size), Ok(scale)) = (main_win.inner_size(), main_win.scale_factor()) {
                            let size = size.to_logical::<f64>(scale);
                            if size.width < min_size.width || size.height < min_size.height {
                                let _ = main_win.set_size(tauri::Size::Logical(tauri::LogicalSize::new(
                                    size.width.max(min_size.width),
                                    size.height.max(min_size.height),
                                )));
                            }
                        }
                        // Log current position before showing
                        let pos_before = main_win.outer_position();
                        let size_before = main_win.outer_size();
                        log::warn!(
                            "[DIAG] main window found, is_visible={:?} pos={:?} size={:?}",
                            main_win.is_visible(),
                            pos_before,
                            size_before
                        );

                        if !hide_on_startup {
                            let _ = main_win.unminimize();
                            let _ = main_win.show();

                            // Force window onto primary monitor to recover from off-screen position
                            if let Ok(Some(monitor)) = main_win.primary_monitor() {
                                let mon_pos = monitor.position();
                                let mon_size = monitor.size();
                                let scale = monitor.scale_factor();
                                let current_size = main_win.outer_size().unwrap_or_else(|_| {
                                    tauri::PhysicalSize::new(
                                        (1000.0 * scale) as u32,
                                        (740.0 * scale) as u32,
                                    )
                                });
                                let win_w = current_size.width as i32;
                                let win_h = current_size.height as i32;
                                let center_x = mon_pos.x + (mon_size.width as i32 - win_w) / 2;
                                let center_y = mon_pos.y + (mon_size.height as i32 - win_h) / 2;
                                log::warn!(
                                    "[DIAG] Moving main window to center: ({},{}) {}x{}",
                                    center_x,
                                    center_y,
                                    win_w,
                                    win_h
                                );
                                let _ = main_win
                                    .set_position(tauri::PhysicalPosition::new(center_x, center_y));
                            }

                            let _ = main_win.set_focus();
                            log::warn!(
                                "[DIAG] is_visible_after={:?} pos_after={:?}",
                                main_win.is_visible(),
                                main_win.outer_position()
                            );
                        } else {
                            let _ = main_win.hide();
                        }
                    }
                }
            });

            tauri::async_runtime::spawn(async move {
                let active_map = app_config.active_widgets.unwrap_or_default();
                let default_visible = cfg!(windows);
                tokio::time::sleep(std::time::Duration::from_millis(900)).await;

                if app_config.gpu_enabled.unwrap_or(true)
                    && *active_map
                        .get("widget-gpu-default")
                        .unwrap_or(&default_visible)
                {
                    let _ = commands::create_widget_impl_background(
                        handle_gpu,
                        "widget-gpu-default".into(),
                        "GPU Monitor".into(),
                    )
                    .await;
                    tokio::time::sleep(std::time::Duration::from_millis(250)).await;
                }
                if app_config.deadline_enabled.unwrap_or(true)
                    && *active_map
                        .get("widget-deadlines-default")
                        .unwrap_or(&default_visible)
                {
                    let _ = commands::create_widget_impl_background(
                        handle_deadline,
                        "widget-deadlines-default".into(),
                        "Deadlines".into(),
                    )
                    .await;
                    tokio::time::sleep(std::time::Duration::from_millis(250)).await;
                }
                if app_config.arxiv_enabled.unwrap_or(true)
                    && *active_map
                        .get("widget-arxiv-default")
                        .unwrap_or(&default_visible)
                {
                    let _ = commands::create_widget_impl_background(
                        handle_arxiv,
                        "widget-arxiv-default".into(),
                        "Arxiv Radar".into(),
                    )
                    .await;
                    tokio::time::sleep(std::time::Duration::from_millis(250)).await;
                }
                if app_config.quota_enabled.unwrap_or(true)
                    && *active_map
                        .get("widget-quota-default")
                        .unwrap_or(&default_visible)
                {
                    let _ = commands::create_widget_impl_background(
                        handle_quota,
                        "widget-quota-default".into(),
                        "Quota Monitor".into(),
                    )
                    .await;
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
            let label = window.label().to_string();
            #[cfg(target_os = "macos")]
            if label == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                    return;
                }
            }
            if label == "main"
                && matches!(
                    event,
                    tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_)
                )
            {
                use tauri_plugin_window_state::{AppHandleExt, StateFlags};
                let flags = StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED;
                let _ = window.app_handle().save_window_state(flags);
                return;
            }

            if !widget_layout::is_tracked_widget(&label) {
                return;
            }

            match event {
                tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) => {
                    widget_layout::schedule_layout_persist(window.app_handle().clone(), label);
                }
                tauri::WindowEvent::CloseRequested { .. } => {
                    let _ = widget_layout::persist_layout_now(&window.app_handle(), &label);
                }
                _ => {}
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            let open_main = match event {
                tauri::RunEvent::Reopen { has_visible_windows: false, .. } => true,
                tauri::RunEvent::Opened { urls } => urls.iter().any(|url| {
                    url.scheme() == "widgitron" && url.host_str() == Some("open")
                }),
                _ => false,
            };
            #[cfg(target_os = "macos")]
            if open_main {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        });
}
