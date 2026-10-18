use chrono::{DateTime, Datelike, Local, NaiveDate, TimeZone, Utc};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

use crate::config_store;
use crate::models::{AppConfig, ArxivConfig, ArxivPaper, GlobalState};

const ARXIV_PAGE_SIZE: usize = 100;
const ARXIV_MIN_PAPERS_PER_KEYWORD: usize = 10;
const ARXIV_BROWSE_CACHE_FILE: &str = "arxiv_browse_cache.json";
const ARXIV_BROWSE_CACHE_VERSION: u8 = 1;
const ARXIV_BROWSE_MAX_CACHED_PAGES: usize = 24;
static BROWSE_FETCH_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
static API_REQUEST_LOCK: tokio::sync::Mutex<Option<tokio::time::Instant>> =
    tokio::sync::Mutex::const_new(None);

#[derive(Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct ArxivPaperPage {
    papers: Vec<ArxivPaper>,
    data_date: Option<String>,
    total: usize,
    page: usize,
    page_size: usize,
    fresh: bool,
}

#[derive(Default, serde::Serialize, serde::Deserialize)]
struct CachedPaperPage {
    query: String,
    requested_date: Option<String>,
    fetched_at: i64,
    result: ArxivPaperPage,
}

#[derive(Default, serde::Serialize, serde::Deserialize)]
struct BrowseCache {
    version: u8,
    pages: Vec<CachedPaperPage>,
}

fn cached_paper_page(
    cache: &BrowseCache,
    query: &str,
    date: Option<&str>,
    page: usize,
    now: i64,
) -> Option<ArxivPaperPage> {
    if cache.version != ARXIV_BROWSE_CACHE_VERSION {
        return None;
    }
    let cached = cache.pages.iter().find(|cached| {
        cached.query == query
            && cached.requested_date.as_deref() == date
            && cached.result.page == page
    })?;
    let mut result = cached.result.clone();
    // Historical dates are stable; the automatic latest-day lookup expires sooner.
    let ttl = if date.is_some() { 86400 } else { 3600 };
    result.fresh = (0..ttl).contains(&(now - cached.fetched_at));
    Some(result)
}

pub fn get_paper_page_cache(
    app: &AppHandle,
    categories: &[String],
    keywords: &[String],
    date: Option<&str>,
    page: usize,
) -> Result<Option<ArxivPaperPage>, String> {
    validate_browse_request(date, page)?;
    Ok(cached_paper_page(
        &config_store::read_config::<BrowseCache>(app, ARXIV_BROWSE_CACHE_FILE),
        &build_browse_query(categories, keywords),
        date,
        page,
        Utc::now().timestamp(),
    ))
}

fn normalize_keyword(keyword: &str) -> String {
    keyword.trim().trim_matches('"').to_lowercase()
}

fn keyword_terms(keyword: &str) -> Vec<String> {
    normalize_keyword(keyword)
        .split_whitespace()
        .map(|term| term.trim_matches(|c: char| !c.is_alphanumeric()))
        .filter(|term| !term.is_empty())
        .map(ToString::to_string)
        .collect()
}

fn get_unique_keywords(keywords: &[String]) -> Vec<String> {
    let mut seen = Vec::new();
    let mut unique = Vec::new();
    for keyword in keywords {
        let normalized = normalize_keyword(keyword);
        if normalized.is_empty() || seen.iter().any(|item| item == &normalized) {
            continue;
        }
        seen.push(normalized);
        unique.push(keyword.trim().to_string());
    }
    unique
}

fn arxiv_keyword_query(keyword: &str) -> Option<String> {
    let terms = keyword_terms(keyword);
    match terms.as_slice() {
        [] => None,
        [term] => Some(format!("all:{}", term)),
        _ => Some(format!(
            "({})",
            terms
                .iter()
                .map(|term| format!("all:{}", term))
                .collect::<Vec<_>>()
                .join(" AND ")
        )),
    }
}

