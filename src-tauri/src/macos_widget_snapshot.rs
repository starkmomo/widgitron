//! The WidgetKit extension reads display-only snapshots from App Group storage
//! or from the loopback feed when ad-hoc signatures cannot access App Groups.
//! Never put credentials or raw provider responses in this file.

use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::ffi::{c_char, CString};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::time::Duration;
use libloading::{Library, Symbol};
use tauri::AppHandle;
use objc2_foundation::{NSFileManager, NSString};

use crate::models::{AppConfig, GlobalState, GpuConfig, PaperConfig, PaperDeadlineInfo, QuotaConfig, QuotaItem, ServerGpuData};

const GROUP_ID: &str = match option_env!("WIDGITRON_APP_GROUP_ID") {
    Some(value) => value,
    None => "group.com.evan.widgitron",
};
static SNAPSHOT_SEQUENCE: AtomicU64 = AtomicU64::new(0);
const SNAPSHOT_PORT: u16 = 42837;
const SNAPSHOT_FILES: [&str; 3] = ["quota-snapshot.json", "gpu-snapshot.json", "deadline-snapshot.json"];

pub fn start_snapshot_server(app: &AppHandle) -> Result<(), String> {
    let listener = TcpListener::bind(("127.0.0.1", SNAPSHOT_PORT))
        .map_err(|error| format!("Cannot bind local widget snapshot server: {error}"))?;
    let directory = crate::utils::get_config_dir(app).join("widget-snapshots");
    std::thread::Builder::new()
        .name("widgitron-widget-snapshots".into())
        .spawn(move || {
            for connection in listener.incoming() {
                match connection {
                    Ok(stream) => serve_snapshot(stream, &directory),
                    Err(error) => log::warn!("Widget snapshot server connection failed: {error}"),
                }
            }
        })
        .map_err(|error| format!("Cannot start widget snapshot server: {error}"))?;
    Ok(())
}

fn serve_snapshot(mut stream: TcpStream, directory: &std::path::Path) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(1)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(1)));
    let mut request = [0u8; 1024];
    let Ok(size) = stream.read(&mut request) else { return };
    let request = String::from_utf8_lossy(&request[..size]);
    let filename = SNAPSHOT_FILES.iter().find(|file| request.starts_with(&format!("GET /{file} HTTP/")));
    let (status, body) = match filename.and_then(|file| fs::read(directory.join(file)).ok()) {
        Some(bytes) => ("200 OK", bytes),
        None => ("404 Not Found", Vec::new()),
    };
    let header = format!("HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n", body.len());
    let _ = stream.write_all(header.as_bytes());
    let _ = stream.write_all(&body);
}

#[derive(Serialize)]
struct QuotaSnapshot<'a> {
    language: &'a str,
    show_plan_type: bool,
    items: Vec<QuotaSnapshotItem<'a>>,
}

#[derive(Serialize)]
struct QuotaSnapshotItem<'a> {
    name: &'a str,
    provider: &'a str,
    current_value: Option<f64>,
    max_quota: Option<f64>,
    unit: Option<&'a str>,
    primary_name: Option<&'a str>,
    primary_reset: Option<&'a str>,
    last_update: Option<&'a str>,
    plan_type: Option<&'a str>,
    error_msg: Option<&'a str>,
}

#[derive(Serialize)]
struct GpuSnapshot<'a> {
    language: &'a str,
    servers: Vec<GpuSnapshotServer<'a>>,
}

#[derive(Serialize)]
struct GpuSnapshotServer<'a> {
    host: &'a str,
    is_online: bool,
    gpu_count: usize,
    average_util: Option<f32>,
    cpu_percent: Option<f32>,
    memory_used_bytes: Option<u64>,
    memory_total_bytes: Option<u64>,
}

#[derive(Serialize)]
struct DeadlineSnapshot<'a> {
    language: &'a str,
    has_selections: bool,
    items: Vec<DeadlineSnapshotItem<'a>>,
}

#[derive(Serialize)]
struct DeadlineSnapshotItem<'a> {
    title: &'a str,
    year: &'a str,
    deadline_utc: &'a str,
}

fn language(app: &AppHandle) -> String {
    let config = crate::config_store::read_config::<AppConfig>(app, "app_config.json");
    config.language.unwrap_or_else(|| "zh-CN".to_string())
}

pub fn publish_quota_snapshot(app: &AppHandle, config: &QuotaConfig) -> Result<(), String> {
    let language = language(app);
    let snapshot = QuotaSnapshot {
        language: &language,
        show_plan_type: config.show_plan_type.unwrap_or(true),
        items: config.items.iter().map(display_item).collect(),
    };

    write_snapshot(app, "quota-snapshot.json", &snapshot)
}

