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
struct KeywordCache {
    categories: Option<Vec<String>>,
    keywords: Vec<String>,
    batches: Vec<KeywordBatch>,
}

#[derive(Clone, Serialize, Deserialize)]
struct KeywordBatch {
    keyword: String,
    papers: Vec<ArxivPaper>,
}

impl KeywordCache {
    fn compatible(&self, config: &ArxivConfig) -> bool {
        self.categories.as_ref() == Some(&crate::arxiv_refresh::normalized(&config.categories))
    }

    fn retain(&mut self, config: &ArxivConfig) {
        let keywords = crate::arxiv_refresh::normalized(&config.keywords);
        self.batches.retain(|batch| keywords.contains(&batch.keyword));
        self.keywords = keywords;
    }

    fn store(&mut self, config: &ArxivConfig, keyword: &str, mut papers: Vec<ArxivPaper>) {
        if !self.compatible(config) {
            self.batches.clear();
            self.categories = Some(crate::arxiv_refresh::normalized(&config.categories));
        }
        self.retain(config);
        let Some(keyword) = crate::arxiv_refresh::normalized(&[keyword.to_string()]).pop() else { return; };
        if !crate::arxiv_refresh::normalized(&config.keywords).contains(&keyword) { return; }
        if let Some(previous) = self.batches.iter().find(|batch| batch.keyword == keyword) {
            let date = batch_date(&papers);
            if date.is_empty() || date < batch_date(&previous.papers) { return; }
        }
        deduplicate(&mut papers);
        self.batches.retain(|batch| batch.keyword != keyword);
        self.batches.push(KeywordBatch { keyword, papers });
    }

    fn merged(&self, config: &ArxivConfig) -> Vec<ArxivPaper> {
        if !self.compatible(config) { return Vec::new(); }
        let keywords = crate::arxiv_refresh::normalized(&config.keywords);
        let mut papers: Vec<_> = self.batches.iter()
            .filter(|batch| keywords.contains(&batch.keyword))
            .flat_map(|batch| batch.papers.iter().cloned()).collect();
        crate::arxiv::sort_papers_by_updated_desc(&mut papers);
        deduplicate(&mut papers);
        for paper in &mut papers {
            paper.matched_keywords = crate::arxiv::matched_keywords_for_paper(paper, &config.keywords);
        }
        papers
    }

    fn project_filters(&self, config: &ArxivConfig, previous: &[ArxivPaper]) -> Vec<ArxivPaper> {
        let mut papers = self.merged(config);
        let next = crate::arxiv_refresh::normalized(&config.keywords);
        let missing: Vec<_> = self.keywords.iter().filter(|keyword| {
            next.contains(keyword) && !self.batches.iter().any(|batch| &batch.keyword == *keyword)
        }).collect();
        if !missing.is_empty() {
            // Older app versions saved a combined list without query provenance.
            // Keep that list while adding terms; on removal retain confirmed
            // matches for uninitialized queries until their first fetch finishes.
            let adding_only = self.keywords.iter().all(|keyword| next.contains(keyword));
            papers.extend(previous.iter().filter(|paper| adding_only || missing.iter().any(|keyword| {
                !crate::arxiv::matched_keywords_for_paper(paper, &[keyword.to_string()]).is_empty()
            })).cloned());
            crate::arxiv::sort_papers_by_updated_desc(&mut papers);
            deduplicate(&mut papers);
        }
        papers
    }
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default)]
struct ReadingState {
    revision: u64,
    saved: Vec<ArxivPaper>,
    scope: String,
    date: String,
    papers: Vec<ArxivPaper>,
    skipped_ids: Vec<String>,
    query_cache: KeywordCache,
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
    format!(
        "{:?}|{:?}",
        crate::arxiv_refresh::normalized(&config.categories),
        crate::arxiv_refresh::normalized(&config.keywords)
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
        query_cache: KeywordCache::default(),
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
            if !no_keywords && (self.query_cache.categories.is_none() || self.query_cache.keywords.is_empty()) {
                self.query_cache.categories = Some(crate::arxiv_refresh::normalized(&config.categories));
                self.query_cache.keywords = crate::arxiv_refresh::normalized(&config.keywords);
                return true;
            }
            return false;
        }
        if !no_keywords && self.query_cache.compatible(config) {
            // Keep unchanged query results and actions while new terms load.
            // Query provenance also retains server matches absent from the
            // title/abstract, which cannot be reconstructed by local matching.
            let papers = self.query_cache.project_filters(config, &self.papers);
            self.query_cache.retain(config);
            self.replace_filtered_batch(papers, next_scope.clone());
        } else {
            self.papers.clear();
            self.skipped_ids.clear();
            self.date.clear();
            self.query_cache = KeywordCache::default();
        }
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

