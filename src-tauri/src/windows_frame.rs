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
const EDGE_LEFT: u8 = 0;
const EDGE_TOP: u8 = 1;
const EDGE_RIGHT: u8 = 2;
const EDGE_BOTTOM: u8 = 3;

static SIDEBAR_HWND: std::sync::atomic::AtomicIsize = std::sync::atomic::AtomicIsize::new(0);
static SIDEBAR_EDGE: std::sync::atomic::AtomicU8 = std::sync::atomic::AtomicU8::new(EDGE_RIGHT);
static SIDEBAR_MIN_LENGTH: std::sync::atomic::AtomicI32 = std::sync::atomic::AtomicI32::new(360);
static SIDEBAR_MIN_THICKNESS: std::sync::atomic::AtomicI32 = std::sync::atomic::AtomicI32::new(320);
static SIDEBAR_RESIZING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
static SIDEBAR_RESIZE_FINISHED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

pub fn set_sidebar_axis(edge: &str, minimum_length: i32, minimum_thickness: i32) {
    let edge = match edge.trim().to_ascii_lowercase().as_str() {
        "left" => EDGE_LEFT,
        "top" => EDGE_TOP,
        "bottom" => EDGE_BOTTOM,
        _ => EDGE_RIGHT,
    };
    SIDEBAR_EDGE.store(edge, std::sync::atomic::Ordering::Relaxed);
    SIDEBAR_MIN_LENGTH.store(minimum_length.max(1), std::sync::atomic::Ordering::Relaxed);
    SIDEBAR_MIN_THICKNESS.store(minimum_thickness.max(1), std::sync::atomic::Ordering::Relaxed);
}

pub fn take_sidebar_resize_finished() -> bool {
    SIDEBAR_RESIZE_FINISHED.swap(false, std::sync::atomic::Ordering::Relaxed)
}

fn sidebar_vertical(edge: u8) -> bool {
    matches!(edge, EDGE_LEFT | EDGE_RIGHT)
}

/// Keep the screen-docked edge fixed while still allowing the free inner edge
/// to change thickness and the parallel edges to change length.
fn sidebar_resize_hit(hit: u32, edge: u8) -> u32 {
    match edge {
        EDGE_LEFT => match hit {
            HTLEFT | HTTOPLEFT | HTBOTTOMLEFT => HTCLIENT,
            HTTOPRIGHT => HTTOP,
            HTBOTTOMRIGHT => HTBOTTOM,
            _ => hit,
        },
        EDGE_RIGHT => match hit {
            HTRIGHT | HTTOPRIGHT | HTBOTTOMRIGHT => HTCLIENT,
            HTTOPLEFT => HTTOP,
            HTBOTTOMLEFT => HTBOTTOM,
            _ => hit,
        },
        EDGE_TOP => match hit {
            HTTOP | HTTOPLEFT | HTTOPRIGHT => HTCLIENT,
            HTBOTTOMLEFT => HTLEFT,
            HTBOTTOMRIGHT => HTRIGHT,
            _ => hit,
        },
        EDGE_BOTTOM => match hit {
            HTBOTTOM | HTBOTTOMLEFT | HTBOTTOMRIGHT => HTCLIENT,
            HTTOPLEFT => HTLEFT,
            HTTOPRIGHT => HTRIGHT,
            _ => hit,
        },
        _ => hit,
    }
}

fn pin_docked_edge(rect: &mut RECT, current: RECT, edge: u8) {
    match edge {
        EDGE_LEFT => rect.left = current.left,
        EDGE_RIGHT => rect.right = current.right,
        EDGE_TOP => rect.top = current.top,
        EDGE_BOTTOM => rect.bottom = current.bottom,
        _ => {}
    }
}

/// Keep long-axis movement on-screen. Duplicated from sidebar_placement so the
/// windows_frame integration test can include this file without that module.
fn bounded_span(origin: f64, length: f64, start: f64, span: f64, minimum: f64) -> (f64, f64) {
    let span = span.max(1.0);
    let length = length.clamp(minimum.clamp(1.0, span), span);
    (origin.clamp(start, start + span - length), length)
}

