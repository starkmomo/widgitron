use std::future::Future;
use std::time::Duration;
use tokio::sync::Mutex;
use tokio::time::Instant;

use crate::models::{ArxivConfig, ArxivPaper};

fn normalized(values: &[String]) -> Vec<String> {
    let mut values: Vec<_> = values.iter().map(|value| value.trim().trim_matches('"').to_lowercase())
        .filter(|value| !value.is_empty()).collect();
    values.sort();
    values.dedup();
    values
}

pub fn query_changed(previous: &ArxivConfig, next: &ArxivConfig) -> bool {
    normalized(&previous.keywords) != normalized(&next.keywords)
        || normalized(&previous.categories) != normalized(&next.categories)
}

#[derive(Clone)]
pub struct RefreshRequest {
    pub config: ArxivConfig,
    pub proxy: Option<String>,
    pub enabled: bool,
    pub generation: u64,
}

impl RefreshRequest {
    fn same_query(&self, other: &Self) -> bool {
        !query_changed(&self.config, &other.config)
            && self.proxy == other.proxy && self.enabled == other.enabled
            && self.generation == other.generation
    }
}

struct Completed {
    request: RefreshRequest,
    finished: Instant,
    next_due: Instant,
    failures: u32,
    result: Result<Vec<ArxivPaper>, String>,
}

pub struct RefreshCoordinator {
    completed: Mutex<Option<Completed>>,
}

impl RefreshCoordinator {
    pub const fn new() -> Self { Self { completed: Mutex::const_new(None) } }

    pub async fn seed_cache(&self, request: RefreshRequest, papers: Vec<ArxivPaper>) {
        let mut completed = self.completed.lock().await;
        if completed.is_none() {
            let finished = Instant::now();
            let next_due = finished + Duration::from_secs(request.config.update_interval.max(5));
            *completed = Some(Completed { request, finished, next_due, failures: 0, result: Ok(papers) });
        }
    }

