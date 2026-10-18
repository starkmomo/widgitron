use std::collections::HashSet;
use std::sync::{Mutex, MutexGuard};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::{
    config_store,
    models::{ArxivConfig, ArxivPaper, GlobalState},
};

const FILE: &str = "arxiv_reading_state.json";
const MAX_SKIPPED: usize = 2000;
static LIBRARY_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default)]
struct ReadingState {
    revision: u64,
    saved: Vec<ArxivPaper>,
    scope: String,
    date: String,
    papers: Vec<ArxivPaper>,
    skipped_ids: Vec<String>,
}

#[derive(Clone, Serialize)]
pub struct ReadingSnapshot {
    revision: u64,
    batch: String,
    pub saved: Vec<ArxivPaper>,
    pub skipped: Vec<ArxivPaper>,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PaperAction {
    Save,
    Unsave,
    Skip,
    Restore,
}

fn lock() -> MutexGuard<'static, ()> {
    LIBRARY_LOCK.lock().unwrap_or_else(|error| {
        log::warn!("Recovering arXiv reading state lock");
        error.into_inner()
    })
}

// Treat abstract/PDF URLs and different revisions as the same paper.
pub fn paper_key(id: &str) -> String {
    let id = id.trim();
    let id = if let Ok(url) = reqwest::Url::parse(id) {
        url.path().trim_start_matches('/').to_string()
    } else {
        id.to_string()
    };
    let id = id
        .strip_prefix("abs/")
        .or_else(|| id.strip_prefix("pdf/"))
        .unwrap_or(&id);
    let id = id.strip_suffix(".pdf").unwrap_or(id);
    match id.rsplit_once('v') {
        Some((base, revision))
            if !revision.is_empty() && revision.bytes().all(|b| b.is_ascii_digit()) =>
        {
            base.to_string()
        }
        _ => id.to_string(),
    }
}

fn paper_date(paper: &ArxivPaper) -> Option<String> {
    [&paper.updated, &paper.published]
        .into_iter()
        .find_map(|value| {
            DateTime::parse_from_rfc3339(value)
                .ok()
                .map(|date| date.with_timezone(&Utc).date_naive().to_string())
        })
}

fn batch_date(papers: &[ArxivPaper]) -> String {
    papers
        .iter()
        .filter_map(paper_date)
        .max()
        .unwrap_or_default()
}

fn scope(config: &ArxivConfig) -> String {
    let normalize = |values: &[String]| {
        let mut values: Vec<_> = values
            .iter()
            .map(|v| v.trim().to_lowercase())
            .filter(|v| !v.is_empty())
            .collect();
        values.sort();
        values.dedup();
        values
    };
    format!(
        "{:?}|{:?}",
        normalize(&config.categories),
        normalize(&config.keywords)
    )
}

fn deduplicate(papers: &mut Vec<ArxivPaper>) {
    let mut keys = HashSet::new();
    papers.retain(|paper| keys.insert(paper_key(&paper.id)));
}

fn read(app: &AppHandle) -> Result<ReadingState, String> {
    let config = config_store::read_config::<ArxivConfig>(app, "arxiv_config.json");
    if crate::utils::get_config_path(app, FILE).exists() {
        let mut reading: ReadingState = config_store::read_config(app, FILE);
        if reading.sync_config(&config) {
            config_store::write_config(app, FILE, &reading)?;
        }
        return Ok(reading);
    }
    // Import once. Leave the old files intact as a recoverable legacy copy;
    // none of the new actions append to the unbounded seen/discarded archives.
    let mut saved: Vec<ArxivPaper> = config_store::read_config(app, "arxiv_saved.json");
    deduplicate(&mut saved);
    let mut papers: Vec<ArxivPaper> = config_store::read_config(app, "arxiv_cache.json");
    let discarded: Vec<ArxivPaper> = config_store::read_config(app, "arxiv_discarded.json");
    let date = if papers.is_empty() {
        batch_date(&discarded)
    } else {
        batch_date(&papers)
    };
    let saved_keys: HashSet<_> = saved.iter().map(|p| paper_key(&p.id)).collect();
    let mut skipped_ids = Vec::new();
    for paper in discarded
        .into_iter()
        .rev()
        .filter(|p| paper_date(p).as_deref() == Some(date.as_str()))
        .take(MAX_SKIPPED)
    {
        let key = paper_key(&paper.id);
        if !saved_keys.contains(&key) && !skipped_ids.contains(&key) {
            skipped_ids.push(key);
            papers.push(paper);
        }
    }
    deduplicate(&mut papers);
    let mut result = ReadingState {
        revision: 0,
        saved,
        papers,
        skipped_ids,
        date,
        scope: scope(&config),
    };
    result.sync_config(&config);
    config_store::write_config(app, FILE, &result)?;
    Ok(result)
}

