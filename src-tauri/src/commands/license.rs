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
    "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a";

/// Free tier host limit (doc 27).
pub const FREE_HOST_LIMIT: i64 = 10;

fn db(e: sqlx::Error) -> AppError {
    AppError::Db {
        engine: "sqlite".into(),
        message: e.to_string(),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LicenseClaims {
    tier: String,
    #[serde(default)]
    features: Vec<String>,
    expires_at: Option<i64>,
    #[serde(default)]
    major_version: Option<String>,
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
    let (claims_b64, sig_b64) = token.split_once('.').ok_or_else(|| AppError::Validation {
        field: "token".into(),
        message: "expected claims.signature".into(),
    })?;
    let claims_bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(claims_b64.as_bytes())
        .or_else(|_| base64::engine::general_purpose::STANDARD.decode(claims_b64.as_bytes()))
        .map_err(|e| AppError::Validation {
            field: "token".into(),
            message: format!("claims b64: {e}"),
        })?;
    let sig_bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(sig_b64.as_bytes())
        .or_else(|_| base64::engine::general_purpose::STANDARD.decode(sig_b64.as_bytes()))
        .map_err(|e| AppError::Validation {
            field: "token".into(),
            message: format!("sig b64: {e}"),
        })?;

    let pubkey = parse_ed25519_pubkey(LICENSE_VERIFY_PUBKEY_HEX)?;
    if !ed25519_verify(&pubkey, &claims_bytes, &sig_bytes) {
        return Err(AppError::Unauthorized {
            reason: "invalid_license_signature".into(),
        });
    }
    serde_json::from_slice(&claims_bytes).map_err(|e| AppError::Validation {
        field: "token".into(),
        message: e.to_string(),
    })
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
        "pro" => vec![
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

/// Current effective license (expired → free).
pub async fn effective_tier(state: &AppState) -> String {
    let row: Option<(String, Option<i64>)> =
        sqlx::query_as("SELECT tier, expires_at FROM license_state WHERE id = 'current'")
            .fetch_optional(state.vault.pool())
            .await
            .ok()
            .flatten();
    match row {
        Some((_tier, Some(exp))) if exp < chrono::Utc::now().timestamp_millis() => "free".into(),
        Some((tier, _)) => tier,
        None => "free".into(),
    }
}

/// Soft gate helper — Free keeps core SSH; Pro/Team unlock sync/team/paid plugins.
pub async fn require_feature(state: &AppState, feature: &str) -> Result<(), AppError> {
    if matches!(feature, "core_ssh" | "sftp" | "terminal" | "keys" | "vault") {
        return Ok(());
    }
    let tier = effective_tier(state).await;
    let feats = features_for_tier(&tier);
    if feats.contains(&feature) {
        return Ok(());
    }
    Err(AppError::Unauthorized {
        reason: format!("requires_pro_or_team:{feature}"),
    })
}

#[tauri::command]
pub async fn license_status(state: State<'_, Arc<AppState>>) -> Result<Value, AppError> {
    let row: Option<(String, Option<String>, Option<i64>, Option<i64>, Option<i64>)> =
        sqlx::query_as(
            "SELECT tier, token_blob, signed_at, expires_at, last_validated_at FROM license_state WHERE id = 'current'",
        )
        .fetch_optional(state.vault.pool())
        .await
        .map_err(db)?;

    let (tier, expires_at) = match &row {
        Some((t, _, _, exp, _)) => {
            let tier = if exp.is_some_and(|e| e < chrono::Utc::now().timestamp_millis()) {
                "free".into()
            } else {
                t.clone()
            };
            (tier, *exp)
        }
        None => ("free".into(), None),
    };

    let hosts: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM hosts WHERE deleted_at IS NULL")
        .fetch_one(state.vault.pool())
        .await
        .unwrap_or((0,));

    Ok(json!({
        "tier": tier,
        "expiresAt": expires_at,
        "features": features_for_tier(&tier),
        "hostCount": hosts.0,
        "hostLimit": if tier == "free" { Some(FREE_HOST_LIMIT) } else { None },
        "activated": row.as_ref().map(|r| r.1.is_some()).unwrap_or(false),
    }))
}

#[tauri::command]
pub async fn license_activate(
    state: State<'_, Arc<AppState>>,
    token: String,
) -> Result<Value, AppError> {
    let claims = verify_license_token(&token)?;
    let tier = match claims.tier.as_str() {
        "pro" | "team" | "free" => claims.tier.clone(),
        other => {
            return Err(AppError::Validation {
                field: "tier".into(),
                message: format!("unknown tier: {other}"),
            })
        }
    };
    let now = chrono::Utc::now().timestamp_millis();
    sqlx::query(
        r#"INSERT INTO license_state (id, tier, token_blob, signed_at, expires_at, last_validated_at, device_fingerprint, updated_at)
           VALUES ('current', ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET tier=excluded.tier, token_blob=excluded.token_blob,
             signed_at=excluded.signed_at, expires_at=excluded.expires_at,
             last_validated_at=excluded.last_validated_at, updated_at=excluded.updated_at"#,
    )
    .bind(&tier)
    .bind(&token)
    .bind(now)
    .bind(claims.expires_at)
    .bind(now)
    .bind(Uuid::now_v7().to_string())
    .bind(now)
    .execute(state.vault.pool())
    .await
    .map_err(db)?;

    Ok(
        json!({ "tier": tier, "expiresAt": claims.expires_at, "features": features_for_tier(&tier) }),
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
