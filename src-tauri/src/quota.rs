use std::time::Duration;
use tauri::{AppHandle, Emitter};
use serde::Deserialize;
use serde_json::Value;
use std::path::{Path, PathBuf};

use crate::models::{AppConfig, QuotaBar, QuotaConfig, QuotaItem, GlobalState};
use crate::{config_store, secrets};
use crate::vscode_secrets;

const REMOVED_QUOTA_PROVIDERS: &[&str] = &["minimax-cn", "openai-compatible"];

#[derive(serde::Serialize, Clone)]
pub struct QuotaMonitorStatus {
    pub consecutive_failures: u32,
    pub backoff_secs: u64,
    pub all_hard_failed: bool,
    pub last_error: Option<String>,
}

fn emit_quota_monitor_status(app: &AppHandle, status: QuotaMonitorStatus) {
    let _ = app.emit("quota_monitor_status", status);
}

fn is_removed_quota_provider(provider: &str) -> bool {
    REMOVED_QUOTA_PROVIDERS.contains(&provider)
}

fn strip_removed_quota_providers(config: &mut QuotaConfig) -> usize {
    let before = config.items.len();
    config
        .items
        .retain(|item| !is_removed_quota_provider(item.provider.as_str()));
    before.saturating_sub(config.items.len())
}

pub fn sanitize_quota_config(mut config: QuotaConfig) -> QuotaConfig {
    let _ = strip_removed_quota_providers(&mut config);
    config
}

pub fn read_quota_config(app: &AppHandle) -> QuotaConfig {
    let mut config = config_store::read_config::<QuotaConfig>(app, "quota_config.json");
    decrypt_quota_config_secrets(&mut config);
    let removed = strip_removed_quota_providers(&mut config);
    if removed > 0 {
        log::info!(
            "Removed {} deprecated quota provider entr{} from quota_config.json",
            removed,
            if removed == 1 { "y" } else { "ies" }
        );
        if let Err(err) = write_quota_config(app, &config) {
            log::warn!("Failed to persist sanitized quota_config.json: {}", err);
        }
    }
    config
}

pub fn write_quota_config(app: &AppHandle, config: &QuotaConfig) -> Result<(), String> {
    let mut disk_config = config.clone();
    encrypt_quota_config_secrets(&mut disk_config)?;
    config_store::write_config(app, "quota_config.json", &disk_config)
}

fn encrypt_quota_config_secrets(config: &mut QuotaConfig) -> Result<(), String> {
    for item in &mut config.items {
        let key = item.api_key.trim();
        if key.is_empty() {
            item.encrypted_api_key = None;
            continue;
        }
        item.encrypted_api_key = Some(secrets::encrypt_secret(key)?);
        item.api_key.clear();
    }
    Ok(())
}

fn decrypt_quota_config_secrets(config: &mut QuotaConfig) {
    for item in &mut config.items {
        if let Some(encrypted) = item.encrypted_api_key.as_deref() {
            match secrets::decrypt_secret(encrypted) {
                Ok(decrypted) => item.api_key = decrypted,
                Err(err) => {
                    log::warn!("Failed to decrypt API key for quota item '{}': {}", item.id, err);
                    item.api_key.clear();
                }
            }
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum QuotaAuthMode {
    Local,
    ApiKey,
}

fn quota_auth_mode(item: &QuotaItem) -> QuotaAuthMode {
    match item.auth_mode.as_deref() {
        Some("api_key") => QuotaAuthMode::ApiKey,
        Some("local") => QuotaAuthMode::Local,
        Some(_) | None => match item.provider.as_str() {
            "pioneer" => QuotaAuthMode::ApiKey,
            _ => QuotaAuthMode::Local,
        },
    }
}

/// Helper to resolve the state.vscdb path depending on the application name and OS
fn get_db_path(app_name: &str) -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let appdata = std::env::var("APPDATA").ok()?;
        Some(PathBuf::from(appdata).join(app_name).join("User").join("globalStorage").join("state.vscdb"))
    }
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME").ok()?;
        Some(PathBuf::from(home)
            .join("Library")
            .join("Application Support")
            .join(app_name)
            .join("User")
            .join("globalStorage")
            .join("state.vscdb"))
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let home = std::env::var("HOME").ok()?;
        Some(PathBuf::from(home)
            .join(".config")
            .join(app_name)
            .join("User")
            .join("globalStorage")
            .join("state.vscdb"))
    }
}

/// Helper to read a key's value from state.vscdb
/// Copies the database to a temporary file first to avoid locking issues while the IDE is running.
fn read_vscdb_key(db_path: &Path, target_key: &str) -> Result<Option<String>, String> {
    if !db_path.exists() {
        return Ok(None);
    }
    
    let temp_path = {
        let temp_dir = std::env::temp_dir();
        temp_dir.join(format!(
            "vscdb_temp_{}_{}.db",
            chrono::Utc::now().timestamp_millis(),
            std::process::id()
        ))
    };
    
    std::fs::copy(db_path, &temp_path)
        .map_err(|e| format!("Failed to copy state database: {}", e))?;
        
    let res = (|| {
        let conn = rusqlite::Connection::open(&temp_path)
            .map_err(|e| format!("Failed to open database: {}", e))?;
            
        let mut stmt = conn.prepare("SELECT value FROM ItemTable WHERE key = ?")
            .map_err(|e| format!("Failed to prepare query: {}", e))?;
            
        let mut rows = stmt.query([target_key])
            .map_err(|e| format!("Query failed: {}", e))?;
            
        if let Some(row) = rows.next().map_err(|e| format!("Error reading row: {}", e))? {
            let val: String = row.get(0).map_err(|e| format!("Failed to get column value: {}", e))?;
            Ok(Some(val))
        } else {
            Ok(None)
        }
    })();
    
    let _ = std::fs::remove_file(&temp_path);
    
    res
}

#[derive(serde::Deserialize, Debug)]
struct AgQuotaInfo {
    #[serde(rename = "remainingFraction")]
    remaining_fraction: Option<f64>,
    #[serde(rename = "resetTime")]
    reset_time: Option<String>,
}

#[derive(serde::Deserialize, Debug)]
struct AgClientModelConfig {
    label: Option<String>,
    #[serde(rename = "quotaInfo")]
    quota_info: Option<AgQuotaInfo>,
}

#[derive(serde::Deserialize, Debug)]
struct AgCascadeModelConfigData {
    #[serde(rename = "clientModelConfigs")]
    client_model_configs: Option<Vec<AgClientModelConfig>>,
}

#[derive(serde::Deserialize, Debug)]
struct AgUserTier {
    name: Option<String>,
}

#[derive(serde::Deserialize, Debug)]
struct AgUserStatus {
    #[serde(rename = "cascadeModelConfigData")]
    cascade_model_config_data: Option<AgCascadeModelConfigData>,
    email: Option<String>,
    #[serde(rename = "userTier")]
    user_tier: Option<AgUserTier>,
}

#[derive(serde::Deserialize, Debug)]
struct AgGetUserStatusResponse {
    #[serde(rename = "userStatus")]
    user_status: Option<AgUserStatus>,
}

fn build_quota_fetch_error_item(item: &QuotaItem, error: &str) -> QuotaItem {
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    QuotaItem {
        id: item.id.clone(),
        name: item.name.clone(),
        provider: item.provider.clone(),
        api_key: String::new(),
        encrypted_api_key: None,
        api_url: item.api_url.clone(),
        json_path: item.json_path.clone(),
        max_quota: item.max_quota,
        current_value: item.current_value,
        error_msg: Some(error.to_string()),
        last_update: Some(now),
        unit: item.unit.clone(),
        account_label: item.account_label.clone(),
        primary_name: item.primary_name.clone(),
        primary_reset: item.primary_reset.clone(),
        secondary_value: item.secondary_value,
        secondary_name: item.secondary_name.clone(),
        secondary_reset: item.secondary_reset.clone(),
        tertiary_value: item.tertiary_value,
        tertiary_name: item.tertiary_name.clone(),
        tertiary_reset: item.tertiary_reset.clone(),
        bars: item.bars.clone(),
        plan_type: item.plan_type.clone(),
        auth_mode: item.auth_mode.clone(),
        ..Default::default()
    }
}

fn quota_item_has_display_data(item: &QuotaItem) -> bool {
    item.current_value.is_some()
        || item.bars.as_ref().is_some_and(|bars| !bars.is_empty())
        || item.secondary_value.is_some()
        || item.tertiary_value.is_some()
}

fn is_quota_network_error(error: &str) -> bool {
    let lower = error.to_lowercase();
    lower.contains("network error")
        || lower.contains("error sending request")
        || lower.contains("timed out")
        || lower.contains("timeout")
        || lower.contains("connection refused")
        || lower.contains("connection reset")
}

fn is_http_status_retriable(status: reqwest::StatusCode) -> bool {
    status.is_server_error() || status.as_u16() == 429
}

fn is_quota_retriable_failure(error: &str) -> bool {
    if is_quota_network_error(error) {
        return true;
    }
    let lower = error.to_lowercase();
    lower.contains("http 5")
        || lower.contains("http 429")
        || lower.contains("http error status: 5")
        || lower.contains("http error status: 429")
        || lower.contains("rate limited")
        || lower.contains("server error")
}

fn format_retained_quota_error(error: &str) -> String {
    if is_quota_network_error(error) {
        "Offline — showing cached data (check network, VPN, or proxy)".to_string()
    } else {
        format!("Update failed (showing cached data): {}", error)
    }
}

fn push_quota_provider_fetch_error(
    fetched_items: &mut Vec<QuotaItem>,
    item: &QuotaItem,
    provider_label: &str,
    error: &str,
) {
    if is_quota_retriable_failure(error) && quota_item_has_display_data(item) {
        log::warn!("{} retriable error (retained stale data): {}", provider_label, error);
        let mut retained = item.clone();
        retained.error_msg = Some(format_retained_quota_error(error));
        fetched_items.push(retained);
    } else {
        log::error!("Failed to fetch {} quota: {}", provider_label, error);
        fetched_items.push(build_quota_fetch_error_item(item, error));
    }
}

fn apply_custom_quota_fetch_error(
    resolved_item: &mut QuotaItem,
    source_item: &QuotaItem,
    provider_name: &str,
    error: &str,
) {
    resolved_item.last_update = Some(chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string());
    if is_quota_retriable_failure(error) && quota_item_has_display_data(source_item) {
        log::warn!(
            "Retriable error for custom quota provider '{}' (retained stale data): {}",
            provider_name,
            error
        );
        resolved_item.error_msg = Some(format_retained_quota_error(error));
    } else {
        log::error!("Failed to fetch custom quota provider '{}': {}", provider_name, error);
        resolved_item.error_msg = Some(error.to_string());
    }
}

fn config_items_for_provider<'a>(config_items: &'a [QuotaItem], provider: &str) -> Vec<&'a QuotaItem> {
    config_items
        .iter()
        .filter(|item| resolve_quota_provider(item) == provider)
        .collect()
}

fn remap_fetched_to_config_item(fetched: &QuotaItem, config_item: &QuotaItem) -> QuotaItem {
    let mut item = fetched.clone();
    item.id = config_item.id.clone();
    if !config_item.name.is_empty() {
        item.name = config_item.name.clone();
    }
    item.auth_mode = config_item.auth_mode.clone();
    item
}

fn push_singleton_provider_fetch_results(
    fetched_items: &mut Vec<QuotaItem>,
    config_items: &[QuotaItem],
    provider: &str,
    provider_label: &str,
    result: &Option<Result<QuotaItem, String>>,
) {
    let targets = config_items_for_provider(config_items, provider);
    if targets.is_empty() {
        return;
    }
    match result {
        Some(Ok(fetched)) => {
            for cfg in targets {
                fetched_items.push(remap_fetched_to_config_item(fetched, cfg));
            }
        }
        Some(Err(e)) => {
            for cfg in targets {
                push_quota_provider_fetch_error(fetched_items, cfg, provider_label, e);
            }
        }
        None => {}
    }
}