impl ReadingState {
    fn sync_config(&mut self, config: &ArxivConfig) -> bool {
        let next_scope = scope(config);
        let no_keywords = !crate::arxiv::has_reading_keywords(&config.keywords);
        if self.scope == next_scope
            && (!no_keywords || (self.papers.is_empty() && self.skipped_ids.is_empty() && self.date.is_empty()))
        {
            return false;
        }
        self.papers.clear();
        self.skipped_ids.clear();
        self.date.clear();
        self.scope = next_scope;
        self.revision = self.revision.saturating_add(1);
        true
    }

    fn snapshot(&self) -> ReadingSnapshot {
        ReadingSnapshot {
            revision: self.revision,
            batch: format!("{}|{}", self.scope, self.date),
            saved: self.saved.clone(),
            skipped: self
                .skipped_ids
                .iter()
                .rev()
                .filter_map(|id| {
                    self.papers
                        .iter()
                        .find(|paper| paper_key(&paper.id) == *id)
                        .cloned()
                })
                .collect(),
        }
    }

    fn visible(&self) -> Vec<ArxivPaper> {
        let hidden: HashSet<_> = self
            .saved
            .iter()
            .map(|p| paper_key(&p.id))
            .chain(self.skipped_ids.iter().cloned())
            .collect();
        self.papers
            .iter()
            .filter(|p| !hidden.contains(&paper_key(&p.id)))
            .cloned()
            .collect()
    }

    fn replace_batch(&mut self, mut papers: Vec<ArxivPaper>, scope: String) {
        let date = batch_date(&papers);
        // Empty/error responses do not turn midnight or a temporary gap into a new batch.
        if scope == self.scope && (date.is_empty() || date < self.date) {
            return;
        }
        if scope != self.scope || date != self.date {
            self.skipped_ids.clear();
        } else {
            // Keep skipped titles available while this batch is still current.
            papers.extend(
                self.papers
                    .iter()
                    .filter(|p| self.skipped_ids.contains(&paper_key(&p.id)))
                    .cloned(),
            );
        }
        deduplicate(&mut papers);
        self.papers = papers;
        self.scope = scope;
        self.date = date;
    }

    fn updated(mut self, mut papers: Vec<ArxivPaper>, action: PaperAction) -> Result<Self, String> {
        deduplicate(&mut papers);
        for paper in papers {
            self.apply(paper, action)?;
        }
        self.revision = self.revision.saturating_add(1);
        Ok(self)
    }

    fn apply(&mut self, paper: ArxivPaper, action: PaperAction) -> Result<(), String> {
        let key = paper_key(&paper.id);
        match action {
            PaperAction::Save => {
                self.saved.retain(|p| paper_key(&p.id) != key);
                self.saved.insert(0, paper);
                self.skipped_ids.retain(|id| *id != key);
            }
            PaperAction::Unsave => self.saved.retain(|p| paper_key(&p.id) != key),
            PaperAction::Skip => {
                if !self.papers.iter().any(|p| paper_key(&p.id) == key) {
                    return Err("This paper is not in the current reading batch.".to_string());
                }
                if self.saved.iter().any(|p| paper_key(&p.id) == key) {
                    return Err("Unsave this paper before skipping it.".to_string());
                }
                if !self.skipped_ids.contains(&key) {
                    self.skipped_ids.push(key);
                }
                if self.skipped_ids.len() > MAX_SKIPPED {
                    self.skipped_ids
                        .drain(..self.skipped_ids.len() - MAX_SKIPPED);
                }
            }
            PaperAction::Restore => self.skipped_ids.retain(|id| *id != key),
        }
        Ok(())
    }
}

fn publish(app: &AppHandle, global: &GlobalState, reading: &ReadingState) -> Vec<ArxivPaper> {
    let papers = reading.visible();
    if let Err(error) = config_store::write_config(app, "arxiv_cache.json", &papers) {
        log::warn!("Could not update the derived arXiv cache: {error}");
    }
    *global
        .arxiv_papers
        .lock()
        .unwrap_or_else(|e| e.into_inner()) = papers.clone();
    let _ = app.emit("arxiv_update", &papers);
    let _ = app.emit("arxiv_library_update", reading.snapshot());
    papers
}

