//! Track widget hover even while inactive. WebKit suppresses inactive DOM hover;
//! use native edge cursors and edge-only resize hit targets for these windows.
//! Interior content stays with the WebView, with no activation or global monitor.
use std::cell::Cell;

use objc2::{
    available, define_class, msg_send, rc::Retained, runtime::Bool, AnyThread, DeclaredClass,
    MainThreadMarker, MainThreadOnly,
};
use objc2_app_kit::{
    NSAutoresizingMaskOptions, NSCursor, NSCursorFrameResizeDirections,
    NSCursorFrameResizePosition, NSEvent, NSGlassEffectView, NSTrackingArea, NSTrackingAreaOptions,
    NSUserInterfaceItemIdentification, NSView, NSVisualEffectView, NSWindow,
};
use objc2_foundation::{NSObjectProtocol, NSPoint, NSRect, NSString};

#[path = "widget_resize.rs"]
mod geometry;
use geometry::{Frame, ResizeEdge};

const TRACKER_ID: &str = "widgitron-widget-hover";

#[derive(Clone, Copy)]
struct ResizeDrag {
    edge: ResizeEdge,
    start_pointer: NSPoint,
    start_frame: Frame,
}

struct HoverIvars {
    window: tauri::WebviewWindow,
    hovered: Cell<bool>,
    resize_cursor: Cell<Option<ResizeEdge>>,
    drag: Cell<Option<ResizeDrag>>,
}

define_class!(
    #[unsafe(super(NSView))]
    #[thread_kind = MainThreadOnly]
    #[ivars = HoverIvars]
    struct WidgetHoverView;

    unsafe impl NSObjectProtocol for WidgetHoverView {}

    impl WidgetHoverView {
        // Do not intercept cards, header actions, dropdowns or their gestures.
        // Only the frame perimeter owns native resize input.
        #[unsafe(method(hitTest:))]
        fn hit_test(&self, point: NSPoint) -> *mut NSView {
            // AppKit invokes hitTest on the main thread; keep its parent
            // retained while converting the parent's coordinate to this view.
            let parent = unsafe { self.superview() };
            let local = self.convertPoint_fromView(point, parent.as_deref());
            if self.edge_at(local).is_some() { (self as *const Self).cast_mut().cast() }
            else { std::ptr::null_mut() }
        }

        #[unsafe(method(acceptsFirstMouse:))]
        fn accepts_first_mouse(&self, _event: &NSEvent) -> Bool { Bool::YES }

        #[unsafe(method(mouseEntered:))]
        fn mouse_entered(&self, event: &NSEvent) {
            self.publish(true);
            self.update_cursor(event);
        }

        // Also cover the pointer already being inside when the view is added.
        #[unsafe(method(mouseMoved:))]
        fn mouse_moved(&self, event: &NSEvent) {
            self.publish(true);
            self.update_cursor(event);
        }

        #[unsafe(method(mouseExited:))]
        fn mouse_exited(&self, _event: &NSEvent) {
            self.publish(false);
            if self.ivars().drag.get().is_none() { self.clear_resize_cursor(); }
        }

        #[unsafe(method(mouseDown:))]
        fn mouse_down(&self, event: &NSEvent) { self.begin_resize(event); }

        #[unsafe(method(mouseDragged:))]
        fn mouse_dragged(&self, _event: &NSEvent) { self.resize(); }

        #[unsafe(method(mouseUp:))]
        fn mouse_up(&self, event: &NSEvent) {
            self.ivars().drag.set(None);
            self.update_cursor(event);
        }
    }
);

impl WidgetHoverView {
    fn new(mtm: MainThreadMarker, window: tauri::WebviewWindow, frame: NSRect) -> Retained<Self> {
        let this = Self::alloc(mtm).set_ivars(HoverIvars {
            window,
            hovered: Cell::new(false),
            resize_cursor: Cell::new(None),
            drag: Cell::new(None),
        });
        unsafe { msg_send![super(this), initWithFrame: frame] }
    }

    fn edge_at(&self, point: NSPoint) -> Option<ResizeEdge> {
        let bounds = self.bounds();
        let x = point.x - bounds.origin.x;
        let y = if self.isFlipped() {
            point.y - bounds.origin.y
        } else {
            bounds.size.height - (point.y - bounds.origin.y)
        };
        geometry::edge_at(x, y, bounds.size.width, bounds.size.height)
    }

