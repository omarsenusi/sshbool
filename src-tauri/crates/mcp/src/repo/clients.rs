//! Sqlx repository layer for paired clients and host scope allowlists.

use crate::error::McpError;
use sqlx::SqlitePool;
use uuid::Uuid;

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct ClientRow {
    pub id: String,
    pub name: String,
    pub client_version: Option<String>,
    pub token_hash: String,
    pub token_sealed: Option<String>,
    pub token_issued_at: i64,
    pub token_expires_at: i64,
    pub workspace_id: String,
    pub mode: String,
    pub strict_plans: i64,
    pub enabled: i64,
    pub suspended_reason: Option<String>,
    pub paired_at: i64,
    pub last_seen_at: Option<i64>,
    pub updated_at: i64,
}

pub async fn get_client_by_token_hash(
    pool: &SqlitePool,
    token_hash: &str,
) -> Result<Option<ClientRow>, McpError> {
    let row = sqlx::query_as::<_, ClientRow>(
        "SELECT id, name, client_version, token_hash, token_sealed, token_issued_at, token_expires_at, workspace_id, mode, strict_plans, enabled, suspended_reason, paired_at, last_seen_at, updated_at FROM mcp_clients WHERE token_hash = ?",
    )
    .bind(token_hash)
    .fetch_optional(pool)
    .await?;

    Ok(row)
}

pub async fn get_client_by_id(pool: &SqlitePool, id: &str) -> Result<Option<ClientRow>, McpError> {
    let row = sqlx::query_as::<_, ClientRow>(
        "SELECT id, name, client_version, token_hash, token_sealed, token_issued_at, token_expires_at, workspace_id, mode, strict_plans, enabled, suspended_reason, paired_at, last_seen_at, updated_at FROM mcp_clients WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;

    Ok(row)
}

pub async fn list_clients(pool: &SqlitePool) -> Result<Vec<ClientRow>, McpError> {
    let rows = sqlx::query_as::<_, ClientRow>(
        "SELECT id, name, client_version, token_hash, token_sealed, token_issued_at, token_expires_at, workspace_id, mode, strict_plans, enabled, suspended_reason, paired_at, last_seen_at, updated_at FROM mcp_clients ORDER BY paired_at DESC",
    )
    .fetch_all(pool)
    .await?;

    Ok(rows)
}

pub async fn create_pairing_code(
    pool: &SqlitePool,
    code_hash: &str,
    ttl_secs: i64,
) -> Result<String, McpError> {
    let id = Uuid::now_v7().to_string();
    let now = chrono::Utc::now().timestamp_millis();
    let expires_at = now + (ttl_secs * 1000);

    sqlx::query(
        "INSERT INTO mcp_pairing_codes (id, code_hash, created_at, expires_at, attempts) VALUES (?, ?, ?, ?, 0)",
    )
    .bind(&id)
    .bind(code_hash)
    .bind(now)
    .bind(expires_at)
    .execute(pool)
    .await?;

    Ok(id)
}

pub async fn grant_host_to_client(
    pool: &SqlitePool,
    client_id: &str,
    host_id: &str,
    exec_allowed: bool,
    write_allowed: bool,
    granted_by: Option<&str>,
) -> Result<String, McpError> {
    let id = Uuid::now_v7().to_string();
    let now = chrono::Utc::now().timestamp_millis();

    sqlx::query(
        r#"INSERT INTO mcp_client_hosts (id, client_id, host_id, exec_allowed, write_allowed, granted_at, granted_by)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(client_id, host_id) DO UPDATE SET exec_allowed=excluded.exec_allowed, write_allowed=excluded.write_allowed, granted_by=excluded.granted_by"#,
    )
    .bind(&id)
    .bind(client_id)
    .bind(host_id)
    .bind(if exec_allowed { 1 } else { 0 })
    .bind(if write_allowed { 1 } else { 0 })
    .bind(now)
    .bind(granted_by)
    .execute(pool)
    .await?;

    Ok(id)
}
