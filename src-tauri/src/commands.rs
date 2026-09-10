use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::config_store;
use crate::models::{
    AppConfig, ArxivConfig, ArxivPaper, GlobalState, GpuConfig, PaperConfig, PaperDeadlineInfo,
    QuotaConfig, QuotaItem, ServerGpuData, ToggleWidgetResponse, WidgetThemeConfig,
};

#[tauri::command]
pub async fn save_gpu_config(
    app: AppHandle,
    state: tauri::State<'_, GlobalState>,
    mut config: GpuConfig,
) -> Result<(), String> {
    config
        .servers
        .retain(|server| !server.host.trim().is_empty());

    let previous = crate::gpu::read_gpu_config(&app);
    let previous_hosts: std::collections::HashSet<String> = previous
        .servers
        .iter()
        .map(|server| server.host.clone())
        .collect();
    let next_hosts: std::collections::HashSet<String> = config
        .servers
        .iter()
        .map(|server| server.host.clone())
        .collect();

    crate::gpu::write_gpu_config(&app, &config)?;
    let _ = app.emit("gpu_config_update", &config);

    for host in previous_hosts.difference(&next_hosts) {
        let removed = state
            .gpu_data
            .lock()
            .ok()
            .and_then(|mut data| data.remove(host));
        if removed.is_some() {
            crate::gpu::clear_gpu_emit_cache_for_host(state.inner(), host);
            let _ = app.emit("gpu_prune", host.clone());
        }
    }

    crate::gpu::persist_gpu_data_cache(&app, state.inner());

    Ok(())
}

#[tauri::command]
pub async fn save_paper_config(
    app: AppHandle,
    state: tauri::State<'_, GlobalState>,
    config: PaperConfig,
) -> Result<(), String> {
    config_store::write_config(&app, "paper_deadline.json", &config)?;
    let _ = app.emit("paper_config_update", &config);

    let app_config = config_store::read_config::<AppConfig>(&app, "app_config.json");
    if !app_config.deadline_enabled.unwrap_or(true) {
        return Ok(());
    }

    let yaml = state.last_yaml.lock().ok().and_then(|last| last.clone());

    if let Some(text) = yaml {
        let config_clone = config.clone();
        let text_clone = text.clone();
        match tokio::task::spawn_blocking(move || {
            crate::deadlines::build_deadlines_from_yaml(&text_clone, &config_clone)
        })
        .await
        {
            Ok(Ok(deadlines)) => {
                crate::deadlines::apply_deadline_fetch_success(&app, state.inner(), deadlines);
            }
            Ok(Err(e)) => {
                log::warn!("Deadline reprocess after config save failed: {}", e);
                let _ = app.emit("paper_error", e);
            }
            Err(e) => {
                log::warn!("Deadline reprocess task failed: {}", e);
            }
        }
    } else if let Err(e) =
        crate::deadlines::fetch_and_update_paper_deadlines(&app, state.inner()).await
    {
        log::warn!("Deadline fetch after config save failed: {}", e);
        let _ = app.emit("paper_error", e);
    }

    Ok(())
}

#[tauri::command]
pub async fn get_gpu_config(app: AppHandle) -> Result<GpuConfig, String> {
    let mut config = crate::gpu::read_gpu_config(&app);
    if config.compact_mode.is_none() {
        config.compact_mode = Some(true);
    }
    Ok(config)
}

#[tauri::command]
pub async fn get_paper_config(app: AppHandle) -> Result<PaperConfig, String> {
    Ok(config_store::read_config::<PaperConfig>(
        &app,
        "paper_deadline.json",
    ))
}

#[tauri::command]
pub async fn save_app_config(app: AppHandle, mut config: AppConfig) -> Result<(), String> {
    let previous = config_store::read_config::<AppConfig>(&app, "app_config.json");
    let previous_scale = crate::ui_scale::from_config(&previous);
    let next_scale = crate::ui_scale::from_config(&config);
    let scale_changed = (previous_scale - next_scale).abs() >= 0.001;
    config.global_scale = Some(next_scale);

    if scale_changed {
        crate::widget_layout::persist_open_widget_layouts_at_scale(&app, previous_scale);
    }

    config_store::write_config(&app, "app_config.json", &config)?;
    crate::sidebar_hotkey::update_global_sidebar_hotkey(config.sidebar_hotkey.clone());
    if scale_changed {
        crate::widget_layout::apply_scale_to_open_widgets(&app, next_scale);
    }
    crate::sidebar_dock::apply_config(&app, &config);
    let _ = app.emit("app_config_update", &config);
    Ok(())
}