fn push_antigravity_fetch_results(
    fetched_items: &mut Vec<QuotaItem>,
    config_items: &[QuotaItem],
    result: &Option<Result<Vec<QuotaItem>, String>>,
) {
    let targets = config_items_for_provider(config_items, "antigravity");
    if targets.is_empty() {
        return;
    }
    match result {
        Some(Ok(items)) => {
            let template = items.first();
            if let Some(fetched) = template {
                for cfg in targets {
                    fetched_items.push(remap_fetched_to_config_item(fetched, cfg));
                }
            } else {
                for cfg in targets {
                    push_quota_provider_fetch_error(
                        fetched_items,
                        cfg,
                        "Antigravity",
                        "No quota data returned from Antigravity",
                    );
                }
            }
        }
        Some(Err(e)) => {
            for cfg in targets {
                push_quota_provider_fetch_error(fetched_items, cfg, "Antigravity", e);
            }
        }
        None => {}
    }
}

fn is_quota_hard_error(msg: &str) -> bool {
    if is_quota_retriable_failure(msg) {
        return false;
    }
    let lower = msg.to_lowercase();
    !(lower.contains("cached") || lower.contains("retaining last"))
}

fn quota_cycle_all_hard_failed(config: &QuotaConfig, fetched: &[QuotaItem]) -> bool {
    let auto_items: Vec<&QuotaItem> = config
        .items
        .iter()
        .filter(|item| item.provider != "manual")
        .collect();
    if auto_items.is_empty() {
        return false;
    }
    auto_items.iter().all(|cfg| {
        match fetched.iter().find(|item| item.id == cfg.id) {
            Some(item) => item
                .error_msg
                .as_ref()
                .map(|msg| is_quota_hard_error(msg))
                .unwrap_or(false),
            None => true,
        }
    })
}

#[cfg(target_os = "windows")]
fn extract_csrf_token_from_cmdline(cmdline: &str) -> Option<String> {
    let pos = cmdline.find("--csrf_token")?;
    let rest = cmdline[pos + "--csrf_token".len()..].trim_start_matches([' ', '=']);
    rest.split_whitespace()
        .next()
        .map(|s| s.trim_matches('"').to_string())
        .filter(|s| !s.is_empty())
}

#[cfg(target_os = "windows")]
fn query_listening_ports_for_pid(pid: u64) -> Result<Vec<u16>, String> {
    use std::os::windows::process::CommandExt;

    let ps_ports = || -> Result<Vec<u16>, String> {
        let ports_output = std::process::Command::new("powershell")
            .args(["-Command", &format!(
                "Get-NetTCPConnection -State Listen -OwningProcess {} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty LocalPort",
                pid
            )])
            .creation_flags(0x08000000)
            .output()
            .map_err(|e| format!("Failed to query ports: {}", e))?;

        Ok(String::from_utf8_lossy(&ports_output.stdout)
            .lines()
            .filter_map(|line| line.trim().parse::<u16>().ok())
            .collect())
    };

    let ports = ps_ports().unwrap_or_default();
    if !ports.is_empty() {
        return Ok(ports);
    }

    let netstat_output = std::process::Command::new("cmd")
        .args(["/C", &format!("netstat -ano | findstr LISTENING | findstr {}", pid)])
        .creation_flags(0x08000000)
        .output()
        .map_err(|e| format!("Failed to run netstat fallback: {}", e))?;

    let mut fallback_ports = Vec::new();
    for line in String::from_utf8_lossy(&netstat_output.stdout).lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 5 && parts[4] == pid.to_string() {
            if let Some(host_port) = parts.get(1) {
                if let Some(port) = host_port.rsplit(':').next().and_then(|p| p.parse().ok()) {
                    fallback_ports.push(port);
                }
            }
        }
    }

    if fallback_ports.is_empty() {
        Ok(ports)
    } else {
        Ok(fallback_ports)
    }
}

#[cfg(target_os = "windows")]
fn parse_ag_windows_processes(stdout: &str) -> Vec<(u64, String)> {
    let json: serde_json::Value = serde_json::from_str(stdout).unwrap_or(serde_json::Value::Null);
    let mut out = Vec::new();

    let push = |item: &serde_json::Value| {
        let pid = item.get("ProcessId").and_then(|v| v.as_u64())?;
        let cmdline = item.get("CommandLine").and_then(|v| v.as_str())?;
        Some((pid, cmdline.to_string()))
    };

    if let Some(arr) = json.as_array() {
        for item in arr {
            if let Some(entry) = push(item) {
                out.push(entry);
            }
        }
    } else if let Some(entry) = push(&json) {
        out.push(entry);
    }

    out
}