pub(crate) fn has_reading_keywords(keywords: &[String]) -> bool {
    keywords.iter().any(|keyword| arxiv_keyword_query(keyword).is_some())
}

fn paper_matches_keyword(haystack: &str, keyword: &str) -> bool {
    let normalized = normalize_keyword(keyword);
    if normalized.is_empty() {
        return false;
    }
    if haystack.contains(&normalized) {
        return true;
    }

    let terms = keyword_terms(keyword);
    !terms.is_empty() && terms.iter().all(|term| haystack.contains(term))
}

fn matched_keywords_for_paper(paper: &ArxivPaper, keywords: &[String]) -> Vec<String> {
    let haystack = format!("{} {}", paper.title, paper.summary).to_lowercase();
    keywords
        .iter()
        .filter_map(|keyword| {
            if paper_matches_keyword(&haystack, keyword) {
                Some(keyword.trim().to_string())
            } else {
                None
            }
        })
        .collect()
}

fn today_local_bounds() -> Result<(DateTime<Local>, DateTime<Local>), String> {
    let today = Local::now().date_naive();
    let tomorrow = today
        .succ_opt()
        .ok_or_else(|| "Failed to calculate tomorrow for Arxiv query".to_string())?;
    let start_local = Local
        .with_ymd_and_hms(today.year(), today.month(), today.day(), 0, 0, 0)
        .earliest()
        .ok_or_else(|| "Failed to calculate today's local start for Arxiv query".to_string())?;
    let end_local = Local
        .with_ymd_and_hms(tomorrow.year(), tomorrow.month(), tomorrow.day(), 0, 0, 0)
        .earliest()
        .ok_or_else(|| "Failed to calculate tomorrow's local start for Arxiv query".to_string())?;

    Ok((start_local, end_local))
}

fn paper_updated_at(paper: &ArxivPaper) -> Option<DateTime<Local>> {
    DateTime::parse_from_rfc3339(&paper.updated)
        .or_else(|_| DateTime::parse_from_rfc3339(&paper.published))
        .ok()
        .map(|date| date.with_timezone(&Local))
}

fn build_category_query(categories: &[String]) -> String {
    if categories.is_empty() {
        "cat:cs*".to_string()
    } else {
        let joined = categories
            .iter()
            .map(|c| format!("cat:{}*", c.trim()))
            .collect::<Vec<_>>()
            .join(" OR ");
        format!("({})", joined)
    }
}

fn merge_papers(target: &mut Vec<ArxivPaper>, source: Vec<ArxivPaper>) {
    for paper in source {
        if let Some(existing) = target.iter_mut().find(|existing| existing.id == paper.id) {
            for keyword in paper.matched_keywords {
                if !existing.matched_keywords.iter().any(|existing_keyword| {
                    normalize_keyword(existing_keyword) == normalize_keyword(&keyword)
                }) {
                    existing.matched_keywords.push(keyword);
                }
            }
        } else {
            target.push(paper);
        }
    }
}

fn sort_papers_by_updated_desc(papers: &mut [ArxivPaper]) {
    papers.sort_by(|a, b| paper_updated_at(b).cmp(&paper_updated_at(a)));
}

