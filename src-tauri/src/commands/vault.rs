//! Vault & key commands.

use application::{GenerateKeyDto, SshKeyDto, VaultStatusDto};
use infrastructure::AppState;
use russh::keys::decode_secret_key;
use sha2::{Digest, Sha256};
use ssh_key::{Algorithm, LineEnding, PrivateKey};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::error::AppError;
use crate::events::APP_LOCK;

#[tauri::command]
pub async fn vault_status(state: State<'_, Arc<AppState>>) -> Result<VaultStatusDto, AppError> {
    let s = state.vault.status().await?;
    Ok(VaultStatusDto {
        initialized: s.initialized,
        locked: s.locked,
        biometric: s.biometric,
    })
}

#[tauri::command]
pub async fn vault_init(state: State<'_, Arc<AppState>>, password: String) -> Result<(), AppError> {
    state.vault.init(&password).await?;
    Ok(())
}

#[tauri::command]
pub async fn vault_unlock(
    state: State<'_, Arc<AppState>>,
    password: String,
) -> Result<(), AppError> {
    state.vault.unlock(&password).await?;
    Ok(())
}

#[tauri::command]
pub async fn vault_lock(app: AppHandle, state: State<'_, Arc<AppState>>) -> Result<(), AppError> {
    state.vault.lock().await?;
    let _ = app.emit(APP_LOCK, ());
    Ok(())
}

#[tauri::command]
pub async fn vault_backup(
    state: State<'_, Arc<AppState>>,
    password: String,
) -> Result<serde_json::Value, AppError> {
    let blob = state.vault.backup(&password).await?;
    Ok(serde_json::json!({ "blob": blob }))
}

#[tauri::command]
pub async fn vault_restore(
    state: State<'_, Arc<AppState>>,
    blob: String,
    password: String,
) -> Result<(), AppError> {
    state.vault.restore(&blob, &password).await?;
    Ok(())
}

#[tauri::command]
pub async fn keys_list(state: State<'_, Arc<AppState>>) -> Result<Vec<SshKeyDto>, AppError> {
    let rows: Vec<(
        String,
        String,
        String,
        String,
        String,
        Option<String>,
        i64,
        i64,
        String,
        i64,
    )> = sqlx::query_as(
        "SELECT id, name, key_type, public_key, fingerprint_sha256, comment, has_passphrase, hardware_backed, source, created_at FROM ssh_keys ORDER BY created_at DESC",
    )
    .fetch_all(state.vault.pool())
    .await
    .map_err(|e| AppError::Db {
        engine: "sqlite".into(),
        message: e.to_string(),
    })?;
    Ok(rows
        .into_iter()
        .map(
            |(
                id,
                name,
                key_type,
                public_key,
                fingerprint_sha256,
                comment,
                has_passphrase,
                hardware_backed,
                source,
                created_at,
            )| SshKeyDto {
                id,
                name,
                key_type,
                public_key,
                fingerprint_sha256,
                comment,
                has_passphrase: has_passphrase != 0,
                hardware_backed: hardware_backed != 0,
                source,
                created_at,
            },
        )
        .collect())
}

