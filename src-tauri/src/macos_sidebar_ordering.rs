//! AppKit normally activates and raises an application's windows on mouse-down.
//! Delay sidebar ordering until mouse-up, then cancel it if the gesture drags.
//! Ordinary clicks still acquire keyboard focus; dragging never raises main.
//! Keep Tao/WebKit's classes, ivars and KVO hierarchy intact.
use std::sync::{
    atomic::{AtomicBool, AtomicUsize, Ordering},
    Mutex, OnceLock,
};

use objc2::{
    runtime::{AnyClass, AnyObject, Bool, Imp, Sel},
    sel, MainThreadOnly,
};
use objc2_app_kit::{NSApplication, NSEvent, NSEventType, NSView, NSWindow};

static SIDEBAR_WINDOW: AtomicUsize = AtomicUsize::new(0);
static DRAGGING: AtomicBool = AtomicBool::new(false);
type DelayFn = unsafe extern "C-unwind" fn(&AnyObject, Sel, &NSEvent) -> Bool;
type SendFn = unsafe extern "C-unwind" fn(&AnyObject, Sel, &NSEvent);
static DELAY_HOOKS: Mutex<Vec<(usize, DelayFn)>> = Mutex::new(Vec::new());
static SEND_ORIGINAL: OnceLock<SendFn> = OnceLock::new();

fn is_sidebar(window: &NSWindow) -> bool {
    window as *const NSWindow as usize == SIDEBAR_WINDOW.load(Ordering::Relaxed)
}

extern "C-unwind" fn delay_ordering<const SLOT: usize>(
    this: &AnyObject,
    selector: Sel,
    event: &NSEvent,
) -> Bool {
    let view: &NSView = unsafe { &*(this as *const AnyObject).cast() };
    if view.window().is_some_and(|window| is_sidebar(&window)) {
        return Bool::YES;
    }
    // Each installed class gets its own trampoline. If an original WebKit
    // implementation calls super, it must reach that parent's saved method,
    // rather than recursively redispatching through the most-derived class.
    let original = DELAY_HOOKS.lock().unwrap()[SLOT].1;
    unsafe { original(this, selector, event) }
}

macro_rules! delay_callbacks {
    ($($slot:literal),*) => { [$(delay_ordering::<$slot> as DelayFn),*] };
}
const DELAY_CALLBACKS: [DelayFn; 32] = delay_callbacks!(
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25,
    26, 27, 28, 29, 30, 31
);

extern "C-unwind" fn send_event(this: &AnyObject, selector: Sel, event: &NSEvent) {
    let window: &NSWindow = unsafe { &*(this as *const AnyObject).cast() };
    if is_sidebar(window) && event.r#type() == NSEventType::LeftMouseDragged {
        DRAGGING.store(true, Ordering::Relaxed);
        NSApplication::sharedApplication(window.mtm()).preventWindowOrdering();
    }
    if is_sidebar(window) && event.r#type() == NSEventType::LeftMouseDown {
        DRAGGING.store(false, Ordering::Relaxed);
    }
    if is_sidebar(window)
        && event.r#type() == NSEventType::LeftMouseUp
        && DRAGGING.swap(false, Ordering::Relaxed)
    {
        crate::sidebar_dock::protect_after_content_drag();
    }
    if let Some(original) = SEND_ORIGINAL.get() {
        unsafe {
            original(this, selector, event);
        }
    }
}

fn install_delay(view: &NSView) -> Result<(), String> {
    let class = AnyObject::class(view);
    let mut hooks = DELAY_HOOKS.lock().map_err(|error| error.to_string())?;
    let key = class as *const AnyClass as usize;
    if !hooks.iter().any(|(installed, _)| *installed == key) {
        let callback = DELAY_CALLBACKS
            .get(hooks.len())
            .ok_or("Too many sidebar native view classes")?;
        let selector = sel!(shouldDelayWindowOrderingForEvent:);
        let method = class
            .instance_method(selector)
            .ok_or("Missing AppKit drag-ordering method")?;
        if !matches!(method.return_type().to_bytes(), b"B" | b"c") {
            return Err("Unsupported AppKit drag-ordering signature".into());
        }
        unsafe {
            hooks.push((key, std::mem::transmute(method.implementation())));
            let implementation: Imp = std::mem::transmute(*callback);
            objc2::ffi::class_replaceMethod(
                class as *const AnyClass as *mut AnyClass,
                selector,
                implementation,
                objc2::ffi::method_getTypeEncoding(method),
            );
        }
    }
    drop(hooks);
    for child in view.subviews() {
        install_delay(&child)?;
    }
    Ok(())
}

pub fn install(window: &tauri::WebviewWindow) -> Result<(), String> {
    let window = window.clone();
    window
        .clone()
        .run_on_main_thread(move || {
            let result = (|| -> Result<(), String> {
                let pointer = window.ns_window().map_err(|error| error.to_string())?;
                if pointer.is_null() {
                    return Err("Sidebar has no native window".into());
                }
                let native: &NSWindow = unsafe { &*pointer.cast() };
                let tao = AnyClass::get(c"TaoWindow").ok_or("Unsupported sidebar window host")?;
                let mut class = AnyObject::class(native);
                while class != tao {
                    class = class
                        .superclass()
                        .ok_or("Unsupported sidebar window hierarchy")?;
                }
                SIDEBAR_WINDOW.store(pointer as usize, Ordering::Relaxed);
                if SEND_ORIGINAL.get().is_none() {
                    let selector = sel!(sendEvent:);
                    let method = tao
                        .instance_method(selector)
                        .ok_or("Missing AppKit event dispatch")?;
                    unsafe {
                        let _ = SEND_ORIGINAL.set(std::mem::transmute(method.implementation()));
                        let implementation: Imp = std::mem::transmute(send_event as SendFn);
                        objc2::ffi::class_replaceMethod(
                            tao as *const AnyClass as *mut AnyClass,
                            selector,
                            implementation,
                            objc2::ffi::method_getTypeEncoding(method),
                        );
                    }
                }
                let content = native.contentView().ok_or("Sidebar has no content view")?;
                install_delay(&content)
            })();
            if let Err(error) = result {
                log::warn!("Could not configure sidebar drag ordering: {error}");
            }
        })
        .map_err(|error| error.to_string())
}
