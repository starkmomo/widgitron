use chrono::{DateTime, Utc};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

use crate::config_store;
use crate::models::{AppConfig, GlobalState, PaperConfig, PaperDeadlineInfo, YamlConfItem};

const DEADLINES_CACHE_FILE: &str = "paper_deadlines_cache.json";

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
        if let Err(error) = crate::macos_widget_snapshot::publish_deadline_snapshot(app, &config, &deadlines) {
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
    let config = config_store::read_config::<PaperConfig>(app, "paper_deadline.json");
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .unwrap_or_default();
    let url = "https://ccfddl.github.io/conference/allconf.yml";
    let res = client.get(url).send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!(
            "Paper deadline API returned HTTP status {}",
            res.status()
        ));
    }
    let text = res.text().await.map_err(|e| e.to_string())?;
    if let Ok(mut last) = state.last_yaml.lock() {
        *last = Some(text.clone());
    }
    let config_clone = config.clone();
    let deadlines =
        tokio::task::spawn_blocking(move || build_deadlines_from_yaml(&text, &config_clone))
            .await
            .map_err(|e| format!("Deadline parse task failed: {}", e))??;
    apply_deadline_fetch_success(app, state, deadlines.clone());
    Ok(deadlines)
}

pub fn process_deadlines(
    app: AppHandle,
    state: Arc<GlobalState>,
    config: PaperConfig,
    text: String,
) {
    let app_inner = app.clone();
    let config_inner = config.clone();
    let state_inner = state.clone();

    // Offload heavy YAML parsing and processing to blocking thread
    tokio::task::spawn_blocking(
        move || match build_deadlines_from_yaml(&text, &config_inner) {
            Ok(deadlines) => {
                apply_deadline_fetch_success(&app_inner, state_inner.as_ref(), deadlines);
            }
            Err(e) => {
                log::error!("Error parsing Paper Deadlines YAML: {}", e);
                restore_and_emit_cached_deadlines(&app_inner, &state_inner, &e);
            }
        },
    );
}

// --- Paper Deadline Polling Task ---
pub async fn start_paper_monitor(app: AppHandle, state: Arc<GlobalState>) {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .unwrap_or_default();

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

        // Use exact URL from Python code
        let url = "https://ccfddl.github.io/conference/allconf.yml";
        match client.get(url).send().await {
            Ok(res) => {
                if !res.status().is_success() {
                    let err = format!("Paper deadline API returned HTTP status {}", res.status());
                    log::error!("{}", err);
                    restore_and_emit_cached_deadlines(&app, &state, &err);
                    tokio::time::sleep(Duration::from_secs(backoff_secs)).await;
                    backoff_secs = (backoff_secs * 2).min(900);
                    continue;
                }
                if let Ok(text) = res.text().await {
                    log::info!("Fetched Paper Deadlines YAML ({} bytes)", text.len());
                    {
                        if let Ok(mut last) = state.last_yaml.lock() {
                            *last = Some(text.clone());
                        }
                    }
                    process_deadlines(app.clone(), state.clone(), config.clone(), text);
                    backoff_secs = 60;
                }
            }
            Err(e) => {
                log::error!("Error fetching paper deadlines: {}", e);
                restore_and_emit_cached_deadlines(&app, &state, &e.to_string());
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
