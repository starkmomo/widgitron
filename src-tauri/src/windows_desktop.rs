//! Desktop widgets stay top-level, preserving DWM composition and monitor DPI.
//! Only their Z order changes. Explorer never owns/parents our windows, so an
//! Explorer restart cannot destroy them through a cross-process relationship.
use windows::{
    core::{w, BOOL},
    Win32::{
        Foundation::{HANDLE, HWND, LPARAM, LRESULT, WPARAM},
        UI::{
            Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass},
            WindowsAndMessaging::*,
        },
    },
};

const SUBCLASS_ID: usize = 0x57444454;
const TIMER_ID: usize = 0x57444454;

pub fn enabled(hwnd: HWND) -> bool {
    unsafe { !GetPropW(hwnd, w!("Widgitron.DesktopLayer")).is_invalid() }
}

unsafe extern "system" fn find_icon_host(hwnd: HWND, data: LPARAM) -> BOOL {
    if FindWindowExW(Some(hwnd), None, w!("SHELLDLL_DefView"), None).is_ok() {
        *(data.0 as *mut HWND) = hwnd;
        return BOOL(0);
    }
    BOOL(1)
}

fn icon_host() -> Option<HWND> {
    // Rediscover the shell rather than retaining HWNDs across Explorer restarts.
    unsafe {
        let mut host = HWND::default();
        let _ = EnumWindows(
            Some(find_icon_host),
            LPARAM(&mut host as *mut HWND as isize),
        );
        (!host.is_invalid()).then_some(host)
    }
}

/// Place immediately above the desktop's icon host and below ordinary apps.
/// Accepting an explicit host also lets native tests use only their own HWNDs.
pub fn place_above_desktop(hwnd: HWND, host: HWND) -> Result<(), String> {
    unsafe {
        let host_topmost = GetWindowLongW(host, GWL_EXSTYLE) as u32 & WS_EX_TOPMOST.0 != 0;
        let topmost = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32 & WS_EX_TOPMOST.0 != 0;
        let flags =
            SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE | SWP_NOOWNERZORDER | SWP_NOSENDCHANGING;
        if topmost && !host_topmost {
            SetWindowPos(hwnd, Some(HWND_NOTOPMOST), 0, 0, 0, 0, flags)
                .map_err(|error| error.to_string())?;
        }
        let mut above = GetWindow(host, GW_HWNDPREV).ok();
        while let Some(candidate) = above {
            if candidate == hwnd && topmost == host_topmost {
                return Ok(());
            }
            if candidate != hwnd && !enabled(candidate) {
                break;
            }
            above = GetWindow(candidate, GW_HWNDPREV).ok();
        }
        // A topmost taskbar above a normal desktop must not make the widget
        // topmost. During Show Desktop follow the shell's temporary Z band.
        let insert_after = match above {
            Some(candidate)
                if host_topmost
                    || GetWindowLongW(candidate, GWL_EXSTYLE) as u32 & WS_EX_TOPMOST.0 == 0 =>
            {
                candidate
            }
            _ if host_topmost => HWND_TOPMOST,
            _ => HWND_TOP,
        };
        SetWindowPos(hwnd, Some(insert_after), 0, 0, 0, 0, flags).map_err(|error| error.to_string())
    }
}

fn refresh(hwnd: HWND) -> Result<(), String> {
    if let Some(host) = icon_host() {
        place_above_desktop(hwnd, host)?;
    }
    Ok(())
}

unsafe extern "system" fn desktop_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    id: usize,
    _: usize,
) -> LRESULT {
    match message {
        WM_WINDOWPOSCHANGING => {
            // Activation/show/resize must not lift a desktop widget over apps.
            let result = DefSubclassProc(hwnd, message, wparam, lparam);
            if let Some(position) = (lparam.0 as *mut WINDOWPOS).as_mut() {
                position.flags |= SWP_NOZORDER;
            }
            result
        }
        WM_TIMER if wparam.0 == TIMER_ID => {
            // Show Desktop moves the shell without sending our HWND a Z-order
            // message. Re-anchor visible widgets without changing visibility,
            // geometry, focus or WebView zoom; also recover after shell restart.
            if IsWindowVisible(hwnd).as_bool() {
                let _ = refresh(hwnd);
            }
            LRESULT(0)
        }
        WM_NCDESTROY => {
            let _ = KillTimer(Some(hwnd), TIMER_ID);
            let _ = RemovePropW(hwnd, w!("Widgitron.DesktopLayer"));
            let _ = RemoveWindowSubclass(hwnd, Some(desktop_proc), id);
            DefSubclassProc(hwnd, message, wparam, lparam)
        }
        _ => DefSubclassProc(hwnd, message, wparam, lparam),
    }
}

/// Must run on the HWND's owning UI thread. Neither path reparents the window.
pub fn set_enabled(hwnd: HWND, desktop: bool) -> Result<(), String> {
    unsafe {
        if desktop {
            if !enabled(hwnd) {
                if !SetWindowSubclass(hwnd, Some(desktop_proc), SUBCLASS_ID, 0).as_bool() {
                    return Err("Could not install the Windows desktop layer handler".into());
                }
                if let Err(error) = SetPropW(
                    hwnd,
                    w!("Widgitron.DesktopLayer"),
                    Some(HANDLE(1 as *mut _)),
                ) {
                    let _ = RemoveWindowSubclass(hwnd, Some(desktop_proc), SUBCLASS_ID);
                    return Err(error.to_string());
                }
                if SetTimer(Some(hwnd), TIMER_ID, 250, None) == 0 {
                    let _ = RemovePropW(hwnd, w!("Widgitron.DesktopLayer"));
                    let _ = RemoveWindowSubclass(hwnd, Some(desktop_proc), SUBCLASS_ID);
                    return Err("Could not start the desktop layer timer".into());
                }
            }
            refresh(hwnd)
        } else {
            // Startup can reassert a pinned window's ordinary mode after Tao
            // has already made it topmost. Only clear the level when actually
            // leaving our desktop layer, not on an idempotent disable.
            if !enabled(hwnd) {
                return Ok(());
            }
            let _ = KillTimer(Some(hwnd), TIMER_ID);
            let _ = RemovePropW(hwnd, w!("Widgitron.DesktopLayer"));
            let _ = RemoveWindowSubclass(hwnd, Some(desktop_proc), SUBCLASS_ID);
            // Clear a temporary Show Desktop topmost band before ordinary pin
            // handling applies the user's chosen level.
            SetWindowPos(
                hwnd,
                Some(HWND_NOTOPMOST),
                0,
                0,
                0,
                0,
                SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE | SWP_NOOWNERZORDER,
            )
            .map_err(|error| error.to_string())
        }
    }
}
