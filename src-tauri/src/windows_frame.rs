//! Keep widget windows frameless at the point where Windows changes styles.
//! A delayed style repair is too late: activation and focusability changes can
//! otherwise repaint the classic caption without producing a resize event.
use windows::Win32::{
    Foundation::{HWND, LPARAM, LRESULT, WPARAM, RECT},
    Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST},
    UI::{
        Shell::{DefSubclassProc, GetWindowSubclass, RemoveWindowSubclass, SetWindowSubclass},
        WindowsAndMessaging::{
            GetWindowLongW, GetWindowRect, SetWindowLongW, SetWindowPos, GWL_EXSTYLE, GWL_STYLE, STYLESTRUCT,
            SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, WM_NCACTIVATE,
            WM_NCCALCSIZE, WM_NCDESTROY, WM_NCPAINT, WM_STYLECHANGING, WM_NCHITTEST, WM_SIZING, WM_EXITSIZEMOVE, WS_CAPTION,
            HTCLIENT, HTLEFT, HTRIGHT, HTTOP, HTBOTTOM, HTTOPLEFT, HTTOPRIGHT, HTBOTTOMLEFT, HTBOTTOMRIGHT,
            WS_EX_CLIENTEDGE, WS_EX_DLGMODALFRAME, WS_EX_STATICEDGE, WS_EX_WINDOWEDGE,
        },
    },
};

const SUBCLASS_ID: usize = 0x57444754;
static SIDEBAR_HWND: std::sync::atomic::AtomicIsize = std::sync::atomic::AtomicIsize::new(0);
static SIDEBAR_VERTICAL: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(true);
static SIDEBAR_MIN_LENGTH: std::sync::atomic::AtomicI32 = std::sync::atomic::AtomicI32::new(360);
static SIDEBAR_RESIZING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
static SIDEBAR_RESIZE_FINISHED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

pub fn set_sidebar_axis(vertical: bool, minimum: i32) {
    SIDEBAR_VERTICAL.store(vertical, std::sync::atomic::Ordering::Relaxed);
    SIDEBAR_MIN_LENGTH.store(minimum, std::sync::atomic::Ordering::Relaxed);
}

pub fn take_sidebar_resize_finished() -> bool {
    SIDEBAR_RESIZE_FINISHED.swap(false, std::sync::atomic::Ordering::Relaxed)
}

fn sidebar_resize_hit(hit: u32, vertical: bool) -> u32 {
    match (vertical, hit) {
        (true, HTLEFT | HTRIGHT) | (false, HTTOP | HTBOTTOM) => HTCLIENT,
        (true, HTTOPLEFT | HTTOPRIGHT) => HTTOP,
        (true, HTBOTTOMLEFT | HTBOTTOMRIGHT) => HTBOTTOM,
        (false, HTTOPLEFT | HTBOTTOMLEFT) => HTLEFT,
        (false, HTTOPRIGHT | HTBOTTOMRIGHT) => HTRIGHT,
        _ => hit,
    }
}

fn frameless_style(style: u32) -> u32 {
    // Retain WS_THICKFRAME so Windows resize gestures keep working. The
    // NCCALCSIZE/NCPAINT handlers remove its non-client pixels instead.
    style & !WS_CAPTION.0
}

fn frameless_ex_style(style: u32) -> u32 {
    style & !(WS_EX_CLIENTEDGE | WS_EX_DLGMODALFRAME | WS_EX_STATICEDGE | WS_EX_WINDOWEDGE).0
}

unsafe extern "system" fn widget_frame_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    id: usize,
    _data: usize,
) -> LRESULT {
    match message {
        WM_SIZING if hwnd.0 as isize == SIDEBAR_HWND.load(std::sync::atomic::Ordering::Relaxed) => {
            SIDEBAR_RESIZING.store(true, std::sync::atomic::Ordering::Relaxed);
            let result = DefSubclassProc(hwnd, message, wparam, lparam);
            let mut info = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
            let mut current = RECT::default();
            if GetMonitorInfoW(MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST), &mut info).as_bool()
                && GetWindowRect(hwnd, &mut current).is_ok() {
                if let Some(rect) = (lparam.0 as *mut RECT).as_mut() {
                    let vertical = SIDEBAR_VERTICAL.load(std::sync::atomic::Ordering::Relaxed);
                    if vertical { rect.left = current.left; rect.right = current.right; }
                    else { rect.top = current.top; rect.bottom = current.bottom; }
                    let min_length = SIDEBAR_MIN_LENGTH.load(std::sync::atomic::Ordering::Relaxed) as f64;
                    let (left, width) = crate::sidebar_placement::bounded_span(rect.left as f64,
                        (rect.right - rect.left) as f64, info.rcWork.left as f64,
                        (info.rcWork.right - info.rcWork.left) as f64, if vertical { 1.0 } else { min_length });
                    let (top, height) = crate::sidebar_placement::bounded_span(rect.top as f64,
                        (rect.bottom - rect.top) as f64, info.rcWork.top as f64,
                        (info.rcWork.bottom - info.rcWork.top) as f64, if vertical { min_length } else { 1.0 });
                    *rect = RECT { left: left.round() as i32, top: top.round() as i32,
                        right: (left + width).round() as i32, bottom: (top + height).round() as i32 };
                    return LRESULT(1);
                }
            }
            result
        }
        WM_EXITSIZEMOVE if hwnd.0 as isize == SIDEBAR_HWND.load(std::sync::atomic::Ordering::Relaxed) => {
            if SIDEBAR_RESIZING.swap(false, std::sync::atomic::Ordering::Relaxed) {
                SIDEBAR_RESIZE_FINISHED.store(true, std::sync::atomic::Ordering::Relaxed);
            }
            DefSubclassProc(hwnd, message, wparam, lparam)
        }
        WM_NCHITTEST if hwnd.0 as isize == SIDEBAR_HWND.load(std::sync::atomic::Ordering::Relaxed) => {
            let hit = DefSubclassProc(hwnd, message, wparam, lparam);
            let mapped = sidebar_resize_hit(hit.0 as u32,
                SIDEBAR_VERTICAL.load(std::sync::atomic::Ordering::Relaxed));
            if mapped == hit.0 as u32 { hit } else { LRESULT(mapped as isize) }
        }
        WM_STYLECHANGING => {
            let result = DefSubclassProc(hwnd, message, wparam, lparam);
            if let Some(styles) = (lparam.0 as *mut STYLESTRUCT).as_mut() {
                if wparam.0 as i32 == GWL_STYLE.0 {
                    styles.styleNew = frameless_style(styles.styleNew);
                } else if wparam.0 as i32 == GWL_EXSTYLE.0 {
                    styles.styleNew = frameless_ex_style(styles.styleNew);
                }
            }
            result
        }
        WM_NCCALCSIZE | WM_NCPAINT => LRESULT(0),
        // Keep Tao's focus bookkeeping, suppressing DefWindowProc's caption paint.
        WM_NCACTIVATE => DefSubclassProc(hwnd, message, wparam, LPARAM(-1)),
        WM_NCDESTROY => {
            let _ = SIDEBAR_HWND.compare_exchange(hwnd.0 as isize, 0,
                std::sync::atomic::Ordering::Relaxed, std::sync::atomic::Ordering::Relaxed);
            let _ = RemoveWindowSubclass(hwnd, Some(widget_frame_proc), id);
            DefSubclassProc(hwnd, message, wparam, lparam)
        }
        _ => DefSubclassProc(hwnd, message, wparam, lparam),
    }
}

