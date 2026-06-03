use std::path::{Path, PathBuf};

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::Engine;
use serde::Deserialize;

const GITHUB_AUTH_SECRET_KEY: &str =
    r#"secret://{"extensionId":"vscode.github-authentication","key":"github.auth"}"#;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionData {
    #[serde(default)]
    id: String,
    access_token: String,
    account: Option<SessionAccount>,
    #[serde(default)]
    scopes: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct SessionAccount {
    label: Option<String>,
    id: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct BufferSecret {
    #[serde(rename = "type")]
    secret_type: String,
    data: Vec<u8>,
}

fn shared_data_folder_name(app_name: &str) -> &'static str {
    match app_name {
        "Code - Insiders" => ".vscode-insiders-shared",
        "Code - Exploration" => ".vscode-exploration-shared",
        _ => ".vscode-shared",
    }
}

fn user_home_dir() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        std::env::var("USERPROFILE").ok().map(PathBuf::from)
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::env::var("HOME").ok().map(PathBuf::from)
    }
}

/// VS Code 1.118+ stores cross-app secrets (e.g. github.auth) in APPLICATION_SHARED storage.
fn get_vscode_shared_db_path(app_name: &str) -> Option<PathBuf> {
    Some(
        user_home_dir()?
            .join(shared_data_folder_name(app_name))
            .join("sharedStorage")
            .join("state.vscdb"),
    )
}

/// Resolve VS Code user data directory for the given application name (e.g. "Code").
pub fn get_vscode_user_dir(app_name: &str) -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let appdata = std::env::var("APPDATA").ok()?;
        Some(PathBuf::from(appdata).join(app_name))
    }
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME").ok()?;
        Some(
            PathBuf::from(home)
                .join("Library")
                .join("Application Support")
                .join(app_name),
        )
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let home = std::env::var("HOME").ok()?;
        Some(PathBuf::from(home).join(".config").join(app_name))
    }
}

fn temp_vscdb_copy_path(prefix: &str) -> PathBuf {
    std::env::temp_dir().join(format!(
        "{}_{}_{}.db",
        prefix,
        chrono::Utc::now().timestamp_millis(),
        std::process::id()
    ))
}

fn read_vscdb_plaintext_key(db_path: &Path, target_key: &str) -> Result<Option<String>, String> {
    if !db_path.exists() {
        return Ok(None);
    }

    let temp_path = temp_vscdb_copy_path("vscdb_plain");

    std::fs::copy(db_path, &temp_path)
        .map_err(|e| format!("Failed to copy state database: {}", e))?;

    let res = (|| {
        let conn = rusqlite::Connection::open(&temp_path)
            .map_err(|e| format!("Failed to open database: {}", e))?;

        let mut stmt = conn
            .prepare("SELECT value FROM ItemTable WHERE key = ?")
            .map_err(|e| format!("Failed to prepare query: {}", e))?;

        let mut rows = stmt
            .query([target_key])
            .map_err(|e| format!("Query failed: {}", e))?;

        if let Some(row) = rows
            .next()
            .map_err(|e| format!("Error reading row: {}", e))?
        {
            let val: String = row
                .get(0)
                .map_err(|e| format!("Failed to get column value: {}", e))?;
            Ok(Some(val))
        } else {
            Ok(None)
        }
    })();

    let _ = std::fs::remove_file(&temp_path);
    res
}

#[cfg(target_os = "windows")]
fn dpapi_decrypt(data: &[u8]) -> Result<Vec<u8>, String> {
    use windows::Win32::Foundation::LocalFree;
    use windows::Win32::Security::Cryptography::{
        CryptUnprotectData, CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN,
    };

    let mut input = CRYPT_INTEGER_BLOB {
        cbData: data.len() as u32,
        pbData: data.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB::default();

    unsafe {
        CryptUnprotectData(
            &mut input,
            None,
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
        .map_err(|e| format!("DPAPI decrypt failed: {}", e))?;

        let decrypted =
            std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        let _ = LocalFree(Some(windows::Win32::Foundation::HLOCAL(output.pbData as _)));
        Ok(decrypted)
    }
}

#[cfg(target_os = "windows")]
fn load_os_crypt_master_key(local_state_path: &Path) -> Result<Vec<u8>, String> {
    let text = std::fs::read_to_string(local_state_path)
        .map_err(|e| format!("Failed to read Local State: {}", e))?;
    let json: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("Failed to parse Local State: {}", e))?;

    let encrypted_key_b64 = json
        .pointer("/os_crypt/encrypted_key")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Missing os_crypt.encrypted_key in Local State".to_string())?;

    let encrypted_key = base64::engine::general_purpose::STANDARD
        .decode(encrypted_key_b64)
        .map_err(|e| format!("Failed to decode encrypted_key: {}", e))?;

    if encrypted_key.len() <= 5 || &encrypted_key[..5] != b"DPAPI" {
        return Err("Unexpected encrypted_key format in Local State".to_string());
    }

    dpapi_decrypt(&encrypted_key[5..])
}

#[cfg(target_os = "windows")]
fn decrypt_v10_secret(raw: &[u8], master_key: &[u8]) -> Result<Vec<u8>, String> {
    if raw.len() < 3 + 12 + 16 || &raw[..3] != b"v10" {
        return Err("Unsupported secret encryption format".to_string());
    }

    let nonce = Nonce::from_slice(&raw[3..15]);
    let ciphertext = &raw[15..];

    let cipher = Aes256Gcm::new_from_slice(master_key)
        .map_err(|e| format!("Invalid AES key: {}", e))?;

    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| format!("AES decrypt failed: {}", e))
}