    /// Only one reading-list fetch runs. Waiters share its result, obsolete
    /// filters are discarded, and the monitor observes the same retry schedule.
    pub async fn refresh<Load, Fetch, FetchFuture, Apply>(
        &self, force: bool, load: Load, fetch: Fetch, apply: Apply,
    ) -> Result<Option<Vec<ArxivPaper>>, String>
    where
        Load: Fn() -> RefreshRequest,
        Fetch: Fn(RefreshRequest) -> FetchFuture,
        FetchFuture: Future<Output = Result<Vec<ArxivPaper>, String>>,
        Apply: Fn(&ArxivConfig, Vec<ArxivPaper>) -> Result<Vec<ArxivPaper>, String>,
    {
        let started = Instant::now();
        let mut completed = self.completed.lock().await;
        loop {
            let request = load();
            if !request.enabled { return Ok(Some(Vec::new())); }
            if let Some(last) = completed.as_mut().filter(|last| last.request.same_query(&request)) {
                if last.request.config.update_interval != request.config.update_interval {
                    last.request.config.update_interval = request.config.update_interval;
                    last.next_due = Instant::now() + Duration::from_secs(request.config.update_interval.max(5));
                }
                if force && (last.finished >= started || last.finished.elapsed() < Duration::from_secs(5)) {
                    return last.result.clone().map(Some);
                }
                if !force && Instant::now() < last.next_due { return Ok(None); }
            }
            let fetched = fetch(request.clone()).await;
            let latest = load();
            if !request.same_query(&latest) { continue; }
            let result = fetched.and_then(|papers| apply(&latest.config, papers));
            let failures = if result.is_ok() { 0 } else {
                completed.as_ref().filter(|last| last.request.same_query(&latest))
                    .map_or(1, |last| last.failures.saturating_add(1))
            };
            let delay = if failures == 0 { latest.config.update_interval.max(5) }
                else { (60_u64 * (1_u64 << failures.saturating_sub(1).min(4))).min(900) };
            let finished = Instant::now();
            *completed = Some(Completed { request: latest, finished,
                next_due: finished + Duration::from_secs(delay), failures, result: result.clone() });
            return result.map(Some);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use std::sync::Mutex as StdMutex;
    use tokio::sync::{oneshot, Notify};

    fn request(keyword: &str) -> RefreshRequest {
        RefreshRequest {
            config: ArxivConfig {
                keywords: vec![keyword.into()],
                ..ArxivConfig::default()
            },
            proxy: None,
            enabled: true,
            generation: 0,
        }
    }

    fn papers(id: &str) -> Vec<ArxivPaper> {
        vec![ArxivPaper {
            id: id.into(),
            title: id.into(),
            summary: String::new(),
            matched_keywords: Vec::new(),
            authors: Vec::new(),
            link: String::new(),
            published: String::new(),
            updated: String::new(),
        }]
    }

    fn ids(papers: &[ArxivPaper]) -> Vec<&str> {
        papers.iter().map(|paper| paper.id.as_str()).collect()
    }

    fn apply_identity(
        _: &ArxivConfig,
        papers: Vec<ArxivPaper>,
    ) -> Result<Vec<ArxivPaper>, String> {
        Ok(papers)
    }

    async fn make_due(coordinator: &RefreshCoordinator) {
        coordinator.completed.lock().await.as_mut().unwrap().next_due =
            Instant::now() - Duration::from_secs(1);
    }

    #[tokio::test]
    async fn concurrent_forced_refreshes_share_one_fetch_and_apply() {
        let coordinator = RefreshCoordinator::new();
        let fetches = AtomicUsize::new(0);
        let applies = AtomicUsize::new(0);
        let fetching = Notify::new();
        let release = Notify::new();
        let (waiter_started, waiter_ready) = oneshot::channel();
        let fetch = |_: RefreshRequest| async {
            fetches.fetch_add(1, Ordering::SeqCst);
            fetching.notify_one();
            release.notified().await;
            Ok(papers("shared"))
        };
        let apply = |_: &ArxivConfig, papers| {
            applies.fetch_add(1, Ordering::SeqCst);
            Ok(papers)
        };
        let first = coordinator.refresh(true, || request("omni"), &fetch, &apply);
        let second = async {
            fetching.notified().await;
            waiter_started.send(()).unwrap();
            coordinator.refresh(true, || request("omni"), &fetch, &apply).await
        };
        let finish = async {
            waiter_ready.await.unwrap();
            release.notify_one();
        };
        let (first, second, ()) = tokio::join!(first, second, finish);
        assert_eq!(ids(&first.unwrap().unwrap()), vec!["shared"]);
        assert_eq!(ids(&second.unwrap().unwrap()), vec!["shared"]);
        assert_eq!(fetches.load(Ordering::SeqCst), 1);
        assert_eq!(applies.load(Ordering::SeqCst), 1);
    }

    async fn assert_obsolete_fetch_is_discarded(old_fails: bool) {
        let coordinator = RefreshCoordinator::new();
        let current = StdMutex::new(request("old"));
        let fetches = AtomicUsize::new(0);
        let applied = StdMutex::new(Vec::new());
        let fetching_old = Notify::new();
        let release_old = Notify::new();
        let fetch = |request: RefreshRequest| {
            let fetches = &fetches;
            let fetching_old = &fetching_old;
            let release_old = &release_old;
            async move {
                fetches.fetch_add(1, Ordering::SeqCst);
                if request.config.keywords == ["old"] {
                    fetching_old.notify_one();
                    release_old.notified().await;
                    if old_fails {
                        return Err("obsolete error must not escape".into());
                    }
                    return Ok(papers("obsolete paper"));
                }
                Ok(papers("current paper"))
            }
        };
        let refresh = coordinator.refresh(
            true,
            || current.lock().unwrap().clone(),
            fetch,
            |config, papers| {
                applied.lock().unwrap().push((config.keywords.clone(), papers[0].id.clone()));
                Ok(papers)
            },
        );
        let change_filters = async {
            fetching_old.notified().await;
            *current.lock().unwrap() = request("new");
            release_old.notify_one();
        };
        let (result, ()) = tokio::join!(refresh, change_filters);
        assert_eq!(ids(&result.unwrap().unwrap()), vec!["current paper"]);
        assert_eq!(fetches.load(Ordering::SeqCst), 2);
        assert_eq!(*applied.lock().unwrap(), vec![(vec!["new".to_string()], "current paper".to_string())]);
        let completed = coordinator.completed.lock().await;
        let completed = completed.as_ref().unwrap();
        assert_eq!(completed.failures, 0);
        assert_eq!(completed.request.config.keywords, vec!["new"]);
    }

    #[tokio::test]
    async fn filter_change_during_fetch_discards_old_papers() {
        assert_obsolete_fetch_is_discarded(false).await;
    }

    #[tokio::test]
    async fn filter_change_during_fetch_discards_old_error() {
        assert_obsolete_fetch_is_discarded(true).await;
    }

    #[tokio::test]
    async fn scheduled_refresh_before_due_does_not_fetch_or_apply() {
        let coordinator = RefreshCoordinator::new();
        coordinator.seed_cache(request("omni"), papers("cached")).await;
        let fetches = AtomicUsize::new(0);
        let applies = AtomicUsize::new(0);
        let result = coordinator.refresh(
            false,
            || request("omni"),
            |_| async {
                fetches.fetch_add(1, Ordering::SeqCst);
                Ok(papers("unexpected"))
            },
            |_, papers| {
                applies.fetch_add(1, Ordering::SeqCst);
                Ok(papers)
            },
        ).await.unwrap();
        assert!(result.is_none());
        assert_eq!(fetches.load(Ordering::SeqCst), 0);
        assert_eq!(applies.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn interval_change_only_reschedules_the_next_refresh() {
        let coordinator = RefreshCoordinator::new();
        let mut initial = request("omni");
        initial.config.update_interval = 60;
        coordinator.seed_cache(initial.clone(), papers("cached")).await;
        make_due(&coordinator).await;
        let finished = coordinator.completed.lock().await.as_ref().unwrap().finished;
        let mut next = initial;
        next.config.update_interval = 600;
        let fetches = AtomicUsize::new(0);
        let before = Instant::now();
        let result = coordinator.refresh(
            false,
            || next.clone(),
            |_| async {
                fetches.fetch_add(1, Ordering::SeqCst);
                Ok(papers("unexpected"))
            },
            apply_identity,
        ).await.unwrap();
        let after = Instant::now();
        assert!(result.is_none());
        assert_eq!(fetches.load(Ordering::SeqCst), 0);
        let completed = coordinator.completed.lock().await;
        let completed = completed.as_ref().unwrap();
        assert_eq!(completed.finished, finished);
        assert_eq!(completed.request.config.update_interval, 600);
        assert!(completed.next_due >= before + Duration::from_secs(600));
        assert!(completed.next_due <= after + Duration::from_secs(600));
        assert_eq!(ids(completed.result.as_ref().unwrap()), vec!["cached"]);
    }

    #[tokio::test]
    async fn failures_back_off_and_a_success_resets_the_schedule() {
        let coordinator = RefreshCoordinator::new();
        let fetches = AtomicUsize::new(0);
        let failing = AtomicBool::new(true);
        let fetch = |_: RefreshRequest| async {
            fetches.fetch_add(1, Ordering::SeqCst);
            if failing.load(Ordering::SeqCst) {
                Err("rate limited".to_string())
            } else {
                Ok(papers("recovered"))
            }
        };
        for (index, delay) in [60, 120, 240, 480, 900, 900].into_iter().enumerate() {
            if index > 0 {
                make_due(&coordinator).await;
            }
            let result = coordinator.refresh(false, || request("omni"), &fetch, apply_identity).await;
            assert!(matches!(result, Err(ref error) if error == "rate limited"));
            {
                let completed = coordinator.completed.lock().await;
                let completed = completed.as_ref().unwrap();
                assert_eq!(completed.failures, index as u32 + 1);
                assert_eq!(completed.next_due - completed.finished, Duration::from_secs(delay));
            }
            // A monitor tick during backoff must not pile up another request.
            assert!(coordinator.refresh(false, || request("omni"), &fetch, apply_identity)
                .await.unwrap().is_none());
            assert_eq!(fetches.load(Ordering::SeqCst), index + 1);
        }
        failing.store(false, Ordering::SeqCst);
        make_due(&coordinator).await;
        let result = coordinator.refresh(false, || request("omni"), &fetch, apply_identity)
            .await.unwrap().unwrap();
        assert_eq!(ids(&result), vec!["recovered"]);
        assert_eq!(fetches.load(Ordering::SeqCst), 7);
        let completed = coordinator.completed.lock().await;
        let completed = completed.as_ref().unwrap();
        assert_eq!(completed.failures, 0);
        assert_eq!(completed.next_due - completed.finished,
            Duration::from_secs(ArxivConfig::default().update_interval));
    }

    #[tokio::test]
    async fn disabled_service_never_fetches_even_when_forced() {
        let coordinator = RefreshCoordinator::new();
        let mut disabled = request("omni");
        disabled.enabled = false;
        let fetches = AtomicUsize::new(0);
        for force in [false, true] {
            let result = coordinator.refresh(
                force,
                || disabled.clone(),
                |_| async {
                    fetches.fetch_add(1, Ordering::SeqCst);
                    Ok(papers("unexpected"))
                },
                |_, _| panic!("disabled service must not apply results"),
            ).await.unwrap().unwrap();
            assert!(result.is_empty());
        }
        assert_eq!(fetches.load(Ordering::SeqCst), 0);
        assert!(coordinator.completed.lock().await.is_none());
    }

    #[tokio::test]
    async fn reenabled_service_generation_fetches_instead_of_reusing_cleared_cache() {
        let coordinator = RefreshCoordinator::new();
        let initial = request("omni");
        coordinator.seed_cache(initial.clone(), papers("old cache")).await;
        let mut disabled = initial;
        disabled.enabled = false;
        disabled.generation = 1;
        assert!(coordinator.refresh(
            true, || disabled.clone(), |_| async { Ok(papers("unexpected")) }, apply_identity,
        ).await.unwrap().unwrap().is_empty());
        let mut reenabled = disabled;
        reenabled.enabled = true;
        reenabled.generation = 2;
        let fetches = AtomicUsize::new(0);
        let result = coordinator.refresh(
            true,
            || reenabled.clone(),
            |_| async {
                fetches.fetch_add(1, Ordering::SeqCst);
                Ok(papers("fresh after enabling"))
            },
            apply_identity,
        ).await.unwrap().unwrap();
        assert_eq!(ids(&result), vec!["fresh after enabling"]);
        assert_eq!(fetches.load(Ordering::SeqCst), 1);
        assert_eq!(coordinator.completed.lock().await.as_ref().unwrap().request.generation, 2);
    }

    #[tokio::test]
    async fn changing_proxy_bypasses_a_recent_cached_completion() {
        let coordinator = RefreshCoordinator::new();
        coordinator.seed_cache(request("omni"), papers("old route")).await;
        let mut changed = request("omni");
        changed.proxy = Some("http://127.0.0.1:7890".into());
        let fetches = AtomicUsize::new(0);
        let result = coordinator.refresh(
            true,
            || changed.clone(),
            |_| async {
                fetches.fetch_add(1, Ordering::SeqCst);
                Ok(papers("new route"))
            },
            apply_identity,
        ).await.unwrap().unwrap();
        assert_eq!(ids(&result), vec!["new route"]);
        assert_eq!(fetches.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn query_identity_ignores_order_case_duplicates_and_display_settings() {
        let mut previous = request(" Omni ").config;
        previous.keywords.push("\"agent RL\"".into());
        previous.categories = vec!["cs.AI".into(), "cs.LG".into()];
        let mut next = previous.clone();
        next.keywords = vec!["agent rl".into(), "omni".into(), "OMNI".into()];
        next.categories = vec!["CS.LG".into(), "cs.AI".into()];
        next.show_card_hints = Some(false);
        next.update_interval += 60;
        assert!(!query_changed(&previous, &next));
        next.keywords.push("different query".into());
        assert!(query_changed(&previous, &next));
    }
}
