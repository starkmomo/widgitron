use std::time::Duration;
use tauri::{AppHandle, Emitter};
use serde_json::Value;
use std::path::{Path, PathBuf};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

use crate::models::{AppConfig, QuotaBar, QuotaConfig, QuotaItem, GlobalState};
use crate::config_store;
use crate::vscode_secrets;

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

/// Discover the Antigravity language server process, extract CSRF token and listening ports.
/// Returns (csrf_token, Vec<port>) or an error.
fn discover_ag_language_server() -> Result<(String, Vec<u16>), String> {
    // Platform-specific process name
    #[cfg(target_os = "windows")]
    let proc_name_pattern = "language_server_windows";
    #[cfg(target_os = "macos")]
    let proc_name_pattern = "language_server_macos";
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let proc_name_pattern = "language_server_linux";

    // Get CSRF token and PID from process command line
    #[cfg(target_os = "windows")]
    let output = std::process::Command::new("powershell")
        .args(["-Command",
            &format!(
                "Get-CimInstance Win32_Process | Where-Object {{ $_.Name -like '*{}*' }} | Select-Object ProcessId, CommandLine | ConvertTo-Json",
                proc_name_pattern
            )
        ])
        .creation_flags(0x08000000) // CREATE_NO_WINDOW
        .output()
        .map_err(|e| format!("Failed to query processes: {}", e))?;

    #[cfg(not(target_os = "windows"))]
    let output = std::process::Command::new("sh")
        .args(["-c", &format!("ps aux | grep '{}' | grep -v grep", proc_name_pattern)])
        .output()
        .map_err(|e| format!("Failed to query processes: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    if stdout.trim().is_empty() {
        return Err("Antigravity language server not running. Please open Antigravity IDE.".to_string());
    }

    // Extract CSRF token
    let csrf_token = if let Some(pos) = stdout.find("--csrf_token") {
        let rest = &stdout[pos + "--csrf_token".len()..].trim_start_matches([' ', '=']);
        rest.split_whitespace().next()
            .map(|s| s.trim_matches('"').to_string())
            .ok_or_else(|| "Could not parse CSRF token".to_string())?
    } else {
        return Err("No CSRF token found in language server process args. Is Antigravity IDE running?".to_string());
    };

    // Extract PID
    #[cfg(target_os = "windows")]
    let pid = {
        let json: serde_json::Value = serde_json::from_str(&stdout)
            .unwrap_or(serde_json::Value::Null);
        // Could be array or single object
        let pid_val = if json.is_array() {
            json[0]["ProcessId"].as_u64()
        } else {
            json["ProcessId"].as_u64()
        };
        pid_val.ok_or_else(|| "Could not extract PID from process list".to_string())?
    };

    // Get listening ports for this PID
    #[cfg(target_os = "windows")]
    let ports_output = std::process::Command::new("powershell")
        .args(["-Command",
            &format!(
                "Get-NetTCPConnection -State Listen -OwningProcess {} | Select-Object -ExpandProperty LocalPort",
                pid
            )
        ])
        .creation_flags(0x08000000) // CREATE_NO_WINDOW
        .output()
        .map_err(|e| format!("Failed to query ports: {}", e))?;

    #[cfg(not(target_os = "windows"))]
    let ports_output = std::process::Command::new("sh")
        .args(["-c", &format!("lsof -iTCP -sTCP:LISTEN -p {} | awk '{{print $9}}' | grep -oE '[0-9]+$'", pid)])
        .output()
        .map_err(|e| format!("Failed to query ports: {}", e))?;

    let ports_str = String::from_utf8_lossy(&ports_output.stdout).to_string();
    let ports: Vec<u16> = ports_str
        .lines()
        .filter_map(|l| l.trim().parse::<u16>().ok())
        .collect();

    if ports.is_empty() {
        return Err("Language server found but no listening ports detected.".to_string());
    }

    Ok((csrf_token, ports))
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
async fn fetch_antigravity_quota(show_account_name: bool) -> Result<Vec<QuotaItem>, String> {
    match fetch_antigravity_via_language_server(show_account_name).await {
        Ok(items) => Ok(items),
        Err(ls_err) => match crate::antigravity::fetch_antigravity_via_cloud().await {
            Ok(snapshot) => build_antigravity_quota_items(snapshot, show_account_name),
            Err(cloud_err) => Err(format!(
                "Antigravity unavailable ({}). Cloud fallback failed: {}.",
                ls_err, cloud_err
            )),
        },
    }
}

async fn fetch_antigravity_via_language_server(
    show_account_name: bool,
) -> Result<Vec<QuotaItem>, String> {
    let (csrf_token, ports) = discover_ag_language_server()?;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .unwrap_or_default();

    let mut response_text: Option<String> = None;
    for port in &ports {
        let url = format!("http://127.0.0.1:{}/exa.language_server_pb.LanguageServerService/GetUserStatus", port);
        match client.post(&url)
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
                    _ => {}
                }
            }
            _ => {}
        }
    }

    let text = response_text.ok_or_else(|| "language server not running".to_string())?;

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

    build_antigravity_quota_items_from_configs(model_configs, user_status.email, show_account_name, tier_name)
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

