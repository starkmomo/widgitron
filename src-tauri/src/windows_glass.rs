//! Windows backdrop for independent widgets. Use the same accent-blur path as
//! Tauri's window-vibrancy backend, checking the native return value. Unlike a
//! system backdrop type, it can be reapplied after WorkerW parenting changes.
use std::{collections::HashMap, ffi::c_void, sync::Mutex, time::Duration};

use once_cell::sync::Lazy;
use serde::Serialize;
use tauri::{Emitter, Runtime, WebviewWindow};
use crate::glass_shape::GlassDockEdge;
use windows::{
    core::{s, w},
    Win32::{
        Foundation::{HWND, RECT},
        Graphics::Gdi::{CombineRgn, CreateRectRgn, CreateRoundRectRgn, DeleteObject, SetWindowRgn, RGN_OR},
        System::LibraryLoader::{GetModuleHandleW, GetProcAddress},
        UI::{HiDpi::GetDpiForWindow, WindowsAndMessaging::GetWindowRect},
    },
};

#[derive(Clone, Copy, Serialize)]
struct GlassStatus {
    enabled: bool,
    dark: bool,
    applied: bool,
    dock_edge: Option<GlassDockEdge>,
}

struct GlassState {
    status: GlassStatus,
    zoom: f64,
    region: Option<(i32, i32, i32, Option<GlassDockEdge>)>,
    revision: u64,
    settle: Option<tauri::async_runtime::JoinHandle<()>>,
}

impl Default for GlassState {
    fn default() -> Self {
        Self {
            status: GlassStatus {
                enabled: false,
                dark: true,
                applied: false,
                dock_edge: None,
            },
            zoom: 1.0,
            region: None,
            revision: 0,
            settle: None,
        }
    }
}

// Entries are only created for the sidebar and four tracked widgets, and removed
// when their native windows are destroyed. Never hold this lock across Win32.
static STATES: Lazy<Mutex<HashMap<String, GlassState>>> = Lazy::new(Default::default);

#[repr(C)]
struct AccentPolicy {
    state: u32,
    flags: u32,
    color: u32,
    animation: u32,
}

#[repr(C)]
struct CompositionAttribute {
    attribute: u32,
    data: *mut c_void,
    size: usize,
}

fn set_composition(hwnd: HWND, enabled: bool, dark: bool) -> Result<(), String> {
    // These layouts and constants match the window-vibrancy implementation
    // already shipped with Tauri. Do not use the obsolete Vista blur API.
    type SetComposition =
        unsafe extern "system" fn(HWND, *mut CompositionAttribute) -> windows::core::BOOL;
    unsafe {
        let module = GetModuleHandleW(w!("user32.dll")).map_err(|error| error.to_string())?;
        let function = GetProcAddress(module, s!("SetWindowCompositionAttribute"))
            .ok_or("Windows does not expose accent blur")?;
        let set_composition: SetComposition = std::mem::transmute(function);
        let (r, g, b, a) = if dark {
            (18_u32, 24_u32, 38_u32, 64_u32)
        } else {
            (248_u32, 250_u32, 252_u32, 60_u32)
        };
        let mut policy = AccentPolicy {
            state: if enabled { 3 } else { 0 }, // BLURBEHIND / DISABLED
            flags: 2,
            color: r | (g << 8) | (b << 16) | (a << 24),
            animation: 0,
        };
        let mut attribute = CompositionAttribute {
            attribute: 19, // WCA_ACCENT_POLICY
            data: (&mut policy as *mut AccentPolicy).cast(),
            size: std::mem::size_of::<AccentPolicy>(),
        };
        if !set_composition(hwnd, &mut attribute).as_bool() {
            return Err("Windows rejected the widget backdrop".into());
        }
    }
    Ok(())
}

fn hwnd<R: Runtime>(win: &WebviewWindow<R>) -> Result<HWND, String> {
    let raw = win.hwnd().map_err(|error| error.to_string())?;
    Ok(HWND(raw.0 as *mut _))
}