#[tauri::command]
pub async fn keys_generate(
    state: State<'_, Arc<AppState>>,
    dto: GenerateKeyDto,
) -> Result<SshKeyDto, AppError> {
    let alg = match dto.key_type.as_str() {
        "rsa" => Algorithm::Rsa { hash: None },
        "ecdsa" => Algorithm::Ecdsa {
            curve: ssh_key::EcdsaCurve::NistP256,
        },
        _ => Algorithm::Ed25519,
    };
    let (public, pem) = {
        let mut rng = rand::thread_rng();
        let private = PrivateKey::random(&mut rng, alg).map_err(|e| AppError::Crypto {
            message: e.to_string(),
        })?;
        let public = private
            .public_key()
            .to_openssh()
            .map_err(|e| AppError::Crypto {
                message: e.to_string(),
            })?;
        let pem = private
            .to_openssh(LineEnding::LF)
            .map_err(|e| AppError::Crypto {
                message: e.to_string(),
            })?;
        (public, pem)
    };
    let fp = fingerprint_of(&public);
    let id = Uuid::now_v7().to_string();
    let now = chrono::Utc::now().timestamp_millis();
    let (ct, nonce) = state
        .vault
        .seal_secret(pem.as_bytes(), &format!("key:{id}"))
        .await?;
    sqlx::query(
        r#"INSERT INTO ssh_keys
        (id, name, key_type, public_key, private_ciphertext, private_nonce, fingerprint_sha256, comment, has_passphrase, hardware_backed, source, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'generated', ?, ?)"#,
    )
    .bind(&id)
    .bind(&dto.name)
    .bind(&dto.key_type)
    .bind(&public)
    .bind(&ct)
    .bind(&nonce)
    .bind(&fp)
    .bind(&dto.comment)
    .bind(if dto.passphrase.as_ref().map(|p| !p.is_empty()).unwrap_or(false) {
        1
    } else {
        0
    })
    .bind(now)
    .bind(now)
    .execute(state.vault.pool())
    .await
    .map_err(|e| AppError::Db {
        engine: "sqlite".into(),
        message: e.to_string(),
    })?;

    Ok(SshKeyDto {
        id,
        name: dto.name,
        key_type: dto.key_type,
        public_key: public,
        fingerprint_sha256: fp,
        comment: dto.comment,
        has_passphrase: false,
        hardware_backed: false,
        source: "generated".into(),
        created_at: now,
    })
}

#[tauri::command]
pub async fn keys_import(
    state: State<'_, Arc<AppState>>,
    content: String,
    name: String,
    passphrase: Option<String>,
) -> Result<SshKeyDto, AppError> {
    import_private_key(&state, content, name, passphrase).await
}

#[tauri::command]
pub async fn keys_import_file(
    state: State<'_, Arc<AppState>>,
    path: String,
    name: Option<String>,
    passphrase: Option<String>,
) -> Result<SshKeyDto, AppError> {
    let path_buf = std::path::PathBuf::from(&path);
    let file_name = path_buf
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("imported")
        .to_string();

    if file_name.to_ascii_lowercase().ends_with(".pub") {
        return Err(AppError::Validation {
            field: "path".into(),
            message: "you picked a public key (.pub). Select the private key instead (same name, usually without .pub)"
                .into(),
        });
    }

    let content = read_key_file_text(&path_buf).await?;

    let resolved_name = name
        .map(|n| n.trim().to_string())
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| {
            file_name
                .trim_end_matches(".pem")
                .trim_end_matches(".PEM")
                .trim_end_matches(".key")
                .trim_end_matches(".KEY")
                .trim_end_matches(".ppk")
                .trim_end_matches(".PPK")
                .to_string()
        });

    import_private_key(&state, content, resolved_name, passphrase).await
}

/// Read a key file as text, tolerating UTF-8 BOM and UTF-16 (common from Windows Notepad).
async fn read_key_file_text(path: &std::path::Path) -> Result<String, AppError> {
    let bytes = tokio::fs::read(path).await.map_err(|e| AppError::Io {
        message: format!("read key file: {e}"),
    })?;
    bytes_to_key_text(&bytes)
}

fn bytes_to_key_text(bytes: &[u8]) -> Result<String, AppError> {
    if bytes.is_empty() {
        return Err(AppError::Validation {
            field: "content".into(),
            message: "key file is empty".into(),
        });
    }

    // UTF-8 BOM
    let bytes = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(bytes);

    // UTF-16 LE BOM
    if let Some(rest) = bytes.strip_prefix(&[0xFF, 0xFE]) {
        return utf16_to_string(rest, true);
    }
    // UTF-16 BE BOM
    if let Some(rest) = bytes.strip_prefix(&[0xFE, 0xFF]) {
        return utf16_to_string(rest, false);
    }

    // UTF-16 LE without BOM (many NUL bytes on odd indexes)
    if bytes.len() >= 8 && bytes.len().is_multiple_of(2) {
        let nul_odds = bytes.iter().skip(1).step_by(2).filter(|&&b| b == 0).count();
        if nul_odds * 2 > bytes.len() / 2 {
            if let Ok(s) = utf16_to_string(bytes, true) {
                if s.contains("PRIVATE") || s.contains("BEGIN") {
                    return Ok(s);
                }
            }
        }
    }

    match std::str::from_utf8(bytes) {
        Ok(s) => Ok(s.to_string()),
        Err(_) => Ok(String::from_utf8_lossy(bytes).into_owned()),
    }
}

