//! Track widget hover even while inactive. WebKit suppresses inactive DOM hover;
//! use native edge cursors and edge-only resize hit targets for these windows.
//! Interior content stays with the WebView, with no activation or global monitor.
use std::cell::Cell;
use tauri::Manager;

use objc2::{
    available, define_class, msg_send, rc::Retained, runtime::Bool, AnyThread, DeclaredClass,
    MainThreadMarker, MainThreadOnly,
};
use objc2_app_kit::{
    NSApplication, NSAutoresizingMaskOptions, NSCursor, NSCursorFrameResizeDirections,
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
    header_cursor: Cell<bool>,
    drag: Cell<Option<ResizeDrag>>,
    move_start: Cell<Option<NSRect>>,
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
            if self.edge_at(local).is_some() || self.owns_header(local) { (self as *const Self).cast_mut().cast() }
            else { std::ptr::null_mut() }
        }

        #[unsafe(method(acceptsFirstMouse:))]
        fn accepts_first_mouse(&self, _event: &NSEvent) -> Bool { Bool::YES }

        #[unsafe(method(shouldDelayWindowOrderingForEvent:))]
        fn delay_ordering(&self, _event: &NSEvent) -> Bool {
            Bool::new(self.ivars().window.label() == "sidebar")
        }

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

        #[unsafe(method(cursorUpdate:))]
        fn cursor_update(&self, event: &NSEvent) { self.update_cursor(event); }

        #[unsafe(method(resetCursorRects))]
        fn reset_cursor_rects(&self) {
            if self.ivars().window.label() != "sidebar" { return; }
            let bounds = self.bounds();
            let band = crate::sidebar_dock::native_resize_band();
            let (header_height, controls_width) = crate::sidebar_dock::native_header_metrics();
            let top_band = (header_height / 44.0 * 6.0).clamp(4.0, 8.0);
            let rect = |x, y, width, height| NSRect::new(NSPoint::new(x, y), objc2_foundation::NSSize::new(width, height));
            if crate::sidebar_dock::native_vertical() {
                let grip_end = header_height / 44.0 * 40.0;
                self.addCursorRect_cursor(rect(grip_end, bounds.size.height - top_band, (bounds.size.width - controls_width - grip_end).max(1.0), top_band), &resize_cursor(ResizeEdge::North));
                self.addCursorRect_cursor(rect(0.0, 0.0, bounds.size.width, band), &resize_cursor(ResizeEdge::South));
            } else {
                self.addCursorRect_cursor(rect(0.0, 0.0, band, (bounds.size.height - header_height).max(1.0)), &resize_cursor(ResizeEdge::West));
                self.addCursorRect_cursor(rect(bounds.size.width - band, 0.0, band, (bounds.size.height - header_height).max(1.0)), &resize_cursor(ResizeEdge::East));
            }
        }

        #[unsafe(method(mouseExited:))]
        fn mouse_exited(&self, _event: &NSEvent) {
            self.publish(false);
            if self.ivars().drag.get().is_none() && self.ivars().move_start.get().is_none() { self.clear_resize_cursor(); }
        }

        #[unsafe(method(mouseDown:))]
        fn mouse_down(&self, event: &NSEvent) {
            if self.ivars().window.label() == "sidebar" {
                NSApplication::sharedApplication(self.mtm()).preventWindowOrdering();
                if self.edge_at(self.convertPoint_fromView(event.locationInWindow(), None)).is_none() {
                    if let Some(window) = self.window() {
                        let point = self.convertPoint_fromView(event.locationInWindow(), None);
                        let bounds = self.bounds();
                        let y = if self.isFlipped() { point.y } else { bounds.size.height - point.y };
                        let allow_undock = crate::sidebar_dock::native_undock_hit(point.x, y, bounds.size.width);
                        self.ivars().move_start.set(Some(window.frame()));
                        crate::sidebar_dock::begin_native_interaction(self.ivars().window.app_handle(), true, allow_undock);
                        NSCursor::closedHandCursor().set();
                        self.ivars().header_cursor.set(true);
                    }
                    return;
                }
            }
            self.begin_resize(event);
        }

        #[unsafe(method(mouseDragged:))]
        fn mouse_dragged(&self, _event: &NSEvent) {
            if self.ivars().move_start.get().is_some() {
                if let Err(error) = crate::sidebar_dock::update_native_move(&self.ivars().window) {
                    log::warn!("Sidebar drag failed: {error}");
                }
                NSCursor::closedHandCursor().set();
            } else { self.resize(); }
        }

        #[unsafe(method(mouseUp:))]
        fn mouse_up(&self, event: &NSEvent) {
            self.finish_move();
            self.finish_resize();
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
            header_cursor: Cell::new(false),
            drag: Cell::new(None),
            move_start: Cell::new(None),
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
        if self.ivars().window.label() == "sidebar" {
            if x < 0.0 || y < 0.0 || x > bounds.size.width || y > bounds.size.height { return None; }
            let band = crate::sidebar_dock::native_resize_band();
            let (header_height, controls_width) = crate::sidebar_dock::native_header_metrics();
            let top_band = (header_height / 44.0 * 6.0).clamp(4.0, 8.0);
            if crate::sidebar_dock::native_vertical() {
                // Keep the header's close/pin buttons outside the widened top
                // target; the lower edge remains one continuous easy target.
                if y <= top_band && (x < bounds.size.width - controls_width || y <= 4.0)
                    && !crate::sidebar_dock::native_undock_hit(x, y, bounds.size.width) { Some(ResizeEdge::North) }
                else if y >= bounds.size.height - band { Some(ResizeEdge::South) }
                else { None }
            } else if y < header_height && x > 4.0 && x < bounds.size.width - 4.0 { None }
            else if x <= band { Some(ResizeEdge::West) }
            else if x >= bounds.size.width - band { Some(ResizeEdge::East) }
            else { None }
        } else {
            geometry::edge_at(x, y, bounds.size.width, bounds.size.height)
        }
    }

    fn owns_header(&self, point: NSPoint) -> bool {
        let bounds = self.bounds();
        let y = if self.isFlipped() { point.y - bounds.origin.y }
            else { bounds.size.height - (point.y - bounds.origin.y) };
        self.ivars().window.label() == "sidebar"
            && crate::sidebar_dock::native_header_hit(point.x - bounds.origin.x, y, bounds.size.width)
    }

    fn update_cursor(&self, event: &NSEvent) {
        // A hide/theme change can interrupt a drag before mouseUp arrives.
        // Do not let that old gesture keep owning the cursor after release.
        if NSEvent::pressedMouseButtons() & 1 == 0 {
            self.finish_move();
            self.finish_resize();
        }
        let point = self.convertPoint_fromView(event.locationInWindow(), None);
        if let Some(edge) = self.edge_at(point) {
            self.ivars().resize_cursor.set(Some(edge));
            resize_cursor(edge).set();
        } else {
            self.clear_resize_cursor();
            if self.owns_header(point) {
                NSCursor::openHandCursor().set();
                self.ivars().header_cursor.set(true);
            }
        }
    }

    fn clear_resize_cursor(&self) {
        // Only restore a cursor that this tracker set. Leave text/link cursors
        // in the interior entirely to WebKit.
        let header = self.ivars().header_cursor.replace(false);
        if self.ivars().resize_cursor.replace(None).is_some() || header {
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
        if self.ivars().window.label() == "sidebar" {
            crate::sidebar_dock::begin_native_interaction(self.ivars().window.app_handle(), false, false);
        }
        self.ivars().resize_cursor.set(Some(edge));
        resize_cursor(edge).set();
    }

    fn finish_move(&self) {
        let Some(start) = self.ivars().move_start.replace(None) else { return; };
        let changed = self.window().is_some_and(|window| window.frame() != start);
        crate::sidebar_dock::finish_native_interaction(&self.ivars().window, true, changed);
        self.ivars().header_cursor.set(false);
        NSCursor::arrowCursor().set();
    }

    fn finish_resize(&self) {
        let Some(drag) = self.ivars().drag.replace(None) else { return; };
        if self.ivars().window.label() == "sidebar" {
            let changed = self.window().is_some_and(|window| {
                let size = window.frame().size;
                size.width != drag.start_frame.width || size.height != drag.start_frame.height
            });
            crate::sidebar_dock::finish_native_interaction(&self.ivars().window, false, changed);
        }
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
        if self.ivars().window.label() == "sidebar" {
            if let Some(screen) = window.screen() {
                let area = screen.visibleFrame();
                let (x, width) = crate::sidebar_placement::bounded_span(frame.origin.x, frame.size.width,
                    area.origin.x, area.size.width, minimum.width);
                let (y, height) = crate::sidebar_placement::bounded_span(frame.origin.y, frame.size.height,
                    area.origin.y, area.size.height, minimum.height);
                frame = NSRect::new(NSPoint::new(x, y), objc2_foundation::NSSize::new(width, height));
            }
        }
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
                native.invalidateCursorRectsForView(&tracker);
                Ok(())
            })();
            if let Err(error) = result {
                log::warn!("Could not install widget hover: {error}");
            }
        })
        .map_err(|error| error.to_string())
}