fn update_region<R: Runtime>(win: &WebviewWindow<R>) -> Result<(), String> {
    let hwnd = hwnd(win)?;
    let mut bounds = RECT::default();
    unsafe {
        GetWindowRect(hwnd, &mut bounds).map_err(|error| error.to_string())?;
    }
    let width = (bounds.right - bounds.left).max(1);
    let height = (bounds.bottom - bounds.top).max(1);
    let dpi = unsafe { GetDpiForWindow(hwnd) }.max(96) as f64 / 96.0;
    let next = {
        let mut states = STATES.lock().unwrap_or_else(|error| error.into_inner());
        let Some(state) = states
            .get_mut(win.label())
            .filter(|state| state.status.enabled)
        else {
            return Ok(());
        };
        let diameter = ((if state.status.dock_edge.is_some() { 16.0 } else { 24.0 }) * dpi * state.zoom)
            .round()
            .max(2.0)
            .min(width.min(height) as f64) as i32;
        let next = (width, height, diameter, state.status.dock_edge);
        if state.region == Some(next) {
            return Ok(());
        }
        // Record before calling SetWindowRgn: it can synchronously send a
        // resize notification. A repeated notification must not recurse.
        state.region = Some(next);
        next
    };
    unsafe {
        let region = CreateRoundRectRgn(0, 0, next.0 + 1, next.1 + 1, next.2, next.2);
        // Fill in the docking edge's two corners, preserving the rounded pair
        // exposed to the desktop. Geometry includes the user's WebView zoom.
        let combined = if region.is_invalid() { false } else if let Some(edge) = next.3 {
            let r = next.2;
            let (left, top, right, bottom) = match edge {
                GlassDockEdge::Left => (0, 0, r, next.1 + 1),
                GlassDockEdge::Right => ((next.0 - r).max(0), 0, next.0 + 1, next.1 + 1),
                GlassDockEdge::Top => (0, 0, next.0 + 1, r),
                GlassDockEdge::Bottom => (0, (next.1 - r).max(0), next.0 + 1, next.1 + 1),
            };
            let square = CreateRectRgn(left, top, right, bottom);
            let ok = !square.is_invalid() && CombineRgn(Some(region), Some(region), Some(square), RGN_OR).0 != 0;
            if !square.is_invalid() { let _ = DeleteObject(square.into()); }
            ok
        } else { true };
        if !combined || SetWindowRgn(hwnd, Some(region), true) == 0 {
            // Windows takes ownership only after a successful SetWindowRgn.
            if !region.is_invalid() {
                let _ = DeleteObject(region.into());
            }
            if let Some(state) = STATES
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .get_mut(win.label())
            {
                state.region = None;
            }
            return Err("Could not clip the Windows glass corners".into());
        }
    }
    Ok(())
}

fn apply<R: Runtime>(win: &WebviewWindow<R>) -> Result<bool, String> {
    let (status, has_region) = {
        let states = STATES.lock().unwrap_or_else(|error| error.into_inner());
        let Some(state) = states.get(win.label()) else {
            return Ok(false);
        };
        (state.status, state.region.is_some())
    };
    // Plain themes have never installed an accent or a region. Leave their
    // existing WebView2 transparency setup entirely alone.
    if !status.enabled && !status.applied && !has_region {
        return Ok(false);
    }
    let handle = hwnd(win)?;
    let mut result = set_composition(handle, status.enabled, status.dark);
    if status.enabled && result.is_ok() {
        // A system blur otherwise fills the transparent CSS corners too.
        if let Err(error) = update_region(win) {
            let _ = set_composition(handle, false, status.dark);
            result = Err(error);
        }
    } else if !status.enabled {
        unsafe {
            SetWindowRgn(handle, None, true);
        }
    }
    let applied = status.enabled && result.is_ok();
    let status = GlassStatus { applied, ..status };
    {
        let mut states = STATES.lock().unwrap_or_else(|error| error.into_inner());
        if let Some(state) = states.get_mut(win.label()) {
            state.status = status;
            if !status.enabled {
                state.region = None;
            }
        }
    }
    // The owning webview needs this after reparenting: its fallback surface
    // must agree with whether the native effect was actually accepted.
    let _ = win.emit_to(
        tauri::EventTarget::webview_window(win.label()),
        "widget_glass_update",
        status,
    );
    match result {
        Err(error) if status.enabled => {
            log::warn!("Glass unavailable for {}: {}", win.label(), error);
            Ok(false)
        }
        Err(error) => Err(error),
        Ok(()) => Ok(applied),
    }
}