/// Must run on the window's UI thread. The subclass has no heap state, and is
/// removed on WM_NCDESTROY before its HWND can be reused by another window.
pub fn install(hwnd: HWND) -> Result<(), String> {
    unsafe {
        let mut data = 0;
        if GetWindowSubclass(hwnd, Some(widget_frame_proc), SUBCLASS_ID, Some(&mut data)).as_bool()
        {
            return Ok(());
        }
        if !SetWindowSubclass(hwnd, Some(widget_frame_proc), SUBCLASS_ID, 0).as_bool() {
            return Err("Could not install the Windows widget frame handler".into());
        }
        SetWindowLongW(
            hwnd,
            GWL_STYLE,
            frameless_style(GetWindowLongW(hwnd, GWL_STYLE) as u32) as i32,
        );
        SetWindowLongW(
            hwnd,
            GWL_EXSTYLE,
            frameless_ex_style(GetWindowLongW(hwnd, GWL_EXSTYLE) as u32) as i32,
        );
        SetWindowPos(
            hwnd,
            None,
            0,
            0,
            0,
            0,
            SWP_FRAMECHANGED | SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER,
        )
        .map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub fn protect<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) -> Result<(), String> {
    let window = window.clone();
    window
        .clone()
        .run_on_main_thread(move || {
            let result = window
                .hwnd()
                .map_err(|error| error.to_string())
                .and_then(|handle| {
                    if window.label() == "sidebar" {
                        SIDEBAR_HWND.store(handle.0 as isize, std::sync::atomic::Ordering::Relaxed);
                    }
                    install(HWND(handle.0 as *mut _))
                });
            if let Err(error) = result {
                log::error!(
                    "Could not protect {} from native window chrome: {error}",
                    window.label()
                );
            }
        })
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows::Win32::UI::WindowsAndMessaging::{
        WS_CHILD, WS_CLIPCHILDREN, WS_EX_LAYERED, WS_EX_TOPMOST, WS_POPUP, WS_THICKFRAME,
        WS_VISIBLE,
    };

    #[test]
    fn sidebar_resize_handles_follow_the_docked_axis() {
        assert_eq!(sidebar_resize_hit(HTLEFT, true), HTCLIENT);
        assert_eq!(sidebar_resize_hit(HTTOPRIGHT, true), HTTOP);
        assert_eq!(sidebar_resize_hit(HTBOTTOMLEFT, true), HTBOTTOM);
        assert_eq!(sidebar_resize_hit(HTTOP, false), HTCLIENT);
        assert_eq!(sidebar_resize_hit(HTTOPRIGHT, false), HTRIGHT);
        assert_eq!(sidebar_resize_hit(HTBOTTOMLEFT, false), HTLEFT);
        assert_eq!(sidebar_resize_hit(HTCLIENT, true), HTCLIENT);
    }

    #[test]
    fn tao_restyles_cannot_restore_a_caption_or_change_window_topology() {
        for topology in [WS_CHILD, WS_POPUP] {
            let proposed = (topology | WS_VISIBLE | WS_CLIPCHILDREN | WS_CAPTION | WS_THICKFRAME).0;
            let filtered = frameless_style(proposed);
            assert_eq!(filtered & topology.0, topology.0);
            assert_eq!(
                filtered & (WS_VISIBLE | WS_CLIPCHILDREN).0,
                (WS_VISIBLE | WS_CLIPCHILDREN).0
            );
            assert_eq!(filtered & WS_CAPTION.0, 0);
            assert_eq!(filtered & WS_THICKFRAME.0, WS_THICKFRAME.0);
        }
    }

    #[test]
    fn activation_keeps_transparency_and_topmost_without_native_edges() {
        let proposed = (WS_EX_TOPMOST | WS_EX_LAYERED | WS_EX_WINDOWEDGE | WS_EX_CLIENTEDGE).0;
        assert_eq!(
            frameless_ex_style(proposed),
            (WS_EX_TOPMOST | WS_EX_LAYERED).0
        );
    }
}
