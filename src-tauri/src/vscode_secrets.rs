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
    access_token: String,
    account: Option<SessionAccount>,
    #[serde(default)]
    scopes: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct SessionAccount {
    label: Option<String>,
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
    // On Windows, HOME is often unset; fall back to USERPROFILE
    #[cfg(target_os = "windows")]
    {
        if let Ok(home) = std::env::var("USERPROFILE") {
            if !home.is_empty() {
                return Some(PathBuf::from(home));
            }
        }
    }
    let expanded = shellexpand::tilde("~").to_string();
    if expanded.starts_with('~') {
        None
    } else {
        Some(PathBuf::from(expanded))
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

fn read_vscdb_plaintext_key(db_path: &Path, target_key: &str) -> Result<Option<String>, String> {
    crate::sqlite_state::read_text_key(db_path, target_key)
}

#[cfg(not(target_os = "windows"))]
fn derive_os_crypt_key(password: &str) -> [u8; 32] {
    use pbkdf2::pbkdf2_hmac;
    use sha1::Sha1;

    let mut key = [0u8; 32];
    pbkdf2_hmac::<Sha1>(password.as_bytes(), b"saltysalt", 1003, &mut key);
    key
}

fn decrypt_v10_secret(raw: &[u8], key: &[u8]) -> Result<Vec<u8>, String> {
    if raw.len() < 3 + 12 + 16 || &raw[..3] != b"v10" {
        return Err("Unsupported secret encryption format".to_string());
    }

    let nonce = Nonce::from_slice(&raw[3..15]);
    let ciphertext = &raw[15..];

    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| format!("Invalid AES key: {}", e))?;

    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| format!("AES decrypt failed: {}", e))
}

/// Electron / Chromium OSCrypt on macOS & Linux uses AES-128-CBC with a 16-space IV.
#[cfg(not(target_os = "windows"))]
fn decrypt_v10_aes128_cbc(raw: &[u8], key: &[u8; 16]) -> Result<Vec<u8>, String> {
    use aes::cipher::{block_padding::Pkcs7, BlockDecryptMut, KeyIvInit};
    type Aes128CbcDec = cbc::Decryptor<aes::Aes128>;

    if raw.len() < 3 || (&raw[..3] != b"v10" && &raw[..3] != b"v11") {
        return Err("Unsupported safeStorage encryption format".to_string());
    }

    let iv = [b' '; 16];
    let mut buffer = raw[3..].to_vec();
    let plain_len = Aes128CbcDec::new(key.into(), &iv.into())
        .decrypt_padded_mut::<Pkcs7>(&mut buffer)
        .map(|plain| plain.len())
        .map_err(|e| format!("AES-128-CBC decrypt failed: {}", e))?;
    buffer.truncate(plain_len);
    Ok(buffer)
}

#[cfg(not(target_os = "windows"))]
fn derive_os_crypt_key_16(password: &str) -> [u8; 16] {
    use pbkdf2::pbkdf2_hmac;
    use sha1::Sha1;

    let mut key = [0u8; 16];
    pbkdf2_hmac::<Sha1>(password.as_bytes(), b"saltysalt", 1003, &mut key);
    key
}

const CURSOR_SAFE_STORAGE_PREFIX: &str = "cursor-safe-storage:v1:";

/// Unwrap a Cursor auth token cell.
///
/// Recent Cursor builds seal `cursorAuth/accessToken` with Electron safeStorage as
/// `cursor-safe-storage:v1:` + base64(v10 ciphertext). Older builds still store a
/// plaintext JWT — those are returned unchanged.
pub fn unwrap_cursor_auth_token(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("Cursor access token is empty".to_string());
    }
    if !trimmed.starts_with(CURSOR_SAFE_STORAGE_PREFIX) {
        return Ok(trimmed.to_string());
    }

    let encoded = &trimmed[CURSOR_SAFE_STORAGE_PREFIX.len()..];
    let encrypted = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|e| format!("Failed to decode cursor-safe-storage payload: {}", e))?;

    let plaintext = decrypt_cursor_safe_storage_blob(&encrypted)?;
    String::from_utf8(plaintext).map_err(|_| "Decrypted Cursor token is not UTF-8".to_string())
}

