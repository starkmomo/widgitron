use chrono::{DateTime, Utc};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

use crate::config_store;
use crate::models::{AppConfig, GlobalState, PaperConfig, PaperDeadlineInfo, YamlConfItem};

const DEADLINES_CACHE_FILE: &str = "paper_deadlines_cache.json";
// The old GitHub Pages URL redirects through HTTP. Use the current HTTPS
// endpoint, with the same published YAML on GitHub as a fallback.
const DEADLINE_SOURCES: &[&str] = &[
    "https://ccfddl.com/conference/allconf.yml",
    "https://raw.githubusercontent.com/ccfddl/ccfddl.github.io/page/conference/allconf.yml",
];

fn deadline_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| format!("Could not initialize deadline request: {error}"))
}

fn request_error(error: reqwest::Error) -> String {
    // reqwest's Display only says "error decoding response body" for a body
    // timeout. Include the cause so the log explains the actual failure.
    let mut message = error.to_string();
    let mut source = std::error::Error::source(&error);
    while let Some(cause) = source {
        message.push_str(": ");
        message.push_str(&cause.to_string());
        source = cause.source();
    }
    message
}

async fn fetch_deadline_yaml(client: &reqwest::Client, sources: &[&str]) -> Result<String, String> {
    let mut failures = Vec::new();
    for url in sources {
        let result = async {
            let response = client.get(*url).send().await.map_err(request_error)?;
            let response = response.error_for_status().map_err(request_error)?;
            let text = response.text().await.map_err(request_error)?;
            let checked = tokio::task::spawn_blocking(move || {
                // Reject HTML, truncated YAML, and other invalid payloads before
                // retaining a response for later settings changes.
                let items: Vec<YamlConfItem> = serde_yaml::from_str(&text)
                    .map_err(|error| format!("Invalid deadline data: {error}"))?;
                if items.is_empty() {
                    return Err("The deadline source returned no conference data".to_string());
                }
                Ok(text)
            })
            .await
            .map_err(|error| format!("Deadline validation task failed: {error}"))??;
            Ok::<_, String>(checked)
        }
        .await;
        match result {
            Ok(text) => {
                log::info!(
                    "Fetched Paper Deadlines YAML from {url} ({} bytes)",
                    text.len()
                );
                return Ok(text);
            }
            Err(error) => {
                log::warn!("Deadline source {url} failed: {error}");
                failures.push(format!("{url}: {error}"));
            }
        }
    }
    Err(format!(
        "Could not fetch deadline data. {}",
        failures.join("; ")
    ))
}

fn load_deadlines_cache(app: &AppHandle) -> Vec<PaperDeadlineInfo> {
    config_store::read_config::<Vec<PaperDeadlineInfo>>(app, DEADLINES_CACHE_FILE)
}

fn persist_deadlines_cache(app: &AppHandle, deadlines: &Vec<PaperDeadlineInfo>) {
    if let Err(e) = config_store::write_config(app, DEADLINES_CACHE_FILE, deadlines) {
        log::warn!("Failed to persist paper deadlines cache: {}", e);
    }
}

fn normalize_paper_config(config: &mut PaperConfig) {
    if let Some(subs) = config.filter_by_sub.as_mut() {
        for sub in subs.iter_mut() {
            if sub == "DM" {
                *sub = "DB".to_string();
            }
        }
        let mut seen = Vec::new();
        subs.retain(|sub| {
            if seen.contains(sub) {
                false
            } else {
                seen.push(sub.clone());
                true
            }
        });
    }
}

fn normalize_title(title: &str) -> String {
    title.trim().to_lowercase()
}

fn is_subscribed_title(title: &str, config: &PaperConfig) -> bool {
    let normalized = normalize_title(title);
    config.subscribed_titles.as_ref().is_some_and(|titles| {
        titles
            .iter()
            .any(|item| normalize_title(item) == normalized)
    })
}

fn restore_and_emit_cached_deadlines(app: &AppHandle, state: &Arc<GlobalState>, error: &str) {
    let _ = app.emit("paper_error", error.to_string());

    let cached = if let Ok(state_deadlines) = state.deadlines.lock() {
        if !state_deadlines.is_empty() {
            state_deadlines.clone()
        } else {
            load_deadlines_cache(app)
        }
    } else {
        load_deadlines_cache(app)
    };

    if cached.is_empty() {
        return;
    }

    if let Ok(mut state_deadlines) = state.deadlines.lock() {
        if state_deadlines.is_empty() {
            *state_deadlines = cached.clone();
        }
    }
    let _ = app.emit("paper_update", &cached);
}

