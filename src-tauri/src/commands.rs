use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::models::{
    AppConfig, ArxivConfig, ArxivPaper, GlobalState, GpuConfig,
    PaperConfig, PaperDeadlineInfo, WidgetThemeConfig, ServerGpuData,
    QuotaConfig, QuotaItem,
};
use crate::config_store;

#[tauri::command]
pub async fn save_gpu_config(app: AppHandle, config: GpuConfig) -> Result<(), String> {
    config_store::write_config(&app, "gpu_monitor.json", &config)
}

#[tauri::command]
pub async fn save_paper_config(
    app: AppHandle,
    state: tauri::State<'_, GlobalState>,
    config: PaperConfig,
) -> Result<(), String> {
    config_store::write_config(&app, "paper_deadline.json", &config)?;

    // Trigger immediate UI refresh if we have cached YAML
    let yaml = {
        let last = state.last_yaml.lock().map_err(|e| e.to_string())?;
        last.clone()
    };
    if let Some(text) = yaml {
        let state_arc = Arc::new(GlobalState {
            deadlines: state.deadlines.clone(),
            gpu_data: state.gpu_data.clone(),
            last_yaml: state.last_yaml.clone(),
            active_monitors: state.active_monitors.clone(),
            active_workers: state.active_workers.clone(),
            arxiv_papers: state.arxiv_papers.clone(),
            quota_data: state.quota_data.clone(),
            widget_toggle_lock: state.widget_toggle_lock.clone(),
        });
        crate::deadlines::process_deadlines(app, state_arc, config, text);
    }
    Ok(())
}

#[tauri::command]
pub async fn get_gpu_config(app: AppHandle) -> Result<GpuConfig, String> {
    let mut config = config_store::read_config::<GpuConfig>(&app, "gpu_monitor.json");
    if config.compact_mode.is_none() {
        config.compact_mode = Some(true);
    }
    Ok(config)
}

#[tauri::command]
pub async fn get_paper_config(app: AppHandle) -> Result<PaperConfig, String> {
    Ok(config_store::read_config::<PaperConfig>(&app, "paper_deadline.json"))
}

#[tauri::command]
pub async fn save_app_config(app: AppHandle, config: AppConfig) -> Result<(), String> {
    config_store::write_config(&app, "app_config.json", &config)
}

#[tauri::command]
pub async fn get_app_config(app: AppHandle) -> Result<AppConfig, String> {
    Ok(config_store::read_config::<AppConfig>(&app, "app_config.json"))
}

#[tauri::command]
pub async fn get_deadlines(
    state: tauri::State<'_, GlobalState>,
) -> Result<Vec<PaperDeadlineInfo>, String> {
    let deadlines = state.deadlines.lock().map_err(|e| e.to_string())?;
    Ok(deadlines.clone())
}

#[tauri::command]
pub async fn get_gpu_data(
    state: tauri::State<'_, GlobalState>,
) -> Result<Vec<ServerGpuData>, String> {
    let gpu_data = state.gpu_data.lock().map_err(|e| e.to_string())?;
    Ok(gpu_data.values().cloned().collect())
}

#[tauri::command]
pub async fn show_main(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
    if let Some(tray_menu) = app.get_webview_window("tray-menu") {
        let _ = tray_menu.hide();
    }
    Ok(())
}

#[tauri::command]
pub async fn exit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[tauri::command]
pub async fn get_theme_config(app: AppHandle) -> Result<WidgetThemeConfig, String> {
    Ok(config_store::read_theme_config(&app))
}

#[tauri::command]
pub async fn save_theme_config(
    app: AppHandle,
    config: WidgetThemeConfig,
) -> Result<(), String> {
    config_store::write_theme_config(&app, &config)
}

