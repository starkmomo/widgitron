use base64::Engine;

const SECRET_PREFIX: &str = "widgitron-secret:v1:";
const MAC_SECRET_PREFIX: &str = "widgitron-secret:macos-aes256-gcm:v1:";
const SECRET_NAMESPACE: &str = "widgitron-secret:";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum SecretFormat { WindowsDpapi, MacAesGcm }

pub fn is_encrypted_secret(value: &str) -> bool {
    value.starts_with(SECRET_NAMESPACE)
}

pub fn encrypt_secret(value: &str) -> Result<String, String> {
    if value.trim().is_empty() || is_encrypted_secret(value) {
        return Ok(value.to_string());
    }

    let encrypted = platform_encrypt(value.as_bytes())?;
    #[cfg(target_os = "macos")]
    let prefix = MAC_SECRET_PREFIX;
    #[cfg(not(target_os = "macos"))]
    let prefix = SECRET_PREFIX;
    Ok(format!(
        "{}{}",
        prefix,
        base64::engine::general_purpose::STANDARD.encode(encrypted)
    ))
}

pub fn decrypt_secret(value: &str) -> Result<String, String> {
    let Some((format, encrypted)) = decode_envelope(value)? else {
        // Legacy plaintext is migrated the next time its config is saved.
        return Ok(value.to_string());
    };
    #[cfg(target_os = "macos")]
    if format != SecretFormat::MacAesGcm {
        return Err("This secret uses Windows DPAPI and cannot be decrypted on macOS; re-enter it on this Mac".into());
    }
    #[cfg(target_os = "windows")]
    if format != SecretFormat::WindowsDpapi {
        return Err("This secret uses macOS Keychain encryption and cannot be decrypted on Windows; re-enter it on this PC".into());
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let _ = format;
    let decrypted = platform_decrypt(&encrypted)?;
    String::from_utf8(decrypted).map_err(|_| "Encrypted secret is not UTF-8".into())
}

fn decode_envelope(value: &str) -> Result<Option<(SecretFormat, Vec<u8>)>, String> {
    let (format, encoded) = if let Some(encoded) = value.strip_prefix(SECRET_PREFIX) {
        (SecretFormat::WindowsDpapi, encoded)
    } else if let Some(encoded) = value.strip_prefix(MAC_SECRET_PREFIX) {
        (SecretFormat::MacAesGcm, encoded)
    } else if is_encrypted_secret(value) {
        return Err("Unsupported encrypted secret format".into());
    } else {
        return Ok(None);
    };
    let encrypted = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|e| format!("Failed to decode encrypted secret: {}", e))?;
    if format == SecretFormat::MacAesGcm && encrypted.len() < 12 + 16 {
        return Err("Encrypted secret is truncated".into());
    }
    Ok(Some((format, encrypted)))
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

        let encrypted = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        use windows::Win32::Foundation::{LocalFree, HLOCAL};
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

        let decrypted = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        use windows::Win32::Foundation::{LocalFree, HLOCAL};
        let _ = LocalFree(Some(HLOCAL(output.pbData as _)));
        Ok(decrypted)
    }
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn platform_encrypt(_data: &[u8]) -> Result<Vec<u8>, String> {
    Err("Secure secret storage is not supported on this platform".to_string())
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn platform_decrypt(_data: &[u8]) -> Result<Vec<u8>, String> {
    Err("Secure secret storage is not supported on this platform".to_string())
}

#[cfg(any(target_os = "macos", test))]
fn aes_encrypt(data: &[u8], key: &[u8], nonce: &[u8; 12]) -> Result<Vec<u8>, String> {
    use aes_gcm::{aead::{Aead, KeyInit, Payload}, Aes256Gcm, Nonce};
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| "Invalid encryption key length")?;
    let ciphertext = cipher.encrypt(Nonce::from_slice(nonce), Payload { msg: data, aad: MAC_SECRET_PREFIX.as_bytes() })
        .map_err(|_| "Secret encryption failed")?;
    let mut result = nonce.to_vec();
    result.extend_from_slice(&ciphertext);
    Ok(result)
}

#[cfg(any(target_os = "macos", test))]
fn aes_decrypt(data: &[u8], key: &[u8]) -> Result<Vec<u8>, String> {
    use aes_gcm::{aead::{Aead, KeyInit, Payload}, Aes256Gcm, Nonce};
    // GCM always needs a 96-bit nonce and 128-bit authentication tag.
    if data.len() < 12 + 16 { return Err("Encrypted secret is truncated".into()); }
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| "Invalid encryption key length")?;
    cipher.decrypt(Nonce::from_slice(&data[..12]), Payload { msg: &data[12..], aad: MAC_SECRET_PREFIX.as_bytes() })
        .map_err(|_| "Secret authentication failed; the key is unavailable or the ciphertext was changed".into())
}