fn parse_arxiv_response(
    xml: &str,
    keywords: &[String],
) -> Result<(Vec<ArxivPaper>, Option<usize>), String> {
    let mut reader = quick_xml::Reader::from_str(xml);
    reader.config_mut().trim_text(true);

    let mut buf = Vec::new();
    let mut papers = Vec::new();
    let mut total_results = None;
    let mut feed_complete = false;

    let mut current_paper = ArxivPaper {
        id: String::new(),
        title: String::new(),
        summary: String::new(),
        matched_keywords: Vec::new(),
        authors: Vec::new(),
        link: String::new(),
        published: String::new(),
        updated: String::new(),
    };
    let mut in_entry = false;
    let mut current_tag = String::new();
    let mut in_author = false;

    use quick_xml::events::Event;
    loop {
        match reader.read_event_into(&mut buf) {
            Err(e) => return Err(format!("Error parsing arxiv XML: {}", e)),
            Ok(Event::Eof) => break,
            Ok(Event::Start(e)) => {
                let name = String::from_utf8_lossy(e.local_name().as_ref()).into_owned();
                if name == "entry" {
                    in_entry = true;
                    current_paper = ArxivPaper {
                        id: String::new(),
                        title: String::new(),
                        summary: String::new(),
                        matched_keywords: Vec::new(),
                        authors: Vec::new(),
                        link: String::new(),
                        published: String::new(),
                        updated: String::new(),
                    };
                } else if in_entry {
                    if name == "author" {
                        in_author = true;
                    } else if name == "name" && in_author {
                        current_paper.authors.push(String::new());
                    } else if name == "link" {
                        let mut is_pdf = false;
                        let mut href = String::new();
                        for attr in e.attributes() {
                            if let Ok(a) = attr {
                                let key = a.key.local_name();
                                let k = String::from_utf8_lossy(key.as_ref());
                                let v = String::from_utf8_lossy(a.value.as_ref());
                                if k == "title" && v == "pdf" {
                                    is_pdf = true;
                                }
                                if k == "href" {
                                    href = v.into_owned();
                                }
                            }
                        }
                        if is_pdf {
                            current_paper.link = href.replace("http://", "https://");
                        } else if current_paper.link.is_empty() {
                            current_paper.link = href.replace("http://", "https://");
                        }
                    }
                }
                current_tag = name;
            }
            Ok(Event::Empty(e)) => {
                let name = String::from_utf8_lossy(e.local_name().as_ref()).into_owned();
                if in_entry && name == "link" {
                    let mut is_pdf = false;
                    let mut href = String::new();
                    for attr in e.attributes() {
                        if let Ok(a) = attr {
                            let key = a.key.local_name();
                            let k = String::from_utf8_lossy(key.as_ref());
                            let v = String::from_utf8_lossy(a.value.as_ref());
                            if k == "title" && v == "pdf" {
                                is_pdf = true;
                            }
                            if k == "href" {
                                href = v.into_owned();
                            }
                        }
                    }
                    if is_pdf {
                        current_paper.link = href.replace("http://", "https://");
                    } else if current_paper.link.is_empty() {
                        current_paper.link = href.replace("http://", "https://");
                    }
                }
            }
            Ok(Event::End(e)) => {
                let name = String::from_utf8_lossy(e.local_name().as_ref()).into_owned();
                if name == "feed" {
                    feed_complete = true;
                } else if name == "entry" {
                    in_entry = false;
                    if current_paper.id.contains("arxiv.org/api/errors") {
                        return Err(format!("Arxiv API error: {}", current_paper.summary));
                    }
                    current_paper.matched_keywords =
                        matched_keywords_for_paper(&current_paper, keywords);
                    papers.push(current_paper.clone());
                } else if name == "author" {
                    in_author = false;
                }
                current_tag = String::new();
            }
            Ok(Event::Text(e)) => {
                let text = String::from_utf8_lossy(e.as_ref()).into_owned();
                if in_entry {
                    match current_tag.as_str() {
                        "id" => current_paper.id += &text,
                        "title" => {
                            current_paper.title += &text.replace("\n", " ").replace("  ", " ")
                        }
                        "summary" => {
                            current_paper.summary += &text.replace("\n", " ").replace("  ", " ")
                        }
                        "published" => current_paper.published += &text,
                        "updated" => current_paper.updated += &text,
                        "name" if in_author => {
                            if let Some(last) = current_paper.authors.last_mut() {
                                *last += &text.trim();
                            }
                        }
                        _ => {}
                    }
                } else if current_tag == "totalResults" {
                    total_results = text.trim().parse::<usize>().ok();
                }
            }
            _ => {}
        }
        buf.clear();
    }

    if !feed_complete || in_entry {
        return Err("Incomplete or invalid arXiv response".to_string());
    }
    Ok((papers, total_results))
}