    fn replace_filtered_batch(&mut self, mut papers: Vec<ArxivPaper>, scope: String) {
        deduplicate(&mut papers);
        let keys: HashSet<_> = papers.iter().map(|paper| paper_key(&paper.id)).collect();
        self.skipped_ids.retain(|id| keys.contains(id));
        // Adding/removing a query can change the newest date in either
        // direction without representing a new daily reading batch.
        self.date = batch_date(&papers);
        self.papers = papers;
        self.scope = scope;
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

// Cache only the current categories and keywords, replacing each term's batch
// rather than accumulating historical copies. Saved/ignored papers remain in
// raw query results so edits cannot accidentally resurrect them.
pub fn cached_keywords(app: &AppHandle, config: &ArxivConfig) -> Result<Vec<String>, String> {
    let _guard = lock();
    let reading = read(app)?;
    Ok(if reading.query_cache.compatible(config) {
        reading.query_cache.batches.iter().map(|batch| batch.keyword.clone()).collect()
    } else { Vec::new() })
}

pub fn cache_keyword(
    app: &AppHandle, config: &ArxivConfig, keyword: &str, papers: Vec<ArxivPaper>,
) -> Result<(), String> {
    let _guard = lock();
    let mut reading = read(app)?;
    let current = config_store::read_config::<ArxivConfig>(app, "arxiv_config.json");
    if crate::arxiv_refresh::normalized(&config.categories) == crate::arxiv_refresh::normalized(&current.categories) {
        // A keyword removed during a request is never written back. Successful
        // retained queries can still be reused after an in-flight filter edit.
        reading.query_cache.store(&current, keyword, papers);
        config_store::write_config(app, FILE, &reading)?;
    }
    Ok(())
}

pub fn complete_cached_batch(
    app: &AppHandle,
    global: &GlobalState,
    config: &ArxivConfig,
    filters_changed: bool,
) -> Result<Vec<ArxivPaper>, String> {
    let _guard = lock();
    let mut reading = read(app)?;
    let current_config = config_store::read_config::<ArxivConfig>(app, "arxiv_config.json");
    reading.sync_config(&current_config);
    // A request started before a filter change must not repopulate the old queue.
    if scope(config) == scope(&current_config)
        && crate::arxiv::has_reading_keywords(&current_config.keywords)
    {
        let papers = reading.query_cache.merged(config);
        if filters_changed { reading.replace_filtered_batch(papers, scope(config)); }
        else { reading.replace_batch(papers, scope(config)); }
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

    fn config(keywords: &[&str]) -> ArxivConfig {
        ArxivConfig { keywords: keywords.iter().map(|s| s.to_string()).collect(), ..Default::default() }
    }

    fn reading_with_queries(config: &ArxivConfig, batches: Vec<(&str, Vec<ArxivPaper>)>) -> ReadingState {
        let mut reading = ReadingState { scope: scope(config), ..Default::default() };
        for (keyword, papers) in batches { reading.query_cache.store(config, keyword, papers); }
        reading.replace_batch(reading.query_cache.merged(config), scope(config));
        reading
    }

    #[test]
    fn removing_one_keyword_keeps_overlapping_server_matches_and_actions() {
        let initial = config(&["omni", "agent"]);
        let removed = paper("removed", "2026-10-22");
        // Server matches may be in metadata other than title and summary.
        let shared = paper("shared", "2026-10-20");
        let saved = paper("saved", "2026-10-20");
        let mut reading = reading_with_queries(&initial, vec![
            ("omni", vec![removed, shared.clone()]),
            ("agent", vec![shared.clone(), saved.clone()]),
        ]);
        reading.apply(shared.clone(), PaperAction::Skip).unwrap();
        reading.apply(saved, PaperAction::Save).unwrap();
        let next = config(&["agent"]);
        assert!(reading.sync_config(&next));
        assert_eq!(reading.papers.len(), 2);
        assert!(reading.visible().is_empty());
        assert_eq!(reading.snapshot().skipped[0].title, "shared");
        assert_eq!(reading.saved.len(), 1);
        assert_eq!(reading.date, "2026-10-20");
        assert_eq!(reading.query_cache.batches.len(), 1);
        assert_eq!(reading.query_cache.batches[0].keyword, "agent");
        reading.apply(shared, PaperAction::Restore).unwrap();
        assert_eq!(reading.visible()[0].title, "shared");
    }

    #[test]
    fn adding_a_keyword_keeps_visible_papers_while_loading_and_does_not_reset_ignores() {
        let initial = config(&["omni"]);
        let kept = paper("kept", "2026-10-20");
        let ignored = paper("ignored", "2026-10-20");
        let mut reading = reading_with_queries(&initial, vec![("omni", vec![kept, ignored.clone()])]);
        reading.apply(ignored, PaperAction::Skip).unwrap();
        let next = config(&["omni", "agent"]);
        assert!(reading.sync_config(&next));
        assert_eq!(reading.visible()[0].title, "kept");
        assert_eq!(reading.snapshot().skipped.len(), 1);
        reading.query_cache.store(&next, "agent", vec![paper("newer", "2026-10-22")]);
        reading.replace_filtered_batch(reading.query_cache.merged(&next), scope(&next));
        assert_eq!(reading.visible().len(), 2);
        assert_eq!(reading.snapshot().skipped.len(), 1);
        assert_eq!(reading.date, "2026-10-22");
    }

    #[test]
    fn raw_query_cache_survives_restart_and_is_bounded_to_current_filters() {
        let initial = config(&["omni", "agent"]);
        let mut reading = reading_with_queries(&initial, vec![
            ("omni", vec![paper("one", "2026-10-20")]),
            ("agent", vec![paper("two", "2026-10-20")]),
        ]);
        reading.apply(paper("saved", "2026-10-20"), PaperAction::Save).unwrap();
        let json = serde_json::to_string(&reading).unwrap();
        let mut restored: ReadingState = serde_json::from_str(&json).unwrap();
        assert!(!restored.sync_config(&initial));
        let retained = config(&["OMNI"]);
        restored.sync_config(&retained);
        assert_eq!(restored.query_cache.batches.len(), 1);
        // A late response from a removed query must not be cached again.
        restored.query_cache.store(&retained, "agent", vec![paper("late", "2026-10-22")]);
        assert_eq!(restored.query_cache.batches.len(), 1);
        let mut other_category = retained.clone();
        other_category.categories = vec!["stat".into()];
        restored.sync_config(&other_category);
        assert!(restored.query_cache.batches.is_empty());
        assert!(restored.visible().is_empty());
        assert_eq!(restored.saved.len(), 1);
    }

    #[test]
    fn merged_cache_uses_newest_revision_and_recomputes_keyword_labels() {
        let config = config(&["omni", "agent"]);
        let mut old = paper("2610.00001", "2026-10-20");
        old.title = "omni agent".into();
        old.matched_keywords = vec!["removed label".into()];
        let mut newer = old.clone();
        newer.id = "https://arxiv.org/abs/2610.00001v2".into();
        newer.updated = "2026-10-22T10:00:00Z".into();
        let reading = reading_with_queries(&config, vec![("omni", vec![old]), ("agent", vec![newer])]);
        assert_eq!(reading.papers.len(), 1);
        assert!(reading.papers[0].id.ends_with("v2"));
        assert_eq!(reading.papers[0].matched_keywords, vec!["omni", "agent"]);
    }

    #[test]
    fn successful_empty_queries_are_cached_and_temporary_gaps_keep_previous_results() {
        let config = config(&["omni", "agent"]);
        let mut cache = KeywordCache::default();
        cache.store(&config, "omni", Vec::new());
        cache.store(&config, "agent", vec![paper("kept", "2026-10-22")]);
        cache.store(&config, "agent", Vec::new());
        cache.store(&config, "agent", vec![paper("old", "2026-10-20")]);
        assert_eq!(cache.batches.len(), 2);
        assert_eq!(cache.merged(&config)[0].title, "kept");
    }

    #[test]
    fn upgrading_a_combined_cache_keeps_papers_readable_during_keyword_initialization() {
        let initial = config(&["omni", "audio"]);
        let mut known = paper("known", "2026-10-20");
        known.title = "Audio analysis".into();
        let unknown = paper("server-only match", "2026-10-20");
        let mut reading = ReadingState {
            scope: scope(&initial), papers: vec![known.clone(), unknown], ..Default::default()
        };
        reading.apply(known, PaperAction::Skip).unwrap();
        assert!(reading.sync_config(&initial));
        // Adding a query must not clear an old flat cache before the network
        // has supplied the per-query provenance introduced in this version.
        let next = config(&["omni", "audio", "agent"]);
        assert!(reading.sync_config(&next));
        assert_eq!(reading.papers.len(), 2);
        assert_eq!(reading.snapshot().skipped.len(), 1);
        assert!(reading.query_cache.batches.is_empty());
        // Deletion still retains locally confirmed matches for missing queries.
        let reduced = config(&["audio", "agent"]);
        reading.sync_config(&reduced);
        assert_eq!(reading.papers.len(), 1);
        assert_eq!(reading.papers[0].title, "Audio analysis");
        assert_eq!(reading.snapshot().skipped.len(), 1);
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
        reading.sync_config(&config); // initialize metadata for a legacy combined cache
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
