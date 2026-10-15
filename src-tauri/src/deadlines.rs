use chrono::{DateTime, Datelike, FixedOffset, NaiveDate, NaiveDateTime, TimeZone, Utc};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

use crate::config_store;
use crate::models::{
    AppConfig, DeadlineMilestone, DeadlineStage, GlobalState, PaperConfig, PaperDeadlineInfo,
    YamlConfItem,
};

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

pub fn normalize_paper_config(config: &mut PaperConfig) {
    let mut legacy_titles = config.subscribed_titles.clone().unwrap_or_default();
    legacy_titles.extend(config.pinned_titles.take().unwrap_or_default());
    let mut followed = config.followed_conference_ids.clone().unwrap_or_default();
    for key in config.pinned_deadline_ids.take().unwrap_or_default() {
        let parts: Vec<_> = key.split('|').collect();
        if parts.len() >= 2 && !parts[1].trim().is_empty() {
            followed.push(conference_id(parts[0], parts[1]));
        } else if let Some(title) = parts.first() {
            legacy_titles.push(title.to_string());
        }
    }
    let normalize = |items: Vec<String>| {
        let mut seen = std::collections::HashSet::new();
        items
            .into_iter()
            .map(|item| item.trim().to_string())
            .filter(|item| !item.is_empty() && seen.insert(item.to_lowercase()))
            .collect::<Vec<_>>()
    };
    if config.subscribed_titles.is_some() || !legacy_titles.is_empty() {
        config.subscribed_titles = Some(normalize(legacy_titles));
    }
    if let Some(ignored) = config.ignored_titles.take() {
        config.ignored_titles = Some(normalize(ignored));
    }
    let ignored = normalize(
        config
            .ignored_conference_ids
            .clone()
            .unwrap_or_default()
            .into_iter()
            .map(|id| id.to_lowercase())
            .collect(),
    );
    followed = normalize(followed.into_iter().map(|id| id.to_lowercase()).collect());
    followed.retain(|id| !ignored.contains(id));
    if config.followed_conference_ids.is_some() || !followed.is_empty() {
        config.followed_conference_ids = Some(followed);
    }
    if config.ignored_conference_ids.is_some() || !ignored.is_empty() {
        config.ignored_conference_ids = Some(ignored);
    }
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

pub fn conference_id(title: &str, year: &str) -> String {
    format!("{}|{}", normalize_title(title), year.trim().to_lowercase())
}

// Bind old title-only preferences to one known edition once, without following
// future editions automatically. Unknown titles stay editable until data arrives.
pub fn migrate_conference_preferences(
    config: &mut PaperConfig,
    deadlines: &[PaperDeadlineInfo],
    now: DateTime<Utc>,
) {
    normalize_paper_config(config);
    for ignored in [false, true] {
        let legacy = if ignored {
            &mut config.ignored_titles
        } else {
            &mut config.subscribed_titles
        };
        let mut unresolved = Vec::new();
        let mut ids = Vec::new();
        for title in legacy.take().unwrap_or_default() {
            let candidates: Vec<_> = deadlines
                .iter()
                .filter(|item| normalize_title(&item.title) == normalize_title(&title))
                .collect();
            let selected = candidates
                .iter()
                .filter_map(|item| project_deadline(item, now).map(|current| (*item, current)))
                .min_by(|(_, a), (_, b)| {
                    let time = |item: &PaperDeadlineInfo| {
                        if item.deadline_utc.is_empty() {
                            "9999".to_string()
                        } else {
                            item.deadline_utc.clone()
                        }
                    };
                    time(a).cmp(&time(b)).then(a.year.cmp(&b.year))
                })
                .map(|(item, _)| item)
                .or_else(|| candidates.into_iter().max_by(|a, b| a.year.cmp(&b.year)));
            if let Some(item) = selected {
                ids.push(conference_id(&item.title, &item.year));
            } else {
                unresolved.push(title);
            }
        }
        *legacy = (!unresolved.is_empty()).then_some(unresolved);
        let target = if ignored {
            &mut config.ignored_conference_ids
        } else {
            &mut config.followed_conference_ids
        };
        if !ids.is_empty() {
            target.get_or_insert_with(Vec::new).extend(ids);
        }
    }
    normalize_paper_config(config);
}

pub fn read_paper_config(app: &AppHandle) -> PaperConfig {
    let mut config = config_store::read_config::<PaperConfig>(app, "paper_deadline.json");
    let previous = config.clone();
    migrate_conference_preferences(&mut config, &load_deadlines_cache(app), Utc::now());
    if config != previous {
        if let Err(error) = config_store::write_config(app, "paper_deadline.json", &config) {
            log::warn!("Could not migrate conference preferences: {error}");
        }
        let _ = app.emit("paper_config_update", &config);
    }
    config
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

fn deadline_stage(note: Option<&str>, abstract_deadline: Option<&str>) -> DeadlineStage {
    let note = note.unwrap_or_default().to_ascii_lowercase();
    if note.trim().is_empty() {
        // CCFDDL defines `deadline` as the submission deadline. A separate
        // abstract deadline distinguishes the full-paper step from registration.
        return if abstract_deadline
            .is_some_and(|date| !date.trim().is_empty() && !date.trim().eq_ignore_ascii_case("TBD"))
        {
            DeadlineStage::FullPaperSubmission
        } else {
            DeadlineStage::Submission
        };
    }
    let has_arr = note
        .split(|c: char| !c.is_ascii_alphanumeric())
        .any(|word| word == "arr");
    // Some comments describe a direct submission date AND a different ARR
    // commitment date. Preserve those verbatim instead of guessing which is meant.
    if !has_arr || note.contains("direct submission") {
        return DeadlineStage::Unspecified;
    }
    if note.contains("commitment") {
        DeadlineStage::ArrCommitment
    } else if note.contains("submission") || note.contains("cycle") {
        DeadlineStage::ArrSubmission
    } else {
        DeadlineStage::Unspecified
    }
}

fn parse_deadline_time(value: &str, timezone: &str) -> Option<DateTime<Utc>> {
    let value = value.trim().replace(' ', "T");
    if let Ok(date) = DateTime::parse_from_rfc3339(&value) {
        return Some(date.with_timezone(&Utc));
    }
    let naive = NaiveDateTime::parse_from_str(&value, "%Y-%m-%dT%H:%M:%S")
        .or_else(|_| NaiveDateTime::parse_from_str(&value, "%Y-%m-%dT%H:%M"))
        .ok()
        .or_else(|| {
            NaiveDate::parse_from_str(&value, "%Y-%m-%d")
                .ok()?
                .and_hms_opt(23, 59, 59)
        })?;
    let zone = timezone.trim().to_ascii_uppercase();
    if zone == "PT" {
        return chrono_tz::America::Los_Angeles
            .from_local_datetime(&naive)
            .single()
            .map(|date| date.with_timezone(&Utc));
    }
    let seconds = if zone == "AOE" {
        -12 * 3600
    } else if zone == "UTC" || zone == "GMT" {
        0
    } else {
        let offset = zone
            .strip_prefix("UTC")
            .or_else(|| zone.strip_prefix("GMT"))?;
        let sign = match offset.as_bytes().first()? {
            b'+' => 1,
            b'-' => -1,
            _ => return None,
        };
        let mut parts = offset[1..].split(':');
        let hours: i32 = parts.next()?.parse().ok()?;
        let minutes: i32 = parts.next().unwrap_or("0").parse().ok()?;
        if hours > 23 || minutes > 59 || parts.next().is_some() {
            return None;
        }
        sign * (hours * 3600 + minutes * 60)
    };
    FixedOffset::east_opt(seconds)?
        .from_local_datetime(&naive)
        .single()
        .map(|date| date.with_timezone(&Utc))
}

fn stage_label(stage: &DeadlineStage) -> &'static str {
    match stage {
        DeadlineStage::AbstractSubmission => "Abstract submission",
        DeadlineStage::Submission => "Paper submission",
        DeadlineStage::FullPaperSubmission => "Full paper submission",
        DeadlineStage::ArrSubmission => "ARR submission",
        DeadlineStage::ArrCommitment => "ARR commitment · reviewed papers only",
        DeadlineStage::Rebuttal => "Rebuttal / author response",
        DeadlineStage::Decision => "Decision notification",
        DeadlineStage::Unspecified => "Submission deadline",
    }
}

// The full timeline survives after a stage expires. Clients can roll forward
// locally without another network request or changing reminder subscriptions.
pub fn project_deadline(
    deadline: &PaperDeadlineInfo,
    now: DateTime<Utc>,
) -> Option<PaperDeadlineInfo> {
    if deadline.timeline.is_empty() {
        let date = DateTime::parse_from_rfc3339(&deadline.deadline_utc).ok()?;
        return (date.with_timezone(&Utc) > now).then(|| deadline.clone());
    }
    let next = deadline
        .timeline
        .iter()
        .filter_map(|event| {
            let date = DateTime::parse_from_rfc3339(event.deadline_utc.as_deref()?)
                .ok()?
                .with_timezone(&Utc);
            (date > now).then_some((event, date))
        })
        .min_by_key(|(_, date)| *date)
        .map(|(event, _)| event)
        .or_else(|| {
            (deadline.year.parse::<i32>().unwrap_or(0) >= now.year())
                .then(|| {
                    deadline
                        .timeline
                        .iter()
                        .find(|event| event.deadline_utc.is_none())
                })
                .flatten()
        })?;
    let mut projected = deadline.clone();
    projected.deadline_utc = next.deadline_utc.clone().unwrap_or_default();
    projected.deadline_stage = next.stage.clone();
    projected.deadline_label = next.label.clone();
    projected.deadline_note = next.note.clone();
    Some(projected)
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
        // Retain ignored meetings so they can be restored even after filters change.
        let legacy_selected = subscribed
            || config.ignored_titles.as_ref().is_some_and(|titles| {
                titles
                    .iter()
                    .any(|item| normalize_title(item) == normalize_title(&title))
            });
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

        let matches_sub = config
            .filter_by_sub
            .as_ref()
            .is_none_or(|allowed| allowed.is_empty() || allowed.contains(&sub));

        if let Some(confs) = item.confs {
            for conf in confs {
                let id = conference_id(&title, &conf.year);
                let selected = legacy_selected
                    || config
                        .followed_conference_ids
                        .iter()
                        .flatten()
                        .chain(config.ignored_conference_ids.iter().flatten())
                        .any(|key| key == &id);
                if !selected && (!keep || !matches_sub) {
                    continue;
                }
                if let Some(rounds) = conf.timeline {
                    let timezone = conf.timezone.clone().unwrap_or_else(|| "AoE".into());
                    let mut timeline = Vec::new();
                    for (index, t) in rounds.into_iter().enumerate() {
                        let note = t
                            .comment
                            .as_deref()
                            .map(str::trim)
                            .filter(|note| !note.is_empty())
                            .map(str::to_string);
                        let submission_stage =
                            deadline_stage(t.comment.as_deref(), t.abstract_deadline.as_deref());
                        for (field, value, stage) in [
                            (
                                "abstract",
                                t.abstract_deadline,
                                DeadlineStage::AbstractSubmission,
                            ),
                            ("submission", t.deadline, submission_stage),
                            ("rebuttal", t.rebuttal_deadline, DeadlineStage::Rebuttal),
                            ("decision", t.decision_deadline, DeadlineStage::Decision),
                        ] {
                            let Some(value) = value.filter(|value| !value.trim().is_empty()) else {
                                continue;
                            };
                            let date = parse_deadline_time(&value, &timezone);
                            if date.is_none() && !value.eq_ignore_ascii_case("TBD") {
                                log::warn!("Unconfirmed deadline time for {title} {}: {value} ({timezone})", conf.year);
                            }
                            timeline.push(DeadlineMilestone {
                                id: format!("{}:{field}:{value}", index + 1),
                                label: if field == "submission"
                                    && stage == DeadlineStage::Unspecified
                                {
                                    note.clone().unwrap_or_else(|| stage_label(&stage).into())
                                } else {
                                    stage_label(&stage).into()
                                },
                                stage,
                                deadline_utc: date.map(|date| date.to_rfc3339()),
                                source_time: value,
                                note: if field == "submission" {
                                    note.clone()
                                } else {
                                    None
                                },
                                round: index + 1,
                            });
                        }
                    }
                    timeline.sort_by(|a, b| {
                        a.deadline_utc
                            .as_deref()
                            .unwrap_or("9999")
                            .cmp(b.deadline_utc.as_deref().unwrap_or("9999"))
                    });
                    let conference = PaperDeadlineInfo {
                        title: title.clone(),
                        description: item.description.clone(),
                        year: conf.year.clone(),
                        deadline_utc: String::new(),
                        timezone,
                        rank: rank.clone(),
                        sub: sub.clone(),
                        place: conf.place.clone().unwrap_or_default(),
                        link: conf.link.clone().unwrap_or_default(),
                        ccf: ccf_rank.clone(),
                        core: core_rank.clone(),
                        deadline_stage: DeadlineStage::Unspecified,
                        deadline_note: None,
                        deadline_label: String::new(),
                        timeline,
                    };
                    if let Some(conference) = project_deadline(&conference, now) {
                        deadlines.push(conference);
                    } else if selected && !conference.timeline.is_empty() {
                        // Keep history for selected series so the main window can
                        // show and clear expired preferences. Widgets still use
                        // project_deadline and never display these expired rows.
                        let mut archived = conference;
                        if let Some(last) = archived.timeline.last() {
                            archived.deadline_utc = last.deadline_utc.clone().unwrap_or_default();
                            archived.deadline_stage = last.stage.clone();
                            archived.deadline_label = last.label.clone();
                            archived.deadline_note = last.note.clone();
                        }
                        deadlines.push(archived);
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
        let config = read_paper_config(app);
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
    let config = read_paper_config(app);
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

        let config = read_paper_config(&app);

        let mut skip_fetch = false;
        if is_startup {
            is_startup = false;
            let cache_path = crate::utils::get_config_path(&app, DEADLINES_CACHE_FILE);
            if let Ok(metadata) = std::fs::metadata(&cache_path) {
                if let Ok(modified) = metadata.modified() {
                    if let Ok(elapsed) = modified.elapsed() {
                        if elapsed < Duration::from_secs(1800) {
                            let cached = hydrate_deadlines_from_cache(&app, &state);
                            if !cached.is_empty()
                                && cached.iter().all(|item| {
                                    !item.timeline.is_empty() && item.description.is_some()
                                })
                                && config
                                    .subscribed_titles
                                    .iter()
                                    .flatten()
                                    .chain(config.ignored_titles.iter().flatten())
                                    .all(|title| {
                                        cached.iter().any(|item| {
                                            normalize_title(&item.title) == normalize_title(title)
                                        })
                                    })
                                && config
                                    .followed_conference_ids
                                    .iter()
                                    .flatten()
                                    .chain(config.ignored_conference_ids.iter().flatten())
                                    .all(|id| {
                                        cached.iter().any(|item| {
                                            conference_id(&item.title, &item.year) == *id
                                        })
                                    })
                            {
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

    #[test]
    fn legacy_preferences_bind_once_to_one_edition_and_preserve_expired_choices() {
        let yaml = "- title: ACL\n  description: Association for Computational Linguistics\n  rank:\n    ccf: C\n  sub: AI\n  confs:\n  - year: '2100'\n    timeline:\n    - deadline: '2100-10-10 23:59:59'\n  - year: '2101'\n    timeline:\n    - deadline: '2101-10-10 23:59:59'\n  - year: '2020'\n    timeline:\n    - deadline: '2019-10-10 23:59:59'\n";
        let mut config = PaperConfig {
            subscribed_titles: Some(vec![" ACL ".into()]),
            pinned_deadline_ids: Some(vec!["vldb|2100|old-time".into()]),
            filter_by_rank: Some(vec!["A".into()]),
            filter_by_core: None,
            ..PaperConfig::default()
        };
        let rows = build_deadlines_from_yaml(yaml, &config).unwrap();
        migrate_conference_preferences(&mut config, &rows, Utc::now());
        assert!(config.subscribed_titles.is_none());
        assert!(config.pinned_deadline_ids.is_none());
        assert_eq!(
            config.followed_conference_ids.as_ref().unwrap(),
            &vec!["vldb|2100", "acl|2100"]
        );
        let once = config.clone();
        migrate_conference_preferences(&mut config, &rows, Utc::now());
        assert_eq!(config, once);
        config.followed_conference_ids = Some(vec!["acl|2020".into()]);
        config.ignored_conference_ids = Some(vec!["acl|2100".into()]);
        config.filter_by_sub = Some(vec!["DB".into()]);
        let retained = build_deadlines_from_yaml(yaml, &config).unwrap();
        assert_eq!(retained.len(), 2);
        assert!(retained.iter().any(|item| item.year == "2020"));
        assert!(retained.iter().any(|item| item.year == "2100"));
        assert!(!retained.iter().any(|item| item.year == "2101"));
        assert_eq!(
            retained[0].description.as_deref(),
            Some("Association for Computational Linguistics")
        );
    }

    #[test]
    fn deadline_comments_distinguish_arr_review_and_conference_commitment() {
        let yaml = "- title: NAACL\n  confs:\n  - year: '2100'\n    timeline:\n    - deadline: '2100-10-12 23:59:59'\n      comment: ARR Submission\n    - deadline: '2100-12-23 23:59:59'\n      comment: NAACL commitment after ARR meta-reviews; reviewed papers only\n    - deadline: '2100-12-24 23:59:59'\n      comment: Special industry track\n    - deadline: '2100-12-25 23:59:59'\n";
        let config = PaperConfig {
            filter_by_rank: None,
            filter_by_core: None,
            ..PaperConfig::default()
        };
        let deadlines = build_deadlines_from_yaml(yaml, &config).unwrap();
        assert_eq!(deadlines.len(), 1);
        let events = &deadlines[0].timeline;
        assert_eq!(events.len(), 4);
        assert_eq!(events[0].stage, DeadlineStage::ArrSubmission);
        assert_eq!(events[1].stage, DeadlineStage::ArrCommitment);
        assert_eq!(
            events[1].note.as_deref(),
            Some("NAACL commitment after ARR meta-reviews; reviewed papers only")
        );
        assert_eq!(events[2].stage, DeadlineStage::Unspecified);
        assert_eq!(events[2].note.as_deref(), Some("Special industry track"));
        assert_eq!(events[3].stage, DeadlineStage::Submission);
        assert_eq!(events[3].note, None);
        assert_eq!(
            deadline_stage(
                Some("Direct submissions; ARR commitment deadline: August 1"),
                None
            ),
            DeadlineStage::Unspecified
        );

        let mut old_cache = serde_json::to_value(&deadlines[0]).unwrap();
        old_cache.as_object_mut().unwrap().remove("timeline");
        old_cache.as_object_mut().unwrap().remove("deadline_label");
        old_cache.as_object_mut().unwrap().remove("deadline_stage");
        old_cache.as_object_mut().unwrap().remove("deadline_note");
        let restored: PaperDeadlineInfo = serde_json::from_value(old_cache).unwrap();
        assert_eq!(restored.deadline_stage, DeadlineStage::Unspecified);
        assert_eq!(restored.deadline_note, None);
    }

    #[test]
    fn unannotated_submission_fields_are_not_unknown_deadline_types() {
        let yaml = "- title: CVPR\n  confs:\n  - year: '2100'\n    timeline:\n    - abstract_deadline: '2100-11-10 23:59:59'\n      deadline: '2100-11-16 23:59:59'\n    - deadline: '2100-12-01 23:59:59'\n";
        let config = PaperConfig {
            filter_by_rank: None,
            filter_by_core: None,
            ..PaperConfig::default()
        };
        let deadlines = build_deadlines_from_yaml(yaml, &config).unwrap();
        assert_eq!(deadlines.len(), 1);
        assert_eq!(
            deadlines[0].deadline_stage,
            DeadlineStage::AbstractSubmission
        );
        assert_eq!(
            deadlines[0].timeline[1].stage,
            DeadlineStage::FullPaperSubmission
        );
        assert_eq!(deadlines[0].timeline[2].stage, DeadlineStage::Submission);
        assert_eq!(deadline_stage(None, Some("TBD")), DeadlineStage::Submission);
        assert_eq!(
            deadline_stage(Some("ARR Submission"), Some("2100-11-10")),
            DeadlineStage::ArrSubmission
        );
        assert_eq!(
            deadline_stage(
                Some("ARR commitment; reviewed papers only"),
                Some("2100-11-10")
            ),
            DeadlineStage::ArrCommitment
        );
    }

    #[test]
    fn complete_timeline_rolls_at_boundaries_and_keeps_past_events() {
        let yaml = "- title: CVPR\n  confs:\n  - year: '2100'\n    timezone: UTC+0\n    timeline:\n    - abstract_deadline: '2100-11-10 23:59:59'\n      deadline: '2100-11-16 23:59:59'\n      rebuttal_deadline: '2101-02-01 23:59:59'\n      decision_deadline: '2101-02-25 23:59:59'\n";
        let config = PaperConfig {
            filter_by_rank: None,
            filter_by_core: None,
            ..PaperConfig::default()
        };
        let conferences = build_deadlines_from_yaml(yaml, &config).unwrap();
        assert_eq!(conferences.len(), 1);
        let conference = &conferences[0];
        assert_eq!(conference.timeline.len(), 4);
        for (time, stage) in [
            ("2100-11-10T23:59:59Z", DeadlineStage::FullPaperSubmission),
            ("2100-11-16T23:59:59Z", DeadlineStage::Rebuttal),
            ("2101-02-01T23:59:59Z", DeadlineStage::Decision),
        ] {
            let now = DateTime::parse_from_rfc3339(time)
                .unwrap()
                .with_timezone(&Utc);
            let next = project_deadline(conference, now).unwrap();
            assert_eq!(next.deadline_stage, stage);
            assert_eq!(next.timeline.len(), 4);
        }
        let ended = DateTime::parse_from_rfc3339("2101-02-25T23:59:59Z")
            .unwrap()
            .with_timezone(&Utc);
        assert!(project_deadline(conference, ended).is_none());
    }

    #[test]
    fn timezone_offsets_aoe_and_pacific_dst_are_respected() {
        for (raw, zone, expected) in [
            ("2100-11-10 23:59:59", "AoE", "2100-11-11T11:59:59Z"),
            ("2100-11-10 23:59:59", "UTC-12", "2100-11-11T11:59:59Z"),
            ("2100-11-10 12:00:00", "UTC+8", "2100-11-10T04:00:00Z"),
            ("2026-01-10 12:00:00", "PT", "2026-01-10T20:00:00Z"),
            ("2026-07-10 12:00:00", "PT", "2026-07-10T19:00:00Z"),
            ("2100-11-10T12:00:00+05:30", "AoE", "2100-11-10T06:30:00Z"),
        ] {
            assert_eq!(
                parse_deadline_time(raw, zone),
                Some(
                    DateTime::parse_from_rfc3339(expected)
                        .unwrap()
                        .with_timezone(&Utc)
                )
            );
        }
        assert!(parse_deadline_time("TBD", "AoE").is_none());
        assert!(parse_deadline_time("2100-11-10 12:00:00", "unknown").is_none());
    }

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