fn decrypt_cursor_safe_storage_blob(encrypted: &[u8]) -> Result<Vec<u8>, String> {
    #[cfg(target_os = "windows")]
    {
        let user_dir = get_vscode_user_dir("Cursor")
            .ok_or_else(|| "Could not resolve Cursor user data directory".to_string())?;
        let local_state_path = user_dir.join("Local State");
        let master_key = load_os_crypt_master_key(&local_state_path, "Cursor")?;
        return decrypt_v10_secret(encrypted, &master_key);
    }

    #[cfg(not(target_os = "windows"))]
    {
        let password = get_os_crypt_password("Cursor")?;
        let key = derive_os_crypt_key_16(&password);
        decrypt_v10_aes128_cbc(encrypted, &key)
    }
}

fn decode_secret_blob(raw: &str, master_key: &[u8]) -> Result<Vec<u8>, String> {
    let bytes = if raw.starts_with('{') {
        let wrapper: BufferSecret =
            serde_json::from_str(raw).map_err(|e| format!("Failed to parse secret JSON: {}", e))?;
        if wrapper.secret_type != "Buffer" {
            return Err(format!(
                "Unsupported secret wrapper type: {}",
                wrapper.secret_type
            ));
        }
        wrapper.data
    } else {
        raw.as_bytes().to_vec()
    };

    decrypt_v10_secret(&bytes, master_key)
}

#[cfg(target_os = "macos")]
fn macos_keychain_password(service: &str, account: &str) -> Result<String, String> {
    use std::process::Command;

    let output = Command::new("security")
        .args(["find-generic-password", "-s", service, "-a", account, "-w"])
        .output()
        .map_err(|e| format!("Failed to run security CLI: {}", e))?;

    if !output.status.success() {
        return Err(format!(
            "Keychain lookup failed for service '{}' account '{}'",
            service, account
        ));
    }

    let password = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if password.is_empty() {
        return Err("Keychain returned an empty password".to_string());
    }
    Ok(password)
}

#[cfg(target_os = "macos")]
fn get_os_crypt_password(app_name: &str) -> Result<String, String> {
    let candidates: &[(&str, &str)] = match app_name {
        "Code" => &[("Code Safe Storage", "Code Key")],
        "Code - Insiders" => &[("Code - Insiders Safe Storage", "Code - Insiders Key")],
        "QoderCN" => &[
            ("QoderCN Safe Storage", "QoderCN Key"),
            ("Qoder CN Safe Storage", "Qoder CN Key"),
        ],
        _ => &[],
    };

    let mut last_err = String::new();
    for (service, account) in candidates {
        match macos_keychain_password(service, account) {
            Ok(password) => return Ok(password),
            Err(e) => last_err = e,
        }
    }

    let service = format!("{app_name} Safe Storage");
    let account = format!("{app_name} Key");
    match macos_keychain_password(&service, &account) {
        Ok(password) => Ok(password),
        Err(e) => Err(if last_err.is_empty() {
            e
        } else {
            format!("{}; fallback lookup failed: {}", last_err, e)
        }),
    }
}

#[cfg(target_os = "linux")]
fn linux_secret_password(app_name: &str) -> Option<String> {
    use std::process::Command;

    for args in [
        [
            "lookup",
            "xdg:schema",
            "chrome_libsecret_os_crypt_password_v2",
            "application",
            "chrome",
        ],
        [
            "lookup",
            "xdg:schema",
            "chrome_libsecret_os_crypt_password_v2",
            "application",
            "vscode",
        ],
    ] {
        let output = Command::new("secret-tool").args(args).output().ok()?;
        if !output.status.success() {
            continue;
        }
        let password = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !password.is_empty() {
            return Some(password);
        }
    }

    let app_lookup = app_name.to_ascii_lowercase();
    let output = Command::new("secret-tool")
        .args([
            "lookup",
            "xdg:schema",
            "chrome_libsecret_os_crypt_password_v2",
            "application",
            &app_lookup,
        ])
        .output()
        .ok()?;
    if output.status.success() {
        let password = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !password.is_empty() {
            return Some(password);
        }
    }

    None
}

