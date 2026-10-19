#![cfg(windows)]
#[path = "../src/windows_frame.rs"]
mod windows_frame;
use windows::Win32::{
    Foundation::{HWND, LPARAM, WPARAM},
    UI::WindowsAndMessaging::*,
};
use windows_frame::install;

#[test]
fn native_restyle_and_activation_do_not_recreate_nonclient_area() {
    use windows::{
        core::w,
        Win32::{
            Foundation::RECT,
            UI::WindowsAndMessaging::{
                CreateWindowExW, DestroyWindow, GetClientRect, GetWindowRect, SendMessageW,
                HWND_NOTOPMOST, HWND_TOPMOST, WINDOW_EX_STYLE, WS_OVERLAPPEDWINDOW,
            },
        },
    };
    struct OwnedWindow(HWND);
    impl Drop for OwnedWindow {
        fn drop(&mut self) {
            unsafe {
                let _ = DestroyWindow(self.0);
            }
        }
    }
    unsafe {
        // A hidden, real HWND tests WM_STYLECHANGING, NCCALCSIZE and
        // activation together, without touching any user-owned window.
        let window = OwnedWindow(
            CreateWindowExW(
                WINDOW_EX_STYLE::default(),
                w!("STATIC"),
                w!("Widgitron frame regression test"),
                WS_OVERLAPPEDWINDOW,
                0,
                0,
                400,
                300,
                None,
                None,
                None,
                None,
            )
            .expect("test HWND"),
        );
        install(window.0).expect("frame handler");
        for topmost in [true, false, true, false] {
            SetWindowLongW(
                window.0,
                GWL_STYLE,
                (WS_OVERLAPPEDWINDOW | WS_POPUP).0 as i32,
            );
            SetWindowLongW(window.0, GWL_EXSTYLE, WS_EX_WINDOWEDGE.0 as i32);
            SetWindowPos(
                window.0,
                Some(if topmost {
                    HWND_TOPMOST
                } else {
                    HWND_NOTOPMOST
                }),
                0,
                0,
                0,
                0,
                SWP_FRAMECHANGED | SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE,
            )
            .expect("native restyle");
            SendMessageW(
                window.0,
                WM_NCACTIVATE,
                Some(WPARAM(topmost as usize)),
                Some(LPARAM(0)),
            );
            assert_eq!(GetWindowLongW(window.0, GWL_STYLE) as u32 & WS_CAPTION.0, 0);
            assert_ne!(
                GetWindowLongW(window.0, GWL_STYLE) as u32 & WS_THICKFRAME.0,
                0
            );
            // Windows may retain WINDOWEDGE for a resizable HWND. It must
            // occupy no pixels: the client/outer bounds below verify that.
            let (mut outer, mut client) = (RECT::default(), RECT::default());
            GetWindowRect(window.0, &mut outer).expect("outer bounds");
            GetClientRect(window.0, &mut client).expect("client bounds");
            assert_eq!(outer.right - outer.left, client.right - client.left);
            assert_eq!(outer.bottom - outer.top, client.bottom - client.top);
        }
    }
}
