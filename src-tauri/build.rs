use std::fs;
use std::path::Path;

fn sync_seed_configs() {
    let source_dir = Path::new("../configs");
    let target_dir = Path::new("configs");

    if !source_dir.is_dir() {
        return;
    }

    let _ = fs::create_dir_all(target_dir);
    let Ok(entries) = fs::read_dir(source_dir) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
            continue;
        }
        let Some(name) = path.file_name() else {
            continue;
        };
        let target = target_dir.join(name);
        if fs::copy(&path, &target).is_ok() {
            println!("cargo:rerun-if-changed={}", path.display());
        }
    }
}

fn main() {
    // Common-controls subclass helpers require v6. Embed the dependency in
    // native integration tests too (Tauri embeds its own app manifest).
    #[cfg(all(windows, target_env = "msvc"))]
    {
        let manifest = Path::new(env!("CARGO_MANIFEST_DIR")).join("windows.manifest");
        println!("cargo:rerun-if-changed={}", manifest.display());
        println!("cargo:rustc-link-arg-tests=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg-tests=/MANIFESTINPUT:{}", manifest.display());
    }
    sync_seed_configs();
    tauri_build::build();
}
