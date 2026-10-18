use once_cell::sync::Lazy;
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::Mutex;
use std::time::Duration;
use tauri::AppHandle;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    RegisterHotKey, UnregisterHotKey, HOT_KEY_MODIFIERS, MOD_ALT, MOD_CONTROL, MOD_NOREPEAT,
    MOD_SHIFT, MOD_WIN, VK_SPACE,
};
use windows::Win32::UI::WindowsAndMessaging::{PeekMessageW, MSG, PM_REMOVE, WM_HOTKEY};

pub const DEFAULT_SIDEBAR_HOTKEY: &str = "Ctrl+Alt+W";

const SIDEBAR_HOTKEY_ID: i32 = 0x5754;

static HOTKEY_SENDER: Lazy<Mutex<Option<Sender<HotkeyCommand>>>> = Lazy::new(|| Mutex::new(None));

enum HotkeyCommand {
    Register(Option<String>, bool),
}

#[derive(Clone)]
struct ParsedHotkey {
    display: String,
    modifiers: HOT_KEY_MODIFIERS,
    key: u32,
}

pub fn start_global_sidebar_hotkey(app: AppHandle, hotkey: Option<String>, enabled: bool) {
    let (tx, rx) = mpsc::channel();
    if let Ok(mut sender) = HOTKEY_SENDER.lock() {
        if let Some(existing_sender) = sender.as_ref() {
            let _ = existing_sender.send(HotkeyCommand::Register(hotkey, enabled));
            return;
        }
        *sender = Some(tx);
    }

    if let Err(err) = std::thread::Builder::new()
        .name("widgitron-sidebar-hotkey".into())
        .spawn(move || {
            let mut current = if enabled { register_sidebar_hotkey(hotkey) } else { None };
            loop {
                drain_hotkey_messages(&app);

                match rx.recv_timeout(Duration::from_millis(80)) {
                    Ok(HotkeyCommand::Register(next_hotkey, enabled)) => {
                        unregister_sidebar_hotkey(current.take());
                        current = if enabled { register_sidebar_hotkey(next_hotkey) } else { None };
                    }
                    Err(RecvTimeoutError::Timeout) => {}
                    Err(RecvTimeoutError::Disconnected) => {
                        unregister_sidebar_hotkey(current.take());
                        break;
                    }
                }
            }
        })
    {
        log::warn!("Failed to start sidebar hotkey thread: {}", err);
    }
}

pub fn update_global_sidebar_hotkey(hotkey: Option<String>, enabled: bool) {
    if let Ok(sender) = HOTKEY_SENDER.lock() {
        if let Some(sender) = sender.as_ref() {
            let _ = sender.send(HotkeyCommand::Register(hotkey, enabled));
        }
    }
}

fn drain_hotkey_messages(app: &AppHandle) {
    let mut msg = MSG::default();
    while unsafe { PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE).as_bool() } {
        if msg.message == WM_HOTKEY && msg.wParam.0 == SIDEBAR_HOTKEY_ID as usize {
            let app_handle = app.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(err) = crate::sidebar_dock::toggle_pinned(&app_handle, true) {
                    log::warn!("Failed to toggle sidebar pin from hotkey: {}", err);
                }
            });
        }
    }
}

fn register_sidebar_hotkey(hotkey: Option<String>) -> Option<ParsedHotkey> {
    let raw = hotkey
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_SIDEBAR_HOTKEY);

    let parsed = match parse_hotkey(raw) {
        Ok(parsed) => parsed,
        Err(err) => {
            log::warn!(
                "Invalid sidebar hotkey '{}': {}. Falling back to {}.",
                raw,
                err,
                DEFAULT_SIDEBAR_HOTKEY
            );
            match parse_hotkey(DEFAULT_SIDEBAR_HOTKEY) {
                Ok(parsed) => parsed,
                Err(default_err) => {
                    log::warn!("Default sidebar hotkey is invalid: {}", default_err);
                    return None;
                }
            }
        }
    };

    let modifiers = parsed.modifiers | MOD_NOREPEAT;
    match unsafe { RegisterHotKey(None, SIDEBAR_HOTKEY_ID, modifiers, parsed.key) } {
        Ok(()) => {
            log::info!("Registered sidebar hotkey: {}", parsed.display);
            Some(parsed)
        }
        Err(err) => {
            log::warn!(
                "Failed to register sidebar hotkey '{}': {}",
                parsed.display,
                err
            );
            None
        }
    }
}

fn unregister_sidebar_hotkey(current: Option<ParsedHotkey>) {
    if let Some(parsed) = current {
        if let Err(err) = unsafe { UnregisterHotKey(None, SIDEBAR_HOTKEY_ID) } {
            log::warn!(
                "Failed to unregister sidebar hotkey '{}': {}",
                parsed.display,
                err
            );
        }
    }
}

fn parse_hotkey(raw: &str) -> Result<ParsedHotkey, String> {
    let parts: Vec<String> = raw
        .split('+')
        .map(|part| part.trim())
        .filter(|part| !part.is_empty())
        .map(|part| part.to_ascii_uppercase())
        .collect();

    if parts.len() < 2 {
        return Err("use a modifier plus a key, for example Ctrl+Alt+W".into());
    }

    let mut modifiers = HOT_KEY_MODIFIERS(0);
    let mut display_modifiers: Vec<String> = Vec::new();
    let mut key: Option<(String, u32)> = None;

    for part in parts {
        match part.as_str() {
            "CTRL" | "CONTROL" => {
                modifiers |= MOD_CONTROL;
                push_unique(&mut display_modifiers, "Ctrl".into());
            }
            "ALT" | "OPTION" => {
                modifiers |= MOD_ALT;
                push_unique(&mut display_modifiers, "Alt".into());
            }
            "SHIFT" => {
                modifiers |= MOD_SHIFT;
                push_unique(&mut display_modifiers, "Shift".into());
            }
            "WIN" | "WINDOWS" | "META" | "CMD" | "COMMAND" => {
                modifiers |= MOD_WIN;
                push_unique(&mut display_modifiers, "Win".into());
            }
            _ => {
                if key.is_some() {
                    return Err("only one non-modifier key is supported".into());
                }
                key = Some(parse_hotkey_key(&part)?);
            }
        }
    }

    if modifiers.0 == 0 {
        return Err("include at least one modifier such as Ctrl, Alt, Shift, or Win".into());
    }

    let (key_display, key_code) = key.ok_or_else(|| "missing final key".to_string())?;
    let mut display_parts = display_modifiers;
    display_parts.push(key_display);

    Ok(ParsedHotkey {
        display: display_parts.join("+"),
        modifiers,
        key: key_code,
    })
}

fn push_unique(parts: &mut Vec<String>, value: String) {
    if !parts.iter().any(|part| part == &value) {
        parts.push(value);
    }
}

fn parse_hotkey_key(part: &str) -> Result<(String, u32), String> {
    if part.len() == 1 {
        let ch = part.chars().next().unwrap();
        if ch.is_ascii_alphanumeric() {
            return Ok((ch.to_string(), ch as u32));
        }
    }

    if part == "SPACE" {
        return Ok(("Space".into(), VK_SPACE.0 as u32));
    }

    if let Some(rest) = part.strip_prefix('F') {
        if let Ok(index) = rest.parse::<u32>() {
            if (1..=24).contains(&index) {
                return Ok((format!("F{}", index), 111 + index));
            }
        }
    }

    Err("supported keys are A-Z, 0-9, F1-F24, and Space".into())
}
