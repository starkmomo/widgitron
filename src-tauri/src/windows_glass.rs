//! Keep a thin native material behind the transparent WebView, independently
//! of foreground opacity, just like the macOS sibling visual-effect view.
//! Unsupported hosts retain clear glass instead of an opaque Acrylic fallback.
use std::{cell::RefCell, collections::HashMap, ffi::c_void, sync::Mutex};

use crate::glass_shape::GlassDockEdge;
use once_cell::sync::Lazy;
use serde::Serialize;
use tauri::{Emitter, Runtime, WebviewWindow};
use windows::{
    core::{s, w, Interface},
    System::{DispatcherQueue, DispatcherQueueController},
    Win32::{
        Foundation::{HWND, RECT},
        Graphics::{
            Dwm::{
                DwmExtendFrameIntoClientArea, DwmSetWindowAttribute, DWMSBT_NONE,
                DWMWA_SYSTEMBACKDROP_TYPE, DWMWA_USE_HOSTBACKDROPBRUSH, DWM_SYSTEMBACKDROP_TYPE,
            },
            Gdi::SetWindowRgn,
        },
        System::{
            LibraryLoader::{GetModuleHandleW, GetProcAddress},
            WinRT::{
                Composition::ICompositorDesktopInterop, CreateDispatcherQueueController,
                DispatcherQueueOptions, DQTAT_COM_NONE, DQTYPE_THREAD_CURRENT,
            },
        },
        UI::{Controls::MARGINS, HiDpi::GetDpiForWindow, WindowsAndMessaging::GetClientRect},
    },
    UI::Composition::{
        CompositionBorderMode, CompositionRoundedRectangleGeometry, Compositor,
        Desktop::DesktopWindowTarget, SpriteVisual,
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
    backend: Backdrop,
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
            backend: Backdrop::None,
        }
    }
}

// Entries are only created for the sidebar and four tracked widgets, and removed
// when their native windows are destroyed. Never hold this lock across Win32.
static STATES: Lazy<Mutex<HashMap<String, GlassState>>> = Lazy::new(Default::default);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Backdrop {
    None,
    Clear,
    Host,
}

struct NativeLayer {
    target: DesktopWindowTarget,
    visual: SpriteVisual,
    corners: CompositionRoundedRectangleGeometry,
}

impl Drop for NativeLayer {
    fn drop(&mut self) {
        let _ = self.target.Close();
    }
}

#[derive(Default)]
struct NativeRuntime {
    layers: HashMap<String, NativeLayer>,
    compositor: Option<Compositor>,
    queue: Option<DispatcherQueueController>,
}

// Composition objects belong to the HWND thread. Do not place them in the
// cross-thread status mutex or pass them to geometry/background workers.
thread_local! {
    static NATIVE: RefCell<NativeRuntime> = RefCell::new(NativeRuntime::default());
}