pub fn publish_gpu_snapshot(
    app: &AppHandle,
    config: &GpuConfig,
    data: &HashMap<String, ServerGpuData>,
) -> Result<(), String> {
    let language = language(app);
    let servers = config.servers.iter().filter_map(|server| {
        let host = server.host.trim();
        if host.is_empty() { return None; }
        let current = data.get(host);
        let is_online = current.is_some_and(|item| item.is_online);
        let gpu_list = current.filter(|_| is_online).map(|item| item.gpu_list.as_slice()).unwrap_or(&[]);
        let valid_util: Vec<f32> = gpu_list.iter().map(|gpu| gpu.util).filter(|util| util.is_finite()).collect();
        let average_util = if valid_util.is_empty() {
            None
        } else {
            Some((valid_util.iter().sum::<f32>() / valid_util.len() as f32).clamp(0.0, 100.0))
        };
        let system = current.filter(|_| is_online).and_then(|item| item.system.as_ref());
        Some(GpuSnapshotServer {
            host,
            is_online,
            gpu_count: gpu_list.len(),
            average_util,
            cpu_percent: system.and_then(|metrics| metrics.cpu_percent),
            memory_used_bytes: system.map(|metrics| metrics.memory_used_bytes),
            memory_total_bytes: system.map(|metrics| metrics.memory_total_bytes),
        })
    }).collect();
    write_snapshot(app, "gpu-snapshot.json", &GpuSnapshot { language: &language, servers })
}

pub fn publish_gpu_snapshot_from_state(app: &AppHandle, state: &GlobalState) -> Result<(), String> {
    let config = crate::gpu::read_gpu_config(app);
    let data = state.gpu_data.lock().map_err(|error| error.to_string())?;
    publish_gpu_snapshot(app, &config, &data)
}

pub fn publish_deadline_snapshot(
    app: &AppHandle,
    config: &PaperConfig,
    deadlines: &[PaperDeadlineInfo],
) -> Result<(), String> {
    let language = language(app);
    let has_selections = config.subscribed_titles.as_ref().is_some_and(|items| !items.is_empty())
        || config.pinned_deadline_ids.as_ref().is_some_and(|items| !items.is_empty());
    let items = selected_deadlines(config, deadlines).into_iter().map(|deadline| DeadlineSnapshotItem {
        title: &deadline.title,
        year: &deadline.year,
        deadline_utc: &deadline.deadline_utc,
    }).collect();
    write_snapshot(app, "deadline-snapshot.json", &DeadlineSnapshot { language: &language, has_selections, items })
}

fn selected_deadlines<'a>(config: &PaperConfig, deadlines: &'a [PaperDeadlineInfo]) -> Vec<&'a PaperDeadlineInfo> {
    let subscribed: HashSet<String> = config.subscribed_titles.as_ref().into_iter().flatten()
        .map(|title| title.trim().to_lowercase()).collect();
    let pinned: HashSet<&str> = config.pinned_deadline_ids.as_ref().into_iter().flatten()
        .map(String::as_str).collect();
    let now = chrono::Utc::now();
    let mut by_conference: HashMap<_, (&PaperDeadlineInfo, bool, chrono::DateTime<chrono::Utc>)> = HashMap::new();
    for deadline in deadlines {
        let key = format!("{}|{}|{}", deadline.title.trim().to_lowercase(), deadline.year.trim().to_lowercase(), deadline.deadline_utc.trim());
        let is_pinned = pinned.contains(key.as_str());
        if !is_pinned && !subscribed.contains(&deadline.title.trim().to_lowercase()) {
            continue;
        }
        let Ok(date) = chrono::DateTime::parse_from_rfc3339(&deadline.deadline_utc) else {
            continue;
        };
        let date = date.with_timezone(&chrono::Utc);
        if date <= now {
            continue;
        }

        let conference = (deadline.title.trim().to_lowercase(), deadline.year.trim().to_lowercase());
        let replace = match by_conference.get(&conference) {
            None => true,
            Some((_, current_pinned, current_date)) => {
                (is_pinned && !*current_pinned)
                    || (is_pinned == *current_pinned && date < *current_date)
            }
        };
        if replace {
            by_conference.insert(conference, (deadline, is_pinned, date));
        }
    }
    let mut selected: Vec<_> = by_conference.into_values().collect();
    selected.sort_by(|a, b| a.2.cmp(&b.2));
    selected.into_iter().map(|(deadline, _, _)| deadline).collect()
}

fn write_snapshot<T: Serialize>(app: &AppHandle, file: &str, snapshot: &T) -> Result<(), String> {
    let bytes = serde_json::to_vec(snapshot).map_err(|error| error.to_string())?;
    let local = crate::utils::get_config_dir(app).join("widget-snapshots");
    write_snapshot_file(&local, file, &bytes)?;
    match shared_container().and_then(|dir| write_snapshot_file(&dir, file, &bytes)) {
        Ok(()) => {},
        Err(error) => log::debug!("App Group widget snapshot unavailable; local widget feed will be used: {error}"),
    }
    let kind = match file {
        "quota-snapshot.json" => "com.evan.widgitron.quota",
        "gpu-snapshot.json" => "com.evan.widgitron.gpu",
        "deadline-snapshot.json" => "com.evan.widgitron.deadlines",
        _ => return Ok(()),
    };
    if let Err(error) = reload_widget(kind) {
        log::warn!("Failed to reload macOS widget {kind}: {error}");
    }
    Ok(())
}

