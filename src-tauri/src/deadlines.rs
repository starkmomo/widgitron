use chrono::{DateTime, Utc};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

use crate::models::{
    AppConfig, GlobalState, PaperConfig, PaperDeadlineInfo, YamlConfItem,
};
use crate::config_store;

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
    tokio::task::spawn_blocking(move || {
        match serde_yaml::from_str::<Vec<YamlConfItem>>(&text) {
            Ok(items) => {
                let mut deadlines = Vec::new();
                let now = Utc::now();

                for item in items {
                    let ccf_rank = item.rank.as_ref().and_then(|r| r.ccf.clone());
                    let core_rank = item.rank.as_ref().and_then(|r| r.core.clone());
                    let rank = ccf_rank.clone().unwrap_or_else(|| "N".to_string());
                    let core_val = core_rank.clone().unwrap_or_else(|| "N".to_string());
                    let sub = item.sub.unwrap_or_else(|| "Unknown".to_string());

                    let has_ccf_filter = config_inner.filter_by_rank.as_ref().map_or(false, |v| !v.is_empty());
                    let has_core_filter = config_inner.filter_by_core.as_ref().map_or(false, |v| !v.is_empty());

                    let matches_ccf = !has_ccf_filter || config_inner.filter_by_rank.as_ref().unwrap().contains(&rank);
                    let matches_core = !has_core_filter || config_inner.filter_by_core.as_ref().unwrap().contains(&core_val);

                    let keep = match (has_ccf_filter, has_core_filter) {
                        (true, true) => matches_ccf || matches_core,
                        (true, false) => matches_ccf,
                        (false, true) => matches_core,
                        (false, false) => true,
                    };

                    if !keep {
                        continue;
                    }

                    if let Some(allowed) = &config_inner.filter_by_sub {
                        if !allowed.is_empty() && !allowed.contains(&sub) {
                            continue;
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
                                        } else if !dt_str.ends_with('Z')
                                            && !dt_str.contains('+')
                                        {
                                            dt_str.push_str("Z");
                                        }
                                        dt_str = dt_str.replace(" ", "T");

                                        if let Ok(parsed) =
                                            DateTime::parse_from_rfc3339(&dt_str)
                                        {
                                            let utc_dt =
                                                parsed.with_timezone(&Utc);
                                            if utc_dt >= now {
                                                deadlines.push(PaperDeadlineInfo {
                                                    title: item.title.clone(),
                                                    year: conf.year.clone(),
                                                    deadline_utc: utc_dt
                                                        .to_rfc3339(),
                                                    timezone: conf
                                                        .timezone
                                                        .clone()
                                                        .unwrap_or_else(|| {
                                                            "UTC".into()
                                                        }),
                                                    rank: rank.clone(),
                                                    sub: sub.clone(),
                                                    place: conf
                                                        .place
                                                        .clone()
                                                        .unwrap_or_default(),
                                                    link: conf
                                                        .link
                                                        .clone()
                                                        .unwrap_or_default(),
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

                {
                    if let Ok(mut state_deadlines) = state_inner.deadlines.lock()
                    {
                        *state_deadlines = deadlines.clone();
                    }
                }

                if !deadlines.is_empty() {
                    let _ = app_inner.emit("paper_update", &deadlines);
                }
            }
            Err(e) => {
                println!("Error parsing Paper Deadlines YAML: {}", e);
            }
        }
    });
}

// --- Paper Deadline Polling Task ---
pub async fn start_paper_monitor(app: AppHandle, state: Arc<GlobalState>) {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .unwrap_or_default();

    loop {
        let app_config = config_store::read_config::<AppConfig>(&app, "app_config.json");

        if !app_config.deadline_enabled.unwrap_or(true) {
            if let Ok(mut state_deadlines) = state.deadlines.lock() {
                state_deadlines.clear();
            }
            let _ = app.emit("paper_update", Vec::<PaperDeadlineInfo>::new());
            tokio::time::sleep(Duration::from_secs(5)).await;
            continue;
        }

        let config = config_store::read_config::<PaperConfig>(&app, "paper_deadline.json");

        // Use exact URL from Python code
        let url = "https://ccfddl.github.io/conference/allconf.yml";
        match client.get(url).send().await {
            Ok(res) => {
                if let Ok(text) = res.text().await {
                    println!(
                        "Fetched Paper Deadlines YAML ({} bytes)",
                        text.len()
                    );
                    {
                        if let Ok(mut last) = state.last_yaml.lock() {
                            *last = Some(text.clone());
                        }
                    }
                    process_deadlines(
                        app.clone(),
                        state.clone(),
                        config.clone(),
                        text,
                    );
                }
            }
            Err(e) => {
                println!("Error fetching paper deadlines: {}", e);
            }
        }

        let interval = config.update_interval.unwrap_or(3600);
        for _ in 0..interval {
            let ac = config_store::read_config::<AppConfig>(&app, "app_config.json");
            if !ac.deadline_enabled.unwrap_or(true) {
                break;
            }
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
    }
}
