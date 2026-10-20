//! Track only entry/exit of a widget's native bounds, even while it is inactive.
//! WebKit deliberately suppresses DOM hover in inactive windows. This view does
//! not hit-test, activate windows, capture the desktop, or monitor other apps.
use std::cell::Cell;

use objc2::{
    define_class, msg_send, rc::Retained, AnyThread, DeclaredClass, MainThreadMarker,
    MainThreadOnly,
};
use objc2_app_kit::{
    NSAutoresizingMaskOptions, NSEvent, NSTrackingArea, NSTrackingAreaOptions,
    NSUserInterfaceItemIdentification, NSView, NSVisualEffectView, NSWindow,
};
use objc2_foundation::{NSObjectProtocol, NSPoint, NSRect, NSString};

const TRACKER_ID: &str = "widgitron-widget-hover";

struct HoverIvars {
    window: tauri::WebviewWindow,
    hovered: Cell<bool>,
}

define_class!(
    #[unsafe(super(NSView))]
    #[thread_kind = MainThreadOnly]
    #[ivars = HoverIvars]
    struct WidgetHoverView;

    unsafe impl NSObjectProtocol for WidgetHoverView {}

    impl WidgetHoverView {
        // The webview below remains the target for clicks, dragging and resize.
        #[unsafe(method(hitTest:))]
        fn hit_test(&self, _point: NSPoint) -> *mut NSView { std::ptr::null_mut() }

        #[unsafe(method(mouseEntered:))]
        fn mouse_entered(&self, _event: &NSEvent) { self.publish(true); }

        // Also cover the pointer already being inside when the view is added.
        #[unsafe(method(mouseMoved:))]
        fn mouse_moved(&self, _event: &NSEvent) { self.publish(true); }

        #[unsafe(method(mouseExited:))]
        fn mouse_exited(&self, _event: &NSEvent) { self.publish(false); }
    }
);

impl WidgetHoverView {
    fn new(mtm: MainThreadMarker, window: tauri::WebviewWindow, frame: NSRect) -> Retained<Self> {
        let this = Self::alloc(mtm).set_ivars(HoverIvars {
            window,
            hovered: Cell::new(false),
        });
        unsafe { msg_send![super(this), initWithFrame: frame] }
    }

    fn publish(&self, hovered: bool) {
        if self.ivars().hovered.replace(hovered) == hovered {
            return;
        }
        let script = if hovered {
            "document.documentElement.setAttribute('data-widget-hovered', 'true')"
        } else {
            "document.documentElement.removeAttribute('data-widget-hovered')"
        };
        if let Err(error) = self.ivars().window.eval(script) {
            log::debug!("Could not update widget hover: {error}");
        }
    }
}

pub fn install(window: &tauri::WebviewWindow) -> Result<(), String> {
    let win = window.clone();
    window
        .run_on_main_thread(move || {
            let result = (|| -> Result<(), String> {
                let mtm = MainThreadMarker::new().ok_or("Widget hover requires the main thread")?;
                let native = win.ns_window().map_err(|error| error.to_string())?;
                if native.is_null() {
                    return Err("Widget has no native window".into());
                }
                let native: &NSWindow = unsafe { &*native.cast() };
                let content = native.contentView().ok_or("Widget has no content view")?;
                // Stay inside the original webview host when glass wraps it. This
                // preserves the tracker when switching back to an ordinary theme.
                let host = if content
                    .identifier()
                    .is_some_and(|id| id.to_string() == "widgitron-glass-background")
                {
                    content
                        .subviews()
                        .iter()
                        .find(|view| view.downcast_ref::<NSVisualEffectView>().is_none())
                        .ok_or("Glass has no webview host")?
                } else {
                    content
                };
                if host.subviews().iter().any(|view| {
                    view.identifier()
                        .is_some_and(|id| id.to_string() == TRACKER_ID)
                }) {
                    return Ok(());
                }
                let tracker = WidgetHoverView::new(mtm, win.clone(), host.bounds());
                tracker.setIdentifier(Some(&NSString::from_str(TRACKER_ID)));
                tracker.setAutoresizingMask(
                    NSAutoresizingMaskOptions::ViewWidthSizable
                        | NSAutoresizingMaskOptions::ViewHeightSizable,
                );
                let area = unsafe {
                    NSTrackingArea::initWithRect_options_owner_userInfo(
                        NSTrackingArea::alloc(),
                        tracker.bounds(),
                        NSTrackingAreaOptions::MouseEnteredAndExited
                            | NSTrackingAreaOptions::MouseMoved
                            | NSTrackingAreaOptions::ActiveAlways
                            | NSTrackingAreaOptions::InVisibleRect,
                        Some(&tracker),
                        None,
                    )
                };
                tracker.addTrackingArea(&area);
                // The native hierarchy owns the tracker and its tracking area.
                host.addSubview(&tracker);
                Ok(())
            })();
            if let Err(error) = result {
                log::warn!("Could not install widget hover: {error}");
            }
        })
        .map_err(|error| error.to_string())
}