pub async fn create_widget_impl(app: AppHandle, id: String, title: String) -> Result<(), String> {
    println!("Creating/Showing widget: {} ({})", title, id);
    if let Some(win) = app.get_webview_window(&id) {
        let _ = win.show();
        let _ = win.set_focus();
    } else {
        let builder = WebviewWindowBuilder::new(&app, &id, WebviewUrl::App("index.html".into()))
            .title(title)
            .inner_size(320.0, 400.0)
            .decorations(false)
            .resizable(true)
            .transparent(true)
            .shadow(false)
            .always_on_top(true)
            .skip_taskbar(true);

        match builder.build() {
            Ok(win) => {
                let _ = win.show();
                let _ = win.set_focus();
            }
            Err(e) => return Err(e.to_string()),
        }
    }

    let _ = config_store::update_widget_visibility_config(&app, &id, true).await;
    Ok(())
}

#[tauri::command]
pub async fn create_widget(
    app: AppHandle,
    state: tauri::State<'_, GlobalState>,
    id: String,
    title: String,
) -> Result<(), String> {
    let _lock = state.widget_toggle_lock.lock().await;
    create_widget_impl(app, id, title).await
}

#[tauri::command]
pub async fn close_widget(
    app: AppHandle,
    state: tauri::State<'_, GlobalState>,
    id: String,
) -> Result<(), String> {
    let _lock = state.widget_toggle_lock.lock().await;
    if let Some(win) = app.get_webview_window(&id) {
        let _ = win.hide();
    }
    let _ = config_store::update_widget_visibility_config(&app, &id, false).await;
    Ok(())
}

#[tauri::command]
pub async fn toggle_widget(
    app: AppHandle,
    state: tauri::State<'_, GlobalState>,
    id: String,
    title: String,
) -> Result<(), String> {
    let _lock = state.widget_toggle_lock.lock().await;

    // Read the current visibility from config to prevent `win.is_visible()` sync issues 
    // or OS-level visibility glitches (e.g. desktop child mode).
    let config = config_store::read_config::<AppConfig>(&app, "app_config.json");
    let is_currently_visible = config.active_widgets.and_then(|m| m.get(&id).cloned()).unwrap_or(false);
    
    let new_visible = !is_currently_visible;

    if let Some(win) = app.get_webview_window(&id) {
        if new_visible {
            let _ = win.show();
            let _ = win.set_focus();
        } else {
            let _ = win.hide();
        }
    } else {
        if new_visible {
            let _ = create_widget_impl(app.clone(), id.clone(), title).await?;
        }
    }
    let _ = config_store::update_widget_visibility_config(&app, &id, new_visible).await;
    Ok(())
}

#[tauri::command]
pub async fn save_arxiv_config(app: AppHandle, config: ArxivConfig) -> Result<(), String> {
    config_store::write_config(&app, "arxiv_config.json", &config)
}

#[tauri::command]
pub async fn get_arxiv_config(app: AppHandle) -> Result<ArxivConfig, String> {
    Ok(config_store::read_config::<ArxivConfig>(&app, "arxiv_config.json"))
}

#[tauri::command]
pub async fn get_arxiv_papers(
    app: AppHandle,
    state: tauri::State<'_, GlobalState>,
) -> Result<Vec<ArxivPaper>, String> {
    let mut papers = state.arxiv_papers.lock().map_err(|e| e.to_string())?.clone();
    if papers.is_empty() {
        let cached_papers = config_store::read_config::<Vec<ArxivPaper>>(&app, "arxiv_cache.json");
        if !cached_papers.is_empty() {
            if let Ok(mut state_papers) = state.arxiv_papers.lock() {
                *state_papers = cached_papers.clone();
            }
            papers = cached_papers;
        }
    }
    Ok(papers)
}

