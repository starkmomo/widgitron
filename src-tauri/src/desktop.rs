use tauri::{AppHandle, Manager};

/// Keep desktop tools available on ordinary Spaces without covering full-screen apps.
#[cfg(target_os = "macos")]
pub fn configure_macos_desktop_spaces(native: &objc2_app_kit::NSWindow) {
    use objc2_app_kit::NSWindowCollectionBehavior;
    let conflicting = NSWindowCollectionBehavior::MoveToActiveSpace
        | NSWindowCollectionBehavior::Stationary
        | NSWindowCollectionBehavior::Transient
        | NSWindowCollectionBehavior::ParticipatesInCycle
        | NSWindowCollectionBehavior::FullScreenPrimary
        | NSWindowCollectionBehavior::FullScreenAuxiliary;
    let behavior = (native.collectionBehavior() & !conflicting)
        | NSWindowCollectionBehavior::CanJoinAllSpaces
        | NSWindowCollectionBehavior::Managed
        | NSWindowCollectionBehavior::IgnoresCycle
        | NSWindowCollectionBehavior::FullScreenNone;
    native.setCollectionBehavior(behavior);
}

/// Dragging a desktop child uses a temporary top-level window. Restore its
/// desktop layer after the native move loop, independently of position locking.
#[tauri::command]
pub async fn begin_widget_drag(app: AppHandle, label: String) -> Result<(), String> {
    if !crate::widget_layout::is_tracked_widget(&label) {
        return Err(format!("Unsupported widget label: {label}"));
    }
    let win = app.get_webview_window(&label).ok_or("Widget window not found")?;
    #[cfg(windows)]
    {
        use windows::Win32::{
            Foundation::{HWND, LPARAM, POINT, WPARAM},
            UI::{
                Input::KeyboardAndMouse::ReleaseCapture,
                WindowsAndMessaging::{GetCursorPos, SendMessageW, HTCAPTION, WM_NCLBUTTONDOWN},
            },
        };
        let (sender, receiver) = tokio::sync::oneshot::channel();
        win.clone().run_on_main_thread(move || {
            let desktop = is_desktop_mode(&app, &label);
            crate::widget_layout::suppress_layout_event_persist(&app, &label);
            let result = (|| -> Result<(), String> {
                if desktop {
                    set_desktop_mode_now(&app, &label, false)?;
                }
                let hwnd = HWND(win.hwnd().map_err(|error| error.to_string())?.0 as *mut _);
                unsafe {
                    let mut point = POINT::default();
                    GetCursorPos(&mut point).map_err(|error| error.to_string())?;
                    let _ = ReleaseCapture();
                    let position = ((point.y as u16 as u32) << 16) | point.x as u16 as u32;
                    SendMessageW(hwnd, WM_NCLBUTTONDOWN, Some(WPARAM(HTCAPTION as usize)), Some(LPARAM(position as isize)));
                }
                crate::widget_layout::persist_layout_now(&app, &label)
            })();
            let restored = if desktop { set_desktop_mode_now(&app, &label, true) } else { Ok(()) };
            let _ = sender.send(result.and(restored));
        }).map_err(|error| error.to_string())?;
        receiver.await.map_err(|error| error.to_string())?
    }
    #[cfg(not(windows))]
    {
        win.start_dragging().map_err(|error| error.to_string())
    }
}

/// Both modes join ordinary Spaces; pinning changes only the window level.
/// This is an AppKit window, not a WidgetKit extension.
#[cfg(target_os = "macos")]
pub async fn set_macos_widget_level(
    win: &tauri::WebviewWindow,
    topmost: bool,
) -> Result<(), String> {
    use objc2_app_kit::{NSFloatingWindowLevel, NSWindow};
    use objc2_core_graphics::{CGWindowLevelForKey, CGWindowLevelKey};

    let win = win.clone();
    let (sender, receiver) = tokio::sync::oneshot::channel();
    win.clone()
        .run_on_main_thread(move || {
            let result = (|| -> Result<(), String> {
                let native = win.ns_window().map_err(|error| error.to_string())?;
                if native.is_null() {
                    return Err("macOS widget has no native window".to_string());
                }
                // Tauri documents borrowing this pointer only on the main thread.
                let native: &NSWindow = unsafe { &*native.cast() };
                let level = if topmost {
                    NSFloatingWindowLevel
                } else {
                    let icon_level = CGWindowLevelForKey(CGWindowLevelKey::DesktopIconWindowLevelKey);
                    // Below Finder's full-screen icon window, clicks and drags
                    // go to Finder even though the widget remains visible.
                    (icon_level + 1) as isize
                };
                // Don't leave widgets stationary over the Spaces transition.
                // Managed lets WindowServer animate them with the desktop.
                // Full-screen applications keep their own Space undisturbed.
                configure_macos_desktop_spaces(native);
                native.setLevel(level);
                Ok(())
            })();
            let _ = sender.send(result);
        })
        .map_err(|error| error.to_string())?;
    receiver.await.map_err(|error| error.to_string())?
}

