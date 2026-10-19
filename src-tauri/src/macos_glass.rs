//! A native background material with a fixed active appearance. Unlike
//! NSGlassEffectView, NSVisualEffectView exposes a public activity-state API.
//! Keep it behind the webview so foreground text never participates in vibrancy.
use objc2::MainThreadMarker;
use objc2_app_kit::{
    NSAppearance, NSAppearanceCustomization, NSAppearanceNameAqua, NSAppearanceNameDarkAqua,
    NSAutoresizingMaskOptions, NSColor, NSUserInterfaceItemIdentification, NSView,
    NSVisualEffectBlendingMode, NSVisualEffectMaterial, NSVisualEffectState, NSVisualEffectView,
    NSWindow, NSWindowOrderingMode,
};
use objc2_foundation::NSString;
use objc2_quartz_core::CACornerMask;
use crate::glass_shape::GlassDockEdge;

const GLASS_ROOT_ID: &str = "widgitron-glass-background";

pub async fn set_widget_glass(
    win: &tauri::WebviewWindow,
    enabled: bool,
    dark: bool,
    dock_edge: Option<GlassDockEdge>,
) -> Result<bool, String> {
    let win = win.clone();
    let (sender, receiver) = tokio::sync::oneshot::channel();
    win.clone()
        .run_on_main_thread(move || {
            let result = (|| -> Result<bool, String> {
                let mtm =
                    MainThreadMarker::new().ok_or("Glass must be configured on the main thread")?;
                let native = win.ns_window().map_err(|error| error.to_string())?;
                if native.is_null() {
                    return Err("Widget has no native window".into());
                }
                // Tauri lends this pointer only for use on the main thread.
                let native: &NSWindow = unsafe { &*native.cast() };
                let content = native.contentView().ok_or("Widget has no content view")?;
                let is_glass_root = content
                    .identifier()
                    .is_some_and(|id| id.to_string() == GLASS_ROOT_ID);
                if !enabled {
                    if is_glass_root {
                        let host = content
                            .subviews()
                            .iter()
                            .find(|view| view.downcast_ref::<NSVisualEffectView>().is_none())
                            .ok_or("Glass container has no webview host")?;
                        host.removeFromSuperview();
                        native.setContentView(Some(&host));
                        native.setHasShadow(false);
                    }
                    return Ok(false);
                }
                if is_glass_root {
                    let views = content.subviews();
                    let glass = views
                        .iter()
                        .find_map(|view| view.downcast::<NSVisualEffectView>().ok())
                        .ok_or("Glass container has no background")?;
                    configure(&glass, dark);
                    configure_corners(&glass, dock_edge);
                    return Ok(true);
                }
                let resize = NSAutoresizingMaskOptions::ViewWidthSizable
                    | NSAutoresizingMaskOptions::ViewHeightSizable;
                let root = NSView::new(mtm);
                root.setIdentifier(Some(&NSString::from_str(GLASS_ROOT_ID)));
                root.setFrame(content.frame());
                root.setAutoresizingMask(resize);

                let glass = NSVisualEffectView::new(mtm);
                glass.setFrame(root.bounds());
                glass.setAutoresizingMask(resize);
                glass.setWantsLayer(true);
                configure_corners(&glass, dock_edge);
                configure(&glass, dark);

                native.setContentView(Some(&root));
                root.addSubview(&glass);
                content.setFrame(root.bounds());
                content.setAutoresizingMask(resize);
                root.addSubview_positioned_relativeTo(
                    &content,
                    NSWindowOrderingMode::Above,
                    Some(&glass),
                );
                native.setOpaque(false);
                native.setBackgroundColor(Some(&NSColor::clearColor()));
                native.setHasShadow(dock_edge.is_none());
                Ok(true)
            })();
            let _ = sender.send(result);
        })
        .map_err(|error| error.to_string())?;
    receiver.await.map_err(|error| error.to_string())?
}

fn configure_corners(glass: &NSVisualEffectView, edge: Option<GlassDockEdge>) {
    if let Some(layer) = glass.layer() {
        let corners = match edge {
            Some(GlassDockEdge::Left) => CACornerMask::LayerMaxXMinYCorner | CACornerMask::LayerMaxXMaxYCorner,
            Some(GlassDockEdge::Right) => CACornerMask::LayerMinXMinYCorner | CACornerMask::LayerMinXMaxYCorner,
            Some(GlassDockEdge::Top) => CACornerMask::LayerMinXMinYCorner | CACornerMask::LayerMaxXMinYCorner,
            Some(GlassDockEdge::Bottom) => CACornerMask::LayerMinXMaxYCorner | CACornerMask::LayerMaxXMaxYCorner,
            None => CACornerMask::all(),
        };
        layer.setCornerRadius(if edge.is_some() { 8.0 } else { 12.0 });
        layer.setMaskedCorners(corners);
        layer.setMasksToBounds(true);
    }
}

fn configure(glass: &NSVisualEffectView, dark: bool) {
    // A HUD is an independent floating utility surface. Always use its active
    // material without activating the app, changing key windows, or polling.
    glass.setMaterial(NSVisualEffectMaterial::HUDWindow);
    glass.setBlendingMode(NSVisualEffectBlendingMode::BehindWindow);
    glass.setState(NSVisualEffectState::Active);
    // Soften the HUD's neutral tint without fading the sibling web content.
    // Let the wallpaper's colors through instead of a heavy grey surface.
    glass.setAlphaValue(0.6);
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
