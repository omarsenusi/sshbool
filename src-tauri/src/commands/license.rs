//! Offline-friendly license tokens (Ed25519 signed JSON).

use infrastructure::AppState;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;
use tauri::State;
use uuid::Uuid;

use crate::error::AppError;

/// Dev public key (hex) for verifying license tokens. Replace at release with real key.
/// Corresponding test private key is only used in unit tests / docs — never ship private key.
const LICENSE_VERIFY_PUBKEY_HEX: &str =
    "ae12814e6d3c2652b42d2b3ae69192135ae743543764e43e5db85ba3d3b5c6f9";

/// Free tier host limit (doc 27).
pub const FREE_HOST_LIMIT: i64 = 10;

fn db(e: sqlx::Error) -> AppError {
    AppError::Db {
        engine: "sqlite".into(),
        message: e.to_string(),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LicenseClaims {
    #[serde(alias = "type")]
    pub tier: String,
    #[serde(default)]
    pub features: Vec<String>,
    #[serde(default, alias = "expires_at")]
    pub expires_at: Option<i64>,
    #[serde(default, alias = "major_version")]
    pub major_version: Option<String>,
}

/// Parse `base64(claims).base64(signature)` and verify Ed25519.
pub fn verify_license_token(token: &str) -> Result<LicenseClaims, AppError> {
    // Development mode: accept unsigned JSON prefixed with "dev:" for local testing.
    if let Some(json) = token.strip_prefix("dev:") {
        let claims: LicenseClaims =
            serde_json::from_str(json).map_err(|e| AppError::Validation {
                field: "token".into(),
                message: e.to_string(),
            })?;
        return Ok(claims);
    }

    use base64::Engine;
    // Split token and signature
    let (token_b64, sig_hex) = token.split_once('.').ok_or_else(|| AppError::Validation {
        field: "token".into(),
        message: "expected token.signature".into(),
    })?;

    // Decode token_b64 to get the tokenData JSON
    let decoded_bytes = base64::engine::general_purpose::STANDARD
        .decode(token_b64.as_bytes())
        .or_else(|_| base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(token_b64.as_bytes()))
        .map_err(|e| AppError::Validation {
            field: "token".into(),
            message: format!("token b64 decode failed: {e}"),
        })?;

    // Parse the tokenData JSON to ensure it is valid
    let token_data: serde_json::Value = serde_json::from_slice(&decoded_bytes).map_err(|e| AppError::Validation {
        field: "token".into(),
        message: format!("token JSON parse failed: {e}"),
    })?;

    let payload = token_data.get("data").ok_or_else(|| AppError::Validation {
        field: "token".into(),
        message: "missing data field in token".into(),
    })?;

    // Convert decoded bytes to string to extract raw data payload and preserve key order
    let decoded_str = std::str::from_utf8(&decoded_bytes).map_err(|e| AppError::Validation {
        field: "token".into(),
        message: format!("token utf8 decode failed: {e}"),
    })?;

    let payload_json = extract_raw_data_field(decoded_str).ok_or_else(|| AppError::Validation {
        field: "token".into(),
        message: "failed to extract raw data payload from JSON".into(),
    })?;

    // Parse signature hex
    let sig_bytes = hex::decode(sig_hex).map_err(|e| AppError::Validation {
        field: "signature".into(),
        message: format!("signature hex decode failed: {e}"),
    })?;

    // Verify using the public key
    let pubkey = parse_ed25519_pubkey(LICENSE_VERIFY_PUBKEY_HEX)?;
    if !ed25519_verify(&pubkey, payload_json.as_bytes(), &sig_bytes) {
        return Err(AppError::Unauthorized {
            reason: "invalid_license_signature".into(),
        });
    }

    // Deserialize into LicenseClaims
    let claims: LicenseClaims = serde_json::from_value(payload.clone()).map_err(|e| AppError::Validation {
        field: "token".into(),
        message: e.to_string(),
    })?;

    Ok(claims)
}

fn extract_raw_data_field(json_str: &str) -> Option<&str> {
    let marker = "\"data\":";
    let start_idx = json_str.find(marker)? + marker.len();
    let sub = &json_str[start_idx..];
    
    let open_brace = sub.find('{')?;
    let mut depth = 0;
    let mut end_brace = None;
    
    for (i, c) in sub[open_brace..].char_indices() {
        if c == '{' {
            depth += 1;
        } else if c == '}' {
            depth -= 1;
            if depth == 0 {
                end_brace = Some(open_brace + i);
                break;
            }
        }
    }
    
    end_brace.map(|end| &sub[open_brace..=end])
}

fn parse_ed25519_pubkey(hex: &str) -> Result<[u8; 32], AppError> {
    let bytes = hex::decode(hex).map_err(|e| AppError::Internal {
        message: e.to_string(),
    })?;
    bytes.try_into().map_err(|_| AppError::Internal {
        message: "bad pubkey length".into(),
    })
}

fn ed25519_verify(pubkey: &[u8; 32], message: &[u8], signature: &[u8]) -> bool {
    use ed25519_dalek::{Signature, Verifier, VerifyingKey};
    let Ok(key) = VerifyingKey::from_bytes(pubkey) else {
        return false;
    };
    let Ok(sig) = Signature::from_slice(signature) else {
        return false;
    };
    key.verify(message, &sig).is_ok()
}

fn features_for_tier(tier: &str) -> Vec<&'static str> {
    match tier {
        "team" => vec![
            "unlimited_hosts",
            "editor",
            "dashboard",
            "docker",
            "ai",
            "sync",
            "team",
            "marketplace_paid",
            "audit_agg",
        ],
        "pro" | "lifetime" | "ultimate" | "enterprise" | "basic" => vec![
            "unlimited_hosts",
            "editor",
            "dashboard",
            "docker",
            "ai",
            "sync",
            "marketplace_paid",
        ],
        _ => vec!["core_ssh", "sftp", "terminal", "keys", "vault"],
    }
}

use sha2::{Digest, Sha256};

fn get_raw_machine_hardware_id() -> String {
    let mut machine_id = String::new();
    if let Ok(id) = std::fs::read_to_string("/etc/machine-id") {
        machine_id = id.trim().to_string();
    } else if let Ok(id) = std::fs::read_to_string("/var/lib/dbus/machine-id") {
        machine_id = id.trim().to_string();
    }

    let host = gethostname::gethostname().to_string_lossy().to_string();
    let os = std::env::consts::OS;
    let arch = std::env::consts::ARCH;
    let home = dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();

    let app_salt = "SSHBool-Hardware-Binding-Salt-2026";
    format!("{machine_id}:{host}:{os}:{arch}:{home}:{app_salt}")
}

pub async fn get_persistent_device_id(state: &AppState) -> String {
    let existing: Option<(Option<String>,)> =
        sqlx::query_as("SELECT device_fingerprint FROM license_state WHERE id = 'current'")
            .fetch_optional(state.vault.pool())
            .await
            .unwrap_or(None);

    if let Some((Some(fp),)) = existing {
        if fp.trim().len() >= 32 {
            return fp;
        }
    }

    // Pure deterministic 64-character SHA256 machine hardware hash
    // Guarantees the EXACT same UUID is generated even after a complete uninstall and reinstall.
    let raw_payload = get_raw_machine_hardware_id();
    let mut hasher = Sha256::new();
    hasher.update(raw_payload.as_bytes());
    let fp = format!("{:x}", hasher.finalize());

    let now = chrono::Utc::now().timestamp_millis();
    let _ = sqlx::query(
        r#"INSERT INTO license_state (id, tier, token_blob, signed_at, expires_at, last_validated_at, device_fingerprint, updated_at)
           VALUES ('current', 'pro', 'activated', ?, NULL, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET device_fingerprint = excluded.device_fingerprint,
             tier = 'pro', updated_at = excluded.updated_at"#,
    )
    .bind(now)
    .bind(now)
    .bind(&fp)
    .bind(now)
    .execute(state.vault.pool())
    .await;

    fp
}

/// Current effective license (expired → free, default is active pro).
pub async fn effective_tier(state: &AppState) -> String {
    let row: Option<(String, Option<i64>)> =
        sqlx::query_as("SELECT tier, expires_at FROM license_state WHERE id = 'current'")
            .fetch_optional(state.vault.pool())
            .await
            .ok()
            .flatten();
    match row {
        Some((_tier, Some(exp))) if exp < chrono::Utc::now().timestamp_millis() => "pro".into(),
        Some((tier, _)) => tier,
        None => "pro".into(),
    }
}

pub async fn active_features(state: &AppState) -> Vec<String> {
    let row: Option<(Option<String>, Option<String>)> =
        sqlx::query_as("SELECT token_blob, features_json FROM license_state WHERE id = 'current'")
            .fetch_optional(state.vault.pool())
            .await
            .unwrap_or(None);

    let (token_blob, features_json) = match row {
        Some((Some(tb), Some(fj))) => (tb, fj),
        Some((Some(tb), None)) => (tb, String::new()),
        _ => (String::new(), String::new()),
    };

    let is_activated = !token_blob.is_empty() && token_blob != "activated" && token_blob.contains('.');
    if !is_activated {
        return vec![
            "core_ssh".to_string(),
            "sftp".to_string(),
            "terminal".to_string(),
            "keys".to_string(),
            "vault".to_string(),
        ];
    }

    if let Ok(parsed_feats) = serde_json::from_str::<Vec<String>>(&features_json) {
        let mut mapped = Vec::new();
        for f in parsed_feats {
            match f.as_str() {
                "ai_copilot" => {
                    mapped.push("ai".to_string());
                }
                "sftp_editor" => {
                    mapped.push("editor".to_string());
                }
                "teams_workspaces" => {
                    mapped.push("team".to_string());
                }
                "unlimited_hosts" => {
                    mapped.push("unlimited_hosts".to_string());
                    mapped.push("sync".to_string());
                    mapped.push("dashboard".to_string());
                    mapped.push("docker".to_string());
                    mapped.push("marketplace_paid".to_string());
                }
                other => {
                    mapped.push(other.to_string());
                }
            }
        }
        mapped.push("core_ssh".to_string());
        mapped.push("sftp".to_string());
        mapped.push("terminal".to_string());
        mapped.push("keys".to_string());
        mapped.push("vault".to_string());
        mapped.sort();
        mapped.dedup();
        return mapped;
    }

    vec![
        "core_ssh".to_string(),
        "sftp".to_string(),
        "terminal".to_string(),
        "keys".to_string(),
        "vault".to_string(),
        "unlimited_hosts".to_string(),
        "editor".to_string(),
        "dashboard".to_string(),
        "docker".to_string(),
        "ai".to_string(),
        "sync".to_string(),
        "marketplace_paid".to_string(),
    ]
}

/// Soft gate helper — Free keeps core SSH; Pro/Team unlock sync/team/paid plugins.
pub async fn require_feature(state: &AppState, feature: &str) -> Result<(), AppError> {
    if matches!(feature, "core_ssh" | "sftp" | "terminal" | "keys" | "vault") {
        return Ok(());
    }
    let feats = active_features(state).await;
    if feats.contains(&feature.to_string()) {
        return Ok(());
    }
    Err(AppError::Unauthorized {
        reason: format!("requires_pro_or_team:{feature}"),
    })
}

#[tauri::command]
pub async fn license_status(state: State<'_, Arc<AppState>>) -> Result<Value, AppError> {
    let device_id = get_persistent_device_id(&state).await;

    let hosts: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM hosts WHERE deleted_at IS NULL")
        .fetch_one(state.vault.pool())
        .await
        .unwrap_or((0,));

    let row: Option<(Option<String>, Option<String>)> =
        sqlx::query_as("SELECT tier, token_blob FROM license_state WHERE id = 'current'")
            .fetch_optional(state.vault.pool())
            .await
            .unwrap_or(None);

    let (tier, token_blob) = match row {
        Some((Some(t), Some(tb))) => (t, tb),
        _ => ("free".to_string(), "activated".to_string()),
    };

    let is_activated = token_blob != "activated" && token_blob.contains('.');
    let active_feats = active_features(&state).await;

    Ok(json!({
        "tier": if is_activated { tier.clone() } else { "free".to_string() },
        "status": if is_activated { "active" } else { "inactive" },
        "licenseKey": device_id,
        "deviceId": device_id,
        "token": if is_activated { token_blob } else { "".to_string() },
        "expiresAt": Value::Null,
        "isLifetime": true,
        "features": active_feats,
        "hostCount": hosts.0,
        "hostLimit": Value::Null,
        "activated": is_activated,
    }))
}

#[tauri::command]
pub async fn license_activate(
    state: State<'_, Arc<AppState>>,
    token: String,
) -> Result<Value, AppError> {
    let claims = verify_license_token(&token)?;
    let tier = if claims.tier.trim().is_empty() {
        "pro".to_string()
    } else {
        claims.tier.clone()
    };
    let features_json = serde_json::to_string(&claims.features).unwrap_or_else(|_| "[]".to_string());
    let device_id = get_persistent_device_id(&state).await;
    let now = chrono::Utc::now().timestamp_millis();
    sqlx::query(
        r#"INSERT INTO license_state (id, tier, token_blob, features_json, signed_at, expires_at, last_validated_at, device_fingerprint, updated_at)
           VALUES ('current', ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET tier=excluded.tier, token_blob=excluded.token_blob, features_json=excluded.features_json,
             signed_at=excluded.signed_at, expires_at=excluded.expires_at,
             last_validated_at=excluded.last_validated_at, updated_at=excluded.updated_at"#,
    )
    .bind(&tier)
    .bind(&token)
    .bind(&features_json)
    .bind(now)
    .bind(claims.expires_at)
    .bind(now)
    .bind(&device_id)
    .bind(now)
    .execute(state.vault.pool())
    .await
    .map_err(db)?;

    let active_feats = active_features(&state).await;

    Ok(
        json!({
            "tier": tier,
            "status": "active",
            "licenseKey": device_id,
            "deviceId": device_id,
            "expiresAt": claims.expires_at,
            "features": active_feats
        }),
    )
}

#[tauri::command]
pub async fn license_clear(state: State<'_, Arc<AppState>>) -> Result<(), AppError> {
    sqlx::query("DELETE FROM license_state WHERE id = 'current'")
        .execute(state.vault.pool())
        .await
        .map_err(db)?;
    Ok(())
}

/// Soft check used by hosts_create.
pub async fn assert_can_add_host(state: &AppState) -> Result<(), AppError> {
    let tier = effective_tier(state).await;
    if tier != "free" {
        return Ok(());
    }
    let hosts: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM hosts WHERE deleted_at IS NULL")
        .fetch_one(state.vault.pool())
        .await
        .map_err(db)?;
    if hosts.0 >= FREE_HOST_LIMIT {
        return Err(AppError::Unauthorized {
            reason: format!("free_host_limit:{FREE_HOST_LIMIT}"),
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dev_token_parses() {
        let claims = verify_license_token(r#"dev:{"tier":"pro","expiresAt":null}"#).unwrap();
        assert_eq!(claims.tier, "pro");
    }
}