#[cfg(target_os = "linux")]
fn get_os_crypt_password(app_name: &str) -> Result<String, String> {
    if let Some(password) = linux_secret_password(app_name) {
        return Ok(password);
    }

    log::debug!(
        "Linux secret-tool lookup failed for '{}', falling back to default Chromium password",
        app_name
    );
    Ok("peanuts".to_string())
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
fn get_os_crypt_password(_app_name: &str) -> Result<String, String> {
    Err("OS secret storage is not supported on this platform".to_string())
}

fn load_os_crypt_master_key(
    local_state_path: &Path,
    #[cfg_attr(target_os = "windows", allow(unused_variables))] app_name: &str,
) -> Result<Vec<u8>, String> {
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

    #[cfg(target_os = "windows")]
    {
        if encrypted_key.len() <= 5 || &encrypted_key[..5] != b"DPAPI" {
            return Err("Unexpected encrypted_key format in Local State".to_string());
        }
        return dpapi_decrypt(&encrypted_key[5..]);
    }

    #[cfg(not(target_os = "windows"))]
    {
        let password = get_os_crypt_password(app_name)?;
        let derived_key = derive_os_crypt_key(&password);
        decrypt_v10_secret(&encrypted_key, &derived_key)
    }
}

fn read_vscdb_secret(
    db_path: &Path,
    local_state_path: &Path,
    app_name: &str,
    target_key: &str,
) -> Result<Option<Vec<u8>>, String> {
    let encrypted = match read_vscdb_plaintext_key(db_path, target_key)? {
        Some(v) => v,
        None => return Ok(None),
    };

    let master_key = load_os_crypt_master_key(local_state_path, app_name)?;
    let decrypted = decode_secret_blob(&encrypted, &master_key)?;
    Ok(Some(decrypted))
}

#[cfg(target_os = "windows")]
fn dpapi_decrypt(data: &[u8]) -> Result<Vec<u8>, String> {
    use windows::Win32::Foundation::LocalFree;
    use windows::Win32::Security::Cryptography::{
        CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
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

        let decrypted = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        let _ = LocalFree(Some(windows::Win32::Foundation::HLOCAL(output.pbData as _)));
        Ok(decrypted)
    }
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
    let db_path = get_vscode_user_dir(app_name)?
        .join("User")
        .join("globalStorage")
        .join("state.vscdb");
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

    for db_path in db_paths {
        let secret = match read_vscdb_secret(
            &db_path,
            &local_state_path,
            app_name,
            GITHUB_AUTH_SECRET_KEY,
        )? {
            Some(v) => v,
            None => continue,
        };

        let sessions: Vec<SessionData> = serde_json::from_slice(&secret)
            .map_err(|e| format!("Failed to parse GitHub sessions: {}", e))?;

        let session = pick_github_session(sessions, preferred_account)?;
        if session.access_token.trim().is_empty() {
            return Err(
                "GitHub access token is empty. Please sign in again in VS Code.".to_string(),
            );
        }

        let label = session.account.as_ref().and_then(|a| a.label.clone());

        return Ok(Some((session.access_token, label)));
    }

    Ok(None)
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
        "GitHub token not found in VS Code. Sign in via VS Code Accounts menu (GitHub)."
            .to_string(),
    )
}

const QODER_CN_USER_INFO_SECRET_KEY: &str = "secret://aicoding.auth.userInfo";
const QODER_CN_USER_PLAN_SECRET_KEY: &str = "secret://aicoding.auth.userPlan";

fn read_app_encrypted_secret(app_name: &str, key: &str) -> Result<Option<Vec<u8>>, String> {
    let user_dir = match get_vscode_user_dir(app_name) {
        Some(dir) => dir,
        None => return Ok(None),
    };
    let local_state_path = user_dir.join("Local State");
    let db_path = user_dir
        .join("User")
        .join("globalStorage")
        .join("state.vscdb");

    if !db_path.exists() {
        return Ok(None);
    }

    read_vscdb_secret(&db_path, &local_state_path, app_name, key)
}

const QODER_CN_APP_DIRS: &[&str] = &["QoderCN", "Qoder CN", "qoder-cn"];

fn read_qoder_cn_encrypted_secret(key: &str) -> Result<Option<Vec<u8>>, String> {
    let mut last_err = None;
    for app_name in QODER_CN_APP_DIRS {
        match read_app_encrypted_secret(app_name, key) {
            Ok(Some(secret)) => return Ok(Some(secret)),
            Ok(None) => {}
            Err(e) => last_err = Some(e),
        }
    }

    if let Some(err) = last_err {
        return Err(err);
    }
    Ok(None)
}