#[tauri::command]
pub async fn mark_arxiv_seen(
    app: AppHandle,
    state: tauri::State<'_, GlobalState>,
    id: String,
    saved: bool,
) -> Result<(), String> {
    let mut seen = config_store::read_config::<Vec<String>>(&app, "arxiv_seen.json");
    if !seen.contains(&id) {
        seen.push(id.clone());
        let _ = config_store::write_config(&app, "arxiv_seen.json", &seen);
    }

    if saved {
        let mut paper_to_save = None;
        if let Ok(mut papers) = state.arxiv_papers.lock() {
            if let Some(idx) = papers.iter().position(|p| p.id == id) {
                paper_to_save = Some(papers[idx].clone());
                papers.remove(idx);
            }
        }

        if let Some(p) = paper_to_save {
            let mut saved_papers = config_store::read_config::<Vec<ArxivPaper>>(&app, "arxiv_saved.json");
            saved_papers.push(p);
            let _ = config_store::write_config(&app, "arxiv_saved.json", &saved_papers);
        }
    } else {
        let mut paper_to_discard = None;
        if let Ok(mut papers) = state.arxiv_papers.lock() {
            if let Some(idx) = papers.iter().position(|p| p.id == id) {
                paper_to_discard = Some(papers[idx].clone());
                papers.remove(idx);
            }
        }

        if let Some(p) = paper_to_discard {
            let mut discarded = config_store::read_config::<Vec<ArxivPaper>>(&app, "arxiv_discarded.json");
            discarded.push(p);
            let _ = config_store::write_config(&app, "arxiv_discarded.json", &discarded);
        }
    }

    // Save updated papers list to cache and emit update
    if let Ok(papers) = state.arxiv_papers.lock() {
        let _ = config_store::write_config(&app, "arxiv_cache.json", &*papers);
        let _ = app.emit("arxiv_update", &*papers);
    }

    let _ = app.emit("arxiv_saved_update", ());
    let _ = app.emit("arxiv_discarded_update", ());
    Ok(())
}

#[tauri::command]
pub async fn refresh_arxiv(
    app: AppHandle,
    state: tauri::State<'_, GlobalState>,
) -> Result<Vec<ArxivPaper>, String> {
    let global_state = state.inner();
    crate::arxiv::perform_arxiv_fetch(&app, global_state).await
}

#[tauri::command]
pub async fn get_arxiv_saved_papers(app: AppHandle) -> Result<Vec<ArxivPaper>, String> {
    Ok(config_store::read_config::<Vec<ArxivPaper>>(&app, "arxiv_saved.json"))
}