    fn update_cursor(&self, event: &NSEvent) {
        // A hide/theme change can interrupt a drag before mouseUp arrives.
        // Do not let that old gesture keep owning the cursor after release.
        if NSEvent::pressedMouseButtons() & 1 == 0 {
            self.ivars().drag.set(None);
        }
        let point = self.convertPoint_fromView(event.locationInWindow(), None);
        if let Some(edge) = self.edge_at(point) {
            self.ivars().resize_cursor.set(Some(edge));
            resize_cursor(edge).set();
        } else {
            self.clear_resize_cursor();
        }
    }

    fn clear_resize_cursor(&self) {
        // Only restore a cursor that this tracker set. Leave text/link cursors
        // in the interior entirely to WebKit.
        if self.ivars().resize_cursor.replace(None).is_some() {
            NSCursor::arrowCursor().set();
        }
    }

    fn begin_resize(&self, event: &NSEvent) {
        let point = self.convertPoint_fromView(event.locationInWindow(), None);
        let Some(edge) = self.edge_at(point) else {
            return;
        };
        let Some(window) = self.window() else {
            return;
        };
        let frame = window.frame();
        self.ivars().drag.set(Some(ResizeDrag {
            edge,
            start_pointer: NSEvent::mouseLocation(),
            start_frame: Frame {
                x: frame.origin.x,
                y: frame.origin.y,
                width: frame.size.width,
                height: frame.size.height,
            },
        }));
        self.ivars().resize_cursor.set(Some(edge));
        resize_cursor(edge).set();
    }

    fn resize(&self) {
        let Some(drag) = self.ivars().drag.get() else {
            return;
        };
        let Some(window) = self.window() else {
            return;
        };
        let pointer = NSEvent::mouseLocation();
        // Tauri/Tao's startResizeDragging is unsupported on macOS. Native
        // mouseDragged keeps capture until release, even outside the window.
        // Reuse the live native bounds installed by widget_layout; do not set
        // another minimum or convert logical points through monitor DPI/zoom.
        let minimum = window.minSize();
        let maximum = window.maxSize();
        let next = geometry::resize_frame(
            drag.start_frame,
            drag.edge,
            pointer.x - drag.start_pointer.x,
            pointer.y - drag.start_pointer.y,
            (minimum.width, minimum.height),
            (maximum.width, maximum.height),
        );
        let mut frame = window.frame();
        frame.origin.x = next.x;
        frame.origin.y = next.y;
        frame.size.width = next.width;
        frame.size.height = next.height;
        window.setFrame_display(frame, true);
        resize_cursor(drag.edge).set();
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

fn resize_cursor(edge: ResizeEdge) -> Retained<NSCursor> {
    if available!(macos = 15.0) {
        use NSCursorFrameResizePosition as Position;
        let position = match edge {
            ResizeEdge::North => Position::Top,
            ResizeEdge::South => Position::Bottom,
            ResizeEdge::East => Position::Right,
            ResizeEdge::West => Position::Left,
            ResizeEdge::NorthEast => Position::TopRight,
            ResizeEdge::NorthWest => Position::TopLeft,
            ResizeEdge::SouthEast => Position::BottomRight,
            ResizeEdge::SouthWest => Position::BottomLeft,
        };
        NSCursor::frameResizeCursorFromPosition_inDirections(
            position,
            NSCursorFrameResizeDirections::All,
        )
    } else {
        // Older AppKit versions have no public diagonal frame cursor factory.
        #[allow(deprecated)]
        match edge {
            ResizeEdge::North | ResizeEdge::South => NSCursor::resizeUpDownCursor(),
            _ => NSCursor::resizeLeftRightCursor(),
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
                } else if content
                    .identifier()
                    .is_some_and(|id| id.to_string() == "widgitron-native-liquid-glass")
                    && available!(macos = 26.0)
                {
                    content
                        .downcast_ref::<NSGlassEffectView>()
                        .and_then(|glass| glass.contentView())
                        .ok_or("Liquid Glass has no webview host")?
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
                            // ActiveAlways intentionally uses mouseMoved:
                            // AppKit suppresses cursorUpdate: in inactive apps.
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