#[cfg(any(target_os = "macos", test))]
fn read_or_create_master_key(
    allow_create: bool,
    mut read: impl FnMut() -> Result<Option<Vec<u8>>, String>,
    mut create_only: impl FnMut(&[u8]) -> Result<(), String>,
    generate: impl FnOnce() -> Result<[u8; 32], String>,
) -> Result<[u8; 32], String> {
    let bytes = match read()? {
        Some(bytes) => bytes,
        None if !allow_create => return Err("The macOS encryption key is missing from Keychain; re-enter the affected credentials".into()),
        None => {
            let candidate = generate()?;
            create_only(&candidate)?;
            // Another process may have created it first. Always use the stored
            // winner rather than encrypting with a key that was never saved.
            read()?.ok_or("The encryption key could not be read back from Keychain")?
        }
    };
    bytes.try_into().map_err(|_| "The macOS encryption key in Keychain is invalid; refusing to replace it".into())
}

#[cfg(target_os = "macos")]
fn random_bytes<const N: usize>() -> Result<[u8; N], String> {
    use aes_gcm::aead::{rand_core::RngCore, OsRng};
    let mut bytes = [0u8; N];
    OsRng.try_fill_bytes(&mut bytes).map_err(|_| "The operating system could not generate secure random bytes")?;
    Ok(bytes)
}

