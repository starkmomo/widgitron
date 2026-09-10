use chrono::{DateTime, Datelike, Local, TimeZone};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

use crate::config_store;
use crate::models::{AppConfig, ArxivConfig, ArxivPaper, GlobalState};

const ARXIV_PAGE_SIZE: usize = 100;
const ARXIV_MIN_PAPERS_PER_KEYWORD: usize = 10;

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
                if name == "entry" {
                    in_entry = false;
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

    Ok((papers, total_results))
}

async fn fetch_arxiv_page(
    client: &reqwest::Client,
    query: &str,
    start: usize,
    keywords: &[String],
) -> Result<(Vec<ArxivPaper>, Option<usize>), String> {
    let start_param = start.to_string();
    let page_size_param = ARXIV_PAGE_SIZE.to_string();
    let params = [
        ("search_query", query),
        ("start", start_param.as_str()),
        ("max_results", page_size_param.as_str()),
        ("sortBy", "lastUpdatedDate"),
        ("sortOrder", "descending"),
    ];
    let url = reqwest::Url::parse_with_params("https://export.arxiv.org/api/query", &params)
        .map_err(|e| e.to_string())?;

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
        let (mut page_papers, page_total_results) =
            fetch_arxiv_page(client, query, start, keywords).await?;

        if total_results.is_none() {
            total_results = page_total_results;
        }

        let fetched_count = page_papers.len();
        let mut should_stop = false;

        for paper in page_papers.drain(..) {
            match paper_updated_at(&paper) {
                Some(updated_at) if updated_at >= today_start && updated_at < tomorrow_start => {
                    papers.push(paper);
                }
                Some(updated_at) if updated_at < today_start => {
                    if minimum_count.is_some_and(|min| papers.len() < min) {
                        papers.push(paper);
                    }
                    if minimum_count.map_or(true, |min| papers.len() >= min) {
                        should_stop = true;
                        break;
                    }
                }
                _ => {}
            }
        }

        if should_stop || fetched_count < ARXIV_PAGE_SIZE {
            break;
        }

        start += ARXIV_PAGE_SIZE;
        if total_results.is_some_and(|total| start >= total) {
            break;
        }
    }

    Ok(papers)
}

pub async fn perform_arxiv_fetch(
    app: &AppHandle,
    state: &GlobalState,
) -> Result<Vec<ArxivPaper>, String> {
    let _fetch_guard = state.arxiv_fetch_lock.lock().await;
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

    let client = client_builder.build().map_err(|e| e.to_string())?;

    let config = config_store::read_config::<ArxivConfig>(app, "arxiv_config.json");

    let kws = &config.keywords;
    let cats = &config.categories;
    let cat_query = build_category_query(cats);
    let (today_start, tomorrow_start) = today_local_bounds()?;

    let mut papers = Vec::new();

    if kws.is_empty() {
        papers =
            fetch_papers_for_query(&client, &cat_query, kws, today_start, tomorrow_start, None)
                .await?;
    } else {
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
    }

    // Filter out seen papers
    let seen = config_store::read_config::<Vec<String>>(app, "arxiv_seen.json");

    papers.retain(|p| !seen.iter().any(|s| s == p.id.trim()));

    // Save to cache file
    let _ = config_store::write_config(app, "arxiv_cache.json", &papers);

    {
        if let Ok(mut state_papers) = state.arxiv_papers.lock() {
            *state_papers = papers.clone();
        }
    }
    let _ = app.emit("arxiv_update", &papers);
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
                        if elapsed < Duration::from_secs(1800) {
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