#[tauri::command]
pub async fn open_link(app: AppHandle, url: String) -> Result<(), String> {
    println!("Opening link: {}", url);
    use tauri_plugin_opener::OpenerExt;
    app.opener().open_url(&url, None::<String>).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn remove_arxiv_saved_paper(app: AppHandle, id: String) -> Result<(), String> {
    let mut saved_papers = config_store::read_config::<Vec<ArxivPaper>>(&app, "arxiv_saved.json");
    saved_papers.retain(|p| p.id != id);
    config_store::write_config(&app, "arxiv_saved.json", &saved_papers)?;
    let _ = app.emit("arxiv_saved_update", ());
    Ok(())
}

#[tauri::command]
pub async fn get_arxiv_discarded_papers(app: AppHandle) -> Result<Vec<ArxivPaper>, String> {
    Ok(config_store::read_config::<Vec<ArxivPaper>>(&app, "arxiv_discarded.json"))
}

#[tauri::command]
pub async fn remove_arxiv_discarded_paper(app: AppHandle, id: String) -> Result<(), String> {
    let mut papers = config_store::read_config::<Vec<ArxivPaper>>(&app, "arxiv_discarded.json");
    papers.retain(|p| p.id != id);
    config_store::write_config(&app, "arxiv_discarded.json", &papers)?;
    let _ = app.emit("arxiv_discarded_update", ());
    Ok(())
}

#[tauri::command]
pub async fn open_log_dir(app: AppHandle) -> Result<(), String> {
    let log_dir = app.path().app_log_dir().unwrap_or_else(|_| {
        std::env::current_dir().unwrap_or_default().join("logs")
    });
    std::fs::create_dir_all(&log_dir).map_err(|e| e.to_string())?;
    use tauri_plugin_opener::OpenerExt;
    let path_str = log_dir.to_string_lossy().to_string();
    app.opener().open_url(&path_str, None::<String>).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_quota_config(
    app: AppHandle,
    state: tauri::State<'_, GlobalState>,
    mut config: QuotaConfig,
) -> Result<(), String> {
    // Group Antigravity models before saving to disk
    for item in &mut config.items {
        if item.provider == "antigravity" {
            crate::quota::group_antigravity_bars(item);
        }
    }
    
    // Write config to disk
    config_store::write_config(&app, "quota_config.json", &config)?;
    
    // Trigger immediate fetch to update values for the new config
    let _ = crate::quota::perform_quota_fetch(&app, &*state).await;
    
    Ok(())
}

#[tauri::command]
pub async fn get_quota_config(app: AppHandle) -> Result<QuotaConfig, String> {
    Ok(config_store::read_config::<QuotaConfig>(&app, "quota_config.json"))
}

#[tauri::command]
pub async fn get_quota_data(
    state: tauri::State<'_, GlobalState>,
) -> Result<Vec<QuotaItem>, String> {
    let quota_data = state.quota_data.lock().map_err(|e| e.to_string())?;
    Ok(quota_data.clone())
}

#[tauri::command]
pub async fn refresh_quota(
    app: AppHandle,
    state: tauri::State<'_, GlobalState>,
) -> Result<Vec<QuotaItem>, String> {
    crate::quota::perform_quota_fetch(&app, &*state).await
}

#[tauri::command]
pub async fn update_manual_quota(
    app: AppHandle,
    state: tauri::State<'_, GlobalState>,
    id: String,
    value: f64,
) -> Result<(), String> {
    let mut config = config_store::read_config::<QuotaConfig>(&app, "quota_config.json");
    if let Some(item) = config.items.iter_mut().find(|i| i.id == id) {
        item.current_value = Some(value);
        item.last_update = Some(chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string());
    }
    
    config_store::write_config(&app, "quota_config.json", &config)?;
    
    // Update state and emit update
    {
        if let Ok(mut state_quota) = state.quota_data.lock() {
            *state_quota = config.items.clone();
        }
    }
    let _ = app.emit("quota_update", &config.items);
    Ok(())
}

#[tauri::command]
pub async fn restore_widget_position(
    app: AppHandle,
    state: tauri::State<'_, GlobalState>,
    id: String,
    title: String,
) -> Result<(), String> {
    let _lock = state.widget_toggle_lock.lock().await;
    // Ensure widget is created/shown first
    if app.get_webview_window(&id).is_none() {
        let _ = create_widget_impl(app.clone(), id.clone(), title).await;
    }

    if let Some(win) = app.get_webview_window(&id) {
        // Read app config to know if it's always_on_top (pinned)
        let config = config_store::read_config::<AppConfig>(&app, "app_config.json");
        let always_on_top = config.always_on_top.and_then(|m| m.get(&id).cloned()).unwrap_or(false);

        // Disable desktop mode to make it a normal top-level window first
        let _ = crate::desktop::set_desktop_mode(app.clone(), id.clone(), false).await;

        // Center and show
        let _ = win.center();
        let _ = win.show();
        let _ = win.set_focus();

        // Re-apply desktop mode if not pinned/always_on_top
        if always_on_top {
            let _ = win.set_always_on_top(true);
        } else {
            let _ = win.set_always_on_top(false);
            let _ = crate::desktop::set_desktop_mode(app.clone(), id.clone(), true).await;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn log_frontend_error(
    message: String,
    source: Option<String>,
    lineno: Option<u32>,
    colno: Option<u32>,
    error: Option<String>,
) {
    let loc = match (source, lineno, colno) {
        (Some(s), Some(l), Some(c)) => format!("{}:{}:{}", s, l, c),
        (Some(s), Some(l), None) => format!("{}:{}", s, l),
        (Some(s), None, None) => s,
        _ => "unknown".to_string(),
    };
    let err_details = error.unwrap_or_default();
    log::error!(
        "[FRONTEND] [{}] {} | Details: {}",
        loc,
        message,
        err_details
    );
}
