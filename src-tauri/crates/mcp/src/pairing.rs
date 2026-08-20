//! Pairing engine implementing numeric pairing code validation and client token minting.

use crate::error::McpError;
use rand::Rng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::SqlitePool;
use subtle::ConstantTimeEq;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PairRequest {
    pub code: String,
    pub client_name: String,
    pub client_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalPairRequest {
    pub client_name: String,
    pub client_version: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PairResponse {
    pub client_id: String,
    pub access_token: String,
    pub mode: String,
    pub expires_at: i64,
}

#[derive(Debug, sqlx::FromRow)]
#[allow(dead_code)]
struct PairingCodeRow {
    id: String,
    code_hash: String,
    expires_at: i64,
    attempts: i64,
}

pub fn hash_pairing_code(code: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(code.trim().as_bytes());
    hex::encode(hasher.finalize())
}

/// Generates a random 6-digit numeric pairing code (e.g., "739104").
pub fn generate_6digit_code() -> String {
    let mut rng = rand::thread_rng();
    let num: u32 = rng.gen_range(100_000..=999_999);
    num.to_string()
}

/// Mints a random 256-bit bearer token string prefixed with `sbmcp_`.
pub fn mint_bearer_token() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill(&mut bytes);
    format!("sbmcp_{}", hex::encode(bytes))
}

async fn mint_paired_client(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    client_name: &str,
    client_version: Option<&str>,
) -> Result<PairResponse, McpError> {
    let now = chrono::Utc::now().timestamp_millis();
    let client_id = Uuid::now_v7().to_string();
    let access_token = mint_bearer_token();
    let token_hash = crate::transport::auth::hash_token(&access_token);
    let expires_at = now + (90 * 24 * 60 * 60 * 1000); // 90 days

    sqlx::query(
        r#"INSERT INTO mcp_clients
        (id, name, client_version, token_hash, token_issued_at, token_expires_at, workspace_id, mode, strict_plans, enabled, paired_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'default', 'read_only', 0, 1, ?, ?)"#,
    )
    .bind(&client_id)
    .bind(client_name)
    .bind(client_version)
    .bind(&token_hash)
    .bind(now)
    .bind(expires_at)
    .bind(now)
    .bind(now)
    .execute(&mut **tx)
    .await?;

    let budget = crate::policy::ClientBudget::default_for_client(&client_id);
    sqlx::query(
        r#"INSERT INTO mcp_budgets
        (client_id, calls_per_min, execs_per_min, concurrent_calls, concurrent_execs, max_handles, max_result_bytes, exec_timeout_ms, max_pending_approvals, approvals_per_hour, handle_idle_ms, handle_max_ms, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"#,
    )
    .bind(&client_id)
    .bind(budget.calls_per_min as i64)
    .bind(budget.execs_per_min as i64)
    .bind(budget.concurrent_calls as i64)
    .bind(budget.concurrent_execs as i64)
    .bind(budget.max_handles as i64)
    .bind(budget.max_result_bytes as i64)
    .bind(budget.exec_timeout_ms as i64)
    .bind(budget.max_pending_approvals as i64)
    .bind(budget.approvals_per_hour as i64)
    .bind(budget.handle_idle_ms as i64)
    .bind(budget.handle_max_ms as i64)
    .bind(now)
    .execute(&mut **tx)
    .await?;

    Ok(PairResponse {
        client_id,
        access_token,
        mode: "read_only".into(),
        expires_at,
    })
}

/// Pairs a new MCP client from the trusted desktop app (Tauri IPC only).
/// User consent is the in-app action; no 6-digit code is required.
pub async fn pair_client_from_app(
    pool: &SqlitePool,
    req: LocalPairRequest,
) -> Result<PairResponse, McpError> {
    let name = req.client_name.trim();
    if name.is_empty() {
        return Err(McpError::InvalidArguments("client_name is required".into()));
    }

    let mut tx = pool.begin().await?;
    let resp = mint_paired_client(
        &mut tx,
        name,
        req.client_version.as_deref(),
    )
    .await?;
    tx.commit().await?;
    Ok(resp)
}

/// Redeems a 6-digit pairing code and mints a bearer token for the client.
pub async fn redeem_pairing_code(
    pool: &SqlitePool,
    req: PairRequest,
) -> Result<PairResponse, McpError> {
    let raw_code = req.code.trim();
    if raw_code.len() != 6 || !raw_code.chars().all(|c| c.is_ascii_digit()) {
        return Err(McpError::InvalidArguments("Code must be 6 digits".into()));
    }

    let code_hash = hash_pairing_code(raw_code);
    let now = chrono::Utc::now().timestamp_millis();

    let mut tx = pool.begin().await?;

    let row = sqlx::query_as::<_, PairingCodeRow>(
        "SELECT id, code_hash, expires_at, attempts FROM mcp_pairing_codes WHERE expires_at > ? ORDER BY created_at DESC LIMIT 1",
    )
    .bind(now)
    .fetch_optional(&mut *tx)
    .await?;

    let record = match row {
        Some(r) => r,
        None => return Err(McpError::InvalidArguments("Invalid or expired pairing code".into())),
    };

    if record.attempts >= 3 {
        sqlx::query("DELETE FROM mcp_pairing_codes WHERE id = ?")
            .bind(&record.id)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        return Err(McpError::Forbidden(
            "Pairing code locked due to too many failed attempts".into(),
        ));
    }

    sqlx::query("UPDATE mcp_pairing_codes SET attempts = attempts + 1 WHERE id = ?")
        .bind(&record.id)
        .execute(&mut *tx)
        .await?;

    if code_hash.as_bytes().ct_eq(record.code_hash.as_bytes()).unwrap_u8() != 1 {
        tx.commit().await?;
        return Err(McpError::InvalidArguments("Invalid pairing code".into()));
    }

    sqlx::query("DELETE FROM mcp_pairing_codes WHERE id = ?")
        .bind(&record.id)
        .execute(&mut *tx)
        .await?;

    let resp = mint_paired_client(
        &mut tx,
        &req.client_name,
        req.client_version.as_deref(),
    )
    .await?;

    tx.commit().await?;
    Ok(resp)
}
