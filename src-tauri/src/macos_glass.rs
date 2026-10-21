//! Native window materials. The stable frosted material stays behind the
//! WebView; the experimental Liquid Glass owns the WebView as its contentView.
use objc2::{available, msg_send, sel, MainThreadMarker, rc::Retained,
    runtime::{AnyClass, AnyObject, Bool, Imp, Sel}};
use objc2_app_kit::{
    NSAppearance, NSAppearanceCustomization, NSAppearanceNameAqua, NSAppearanceNameDarkAqua,
    NSAutoresizingMaskOptions, NSColor, NSGlassEffectView, NSGlassEffectViewStyle,
    NSUserInterfaceItemIdentification, NSView, NSVisualEffectBlendingMode,
    NSVisualEffectMaterial, NSVisualEffectState, NSVisualEffectView, NSWindow, NSWindowOrderingMode,
};
use objc2_foundation::NSString;
use objc2_quartz_core::CACornerMask;
use crate::glass_shape::GlassDockEdge;

const GLASS_ROOT_ID: &str = "widgitron-glass-background";
const LIQUID_ROOT_ID: &str = "widgitron-native-liquid-glass";
// EXPERIMENTAL: AppKit has no public active-state override for Liquid Glass.
// Add one scoped appearance method to Tao's own window class. Do not replace
// an instance's class: AppKit observes contentView through KVO, and changing
// that observed class breaks its notification bookkeeping.
extern "C-unwind" fn liquid_active_appearance(this: &AnyObject, _: Sel) -> Bool {
    let native: &NSWindow = unsafe { &*(this as *const AnyObject).cast() };
    if native.contentView().and_then(|view| view.identifier())
        .is_some_and(|id| id.to_string() == LIQUID_ROOT_ID) {
        return Bool::YES;
    }
    let Some(original) = AnyClass::get(c"TaoWindow").and_then(|class| class.superclass()) else { return Bool::NO; };
    // All other themes and the main window keep the original AppKit behavior.
    unsafe { msg_send![super(this, original), _hasActiveAppearance] }
}

fn enable_liquid_visual_emphasis(native: &NSWindow) -> Result<(), String> {
    static INSTALLED: std::sync::OnceLock<Result<(), String>> = std::sync::OnceLock::new();
    let window_class = AnyClass::get(c"TaoWindow").ok_or("Unsupported native window host")?;
    let mut current = AnyObject::class(native);
    while current != window_class {
        current = current.superclass().ok_or("Unsupported native window class hierarchy")?;
    }
    INSTALLED.get_or_init(|| {
        let selector = sel!(_hasActiveAppearance);
        if window_class.instance_methods().iter().any(|method| method.name() == selector) {
            return Err("The native window host already customizes active appearance".into());
        }
        let method = window_class.instance_method(selector)
            .ok_or("This macOS version does not support the experimental appearance override")?;
        if !matches!(method.return_type().to_bytes(), b"B" | b"c") {
            return Err("macOS changed the experimental appearance method signature".into());
        }
        // Preserve the exact native ABI and all existing KVO classes and ivars.
        // The callback only changes a visual query for LIQUID_ROOT_ID; key/main
        // window state, first responder, activation, and event routing are untouched.
        let added = unsafe {
            let implementation: Imp = std::mem::transmute(
                liquid_active_appearance as extern "C-unwind" fn(&AnyObject, Sel) -> Bool);
            objc2::ffi::class_addMethod(window_class as *const AnyClass as *mut AnyClass,
                selector, implementation, objc2::ffi::method_getTypeEncoding(method))
        };
        if added.as_bool() { Ok(()) } else { Err("Could not install experimental visual emphasis".into()) }
    }).clone()
}