pub fn hydrate_deadlines_from_cache(
    app: &AppHandle,
    state: &GlobalState,
) -> Vec<PaperDeadlineInfo> {
    let cached = load_deadlines_cache(app);
    if cached.is_empty() {
        return Vec::new();
    }
    if let Ok(mut state_deadlines) = state.deadlines.lock() {
        if state_deadlines.is_empty() {
            *state_deadlines = cached.clone();
        }
        state_deadlines.clone()
    } else {
        cached
    }
}

pub fn build_deadlines_from_yaml(
    text: &str,
    config: &PaperConfig,
) -> Result<Vec<PaperDeadlineInfo>, String> {
    let items: Vec<YamlConfItem> =
        serde_yaml::from_str(text).map_err(|e| format!("Failed to parse deadline data: {}", e))?;
    let mut config = config.clone();
    normalize_paper_config(&mut config);
    let mut deadlines = Vec::new();
    let now = Utc::now();

    for item in items {
        let title = item.title.clone();
        let subscribed = is_subscribed_title(&title, &config);
        let ccf_rank = item.rank.as_ref().and_then(|r| r.ccf.clone());
        let core_rank = item.rank.as_ref().and_then(|r| r.core.clone());
        let rank = ccf_rank.clone().unwrap_or_else(|| "N".to_string());
        let core_val = core_rank.clone().unwrap_or_else(|| "N".to_string());
        let sub = item.sub.unwrap_or_else(|| "Unknown".to_string());

        let has_ccf_filter = config
            .filter_by_rank
            .as_ref()
            .map_or(false, |v| !v.is_empty());
        let has_core_filter = config
            .filter_by_core
            .as_ref()
            .map_or(false, |v| !v.is_empty());

        let matches_ccf = !has_ccf_filter
            || config
                .filter_by_rank
                .as_ref()
                .is_some_and(|ranks| ranks.contains(&rank));
        let matches_core = !has_core_filter
            || config
                .filter_by_core
                .as_ref()
                .is_some_and(|cores| cores.contains(&core_val));

        let keep = match (has_ccf_filter, has_core_filter) {
            (true, true) => matches_ccf || matches_core,
            (true, false) => matches_ccf,
            (false, true) => matches_core,
            (false, false) => true,
        };

        if !subscribed && !keep {
            continue;
        }

        if !subscribed {
            if let Some(allowed) = &config.filter_by_sub {
                if !allowed.is_empty() && !allowed.contains(&sub) {
                    continue;
                }
            }
        }

        if let Some(confs) = item.confs {
            for conf in confs {
                if let Some(timeline) = conf.timeline {
                    for t in timeline {
                        if let Some(dl) = t.deadline {
                            if dl == "TBD" {
                                continue;
                            }

                            let mut dt_str = dl.clone();
                            if dt_str.len() == 10 {
                                dt_str.push_str("T23:59:59Z");
                            } else if !dt_str.ends_with('Z') && !dt_str.contains('+') {
                                dt_str.push_str("Z");
                            }
                            dt_str = dt_str.replace(" ", "T");

                            if let Ok(parsed) = DateTime::parse_from_rfc3339(&dt_str) {
                                let utc_dt = parsed.with_timezone(&Utc);
                                if utc_dt >= now {
                                    deadlines.push(PaperDeadlineInfo {
                                        title: title.clone(),
                                        year: conf.year.clone(),
                                        deadline_utc: utc_dt.to_rfc3339(),
                                        timezone: conf
                                            .timezone
                                            .clone()
                                            .unwrap_or_else(|| "UTC".into()),
                                        rank: rank.clone(),
                                        sub: sub.clone(),
                                        place: conf.place.clone().unwrap_or_default(),
                                        link: conf.link.clone().unwrap_or_default(),
                                        ccf: ccf_rank.clone(),
                                        core: core_rank.clone(),
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    deadlines.sort_by(|a, b| a.deadline_utc.cmp(&b.deadline_utc));
    Ok(deadlines)
}

pub fn apply_deadline_fetch_success(
    app: &AppHandle,
    state: &GlobalState,
    deadlines: Vec<PaperDeadlineInfo>,
) {
    if let Ok(mut state_deadlines) = state.deadlines.lock() {
        *state_deadlines = deadlines.clone();
    }
    persist_deadlines_cache(app, &deadlines);
    #[cfg(target_os = "macos")]
    {
        let config = config_store::read_config::<PaperConfig>(app, "paper_deadline.json");
        if let Err(error) =
            crate::macos_widget_snapshot::publish_deadline_snapshot(app, &config, &deadlines)
        {
            log::warn!("Failed to publish macOS deadline widget snapshot: {error}");
        }
    }
    let _ = app.emit("paper_update", &deadlines);
    let _ = app.emit("paper_error", "");
}

pub async fn fetch_and_update_paper_deadlines(
    app: &AppHandle,
    state: &GlobalState,
) -> Result<Vec<PaperDeadlineInfo>, String> {
    fetch_and_update_with_client(app, state, &deadline_client()?).await
}

async fn fetch_and_update_with_client(
    app: &AppHandle,
    state: &GlobalState,
    client: &reqwest::Client,
) -> Result<Vec<PaperDeadlineInfo>, String> {
    let text = fetch_deadline_yaml(client, DEADLINE_SOURCES).await?;
    // Read the current selection after the request completes, so changes made
    // while refreshing are reflected in the resulting list and widget snapshot.
    let config = config_store::read_config::<PaperConfig>(app, "paper_deadline.json");
    let text_to_parse = text.clone();
    let deadlines =
        tokio::task::spawn_blocking(move || build_deadlines_from_yaml(&text_to_parse, &config))
            .await
            .map_err(|error| format!("Deadline parse task failed: {error}"))??;
    if let Ok(mut last) = state.last_yaml.lock() {
        *last = Some(text);
    }
    apply_deadline_fetch_success(app, state, deadlines.clone());
    Ok(deadlines)
}

// --- Paper Deadline Polling Task ---
pub async fn start_paper_monitor(app: AppHandle, state: Arc<GlobalState>) {
    let client = match deadline_client() {
        Ok(client) => client,
        Err(error) => {
            restore_and_emit_cached_deadlines(&app, &state, &error);
            return;
        }
    };

    // Populate state from disk cache on startup
    {
        let cached = hydrate_deadlines_from_cache(&app, &state);
        if !cached.is_empty() {
            let _ = app.emit("paper_update", &cached);
            log::info!("Loaded {} paper deadlines from cache", cached.len());
        }
    }

    // Startup delay to let frontend initialize cleanly
    tokio::time::sleep(Duration::from_secs(6)).await;

    let mut backoff_secs = 60u64;
    let mut is_startup = true;

    loop {
        let app_config = config_store::read_config::<AppConfig>(&app, "app_config.json");

        if !app_config.deadline_enabled.unwrap_or(true) {
            if let Ok(mut state_deadlines) = state.deadlines.lock() {
                state_deadlines.clear();
            }
            let _ = config_store::write_config(
                &app,
                DEADLINES_CACHE_FILE,
                &Vec::<PaperDeadlineInfo>::new(),
            );
            let _ = app.emit("paper_update", Vec::<PaperDeadlineInfo>::new());
            let _ = app.emit("paper_error", "");
            tokio::time::sleep(Duration::from_secs(5)).await;
            continue;
        }

        let config = config_store::read_config::<PaperConfig>(&app, "paper_deadline.json");

        let mut skip_fetch = false;
        if is_startup {
            is_startup = false;
            let cache_path = crate::utils::get_config_path(&app, DEADLINES_CACHE_FILE);
            if let Ok(metadata) = std::fs::metadata(&cache_path) {
                if let Ok(modified) = metadata.modified() {
                    if let Ok(elapsed) = modified.elapsed() {
                        if elapsed < Duration::from_secs(1800) {
                            let cached = hydrate_deadlines_from_cache(&app, &state);
                            if !cached.is_empty() {
                                skip_fetch = true;
                                log::info!(
                                    "Paper deadlines cache is fresh (< 30m, {} items). Skipping initial fetch on startup.",
                                    cached.len()
                                );
                            }
                        }
                    }
                }
            }
        }

        if skip_fetch {
            let interval = config.update_interval.unwrap_or(3600);
            let check_interval = 5;
            let loops = interval / check_interval;
            for _ in 0..loops {
                tokio::time::sleep(Duration::from_secs(check_interval)).await;
                let ac = config_store::read_config::<AppConfig>(&app, "app_config.json");
                if !ac.deadline_enabled.unwrap_or(true) {
                    break;
                }
            }
            continue;
        }

        match fetch_and_update_with_client(&app, state.as_ref(), &client).await {
            Ok(_) => backoff_secs = 60,
            Err(error) => {
                log::error!("Error fetching paper deadlines: {error}");
                restore_and_emit_cached_deadlines(&app, &state, &error);
                tokio::time::sleep(Duration::from_secs(backoff_secs)).await;
                backoff_secs = (backoff_secs * 2).min(900);
                continue;
            }
        }

        let interval = config.update_interval.unwrap_or(3600);
        let check_interval = 5;
        let loops = interval / check_interval;
        for _ in 0..loops {
            tokio::time::sleep(Duration::from_secs(check_interval)).await;
            let ac = config_store::read_config::<AppConfig>(&app, "app_config.json");
            if !ac.deadline_enabled.unwrap_or(true) {
                break;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    const YAML: &str = "- title: Example\n  confs:\n  - year: '2100'\n    timeline:\n    - deadline: '2100-10-10 23:59:59'\n";
    const GZIP_YAML: &[u8] = &[
        31, 139, 8, 0, 0, 0, 0, 0, 2, 255, 211, 85, 40, 201, 44, 201, 73, 181, 82, 112, 173, 72,
        204, 45, 200, 73, 229, 82, 80, 72, 206, 207, 75, 43, 182, 2, 50, 116, 21, 42, 83, 19, 139,
        172, 20, 212, 141, 12, 13, 12, 212, 129, 2, 10, 64, 197, 185, 169, 57, 153, 121, 169, 86,
        96, 158, 174, 66, 74, 106, 98, 10, 152, 15, 81, 164, 107, 8, 66, 10, 70, 198, 86, 166, 150,
        64, 164, 206, 5, 0, 156, 225, 138, 230, 95, 0, 0, 0,
    ];

    async fn source(body: &[u8], gzip: bool, truncated: bool) -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let body = body.to_vec();
        tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = [0_u8; 4096];
            stream.read(&mut request).await.unwrap();
            let encoding = if gzip {
                "Content-Encoding: gzip\r\n"
            } else {
                ""
            };
            let length = body.len() + if truncated { 100 } else { 0 };
            let header = format!("HTTP/1.1 200 OK\r\nContent-Type: text/yaml\r\n{encoding}Content-Length: {length}\r\nConnection: close\r\n\r\n");
            stream.write_all(header.as_bytes()).await.unwrap();
            stream.write_all(&body).await.unwrap();
            stream.shutdown().await.unwrap();
        });
        format!("http://{address}/allconf.yml")
    }

    #[tokio::test]
    async fn decodes_gzip_deadlines() {
        let url = source(GZIP_YAML, true, false).await;
        let text = fetch_deadline_yaml(&deadline_client().unwrap(), &[&url])
            .await
            .unwrap();
        assert_eq!(text, YAML);
        let config = PaperConfig {
            filter_by_rank: None,
            filter_by_core: None,
            ..PaperConfig::default()
        };
        assert_eq!(build_deadlines_from_yaml(&text, &config).unwrap().len(), 1);
    }

    #[tokio::test]
    async fn incomplete_response_uses_backup() {
        let broken = source(b"- title:", false, true).await;
        let backup = source(YAML.as_bytes(), false, false).await;
        let text = fetch_deadline_yaml(&deadline_client().unwrap(), &[&broken, &backup])
            .await
            .unwrap();
        assert_eq!(text, YAML);
    }

    #[tokio::test]
    async fn invalid_payload_uses_backup_and_all_failures_return_error() {
        let invalid = source(b"<html>unavailable</html>", false, false).await;
        let backup = source(YAML.as_bytes(), false, false).await;
        assert_eq!(
            fetch_deadline_yaml(&deadline_client().unwrap(), &[&invalid, &backup])
                .await
                .unwrap(),
            YAML
        );
        let empty = source(b"[]", false, false).await;
        assert!(fetch_deadline_yaml(&deadline_client().unwrap(), &[&empty])
            .await
            .unwrap_err()
            .contains("no conference data"));
    }

    #[tokio::test]
    #[ignore = "requests the live public deadline sources"]
    async fn live_deadline_sources_are_readable() {
        let client = deadline_client().unwrap();
        for url in DEADLINE_SOURCES {
            let text = fetch_deadline_yaml(&client, &[*url]).await.unwrap();
            let deadlines = build_deadlines_from_yaml(&text, &PaperConfig::default()).unwrap();
            assert!(!deadlines.is_empty());
            println!(
                "{url}: {} bytes, {} upcoming deadlines",
                text.len(),
                deadlines.len()
            );
        }
    }
}