fn utf16_to_string(bytes: &[u8], little_endian: bool) -> Result<String, AppError> {
    if !bytes.len().is_multiple_of(2) {
        return Err(AppError::Io {
            message: "key file looks like UTF-16 but has odd length".into(),
        });
    }
    let u16s: Vec<u16> = bytes
        .chunks_exact(2)
        .map(|c| {
            if little_endian {
                u16::from_le_bytes([c[0], c[1]])
            } else {
                u16::from_be_bytes([c[0], c[1]])
            }
        })
        .collect();
    String::from_utf16(&u16s).map_err(|_| AppError::Io {
        message: "key file is not valid UTF-16 text".into(),
    })
}

/// Normalize OpenSSH / PEM private key text so Base64 parsing succeeds.
///
/// Some keys (incl. from older tools) wrap Base64 at 70–72 cols; strict PEM
/// parsers (pem-rfc7468 / ssh-key) reject that as invalid Base64. We re-wrap at 64.
fn sanitize_private_key_pem(raw: &str) -> String {
    let mut raw = raw.replace("\r\n", "\n").replace('\r', "\n");
    raw = raw.trim_start_matches('\u{feff}').to_string();
    // Zero-width / odd spaces that break Base64
    for ch in [
        '\u{200b}', '\u{200c}', '\u{200d}', '\u{00a0}', '\u{2028}', '\u{2029}',
    ] {
        raw = raw.replace(ch, "");
    }

    // Prefer a single PEM block if surrounding junk exists
    if let Some(begin) = raw.find("-----BEGIN ") {
        let block = &raw[begin..];
        if let Some(end_rel) = block.find("-----END ") {
            let after_end = &block[end_rel..];
            let end_line_len = after_end
                .find('\n')
                .map(|i| i + 1)
                .unwrap_or(after_end.len());
            raw = block[..end_rel + end_line_len].to_string();
        }
    }

    let mut out = String::new();
    let mut b64 = String::new();
    let mut in_body = false;

    for line in raw.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if line.starts_with("-----BEGIN ") {
            flush_b64(&mut out, &mut b64);
            out.push_str(line);
            out.push('\n');
            in_body = true;
            continue;
        }
        if line.starts_with("-----END ") {
            flush_b64(&mut out, &mut b64);
            out.push_str(line);
            out.push('\n');
            in_body = false;
            continue;
        }
        if !in_body {
            continue;
        }
        if line.contains(':') {
            // PEM headers like Proc-Type / DEK-Info (must stay before base64)
            flush_b64(&mut out, &mut b64);
            out.push_str(line);
            out.push('\n');
            continue;
        }
        for c in line.chars() {
            if c.is_ascii_alphanumeric() || c == '+' || c == '/' || c == '=' {
                b64.push(c);
            }
        }
    }
    flush_b64(&mut out, &mut b64);
    out.trim().to_string()
}

fn flush_b64(out: &mut String, b64: &mut String) {
    if b64.is_empty() {
        return;
    }
    for chunk in b64.as_bytes().chunks(64) {
        // base64 is ASCII
        out.push_str(std::str::from_utf8(chunk).unwrap_or(""));
        out.push('\n');
    }
    b64.clear();
}

fn looks_like_public_key_only(content: &str) -> bool {
    let t = content.trim();
    if t.is_empty() {
        return false;
    }
    if t.contains("PRIVATE KEY") {
        return false;
    }
    if t.contains("BEGIN PUBLIC KEY") || t.contains("BEGIN SSH2 PUBLIC KEY") {
        return true;
    }
    // OpenSSH single-line public key formats
    t.starts_with("ssh-")
        || t.starts_with("ecdsa-")
        || t.starts_with("sk-ssh-")
        || t.starts_with("sk-ecdsa-")
}

