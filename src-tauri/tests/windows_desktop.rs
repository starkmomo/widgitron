#![cfg(windows)]
#[path = "../src/windows_desktop.rs"]
mod windows_desktop;

use windows::{
    core::w,
    Win32::{
        Foundation::{HWND, RECT},
        Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_USE_HOSTBACKDROPBRUSH},
        UI::{HiDpi::GetDpiForWindow, WindowsAndMessaging::*},
    },
};

struct Window(HWND);
impl Window {
    fn new() -> Self {
        Self(unsafe {
            CreateWindowExW(
                WS_EX_TOOLWINDOW,
                w!("STATIC"),
                w!("Desktop layer regression"),
                WS_POPUP,
                73,
                91,
                400,
                280,
                None,
                None,
                None,
                None,
            )
            .expect("hidden HWND")
        })
    }
    fn bounds(&self) -> RECT {
        let mut rect = RECT::default();
        unsafe { GetWindowRect(self.0, &mut rect).expect("bounds") };
        rect
    }
}
impl Drop for Window {
    fn drop(&mut self) {
        unsafe {
            let _ = DestroyWindow(self.0);
        }
    }
}

#[test]
fn desktop_layer_keeps_native_material_geometry_and_dpi_across_pin_cycles() {
    let widget = Window::new();
    let bounds = widget.bounds();
    let dpi = unsafe { GetDpiForWindow(widget.0) };
    for _ in 0..4 {
        windows_desktop::set_enabled(widget.0, true).expect("desktop mode");
        assert!(windows_desktop::enabled(widget.0));
        unsafe {
            assert_eq!(GetWindowLongW(widget.0, GWL_STYLE) as u32 & WS_CHILD.0, 0);
            assert_eq!(GetAncestor(widget.0, GA_ROOT), widget.0);
            assert!(GetWindow(widget.0, GW_OWNER).is_err());
            assert_eq!(GetDpiForWindow(widget.0), dpi);
            // Unlike a child HWND, the desktop-layer window accepts native
            // composition. A focus/level transition leaves it top-level.
            let enabled: i32 = 1;
            DwmSetWindowAttribute(
                widget.0,
                DWMWA_USE_HOSTBACKDROPBRUSH,
                &enabled as *const _ as *const _,
                std::mem::size_of_val(&enabled) as u32,
            )
            .expect("desktop native material");
        }
        assert_eq!(widget.bounds(), bounds);
        windows_desktop::set_enabled(widget.0, false).expect("leave desktop mode");
        assert!(!windows_desktop::enabled(widget.0));
        unsafe {
            SetWindowPos(
                widget.0,
                Some(HWND_TOPMOST),
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
            )
            .expect("pin")
        };
        windows_desktop::set_enabled(widget.0, false).expect("reassert pinned mode at startup");
        unsafe {
            assert_ne!(GetWindowLongW(widget.0, GWL_EXSTYLE) as u32 & WS_EX_TOPMOST.0, 0);
        }
        assert_eq!(widget.bounds(), bounds);
    }
}

#[test]
fn desktop_z_order_follows_shell_without_reparenting_or_revealing_hidden_widgets() {
    let shell = Window::new();
    let widget = Window::new();
    let ordinary_app = Window::new();
    windows_desktop::set_enabled(widget.0, true).expect("desktop mode");
    let flags = SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE;
    for _ in 0..3 {
        unsafe { SetWindowPos(shell.0, Some(HWND_TOP), 0, 0, 0, 0, flags).expect("shell raised") };
        windows_desktop::place_above_desktop(widget.0, shell.0).expect("follow shell");
        unsafe {
            assert_eq!(
                GetWindow(shell.0, GW_HWNDPREV).expect("above shell"),
                widget.0
            );
            SetWindowPos(ordinary_app.0, Some(HWND_TOP), 0, 0, 0, 0, flags).expect("open app");
            // Activation of the widget cannot raise it over an ordinary app.
            SetWindowPos(widget.0, Some(HWND_TOP), 0, 0, 0, 0, flags).expect("activate widget");
            assert_eq!(
                GetWindow(shell.0, GW_HWNDPREV).expect("desktop order"),
                widget.0
            );
            // Unrelated hidden/system windows can sit between our fixtures.
            // Verify their relative order instead of requiring adjacency.
            let mut below = GetWindow(ordinary_app.0, GW_HWNDNEXT).ok();
            let mut found_widget = false;
            while let Some(candidate) = below {
                if candidate == widget.0 {
                    found_widget = true;
                    break;
                }
                if candidate == shell.0 {
                    break;
                }
                below = GetWindow(candidate, GW_HWNDNEXT).ok();
            }
            assert!(
                found_widget,
                "ordinary app must stay above the desktop widget"
            );
            assert!(!IsWindowVisible(widget.0).as_bool());
            assert_eq!(GetAncestor(widget.0, GA_ROOT), widget.0);
        }
    }
    windows_desktop::set_enabled(widget.0, false).expect("cleanup");
}

#[test]
fn temporary_desktop_band_is_removed_when_the_shell_returns_to_normal() {
    let shell = Window::new();
    let widget = Window::new();
    windows_desktop::set_enabled(widget.0, true).expect("desktop mode");
    for topmost in [true, false, true, false] {
        unsafe {
            SetWindowPos(shell.0, Some(if topmost { HWND_TOPMOST } else { HWND_NOTOPMOST }),
                0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE).expect("shell band");
        }
        windows_desktop::place_above_desktop(widget.0, shell.0).expect("follow shell band");
        unsafe {
            assert_eq!(GetWindowLongW(widget.0, GWL_EXSTYLE) as u32 & WS_EX_TOPMOST.0 != 0, topmost);
            assert!(!IsWindowVisible(widget.0).as_bool());
        }
    }
    windows_desktop::set_enabled(widget.0, false).expect("cleanup");
}
