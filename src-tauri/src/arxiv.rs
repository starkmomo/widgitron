use std::time::Duration;
use tauri::{AppHandle, Emitter};

use crate::models::{AppConfig, ArxivConfig, ArxivPaper, GlobalState};
use crate::config_store;

fn normalize_keyword(keyword: &str) -> String {
    keyword.trim().trim_matches('"').to_lowercase()
}

fn matched_keywords_for_paper(paper: &ArxivPaper, keywords: &[String]) -> Vec<String> {
    let haystack = format!("{} {}", paper.title, paper.summary).to_lowercase();
    keywords
        .iter()
        .filter_map(|keyword| {
            let normalized = normalize_keyword(keyword);
            if !normalized.is_empty() && haystack.contains(&normalized) {
                Some(keyword.trim().to_string())
            } else {
                None
            }
        })
        .collect()
}
pub async fn perform_arxiv_fetch(
    app: &AppHandle,
    state: &GlobalState,
) -> Result<Vec<ArxivPaper>, String> {
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
    
    // Build query for multiple categories and keywords
    let cat_query = if cats.is_empty() {
        "cat:cs*".to_string()
    } else {
        let joined = cats.iter().map(|c| format!("cat:{}*", c.trim())).collect::<Vec<_>>().join(" OR ");
        format!("({})", joined)
    };

    let mut query = cat_query;
    if !kws.is_empty() {
        let kw_query = kws.iter().map(|k| {
            let trimmed = k.trim();
            if trimmed.contains(' ') && !trimmed.starts_with('"') {
                format!("all:\"{}\"", trimmed)
            } else {
                format!("all:{}", trimmed)
            }
        }).collect::<Vec<_>>().join(" OR ");
        query = format!("{} AND ({})", query, kw_query);
    }
    
    let params = [
        ("search_query", query.as_str()),
        ("start", "0"),
        ("max_results", "50"),
        ("sortBy", "submittedDate"),
        ("sortOrder", "descending"),
    ];
    let url = reqwest::Url::parse_with_params("https://export.arxiv.org/api/query", &params)
        .map_err(|e| e.to_string())?;
    
    let res = client.get(url).send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("Arxiv API returned HTTP status {}", res.status()));
    }
    let xml = res.text().await.map_err(|e| e.to_string())?;
    
    let mut reader = quick_xml::Reader::from_str(&xml);
    reader.config_mut().trim_text(true);
    
    let mut buf = Vec::new();
    let mut papers = Vec::new();
    
    let mut current_paper = ArxivPaper {
        id: String::new(), title: String::new(), summary: String::new(),
        matched_keywords: Vec::new(),
        authors: Vec::new(), link: String::new(), published: String::new()
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
                        id: String::new(), title: String::new(), summary: String::new(),
        matched_keywords: Vec::new(),
        authors: Vec::new(), link: String::new(), published: String::new()
                    };
                } else if in_entry {
                    if name == "author" {
                        in_author = true;
                    }
                    else if name == "name" && in_author {
                        current_paper.authors.push(String::new());
                    }
                    else if name == "link" {
                        let mut is_pdf = false;
                        let mut href = String::new();
                        for attr in e.attributes() {
                            if let Ok(a) = attr {
                                let key = a.key.local_name();
                                let k = String::from_utf8_lossy(key.as_ref());
                                let v = String::from_utf8_lossy(a.value.as_ref());
                                if k == "title" && v == "pdf" { is_pdf = true; }
                                if k == "href" { href = v.into_owned(); }
                            }
                        }
                        if is_pdf { current_paper.link = href.replace("http://", "https://"); }
                        else if current_paper.link.is_empty() { current_paper.link = href.replace("http://", "https://"); } // fallback
                    }
                    current_tag = name;
                }
            },
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
                            if k == "title" && v == "pdf" { is_pdf = true; }
                            if k == "href" { href = v.into_owned(); }
                        }
                    }
                    if is_pdf { current_paper.link = href.replace("http://", "https://"); }
                    else if current_paper.link.is_empty() { current_paper.link = href.replace("http://", "https://"); }
                }
            },
            Ok(Event::End(e)) => {
                let name = String::from_utf8_lossy(e.local_name().as_ref()).into_owned();
                if name == "entry" {
                    in_entry = false;
                    current_paper.matched_keywords = matched_keywords_for_paper(&current_paper, kws);
                    papers.push(current_paper.clone());
                } else if name == "author" {
                    in_author = false;
                }
                current_tag = String::new();
            },
            Ok(Event::Text(e)) => {
                if in_entry {
                    let text = String::from_utf8_lossy(e.as_ref()).into_owned();
                    match current_tag.as_str() {
                        "id" => current_paper.id += &text,
                        "title" => current_paper.title += &text.replace("\n", " ").replace("  ", " "),
                        "summary" => current_paper.summary += &text.replace("\n", " ").replace("  ", " "),
                        "published" => current_paper.published += &text,
                        "name" if in_author => {
                            if let Some(last) = current_paper.authors.last_mut() {
                                *last += &text.trim();
                            }
                        },
                        _ => {}
                    }
                }
            },
            _ => {}
        }
        buf.clear();
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
                let cached_papers = config_store::read_config::<Vec<ArxivPaper>>(&app, "arxiv_cache.json");
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
                if ac.arxiv_enabled.unwrap_or(true) { break; }
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
                        if elapsed < Duration::from_secs(1800) { // 30 minutes
                            skip_fetch = true;
                            log::info!("Arxiv cache is fresh (< 30m). Skipping initial fetch on startup.");
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
                    log::error!("Error fetching Arxiv: {}. Retrying in {}s.", e, backoff_secs);
                    let _ = app.emit("arxiv_error", e.clone());
                    let cached_papers = {
                        if let Ok(state_papers) = state.arxiv_papers.lock() {
                            if !state_papers.is_empty() {
                                state_papers.clone()
                            } else {
                                config_store::read_config::<Vec<ArxivPaper>>(&app, "arxiv_cache.json")
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
            if !ac.arxiv_enabled.unwrap_or(true) { break; }
            
            let current_config = config_store::read_config::<ArxivConfig>(&app, "arxiv_config.json");
            if current_config.keywords != last_config.keywords || current_config.categories != last_config.categories || current_config.update_interval != last_config.update_interval {
                break;
            }
        }
    }
}