/// Detach only the application's own host, never any private AppKit effect views.
fn take_host(content: &NSView, id: &str) -> Result<Retained<NSView>, String> {
    if id == LIQUID_ROOT_ID && available!(macos = 26.0) {
        let glass = content.downcast_ref::<NSGlassEffectView>().ok_or("Invalid Liquid Glass container")?;
        let host = glass.contentView().ok_or("Liquid Glass has no content view")?;
        glass.setContentView(None);
        host.removeFromSuperview();
        return Ok(host);
    }
    let host = content.subviews().iter()
        .find(|view| view.downcast_ref::<NSVisualEffectView>().is_none())
        .ok_or("Glass container has no webview host")?;
    host.removeFromSuperview();
    Ok(host)
}

/// End the old material's window composition before installing a different one.
/// Moving Liquid Glass's content straight into a new effect container leaves
/// AppKit's old content-view association alive, and the WebView stops drawing.
/// Restoring the original window content first also makes direct material
/// switches follow the same teardown as switching through a plain theme.
fn restore_host(native: &NSWindow, content: &NSView, id: &str) -> Result<Retained<NSView>, String> {
    let frame = content.frame();
    let host = take_host(content, id)?;
    host.setFrame(frame);
    native.setContentView(Some(&host));
    Ok(host)
}

pub async fn set_widget_glass(
    win: &tauri::WebviewWindow,
    enabled: bool,
    dark: bool,
    dock_edge: Option<GlassDockEdge>,
    liquid: bool,
) -> Result<bool, String> {
    let win = win.clone();
    let (sender, receiver) = tokio::sync::oneshot::channel();
    win.clone().run_on_main_thread(move || {
        let result = (|| -> Result<bool, String> {
            let mtm = MainThreadMarker::new().ok_or("Glass must be configured on the main thread")?;
            let pointer = win.ns_window().map_err(|error| error.to_string())?;
            if pointer.is_null() { return Err("Widget has no native window".into()); }
            let native: &NSWindow = unsafe { &*pointer.cast() };
            let content = native.contentView().ok_or("Widget has no content view")?;
            let id = content.identifier().map(|id| id.to_string()).unwrap_or_default();
            let wrapped = id == GLASS_ROOT_ID || id == LIQUID_ROOT_ID;
            if !enabled {
                if wrapped {
                    restore_host(native, &content, &id)?;
                    native.setHasShadow(false);
                }
                return Ok(false);
            }
            let use_liquid = liquid && available!(macos = 26.0);
            if use_liquid { enable_liquid_visual_emphasis(native)?; }
            if liquid && !use_liquid {
                log::warn!("Native Liquid Glass requires macOS 26; using the stable glass material");
            }
            if use_liquid && id == LIQUID_ROOT_ID {
                let glass = content.downcast_ref::<NSGlassEffectView>().ok_or("Invalid Liquid Glass container")?;
                configure_liquid(glass, dark, dock_edge);
                return Ok(true);
            }
            if !use_liquid && id == GLASS_ROOT_ID {
                let glass = content.subviews().iter()
                    .find_map(|view| view.downcast::<NSVisualEffectView>().ok())
                    .ok_or("Glass container has no background")?;
                configure(&glass, dark);
                configure_corners(&glass, dock_edge);
                return Ok(true);
            }
            let frame = content.frame();
            let host = if wrapped { restore_host(native, &content, &id)? } else { content };
            let resize = NSAutoresizingMaskOptions::ViewWidthSizable | NSAutoresizingMaskOptions::ViewHeightSizable;
            host.setAutoresizingMask(resize);
            if use_liquid {
                let glass = NSGlassEffectView::new(mtm);
                glass.setIdentifier(Some(&NSString::from_str(LIQUID_ROOT_ID)));
                glass.setFrame(frame);
                glass.setAutoresizingMask(resize);
                configure_liquid(&glass, dark, dock_edge);
                native.setContentView(Some(&glass));
                host.setFrame(glass.bounds());
                // AppKit requires contentView containment for correct material
                // composition. A sibling WebView is not a supported substitute.
                glass.setContentView(Some(&host));
            } else {
                let root = NSView::new(mtm);
                root.setIdentifier(Some(&NSString::from_str(GLASS_ROOT_ID)));
                root.setFrame(frame);
                root.setAutoresizingMask(resize);
                let glass = NSVisualEffectView::new(mtm);
                glass.setFrame(root.bounds());
                glass.setAutoresizingMask(resize);
                configure_corners(&glass, dock_edge);
                configure(&glass, dark);
                native.setContentView(Some(&root));
                root.addSubview(&glass);
                host.setFrame(root.bounds());
                root.addSubview_positioned_relativeTo(&host, NSWindowOrderingMode::Above, Some(&glass));
            }
            native.setOpaque(false);
            native.setBackgroundColor(Some(&NSColor::clearColor()));
            native.setHasShadow(dock_edge.is_none());
            log::info!("{} window material: {}", win.label(), if use_liquid { "NSGlassEffectView (clear)" } else { "NSVisualEffectView" });
            Ok(true)
        })();
        let _ = sender.send(result);
    }).map_err(|error| error.to_string())?;
    receiver.await.map_err(|error| error.to_string())?
}