fn host_backdrop(hwnd: HWND, enabled: bool) -> windows::core::Result<()> {
    let value = i32::from(enabled);
    unsafe {
        DwmSetWindowAttribute(
            hwnd,
            DWMWA_USE_HOSTBACKDROPBRUSH,
            (&value as *const i32).cast(),
            std::mem::size_of_val(&value) as u32,
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct CornerLayout {
    x: f32,
    y: f32,
    width: f32,
    height: f32,
    radius: f32,
}

fn corner_layout(width: f32, height: f32, scale: f32, edge: Option<GlassDockEdge>) -> CornerLayout {
    // Retain fractional pixels: a binary, integer HRGN stair-steps the curve.
    let radius = ((if edge.is_some() { 8.0 } else { 12.0 }) * scale)
        .min(width.min(height) / 2.0)
        .max(0.0);
    let mut layout = CornerLayout {
        x: 0.0,
        y: 0.0,
        width,
        height,
        radius,
    };
    // Move the attached corners outside the viewport instead of combining
    // integer GDI regions. The two exposed corners retain the same smooth arc.
    match edge {
        Some(GlassDockEdge::Left) => {
            layout.x = -radius;
            layout.width += radius;
        }
        Some(GlassDockEdge::Right) => {
            layout.width += radius;
        }
        Some(GlassDockEdge::Top) => {
            layout.y = -radius;
            layout.height += radius;
        }
        Some(GlassDockEdge::Bottom) => {
            layout.height += radius;
        }
        None => {}
    }
    layout
}

fn window_corner_layout(label: &str, hwnd: HWND) -> windows::core::Result<CornerLayout> {
    let mut bounds = RECT::default();
    unsafe {
        GetClientRect(hwnd, &mut bounds)?;
    }
    let (zoom, edge) = STATES
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .get(label)
        .map(|state| (state.zoom, state.status.dock_edge))
        .unwrap_or((1.0, None));
    let dpi = unsafe { GetDpiForWindow(hwnd) }.max(96) as f64 / 96.0;
    Ok(corner_layout(
        (bounds.right - bounds.left).max(1) as f32,
        (bounds.bottom - bounds.top).max(1) as f32,
        (dpi * zoom) as f32,
        edge,
    ))
}

fn set_corner_geometry(
    corners: &CompositionRoundedRectangleGeometry,
    layout: CornerLayout,
) -> windows::core::Result<()> {
    let mut size = corners.Size()?;
    size.X = layout.width;
    size.Y = layout.height;
    corners.SetSize(size)?;
    let mut offset = corners.Offset()?;
    offset.X = layout.x;
    offset.Y = layout.y;
    corners.SetOffset(offset)?;
    let mut radius = corners.CornerRadius()?;
    radius.X = layout.radius;
    radius.Y = layout.radius;
    corners.SetCornerRadius(radius)
}

fn set_native_layer(
    label: &str,
    hwnd: HWND,
    enabled: bool,
    dark: bool,
) -> windows::core::Result<()> {
    let layout = if enabled {
        Some(window_corner_layout(label, hwnd)?)
    } else {
        None
    };
    NATIVE.with(|native| {
        let mut native = native.borrow_mut();
        if !enabled {
            native.layers.remove(label);
            let _ = host_backdrop(hwnd, false);
            return Ok(());
        }
        host_backdrop(hwnd, true)?;
        let opacity = if dark { 0.16 } else { 0.12 };
        if let Some(layer) = native.layers.get(label) {
            layer.visual.SetOpacity(opacity)?;
            return set_corner_geometry(&layer.corners, layout.unwrap());
        }
        if native.compositor.is_none() {
            if DispatcherQueue::GetForCurrentThread().is_err() {
                native.queue = Some(unsafe {
                    CreateDispatcherQueueController(DispatcherQueueOptions {
                        dwSize: std::mem::size_of::<DispatcherQueueOptions>() as u32,
                        threadType: DQTYPE_THREAD_CURRENT,
                        // Tauri already initializes this UI thread's COM apartment.
                        apartmentType: DQTAT_COM_NONE,
                    })?
                });
            }
            native.compositor = Some(Compositor::new()?);
        }
        let compositor = native
            .compositor
            .as_ref()
            .ok_or_else(windows::core::Error::from_thread)?;
        let interop: ICompositorDesktopInterop = compositor.cast()?;
        // Behind the webview: fading the material must never fade its text.
        let visual = compositor.CreateSpriteVisual()?;
        let mut fill = visual.RelativeSizeAdjustment()?;
        fill.X = 1.0;
        fill.Y = 1.0;
        visual.SetRelativeSizeAdjustment(fill)?;
        visual.SetIsHitTestVisible(false)?;
        visual.SetBorderMode(CompositionBorderMode::Soft)?;
        visual.SetBrush(&compositor.CreateHostBackdropBrush()?)?;
        visual.SetOpacity(opacity)?;
        let corners = compositor.CreateRoundedRectangleGeometry()?;
        set_corner_geometry(&corners, layout.unwrap())?;
        visual.SetClip(&compositor.CreateGeometricClipWithGeometry(&corners)?)?;
        let layer = NativeLayer {
            target: unsafe { interop.CreateDesktopWindowTarget(hwnd, false)? },
            visual,
            corners,
        };
        layer.target.SetRoot(&layer.visual)?;
        native.layers.insert(label.to_string(), layer);
        Ok(())
    })
}

fn native_backdrop_or_clear(label: &str, hwnd: HWND, dark: bool) -> Backdrop {
    match set_native_layer(label, hwnd, true, dark) {
        Ok(()) => Backdrop::Host,
        Err(error) => {
            let _ = set_native_layer(label, hwnd, false, dark);
            // Keep transparency if composition is unavailable (for example
            // unsupported Windows versions), without an opaque/black fallback.
            log::warn!(
                "Native background unavailable for {}: {}; using clear glass",
                label,
                error
            );
            Backdrop::Clear
        }
    }
}

fn clear_backdrop(hwnd: HWND) {
    unsafe {
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_SYSTEMBACKDROP_TYPE,
            (&DWMSBT_NONE as *const DWM_SYSTEMBACKDROP_TYPE).cast(),
            4,
        );
        let _ = DwmExtendFrameIntoClientArea(hwnd, &MARGINS::default());
    }
    let _ = clear_legacy_accent(hwnd);
}

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

// Disable an accent left by an earlier material before applying clear glass.
fn clear_legacy_accent(hwnd: HWND) -> Result<(), String> {
    type SetComposition =
        unsafe extern "system" fn(HWND, *mut CompositionAttribute) -> windows::core::BOOL;
    unsafe {
        let module = GetModuleHandleW(w!("user32.dll")).map_err(|error| error.to_string())?;
        let function = GetProcAddress(module, s!("SetWindowCompositionAttribute"))
            .ok_or("Windows does not expose accent composition")?;
        let set_composition: SetComposition = std::mem::transmute(function);
        let mut policy = AccentPolicy {
            state: 0,
            flags: 0,
            color: 0,
            animation: 0,
        };
        let mut attribute = CompositionAttribute {
            attribute: 19,
            data: (&mut policy as *mut AccentPolicy).cast(),
            size: std::mem::size_of::<AccentPolicy>(),
        };
        if !set_composition(hwnd, &mut attribute).as_bool() {
            return Err("Windows rejected clearing the previous accent".into());
        }
    }
    Ok(())
}

fn hwnd<R: Runtime>(win: &WebviewWindow<R>) -> Result<HWND, String> {
    let raw = win.hwnd().map_err(|error| error.to_string())?;
    Ok(HWND(raw.0 as *mut _))
}

fn update_corners<R: Runtime>(win: &WebviewWindow<R>) -> Result<(), String> {
    // Copy the agile geometry handle before any WinRT calls. A nested native
    // notification must not re-borrow the thread-local composition map.
    let corners = NATIVE.with(|native| {
        native.try_borrow().ok().and_then(|native| {
            native
                .layers
                .get(win.label())
                .map(|layer| layer.corners.clone())
        })
    });
    if let Some(corners) = corners {
        let handle = hwnd(win)?;
        let layout =
            window_corner_layout(win.label(), handle).map_err(|error| error.to_string())?;
        set_corner_geometry(&corners, layout).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn apply<R: Runtime>(win: &WebviewWindow<R>) -> Result<bool, String> {
    let handle = hwnd(win)?;
    crate::windows_frame::install(handle)?;
    let status = {
        let states = STATES.lock().unwrap_or_else(|error| error.into_inner());
        let Some(state) = states.get(win.label()) else {
            return Ok(false);
        };
        state.status
    };
    // Plain themes have never installed an accent or a region. Leave their
    // existing WebView2 transparency setup entirely alone.
    if !status.enabled && !status.applied {
        return Ok(false);
    }
    clear_backdrop(handle);
    // Clear any legacy binary region. Composition and CSS provide antialiased edges.
    unsafe {
        SetWindowRgn(handle, None, true);
    }
    let backend = if status.enabled {
        native_backdrop_or_clear(win.label(), handle, status.dark)
    } else {
        let _ = set_native_layer(win.label(), handle, false, status.dark);
        Backdrop::None
    };
    let applied = status.enabled;
    let status = GlassStatus { applied, ..status };
    {
        let mut states = STATES.lock().unwrap_or_else(|error| error.into_inner());
        if let Some(state) = states.get_mut(win.label()) {
            if state.backend != backend {
                log::info!("Windows backdrop for {}: {:?}", win.label(), backend);
            }
            state.status = status;
            state.backend = backend;
        }
    }
    // The owning webview needs this after reparenting: its fallback surface
    // must agree with whether the native effect was actually accepted.
    let _ = win.emit_to(
        tauri::EventTarget::webview_window(win.label()),
        "widget_glass_update",
        status,
    );
    Ok(applied)
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
                state.status.enabled = enabled;
                state.status.dark = dark;
                state.status.dock_edge = dock_edge;
            }
            let _ = sender.send(apply(&win));
        })
        .map_err(|error| error.to_string())?;
    receiver.await.map_err(|error| error.to_string())?
}

/// Native visuals automatically follow the target HWND's size. Only clipping
/// needs geometry updates; never flash an opaque fallback while dragging.
pub fn geometry_changed<R: Runtime>(win: &WebviewWindow<R>) {
    let win = win.clone();
    let _ = win.clone().run_on_main_thread(move || {
        if let Err(error) = update_corners(&win) {
            log::warn!(
                "Could not update glass corners for {}: {error}",
                win.label()
            );
        }
    });
}

pub fn remember_zoom<R: Runtime>(win: &WebviewWindow<R>, zoom: f64) {
    STATES
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .entry(win.label().to_string())
        .or_default()
        .zoom = zoom;
    geometry_changed(win);
}

pub fn forget(label: &str) {
    NATIVE.with(|native| {
        native.borrow_mut().layers.remove(label);
    });
    STATES
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .remove(label);
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows::Win32::{
        Foundation::{LPARAM, WPARAM},
        System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED},
        UI::WindowsAndMessaging::{
            CreateWindowExW, DestroyWindow, GetParent, GetWindowLongW, SendMessageW, SetParent,
            SetWindowLongW, SetWindowPos, GWL_STYLE, HWND_NOTOPMOST, HWND_TOPMOST, SWP_NOACTIVATE,
            SWP_NOMOVE, SWP_NOSIZE, WM_NCACTIVATE, WS_CHILD, WS_EX_TOOLWINDOW, WS_POPUP,
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

    fn hidden_window() -> OwnedWindow {
        OwnedWindow(unsafe {
            CreateWindowExW(
                WS_EX_TOOLWINDOW,
                w!("STATIC"),
                w!("Material lifecycle test"),
                WS_POPUP,
                0,
                0,
                320,
                240,
                None,
                None,
                None,
                None,
            )
            .expect("test HWND")
        })
    }

    #[test]
    fn corners_keep_fractional_dpi_and_zoom_without_rounding_to_a_region() {
        for dpi in [1.0, 1.25, 1.5, 1.75, 2.0] {
            for zoom in [0.75, 1.0, 1.1, 1.25] {
                let scale = dpi * zoom;
                let floating = corner_layout(400.0, 300.0, scale, None);
                assert!((floating.radius - 12.0 * scale).abs() < 0.001);
                assert_eq!(
                    (floating.x, floating.y, floating.width, floating.height),
                    (0.0, 0.0, 400.0, 300.0)
                );
                for edge in [
                    GlassDockEdge::Left,
                    GlassDockEdge::Right,
                    GlassDockEdge::Top,
                    GlassDockEdge::Bottom,
                ] {
                    let docked = corner_layout(400.0, 300.0, scale, Some(edge));
                    assert!((docked.radius - 8.0 * scale).abs() < 0.001);
                    match edge {
                        GlassDockEdge::Left => assert_eq!(
                            (docked.x, docked.width),
                            (-docked.radius, 400.0 + docked.radius)
                        ),
                        GlassDockEdge::Right => {
                            assert_eq!((docked.x, docked.width), (0.0, 400.0 + docked.radius))
                        }
                        GlassDockEdge::Top => assert_eq!(
                            (docked.y, docked.height),
                            (-docked.radius, 300.0 + docked.radius)
                        ),
                        GlassDockEdge::Bottom => {
                            assert_eq!((docked.y, docked.height), (0.0, 300.0 + docked.radius))
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn native_material_is_stable_and_desktop_children_fall_back_to_clear() {
        // The thread owns its COM apartment until exit, just like Tauri's UI
        // thread. Every HWND stays hidden: no user windows are touched.
        unsafe {
            CoInitializeEx(None, COINIT_APARTMENTTHREADED)
                .ok()
                .expect("COM");
        }
        let window = hidden_window();
        let parent = hidden_window();
        let label = "native-material-test";
        set_native_layer(label, window.0, true, false).expect("light material");
        NATIVE.with(|native| {
            let native = native.borrow();
            let layer = native.layers.get(label).expect("layer");
            assert_eq!(
                layer.visual.BorderMode().unwrap(),
                CompositionBorderMode::Soft
            );
            let clip: windows::UI::Composition::CompositionGeometricClip = layer
                .visual
                .Clip()
                .expect("visual clip")
                .cast()
                .expect("geometric clip");
            let geometry: CompositionRoundedRectangleGeometry = clip
                .Geometry()
                .expect("clip geometry")
                .cast()
                .expect("rounded geometry");
            let layout = corner_layout(320.0, 240.0, 1.1, Some(GlassDockEdge::Right));
            set_corner_geometry(&layer.corners, layout).expect("fractional corners");
            assert!((geometry.CornerRadius().unwrap().X - 8.8).abs() < 0.001);
            assert!((geometry.Size().unwrap().X - 328.8).abs() < 0.001);
        });
        for active in [true, false, true, false] {
            unsafe {
                SendMessageW(
                    window.0,
                    WM_NCACTIVATE,
                    Some(WPARAM(active as usize)),
                    Some(LPARAM(0)),
                );
                SetWindowPos(
                    window.0,
                    Some(if active { HWND_TOPMOST } else { HWND_NOTOPMOST }),
                    0,
                    0,
                    0,
                    0,
                    SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE,
                )
                .expect("restyle");
            }
            NATIVE.with(|native| {
                let native = native.borrow();
                let layer = native.layers.get(label).expect("live layer");
                assert_eq!(layer.visual.Opacity().expect("opacity"), 0.12);
                assert!(!layer.target.IsTopmost().expect("behind webview"));
            });
        }
        set_native_layer(label, window.0, true, true).expect("dark material");
        NATIVE.with(|native| {
            assert_eq!(
                native
                    .borrow()
                    .layers
                    .get(label)
                    .expect("layer")
                    .visual
                    .Opacity()
                    .expect("opacity"),
                0.16
            )
        });
        set_native_layer(label, window.0, false, false).expect("remove material");
        NATIVE.with(|native| assert!(!native.borrow().layers.contains_key(label)));
        set_native_layer(label, window.0, true, false).expect("recreate material");
        unsafe {
            let style = GetWindowLongW(window.0, GWL_STYLE) as u32;
            SetWindowLongW(
                window.0,
                GWL_STYLE,
                ((style | WS_CHILD.0) & !WS_POPUP.0) as i32,
            );
            let _ = SetParent(window.0, Some(parent.0));
            assert_eq!(GetParent(window.0).expect("parent"), parent.0);
        }
        assert_eq!(
            native_backdrop_or_clear(label, window.0, true),
            Backdrop::Clear
        );
        NATIVE.with(|native| assert!(!native.borrow().layers.contains_key(label)));
        unsafe {
            let _ = SetParent(window.0, None);
            let style = GetWindowLongW(window.0, GWL_STYLE) as u32;
            SetWindowLongW(
                window.0,
                GWL_STYLE,
                ((style | WS_POPUP.0) & !WS_CHILD.0) as i32,
            );
        }
        assert_eq!(
            native_backdrop_or_clear(label, window.0, true),
            Backdrop::Host
        );
        set_native_layer(label, window.0, false, true).expect("cleanup restored floating window");
    }
}
