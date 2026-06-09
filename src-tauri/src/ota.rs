use tauri::{AppHandle, Emitter};
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
struct GithubAsset {
    name: String,
    browser_download_url: String,
    size: u64,
}

#[derive(Debug, Deserialize)]
struct GithubRelease {
    tag_name: String,
    body: String,
    assets: Vec<GithubAsset>,
}

#[derive(Debug, Serialize, Clone)]
pub struct UpdateInfo {
    pub has_update: bool,
    pub current_version: String,
    pub latest_version: String,
    pub release_notes: String,
    pub download_url: Option<String>,
    pub asset_name: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
struct ProgressPayload {
    state: String, // "downloading" | "completed" | "error"
    progress: u8,
    error: Option<String>,
}

#[tauri::command]
pub async fn check_for_updates(app: AppHandle) -> Result<UpdateInfo, String> {
    let current_version = app.package_info().version.to_string();
    log::info!("Checking for updates. Current version: {}", current_version);
    
    let client = reqwest::Client::builder()
        .user_agent("widgitron-updater")
        .connect_timeout(std::time::Duration::from_secs(15))
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {:?}", e))?;

    let url = "https://api.github.com/repos/starkmomo/widgitron/releases/latest";
    let response = client.get(url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch release info: {:?}", e))?;

    if !response.status().is_success() {
        return Err(format!("GitHub API returned status code: {}", response.status()));
    }

    let release: GithubRelease = response.json()
        .await
        .map_err(|e| format!("Failed to parse release JSON: {:?}", e))?;

    let latest_tag = release.tag_name.clone();
    let cleaned_latest = latest_tag.strip_prefix('v').unwrap_or(&latest_tag);
    let cleaned_current = current_version.strip_prefix('v').unwrap_or(&current_version);

    let has_update = match (semver::Version::parse(cleaned_latest), semver::Version::parse(cleaned_current)) {
        (Ok(latest), Ok(current)) => latest > current,
        _ => cleaned_latest != cleaned_current,
    };

    log::info!("Latest version: {}, has_update: {}", latest_tag, has_update);

    let mut download_url = None;
    let mut asset_name = None;

    if has_update {
        // Find Windows asset: prioritize _x64-setup.exe, then -setup.exe, then .exe, then .msi
        let windows_asset = release.assets.iter()
            .find(|a| a.name.ends_with("_x64-setup.exe"))
            .or_else(|| release.assets.iter().find(|a| a.name.ends_with("-setup.exe")))
            .or_else(|| release.assets.iter().find(|a| a.name.ends_with(".exe")))
            .or_else(|| release.assets.iter().find(|a| a.name.ends_with(".msi")));

        if let Some(asset) = windows_asset {
            download_url = Some(asset.browser_download_url.clone());
            asset_name = Some(asset.name.clone());
            log::info!("Found Windows update asset: {} ({})", asset.name, asset.browser_download_url);
        } else {
            log::warn!("No suitable Windows installation asset found in release");
        }
    }

    Ok(UpdateInfo {
        has_update,
        current_version,
        latest_version: latest_tag,
        release_notes: release.body,
        download_url,
        asset_name,
    })
}

#[tauri::command]
pub async fn download_and_install_update(app: AppHandle, download_url: String, asset_name: String) -> Result<(), String> {
    log::info!("Starting download of update: {} from {}", asset_name, download_url);
    tauri::async_runtime::spawn(async move {
        if let Err(e) = perform_download_and_install(&app, &download_url, &asset_name).await {
            log::error!("OTA update download or installation failed: {}", e);
            let _ = app.emit("ota_download_progress", ProgressPayload {
                state: "error".into(),
                progress: 0,
                error: Some(e),
            });
        }
    });
    Ok(())
}

async fn perform_download_and_install(app: &AppHandle, download_url: &str, asset_name: &str) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .user_agent("widgitron-updater")
        .connect_timeout(std::time::Duration::from_secs(15))
        .timeout(std::time::Duration::from_secs(600)) // 10 minutes total timeout for download
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {:?}", e))?;

    let mut response = client.get(download_url)
        .send()
        .await
        .map_err(|e| format!("Failed to download update file: {:?}", e))?;

    if !response.status().is_success() {
        return Err(format!("Download request failed with status: {}", response.status()));
    }

    let total_size = response.content_length().unwrap_or(0);
    log::info!("Download size: {} bytes", total_size);

    let temp_dir = std::env::temp_dir();
    let installer_path = temp_dir.join(asset_name);
    log::info!("Saving installer to: {:?}", installer_path);

    let mut file = std::fs::File::create(&installer_path)
        .map_err(|e| format!("Failed to create destination file: {:?}", e))?;

    // Emit initial progress
    let _ = app.emit("ota_download_progress", ProgressPayload {
        state: "downloading".into(),
        progress: 0,
        error: None,
    });

    let mut downloaded: u64 = 0;
    let mut last_emitted_percentage = 0u8;

    while let Some(chunk) = response.chunk().await.map_err(|e| format!("Error receiving chunk: {:?}", e))? {
        use std::io::Write;
        file.write_all(&chunk)
            .map_err(|e| format!("Error writing chunk to file: {:?}", e))?;

        downloaded += chunk.len() as u64;

        if total_size > 0 {
            let percentage = ((downloaded as f64 / total_size as f64) * 100.0) as u8;
            if percentage > last_emitted_percentage {
                last_emitted_percentage = percentage;
                let _ = app.emit("ota_download_progress", ProgressPayload {
                    state: "downloading".into(),
                    progress: percentage,
                    error: None,
                });
            }
        }
    }

    // Flush and close the file
    drop(file);
    log::info!("Download completed successfully. Launching installer...");

    // Emit completion event
    let _ = app.emit("ota_download_progress", ProgressPayload {
        state: "completed".into(),
        progress: 100,
        error: None,
    });

    // Execute the installer
    run_installer(&installer_path)?;

    Ok(())
}

fn run_installer(path: &std::path::Path) -> Result<(), String> {
    let path_str = path.to_string_lossy();

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(&["/C", "start", "", &path_str])
            .spawn()
            .map_err(|e| format!("Failed to start installer process: {}", e))?;
    }

    #[cfg(not(target_os = "windows"))]
    {
        std::process::Command::new("open")
            .arg(&path_str)
            .spawn()
            .map_err(|e| format!("Failed to start installer process: {}", e))?;
    }

    Ok(())
}