async fn import_private_key(
    state: &Arc<AppState>,
    content: String,
    name: String,
    passphrase: Option<String>,
) -> Result<SshKeyDto, AppError> {
    let content = sanitize_private_key_pem(&content);
    if content.is_empty() {
        return Err(AppError::Validation {
            field: "content".into(),
            message: "private key is empty".into(),
        });
    }
    if !content.contains("BEGIN") || !content.contains("PRIVATE KEY") {
        return Err(AppError::Validation {
            field: "content".into(),
            message: "not a private key PEM — expected -----BEGIN … PRIVATE KEY-----".into(),
        });
    }
    if looks_like_public_key_only(&content) {
        return Err(AppError::Validation {
            field: "content".into(),
            message: "this looks like a public key. Import the private key file (-----BEGIN OPENSSH PRIVATE KEY-----)"
                .into(),
        });
    }
    if name.trim().is_empty() {
        return Err(AppError::Validation {
            field: "name".into(),
            message: "name is required".into(),
        });
    }

    let pass = passphrase.as_deref().filter(|p| !p.is_empty());
    let private = decode_secret_key(&content, pass).map_err(|e| {
        let msg = e.to_string();
        if pass.is_none()
            && (msg.to_ascii_lowercase().contains("password")
                || msg.to_ascii_lowercase().contains("decrypt")
                || msg.to_ascii_lowercase().contains("encrypted"))
        {
            AppError::Validation {
                field: "passphrase".into(),
                message: "this key is encrypted — enter its passphrase".into(),
            }
        } else {
            let hint = if content.lines().count() < 3 {
                " — the key looks truncated; paste the full private key or re-select the file"
            } else {
                ""
            };
            AppError::Crypto {
                message: format!("parse private key: {msg}{hint}"),
            }
        }
    })?;

    let public = private
        .public_key()
        .to_openssh()
        .map_err(|e| AppError::Crypto {
            message: e.to_string(),
        })?;
    // russh bundles a different ssh_key version than our direct dep — match via Display.
    let algo = private.algorithm().to_string().to_ascii_lowercase();
    let key_type = if algo.contains("ed25519") {
        "ed25519"
    } else if algo.contains("rsa") {
        "rsa"
    } else if algo.contains("ecdsa") {
        "ecdsa"
    } else {
        "unknown"
    }
    .to_string();
    let fp = fingerprint_of(&public);
    let id = Uuid::now_v7().to_string();
    let now = chrono::Utc::now().timestamp_millis();
    // Store *unencrypted* OpenSSH PEM. Vault AEAD already protects at rest.
    // Keeping the original encrypted PEM would break connect (no passphrase on hand).
    let store_pem = private
        .to_openssh(russh::keys::ssh_key::LineEnding::LF)
        .map_err(|e| AppError::Crypto {
            message: format!("encode private key: {e}"),
        })?;
    let (ct, nonce) = state
        .vault
        .seal_secret(store_pem.as_bytes(), &format!("key:{id}"))
        .await?;
    let has_passphrase = pass.is_some();
    sqlx::query(
        r#"INSERT INTO ssh_keys
        (id, name, key_type, public_key, private_ciphertext, private_nonce, fingerprint_sha256, comment, has_passphrase, hardware_backed, source, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, 0, 'imported', ?, ?)"#,
    )
    .bind(&id)
    .bind(name.trim())
    .bind(&key_type)
    .bind(&public)
    .bind(&ct)
    .bind(&nonce)
    .bind(&fp)
    .bind(if has_passphrase { 1 } else { 0 })
    .bind(now)
    .bind(now)
    .execute(state.vault.pool())
    .await
    .map_err(|e| AppError::Db {
        engine: "sqlite".into(),
        message: e.to_string(),
    })?;
    Ok(SshKeyDto {
        id,
        name: name.trim().to_string(),
        key_type,
        public_key: public,
        fingerprint_sha256: fp,
        comment: None,
        has_passphrase,
        hardware_backed: false,
        source: "imported".into(),
        created_at: now,
    })
}

