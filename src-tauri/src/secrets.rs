use base64::Engine;

const SECRET_PREFIX: &str = "widgitron-secret:v1:";

pub fn is_encrypted_secret(value: &str) -> bool {
    value.starts_with(SECRET_PREFIX)
}

pub fn encrypt_secret(value: &str) -> Result<String, String> {
    if value.trim().is_empty() || is_encrypted_secret(value) {
        return Ok(value.to_string());
    }

    let encrypted = platform_encrypt(value.as_bytes())?;
    Ok(format!(
        "{}{}",
        SECRET_PREFIX,
        base64::engine::general_purpose::STANDARD.encode(encrypted)
    ))
}

pub fn decrypt_secret(value: &str) -> Result<String, String> {
    if !is_encrypted_secret(value) {
        return Ok(value.to_string());
    }

    let encoded = value.trim_start_matches(SECRET_PREFIX);
    let encrypted = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|e| format!("Failed to decode encrypted secret: {}", e))?;
    let decrypted = platform_decrypt(&encrypted)?;
    String::from_utf8(decrypted).map_err(|e| format!("Encrypted secret is not UTF-8: {}", e))
}

#[cfg(target_os = "windows")]
fn platform_encrypt(data: &[u8]) -> Result<Vec<u8>, String> {
    use windows::Win32::Security::Cryptography::{
        CryptProtectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    unsafe {
        let mut input = CRYPT_INTEGER_BLOB {
            cbData: data.len() as u32,
            pbData: data.as_ptr() as *mut u8,
        };
        let mut output = CRYPT_INTEGER_BLOB::default();

        CryptProtectData(
            &mut input,
            None,
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
        .map_err(|e| format!("DPAPI encrypt failed: {}", e))?;

        let encrypted =
            std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        use windows::Win32::Foundation::{HLOCAL, LocalFree};
        let _ = LocalFree(Some(HLOCAL(output.pbData as _)));
        Ok(encrypted)
    }
}

#[cfg(target_os = "windows")]
fn platform_decrypt(data: &[u8]) -> Result<Vec<u8>, String> {
    use windows::Win32::Security::Cryptography::{
        CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    unsafe {
        let mut input = CRYPT_INTEGER_BLOB {
            cbData: data.len() as u32,
            pbData: data.as_ptr() as *mut u8,
        };
        let mut output = CRYPT_INTEGER_BLOB::default();

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
        use windows::Win32::Foundation::{HLOCAL, LocalFree};
        let _ = LocalFree(Some(HLOCAL(output.pbData as _)));
        Ok(decrypted)
    }
}

#[cfg(not(target_os = "windows"))]
fn platform_encrypt(_data: &[u8]) -> Result<Vec<u8>, String> {
    Err("Encrypted secret storage is only implemented for Windows DPAPI in this build".to_string())
}

#[cfg(not(target_os = "windows"))]
fn platform_decrypt(_data: &[u8]) -> Result<Vec<u8>, String> {
    Err("Encrypted secret storage is only implemented for Windows DPAPI in this build".to_string())
}