/// Update only one widget's always-on-top preference. Widget windows can stay
/// alive while the sidebar changes dock edge or monitor, so they must not write
/// back a stale copy of the full application configuration.
#[tauri::command]
pub async fn set_widget_always_on_top(
    app: AppHandle,
    label: String,
    pinned: bool,
) -> Result<AppConfig, String> {
    if !crate::widget_layout::is_tracked_widget(&label) {
        return Err(format!("Unsupported widget label: {}", label));
    }

    let mut config = config_store::read_config::<AppConfig>(&app, "app_config.json");
    config
        .always_on_top
        .get_or_insert_with(Default::default)
        .insert(label, pinned);
    config_store::write_config(&app, "app_config.json", &config)?;
    let _ = app.emit("app_config_update", &config);
    Ok(config)
}

#[tauri::command]
pub async fn get_app_config(app: AppHandle) -> Result<AppConfig, String> {
    Ok(config_store::read_config::<AppConfig>(
        &app,
        "app_config.json",
    ))
}

#[tauri::command]
pub async fn get_deadlines(
    app: AppHandle,
    state: tauri::State<'_, GlobalState>,
) -> Result<Vec<PaperDeadlineInfo>, String> {
    let deadlines = state.deadlines.lock().map_err(|e| e.to_string())?;
    if !deadlines.is_empty() {
        return Ok(deadlines.clone());
    }
    drop(deadlines);

    let cached = crate::deadlines::hydrate_deadlines_from_cache(&app, state.inner());
    Ok(cached)
}

#[tauri::command]
pub async fn refresh_paper_deadlines(
    app: AppHandle,
    state: tauri::State<'_, GlobalState>,
) -> Result<Vec<PaperDeadlineInfo>, String> {
    crate::deadlines::fetch_and_update_paper_deadlines(&app, state.inner()).await
}

#[tauri::command]
pub async fn get_gpu_data(
    app: AppHandle,
    state: tauri::State<'_, GlobalState>,
) -> Result<Vec<ServerGpuData>, String> {
    let config = crate::gpu::read_gpu_config(&app);
    let gpu_data = state.gpu_data.lock().map_err(|e| e.to_string())?;
    let disk_cache = crate::gpu::load_gpu_cache(&app);

    let mut sorted_data = Vec::new();
    for server_cfg in &config.servers {
        if server_cfg.host.trim().is_empty() {
            continue;
        }
        if let Some(data) = gpu_data.get(&server_cfg.host) {
            sorted_data.push(data.clone());
        } else if let Some(data) = disk_cache.get(&server_cfg.host) {
            sorted_data.push(data.clone());
        }
    }
    Ok(sorted_data)
}

