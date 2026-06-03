use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

// Helper to find/initialize config file
pub fn get_config_path(app: &AppHandle, filename: &str) -> PathBuf {
    // 1. Try next to EXE (Highest priority, works for portable/bin usage)
    if let Ok(mut p) = std::env::current_exe() {
        p.pop();
        p.push("configs");
        let path = p.join(filename);
        if p.exists() { return path; }
        
        // Try to create it if it doesn't exist (only if writable)
        if fs::create_dir_all(&p).is_ok() {
            // Check if we can actually write to it
            let test_file = p.join(".write_test");
            if fs::write(&test_file, "").is_ok() {
                let _ = fs::remove_file(test_file);
                return path;
            }
        }
    }

    // 2. Fallback to AppData (Standard for installed apps in C:\Program Files)
    let config_dir = app.path().app_config_dir().unwrap_or_else(|_| {
        std::env::current_dir().unwrap_or_default().join("configs")
    });
    
    if !config_dir.exists() {
        let _ = fs::create_dir_all(&config_dir);
    }
    
    let path = config_dir.join(filename);
    
    // If doesn't exist in AppData, try to copy from bundled resources
    if !path.exists() {
        if let Ok(resource_dir) = app.path().resource_dir() {
            let resource_path = resource_dir.join("configs").join(filename);
            if resource_path.exists() {
                let _ = fs::copy(resource_path, &path);
            }
        }
    }
    
    path
}
