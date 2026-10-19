//! Keep widget windows frameless at the point where Windows changes styles.
//! A delayed style repair is too late: activation and focusability changes can
//! otherwise repaint the classic caption without producing a resize event.
use windows::Win32::{
    Foundation::{HWND, LPARAM, LRESULT, WPARAM},
    UI::{
        Shell::{DefSubclassProc, GetWindowSubclass, RemoveWindowSubclass, SetWindowSubclass},
        WindowsAndMessaging::{
            GetWindowLongW, SetWindowLongW, SetWindowPos, GWL_EXSTYLE, GWL_STYLE, STYLESTRUCT,
            SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, WM_NCACTIVATE,
            WM_NCCALCSIZE, WM_NCDESTROY, WM_NCPAINT, WM_STYLECHANGING, WS_CAPTION,
            WS_EX_CLIENTEDGE, WS_EX_DLGMODALFRAME, WS_EX_STATICEDGE, WS_EX_WINDOWEDGE,
        },
    },
};

const SUBCLASS_ID: usize = 0x57444754;

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
                .and_then(|handle| install(HWND(handle.0 as *mut _)));
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