fn collect_query_page(
    papers: &mut Vec<ArxivPaper>,
    page: Vec<ArxivPaper>,
    today_start: DateTime<Local>,
    tomorrow_start: DateTime<Local>,
    minimum_count: Option<usize>,
) -> bool {
    for paper in page {
        match paper_updated_at(&paper) {
            Some(updated) if updated >= today_start && updated < tomorrow_start => {
                papers.push(paper)
            }
            Some(updated) if updated < today_start => {
                if minimum_count.is_some_and(|min| papers.len() < min) {
                    papers.push(paper);
                }
                if minimum_count.map_or(true, |min| papers.len() >= min) {
                    return true;
                }
            }
            _ => {}
        }
    }
    false
}

async fn fetch_arxiv_page(
    client: &reqwest::Client,
    query: &str,
    start: usize,
    keywords: &[String],
) -> Result<(Vec<ArxivPaper>, Option<usize>), String> {
    fetch_arxiv_page_with_options(
        client,
        query,
        start,
        keywords,
        ARXIV_PAGE_SIZE,
        "lastUpdatedDate",
    )
    .await
}

async fn fetch_arxiv_page_with_options(
    client: &reqwest::Client,
    query: &str,
    start: usize,
    keywords: &[String],
    page_size: usize,
    sort_by: &str,
) -> Result<(Vec<ArxivPaper>, Option<usize>), String> {
    let start_param = start.to_string();
    let page_size_param = page_size.to_string();
    let params = [
        ("search_query", query),
        ("start", start_param.as_str()),
        ("max_results", page_size_param.as_str()),
        ("sortBy", sort_by),
        ("sortOrder", "descending"),
    ];
    let url = reqwest::Url::parse_with_params("https://export.arxiv.org/api/query", &params)
        .map_err(|e| e.to_string())?;

    // Pace all API requests, including background keywords and manual page changes.
    let mut last_request = API_REQUEST_LOCK.lock().await;
    if let Some(last) = *last_request {
        tokio::time::sleep(Duration::from_secs(3).saturating_sub(last.elapsed())).await;
    }
    *last_request = Some(tokio::time::Instant::now());
    let res = client.get(url).send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("Arxiv API returned HTTP status {}", res.status()));
    }
    let xml = res.text().await.map_err(|e| e.to_string())?;
    parse_arxiv_response(&xml, keywords)
}

async fn fetch_papers_for_query(
    client: &reqwest::Client,
    query: &str,
    keywords: &[String],
    today_start: DateTime<Local>,
    tomorrow_start: DateTime<Local>,
    minimum_count: Option<usize>,
) -> Result<Vec<ArxivPaper>, String> {
    let mut papers = Vec::new();
    let mut start = 0usize;
    let mut total_results = None;

    loop {
        let (page_papers, page_total_results) =
            fetch_arxiv_page(client, query, start, keywords).await?;

        if total_results.is_none() {
            total_results = page_total_results;
        }

        let fetched_count = page_papers.len();
        let should_stop = collect_query_page(
            &mut papers,
            page_papers,
            today_start,
            tomorrow_start,
            minimum_count,
        );

        if should_stop || fetched_count < ARXIV_PAGE_SIZE {
            break;
        }

        start += ARXIV_PAGE_SIZE;
        if total_results.is_some_and(|total| start >= total) {
            break;
        }
        // The all-papers view can span many pages. Pace requests rather than
        // issuing a burst against the public API.
        tokio::time::sleep(Duration::from_secs(3)).await;
    }

    Ok(papers)
}