fn write_snapshot_file(dir: &std::path::Path, file: &str, bytes: &[u8]) -> Result<(), String> {
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let destination = dir.join(file);
    let sequence = SNAPSHOT_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let temporary = dir.join(format!("{file}.{}.{}.tmp", std::process::id(), sequence));
    fs::write(&temporary, bytes).map_err(|error| error.to_string())?;
    fs::rename(&temporary, destination).map_err(|error| error.to_string())
}

fn reload_widget(kind: &str) -> Result<(), String> {
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    let contents = executable.parent().and_then(|macos| macos.parent())
        .ok_or_else(|| "Cannot locate Widgitron app Contents directory".to_string())?;
    let bridge = contents.join("Frameworks/libWidgitronWidgetBridge.dylib");
    if !bridge.is_file() { return Ok(()); }
    let kind = CString::new(kind).map_err(|error| error.to_string())?;
    unsafe {
        let library = Library::new(bridge).map_err(|error| error.to_string())?;
        let reload: Symbol<unsafe extern "C" fn(*const c_char)> = library
            .get(b"widgitron_reload_widget")
            .map_err(|error| error.to_string())?;
        reload(kind.as_ptr());
    }
    Ok(())
}

pub fn native_quota_widget_available() -> bool {
    let extension_exists = std::env::current_exe()
        .ok()
        .and_then(|executable| executable.parent()?.parent().map(PathBuf::from))
        .map(|contents| contents.join("PlugIns/WidgitronWidgets.appex/Contents/MacOS/WidgitronWidgets").is_file())
        .unwrap_or(false);
    extension_exists && shared_container().is_ok()
}

fn shared_container() -> Result<PathBuf, String> {
    let group = NSFileManager::defaultManager()
        .containerURLForSecurityApplicationGroupIdentifier(&NSString::from_str(GROUP_ID))
        .ok_or_else(|| format!("App Group {GROUP_ID} is unavailable; sign the app with its App Group capability"))?;
    group.path()
        .map(|path| PathBuf::from(path.to_string()))
        .ok_or_else(|| format!("App Group {GROUP_ID} has no filesystem path"))
}

fn display_item(item: &QuotaItem) -> QuotaSnapshotItem<'_> {
    QuotaSnapshotItem {
        name: &item.name,
        provider: &item.provider,
        current_value: item.current_value,
        max_quota: item.max_quota,
        unit: item.unit.as_deref(),
        primary_name: item.primary_name.as_deref(),
        primary_reset: item.primary_reset.as_deref(),
        last_update: item.last_update.as_deref(),
        plan_type: item.plan_type.as_deref(),
        error_msg: item.error_msg.as_deref(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn deadline(title: &str, days_from_now: i64) -> PaperDeadlineInfo {
        PaperDeadlineInfo {
            title: title.to_string(),
            year: "2026".to_string(),
            deadline_utc: (chrono::Utc::now() + chrono::Duration::days(days_from_now)).to_rfc3339(),
            timezone: "UTC".to_string(),
            rank: "A".to_string(),
            sub: "AI".to_string(),
            place: String::new(),
            link: String::new(),
            ccf: None,
            core: None,
        }
    }

    #[test]
    fn deadline_widget_only_shows_selected_future_conferences() {
        let upcoming = deadline("NeurIPS", 4);
        let later = deadline("ICML", 8);
        let unrelated = deadline("KDD", 1);
        let past = deadline("NeurIPS", -1);
        let config = PaperConfig {
            subscribed_titles: Some(vec![" neurips ".to_string()]),
            pinned_deadline_ids: Some(vec![format!("{}|{}|{}", later.title.to_lowercase(), later.year, later.deadline_utc)]),
            ..PaperConfig::default()
        };
        let deadlines = vec![later, unrelated, past, upcoming];
        let selected = selected_deadlines(&config, &deadlines);
        assert_eq!(selected.iter().map(|item| item.title.as_str()).collect::<Vec<_>>(), vec!["NeurIPS", "ICML"]);
        assert!(selected_deadlines(&PaperConfig::default(), &deadlines).is_empty());
    }

    #[test]
    fn subscribed_conference_shows_only_its_nearest_round() {
        let mut first = deadline("VLDB", 3);
        first.year = "2027".into();
        let mut second = deadline("VLDB", 33);
        second.year = "2027".into();
        let config = PaperConfig {
            subscribed_titles: Some(vec!["VLDB".into()]),
            ..PaperConfig::default()
        };
        let deadlines = vec![second.clone(), first.clone()];
        let selected = selected_deadlines(&config, &deadlines);
        assert_eq!(selected.len(), 1);
        assert_eq!(selected[0].deadline_utc, first.deadline_utc);

        let pinned_config = PaperConfig {
            pinned_deadline_ids: Some(vec![format!("vldb|2027|{}", second.deadline_utc)]),
            ..config
        };
        let selected = selected_deadlines(&pinned_config, &deadlines);
        assert_eq!(selected.len(), 1);
        assert_eq!(selected[0].deadline_utc, second.deadline_utc);
    }
}
