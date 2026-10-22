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

/// The native move loop works for desktop and pinned top-level windows.
#[tauri::command]
pub async fn begin_widget_drag(app: AppHandle, label: String) -> Result<(), String> {
    if !crate::widget_layout::is_tracked_widget(&label) {
        return Err(format!("Unsupported widget label: {label}"));
    }
    let win = app
        .get_webview_window(&label)
        .ok_or("Widget window not found")?;
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
        win.clone()
            .run_on_main_thread(move || {
                crate::widget_layout::suppress_layout_event_persist(&app, &label);
                let result = (|| -> Result<(), String> {
                    let hwnd = HWND(win.hwnd().map_err(|error| error.to_string())?.0 as *mut _);
                    unsafe {
                        let mut point = POINT::default();
                        GetCursorPos(&mut point).map_err(|error| error.to_string())?;
                        let _ = ReleaseCapture();
                        let position = ((point.y as u16 as u32) << 16) | point.x as u16 as u32;
                        SendMessageW(
                            hwnd,
                            WM_NCLBUTTONDOWN,
                            Some(WPARAM(HTCAPTION as usize)),
                            Some(LPARAM(position as isize)),
                        );
                    }
                    crate::widget_layout::persist_layout_now(&app, &label)
                })();
                let _ = sender.send(result);
            })
            .map_err(|error| error.to_string())?;
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

#[tauri::command]
pub async fn set_desktop_mode(app: AppHandle, label: String, enabled: bool) -> Result<(), String> {
    // Preserve the existing portable/macOS layout bookkeeping.
    #[cfg(not(windows))]
    {
        if enabled {
            if let Err(error) = crate::widget_layout::persist_layout_now(&app, &label) {
                log::warn!("Failed to persist layout before desktop mode for {label}: {error}");
            }
        }
        crate::widget_layout::suppress_layout_event_persist(&app, &label);
    }
    set_desktop_mode_now(&app, &label, enabled)
}

/// Install/remove the native desktop handler on the HWND's owning thread.
/// Tauri executes this closure immediately when called from that same thread.
pub fn set_desktop_mode_now(app: &AppHandle, label: &str, enabled: bool) -> Result<(), String> {
    #[cfg(windows)]
    if let Some(win) = app.get_webview_window(label) {
        let (sender, receiver) = std::sync::mpsc::sync_channel(1);
        win.clone()
            .run_on_main_thread(move || {
                let result = win
                    .hwnd()
                    .map_err(|error| error.to_string())
                    .and_then(|handle| {
                        crate::windows_desktop::set_enabled(
                            windows::Win32::Foundation::HWND(handle.0 as *mut _),
                            enabled,
                        )
                    });
                let _ = sender.send(result);
            })
            .map_err(|error| error.to_string())?;
        return receiver.recv().map_err(|error| error.to_string())?;
    }
    let _ = (app, label, enabled);
    Ok(())
}