#[cfg(windows)]
unsafe extern "system" fn enum_window(
    hwnd: windows::Win32::Foundation::HWND,
    lparam: windows::Win32::Foundation::LPARAM,
) -> windows::core::BOOL {
    use windows::core::BOOL;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{FindWindowExW, GetClassNameW};

    let p_workerw = lparam.0 as *mut HWND;
    let mut class_name = [0u16; 256];
    let len = GetClassNameW(hwnd, &mut class_name);
    let name = String::from_utf16_lossy(&class_name[..len as usize]);

    if name == "WorkerW" || name == "Progman" {
        use windows::Win32::Foundation::{SetLastError, WIN32_ERROR};
        SetLastError(WIN32_ERROR(0));
        let shell_view = FindWindowExW(
            Some(hwnd),
            None,
            windows::core::w!("SHELLDLL_DefView"),
            None,
        )
        .ok();
        if shell_view.is_some() {
            // Found the window (WorkerW or Progman) that hosts SHELLDLL_DefView
            *p_workerw = hwnd;
            return BOOL(0);
        } else if (*p_workerw).0.is_null() {
            // Save fallback WorkerW/Progman handle
            *p_workerw = hwnd;
        }
    }
    BOOL(1)
}

#[cfg(windows)]
fn hwnd_dpi_scale(hwnd: windows::Win32::Foundation::HWND) -> f64 {
    use windows::Win32::UI::HiDpi::GetDpiForWindow;
    let dpi = unsafe { GetDpiForWindow(hwnd) };
    if dpi == 0 {
        1.0
    } else {
        dpi as f64 / 96.0
    }
}

#[cfg(windows)]
fn monitor_dpi_scale_at_point(x: i32, y: i32) -> f64 {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::Graphics::Gdi::{MonitorFromPoint, MONITOR_DEFAULTTONEAREST};
    use windows::Win32::UI::HiDpi::{GetDpiForMonitor, MDT_EFFECTIVE_DPI};

    let monitor = unsafe { MonitorFromPoint(POINT { x, y }, MONITOR_DEFAULTTONEAREST) };
    if monitor.is_invalid() {
        return 1.0;
    }
    let mut dpi_x = 96u32;
    let mut dpi_y = 96u32;
    let ok = unsafe { GetDpiForMonitor(monitor, MDT_EFFECTIVE_DPI, &mut dpi_x, &mut dpi_y) };
    if ok.is_err() || dpi_x == 0 {
        1.0
    } else {
        dpi_x as f64 / 96.0
    }
}

#[cfg(windows)]
fn apply_widget_zoom(app: &AppHandle, win: &tauri::WebviewWindow, dpi_ratio: f64) {
    let config = crate::config_store::read_config::<crate::models::AppConfig>(app, "app_config.json");
    let user_scale = crate::ui_scale::from_config(&config);
    if let Err(err) = crate::ui_scale::apply_to_window_with_dpi_ratio(win, user_scale, dpi_ratio) {
        log::warn!(
            "Failed to apply DPI-compensated zoom to {}: {}",
            win.label(),
            err
        );
    }
}

#[tauri::command]
pub async fn set_desktop_mode(app: AppHandle, label: String, enabled: bool) -> Result<(), String> {
    // When a user locks a just-resized widget, its debounced resize event may
    // otherwise be discarded once it becomes a desktop child. Flush the
    // top-level geometry before parenting it, then ignore the native events
    // produced by the parent transition itself.
    if enabled {
        if let Err(err) = crate::widget_layout::persist_layout_now(&app, &label) {
            log::warn!(
                "Failed to persist widget layout before desktop mode for {}: {}",
                label,
                err
            );
        }
    }
    crate::widget_layout::suppress_layout_event_persist(&app, &label);
    set_desktop_mode_now(&app, &label, enabled)
}