fn arxiv_client(app: &AppHandle) -> Result<reqwest::Client, String> {
    let app_config = config_store::read_config::<AppConfig>(app, "app_config.json");
    let mut client_builder = reqwest::Client::builder()
        .user_agent("Widgitron/1.0 (contact: researcher@widgitron.app)")
        .timeout(Duration::from_secs(30));

    if let Some(proxy_url) = app_config
        .arxiv_proxy
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let proxy = reqwest::Proxy::all(proxy_url)
            .map_err(|e| format!("Invalid Arxiv proxy '{}': {}", proxy_url, e))?;
        client_builder = client_builder.proxy(proxy);
    }

    client_builder.build().map_err(|e| e.to_string())
}

fn validate_browse_request(date: Option<&str>, page: usize) -> Result<(), String> {
    if page == 0 || page > 300 {
        return Err("Invalid arXiv page number".to_string());
    }
    if let Some(date) = date {
        let parsed = NaiveDate::parse_from_str(date, "%Y-%m-%d")
            .map_err(|_| "Invalid arXiv submission date".to_string())?;
        if parsed.to_string() != date {
            return Err("Invalid arXiv submission date".to_string());
        }
    } else if page != 1 {
        return Err("Choose an arXiv date before requesting another page".to_string());
    }
    Ok(())
}

fn build_browse_query(categories: &[String], keywords: &[String]) -> String {
    let categories = build_category_query(categories);
    let terms: Vec<_> = get_unique_keywords(keywords)
        .iter()
        .filter_map(|keyword| arxiv_keyword_query(keyword))
        .collect();
    if terms.is_empty() {
        categories
    } else {
        format!("{} AND ({})", categories, terms.join(" OR "))
    }
}

fn query_for_submission_date(query: &str, date: &str) -> Result<String, String> {
    validate_browse_request(Some(date), 1)?;
    let day = date.replace('-', "");
    Ok(format!(
        "{} AND submittedDate:[{}0000 TO {}2359]",
        query, day, day
    ))
}

async fn fetch_browse_page(
    client: &reqwest::Client,
    query: &str,
    keywords: &[String],
    requested_date: Option<&str>,
    page: usize,
) -> Result<ArxivPaperPage, String> {
    validate_browse_request(requested_date, page)?;
    let data_date = if let Some(date) = requested_date {
        Some(date.to_string())
    } else {
        // Find the latest available submission day, rather than guessing today/yesterday.
        let (recent, total) =
            fetch_arxiv_page_with_options(client, query, 0, keywords, 1, "submittedDate").await?;
        if recent.is_empty() {
            if total.is_some_and(|total| total > 0) {
                return Err("arXiv returned an incomplete page. Please refresh again.".to_string());
            }
            None
        } else {
            Some(
                DateTime::parse_from_rfc3339(&recent[0].published)
                    .map_err(|_| "arXiv returned an invalid submission date".to_string())?
                    .with_timezone(&Utc)
                    .date_naive()
                    .to_string(),
            )
        }
    };
    let Some(date) = data_date else {
        return Ok(ArxivPaperPage {
            page,
            page_size: ARXIV_PAGE_SIZE,
            fresh: true,
            ..Default::default()
        });
    };
    let dated_query = query_for_submission_date(query, &date)?;
    let start = (page - 1) * ARXIV_PAGE_SIZE;
    let (papers, total) = fetch_arxiv_page_with_options(
        client,
        &dated_query,
        start,
        keywords,
        ARXIV_PAGE_SIZE,
        "submittedDate",
    )
    .await?;
    let total = total.ok_or_else(|| "arXiv did not return the paper count".to_string())?;
    if papers.is_empty() && total > start {
        return Err("arXiv returned an incomplete page. Please refresh again.".to_string());
    }
    Ok(ArxivPaperPage {
        papers,
        data_date: Some(date),
        total,
        page,
        page_size: ARXIV_PAGE_SIZE,
        fresh: true,
    })
}