#[tauri::command]
pub async fn refresh_gpu_data(
    app: AppHandle,
    state: tauri::State<'_, GlobalState>,
) -> Result<Vec<ServerGpuData>, String> {
    {
        let mut workers = state.active_workers.lock().map_err(|e| e.to_string())?;
        for (_, handle) in workers.drain() {
            handle.abort();
        }
    }
    {
        let mut monitors = state.active_monitors.lock().map_err(|e| e.to_string())?;
        for (_, handle) in monitors.drain() {
            handle.abort();
        }
    }
    log::info!("GPU workers restarted via manual refresh");
    get_gpu_data(app, state).await
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
pub async fn show_sidebar(app: tauri::AppHandle) -> Result<(), String> {
    crate::sidebar_dock::show(&app, true)?;
    if let Some(tray_menu) = app.get_webview_window("tray-menu") {
        let _ = tray_menu.hide();
    }
    Ok(())
}

#[tauri::command]
pub async fn hide_sidebar(app: tauri::AppHandle) -> Result<(), String> {
    crate::sidebar_dock::collapse(&app)
}

#[tauri::command]
pub async fn toggle_sidebar(app: tauri::AppHandle) -> Result<(), String> {
    let _ = crate::sidebar_dock::toggle_pinned(&app, true)?;
    if let Some(tray_menu) = app.get_webview_window("tray-menu") {
        let _ = tray_menu.hide();
    }
    Ok(())
}

#[tauri::command]
pub async fn get_sidebar_state(
    app: tauri::AppHandle,
) -> Result<crate::sidebar_dock::SidebarDockState, String> {
    crate::sidebar_dock::get_state(&app)
}

#[tauri::command]
pub async fn set_sidebar_pinned(
    app: tauri::AppHandle,
    pinned: bool,
) -> Result<crate::sidebar_dock::SidebarDockState, String> {
    crate::sidebar_dock::set_pinned(&app, pinned, false)
}

#[tauri::command]
pub async fn begin_sidebar_drag(
    app: tauri::AppHandle,
) -> Result<crate::sidebar_dock::SidebarDockState, String> {
    crate::sidebar_dock::begin_drag(&app)
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
pub async fn save_theme_config(app: AppHandle, config: WidgetThemeConfig) -> Result<(), String> {
    config_store::write_theme_config(&app, &config)?;
    let _ = app.emit("theme_update", &config);
    Ok(())
}

#[tauri::command]
pub fn get_corrupt_config_files(app: AppHandle) -> Result<Vec<String>, String> {
    Ok(config_store::list_corrupt_config_files(&app))
}

async fn create_widget_impl_with_options(
    app: AppHandle,
    id: String,
    title: String,
    focus_window: bool,
) -> Result<(), String> {
    log::info!("Creating/Showing widget: {} ({})", title, id);
    let win = if let Some(win) = app.get_webview_window(&id) {
        win
    } else {
        let builder = WebviewWindowBuilder::new(&app, &id, WebviewUrl::App("index.html".into()))
            .title(title)
            .inner_size(320.0, 400.0)
            .decorations(false)
            .resizable(true)
            .maximizable(false)
            .transparent(true)
            .shadow(false)
            .always_on_top(true)
            .skip_taskbar(true);

        match builder.build() {
            Ok(win) => win,
            Err(e) => {
                let err_str = e.to_string();
                log::error!("Failed to build widget window '{}': {}", id, err_str);
                return Err(err_str);
            }
        }
    };

    // Frameless widgets use their own drag/resize affordances. Keeping the
    // native maximize capability enabled also opts them into Windows Aero
    // Snap, which can unexpectedly maximize a widget near a screen edge.
    let _ = win.set_maximizable(false);

    let _ = crate::widget_layout::restore_widget_layout_preserving_desktop_mode(&app, &id);
    let _ = win.show();
    if focus_window {
        let _ = win.set_focus();
    }

    let _ = config_store::update_widget_visibility_config(&app, &id, true).await;
    Ok(())
}

pub async fn create_widget_impl(app: AppHandle, id: String, title: String) -> Result<(), String> {
    create_widget_impl_with_options(app, id, title, true).await
}

pub async fn create_widget_impl_background(
    app: AppHandle,
    id: String,
    title: String,
) -> Result<(), String> {
    create_widget_impl_with_options(app, id, title, false).await
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
        // A resize can still be waiting in the debounce when the user hides a
        // widget. Save the current top-level bounds before hiding it so the
        // next show cannot restore an older size at the current UI scale.
        let _ = crate::widget_layout::persist_layout_now(&app, &id);
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
) -> Result<ToggleWidgetResponse, String> {
    let _lock = state.widget_toggle_lock.lock().await;

    // Read the current visibility from config to prevent `win.is_visible()` sync issues
    // or OS-level visibility glitches (e.g. desktop child mode).
    let config = config_store::read_config::<AppConfig>(&app, "app_config.json");
    let is_currently_visible = config
        .active_widgets
        .and_then(|m| m.get(&id).cloned())
        .unwrap_or(false);

    let new_visible = !is_currently_visible;

    if let Some(win) = app.get_webview_window(&id) {
        if new_visible {
            // Existing widgets may be desktop children. Restore their saved
            // geometry through the top-level path before ShowWindow can apply
            // the desktop parent's DPI transform.
            let _ = crate::widget_layout::restore_widget_layout_preserving_desktop_mode(&app, &id);
            let _ = win.show();
            let _ = win.set_focus();
        } else {
            let _ = crate::widget_layout::persist_layout_now(&app, &id);
            let _ = win.hide();
        }
    } else {
        if new_visible {
            let _ = create_widget_impl(app.clone(), id.clone(), title).await?;
        }
    }
    let _ = config_store::update_widget_visibility_config(&app, &id, new_visible).await;
    Ok(ToggleWidgetResponse {
        visible: new_visible,
    })
}

#[tauri::command]
pub async fn save_arxiv_config(
    app: AppHandle,
    state: tauri::State<'_, GlobalState>,
    config: ArxivConfig,
) -> Result<(), String> {
    let previous_config = config_store::read_config::<ArxivConfig>(&app, "arxiv_config.json");
    let should_fetch = previous_config.keywords != config.keywords
        || previous_config.categories != config.categories;
    config_store::write_config(&app, "arxiv_config.json", &config)?;
    let _ = app.emit("arxiv_config_update", &config);

    let app_config = config_store::read_config::<AppConfig>(&app, "app_config.json");
    if should_fetch && app_config.arxiv_enabled.unwrap_or(true) {
        if let Err(e) = crate::arxiv::perform_arxiv_fetch(&app, state.inner()).await {
            log::warn!("Arxiv immediate fetch after config save failed: {}", e);
            let _ = app.emit("arxiv_error", e);
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn get_arxiv_config(app: AppHandle) -> Result<ArxivConfig, String> {
    Ok(config_store::read_config::<ArxivConfig>(
        &app,
        "arxiv_config.json",
    ))
}

#[tauri::command]
pub async fn get_arxiv_papers(
    app: AppHandle,
    state: tauri::State<'_, GlobalState>,
) -> Result<Vec<ArxivPaper>, String> {
    let mut papers = state
        .arxiv_papers
        .lock()
        .map_err(|e| e.to_string())?
        .clone();
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
            let mut saved_papers =
                config_store::read_config::<Vec<ArxivPaper>>(&app, "arxiv_saved.json");
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
            let mut discarded =
                config_store::read_config::<Vec<ArxivPaper>>(&app, "arxiv_discarded.json");
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
    Ok(config_store::read_config::<Vec<ArxivPaper>>(
        &app,
        "arxiv_saved.json",
    ))
}

#[tauri::command]
pub async fn open_link(app: AppHandle, url: String) -> Result<(), String> {
    log::info!("Opening link: {}", url);
    use tauri_plugin_opener::OpenerExt;
    app.opener().open_url(&url, None::<String>).map_err(|e| {
        let err_str = e.to_string();
        log::error!("Failed to open link '{}': {}", url, err_str);
        err_str
    })
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
    Ok(config_store::read_config::<Vec<ArxivPaper>>(
        &app,
        "arxiv_discarded.json",
    ))
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
    let log_dir = app
        .path()
        .app_log_dir()
        .unwrap_or_else(|_| std::env::current_dir().unwrap_or_default().join("logs"));
    if let Err(e) = std::fs::create_dir_all(&log_dir) {
        let err_str = e.to_string();
        log::error!(
            "Failed to create log directory '{:?}': {}",
            log_dir,
            err_str
        );
        return Err(err_str);
    }
    use tauri_plugin_opener::OpenerExt;
    let path_str = log_dir.to_string_lossy().to_string();
    app.opener()
        .open_url(&path_str, None::<String>)
        .map_err(|e| {
            let err_str = e.to_string();
            log::error!("Failed to open log directory '{}': {}", path_str, err_str);
            err_str
        })
}

#[tauri::command]
pub async fn open_config_dir(app: AppHandle) -> Result<(), String> {
    let config_dir = crate::utils::get_config_dir(&app);
    if let Err(e) = std::fs::create_dir_all(&config_dir) {
        let err_str = e.to_string();
        log::error!(
            "Failed to create config directory '{:?}': {}",
            config_dir,
            err_str
        );
        return Err(err_str);
    }
    use tauri_plugin_opener::OpenerExt;
    let path_str = config_dir.to_string_lossy().to_string();
    app.opener()
        .open_url(&path_str, None::<String>)
        .map_err(|e| {
            let err_str = e.to_string();
            log::error!(
                "Failed to open config directory '{}': {}",
                path_str,
                err_str
            );
            err_str
        })
}

#[tauri::command]
pub fn get_config_dir_path(app: AppHandle) -> Result<String, String> {
    Ok(crate::utils::get_config_dir(&app).display().to_string())
}

#[tauri::command]
pub async fn save_quota_config(
    app: AppHandle,
    state: tauri::State<'_, GlobalState>,
    mut config: QuotaConfig,
) -> Result<(), String> {
    config = crate::quota::sanitize_quota_config(config);

    // Group Antigravity models before saving to disk
    for item in &mut config.items {
        if item.provider == "antigravity" {
            crate::quota::group_antigravity_bars(item);
        }
    }

    // Write config to disk
    crate::quota::write_quota_config(&app, &config)?;
    let _ = app.emit("quota_config_update", &config);

    // Kick quota refresh to the background so settings interactions stay responsive.
    let app_clone = app.clone();
    let refresh_state = GlobalState {
        deadlines: state.deadlines.clone(),
        gpu_data: state.gpu_data.clone(),
        gpu_last_emitted: state.gpu_last_emitted.clone(),
        last_yaml: state.last_yaml.clone(),
        active_monitors: state.active_monitors.clone(),
        active_workers: state.active_workers.clone(),
        arxiv_papers: state.arxiv_papers.clone(),
        arxiv_fetch_lock: state.arxiv_fetch_lock.clone(),
        quota_data: state.quota_data.clone(),
        quota_fetch_lock: state.quota_fetch_lock.clone(),
        widget_toggle_lock: state.widget_toggle_lock.clone(),
    };
    crate::quota::schedule_quota_refresh_after_save(app_clone, refresh_state);

    Ok(())
}

#[tauri::command]
pub async fn get_quota_config(app: AppHandle) -> Result<QuotaConfig, String> {
    Ok(crate::quota::read_quota_config(&app))
}

#[tauri::command]
pub async fn get_quota_data(
    app: AppHandle,
    state: tauri::State<'_, GlobalState>,
) -> Result<Vec<QuotaItem>, String> {
    let config = crate::quota::read_quota_config(&app);
    let quota_data = state
        .quota_data
        .lock()
        .map_err(|error| error.to_string())?
        .clone();
    Ok(crate::quota::order_quota_items_by_config(
        &quota_data,
        &config,
    ))
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
    let mut config = crate::quota::read_quota_config(&app);
    if let Some(item) = config.items.iter_mut().find(|i| i.id == id) {
        item.current_value = Some(value);
        item.error_msg = None;
        item.last_update = Some(chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string());
    }

    crate::quota::write_quota_config(&app, &config)?;

    let emit_items = {
        if let Ok(mut state_quota) = state.quota_data.lock() {
            if let Some(existing) = state_quota.iter_mut().find(|i| i.id == id) {
                existing.current_value = Some(value);
                existing.error_msg = None;
                existing.last_update =
                    Some(chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string());
            } else if let Some(cfg_item) = config.items.iter().find(|i| i.id == id) {
                state_quota.push(cfg_item.clone());
            }
            let ordered = crate::quota::order_quota_items_by_config(&state_quota, &config);
            *state_quota = ordered.clone();
            ordered
        } else {
            config.items.clone()
        }
    };
    let _ = app.emit("quota_update", &emit_items);
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
        create_widget_impl(app.clone(), id.clone(), title).await?;
    }

    if let Some(win) = app.get_webview_window(&id) {
        // Read app config to know if it's always_on_top (pinned)
        let config = config_store::read_config::<AppConfig>(&app, "app_config.json");
        let always_on_top = config
            .always_on_top
            .and_then(|m| m.get(&id).cloned())
            .unwrap_or(false);

        // Disable desktop mode to make it a normal top-level window first
        crate::desktop::set_desktop_mode(app.clone(), id.clone(), false).await?;

        // Restore to the normalized layout tracked for the current or fallback monitor
        crate::widget_layout::ensure_widget_layout_for_window(&app, &win, &id)
            .map_err(|e| e.to_string())?;
        win.show().map_err(|e| e.to_string())?;
        win.set_focus().map_err(|e| e.to_string())?;

        // Re-apply desktop mode if not pinned/always_on_top
        if always_on_top {
            win.set_always_on_top(true).map_err(|e| e.to_string())?;
        } else {
            win.set_always_on_top(false).map_err(|e| e.to_string())?;
            crate::desktop::set_desktop_mode(app.clone(), id.clone(), true).await?;
        }
    } else {
        return Err(format!("Widget window '{}' was not created", id));
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

#[tauri::command]
pub fn get_antigravity_setup_status(
    app: AppHandle,
) -> Result<crate::antigravity::AntigravitySetupStatus, String> {
    Ok(crate::antigravity::get_setup_status(&app))
}