fn configure_corners(view: &NSView, edge: Option<GlassDockEdge>) {
    view.setWantsLayer(true);
    if let Some(layer) = view.layer() {
        let corners = match edge {
            Some(GlassDockEdge::Left) => CACornerMask::LayerMaxXMinYCorner | CACornerMask::LayerMaxXMaxYCorner,
            Some(GlassDockEdge::Right) => CACornerMask::LayerMinXMinYCorner | CACornerMask::LayerMinXMaxYCorner,
            Some(GlassDockEdge::Top) => CACornerMask::LayerMinXMaxYCorner | CACornerMask::LayerMaxXMaxYCorner,
            Some(GlassDockEdge::Bottom) => CACornerMask::LayerMinXMinYCorner | CACornerMask::LayerMaxXMinYCorner,
            None => CACornerMask::all(),
        };
        layer.setCornerRadius(if edge.is_some() { 8.0 } else { 12.0 });
        layer.setMaskedCorners(corners);
        layer.setMasksToBounds(true);
    }
}

fn configure_liquid(glass: &NSGlassEffectView, dark: bool, edge: Option<GlassDockEdge>) {
    glass.setStyle(NSGlassEffectViewStyle::Clear);
    glass.setTintColor(None);
    glass.setCornerRadius(if edge.is_some() { 8.0 } else { 12.0 });
    configure_corners(glass, edge);
    let name = unsafe { if dark { NSAppearanceNameDarkAqua } else { NSAppearanceNameAqua } };
    glass.setAppearance(NSAppearance::appearanceNamed(name).as_deref());
    // Leave alpha at 1: AppKit owns refraction and edge highlights. The isolated
    // experimental window-appearance override keeps this material emphasized.
}

fn configure(glass: &NSVisualEffectView, dark: bool) {
    // A thin dark backdrop avoids the white veil of a light popover. Content
    // contrast comes from local web surfaces rather than a heavy window tint.
    glass.setMaterial(if dark {
        NSVisualEffectMaterial::HUDWindow
    } else {
        NSVisualEffectMaterial::Popover
    });
    glass.setBlendingMode(NSVisualEffectBlendingMode::BehindWindow);
    glass.setState(NSVisualEffectState::Active);
    // Keep the material thin in both appearances. Sibling foreground content
    // stays opaque and the activity state stays fixed when focus changes.
    glass.setAlphaValue(if dark { 0.16 } else { 0.12 });
    // Keep the native material and web text in the same appearance, including
    // when the user chooses an app theme different from the macOS appearance.
    let name = unsafe {
        if dark {
            NSAppearanceNameDarkAqua
        } else {
            NSAppearanceNameAqua
        }
    };
    let appearance = NSAppearance::appearanceNamed(name);
    glass.setAppearance(appearance.as_deref());
}