pub async fn fetch_paper_page(
    app: &AppHandle,
    categories: &[String],
    keywords: &[String],
    date: Option<&str>,
    page: usize,
    force: bool,
) -> Result<ArxivPaperPage, String> {
    validate_browse_request(date, page)?;
    let _guard = BROWSE_FETCH_LOCK.lock().await;
    let query = build_browse_query(categories, keywords);
    let mut cache = config_store::read_config::<BrowseCache>(app, ARXIV_BROWSE_CACHE_FILE);
    if !force {
        if let Some(result) = cached_paper_page(&cache, &query, date, page, Utc::now().timestamp())
            .filter(|result| result.fresh)
        {
            return Ok(result);
        }
    }
    let result = fetch_browse_page(&arxiv_client(app)?, &query, keywords, date, page).await?;
    if cache.version != ARXIV_BROWSE_CACHE_VERSION {
        cache = BrowseCache {
            version: ARXIV_BROWSE_CACHE_VERSION,
            pages: Vec::new(),
        };
    }
    cache.pages.retain(|cached| {
        !(cached.query == query
            && cached.requested_date.as_deref() == date
            && cached.result.page == page)
    });
    cache.pages.push(CachedPaperPage {
        query,
        requested_date: date.map(str::to_string),
        fetched_at: Utc::now().timestamp(),
        result: result.clone(),
    });
    if cache.pages.len() > ARXIV_BROWSE_MAX_CACHED_PAGES {
        cache
            .pages
            .drain(..cache.pages.len() - ARXIV_BROWSE_MAX_CACHED_PAGES);
    }
    if let Err(error) = config_store::write_config(app, ARXIV_BROWSE_CACHE_FILE, &cache) {
        log::warn!("Could not cache the arXiv page: {error}");
    }
    Ok(result)
}

pub async fn perform_arxiv_fetch(
    app: &AppHandle,
    state: &GlobalState,
) -> Result<Vec<ArxivPaper>, String> {
    let config = config_store::read_config::<ArxivConfig>(app, "arxiv_config.json");
    if !has_reading_keywords(&config.keywords) {
        let papers = crate::arxiv_library::replace_batch(app, state, Vec::new(), &config)?;
        let _ = app.emit("arxiv_error", "");
        return Ok(papers);
    }
    let client = arxiv_client(app)?;

    let kws = &config.keywords;
    let cats = &config.categories;
    let cat_query = build_category_query(cats);
    let (today_start, tomorrow_start) = today_local_bounds()?;

    let mut papers = Vec::new();

    for keyword in get_unique_keywords(kws) {
        if let Some(keyword_query) = arxiv_keyword_query(&keyword) {
            let query = format!("{} AND {}", cat_query, keyword_query);
            let keyword_papers = fetch_papers_for_query(
                &client,
                &query,
                kws,
                today_start,
                tomorrow_start,
                Some(ARXIV_MIN_PAPERS_PER_KEYWORD),
            )
            .await?;
            merge_papers(&mut papers, keyword_papers);
        }
    }
    sort_papers_by_updated_desc(&mut papers);

    let papers = crate::arxiv_library::replace_batch(app, state, papers, &config)?;
    let _ = app.emit("arxiv_error", "");

    Ok(papers)
}