#[cfg(target_os = "macos")]
fn macos_master_key(allow_create: bool) -> Result<[u8; 32], String> {
    use security_framework::os::macos::keychain::{SecKeychain, SecPreferencesDomain};
    use std::sync::Mutex;
    const ACCOUNT: &str = "configuration-aes256-gcm-v1";
    static KEY: Mutex<Option<(String, [u8; 32])>> = Mutex::new(None);

    // Runtime bundle identity also isolates release-built QA apps from the
    // installed production app. Never silently share the production key.
    let bundle = objc2_foundation::NSBundle::mainBundle().bundleIdentifier()
        .map(|id| id.to_string()).filter(|id| !id.trim().is_empty())
        .ok_or("Secure credential storage requires a macOS application bundle identifier")?;
    let service = format!("{bundle}.configuration-secrets");
    let mut cached = KEY.lock().map_err(|_| "The encryption key lock is unavailable")?;
    if let Some((cached_service, key)) = &*cached {
        if cached_service == &service { return Ok(*key); }
    }
    let entry = keyring::Entry::new_with_target("User", &service, ACCOUNT)
        .map_err(|error| format!("Could not open macOS Keychain: {error}"))?;
    let key = read_or_create_master_key(allow_create, || match entry.get_secret() {
        Ok(bytes) => Ok(Some(bytes)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(format!("Could not read the encryption key from macOS Keychain: {error}")),
    }, |candidate| {
        let keychain = SecKeychain::default_for_domain(SecPreferencesDomain::User)
            .map_err(|error| format!("Could not open the login Keychain: {error}"))?;
        match keychain.add_generic_password(&service, ACCOUNT, candidate) {
            Ok(()) => Ok(()),
            // errSecDuplicateItem: another app process won the atomic add.
            Err(error) if error.code() == -25299 => Ok(()),
            Err(error) => Err(format!("Could not save the encryption key in macOS Keychain: {error}")),
        }
    }, random_bytes::<32>)?;
    *cached = Some((service, key));
    Ok(key)
}

#[cfg(target_os = "macos")]
fn platform_encrypt(data: &[u8]) -> Result<Vec<u8>, String> {
    aes_encrypt(data, &macos_master_key(true)?, &random_bytes::<12>()?)
}

#[cfg(target_os = "macos")]
fn platform_decrypt(data: &[u8]) -> Result<Vec<u8>, String> {
    // A missing key must never create a replacement while reading ciphertext.
    aes_decrypt(data, &macos_master_key(false)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::{Cell, RefCell};

    #[test]
    fn legacy_plaintext_and_both_encrypted_formats_are_recognized_without_keychain_access() {
        assert_eq!(decrypt_secret("legacy-api-key").unwrap(), "legacy-api-key");
        assert_eq!(encrypt_secret("  ").unwrap(), "  ");
        for prefix in [SECRET_PREFIX, MAC_SECRET_PREFIX] {
            let value = format!("{prefix}already-encrypted");
            assert!(is_encrypted_secret(&value));
            assert_eq!(encrypt_secret(&value).unwrap(), value);
        }
        let legacy = format!("{SECRET_PREFIX}{}", base64::engine::general_purpose::STANDARD.encode([1, 2, 3]));
        assert_eq!(decode_envelope(&legacy).unwrap(), Some((SecretFormat::WindowsDpapi, vec![1, 2, 3])));
    }

    #[test]
    fn aes_round_trips_unicode_spaces_and_binary_secrets_in_the_versioned_envelope() {
        let key = [7u8; 32];
        let nonce = [4u8; 12];
        let plaintext = "  密码/API key\0with spaces  ".as_bytes();
        let encrypted = aes_encrypt(plaintext, &key, &nonce).unwrap();
        assert_eq!(&encrypted[..12], &nonce);
        assert_ne!(&encrypted[12..], plaintext);
        let envelope = format!("{MAC_SECRET_PREFIX}{}", base64::engine::general_purpose::STANDARD.encode(&encrypted));
        let (format, decoded) = decode_envelope(&envelope).unwrap().unwrap();
        assert_eq!(format, SecretFormat::MacAesGcm);
        assert_eq!(aes_decrypt(&decoded, &key).unwrap(), plaintext);
        assert_ne!(encrypted, aes_encrypt(plaintext, &key, &[5u8; 12]).unwrap());
    }

    #[test]
    fn wrong_keys_nonce_ciphertext_and_tag_tampering_fail_authentication() {
        let key = [1u8; 32];
        let encrypted = aes_encrypt(b"secret", &key, &[2u8; 12]).unwrap();
        assert!(aes_decrypt(&encrypted, &[3u8; 32]).is_err());
        for index in [0, 12, encrypted.len() - 1] {
            let mut altered = encrypted.clone();
            altered[index] ^= 1;
            assert!(aes_decrypt(&altered, &key).is_err());
        }
        assert!(aes_encrypt(b"secret", &[0u8; 31], &[0u8; 12]).is_err());
        assert!(aes_decrypt(&encrypted, &[0u8; 31]).is_err());
    }

    #[test]
    fn malformed_and_future_formats_fail_instead_of_becoming_plaintext() {
        for value in ["widgitron-secret:v9:AA==", "widgitron-secret:v1:%%%", "widgitron-secret:macos-aes256-gcm:v1:AA=="] {
            assert!(decode_envelope(value).is_err());
        }
        for length in 0..28 {
            assert!(aes_decrypt(&vec![0; length], &[0u8; 32]).is_err());
        }
    }

    #[test]
    fn reading_ciphertext_never_creates_a_missing_or_unreadable_key() {
        let writes = Cell::new(0);
        let missing = read_or_create_master_key(false, || Ok(None), |_| { writes.set(writes.get() + 1); Ok(()) }, || panic!("must not generate a key while decrypting"));
        assert!(missing.unwrap_err().contains("missing"));
        let denied = read_or_create_master_key(true, || Err("Keychain access denied".into()), |_| { writes.set(writes.get() + 1); Ok(()) }, || panic!("must not replace an inaccessible key"));
        assert_eq!(denied.unwrap_err(), "Keychain access denied");
        let corrupt = read_or_create_master_key(true, || Ok(Some(vec![0; 31])), |_| { writes.set(writes.get() + 1); Ok(()) }, || panic!("must not replace an invalid key"));
        assert!(corrupt.unwrap_err().contains("invalid"));
        assert_eq!(writes.get(), 0);
    }

    #[test]
    fn initial_write_uses_only_the_key_successfully_stored_in_keychain() {
        let stored = RefCell::new(None::<Vec<u8>>);
        let key = read_or_create_master_key(true, || Ok(stored.borrow().clone()), |candidate| {
            *stored.borrow_mut() = Some(candidate.to_vec()); Ok(())
        }, || Ok([9u8; 32])).unwrap();
        assert_eq!(key, [9u8; 32]);
        let existing = read_or_create_master_key(false, || Ok(stored.borrow().clone()), |_| panic!("must not overwrite"), || panic!("must not generate")).unwrap();
        assert_eq!(existing, key);
        let denied = read_or_create_master_key(true, || Ok(None), |_| Err("Keychain write denied".into()), || Ok([8u8; 32]));
        assert_eq!(denied.unwrap_err(), "Keychain write denied");
    }

    #[test]
    fn simultaneous_first_writes_use_the_atomic_create_winner() {
        let stored = RefCell::new(None::<Vec<u8>>);
        let winner = [11u8; 32];
        let key = read_or_create_master_key(true, || Ok(stored.borrow().clone()), |_| {
            // Model errSecDuplicateItem: a second process created its key first.
            *stored.borrow_mut() = Some(winner.to_vec()); Ok(())
        }, || Ok([12u8; 32])).unwrap();
        assert_eq!(key, winner);
        assert_ne!(key, [12u8; 32]);
    }

    #[test]
    fn imported_ciphertexts_from_the_other_platform_report_a_clear_error() {
        #[cfg(target_os = "macos")]
        assert!(decrypt_secret(&format!("{SECRET_PREFIX}AA==")).unwrap_err().contains("Windows DPAPI"));
        #[cfg(target_os = "windows")]
        assert!(decrypt_secret(&format!("{MAC_SECRET_PREFIX}{}", base64::engine::general_purpose::STANDARD.encode([0u8; 28]))).unwrap_err().contains("macOS Keychain"));
    }
}