fn get_codex_auth_path() -> Option<PathBuf> {
    let home = if cfg!(target_os = "windows") {
        std::env::var("USERPROFILE").ok()
    } else {
        std::env::var("HOME").ok()
    };
    home.map(|h| PathBuf::from(h).join(".codex").join("auth.json"))
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

/// Fetch Codex Pro rate limits from ChatGPT backend wham usage endpoint
async fn fetch_codex_quota(_show_account_name: bool) -> Result<QuotaItem, String> {
    let auth_path = get_codex_auth_path()
        .ok_or_else(|| "Could not resolve user home directory".to_string())?;

    if !auth_path.exists() {
        return Err("Codex credentials not found. Please log in to Codex extension.".to_string());
    }

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
        return Err(format!("Codex API error: HTTP Status {}", res.status()));
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
    entitlement: Option<f64>,
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
            last_err = format!("Copilot API error: HTTP Status {}", res.status());
            // Don't retry on HTTP errors, only on network errors
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
    let db_path = get_db_path("Cursor")
        .ok_or_else(|| "Could not resolve Cursor AppData path".to_string())?;
        
    if !db_path.exists() {
        return Err("Cursor state database not found. Please sign in.".to_string());
    }
    
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
        return Err(format!("Cursor API error: HTTP Status {}", res.status()));
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

/// Perform HTTP requests to update all non-manual quota monitors
pub async fn perform_quota_fetch(
    app: &AppHandle,
    state: &GlobalState,
) -> Result<Vec<QuotaItem>, String> {
    let mut config = config_store::read_config::<QuotaConfig>(app, "quota_config.json");
    let show_account_name = config.show_account_name.unwrap_or(false);

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .unwrap_or_default();

    let mut fetched_items = Vec::new();
    let mut antigravity_processed = false;
    let mut codex_processed = false;
    let mut cursor_processed = false;
    let mut copilot_processed = false;

    for item in &config.items {
        let provider = if item.provider == "openai-compatible" {
            if item.id.starts_with("antigravity") {
                "antigravity"
            } else if item.id.starts_with("codex") {
                "codex"
            } else if item.id.starts_with("cursor") {
                "cursor"
            } else if item.id.starts_with("copilot") {
                "copilot"
            } else {
                "openai-compatible"
            }
        } else {
            &item.provider
        };

        if provider == "antigravity" {
            if !antigravity_processed {
                antigravity_processed = true;
                match fetch_antigravity_quota(show_account_name).await {
                    Ok(mut items) => {
                        fetched_items.append(&mut items);
                    }
                    Err(e) => {
                        log::error!("Failed to fetch Antigravity quota: {}", e);
                        let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
                        fetched_items.push(QuotaItem {
                            id: "antigravity".to_string(),
                            name: "Antigravity".to_string(),
                            provider: "antigravity".to_string(),
                            api_key: "".to_string(),
                            api_url: None,
                            json_path: None,
                            max_quota: item.max_quota,
                            current_value: None,
                            error_msg: Some(e),
                            last_update: Some(now),
                            unit: item.unit.clone(),
                            ..Default::default()
                        });
                    }
                }
            }
        } else if provider == "codex" {
            if !codex_processed {
                codex_processed = true;
                match fetch_codex_quota(show_account_name).await {
                    Ok(resolved_item) => {
                        fetched_items.push(resolved_item);
                    }
                    Err(e) => {
                        log::error!("Failed to fetch Codex quota: {}", e);
                        let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
                        fetched_items.push(QuotaItem {
                            id: "codex".to_string(),
                            name: "Codex".to_string(),
                            provider: "codex".to_string(),
                            api_key: "".to_string(),
                            api_url: None,
                            json_path: None,
                            max_quota: item.max_quota,
                            current_value: None,
                            error_msg: Some(e),
                            last_update: Some(now),
                            unit: item.unit.clone(),
                            ..Default::default()
                        });
                    }
                }
            }
        } else if provider == "cursor" {
            if !cursor_processed {
                cursor_processed = true;
                match fetch_cursor_quota(show_account_name).await {
                    Ok(resolved_item) => {
                        fetched_items.push(resolved_item);
                    }
                    Err(e) => {
                        log::error!("Failed to fetch Cursor quota: {}", e);
                        let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
                        fetched_items.push(QuotaItem {
                            id: "cursor".to_string(),
                            name: "Cursor".to_string(),
                            provider: "cursor".to_string(),
                            api_key: "".to_string(),
                            api_url: None,
                            json_path: None,
                            max_quota: item.max_quota,
                            current_value: None,
                            error_msg: Some(e),
                            last_update: Some(now),
                            unit: item.unit.clone(),
                            ..Default::default()
                        });
                    }
                }
            }
        } else if provider == "copilot" {
            if !copilot_processed {
                copilot_processed = true;
                match fetch_copilot_quota(show_account_name, &item.api_key).await {
                    Ok(resolved_item) => {
                        fetched_items.push(resolved_item);
                    }
                    Err(e) => {
                        let is_network_error = e.contains("Network error") || e.contains("error sending request") || e.contains("timeout");
                        if is_network_error {
                            log::warn!("Copilot network error (retained): {}", e);
                            let mut retained_item = item.clone();
                            retained_item.error_msg = None;
                            fetched_items.push(retained_item);
                        } else {
                            log::error!("Failed to fetch Copilot quota: {}", e);
                            let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
                            fetched_items.push(QuotaItem {
                                id: "copilot".to_string(),
                                name: "Copilot".to_string(),
                                provider: "copilot".to_string(),
                                api_key: item.api_key.clone(),
                                api_url: None,
                                json_path: None,
                                max_quota: item.max_quota,
                                current_value: None,
                                error_msg: Some(e),
                                last_update: Some(now),
                                unit: item.unit.clone(),
                                ..Default::default()
                            });
                        }
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
                        if resolved_item.provider == "minimax-cn" {
                            "https://api.minimax.chat/v1/token_plan/remains".to_string()
                        } else if resolved_item.provider == "openai-compatible" {
                            "https://api.openai.com/v1/dashboard/billing/subscription".to_string()
                        } else {
                            "".to_string()
                        }
                    } else {
                        trimmed.to_string()
                    }
                }
                None => {
                    if resolved_item.provider == "minimax-cn" {
                        "https://api.minimax.chat/v1/token_plan/remains".to_string()
                    } else if resolved_item.provider == "openai-compatible" {
                        "https://api.openai.com/v1/dashboard/billing/subscription".to_string()
                    } else {
                        "".to_string()
                    }
                }
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

            let res = match req.send().await {
                Ok(r) => r,
                Err(e) => {
                    log::error!("Network error for custom quota provider '{}': {}", resolved_item.name, e);
                    resolved_item.error_msg = Some(format!("Network error: {}", e));
                    resolved_item.last_update = Some(chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string());
                    fetched_items.push(resolved_item);
                    continue;
                }
            };

            if !res.status().is_success() {
                log::error!("HTTP status error {} for custom quota provider '{}'", res.status(), resolved_item.name);
                resolved_item.error_msg = Some(format!("HTTP error status: {}", res.status()));
                resolved_item.last_update = Some(chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string());
                fetched_items.push(resolved_item);
                continue;
            }

            let text = match res.text().await {
                Ok(t) => t,
                Err(e) => {
                    log::error!("Failed to read response body for custom quota provider '{}': {}", resolved_item.name, e);
                    resolved_item.error_msg = Some(format!("Failed to retrieve response body: {}", e));
                    resolved_item.last_update = Some(chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string());
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
                    if resolved_item.provider == "minimax-cn" {
                        json_val.get("token_plan").and_then(|tp| tp.get("remains"))
                            .or_else(|| json_val.get("remains"))
                            .cloned()
                    } else if resolved_item.provider == "openai-compatible" {
                        json_val.get("hard_limit_usd")
                            .or_else(|| json_val.get("total_amount"))
                            .or_else(|| json_val.get("remains"))
                            .cloned()
                    } else {
                        Some(json_val.clone())
                    }
                } else {
                    get_json_value_by_path(&json_val, path.trim())
                }
            } else {
                if resolved_item.provider == "minimax-cn" {
                    json_val.get("token_plan").and_then(|tp| tp.get("remains"))
                        .or_else(|| json_val.get("remains"))
                        .cloned()
                } else if resolved_item.provider == "openai-compatible" {
                    json_val.get("hard_limit_usd")
                        .or_else(|| json_val.get("total_amount"))
                        .or_else(|| json_val.get("remains"))
                        .cloned()
                } else {
                    Some(json_val.clone())
                }
            };

            match extracted_val {
                Some(v) => {
                    let parsed_num = if v.is_number() {
                        v.as_f64()
                    } else if v.is_string() {
                        v.as_str().unwrap().trim().parse::<f64>().ok()
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

    config.items = fetched_items;
    // Save updated items back to quota_config.json
    let _ = config_store::write_config(app, "quota_config.json", &config);

    // Update GlobalState
    {
        if let Ok(mut state_quota) = state.quota_data.lock() {
            *state_quota = config.items.clone();
        }
    }

    // Emit event to frontend
    let _ = app.emit("quota_update", &config.items);

    Ok(config.items)
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
                    || item_a.api_key != item_b.api_key
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
        if let Ok(qd) = state.quota_data.lock() {
            if !qd.is_empty() {
                let _ = app.emit("quota_update", &*qd);
            }
        }
    }

    // Startup delay to let frontend initialize cleanly
    tokio::time::sleep(Duration::from_secs(2)).await;

    loop {
        let app_config = config_store::read_config::<AppConfig>(&app, "app_config.json");

        let interval = 30u64; // Fixed 30-second refresh interval

        if !app_config.quota_enabled.unwrap_or(true) {
            // Clear current list if disabled
            if let Ok(mut state_quota) = state.quota_data.lock() {
                state_quota.clear();
            }
            let _ = app.emit("quota_update", Vec::<QuotaItem>::new());

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

        if let Err(e) = perform_quota_fetch(&app, &state).await {
            log::error!("Error updating Quota: {}. Retrying in 60s.", e);
            tokio::time::sleep(Duration::from_secs(60)).await;
            continue;
        }

        // Wait for interval, break early if config changes
        let last_config = config_store::read_config::<QuotaConfig>(&app, "quota_config.json");
        let check_interval = 5;
        let loops = interval / check_interval;
        for _ in 0..loops {
            tokio::time::sleep(Duration::from_secs(check_interval)).await;
            let ac = config_store::read_config::<AppConfig>(&app, "app_config.json");
            if !ac.quota_enabled.unwrap_or(true) {
                break;
            }

            let current_config = config_store::read_config::<QuotaConfig>(&app, "quota_config.json");
            if is_fetch_config_different(&last_config, &current_config) {
                break;
            }
        }
    }
}