pub async fn start_arxiv_monitor(app: AppHandle, state: std::sync::Arc<GlobalState>) {
    // Populate state from cache on startup if empty
    {
        if let Ok(mut state_papers) = state.arxiv_papers.lock() {
            if state_papers.is_empty() {
                let cached_papers =
                    config_store::read_config::<Vec<ArxivPaper>>(&app, "arxiv_cache.json");
                if !cached_papers.is_empty() {
                    *state_papers = cached_papers;
                }
            }
        }
    }

    // Startup delay to let frontend initialize cleanly
    tokio::time::sleep(Duration::from_secs(4)).await;

    let mut is_startup = true;
    let mut backoff_secs = 60;

    loop {
        let app_config = config_store::read_config::<AppConfig>(&app, "app_config.json");
        let config = config_store::read_config::<ArxivConfig>(&app, "arxiv_config.json");

        let interval = config.update_interval;

        if !app_config.arxiv_enabled.unwrap_or(true) {
            if let Ok(mut state_papers) = state.arxiv_papers.lock() {
                state_papers.clear();
            }
            // Clear cache file too
            let _ = config_store::write_config(&app, "arxiv_cache.json", &Vec::<ArxivPaper>::new());
            let _ = app.emit("arxiv_update", Vec::<ArxivPaper>::new());

            for _ in 0..interval {
                let ac = config_store::read_config::<AppConfig>(&app, "app_config.json");
                if ac.arxiv_enabled.unwrap_or(true) {
                    break;
                }
                tokio::time::sleep(Duration::from_secs(1)).await;
            }
            is_startup = false;
            continue;
        }

        let mut skip_fetch = false;
        if is_startup {
            is_startup = false;
            let cache_path = crate::utils::get_config_path(&app, "arxiv_cache.json");
            if let Ok(metadata) = std::fs::metadata(&cache_path) {
                if let Ok(modified) = metadata.modified() {
                    if let Ok(elapsed) = modified.elapsed() {
                        let has_cached_papers =
                            !config_store::read_config::<Vec<ArxivPaper>>(&app, "arxiv_cache.json")
                                .is_empty();
                        if elapsed < Duration::from_secs(1800) && has_cached_papers {
                            // 30 minutes
                            skip_fetch = true;
                            log::info!(
                                "Arxiv cache is fresh (< 30m). Skipping initial fetch on startup."
                            );
                        }
                    }
                }
            }
        }

        if !skip_fetch {
            match perform_arxiv_fetch(&app, &state).await {
                Ok(_) => {
                    // Success: reset backoff
                    backoff_secs = 60;
                }
                Err(e) => {
                    log::error!(
                        "Error fetching Arxiv: {}. Retrying in {}s.",
                        e,
                        backoff_secs
                    );
                    let _ = app.emit("arxiv_error", e.clone());
                    let cached_papers = {
                        if let Ok(state_papers) = state.arxiv_papers.lock() {
                            if !state_papers.is_empty() {
                                state_papers.clone()
                            } else {
                                config_store::read_config::<Vec<ArxivPaper>>(
                                    &app,
                                    "arxiv_cache.json",
                                )
                            }
                        } else {
                            config_store::read_config::<Vec<ArxivPaper>>(&app, "arxiv_cache.json")
                        }
                    };
                    if !cached_papers.is_empty() {
                        let _ = app.emit("arxiv_update", &cached_papers);
                    }
                    tokio::time::sleep(Duration::from_secs(backoff_secs)).await;
                    // Exponential backoff: double the sleep time up to 15 minutes (900s)
                    backoff_secs = std::cmp::min(backoff_secs * 2, 900);
                    continue;
                }
            }
        }

        let last_config = config_store::read_config::<ArxivConfig>(&app, "arxiv_config.json");
        let check_interval = 5;
        let loops = interval / check_interval;
        for _ in 0..loops {
            tokio::time::sleep(Duration::from_secs(check_interval)).await;
            let ac = config_store::read_config::<AppConfig>(&app, "app_config.json");
            if !ac.arxiv_enabled.unwrap_or(true) {
                break;
            }

            let current_config =
                config_store::read_config::<ArxivConfig>(&app, "arxiv_config.json");
            if current_config.keywords != last_config.keywords
                || current_config.categories != last_config.categories
                || current_config.update_interval != last_config.update_interval
            {
                break;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn paper(id: usize, updated: DateTime<Local>) -> ArxivPaper {
        ArxivPaper {
            id: format!("https://arxiv.org/abs/2610.{id:05}v1"),
            title: "A paper unrelated to the configured keyword".into(),
            summary: "An abstract about a different research area".into(),
            matched_keywords: Vec::new(),
            authors: vec!["Researcher".into()],
            link: String::new(),
            published: updated.to_rfc3339(),
            updated: updated.to_rfc3339(),
        }
    }

    #[test]
    fn reading_queue_requires_searchable_keywords() {
        assert!(!has_reading_keywords(&[]));
        assert!(!has_reading_keywords(&["  ".into(), "\"\"".into(), "***".into()]));
        assert!(has_reading_keywords(&["omni".into()]));
        assert!(has_reading_keywords(&["agentic rl".into()]));
        assert!(has_reading_keywords(&["人工智能".into()]));
    }

    #[test]
    fn date_queries_use_utc_submission_ranges_and_preserve_keyword_filters() {
        let query = build_browse_query(&["cs.AI".into()], &["omni".into(), "agentic rl".into()]);
        assert_eq!(
            query,
            "(cat:cs.AI*) AND (all:omni OR (all:agentic AND all:rl))"
        );
        assert_eq!(query_for_submission_date(&query, "2026-10-08").unwrap(),
            "(cat:cs.AI*) AND (all:omni OR (all:agentic AND all:rl)) AND submittedDate:[202610080000 TO 202610082359]");
        assert_eq!(build_browse_query(&["cs".into()], &[]), "(cat:cs*)");
        assert!(query_for_submission_date(&query, "2026-02-30").is_err());
        assert!(validate_browse_request(None, 2).is_err());
        assert!(validate_browse_request(Some("2026-10-08"), 0).is_err());
    }

    #[test]
    fn page_cache_is_isolated_by_date_keywords_and_page() {
        let cache = BrowseCache {
            version: ARXIV_BROWSE_CACHE_VERSION,
            pages: vec![CachedPaperPage {
                query: "cat:cs* AND all:omni".into(),
                requested_date: Some("2026-10-08".into()),
                fetched_at: 100,
                result: ArxivPaperPage {
                    page: 2,
                    total: 137,
                    data_date: Some("2026-10-08".into()),
                    papers: vec![paper(101, Local::now())],
                    ..Default::default()
                },
            }],
        };
        let query = "cat:cs* AND all:omni";
        let found = cached_paper_page(&cache, query, Some("2026-10-08"), 2, 200).unwrap();
        assert!(found.fresh);
        assert_eq!(found.total, 137);
        assert_eq!(found.papers.len(), 1);
        assert!(cached_paper_page(&cache, query, Some("2026-10-09"), 2, 200).is_none());
        assert!(cached_paper_page(&cache, query, Some("2026-10-08"), 1, 200).is_none());
        assert!(cached_paper_page(&cache, "cat:cs*", Some("2026-10-08"), 2, 200).is_none());
        assert!(
            !cached_paper_page(&cache, query, Some("2026-10-08"), 2, 90000)
                .unwrap()
                .fresh
        );
    }

    #[test]
    fn latest_keyword_view_retains_its_recent_paper_fallback() {
        let (start, end) = today_local_bounds().unwrap();
        let mut latest = Vec::new();
        assert!(!collect_query_page(
            &mut latest,
            vec![paper(1, start - chrono::Duration::seconds(1))],
            start,
            end,
            Some(20)
        ));
        assert_eq!(latest.len(), 1);
    }

    #[test]
    fn invalid_or_truncated_feed_is_not_a_successful_empty_day() {
        assert!(parse_arxiv_response("<html>Temporary error</html>", &[]).is_err());
        assert!(parse_arxiv_response("<feed><entry><title>Incomplete", &[]).is_err());
        let (papers, total) = parse_arxiv_response(
            "<feed xmlns='http://www.w3.org/2005/Atom'><opensearch:totalResults xmlns:opensearch='http://a9.com/-/spec/opensearch/1.1/'>0</opensearch:totalResults></feed>", &[],
        ).unwrap();
        assert!(papers.is_empty());
        assert_eq!(total, Some(0));
    }
}