pub fn replace_batch(
    app: &AppHandle,
    global: &GlobalState,
    papers: Vec<ArxivPaper>,
    config: &ArxivConfig,
) -> Result<Vec<ArxivPaper>, String> {
    let _guard = lock();
    let mut reading = read(app)?;
    let current_config = config_store::read_config::<ArxivConfig>(app, "arxiv_config.json");
    reading.sync_config(&current_config);
    // A request started before a filter change must not repopulate the old queue.
    if scope(config) == scope(&current_config)
        && crate::arxiv::has_reading_keywords(&current_config.keywords)
    {
        reading.replace_batch(papers, scope(config));
    }
    reading.revision = reading.revision.saturating_add(1);
    config_store::write_config(app, FILE, &reading)?;
    Ok(publish(app, global, &reading))
}

pub fn sync_config(app: &AppHandle, global: &GlobalState) -> Result<(), String> {
    let _guard = lock();
    let reading = read(app)?;
    publish(app, global, &reading);
    Ok(())
}

pub fn visible_papers(app: &AppHandle) -> Result<Vec<ArxivPaper>, String> {
    let _guard = lock();
    Ok(read(app)?.visible())
}

#[tauri::command]
pub fn get_arxiv_reading_state(app: AppHandle) -> Result<ReadingSnapshot, String> {
    let _guard = lock();
    Ok(read(&app)?.snapshot())
}

#[tauri::command]
pub fn set_arxiv_paper_status(
    app: AppHandle,
    state: tauri::State<'_, GlobalState>,
    paper: ArxivPaper,
    action: PaperAction,
) -> Result<ReadingSnapshot, String> {
    update(&app, state.inner(), paper, action)
}

pub fn update(
    app: &AppHandle,
    global: &GlobalState,
    paper: ArxivPaper,
    action: PaperAction,
) -> Result<ReadingSnapshot, String> {
    update_many(app, global, vec![paper], action)
}

fn update_many(
    app: &AppHandle,
    global: &GlobalState,
    papers: Vec<ArxivPaper>,
    action: PaperAction,
) -> Result<ReadingSnapshot, String> {
    let _guard = lock();
    // Stage the complete selection before writing or publishing any change.
    let reading = read(app)?.updated(papers, action)?;
    config_store::write_config(app, FILE, &reading)?;
    publish(app, global, &reading);
    Ok(reading.snapshot())
}

#[tauri::command]
pub fn set_arxiv_papers_status(
    app: AppHandle,
    state: tauri::State<'_, GlobalState>,
    papers: Vec<ArxivPaper>,
    action: PaperAction,
) -> Result<ReadingSnapshot, String> {
    update_many(&app, state.inner(), papers, action)
}