/// Returns whether the widget is currently embedded as a desktop child window.
/// The WS_CHILD bit is more reliable than coordinates because desktop children
/// use the desktop parent's client coordinate system.
pub fn is_desktop_mode(app: &AppHandle, label: &str) -> bool {
    #[cfg(windows)]
    {
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::WindowsAndMessaging::{GetWindowLongW, GWL_STYLE, WS_CHILD};

        let Some(win) = app.get_webview_window(label) else {
            return false;
        };
        let Ok(hwnd_raw) = win.hwnd() else {
            return false;
        };
        let hwnd = HWND(hwnd_raw.0 as *mut _);
        let style = unsafe { GetWindowLongW(hwnd, GWL_STYLE) };
        return style & WS_CHILD.0 as i32 != 0;
    }

    #[cfg(not(windows))]
    {
        let _ = (app, label);
        false
    }
}

/// Synchronous desktop reparenting used by layout code while it preserves
/// window geometry. Keeping this synchronous prevents a child-window DPI
/// conversion from racing a scale update.
pub fn set_desktop_mode_now(app: &AppHandle, label: &str, enabled: bool) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(label) {
        #[cfg(windows)]
        {
            use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
            use windows::Win32::UI::WindowsAndMessaging::{
                EnumWindows, FindWindowExW, FindWindowW, GetWindowLongW, SendMessageTimeoutW,
                SetParent, SetWindowLongW, GWL_EXSTYLE, GWL_STYLE, SMTO_NORMAL, WS_CHILD,
                WS_EX_TOPMOST, WS_POPUP, SET_WINDOW_POS_FLAGS, SWP_SHOWWINDOW,
            };

            let hwnd_raw = win.hwnd().map_err(|e| e.to_string())?;
            let hwnd = HWND(hwnd_raw.0 as *mut _);
            // Reparenting and DPI repairs must not reveal temporarily hidden widgets.
            let visibility_flags = if win.is_visible().unwrap_or(false) {
                SWP_SHOWWINDOW
            } else {
                SET_WINDOW_POS_FLAGS(0)
            };

            if enabled {
                log::info!("Enabling desktop mode for {}", label);

                use windows::Win32::Foundation::RECT;
                use windows::Win32::UI::WindowsAndMessaging::GetWindowRect;
                let mut rect = RECT::default();
                unsafe {
                    let _ = GetWindowRect(hwnd, &mut rect);
                }

                // Capture the widget's *monitor* DPI before SetParent. Child
                // windows under Progman/WorkerW typically inherit the desktop
                // host DPI (often the primary). Mixing scales is what makes a
                // 100% secondary monitor look magnified after lock.
                let pre_dpi = monitor_dpi_scale_at_point(
                    (rect.left + rect.right) / 2,
                    (rect.top + rect.bottom) / 2,
                );

                use windows::Win32::Foundation::{SetLastError, WIN32_ERROR};
                unsafe { SetLastError(WIN32_ERROR(0)); }
                let progman_res = unsafe { FindWindowW(windows::core::w!("Progman"), None) };
                log::info!("Progman FindWindowW result: {:?}", progman_res);
                let progman = progman_res.ok();
                let mut result = 0;
                if let Some(p) = progman {
                    unsafe {
                        SendMessageTimeoutW(
                            p,
                            0x052C,
                            WPARAM(0),
                            LPARAM(0),
                            SMTO_NORMAL,
                            1000,
                            Some(&mut result),
                        );
                    }
                }

                // Find SHELLDLL_DefView anywhere
                let mut shell_view = HWND(std::ptr::null_mut());

                // Check Progman first
                if let Some(p) = progman {
                    unsafe { SetLastError(WIN32_ERROR(0)); }
                    if let Ok(sv) = unsafe {
                        FindWindowExW(Some(p), None, windows::core::w!("SHELLDLL_DefView"), None)
                    } {
                        log::info!("Found SHELLDLL_DefView in Progman: {:?}", sv);
                        shell_view = sv;
                    }
                }

                let mut workerw = HWND(std::ptr::null_mut());
                if shell_view.0.is_null() {
                    unsafe {
                        SetLastError(WIN32_ERROR(0));
                        let _ = EnumWindows(
                            Some(enum_window),
                            LPARAM(&mut workerw as *mut HWND as isize),
                        );
                    }
                    log::info!("EnumWindows WorkerW result: {:?}", workerw);
                }

                let mut target_parent = if !workerw.0.is_null() {
                    Some(workerw)
                } else if !shell_view.0.is_null() {
                    use windows::Win32::UI::WindowsAndMessaging::GetParent as GetWindowParent;
                    unsafe {
                        SetLastError(WIN32_ERROR(0));
                        GetWindowParent(shell_view)
                            .ok()
                            .or(Some(shell_view))
                            .or(progman)
                    }
                } else if let Some(p) = progman {
                    Some(p)
                } else {
                    None
                };

                if target_parent.is_none() {
                    use windows::Win32::UI::WindowsAndMessaging::GetDesktopWindow;
                    let desktop_wnd = unsafe { GetDesktopWindow() };
                    if !desktop_wnd.0.is_null() {
                        log::info!("Falling back to GetDesktopWindow: {:?}", desktop_wnd);
                        target_parent = Some(desktop_wnd);
                    }
                }

                if let Some(parent) = target_parent {
                    log::info!(
                        "Found target desktop handle (Progman/WorkerW): {:?}",
                        parent
                    );

                    use windows::Win32::Foundation::POINT;
                    let pt = POINT {
                        x: rect.left,
                        y: rect.top,
                    };
                    let width = (rect.right - rect.left).max(1);
                    let height = (rect.bottom - rect.top).max(1);

                    unsafe {
                        // 1. Manually calculate client coordinates to bypass GDI DPI scaling bugs on multi-monitors
                        use windows::Win32::Foundation::RECT;
                        use windows::Win32::UI::WindowsAndMessaging::GetWindowRect;
                        let mut parent_rect = RECT::default();
                        let _ = GetWindowRect(parent, &mut parent_rect);

                        let client_x = rect.left - parent_rect.left;
                        let client_y = rect.top - parent_rect.top;

                        // 2. Adjust Styles BEFORE SetParent
                        let style = GetWindowLongW(hwnd, GWL_STYLE);
                        let clean_style =
                            (style | WS_CHILD.0 as i32 | 0x04000000 | 0x02000000)
                                & !(WS_POPUP.0 as i32);
                        let _ = SetWindowLongW(hwnd, GWL_STYLE, clean_style);

                        let ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE);
                        let _ = SetWindowLongW(
                            hwnd,
                            GWL_EXSTYLE,
                            ex_style & !(WS_EX_TOPMOST.0 as i32 | 0x00000020),
                        );

                        // 3. Parent to desktop
                        let _ = SetParent(hwnd, Some(parent));

                        // 4. Restore the exact physical bounds after reparenting. SetParent can
                        // apply the desktop parent's DPI transform and silently enlarge a child
                        // window; setting both size and position here prevents that second scale.
                        use windows::Win32::UI::WindowsAndMessaging::{
                            SetWindowPos, HWND_TOP, SWP_FRAMECHANGED,
                        };
                        let _ = SetWindowPos(
                            hwnd,
                            Some(HWND_TOP),
                            client_x,
                            client_y,
                            width,
                            height,
                            visibility_flags | SWP_FRAMECHANGED,
                        );
                    }

                    // 5. Compensate WebView zoom for host/parent DPI inheritance.
                    // Prefer the desktop parent's DPI as the host scale, then
                    // fall back to the child HWND DPI after SetParent.
                    let parent_dpi = hwnd_dpi_scale(parent);
                    let child_dpi = hwnd_dpi_scale(hwnd);
                    let host_dpi = parent_dpi.max(child_dpi);
                    let dpi_ratio = if host_dpi > 0.01 {
                        pre_dpi / host_dpi
                    } else {
                        1.0
                    };
                    log::info!(
                        "Desktop DPI compensate for {}: monitor={:.3} parent={:.3} child={:.3} ratio={:.3}",
                        label,
                        pre_dpi,
                        parent_dpi,
                        child_dpi,
                        dpi_ratio
                    );
                    apply_widget_zoom(app, &win, dpi_ratio);

                    // SetParent/DPI updates can settle asynchronously; re-assert size and zoom.
                    unsafe {
                        use windows::Win32::Foundation::RECT;
                        use windows::Win32::UI::WindowsAndMessaging::{
                            GetWindowRect, SetWindowPos, HWND_TOP, SWP_FRAMECHANGED, SWP_NOZORDER,
                        };
                        let mut parent_rect = RECT::default();
                        let _ = GetWindowRect(parent, &mut parent_rect);
                        let client_x = rect.left - parent_rect.left;
                        let client_y = rect.top - parent_rect.top;
                        let _ = SetWindowPos(
                            hwnd,
                            Some(HWND_TOP),
                            client_x,
                            client_y,
                            width,
                            height,
                            visibility_flags | SWP_FRAMECHANGED | SWP_NOZORDER,
                        );
                    }
                    let settled_parent = hwnd_dpi_scale(parent);
                    let settled_child = hwnd_dpi_scale(hwnd);
                    let settled_host = settled_parent.max(settled_child);
                    let settled_ratio = if settled_host > 0.01 {
                        pre_dpi / settled_host
                    } else {
                        dpi_ratio
                    };
                    if (settled_ratio - dpi_ratio).abs() >= 0.01 {
                        log::info!(
                            "Desktop DPI re-compensate for {}: host={:.3} ratio={:.3}",
                            label,
                            settled_host,
                            settled_ratio
                        );
                        apply_widget_zoom(app, &win, settled_ratio);
                    }

                    // Windows may finish the child DPI switch a beat after
                    // SetParent. Re-check shortly so mixed-scale secondary
                    // monitors do not keep a briefly uncompensated zoom.
                    {
                        let app_delay = app.clone();
                        let label_delay = label.to_string();
                        let win_delay = win.clone();
                        let pre_dpi_delay = pre_dpi;
                        let parent_ptr = parent.0 as isize;
                        let rect_left = rect.left;
                        let rect_top = rect.top;
                        let width_delay = width;
                        let height_delay = height;
                        tauri::async_runtime::spawn(async move {
                            tokio::time::sleep(std::time::Duration::from_millis(80)).await;
                            if !is_desktop_mode(&app_delay, &label_delay)
                                || !win_delay.is_visible().unwrap_or(false) {
                                return;
                            }
                            let Ok(hwnd_raw) = win_delay.hwnd() else {
                                return;
                            };
                            let hwnd = HWND(hwnd_raw.0 as *mut _);
                            let parent_hwnd = HWND(parent_ptr as *mut _);
                            let late_host = hwnd_dpi_scale(parent_hwnd).max(hwnd_dpi_scale(hwnd));
                            let late_ratio = if late_host > 0.01 {
                                pre_dpi_delay / late_host
                            } else {
                                1.0
                            };
                            log::debug!(
                                "Desktop DPI late compensate for {}: host={:.3} ratio={:.3}",
                                label_delay,
                                late_host,
                                late_ratio
                            );
                            apply_widget_zoom(&app_delay, &win_delay, late_ratio);
                            unsafe {
                                use windows::Win32::UI::WindowsAndMessaging::{
                                    GetWindowRect, SetWindowPos, HWND_TOP, SWP_FRAMECHANGED,
                                    SWP_NOZORDER, SWP_SHOWWINDOW,
                                };
                                let mut parent_rect = RECT::default();
                                let _ = GetWindowRect(parent_hwnd, &mut parent_rect);
                                let client_x = rect_left - parent_rect.left;
                                let client_y = rect_top - parent_rect.top;
                                let _ = SetWindowPos(
                                    hwnd,
                                    Some(HWND_TOP),
                                    client_x,
                                    client_y,
                                    width_delay,
                                    height_delay,
                                    SWP_SHOWWINDOW | SWP_FRAMECHANGED | SWP_NOZORDER,
                                );
                            }
                        });
                    }

                    log::info!(
                        "Desktop mode set successfully at local ({}, {})",
                        pt.x,
                        pt.y
                    );
                } else {
                    log::error!("Failed to find desktop handle");
                }
            } else {
                log::info!("Disabling desktop mode for {}", label);
                use windows::Win32::Foundation::RECT;
                use windows::Win32::UI::WindowsAndMessaging::GetWindowRect;
                let mut rect = RECT::default();
                unsafe {
                    let _ = GetWindowRect(hwnd, &mut rect);
                }
                let width = (rect.right - rect.left).max(1);
                let height = (rect.bottom - rect.top).max(1);

                unsafe {
                    let _ = SetParent(hwnd, None);

                    let style = GetWindowLongW(hwnd, GWL_STYLE);
                    let _ = SetWindowLongW(
                        hwnd,
                        GWL_STYLE,
                        (style & !(WS_CHILD.0 as i32)) | WS_POPUP.0 as i32,
                    );

                    // Restore the exact physical geometry when becoming a top-level window.
                    // This complements the restoration above and avoids a DPI-induced jump on
                    // either lock transition.
                    use windows::Win32::UI::WindowsAndMessaging::{
                        SetWindowPos, HWND_TOP, SWP_FRAMECHANGED,
                    };
                    let _ = SetWindowPos(
                        hwnd,
                        Some(HWND_TOP),
                        rect.left,
                        rect.top,
                        width,
                        height,
                        visibility_flags | SWP_FRAMECHANGED,
                    );
                }

                // Back to a normal top-level window on its own monitor DPI —
                // restore the user UI scale without host-DPI compensation.
                apply_widget_zoom(app, &win, 1.0);
            }
            crate::windows_glass::refresh(&win);
        }

        #[cfg(not(windows))]
        {
            let _ = (app, win, enabled);
        }
    }
    Ok(())
}