#[tauri::command]
pub async fn keys_export_public(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<serde_json::Value, AppError> {
    let row: Option<(String,)> = sqlx::query_as("SELECT public_key FROM ssh_keys WHERE id = ?")
        .bind(&id)
        .fetch_optional(state.vault.pool())
        .await
        .map_err(|e| AppError::Db {
            engine: "sqlite".into(),
            message: e.to_string(),
        })?;
    let Some((openssh,)) = row else {
        return Err(AppError::NotFound {
            entity: "ssh_key".into(),
            id: Some(id),
        });
    };
    Ok(serde_json::json!({ "openssh": openssh }))
}

#[tauri::command]
pub async fn keys_export_private(
    state: State<'_, Arc<AppState>>,
    id: String,
    passphrase: String,
) -> Result<serde_json::Value, AppError> {
    // step-up: verify password by unlocking check
    state.vault.unlock(&passphrase).await?;
    let row: Option<(Vec<u8>, Vec<u8>)> =
        sqlx::query_as("SELECT private_ciphertext, private_nonce FROM ssh_keys WHERE id = ?")
            .bind(&id)
            .fetch_optional(state.vault.pool())
            .await
            .map_err(|e| AppError::Db {
                engine: "sqlite".into(),
                message: e.to_string(),
            })?;
    let Some((ct, nonce)) = row else {
        return Err(AppError::NotFound {
            entity: "ssh_key".into(),
            id: Some(id.clone()),
        });
    };
    let pem = state
        .vault
        .open_secret(&ct, &nonce, &format!("key:{id}"))
        .await?;
    let now = chrono::Utc::now().timestamp_millis();
    let audit_id = Uuid::now_v7().to_string();
    let _ = sqlx::query(
        "INSERT INTO audit_log (id, at, actor, action, target, metadata_json, result) VALUES (?, ?, 'user', 'keys_export_private', ?, NULL, 'ok')",
    )
    .bind(&audit_id)
    .bind(now)
    .bind(&id)
    .execute(state.vault.pool())
    .await;
    Ok(serde_json::json!({ "pem": String::from_utf8_lossy(&pem) }))
}

#[tauri::command]
pub async fn keys_export_private_file(
    state: State<'_, Arc<AppState>>,
    id: String,
    passphrase: String,
    path: String,
) -> Result<(), AppError> {
    // step-up: verify password by unlocking check
    state.vault.unlock(&passphrase).await?;
    let row: Option<(Vec<u8>, Vec<u8>)> =
        sqlx::query_as("SELECT private_ciphertext, private_nonce FROM ssh_keys WHERE id = ?")
            .bind(&id)
            .fetch_optional(state.vault.pool())
            .await
            .map_err(|e| AppError::Db {
                engine: "sqlite".into(),
                message: e.to_string(),
            })?;
    let Some((ct, nonce)) = row else {
        return Err(AppError::NotFound {
            entity: "ssh_key".into(),
            id: Some(id.clone()),
        });
    };
    let pem = state
        .vault
        .open_secret(&ct, &nonce, &format!("key:{id}"))
        .await?;
    let now = chrono::Utc::now().timestamp_millis();
    let audit_id = Uuid::now_v7().to_string();
    let _ = sqlx::query(
        "INSERT INTO audit_log (id, at, actor, action, target, metadata_json, result) VALUES (?, ?, 'user', 'keys_export_private', ?, NULL, 'ok')",
    )
    .bind(&audit_id)
    .bind(now)
    .bind(&id)
    .execute(state.vault.pool())
    .await;
    tokio::fs::write(&path, &pem)
        .await
        .map_err(|e| AppError::Io {
            message: format!("write key file: {e}"),
        })?;
    Ok(())
}

#[tauri::command]
pub async fn keys_rename(
    state: State<'_, Arc<AppState>>,
    id: String,
    name: String,
) -> Result<(), AppError> {
    sqlx::query("UPDATE ssh_keys SET name = ?, updated_at = ? WHERE id = ?")
        .bind(&name)
        .bind(chrono::Utc::now().timestamp_millis())
        .bind(&id)
        .execute(state.vault.pool())
        .await
        .map_err(|e| AppError::Db {
            engine: "sqlite".into(),
            message: e.to_string(),
        })?;
    Ok(())
}

#[tauri::command]
pub async fn keys_delete(state: State<'_, Arc<AppState>>, id: String) -> Result<(), AppError> {
    sqlx::query("DELETE FROM ssh_keys WHERE id = ?")
        .bind(&id)
        .execute(state.vault.pool())
        .await
        .map_err(|e| AppError::Db {
            engine: "sqlite".into(),
            message: e.to_string(),
        })?;
    Ok(())
}

#[tauri::command]
pub async fn keys_copy_public(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<serde_json::Value, AppError> {
    keys_export_public(state, id).await
}

#[tauri::command]
pub async fn credentials_list(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<serde_json::Value>, AppError> {
    let rows: Vec<(String, String, String, i64)> = sqlx::query_as(
        "SELECT id, name, kind, created_at FROM credentials ORDER BY created_at DESC",
    )
    .fetch_all(state.vault.pool())
    .await
    .map_err(|e| AppError::Db {
        engine: "sqlite".into(),
        message: e.to_string(),
    })?;
    Ok(rows
        .into_iter()
        .map(|(id, name, kind, created_at)| {
            serde_json::json!({
                "id": id,
                "name": name,
                "kind": kind,
                "createdAt": created_at
            })
        })
        .collect())
}

#[tauri::command]
pub async fn credentials_create(
    state: State<'_, Arc<AppState>>,
    name: String,
    kind: String,
    secret: String,
) -> Result<String, AppError> {
    let id = Uuid::now_v7().to_string();
    let now = chrono::Utc::now().timestamp_millis();
    let (ct, nonce) = state
        .vault
        .seal_secret(secret.as_bytes(), &format!("cred:{id}"))
        .await?;
    sqlx::query(
        "INSERT INTO credentials (id, name, kind, ciphertext, nonce, aad, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&name)
    .bind(&kind)
    .bind(&ct)
    .bind(&nonce)
    .bind(format!("cred:{id}"))
    .bind(now)
    .bind(now)
    .execute(state.vault.pool())
    .await
    .map_err(|e| AppError::Db {
        engine: "sqlite".into(),
        message: e.to_string(),
    })?;
    Ok(id)
}

#[tauri::command]
pub async fn credentials_delete(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<(), AppError> {
    sqlx::query("DELETE FROM credentials WHERE id = ?")
        .bind(&id)
        .execute(state.vault.pool())
        .await
        .map_err(|e| AppError::Db {
            engine: "sqlite".into(),
            message: e.to_string(),
        })?;
    Ok(())
}

fn fingerprint_of(openssh_pub: &str) -> String {
    // Use sha256 of the public key line as a stable fingerprint label.
    let hash = Sha256::digest(openssh_pub.as_bytes());
    format!(
        "SHA256:{}",
        base64::Engine::encode(&base64::engine::general_purpose::STANDARD_NO_PAD, hash)
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::rngs::OsRng;

    #[test]
    fn russh_parses_72_col_wrapped_openssh_key() {
        let key = PrivateKey::random(&mut OsRng, Algorithm::Ed25519).unwrap();
        let pem = key.to_openssh(LineEnding::LF).unwrap();
        let mut body = String::new();
        for line in pem.lines() {
            if line.starts_with("-----") {
                continue;
            }
            body.push_str(line.trim());
        }
        let mut weird = String::from("-----BEGIN OPENSSH PRIVATE KEY-----\n");
        for chunk in body.as_bytes().chunks(72) {
            weird.push_str(std::str::from_utf8(chunk).unwrap());
            weird.push('\n');
        }
        weird.push_str("-----END OPENSSH PRIVATE KEY-----\n");

        let sanitized = sanitize_private_key_pem(&weird);
        let parsed = decode_secret_key(&sanitized, None);
        assert!(
            parsed.is_ok(),
            "russh should parse 72-col OpenSSH key: {:?}",
            parsed.err()
        );
    }

    #[test]
    fn russh_parses_user_key_file_if_present() {
        let path = r"d:\Omar\my keys linnom\linnom_contabo_whatsapp";
        let Ok(raw) = std::fs::read(path) else {
            return;
        };
        let text = bytes_to_key_text(&raw).expect("decode text");
        let sanitized = sanitize_private_key_pem(&text);
        let parsed = decode_secret_key(&sanitized, None);
        // Local developer keys may be passphrase-protected; that is still a valid read.
        if let Err(e) = &parsed {
            let msg = e.to_string().to_ascii_lowercase();
            if msg.contains("encrypted") || msg.contains("password") || msg.contains("decrypt") {
                return;
            }
        }
        assert!(parsed.is_ok(), "user key should parse: {:?}", parsed.err());
    }
}