fn clamp_thickness(rect: &mut RECT, current: RECT, edge: u8, min_thickness: i32, work: RECT) {
    match edge {
        EDGE_LEFT => {
            let max_right = work.right;
            let min_right = (current.left + min_thickness).min(max_right);
            rect.right = rect.right.clamp(min_right, max_right);
            rect.left = current.left;
        }
        EDGE_RIGHT => {
            let min_left = work.left;
            let max_left = (current.right - min_thickness).max(min_left);
            rect.left = rect.left.clamp(min_left, max_left);
            rect.right = current.right;
        }
        EDGE_TOP => {
            let max_bottom = work.bottom;
            let min_bottom = (current.top + min_thickness).min(max_bottom);
            rect.bottom = rect.bottom.clamp(min_bottom, max_bottom);
            rect.top = current.top;
        }
        EDGE_BOTTOM => {
            let min_top = work.top;
            let max_top = (current.bottom - min_thickness).max(min_top);
            rect.top = rect.top.clamp(min_top, max_top);
            rect.bottom = current.bottom;
        }
        _ => {}
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
                    let edge = SIDEBAR_EDGE.load(std::sync::atomic::Ordering::Relaxed);
                    let vertical = sidebar_vertical(edge);
                    let min_length = SIDEBAR_MIN_LENGTH.load(std::sync::atomic::Ordering::Relaxed);
                    let min_thickness = SIDEBAR_MIN_THICKNESS.load(std::sync::atomic::Ordering::Relaxed);
                    pin_docked_edge(rect, current, edge);
                    clamp_thickness(rect, current, edge, min_thickness, info.rcWork);
                    let (left, width) = bounded_span(
                        rect.left as f64,
                        (rect.right - rect.left) as f64,
                        info.rcWork.left as f64,
                        (info.rcWork.right - info.rcWork.left) as f64,
                        if vertical { 1.0 } else { min_length as f64 },
                    );
                    let (top, height) = bounded_span(
                        rect.top as f64,
                        (rect.bottom - rect.top) as f64,
                        info.rcWork.top as f64,
                        (info.rcWork.bottom - info.rcWork.top) as f64,
                        if vertical { min_length as f64 } else { 1.0 },
                    );
                    *rect = RECT {
                        left: left.round() as i32,
                        top: top.round() as i32,
                        right: (left + width).round() as i32,
                        bottom: (top + height).round() as i32,
                    };
                    // Re-pin after length clamping so the docked screen edge
                    // never drifts when the free edge changes thickness.
                    pin_docked_edge(rect, current, edge);
                    clamp_thickness(rect, current, edge, min_thickness, info.rcWork);
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
            let mapped = sidebar_resize_hit(
                hit.0 as u32,
                SIDEBAR_EDGE.load(std::sync::atomic::Ordering::Relaxed),
            );
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
    fn sidebar_resize_handles_keep_docked_edge_fixed() {
        assert_eq!(sidebar_resize_hit(HTLEFT, EDGE_LEFT), HTCLIENT);
        assert_eq!(sidebar_resize_hit(HTRIGHT, EDGE_LEFT), HTRIGHT);
        assert_eq!(sidebar_resize_hit(HTTOPRIGHT, EDGE_LEFT), HTTOP);
        assert_eq!(sidebar_resize_hit(HTRIGHT, EDGE_RIGHT), HTCLIENT);
        assert_eq!(sidebar_resize_hit(HTLEFT, EDGE_RIGHT), HTLEFT);
        assert_eq!(sidebar_resize_hit(HTBOTTOMLEFT, EDGE_RIGHT), HTBOTTOM);
        assert_eq!(sidebar_resize_hit(HTTOP, EDGE_TOP), HTCLIENT);
        assert_eq!(sidebar_resize_hit(HTBOTTOM, EDGE_TOP), HTBOTTOM);
        assert_eq!(sidebar_resize_hit(HTTOPRIGHT, EDGE_TOP), HTCLIENT);
        assert_eq!(sidebar_resize_hit(HTBOTTOMRIGHT, EDGE_TOP), HTRIGHT);
        assert_eq!(sidebar_resize_hit(HTBOTTOM, EDGE_BOTTOM), HTCLIENT);
        assert_eq!(sidebar_resize_hit(HTTOP, EDGE_BOTTOM), HTTOP);
        assert_eq!(sidebar_resize_hit(HTCLIENT, EDGE_RIGHT), HTCLIENT);
    }

    #[test]
    fn thickness_clamp_pins_docked_edge_and_enforces_minimum() {
        let work = RECT { left: 0, top: 0, right: 1920, bottom: 1080 };
        let current = RECT { left: 1600, top: 100, right: 1920, bottom: 900 };
        let mut rect = RECT { left: 1000, top: 100, right: 1920, bottom: 900 };
        clamp_thickness(&mut rect, current, EDGE_RIGHT, 320, work);
        assert_eq!(rect.right, 1920);
        assert_eq!(rect.left, 1000);

        let mut too_thin = RECT { left: 1800, top: 100, right: 1920, bottom: 900 };
        clamp_thickness(&mut too_thin, current, EDGE_RIGHT, 320, work);
        assert_eq!(too_thin.right, 1920);
        assert_eq!(too_thin.left, 1600);
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