#[cfg(target_os = "windows")]
fn discover_ag_language_server_windows() -> Result<(String, Vec<u16>), String> {
    use std::os::windows::process::CommandExt;

    let output = std::process::Command::new("powershell")
        .args(["-Command",
            "Get-CimInstance Win32_Process | Where-Object { $_.Name -like '*language_server_windows*' } | Select-Object ProcessId, CommandLine | ConvertTo-Json"
        ])
        .creation_flags(0x08000000)
        .output()
        .map_err(|e| format!("Failed to query processes: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    if stdout.trim().is_empty() {
        return Err("Antigravity language server not running. Please open Antigravity IDE.".to_string());
    }

    let processes = parse_ag_windows_processes(&stdout);
    if processes.is_empty() {
        return Err("Antigravity language server process list could not be parsed.".to_string());
    }

    let mut last_err = String::from("No usable language server process found");
    for (pid, cmdline) in processes {
        let Some(csrf_token) = extract_csrf_token_from_cmdline(&cmdline) else {
            continue;
        };
        match query_listening_ports_for_pid(pid) {
            Ok(ports) if !ports.is_empty() => return Ok((csrf_token, ports)),
            Ok(_) => last_err = format!("PID {} has no listening ports", pid),
            Err(e) => last_err = e,
        }
    }

    Err(format!("Language server found but unreachable: {}", last_err))
}

/// Returns true when the Antigravity IDE language server process is reachable locally.
pub fn is_antigravity_language_server_running() -> bool {
    discover_ag_language_server().is_ok()
}

/// Discover the Antigravity language server process, extract CSRF token and listening ports.
/// Returns (csrf_token, Vec<port>) or an error.
fn discover_ag_language_server() -> Result<(String, Vec<u16>), String> {
    #[cfg(target_os = "windows")]
    {
        return discover_ag_language_server_windows();
    }

    #[cfg(not(target_os = "windows"))]
    {
    // Platform-specific process name
    #[cfg(target_os = "macos")]
    let proc_name_pattern = "language_server_macos";
    #[cfg(not(target_os = "macos"))]
    let proc_name_pattern = "language_server_linux";

    let output = std::process::Command::new("sh")
        .args(["-c", &format!("ps aux | grep '{}' | grep -v grep", proc_name_pattern)])
        .output()
        .map_err(|e| format!("Failed to query processes: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    if stdout.trim().is_empty() {
        return Err("Antigravity language server not running. Please open Antigravity IDE.".to_string());
    }

    let csrf_token = if let Some(pos) = stdout.find("--csrf_token") {
        let rest = &stdout[pos + "--csrf_token".len()..].trim_start_matches([' ', '=']);
        rest.split_whitespace().next()
            .map(|s| s.trim_matches('"').to_string())
            .ok_or_else(|| "Could not parse CSRF token".to_string())?
    } else {
        return Err("No CSRF token found in language server process args. Is Antigravity IDE running?".to_string());
    };

    let pid: u64 = stdout
        .split_whitespace()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .ok_or_else(|| "Could not extract PID from process list".to_string())?;

    let ports_output = std::process::Command::new("sh")
        .args(["-c", &format!("lsof -iTCP -sTCP:LISTEN -p {} | awk '{{print $9}}' | grep -oE '[0-9]+$'", pid)])
        .output()
        .map_err(|e| format!("Failed to query ports: {}", e))?;

    let ports: Vec<u16> = String::from_utf8_lossy(&ports_output.stdout)
        .lines()
        .filter_map(|l| l.trim().parse::<u16>().ok())
        .collect();

    if ports.is_empty() {
        return Err("Language server found but no listening ports detected.".to_string());
    }

    Ok((csrf_token, ports))
    }
}

/// Format an ISO 8601 timestamp (UTC) to local time string
fn format_iso_to_local(iso: &str) -> Option<String> {
    use chrono::{DateTime, Utc};
    let trimmed = iso.trim();
    if trimmed.is_empty() {
        return None;
    }
    // 1. Try standard ISO 8601 parsing
    if let Ok(dt) = trimmed.parse::<DateTime<Utc>>() {
        let local = dt.with_timezone(&chrono::Local);
        return Some(local.format("%Y-%m-%d %H:%M").to_string());
    }
    
    // 2. Try appending 'Z' if it's missing (e.g. "2026-06-30T17:34:56")
    if !trimmed.ends_with('Z') && !trimmed.contains('+') {
        let with_z = format!("{}Z", trimmed);
        if let Ok(dt) = with_z.parse::<DateTime<Utc>>() {
            let local = dt.with_timezone(&chrono::Local);
            return Some(local.format("%Y-%m-%d %H:%M").to_string());
        }
        
        // Try replacing space with 'T' (e.g. "2026-06-30 17:34:56" -> "2026-06-30T17:34:56Z")
        let with_t_z = format!("{}Z", trimmed.replace(' ', "T"));
        if let Ok(dt) = with_t_z.parse::<DateTime<Utc>>() {
            let local = dt.with_timezone(&chrono::Local);
            return Some(local.format("%Y-%m-%d %H:%M").to_string());
        }
    }
    
    // 3. Fallback: If it's a non-empty string, just return it as-is (e.g. pre-formatted dates)
    Some(trimmed.to_string())
}

/// Fetch Antigravity quotas via local language server, falling back to Cloud Code API.
async fn fetch_antigravity_quota(
    app: &AppHandle,
    show_account_name: bool,
) -> Result<Vec<QuotaItem>, String> {
    match fetch_antigravity_via_language_server(show_account_name).await {
        Ok(items) => Ok(items),
        Err(ls_err) => match crate::antigravity::fetch_antigravity_via_cloud(app).await {
            Ok(snapshot) => build_antigravity_quota_items(snapshot, show_account_name),
            Err(cloud_err) => {
                let status = crate::antigravity::get_setup_status(app);
                if status.has_oauth_tokens
                    && !status.cloud_auth_ready
                    && !status.language_server_running
                {
                    return Err(format!(
                        "Open Antigravity IDE to fetch quota locally (OAuth tokens found). \
                         For cloud fallback without the IDE, add client_secret to {} or set ANTIGRAVITY_GOOGLE_CLIENT_SECRET.",
                        status.oauth_config_path
                    ));
                }
                let ls_hint = classify_antigravity_ls_error(&ls_err);
                let cloud_hint = classify_antigravity_cloud_error(&cloud_err);
                Err(format!(
                    "Antigravity local: {}. Cloud fallback: {}.",
                    ls_hint, cloud_hint
                ))
            }
        },
    }
}

fn classify_antigravity_ls_error(err: &str) -> String {
    let lower = err.to_lowercase();
    if lower.contains("not running") || lower.contains("please open antigravity") {
        "IDE not running — open Antigravity".to_string()
    } else if lower.contains("listening ports") || lower.contains("unreachable") {
        "Language server ports unavailable".to_string()
    } else if lower.contains("csrf") {
        "Could not read language server token".to_string()
    } else {
        err.to_string()
    }
}

fn classify_antigravity_cloud_error(err: &str) -> String {
    let lower = err.to_lowercase();
    if lower.contains("client_secret") || lower.contains("oauth credentials not configured") {
        "OAuth secret not configured — install Antigravity IDE or set antigravity_oauth.json".to_string()
    } else if lower.contains("oauth") || lower.contains("sign in") {
        "Sign in to Antigravity IDE once".to_string()
    } else if lower.contains("network") || lower.contains("timeout") {
        "Network error reaching Google Cloud API".to_string()
    } else {
        err.to_string()
    }
}

/// Resolve the first existing IDE state.vscdb for known app directory names.
fn resolve_ide_db_path(app_names: &[&str]) -> Option<PathBuf> {
    app_names
        .iter()
        .filter_map(|name| get_db_path(name))
        .find(|path| path.exists())
}

fn ide_db_not_found_message(app_label: &str, app_names: &[&str]) -> String {
    let candidates: Vec<String> = app_names
        .iter()
        .filter_map(|name| get_db_path(name).map(|path| path.display().to_string()))
        .collect();
    if candidates.is_empty() {
        return format!("{} local data not found on this system", app_label);
    }
    format!(
        "{} local data not found. Checked: {}. Please sign in via {}.",
        app_label,
        candidates.join("; "),
        app_names.first().copied().unwrap_or("IDE")
    )
}

async fn fetch_antigravity_via_language_server(
    show_account_name: bool,
) -> Result<Vec<QuotaItem>, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .unwrap_or_default();

    let mut last_err = String::from("language server not running");

    for attempt in 0..2 {
        let (csrf_token, ports) = discover_ag_language_server()?;
        let mut response_text: Option<String> = None;

        for port in &ports {
            let url = format!(
                "http://127.0.0.1:{}/exa.language_server_pb.LanguageServerService/GetUserStatus",
                port
            );
            match client
                .post(&url)
                .header("Content-Type", "application/json")
                .header("Connect-Protocol-Version", "1")
                .header("X-Codeium-Csrf-Token", &csrf_token)
                .body("{}")
                .send()
                .await
            {
                Ok(res) if res.status().is_success() => {
                    match res.text().await {
                        Ok(text) if !text.is_empty() => {
                            response_text = Some(text);
                            break;
                        }
                        Ok(_) => last_err = format!("Empty response from language server on port {}", port),
                        Err(e) => last_err = format!("Failed to read language server response: {}", e),
                    }
                }
                Ok(res) => {
                    last_err = format!("Language server HTTP {} on port {}", res.status(), port);
                }
                Err(e) => {
                    last_err = format!("Language server request failed on port {}: {}", port, e);
                }
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }

        if let Some(text) = response_text {
            let status_resp: AgGetUserStatusResponse = serde_json::from_str(&text)
                .map_err(|e| format!("Failed to parse GetUserStatus response: {}", e))?;

            let user_status = status_resp
                .user_status
                .ok_or_else(|| "No userStatus in GetUserStatus response".to_string())?;

            let model_configs = user_status
                .cascade_model_config_data
                .and_then(|d| d.client_model_configs)
                .ok_or_else(|| "No model configuration data in GetUserStatus response".to_string())?;

            let tier_name = user_status.user_tier.as_ref().and_then(|ut| ut.name.clone());

            return build_antigravity_quota_items_from_configs(
                model_configs,
                user_status.email,
                show_account_name,
                tier_name,
            );
        }

        if attempt == 0 {
            tokio::time::sleep(Duration::from_millis(400)).await;
        }
    }

    Err(last_err)
}

fn build_antigravity_quota_items_from_configs(
    model_configs: Vec<AgClientModelConfig>,
    email: Option<String>,
    _show_account_name: bool,
    tier_name: Option<String>,
) -> Result<Vec<QuotaItem>, String> {
    let limited_models: Vec<&AgClientModelConfig> = model_configs
        .iter()
        .filter(|m| m.quota_info.is_some())
        .collect();

    if limited_models.is_empty() {
        return Err("No quota-tracked models found in GetUserStatus response.".to_string());
    }

    Ok(vec![build_antigravity_quota_item(
        &limited_models,
        email,
        tier_name,
    )])
}

fn build_antigravity_quota_items(
    snapshot: crate::antigravity::QuotaSnapshot,
    _show_account_name: bool,
) -> Result<Vec<QuotaItem>, String> {
    if snapshot.models.is_empty() {
        return Err("No quota-tracked models returned from Antigravity Cloud API.".to_string());
    }

    let limited_models: Vec<AgClientModelConfig> = snapshot
        .models
        .into_iter()
        .map(|m| AgClientModelConfig {
            label: Some(m.label),
            quota_info: Some(AgQuotaInfo {
                remaining_fraction: m.remaining_fraction,
                reset_time: m.reset_time,
            }),
        })
        .collect();

    let refs: Vec<&AgClientModelConfig> = limited_models.iter().collect();
    Ok(vec![build_antigravity_quota_item(&refs, snapshot.email, snapshot.tier_name)])
}

fn build_antigravity_quota_item(
    limited_models: &[&AgClientModelConfig],
    account_label: Option<String>,
    plan_type: Option<String>,
) -> QuotaItem {
    let get_pct = |m: &AgClientModelConfig| -> f64 {
        let frac = m
            .quota_info
            .as_ref()
            .and_then(|qi| qi.remaining_fraction)
            .unwrap_or(0.0);
        (frac * 100.0).round().min(100.0).max(0.0)
    };
    let get_reset = |m: &AgClientModelConfig| -> Option<String> {
        m.quota_info
            .as_ref()
            .and_then(|qi| qi.reset_time.as_deref().and_then(format_iso_to_local))
    };
    let get_label = |m: &AgClientModelConfig| -> String {
        m.label.as_deref().unwrap_or("Unknown Model").to_string()
    };

    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

    let mut bars = Vec::new();

    // 1. Find Gemini model
    let gemini_model = limited_models.iter().find(|m| {
        let label = get_label(m).to_lowercase();
        label.contains("gemini") && label.contains("3.5") && label.contains("flash")
    }).or_else(|| {
        limited_models.iter().find(|m| {
            let label = get_label(m).to_lowercase();
            label.contains("gemini") && label.contains("flash")
        })
    }).or_else(|| {
        limited_models.iter().find(|m| {
            let label = get_label(m).to_lowercase();
            label.contains("gemini")
        })
    });

    if let Some(m) = gemini_model {
        bars.push(QuotaBar {
            name: "Gemini".to_string(),
            value: get_pct(m),
            reset: get_reset(m),
        });
    }

    // 2. Find Claude/GPT-OSS model
    let claude_gpt_model = limited_models.iter().find(|m| {
        let label = get_label(m).to_lowercase();
        label.contains("claude") && label.contains("opus") && label.contains("4.6")
    }).or_else(|| {
        limited_models.iter().find(|m| {
            let label = get_label(m).to_lowercase();
            label.contains("claude") && label.contains("opus")
        })
    }).or_else(|| {
        limited_models.iter().find(|m| {
            let label = get_label(m).to_lowercase();
            label.contains("claude")
        })
    }).or_else(|| {
        limited_models.iter().find(|m| {
            let label = get_label(m).to_lowercase();
            label.contains("gpt-oss") || label.contains("gpt")
        })
    });

    if let Some(m) = claude_gpt_model {
        bars.push(QuotaBar {
            name: "Claude+GPT-OSS".to_string(),
            value: get_pct(m),
            reset: get_reset(m),
        });
    }

    if bars.is_empty() {
        bars = limited_models
            .iter()
            .map(|m| QuotaBar {
                name: get_label(m),
                value: get_pct(m),
                reset: get_reset(m),
            })
            .collect();
    }

    QuotaItem {
        id: "antigravity".to_string(),
        name: "Antigravity".to_string(),
        account_label,
        provider: "antigravity".to_string(),
        api_key: "".to_string(),
        encrypted_api_key: None,
        api_url: None,
        json_path: None,
        max_quota: Some(100.0),
        current_value: bars.first().map(|b| b.value),
        error_msg: None,
        last_update: Some(now),
        unit: Some("%".to_string()),
        primary_name: bars.first().map(|b| b.name.clone()),
        primary_reset: bars.first().and_then(|b| b.reset.clone()),
        bars: Some(bars),
        plan_type,
        ..Default::default()
    }
}

pub fn group_antigravity_bars(item: &mut QuotaItem) {
    if item.provider != "antigravity" {
        return;
    }
    let bars = match &item.bars {
        Some(b) => b,
        None => return,
    };
    
    let mut new_bars = Vec::new();
    
    // Find Gemini
    let gemini_bar = bars.iter().find(|b| {
        let name = b.name.to_lowercase();
        name.contains("gemini") && name.contains("3.5") && name.contains("flash")
    }).or_else(|| {
        bars.iter().find(|b| {
            let name = b.name.to_lowercase();
            name.contains("gemini") && name.contains("flash")
        })
    }).or_else(|| {
        bars.iter().find(|b| {
            let name = b.name.to_lowercase();
            name.contains("gemini")
        })
    });
    
    if let Some(b) = gemini_bar {
        new_bars.push(QuotaBar {
            name: "Gemini".to_string(),
            value: b.value,
            reset: b.reset.clone(),
        });
    }
    
    // Find Claude/GPT-OSS
    let claude_gpt_bar = bars.iter().find(|b| {
        let name = b.name.to_lowercase();
        name.contains("claude") && name.contains("opus") && name.contains("4.6")
    }).or_else(|| {
        bars.iter().find(|b| {
            let name = b.name.to_lowercase();
            name.contains("claude") && name.contains("opus")
        })
    }).or_else(|| {
        bars.iter().find(|b| {
            let name = b.name.to_lowercase();
            name.contains("claude")
        })
    }).or_else(|| {
        bars.iter().find(|b| {
            let name = b.name.to_lowercase();
            name.contains("gpt-oss") || name.contains("gpt")
        })
    });
    
    if let Some(b) = claude_gpt_bar {
        new_bars.push(QuotaBar {
            name: "Claude+GPT-OSS".to_string(),
            value: b.value,
            reset: b.reset.clone(),
        });
    }
    
    if !new_bars.is_empty() {
        item.current_value = new_bars.first().map(|b| b.value);
        item.primary_name = new_bars.first().map(|b| b.name.clone());
        item.primary_reset = new_bars.first().and_then(|b| b.reset.clone());
        item.bars = Some(new_bars);
    }
}

#[derive(serde::Deserialize)]
#[allow(dead_code)]
struct CursorPlanUsage {
    #[serde(rename = "totalSpend")]
    total_spend: Option<f64>,
    #[serde(rename = "includedSpend")]
    included_spend: Option<f64>,
    #[serde(rename = "bonusSpend")]
    bonus_spend: Option<f64>,
    limit: Option<f64>,
    #[serde(rename = "totalPercentUsed")]
    total_percent_used: Option<f64>,
    #[serde(rename = "apiPercentUsed")]
    api_percent_used: Option<f64>,
    #[serde(rename = "autoPercentUsed")]
    auto_percent_used: Option<f64>,
}

#[derive(serde::Deserialize)]
#[allow(dead_code)]
struct CursorUsageResponse {
    #[serde(rename = "planUsage")]
    plan_usage: Option<CursorPlanUsage>,
    #[serde(rename = "billingCycleEnd")]
    billing_cycle_end: Option<String>,
}

fn get_codex_auth_paths() -> Vec<PathBuf> {
    let mut paths = Vec::new();

    #[cfg(target_os = "windows")]
    {
        if let Ok(profile) = std::env::var("USERPROFILE") {
            if !profile.is_empty() {
                paths.push(PathBuf::from(&profile).join(".codex").join("auth.json"));
            }
        }
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            if !local.is_empty() {
                paths.push(PathBuf::from(&local).join("codex").join("auth.json"));
                paths.push(PathBuf::from(&local).join("Codex").join("auth.json"));
            }
        }
    }

    let expanded = shellexpand::tilde("~/.codex/auth.json").to_string();
    if !expanded.starts_with('~') {
        paths.push(PathBuf::from(expanded));
    }

    paths
}

fn get_codex_auth_path() -> Option<PathBuf> {
    get_codex_auth_paths().into_iter().find(|path| path.exists())
}

#[derive(serde::Deserialize)]
struct CodexTokens {
    access_token: String,
}

#[derive(serde::Deserialize)]
struct CodexAuth {
    tokens: Option<CodexTokens>,
}

#[derive(serde::Deserialize)]
struct CodexWindow {
    used_percent: f64,
    limit_window_seconds: u64,
    reset_at: Option<u64>,
}

#[derive(serde::Deserialize)]
#[allow(dead_code)]
struct CodexRateLimit {
    allowed: bool,
    limit_reached: bool,
    primary_window: Option<CodexWindow>,
    secondary_window: Option<CodexWindow>,
}

#[derive(serde::Deserialize)]
#[allow(dead_code)]
struct CodexUsageResponse {
    email: Option<String>,
    plan_type: Option<String>,
    rate_limit: Option<CodexRateLimit>,
}

fn format_seconds(seconds: u64) -> String {
    if seconds == 0 {
        return "0s".to_string();
    }
    if seconds % 86400 == 0 {
        format!("{}d", seconds / 86400)
    } else if seconds % 3600 == 0 {
        format!("{}h", seconds / 3600)
    } else if seconds % 60 == 0 {
        format!("{}m", seconds / 60)
    } else {
        format!("{}s", seconds)
    }
}

fn codex_auth_not_found_message() -> String {
    let paths = get_codex_auth_paths();
    if paths.is_empty() {
        return "Could not resolve Codex auth paths on this system".to_string();
    }
    let checked = paths
        .iter()
        .map(|p| p.display().to_string())
        .collect::<Vec<_>>()
        .join("; ");
    format!(
        "Codex credentials not found. Checked: {}. Please log in to Codex extension.",
        checked
    )
}

/// Fetch Codex Pro rate limits from ChatGPT backend wham usage endpoint
async fn fetch_codex_quota(_show_account_name: bool) -> Result<QuotaItem, String> {
    let auth_path =
        get_codex_auth_path().ok_or_else(codex_auth_not_found_message)?;

    let auth_str = std::fs::read_to_string(&auth_path)
        .map_err(|e| format!("Failed to read Codex auth file: {}", e))?;

    let auth: CodexAuth = serde_json::from_str(&auth_str)
        .map_err(|e| format!("Failed to parse Codex auth file: {}", e))?;

    let tokens = auth.tokens
        .ok_or_else(|| "No tokens found in Codex auth file".to_string())?;

    let token = tokens.access_token;
    if token.is_empty() {
        return Err("Codex access token is empty. Please log in again.".to_string());
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .unwrap_or_default();

    let res = client.get("https://chatgpt.com/backend-api/wham/usage")
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;

    if !res.status().is_success() {
        let status = res.status();
        let hint = if status.as_u16() == 401 {
            " Token may be expired; please log in again."
        } else if status.as_u16() == 403 {
            " Access denied; check your Codex subscription."
        } else {
            ""
        };
        return Err(format!("Codex API error: HTTP {}{}", status, hint));
    }

    let text = res.text().await
        .map_err(|e| format!("Failed to read response body: {}", e))?;

    let resp: CodexUsageResponse = serde_json::from_str(&text)
        .map_err(|e| format!("Failed to parse Codex usage response: {}", e))?;

    let account_label = resp.email;
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

    let rl = resp.rate_limit
        .ok_or_else(|| "No rate limit information returned from Codex".to_string())?;

    let pw = rl.primary_window
        .ok_or_else(|| "No primary rate limit window found".to_string())?;

    let sw = rl.secondary_window
        .ok_or_else(|| "No secondary rate limit window found".to_string())?;

    let remaining_pw = (100.0 - pw.used_percent).max(0.0);
    let remaining_sw = (100.0 - sw.used_percent).max(0.0);

    let format_reset_time = |timestamp_opt: Option<u64>| -> Option<String> {
        use chrono::TimeZone;
        let ts = timestamp_opt?;
        if let Some(dt) = chrono::Local.timestamp_opt(ts as i64, 0).single() {
            Some(dt.format("%Y-%m-%d %H:%M:%S").to_string())
        } else {
            None
        }
    };

    Ok(QuotaItem {
        id: "codex".to_string(),
        name: "Codex".to_string(),
        account_label,
        provider: "codex".to_string(),
        api_key: "".to_string(),
        encrypted_api_key: None,
        api_url: None,
        json_path: None,
        max_quota: Some(100.0),
        current_value: Some(remaining_pw),
        error_msg: None,
        last_update: Some(now),
        unit: Some("%".to_string()),
        
        primary_name: Some(format!("{} Usage", format_seconds(pw.limit_window_seconds))),
        primary_reset: format_reset_time(pw.reset_at),
        secondary_value: Some(remaining_sw),
        secondary_name: Some(format!("{} Usage", format_seconds(sw.limit_window_seconds))),
        secondary_reset: format_reset_time(sw.reset_at),
        plan_type: resp.plan_type.clone(),
        ..Default::default()
    })
}

#[derive(serde::Deserialize)]
struct CopilotQuotaDetail {
    percent_remaining: Option<f64>,
    unlimited: Option<bool>,
}

#[derive(serde::Deserialize)]
struct CopilotQuotaSnapshots {
    premium_interactions: Option<CopilotQuotaDetail>,
    chat: Option<CopilotQuotaDetail>,
}

#[derive(serde::Deserialize)]
struct CopilotLimitedQuotas {
    chat: Option<f64>,
}

#[derive(serde::Deserialize)]
struct CopilotMonthlyQuotas {
    chat: Option<f64>,
}

#[derive(serde::Deserialize)]
struct CopilotUserResponse {
    copilot_plan: Option<String>,
    quota_reset_date: Option<String>,
    limited_user_reset_date: Option<String>,
    quota_snapshots: Option<CopilotQuotaSnapshots>,
    limited_user_quotas: Option<CopilotLimitedQuotas>,
    monthly_quotas: Option<CopilotMonthlyQuotas>,
}

const COPILOT_API_VERSION: &str = "2025-05-01";

/// Fetch VS Code GitHub Copilot quota via the internal GitHub API.
async fn fetch_copilot_quota(_show_account_name: bool, api_key_override: &str) -> Result<QuotaItem, String> {
    let (token, raw_email) = if !api_key_override.trim().is_empty() {
        (api_key_override.trim().to_string(), None)
    } else {
        vscode_secrets::read_vscode_copilot_github_token()?
    };

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .connect_timeout(Duration::from_secs(10))
        .build()
        .unwrap_or_default();

    // Retry up to 2 attempts for transient network errors
    let mut last_err = String::new();
    for attempt in 0..2 {
        if attempt > 0 {
            tokio::time::sleep(Duration::from_secs(2)).await;
        }

        let res = match client
            .get("https://api.github.com/copilot_internal/user")
            .header("Authorization", format!("Bearer {}", token))
            .header("Accept", "application/json")
            .header("X-GitHub-Api-Version", COPILOT_API_VERSION)
            .header("User-Agent", "widgitron-quota-monitor")
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => {
                last_err = format!("Network error: {}", e);
                continue;
            }
        };

        if !res.status().is_success() {
            let status = res.status();
            let hint = if status.as_u16() == 401 {
                " Token may be expired; re-authenticate GitHub Copilot in VS Code."
            } else if status.as_u16() == 403 {
                " Access denied; check your Copilot subscription."
            } else {
                ""
            };
            last_err = format!("Copilot API error: HTTP {}{}", status, hint);
            break;
        }

        let text = match res.text().await {
            Ok(t) => t,
            Err(e) => {
                last_err = format!("Failed to read response body: {}", e);
                continue;
            }
        };

        let resp: CopilotUserResponse = match serde_json::from_str(&text) {
            Ok(r) => r,
            Err(e) => return Err(format!("Failed to parse Copilot usage response: {}", e)),
        };

        let (remaining_pct, bar_name, reset_raw) =
            if let Some(premium) = resp
                .quota_snapshots
                .as_ref()
                .and_then(|s| s.premium_interactions.as_ref())
            {
                if premium.unlimited == Some(true) {
                    (
                        100.0,
                        "Premium Requests".to_string(),
                        resp.quota_reset_date.clone(),
                    )
                } else {
                    (
                        premium.percent_remaining.unwrap_or(0.0).clamp(0.0, 100.0),
                        "Premium Requests".to_string(),
                        resp.quota_reset_date.clone(),
                    )
                }
            } else if let (Some(limited), Some(monthly)) =
                (resp.limited_user_quotas.as_ref(), resp.monthly_quotas.as_ref())
            {
                let used = limited.chat.unwrap_or(0.0);
                let total = monthly.chat.unwrap_or(0.0);
                let pct = if total > 0.0 {
                    (used / total * 100.0).clamp(0.0, 100.0)
                } else {
                    0.0
                };
                (
                    pct,
                    "Chat".to_string(),
                    resp.limited_user_reset_date.clone(),
                )
            } else if let Some(chat) = resp.quota_snapshots.as_ref().and_then(|s| s.chat.as_ref()) {
                (
                    chat.percent_remaining.unwrap_or(0.0).clamp(0.0, 100.0),
                    "Chat".to_string(),
                    resp.quota_reset_date.clone(),
                )
            } else {
                return Err("No quota information returned from Copilot API".to_string());
            };

        let reset_time = reset_raw.as_deref().and_then(format_iso_to_local);
        let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

        return Ok(QuotaItem {
            id: "copilot".to_string(),
            name: "Copilot".to_string(),
            account_label: raw_email,
            provider: "copilot".to_string(),
            api_key: String::new(),
            encrypted_api_key: None,
            api_url: None,
            json_path: None,
            max_quota: Some(100.0),
            current_value: Some(remaining_pct),
            error_msg: None,
            last_update: Some(now),
            unit: Some("%".to_string()),
            primary_name: Some(bar_name),
            primary_reset: reset_time,
            plan_type: resp.copilot_plan.clone(),
            ..Default::default()
        });
    }

    Err(last_err)
}

/// Fetch Cursor quota from the Cursor API using the local access token
async fn fetch_cursor_quota(_show_account_name: bool) -> Result<QuotaItem, String> {
    let app_names = ["Cursor", "cursor"];
    let db_path = resolve_ide_db_path(&app_names)
        .ok_or_else(|| ide_db_not_found_message("Cursor", &app_names))?;
    
    let token_opt = read_vscdb_key(&db_path, "cursorAuth/accessToken")?;
    let token = match token_opt {
        Some(t) => t,
        None => return Err("Not signed in (cursorAuth/accessToken not found)".to_string()),
    };
    
    let account_label = read_vscdb_key(&db_path, "cursorAuth/cachedEmail").unwrap_or(None);
    let plan_type = read_vscdb_key(&db_path, "cursorAuth/stripeMembershipType").unwrap_or(None);
    
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .unwrap_or_default();
        
    let url = "https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage";
    let res = client.post(url)
        .header("Authorization", format!("Bearer {}", token))
        .header("Content-Type", "application/json")
        .header("connect-protocol-version", "1")
        .body("{}")
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;
        
    if !res.status().is_success() {
        let status = res.status();
        let hint = if status.as_u16() == 401 {
            " Token may be expired; sign in again via Cursor."
        } else if status.as_u16() == 403 {
            " Access denied; check your Cursor subscription."
        } else {
            ""
        };
        return Err(format!("Cursor API error: HTTP {}{}", status, hint));
    }
    
    let text = res.text().await
        .map_err(|e| format!("Failed to read response body: {}", e))?;
        
    let usage_resp: CursorUsageResponse = serde_json::from_str(&text)
        .map_err(|e| format!("Failed to parse usage details: {}", e))?;
        
    let plan = usage_resp.plan_usage
        .ok_or_else(|| "No plan usage statistics returned from Cursor API".to_string())?;
        
    let api_used = plan.api_percent_used.unwrap_or(0.0);
    let auto_used = plan.auto_percent_used.unwrap_or(0.0);
    
    let remaining_api = (100.0 - api_used).max(0.0);
    let remaining_auto = (100.0 - auto_used).max(0.0);
    
    let reset_time = usage_resp.billing_cycle_end.and_then(|s| {
        s.parse::<i64>().ok().and_then(|ms| {
            use chrono::TimeZone;
            if let Some(dt) = chrono::Local.timestamp_opt(ms / 1000, 0).single() {
                Some(dt.format("%Y-%m-%d %H:%M:%S").to_string())
            } else {
                None
            }
        })
    });
    
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    
    Ok(QuotaItem {
        id: "cursor".to_string(),
        name: "Cursor".to_string(),
        account_label,
        provider: "cursor".to_string(),
        api_key: "".to_string(),
        encrypted_api_key: None,
        api_url: None,
        json_path: None,
        max_quota: Some(100.0),
        current_value: Some(remaining_api),
        error_msg: None,
        last_update: Some(now),
        unit: Some("%".to_string()),
        
        primary_name: Some("API Usage".to_string()),
        primary_reset: reset_time,
        secondary_value: Some(remaining_auto),
        secondary_name: Some("Auto Usage".to_string()),
        secondary_reset: None,
        plan_type,
        ..Default::default()
    })
}

/// Helper to traverse a serde_json::Value using dot-notation, including optional array index syntax (e.g. data.list[0].value)
fn get_json_value_by_path(value: &Value, path: &str) -> Option<Value> {
    let mut current = value;
    for part in path.split('.') {
        if part.is_empty() {
            continue;
        }
        
        if part.contains('[') && part.ends_with(']') {
            let parts: Vec<&str> = part.split('[').collect();
            if parts.len() == 2 {
                let key = parts[0];
                let index_str = parts[1].trim_end_matches(']');
                if let Ok(idx) = index_str.parse::<usize>() {
                    if !key.is_empty() {
                        current = current.get(key)?;
                    }
                    current = current.get(idx)?;
                    continue;
                }
            }
        }
        
        current = current.get(part)?;
    }
    Some(current.clone())
}

// ─── Qoder CN ──────────────────────────────────────────────────────────────

const QODER_CN_OPENAPI_BASES: &[&str] = &[
    "https://openapi.qoder.com.cn",
    "https://openapi.qoder.sh",
];

#[derive(Debug, Deserialize)]
struct QoderJobTokenExchangeResponse {
    token: String,
    #[serde(default)]
    #[allow(dead_code)]
    refresh_token: Option<String>,
}

async fn qoder_cn_exchange_personal_token(
    client: &reqwest::Client,
    personal_token: &str,
) -> Result<String, String> {
    for base in QODER_CN_OPENAPI_BASES {
        let url = format!("{}/api/v1/jobToken/exchange", base);
        let res = client
            .post(&url)
            .header("Content-Type", "application/json")
            .header("Accept", "application/json")
            .json(&serde_json::json!({ "personal_token": personal_token }))
            .send()
            .await
            .map_err(|e| format!("Network error exchanging Qoder CN PAT: {}", e))?;

        let status = res.status();
        let body = res.text().await.unwrap_or_default();

        if !status.is_success() {
            log::debug!(
                "Qoder CN PAT exchange failed on {}: HTTP {} — {}",
                base,
                status,
                &body[..body.len().min(120)]
            );
            continue;
        }

        let parsed: QoderJobTokenExchangeResponse = serde_json::from_str(&body).map_err(|e| {
            format!(
                "Failed to parse Qoder CN PAT exchange response: {} — {}",
                e,
                &body[..body.len().min(120)]
            )
        })?;

        let token = parsed.token.trim();
        if token.is_empty() {
            continue;
        }

        log::info!("Qoder CN PAT exchanged for job token via {}", base);
        return Ok(token.to_string());
    }

    Err("Qoder CN PAT exchange failed. Regenerate your PAT at qoder.com.cn/account/integrations.".to_string())
}

/// PATs (pt-...) must be exchanged for job tokens (jt-...) before OpenAPI calls.
async fn qoder_cn_normalize_token(
    client: &reqwest::Client,
    token: &str,
) -> Result<String, String> {
    let trimmed = token.trim();
    if trimmed.is_empty() {
        return Err("Qoder CN token is empty.".to_string());
    }
    if trimmed.starts_with("pt-") {
        return qoder_cn_exchange_personal_token(client, trimmed).await;
    }
    Ok(trimmed.to_string())
}

async fn qoder_cn_auth_candidates(item: &QuotaItem) -> Result<Vec<(String, Option<String>)>, String> {
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let mode = quota_auth_mode(item);

    if mode == QuotaAuthMode::Local {
        match vscode_secrets::read_qoder_cn_auth_token() {
            Ok(Some((token, label))) => qoder_cn_push_auth_candidate(&mut out, &mut seen, token, label),
            Ok(None) => {}
            Err(e) => log::warn!("Qoder CN IDE session read failed: {}", e),
        }
    }

    if mode == QuotaAuthMode::ApiKey || out.is_empty() {
        qoder_cn_push_auth_candidate(&mut out, &mut seen, item.api_key.clone(), None);
        for env_var in ["QODERCN_PERSONAL_ACCESS_TOKEN", "QODER_PERSONAL_ACCESS_TOKEN"] {
            if let Ok(val) = std::env::var(env_var) {
                qoder_cn_push_auth_candidate(&mut out, &mut seen, val, None);
            }
        }
    }

    if out.is_empty() {
        let hint = if mode == QuotaAuthMode::Local {
            "Sign in to Qoder CN IDE, or add a PAT (pt-...) from qoder.com.cn/account/integrations."
        } else {
            "Add a PAT (pt-...) from qoder.com.cn/account/integrations."
        };
        return Err(format!("Qoder CN authentication not configured. {}", hint));
    }
    Ok(out)
}

fn qoder_cn_push_auth_candidate(
    out: &mut Vec<(String, Option<String>)>,
    seen: &mut std::collections::HashSet<String>,
    token: String,
    label: Option<String>,
) {
    let t = token.trim().to_string();
    if !t.is_empty() && seen.insert(t.clone()) {
        out.push((t, label));
    }
}

fn qoder_cn_error_message(status: u16, body: &str) -> String {
    if body.contains("TOKEN_EXPIRE") || body.contains("token is not active") {
        return "Qoder CN token expired or inactive. Regenerate a PAT at qoder.com.cn/account/integrations, or sign in to Qoder CN IDE.".to_string();
    }
    if status == 401 {
        return "Qoder CN authentication failed. Use a valid PAT (pt-...) or sign in to Qoder CN IDE.".to_string();
    }
    if status == 403 {
        return "Qoder CN access denied. Check your account permissions or subscription.".to_string();
    }
    if status == 429 {
        return "Qoder CN rate limited. Try again in a few minutes.".to_string();
    }
    if (500..=599).contains(&status) {
        return format!("Qoder CN server error: HTTP {} — try again later", status);
    }
    format!(
        "Qoder CN API error: HTTP {} — {}",
        status,
        &body[..body.len().min(120)]
    )
}

fn is_qoder_cn_auth_error(err: &str) -> bool {
    err.contains("TOKEN_EXPIRE")
        || err.contains("token expired")
        || err.contains("authentication failed")
        || err.contains("HTTP 401")
}

fn build_qoder_cn_quota_item(
    item: &QuotaItem,
    current_val: f64,
    max_val: Option<f64>,
    unit: String,
    plan_name: Option<String>,
    account_label: Option<String>,
) -> QuotaItem {
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let pct = current_val.round().clamp(0.0, 100.0);

    let bars = if unit == "%" {
        Some(vec![QuotaBar {
            name: "Credits".to_string(),
            value: pct,
            reset: None,
        }])
    } else {
        None
    };

    QuotaItem {
        id: item.id.clone(),
        name: item.name.clone(),
        account_label,
        provider: "qoder-cn".to_string(),
        api_key: String::new(),
        encrypted_api_key: None,
        api_url: None,
        json_path: None,
        max_quota: max_val,
        current_value: if unit == "%" { Some(pct) } else { Some(current_val) },
        error_msg: None,
        last_update: Some(now),
        unit: Some(unit),
        primary_name: Some("Credits".to_string()),
        plan_type: plan_name,
        bars,
        ..Default::default()
    }
}

async fn qoder_cn_try_fetch(
    client: &reqwest::Client,
    base: &str,
    token: &str,
) -> Result<(serde_json::Value, Option<String>), String> {
    let auth_header = format!("Bearer {}", token);

    let usage_res = client
        .get(format!("{}/api/v2/quota/usage", base))
        .header("Authorization", &auth_header)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;

    let status = usage_res.status();
    let usage_text = usage_res
        .text()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;

    if !status.is_success() {
        return Err(qoder_cn_error_message(status.as_u16(), &usage_text));
    }

    let usage_parsed: serde_json::Value = serde_json::from_str(&usage_text).map_err(|e| {
        format!(
            "Failed to parse Qoder CN usage response: {} — body: {}",
            e,
            &usage_text[..usage_text.len().min(200)]
        )
    })?;

    let mut plan_name = None;
    if let Ok(plan_res) = client
        .get(format!("{}/api/v2/user/plan", base))
        .header("Authorization", &auth_header)
        .header("Accept", "application/json")
        .send()
        .await
    {
        if plan_res.status().is_success() {
            if let Ok(plan_text) = plan_res.text().await {
                if let Ok(plan_parsed) = serde_json::from_str::<serde_json::Value>(&plan_text) {
                    let plan_data = plan_parsed.get("data").unwrap_or(&plan_parsed);
                    plan_name = plan_data
                        .get("plan_tier_name")
                        .or_else(|| plan_data.get("plan_name"))
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                }
            }
        }
    }

    Ok((usage_parsed, plan_name))
}

fn parse_qoder_cn_quota(parsed: &serde_json::Value) -> Result<(f64, Option<f64>, String, Option<String>), String> {
    let data = parsed.get("data").unwrap_or(parsed);

    let plan_name = data
        .get("plan_tier_name")
        .or_else(|| data.get("plan_name"))
        .or_else(|| data.get("planName"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    if let Some(user_quota) = data.get("userQuota") {
        let remaining = user_quota.get("remaining").and_then(|v| v.as_f64());
        let total = user_quota.get("total").and_then(|v| v.as_f64());
        let used_pct = user_quota
            .get("percentage")
            .and_then(|v| v.as_f64())
            .or_else(|| data.get("totalUsagePercentage").and_then(|v| v.as_f64()));

        if let (Some(r), Some(t)) = (remaining, total) {
            if t > 0.0 {
                return Ok(((r / t * 100.0).round(), Some(100.0), "%".to_string(), plan_name));
            }
            return Ok((r.round(), None, "credits".to_string(), plan_name));
        }

        if let Some(pct) = used_pct {
            return Ok((
                (((1.0 - pct) * 100.0).max(0.0)).round(),
                Some(100.0),
                "%".to_string(),
                plan_name,
            ));
        }
    }

    let remain = data
        .get("remain_count")
        .or_else(|| data.get("remainCount"))
        .or_else(|| data.get("remain"))
        .or_else(|| data.get("remaining"))
        .and_then(|v| v.as_f64());

    let total = data
        .get("total_count")
        .or_else(|| data.get("totalCount"))
        .or_else(|| data.get("total"))
        .and_then(|v| v.as_f64());

    if let (Some(r), Some(t)) = (remain, total) {
        if t > 0.0 {
            return Ok(((r / t * 100.0).round(), Some(100.0), "%".to_string(), plan_name));
        }
        return Ok((r.round(), None, "credits".to_string(), plan_name));
    }

    if let Some(r) = remain {
        return Ok((r.round(), None, "credits".to_string(), plan_name));
    }

    Err("Could not find quota data in Qoder CN response".to_string())
}

/// Fetch Qoder CN remaining credits via the official OpenAPI (same endpoints as QoderCN IDE).
async fn fetch_qoder_cn_quota(item: &QuotaItem) -> Result<QuotaItem, String> {
    if quota_auth_mode(item) == QuotaAuthMode::Local {
        if let Ok(Some(plan)) = vscode_secrets::read_qoder_cn_user_plan() {
            match parse_qoder_cn_quota(&plan) {
                Ok((current_val, max_val, unit, plan_name)) => {
                    let account_label = vscode_secrets::read_qoder_cn_auth_token()
                        .ok()
                        .flatten()
                        .and_then(|(_, label)| label);
                    log::debug!("Using cached Qoder CN plan from IDE storage");
                    return Ok(build_qoder_cn_quota_item(
                        item,
                        current_val,
                        max_val,
                        unit,
                        plan_name,
                        account_label,
                    ));
                }
                Err(e) => log::debug!("Cached Qoder CN plan unusable, falling back to API: {}", e),
            }
        }
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .unwrap_or_default();

    let candidates = qoder_cn_auth_candidates(item).await?;
    let mut last_err = String::new();

    for (token, account_label) in candidates {
        let api_token = match qoder_cn_normalize_token(&client, &token).await {
            Ok(t) => t,
            Err(e) => {
                last_err = e;
                continue;
            }
        };

        for base in QODER_CN_OPENAPI_BASES {
            match qoder_cn_try_fetch(&client, base, &api_token).await {
                Ok((usage_parsed, plan_name)) => {
                    let (current_val, max_val, unit, parsed_plan) =
                        parse_qoder_cn_quota(&usage_parsed)?;
                    return Ok(build_qoder_cn_quota_item(
                        item,
                        current_val,
                        max_val,
                        unit,
                        plan_name.or(parsed_plan),
                        account_label.clone(),
                    ));
                }
                Err(e) => {
                    last_err = e;
                    if is_qoder_cn_auth_error(&last_err) || is_quota_retriable_failure(&last_err) {
                        continue;
                    }
                    return Err(last_err);
                }
            }
        }
    }

    Err(if last_err.is_empty() {
        "Qoder CN authentication failed.".to_string()
    } else {
        last_err
    })
}

// ─── Pioneer AI ────────────────────────────────────────────────────────────

const PIONEER_API_BASE: &str = "https://api.pioneer.ai";

fn resolve_pioneer_api_key(item: &QuotaItem) -> Result<String, String> {
    if quota_auth_mode(item) == QuotaAuthMode::Local {
        return Err("Pioneer AI only supports API key authentication.".to_string());
    }
    let override_key = item.api_key.trim();
    if !override_key.is_empty() {
        return Ok(override_key.to_string());
    }
    if let Ok(val) = std::env::var("PIONEER_API_KEY") {
        let trimmed = val.trim();
        if !trimmed.is_empty() {
            return Ok(trimmed.to_string());
        }
    }
    Err("Pioneer AI API key not configured. Add your API key (pio-...) in Settings or set PIONEER_API_KEY.".to_string())
}

/// Fetch Pioneer AI billing quota via the official REST API (api.pioneer.ai, not agent.pioneer.ai).
async fn fetch_pioneer_quota(item: &QuotaItem) -> Result<QuotaItem, String> {
    let api_key = resolve_pioneer_api_key(item)?;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .unwrap_or_default();

    let res = client
        .get(format!("{}/billing/billing-status", PIONEER_API_BASE))
        .header("X-API-Key", &api_key)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;

    if !res.status().is_success() {
        let status = res.status();
        let hint = match status.as_u16() {
            401 => " Invalid API key (pio-...).",
            403 => " Access denied; check your Pioneer subscription.",
            429 => " Rate limited; try again later.",
            s if (500..=599).contains(&s) => " Server error; try again later.",
            _ => "",
        };
        let body = res.text().await.unwrap_or_default();
        let detail = if body.is_empty() {
            String::new()
        } else {
            format!(" — {}", &body[..body.len().min(120)])
        };
        return Err(format!(
            "Pioneer AI API error: HTTP {}{}{}",
            status,
            hint,
            detail
        ));
    }

    let text = res.text().await
        .map_err(|e| format!("Failed to read response: {}", e))?;

    let parsed: serde_json::Value = serde_json::from_str(&text)
        .map_err(|e| format!("Failed to parse Pioneer AI response: {} — body: {}", e, &text[..text.len().min(200)]))?;

    let data = parsed.get("data").unwrap_or(&parsed);

    // Monetary values are in cents per Pioneer API docs.
    let free_remaining = data.get("free_tier_remaining").and_then(|v| v.as_f64());
    let credit_limit = data.get("credit_limit").and_then(|v| v.as_f64());
    let total_usage = data.get("total_usage").and_then(|v| v.as_f64());

    let plan_name = data.get("payment_plan")
        .or_else(|| data.get("plan"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

    let (current_val, max_val, unit) = if let (Some(remaining), Some(limit)) = (free_remaining, credit_limit) {
        if limit > 0.0 {
            (
                Some((remaining / limit * 100.0).clamp(0.0, 100.0).round()),
                Some(100.0),
                "%".to_string(),
            )
        } else {
            (Some((remaining / 100.0).round()), None, "$".to_string())
        }
    } else if let Some(remaining) = free_remaining {
        (Some((remaining / 100.0).round()), None, "$".to_string())
    } else if let (Some(usage), Some(limit)) = (total_usage, credit_limit) {
        if limit > 0.0 {
            (
                Some(((limit - usage).max(0.0) / limit * 100.0).clamp(0.0, 100.0).round()),
                Some(100.0),
                "%".to_string(),
            )
        } else {
            return Err(format!(
                "Could not find quota data in Pioneer AI response. Raw: {}",
                &text[..text.len().min(300)]
            ));
        }
    } else {
        return Err(format!(
            "Could not find quota data in Pioneer AI response. Raw: {}",
            &text[..text.len().min(300)]
        ));
    };

    let pct = current_val.unwrap_or(0.0);
    let bars = if unit == "%" {
        Some(vec![QuotaBar {
            name: "Credits".to_string(),
            value: pct,
            reset: None,
        }])
    } else {
        None
    };

    Ok(QuotaItem {
        id: item.id.clone(),
        name: item.name.clone(),
        provider: "pioneer".to_string(),
        api_key: String::new(),
        encrypted_api_key: None,
        api_url: None,
        json_path: None,
        max_quota: max_val,
        current_value: current_val,
        error_msg: None,
        last_update: Some(now),
        unit: Some(unit),
        primary_name: Some("Credits".to_string()),
        plan_type: plan_name,
        bars,
        ..Default::default()
    })
}

// ─── Claude Code ───────────────────────────────────────────────────────────

fn get_claude_settings_path() -> Option<PathBuf> {
    // On Windows, HOME is often unset; fall back to USERPROFILE
    #[cfg(target_os = "windows")]
    {
        if let Ok(profile) = std::env::var("USERPROFILE") {
            if !profile.is_empty() {
                return Some(PathBuf::from(profile).join(".claude").join("settings.json"));
            }
        }
    }
    let expanded = shellexpand::tilde("~/.claude/settings.json").to_string();
    if expanded.starts_with('~') { None } else { Some(PathBuf::from(expanded)) }
}

/// Fetch Claude Code remaining token quota.
/// If the ANTHROPIC_AUTH_TOKEN starts with "sk-cp-" we query
/// https://api.minimaxi.com/v1/token_plan/remains for the balance.
/// Otherwise we return an error because standard Anthropic tokens have no public
/// balance API.
async fn fetch_claude_code_quota(item: &QuotaItem) -> Result<QuotaItem, String> {
    let mode = quota_auth_mode(item);
    let token = if mode == QuotaAuthMode::ApiKey {
        let key = item.api_key.trim();
        if key.is_empty() {
            return Err(
                "Claude Code API key not configured. Add your sk-cp-... token in Settings.".to_string(),
            );
        }
        key.to_string()
    } else {
        let settings_path = get_claude_settings_path()
            .ok_or_else(|| "Could not resolve Claude settings path on this system".to_string())?;

        if !settings_path.exists() {
            return Err(format!(
                "Claude Code settings not found at {}. Please run Claude Code at least once.",
                settings_path.display()
            ));
        }

        let settings_str = std::fs::read_to_string(&settings_path)
            .map_err(|e| format!("Failed to read Claude Code settings: {}", e))?;

        let settings: serde_json::Value = serde_json::from_str(&settings_str)
            .map_err(|e| format!("Failed to parse Claude Code settings.json: {}", e))?;

        settings
            .get("env")
            .and_then(|env| env.get("ANTHROPIC_AUTH_TOKEN"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .ok_or_else(|| "ANTHROPIC_AUTH_TOKEN not found in ~/.claude/settings.json. Claude Code may not be configured with a proxy token.".to_string())?
    };

    if !token.starts_with("sk-cp-") {
        // Standard Anthropic token – no public balance API, show a clean placeholder
        let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
        return Ok(QuotaItem {
            id: item.id.clone(),
            name: item.name.clone(),
            provider: "claude-code".to_string(),
            api_key: String::new(),
            encrypted_api_key: None,
            api_url: None,
            json_path: None,
            max_quota: None,
            current_value: None,
            error_msg: Some("Anthropic official tokens have no public balance API. Use an sk-cp- token for quota tracking.".to_string()),
            last_update: Some(now),
            unit: None,
            ..Default::default()
        });
    }

    // sk-cp- token – query remaining balance
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .unwrap_or_default();

    let res = client
        .get("https://api.minimaxi.com/v1/token_plan/remains")
        .header("Authorization", format!("Bearer {}", token))
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("Network error querying Claude Code token balance: {}", e))?;

    if !res.status().is_success() {
        let status = res.status();
        let hint = match status.as_u16() {
            401 => " Token may be expired; refresh your sk-cp- token.",
            403 => " Access denied; check that this token still has quota access.",
            429 => " Rate limited; try again later.",
            s if (500..=599).contains(&s) => " Server error; try again later.",
            _ => "",
        };
        return Err(format!(
            "Claude Code token balance API error: HTTP {}{}",
            status, hint
        ));
    }

    let text = res.text().await
        .map_err(|e| format!("Failed to read response: {}", e))?;

    let parsed: serde_json::Value = serde_json::from_str(&text)
        .map_err(|e| format!("Failed to parse token balance response: {}", e))?;

    let data = parsed.get("token_plan").unwrap_or(&parsed);
    let remain = data.get("remains")
        .or_else(|| data.get("remain")
        .or_else(|| data.get("remaining")))
        .and_then(|v| v.as_f64());

    let total = data.get("total")
        .or_else(|| data.get("total_tokens"))
        .and_then(|v| v.as_f64());

    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

    let (current_val, max_val, unit) = if let (Some(r), Some(t)) = (remain, total) {
        if t > 0.0 {
            (Some((r / t) * 100.0), Some(100.0_f64), "%".to_string())
        } else {
            (Some(r), None, "tokens".to_string())
        }
    } else if let Some(r) = remain {
        (Some(r), None, "tokens".to_string())
    } else {
        return Err(format!("Could not find balance in Claude Code token plan response. Raw: {}", &text[..text.len().min(300)]));
    };

    Ok(QuotaItem {
        id: item.id.clone(),
        name: item.name.clone(),
        provider: "claude-code".to_string(),
        api_key: String::new(),
        encrypted_api_key: None,
        api_url: None,
        json_path: None,
        max_quota: max_val,
        current_value: current_val,
        error_msg: None,
        last_update: Some(now),
        unit: Some(unit),
        ..Default::default()
    })
}

fn resolve_quota_provider(item: &QuotaItem) -> &str {
    &item.provider
}

fn quota_items_display_equal(a: &[QuotaItem], b: &[QuotaItem]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    for (left, right) in a.iter().zip(b.iter()) {
        if left.id != right.id
            || left.current_value != right.current_value
            || left.error_msg != right.error_msg
            || left.max_quota != right.max_quota
            || left.unit != right.unit
            || left.plan_type != right.plan_type
            || left.account_label != right.account_label
            || left.primary_name != right.primary_name
            || left.primary_reset != right.primary_reset
            || left.secondary_value != right.secondary_value
            || left.secondary_name != right.secondary_name
            || left.secondary_reset != right.secondary_reset
            || left.tertiary_value != right.tertiary_value
            || left.tertiary_name != right.tertiary_name
            || left.tertiary_reset != right.tertiary_reset
            || left.bars != right.bars
        {
            return false;
        }
    }
    true
}

/// Perform HTTP requests to update all non-manual quota monitors
pub async fn perform_quota_fetch(
    app: &AppHandle,
    state: &GlobalState,
) -> Result<Vec<QuotaItem>, String> {
    let _fetch_guard = state.quota_fetch_lock.lock().await;

    let config = read_quota_config(app);
    let source_items: std::collections::HashMap<String, QuotaItem> = config
        .items
        .iter()
        .map(|item| (item.id.clone(), item.clone()))
        .collect();
    let show_account_name = config.show_account_name.unwrap_or(false);

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .unwrap_or_default();

    let needs_provider = |name: &str| {
        config
            .items
            .iter()
            .any(|item| resolve_quota_provider(item) == name)
    };

    let copilot_items: Vec<QuotaItem> = config
        .items
        .iter()
        .filter(|item| resolve_quota_provider(item) == "copilot")
        .cloned()
        .collect();
    let qoder_items: Vec<QuotaItem> = config
        .items
        .iter()
        .filter(|item| item.provider == "qoder-cn")
        .cloned()
        .collect();
    let pioneer_items: Vec<QuotaItem> = config
        .items
        .iter()
        .filter(|item| item.provider == "pioneer")
        .cloned()
        .collect();
    let claude_items: Vec<QuotaItem> = config
        .items
        .iter()
        .filter(|item| item.provider == "claude-code")
        .cloned()
        .collect();
    let (ag_res, codex_res, cursor_res) = tokio::join!(
        async {
            if needs_provider("antigravity") {
                Some(fetch_antigravity_quota(app, show_account_name).await)
            } else {
                None
            }
        },
        async {
            if needs_provider("codex") {
                Some(fetch_codex_quota(show_account_name).await)
            } else {
                None
            }
        },
        async {
            if needs_provider("cursor") {
                Some(fetch_cursor_quota(show_account_name).await)
            } else {
                None
            }
        },
    );

    let mut prefetch_by_id: std::collections::HashMap<String, Result<QuotaItem, String>> =
        std::collections::HashMap::new();
    let mut prefetch_set = tokio::task::JoinSet::new();
    for item in copilot_items
        .into_iter()
        .chain(qoder_items)
        .chain(pioneer_items)
        .chain(claude_items)
    {
        prefetch_set.spawn(async move {
            let id = item.id.clone();
            let result = match item.provider.as_str() {
                "copilot" => fetch_copilot_quota(show_account_name, &item.api_key)
                    .await
                    .map(|mut fetched| {
                        fetched.id = id.clone();
                        if !item.name.is_empty() {
                            fetched.name = item.name.clone();
                        }
                        fetched.auth_mode = item.auth_mode.clone();
                        fetched
                    }),
                "qoder-cn" => fetch_qoder_cn_quota(&item).await,
                "pioneer" => fetch_pioneer_quota(&item).await,
                "claude-code" => fetch_claude_code_quota(&item).await,
                other => Err(format!("Unsupported prefetch provider: {}", other)),
            };
            (id, result)
        });
    }
    while let Some(joined) = prefetch_set.join_next().await {
        match joined {
            Ok((id, result)) => {
                prefetch_by_id.insert(id, result);
            }
            Err(e) => log::error!("Quota prefetch task panicked: {}", e),
        }
    }

    let mut fetched_items = Vec::new();
    let mut antigravity_processed = false;
    let mut codex_processed = false;
    let mut cursor_processed = false;
    let mut copilot_processed_ids: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut qoder_cn_processed_ids: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut pioneer_processed_ids: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut claude_code_processed_ids: std::collections::HashSet<String> = std::collections::HashSet::new();

    for item in &config.items {
        let provider = resolve_quota_provider(item);

        if provider == "antigravity" {
            if !antigravity_processed {
                antigravity_processed = true;
                push_antigravity_fetch_results(&mut fetched_items, &config.items, &ag_res);
            }
        } else if provider == "codex" {
            if !codex_processed {
                codex_processed = true;
                push_singleton_provider_fetch_results(
                    &mut fetched_items,
                    &config.items,
                    "codex",
                    "Codex",
                    &codex_res,
                );
            }
        } else if provider == "cursor" {
            if !cursor_processed {
                cursor_processed = true;
                push_singleton_provider_fetch_results(
                    &mut fetched_items,
                    &config.items,
                    "cursor",
                    "Cursor",
                    &cursor_res,
                );
            }
        } else if provider == "copilot" {
            if !copilot_processed_ids.contains(&item.id) {
                copilot_processed_ids.insert(item.id.clone());
                match prefetch_by_id.get(&item.id) {
                    Some(Ok(resolved_item)) => fetched_items.push(resolved_item.clone()),
                    Some(Err(e)) => {
                        push_quota_provider_fetch_error(
                            &mut fetched_items,
                            item,
                            "Copilot",
                            e,
                        );
                    }
                    None => {
                        push_prefetch_missing_item(&mut fetched_items, item, "copilot");
                    }
                }
            }
        } else if provider == "qoder-cn" {
            if !qoder_cn_processed_ids.contains(&item.id) {
                qoder_cn_processed_ids.insert(item.id.clone());
                match prefetch_by_id.get(&item.id) {
                    Some(Ok(resolved_item)) => fetched_items.push(resolved_item.clone()),
                    Some(Err(e)) => {
                        push_quota_provider_fetch_error(
                            &mut fetched_items,
                            item,
                            "Qoder CN",
                            e,
                        );
                    }
                    None => {
                        push_prefetch_missing_item(&mut fetched_items, item, "qoder-cn");
                    }
                }
            }
        } else if provider == "pioneer" {
            if !pioneer_processed_ids.contains(&item.id) {
                pioneer_processed_ids.insert(item.id.clone());
                match prefetch_by_id.get(&item.id) {
                    Some(Ok(resolved_item)) => fetched_items.push(resolved_item.clone()),
                    Some(Err(e)) => {
                        push_quota_provider_fetch_error(
                            &mut fetched_items,
                            item,
                            "Pioneer AI",
                            e,
                        );
                    }
                    None => {
                        push_prefetch_missing_item(&mut fetched_items, item, "pioneer");
                    }
                }
            }
        } else if provider == "claude-code" {
            if !claude_code_processed_ids.contains(&item.id) {
                claude_code_processed_ids.insert(item.id.clone());
                match prefetch_by_id.get(&item.id) {
                    Some(Ok(resolved_item)) => fetched_items.push(resolved_item.clone()),
                    Some(Err(e)) => {
                        push_quota_provider_fetch_error(
                            &mut fetched_items,
                            item,
                            "Claude Code",
                            e,
                        );
                    }
                    None => {
                        push_prefetch_missing_item(&mut fetched_items, item, "claude-code");
                    }
                }
            }
        } else if item.provider == "manual" {
            let mut resolved_item = item.clone();
            resolved_item.error_msg = None;
            resolved_item.last_update = Some(chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string());
            fetched_items.push(resolved_item);
        } else {
            let mut resolved_item = item.clone();
            let url = match &resolved_item.api_url {
                Some(u) => {
                    let trimmed = u.trim();
                    if trimmed.is_empty() {
                        "".to_string()
                    } else {
                        trimmed.to_string()
                    }
                }
                None => "".to_string(),
            };

            if url.is_empty() {
                log::error!("Failed to fetch custom quota '{}': API URL is empty", resolved_item.name);
                resolved_item.error_msg = Some("API URL is empty".into());
                resolved_item.last_update = Some(chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string());
                fetched_items.push(resolved_item);
                continue;
            }

            let mut req = client.get(&url);
            if !resolved_item.api_key.is_empty() {
                req = req.header("Authorization", format!("Bearer {}", resolved_item.api_key));
            }

            let provider_name = resolved_item.name.clone();

            let res = match req.send().await {
                Ok(r) => r,
                Err(e) => {
                    let err = format!("Network error: {}", e);
                    apply_custom_quota_fetch_error(&mut resolved_item, item, &provider_name, &err);
                    fetched_items.push(resolved_item);
                    continue;
                }
            };

            if !res.status().is_success() {
                let status = res.status();
                let err = if is_http_status_retriable(status) {
                    format!("HTTP server error: {}", status)
                } else {
                    format!("HTTP error status: {}", status)
                };
                apply_custom_quota_fetch_error(&mut resolved_item, item, &provider_name, &err);
                fetched_items.push(resolved_item);
                continue;
            }

            let text = match res.text().await {
                Ok(t) => t,
                Err(e) => {
                    let err = format!("Failed to retrieve response body: {}", e);
                    apply_custom_quota_fetch_error(&mut resolved_item, item, &provider_name, &err);
                    fetched_items.push(resolved_item);
                    continue;
                }
            };

            let json_val: Value = match serde_json::from_str(&text) {
                Ok(v) => v,
                Err(_) => {
                    if let Ok(num) = text.trim().parse::<f64>() {
                        resolved_item.current_value = Some(num);
                        resolved_item.error_msg = None;
                    } else {
                        log::error!("Response for custom quota provider '{}' is not valid JSON", resolved_item.name);
                        resolved_item.error_msg = Some("Response is not valid JSON".into());
                    }
                    resolved_item.last_update = Some(chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string());
                    fetched_items.push(resolved_item);
                    continue;
                }
            };

            let extracted_val = if let Some(path) = &resolved_item.json_path {
                if path.trim().is_empty() {
                    Some(json_val.clone())
                } else {
                    get_json_value_by_path(&json_val, path.trim())
                }
            } else {
                Some(json_val.clone())
            };

            match extracted_val {
                Some(v) => {
                    let parsed_num = if v.is_number() {
                        v.as_f64()
                    } else if v.is_string() {
                        v.as_str().and_then(|s| s.trim().parse::<f64>().ok())
                    } else {
                        None
                    };

                    if let Some(num) = parsed_num {
                        resolved_item.current_value = Some(num);
                        resolved_item.error_msg = None;
                    } else {
                        log::error!("Extracted value is not numeric for custom quota provider '{}': {}", resolved_item.name, v);
                        resolved_item.error_msg = Some(format!("Extracted value is not numeric: {}", v));
                    }
                }
                None => {
                    log::error!("Could not find path '{}' in JSON response for custom quota provider '{}'", resolved_item.json_path.as_deref().unwrap_or(""), resolved_item.name);
                    resolved_item.error_msg = Some("Could not find the specified path in JSON response".into());
                }
            }

            resolved_item.last_update = Some(chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string());
            fetched_items.push(resolved_item);
        }
    }

    dedupe_quota_fetch_results(&mut fetched_items);

    reconcile_missing_quota_items(&mut fetched_items, &config.items);

    for item in &mut fetched_items {
        if let Some(source) = source_items.get(&item.id) {
            merge_quota_item_config(item, source);
        }
    }

    let previous = state
        .quota_data
        .lock()
        .ok()
        .map(|items| items.clone());

    let ordered_items = order_quota_items_by_config(&fetched_items, &config);

    {
        if let Ok(mut state_quota) = state.quota_data.lock() {
            *state_quota = ordered_items.clone();
        }
    }

    let should_emit = previous
        .as_ref()
        .map(|prev| !quota_items_display_equal(prev, &ordered_items))
        .unwrap_or(true);
    if should_emit {
        let _ = app.emit("quota_update", &ordered_items);
    }

    if let Err(e) = persist_quota_fetch_results(app, &fetched_items) {
        log::warn!("Failed to persist quota fetch results: {}", e);
    }

    Ok(ordered_items)
}

fn push_prefetch_missing_item(fetched_items: &mut Vec<QuotaItem>, item: &QuotaItem, provider: &str) {
    log::error!(
        "Prefetch result missing for {} quota item '{}'",
        provider,
        item.id
    );
    fetched_items.push(build_quota_fetch_error_item(
        item,
        "Quota fetch did not complete. Retaining last known values.",
    ));
}

fn reconcile_missing_quota_items(fetched_items: &mut Vec<QuotaItem>, config_items: &[QuotaItem]) {
    let fetched_ids: std::collections::HashSet<String> =
        fetched_items.iter().map(|item| item.id.clone()).collect();
    for item in config_items {
        if fetched_ids.contains(&item.id) {
            continue;
        }
        log::warn!(
            "Quota item '{}' missing from fetch results, retaining config snapshot",
            item.id
        );
        fetched_items.push(item.clone());
    }
}

fn dedupe_quota_fetch_results(items: &mut Vec<QuotaItem>) {
    let mut seen = std::collections::HashSet::new();
    items.retain(|item| seen.insert(item.id.clone()));
}

/// Return quota display data in config item order, dropping orphaned entries.
pub fn order_quota_items_by_config(fetched: &[QuotaItem], config: &QuotaConfig) -> Vec<QuotaItem> {
    let by_id: std::collections::HashMap<&str, &QuotaItem> =
        fetched.iter().map(|item| (item.id.as_str(), item)).collect();
    config
        .items
        .iter()
        .filter_map(|cfg| by_id.get(cfg.id.as_str()).map(|item| (*item).clone()))
        .collect()
}

/// Write fetched display fields back to quota_config.json so restarts show fresh data.
fn persist_quota_fetch_results(app: &AppHandle, fetched: &[QuotaItem]) -> Result<(), String> {
    let mut config = read_quota_config(app);
    let fetched_by_id: std::collections::HashMap<&str, &QuotaItem> =
        fetched.iter().map(|item| (item.id.as_str(), item)).collect();

    let mut changed = false;
    for item in &mut config.items {
        let Some(fetched_item) = fetched_by_id.get(item.id.as_str()) else {
            continue;
        };

        let before = item.clone();
        apply_fetched_quota_fields(item, fetched_item);
        if item.provider == "antigravity" {
            group_antigravity_bars(item);
        }
        if quota_config_display_changed(&before, item) {
            changed = true;
        }
    }

    if changed {
        write_quota_config(app, &config)?;
    }
    Ok(())
}

fn quota_config_display_changed(before: &QuotaItem, after: &QuotaItem) -> bool {
    before.current_value != after.current_value
        || before.error_msg != after.error_msg
        || before.last_update != after.last_update
        || before.unit != after.unit
        || before.max_quota != after.max_quota
        || before.account_label != after.account_label
        || before.bars != after.bars
        || before.plan_type != after.plan_type
        || before.primary_name != after.primary_name
        || before.primary_reset != after.primary_reset
        || before.secondary_value != after.secondary_value
        || before.secondary_name != after.secondary_name
        || before.secondary_reset != after.secondary_reset
        || before.tertiary_value != after.tertiary_value
        || before.tertiary_name != after.tertiary_name
        || before.tertiary_reset != after.tertiary_reset
}

fn apply_fetched_quota_fields(target: &mut QuotaItem, fetched: &QuotaItem) {
    target.error_msg = fetched.error_msg.clone();
    target.last_update = fetched.last_update.clone();

    let has_fresh_data = fetched.current_value.is_some()
        || fetched.bars.as_ref().is_some_and(|bars| !bars.is_empty())
        || fetched.error_msg.is_none();

    if !has_fresh_data {
        return;
    }

    target.current_value = fetched.current_value;
    target.account_label = fetched.account_label.clone();
    target.primary_name = fetched.primary_name.clone();
    target.primary_reset = fetched.primary_reset.clone();
    target.secondary_value = fetched.secondary_value;
    target.secondary_name = fetched.secondary_name.clone();
    target.secondary_reset = fetched.secondary_reset.clone();
    target.tertiary_value = fetched.tertiary_value;
    target.tertiary_name = fetched.tertiary_name.clone();
    target.tertiary_reset = fetched.tertiary_reset.clone();
    target.bars = fetched.bars.clone();
    target.plan_type = fetched.plan_type.clone();

    let auto_fetched = matches!(
        fetched.provider.as_str(),
        "pioneer" | "qoder-cn" | "claude-code" | "codex" | "cursor" | "antigravity" | "copilot"
    );
    if auto_fetched {
        target.unit = fetched.unit.clone();
        target.max_quota = fetched.max_quota;
    }
}

/// Keep user-editable config (API keys, URLs, etc.) when persisting fetch results.
fn merge_quota_item_config(fetched: &mut QuotaItem, source: &QuotaItem) {
    if !source.provider.is_empty() {
        fetched.provider = source.provider.clone();
    }
    if !source.api_key.is_empty() {
        fetched.api_key = source.api_key.clone();
    }
    if source.encrypted_api_key.is_some() {
        fetched.encrypted_api_key = source.encrypted_api_key.clone();
    }
    if source.auth_mode.is_some() {
        fetched.auth_mode = source.auth_mode.clone();
    }
    if source.api_url.is_some() {
        fetched.api_url = source.api_url.clone();
    }
    if source.json_path.is_some() {
        fetched.json_path = source.json_path.clone();
    }
    if !source.name.is_empty() {
        fetched.name = source.name.clone();
    }
    // Keep fetched display fields (unit, quota values) for auto-fetched providers.
    let auto_fetched = matches!(
        fetched.provider.as_str(),
        "pioneer" | "qoder-cn" | "claude-code" | "codex" | "cursor" | "antigravity" | "copilot"
    );
    if !auto_fetched {
        if source.max_quota.is_some() {
            fetched.max_quota = source.max_quota;
        }
        if source.unit.is_some() {
            fetched.unit = source.unit.clone();
        }
    }
}

fn is_fetch_config_different(a: &QuotaConfig, b: &QuotaConfig) -> bool {
    let map_a: std::collections::HashMap<&str, &QuotaItem> = a.items.iter().map(|item| (item.id.as_str(), item)).collect();
    let map_b: std::collections::HashMap<&str, &QuotaItem> = b.items.iter().map(|item| (item.id.as_str(), item)).collect();

    if map_a.len() != map_b.len() {
        return true;
    }

    for (id, item_a) in &map_a {
        match map_b.get(id) {
            Some(item_b) => {
                if item_a.provider != item_b.provider
                    || item_a.auth_mode != item_b.auth_mode
                    || item_a.api_key != item_b.api_key
                    || item_a.encrypted_api_key != item_b.encrypted_api_key
                    || item_a.api_url != item_b.api_url
                    || item_a.json_path != item_b.json_path
                {
                    return true;
                }
            }
            None => return true,
        }
    }
    false
}

/// Polling monitor thread for quota items
pub async fn start_quota_monitor(app: AppHandle, state: std::sync::Arc<GlobalState>) {
    // Emit cached data to any widgets already listening (state was pre-loaded in setup)
    {
        let quota_config = read_quota_config(&app);
        if let Ok(qd) = state.quota_data.lock() {
            let ordered = order_quota_items_by_config(&qd, &quota_config);
            if !ordered.is_empty() {
                let _ = app.emit("quota_update", &ordered);
            }
        }
    }

    // Startup delay to let frontend initialize cleanly
    tokio::time::sleep(Duration::from_secs(10)).await;

    let mut consecutive_failures = 0u32;

    loop {
        let app_config = config_store::read_config::<AppConfig>(&app, "app_config.json");
        let quota_config = read_quota_config(&app);
        let interval = quota_config.update_interval.unwrap_or(300).max(60);

        if !app_config.quota_enabled.unwrap_or(true) {
            // Clear current list if disabled
            if let Ok(mut state_quota) = state.quota_data.lock() {
                if !state_quota.is_empty() {
                    state_quota.clear();
                    let _ = app.emit("quota_update", Vec::<QuotaItem>::new());
                }
            }

            // Sleep and wait for it to be re-enabled
            for _ in 0..interval {
                let ac = config_store::read_config::<AppConfig>(&app, "app_config.json");
                if ac.quota_enabled.unwrap_or(true) {
                    break;
                }
                tokio::time::sleep(Duration::from_secs(1)).await;
            }
            continue;
        }

        match perform_quota_fetch(&app, &state).await {
            Ok(items) => {
                if quota_cycle_all_hard_failed(&quota_config, &items) {
                    consecutive_failures = consecutive_failures.saturating_add(1);
                    let backoff_secs =
                        (60u64 * u64::from(consecutive_failures.min(5))).min(300);
                    log::warn!(
                        "All quota providers failed hard (attempt {}). Backing off {}s.",
                        consecutive_failures,
                        backoff_secs
                    );
                    emit_quota_monitor_status(
                        &app,
                        QuotaMonitorStatus {
                            consecutive_failures,
                            backoff_secs,
                            all_hard_failed: true,
                            last_error: None,
                        },
                    );
                    tokio::time::sleep(Duration::from_secs(backoff_secs)).await;
                } else {
                    if consecutive_failures > 0 {
                        emit_quota_monitor_status(
                            &app,
                            QuotaMonitorStatus {
                                consecutive_failures: 0,
                                backoff_secs: 0,
                                all_hard_failed: false,
                                last_error: None,
                            },
                        );
                    }
                    consecutive_failures = 0;
                }
            }
            Err(e) => {
                consecutive_failures = consecutive_failures.saturating_add(1);
                let backoff_secs = (60u64 * u64::from(consecutive_failures.min(5))).min(300);
                log::error!(
                    "Error updating Quota (attempt {}): {}. Retrying in {}s.",
                    consecutive_failures,
                    e,
                    backoff_secs
                );
                emit_quota_monitor_status(
                    &app,
                    QuotaMonitorStatus {
                        consecutive_failures,
                        backoff_secs,
                        all_hard_failed: false,
                        last_error: Some(e.clone()),
                    },
                );
                if let Ok(qd) = state.quota_data.lock() {
                    let ordered = order_quota_items_by_config(&qd, &quota_config);
                    if !ordered.is_empty() {
                        let _ = app.emit("quota_update", &ordered);
                    }
                }
                tokio::time::sleep(Duration::from_secs(backoff_secs)).await;
                continue;
            }
        }

        // Wait for interval, break early if config changes
        let last_config = read_quota_config(&app);
        let check_interval = 30;
        let loops = interval / check_interval;
        for _ in 0..loops.max(1) {
            tokio::time::sleep(Duration::from_secs(check_interval)).await;
            let ac = config_store::read_config::<AppConfig>(&app, "app_config.json");
            if !ac.quota_enabled.unwrap_or(true) {
                break;
            }

            let current_config = read_quota_config(&app);
            if is_fetch_config_different(&last_config, &current_config) {
                break;
            }
        }
    }
}
