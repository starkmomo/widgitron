use tauri::{AppHandle, Manager};

#[cfg(windows)]
unsafe extern "system" fn enum_window(
    hwnd: windows::Win32::Foundation::HWND,
    lparam: windows::Win32::Foundation::LPARAM,
) -> windows::core::BOOL {
    use windows::Win32::UI::WindowsAndMessaging::{FindWindowExW, GetClassNameW};
    use windows::Win32::Foundation::HWND;
    use windows::core::BOOL;
    
    let p_workerw = lparam.0 as *mut HWND;
    let mut class_name = [0u16; 256];
    let len = GetClassNameW(hwnd, &mut class_name);
    let name = String::from_utf16_lossy(&class_name[..len as usize]);
    
    if name == "WorkerW" {
        let shell_view = FindWindowExW(Some(hwnd), None, windows::core::w!("SHELLDLL_DefView"), None).ok();
        if let Some(sv) = shell_view {
            // Parent directly to SHELLDLL_DefView
            *p_workerw = sv;
            return BOOL(0);
        }
    }
    BOOL(1)
}

#[tauri::command]
pub async fn set_desktop_mode(app: AppHandle, label: String, enabled: bool) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(&label) {
        #[cfg(windows)]
        {
            use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
            use windows::Win32::UI::WindowsAndMessaging::{
                EnumWindows, FindWindowW, FindWindowExW, SendMessageTimeoutW, SetParent, SMTO_NORMAL,
                GetWindowLongW, SetWindowLongW, GWL_EXSTYLE, WS_EX_TOPMOST,
                GWL_STYLE, WS_CHILD, WS_POPUP,
            };

            let hwnd_raw = win.hwnd().map_err(|e| e.to_string())?;
            let hwnd = HWND(hwnd_raw.0 as *mut _);

            if enabled {
                println!("Enabling desktop mode for {}", label);
                
                use windows::Win32::Foundation::RECT;
                use windows::Win32::UI::WindowsAndMessaging::GetWindowRect;
                let mut rect = RECT::default();
                unsafe { let _ = GetWindowRect(hwnd, &mut rect); }

                let progman = unsafe { FindWindowW(windows::core::w!("Progman"), None) }.ok();
                let mut result = 0;
                if let Some(p) = progman {
                    unsafe {
                        SendMessageTimeoutW(p, 0x052C, WPARAM(0), LPARAM(0), SMTO_NORMAL, 1000, Some(&mut result));
                    }
                }

                // Find SHELLDLL_DefView anywhere
                let mut shell_view = HWND(std::ptr::null_mut());
                
                // Check Progman first
                if let Some(p) = progman {
                    if let Ok(sv) = unsafe { FindWindowExW(Some(p), None, windows::core::w!("SHELLDLL_DefView"), None) } {
                        shell_view = sv;
                    }
                }
                
                // Check WorkerW if not found
                if shell_view.0.is_null() {
                    let mut workerw = HWND(std::ptr::null_mut());
                    unsafe {
                        let _ = EnumWindows(Some(enum_window), LPARAM(&mut workerw as *mut HWND as isize));
                    }
                    if !workerw.0.is_null() {
                        shell_view = workerw; // enum_window now returns SHELLDLL_DefView directly
                    }
                }

                let target_parent = if !shell_view.0.is_null() {
                    use windows::Win32::UI::WindowsAndMessaging::GetParent as GetWindowParent;
                    unsafe { GetWindowParent(shell_view).ok() }
                } else if let Some(p) = progman {
                    Some(p)
                } else {
                    None
                };

                if let Some(parent) = target_parent {
                    println!("Found target desktop handle (Progman/WorkerW): {:?}", parent);
                    
                    use windows::Win32::Foundation::POINT;
                    let pt = POINT { x: rect.left, y: rect.top };
                    
                    unsafe {
                        // 1. Manually calculate client coordinates to bypass GDI DPI scaling bugs on multi-monitors
                        use windows::Win32::UI::WindowsAndMessaging::GetWindowRect;
                        use windows::Win32::Foundation::RECT;
                        let mut parent_rect = RECT::default();
                        let _ = GetWindowRect(parent, &mut parent_rect);
                        
                        let client_x = rect.left - parent_rect.left;
                        let client_y = rect.top - parent_rect.top;

                        // 2. Adjust Styles BEFORE SetParent
                        let style = GetWindowLongW(hwnd, GWL_STYLE);
                        let clean_style = (style | WS_CHILD.0 as i32 | 0x04000000 | 0x02000000 | 0x10000000) & !(WS_POPUP.0 as i32);
                        let _ = SetWindowLongW(hwnd, GWL_STYLE, clean_style);
                        
                        let ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE);
                        let _ = SetWindowLongW(hwnd, GWL_EXSTYLE, ex_style & !(WS_EX_TOPMOST.0 as i32 | 0x00000020));

                        // 3. Parent to desktop
                        let _ = SetParent(hwnd, Some(parent));
                        
                        // 4. Update position (use SWP_NOSIZE so we don't break Tauri's internal resize logic)
                        use windows::Win32::UI::WindowsAndMessaging::{SetWindowPos, SWP_SHOWWINDOW, SWP_FRAMECHANGED, HWND_TOP, SWP_NOSIZE};
                        let _ = SetWindowPos(hwnd, Some(HWND_TOP), client_x, client_y, 0, 0, SWP_NOSIZE | SWP_SHOWWINDOW | SWP_FRAMECHANGED);
                        
                        use windows::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_SHOW};
                        let _ = ShowWindow(hwnd, SW_SHOW);
                        
                        use windows::Win32::UI::Input::KeyboardAndMouse::SetFocus;
                        let _ = SetFocus(Some(hwnd));
                    }
                    println!("Desktop mode set successfully at local ({}, {})", pt.x, pt.y);

                    // 5. Force a repaint via Tauri API to fix transparent bug without breaking resize grip
                    if let Ok(size) = win.inner_size() {
                        let _ = win.set_size(tauri::Size::Physical(tauri::PhysicalSize { width: size.width, height: size.height + 1 }));
                        let win_clone = win.clone();
                        tokio::spawn(async move {
                            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                            let _ = win_clone.set_size(tauri::Size::Physical(tauri::PhysicalSize { width: size.width, height: size.height }));
                        });
                    }
                } else {
                    println!("Failed to find desktop handle");
                }
            } else {
                println!("Disabling desktop mode for {}", label);
                use windows::Win32::Foundation::RECT;
                use windows::Win32::UI::WindowsAndMessaging::GetWindowRect;
                let mut rect = RECT::default();
                unsafe { let _ = GetWindowRect(hwnd, &mut rect); }

                unsafe {
                    let _ = SetParent(hwnd, None);
                    
                    let style = GetWindowLongW(hwnd, GWL_STYLE);
                    let _ = SetWindowLongW(hwnd, GWL_STYLE, (style & !(WS_CHILD.0 as i32)) | WS_POPUP.0 as i32);
                    
                    // Restore position to where it was in the desktop
                    // Use HWND_TOP to ensure it's visible as a normal window after exiting desktop mode
                    use windows::Win32::UI::WindowsAndMessaging::{SetWindowPos, SWP_SHOWWINDOW, SWP_FRAMECHANGED, HWND_TOP, SWP_NOSIZE};
                    let _ = SetWindowPos(hwnd, Some(HWND_TOP), rect.left, rect.top, 0, 0, SWP_NOSIZE | SWP_SHOWWINDOW | SWP_FRAMECHANGED);
                }
            }
        }
    }
    Ok(())
}