/// Cached plan/quota blob written by QoderCN IDE (`secret://aicoding.auth.userPlan`).
pub fn read_qoder_cn_user_plan() -> Result<Option<serde_json::Value>, String> {
    let secret = match read_qoder_cn_encrypted_secret(QODER_CN_USER_PLAN_SECRET_KEY)? {
        Some(v) => v,
        None => return Ok(None),
    };
    let parsed: serde_json::Value = serde_json::from_slice(&secret)
        .map_err(|e| format!("Failed to parse Qoder CN user plan: {}", e))?;
    Ok(Some(parsed))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct QoderUserInfo {
    #[serde(default)]
    token: String,
    #[serde(default)]
    access_token: String,
    #[serde(default)]
    refresh_token: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    email: Option<String>,
}

fn extract_qoder_cn_token_from_json(value: &serde_json::Value) -> String {
    for key in [
        "token",
        "accessToken",
        "access_token",
        "pat",
        "personalAccessToken",
        "idToken",
        "securityOauthToken",
    ] {
        if let Some(token) = value.get(key).and_then(|v| v.as_str()) {
            let trimmed = token.trim();
            if !trimmed.is_empty() {
                return trimmed.to_string();
            }
        }
    }
    for nested_key in ["data", "userInfo", "session", "auth", "user"] {
        if let Some(nested) = value.get(nested_key) {
            let nested_token = extract_qoder_cn_token_from_json(nested);
            if !nested_token.is_empty() {
                return nested_token;
            }
        }
    }
    String::new()
}

fn extract_qoder_cn_refresh_token_from_json(value: &serde_json::Value) -> String {
    for key in ["refreshToken", "refresh_token"] {
        if let Some(token) = value.get(key).and_then(|v| v.as_str()) {
            let trimmed = token.trim();
            if !trimmed.is_empty() {
                return trimmed.to_string();
            }
        }
    }
    for nested_key in ["data", "userInfo", "session", "auth", "user"] {
        if let Some(nested) = value.get(nested_key) {
            let nested_token = extract_qoder_cn_refresh_token_from_json(nested);
            if !nested_token.is_empty() {
                return nested_token;
            }
        }
    }
    String::new()
}

#[derive(Debug, Clone)]
pub struct QoderCnAuthSession {
    pub token: String,
    pub label: Option<String>,
}

/// Read Qoder CN login session from QoderCN IDE encrypted secret storage.
pub fn read_qoder_cn_auth_session() -> Result<Option<QoderCnAuthSession>, String> {
    let secret = match read_qoder_cn_encrypted_secret(QODER_CN_USER_INFO_SECRET_KEY)? {
        Some(v) => v,
        None => {
            log::debug!("Qoder CN user info secret not found in IDE storage");
            return Ok(None);
        }
    };

    let info: QoderUserInfo = serde_json::from_slice(&secret)
        .map_err(|e| format!("Failed to parse Qoder CN user info: {}", e))?;

    let raw: serde_json::Value = serde_json::from_slice(&secret).unwrap_or(serde_json::Value::Null);
    let token = if !info.token.trim().is_empty() {
        info.token.trim().to_string()
    } else if !info.access_token.trim().is_empty() {
        info.access_token.trim().to_string()
    } else {
        extract_qoder_cn_token_from_json(&raw)
    };
    if token.is_empty() {
        let refresh_token = if !info.refresh_token.trim().is_empty() {
            info.refresh_token.trim().to_string()
        } else {
            extract_qoder_cn_refresh_token_from_json(&raw)
        };
        if refresh_token.is_empty() {
            let logged_in = raw
                .get("status")
                .and_then(|v| v.as_str())
                .map(|s| s != "unauthorized" && !s.is_empty())
                .unwrap_or_else(|| {
                    raw.get("email")
                        .or_else(|| raw.get("name"))
                        .and_then(|v| v.as_str())
                        .map(|s| !s.is_empty())
                        .unwrap_or(false)
                });
            if logged_in {
                log::warn!(
                    "Qoder CN IDE profile found but session token is empty — sign out and sign in again in QoderCN IDE"
                );
            }
            return Ok(None);
        }
    }

    let label = info.name.or(info.email);
    Ok(Some(QoderCnAuthSession { token, label }))
}

/// Read Qoder CN login token from QoderCN IDE encrypted secret storage.
pub fn read_qoder_cn_auth_token() -> Result<Option<(String, Option<String>)>, String> {
    Ok(read_qoder_cn_auth_session()?.and_then(|session| {
        if session.token.is_empty() {
            None
        } else {
            Some((session.token, session.label))
        }
    }))
}