pub fn find_paper(app: &AppHandle, id: &str) -> Result<ArxivPaper, String> {
    let _guard = lock();
    let reading = read(app)?;
    reading
        .papers
        .iter()
        .chain(reading.saved.iter())
        .find(|p| paper_key(&p.id) == paper_key(id))
        .cloned()
        .ok_or_else(|| "Paper is no longer available. Please refresh.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn paper(id: &str, date: &str) -> ArxivPaper {
        ArxivPaper {
            id: format!("https://arxiv.org/abs/{id}v1"),
            title: id.into(),
            summary: "Abstract".into(),
            authors: vec![],
            matched_keywords: vec![],
            link: String::new(),
            published: format!("{date}T12:00:00Z"),
            updated: String::new(),
        }
    }
    #[test]
    fn removing_keywords_clears_reading_and_ignored_but_preserves_saved() {
        let a = paper("2610.00001", "2026-10-17");
        let saved = paper("2610.00002", "2026-10-16");
        let config = ArxivConfig { keywords: vec!["omni".into()], ..Default::default() };
        let mut reading = ReadingState::default();
        reading.replace_batch(vec![a.clone()], scope(&config));
        reading.apply(a, PaperAction::Skip).unwrap();
        reading.apply(saved, PaperAction::Save).unwrap();
        assert!(!reading.sync_config(&config));
        let empty = ArxivConfig::default();
        assert!(reading.sync_config(&empty));
        assert!(reading.visible().is_empty());
        assert!(reading.snapshot().skipped.is_empty());
        assert_eq!(reading.saved.len(), 1);
        let revision = reading.revision;
        assert!(!reading.sync_config(&empty));
        assert_eq!(reading.revision, revision);
        assert!(reading.sync_config(&config));
        assert!(reading.visible().is_empty());
        assert_eq!(reading.saved.len(), 1);
    }

    #[test]
    fn legacy_unfiltered_cache_does_not_fill_to_read_on_restart() {
        let config = ArxivConfig::default();
        let a = paper("2610.00001", "2026-10-17");
        let mut reading = ReadingState { scope: scope(&config), papers: vec![a], ..Default::default() };
        assert!(reading.sync_config(&config));
        assert!(reading.visible().is_empty());
    }

    #[test]
    fn skip_restore_and_save_from_history() {
        let a = paper("2610.00001", "2026-10-17");
        let b = paper("2610.00002", "2026-10-16");
        let mut reading = ReadingState::default();
        reading.replace_batch(vec![a.clone()], "scope".into());
        reading.apply(a.clone(), PaperAction::Skip).unwrap();
        assert!(reading.visible().is_empty());
        assert_eq!(reading.snapshot().skipped.len(), 1);
        reading.apply(a.clone(), PaperAction::Restore).unwrap();
        assert_eq!(reading.visible().len(), 1);
        reading.apply(b.clone(), PaperAction::Save).unwrap();
        reading.apply(b.clone(), PaperAction::Save).unwrap();
        assert_eq!(reading.saved.len(), 1);
        reading.apply(a.clone(), PaperAction::Skip).unwrap();
        reading.apply(a.clone(), PaperAction::Save).unwrap();
        assert!(reading.snapshot().skipped.is_empty());
        reading.apply(a, PaperAction::Unsave).unwrap();
        assert_eq!(reading.visible().len(), 1);
    }
    #[test]
    fn skip_lifetime_follows_successful_batch_dates() {
        let a = paper("2610.00001", "2026-10-17");
        let mut reading = ReadingState::default();
        reading.replace_batch(vec![a.clone()], "scope".into());
        reading.apply(a.clone(), PaperAction::Skip).unwrap();
        reading.replace_batch(vec![a.clone()], "scope".into());
        assert_eq!(reading.snapshot().skipped.len(), 1);
        reading.replace_batch(vec![], "scope".into());
        assert_eq!(reading.snapshot().skipped.len(), 1);
        let b = paper("2610.00002", "2026-10-18");
        reading.replace_batch(vec![b], "scope".into());
        assert!(reading.skipped_ids.is_empty());
        assert_eq!(reading.visible().len(), 1);
    }
    #[test]
    fn bulk_actions_deduplicate_and_commit_one_revision() {
        let a = paper("2610.00001", "2026-10-17");
        let mut newer = a.clone();
        newer.id = "https://arxiv.org/abs/2610.00001v2".into();
        let b = paper("2610.00002", "2026-10-17");
        let reading = ReadingState::default()
            .updated(vec![a.clone(), newer, b.clone()], PaperAction::Save)
            .unwrap();
        assert_eq!(reading.saved.len(), 2);
        assert_eq!(reading.revision, 1);
        let reading = reading.updated(vec![a, b], PaperAction::Unsave).unwrap();
        assert!(reading.saved.is_empty());
        assert_eq!(reading.revision, 2);
    }

    #[test]
    fn stale_bulk_skip_does_not_publish_partial_results() {
        let a = paper("2610.00001", "2026-10-17");
        let outside = paper("2610.00002", "2026-10-16");
        let mut original = ReadingState::default();
        original.replace_batch(vec![a.clone()], "scope".into());
        assert!(original
            .clone()
            .updated(vec![a, outside], PaperAction::Skip)
            .is_err());
        assert!(original.skipped_ids.is_empty());
        assert_eq!(original.visible().len(), 1);
        assert_eq!(original.revision, 0);
    }

    #[test]
    fn skipped_state_is_bounded_and_versions_share_identity() {
        assert_eq!(
            paper_key("https://arxiv.org/pdf/2610.00001v3.pdf"),
            "2610.00001"
        );
        let a = paper("2610.00001", "2026-10-17");
        let mut reading = ReadingState {
            papers: vec![a.clone()],
            skipped_ids: (0..MAX_SKIPPED).map(|i| format!("old-{i}")).collect(),
            ..Default::default()
        };
        reading.apply(a, PaperAction::Skip).unwrap();
        assert_eq!(reading.skipped_ids.len(), MAX_SKIPPED);
        assert!(!reading.skipped_ids.contains(&"old-0".to_string()));
    }
}