#[cfg(target_os = "windows")]
fn decode_secret_blob(raw: &str, master_key: &[u8]) -> Result<Vec<u8>, String> {
    let bytes = if raw.starts_with('{') {
        let wrapper: BufferSecret =
            serde_json::from_str(raw).map_err(|e| format!("Failed to parse secret JSON: {}", e))?;
        if wrapper.secret_type != "Buffer" {
            return Err(format!("Unsupported secret wrapper type: {}", wrapper.secret_type));
        }
        wrapper.data
    } else {
        raw.as_bytes().to_vec()
    };

    decrypt_v10_secret(&bytes, master_key)
}

#[cfg(target_os = "windows")]
fn read_vscdb_secret(db_path: &Path, local_state_path: &Path, target_key: &str) -> Result<Option<Vec<u8>>, String> {
    let encrypted = match read_vscdb_plaintext_key(db_path, target_key)? {
        Some(v) => v,
        None => return Ok(None),
    };

    let master_key = load_os_crypt_master_key(local_state_path)?;
    let decrypted = decode_secret_blob(&encrypted, &master_key)?;
    Ok(Some(decrypted))
}

fn session_score(scopes: &[String]) -> i32 {
    let joined = scopes.join(" ");
    let mut score = 0;
    if joined.contains("copilot") {
        score += 100;
    }
    if joined.contains("repo") {
        score += 40;
    }
    if joined.contains("workflow") {
        score += 20;
    }
    if joined.contains("read:user") {
        score += 10;
    }
    if joined.contains("user:email") {
        score += 5;
    }
    score
}

fn pick_github_session(
    sessions: Vec<SessionData>,
    preferred_account: Option<&str>,
) -> Result<SessionData, String> {
    if sessions.is_empty() {
        return Err("No GitHub sessions found".to_string());
    }

    let mut candidates = sessions;
    if let Some(account) = preferred_account.filter(|a| !a.is_empty()) {
        let filtered: Vec<_> = candidates
            .iter()
            .filter(|s| {
                s.account
                    .as_ref()
                    .and_then(|a| a.label.as_deref())
                    .map(|label| label.eq_ignore_ascii_case(account))
                    .unwrap_or(false)
            })
            .cloned()
            .collect();
        if filtered.is_empty() {
            return Err(format!(
                "No GitHub session for Copilot account '{}'. Sign in via VS Code Accounts menu.",
                account
            ));
        }
        candidates = filtered;
    }

    candidates.sort_by(|a, b| {
        session_score(&b.scopes)
            .cmp(&session_score(&a.scopes))
            .then_with(|| {
                a.account
                    .as_ref()
                    .and_then(|acc| acc.label.as_deref())
                    .unwrap_or("")
                    .cmp(
                        b.account
                            .as_ref()
                            .and_then(|acc| acc.label.as_deref())
                            .unwrap_or(""),
                    )
            })
    });

    Ok(candidates.remove(0))
}

fn get_preferred_copilot_account(app_name: &str) -> Option<String> {
    let db_path = get_vscode_user_dir(app_name)?.join("User").join("globalStorage").join("state.vscdb");
    read_vscdb_plaintext_key(&db_path, "github.copilot-github")
        .ok()
        .flatten()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn vscode_auth_db_paths(app_name: &str, user_dir: &Path) -> Vec<PathBuf> {
    let mut paths = Vec::new();

    if let Some(shared) = get_vscode_shared_db_path(app_name) {
        if shared.exists() {
            paths.push(shared);
        }
    }

    let legacy = user_dir
        .join("User")
        .join("globalStorage")
        .join("state.vscdb");
    if legacy.exists() && !paths.iter().any(|p| p == &legacy) {
        paths.push(legacy);
    }

    paths
}

/// Read GitHub token from VS Code encrypted secret storage (`github.auth`).
fn try_read_vscode_secret_token(
    app_name: &str,
    preferred_account: Option<&str>,
) -> Result<Option<(String, Option<String>)>, String> {
    let user_dir = match get_vscode_user_dir(app_name) {
        Some(dir) => dir,
        None => return Ok(None),
    };
    let local_state_path = user_dir.join("Local State");
    let db_paths = vscode_auth_db_paths(app_name, &user_dir);

    if db_paths.is_empty() {
        return Ok(None);
    }

    #[cfg(target_os = "windows")]
    {
        for db_path in db_paths {
            let secret = match read_vscdb_secret(&db_path, &local_state_path, GITHUB_AUTH_SECRET_KEY)? {
                Some(v) => v,
                None => continue,
            };

            let sessions: Vec<SessionData> = serde_json::from_slice(&secret)
                .map_err(|e| format!("Failed to parse GitHub sessions: {}", e))?;

            let session = pick_github_session(sessions, preferred_account)?;
            if session.access_token.trim().is_empty() {
                return Err("GitHub access token is empty. Please sign in again in VS Code.".to_string());
            }

            let label = session
                .account
                .as_ref()
                .and_then(|a| a.label.clone());

            return Ok(Some((session.access_token, label)));
        }

        Ok(None)
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (db_paths, local_state_path);
        Ok(None)
    }
}

/// Read GitHub token from VS Code authentication storage (not Git credentials).
pub fn read_vscode_copilot_github_token() -> Result<(String, Option<String>), String> {
    let preferred_account = ["Code", "Code - Insiders"]
        .into_iter()
        .find_map(get_preferred_copilot_account);

    for app_name in ["Code", "Code - Insiders"] {
        match try_read_vscode_secret_token(app_name, preferred_account.as_deref()) {
            Ok(Some(token)) => return Ok(token),
            Ok(None) => {}
            Err(e) => return Err(format!("{}: {}", app_name, e)),
        }
    }

    Err(
        "GitHub token not found in VS Code. Sign in via VS Code Accounts menu (GitHub).".to_string(),
    )
}