pub async fn set_widget_glass<R: Runtime>(
    win: &WebviewWindow<R>,
    enabled: bool,
    dark: bool,
    dock_edge: Option<GlassDockEdge>,
) -> Result<bool, String> {
    let win = win.clone();
    let (sender, receiver) = tokio::sync::oneshot::channel();
    win.clone()
        .run_on_main_thread(move || {
            {
                let mut states = STATES.lock().unwrap_or_else(|error| error.into_inner());
                let state = states.entry(win.label().to_string()).or_default();
                state.revision += 1;
                if let Some(task) = state.settle.take() {
                    task.abort();
                }
                state.status.enabled = enabled;
                state.status.dark = dark;
                state.status.dock_edge = dock_edge;
            }
            let _ = sender.send(apply(&win));
        })
        .map_err(|error| error.to_string())?;
    receiver.await.map_err(|error| error.to_string())?
}

/// SetParent and DPI transitions can discard the composition policy. Restore
/// it on the UI thread after each transition, without changing window layers.
pub fn refresh<R: Runtime>(win: &WebviewWindow<R>) {
    let win = win.clone();
    let _ = win.clone().run_on_main_thread(move || {
        if let Some(state) = STATES
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .get_mut(win.label())
        {
            if state.status.enabled {
                state.region = None;
            }
        }
        let _ =
            apply(&win).map_err(|error| log::warn!("Could not refresh widget glass: {}", error));
    });
}

/// Native blur can make interactive resizing expensive on some Windows builds.
/// Use the readable fallback while moving, then restore after the last event.
pub fn geometry_changed<R: Runtime>(win: &WebviewWindow<R>) {
    let (revision, status) = {
        let mut states = STATES.lock().unwrap_or_else(|error| error.into_inner());
        let Some(state) = states
            .get_mut(win.label())
            .filter(|state| state.status.enabled)
        else {
            return;
        };
        state.revision += 1;
        if let Some(task) = state.settle.take() {
            task.abort();
        }
        let previous = state.status;
        state.status.applied = false;
        (state.revision, previous)
    };
    if status.applied {
        if let Ok(handle) = hwnd(win) {
            let _ = set_composition(handle, false, status.dark);
        }
        let _ = win.emit_to(
            tauri::EventTarget::webview_window(win.label()),
            "widget_glass_update",
            GlassStatus {
                applied: false,
                ..status
            },
        );
    }
    let _ = update_region(win);
    let settled = win.clone();
    let task = tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(180)).await;
        let check = settled.clone();
        let _ = settled.run_on_main_thread(move || {
            let current = STATES
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .get(check.label())
                .is_some_and(|state| state.revision == revision && state.status.enabled);
            if current {
                let _ = apply(&check);
            }
        });
    });
    let mut states = STATES.lock().unwrap_or_else(|error| error.into_inner());
    if let Some(state) = states
        .get_mut(win.label())
        .filter(|state| state.revision == revision)
    {
        state.settle = Some(task);
    } else {
        task.abort();
    }
}

pub fn remember_zoom<R: Runtime>(win: &WebviewWindow<R>, zoom: f64) {
    STATES
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .entry(win.label().to_string())
        .or_default()
        .zoom = zoom;
    let _ = update_region(win);
}

pub fn forget(label: &str) {
    if let Some(mut state) = STATES
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .remove(label)
    {
        if let Some(task) = state.settle.take() {
            task.abort();
        }
    }
}
