//! Sqlx repository layer for human approvals and session grants.

use crate::error::McpError;
use sqlx::SqlitePool;

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct ApprovalRow {
    pub id: String,
    pub client_id: String,
    pub host_id: Option<String>,
    pub session_handle: Option<String>,
    pub tool: String,
    pub args_hash: String,
    pub command_hash: Option<String>,
    pub command_preview: Option<String>,
    pub risk_tier: String,
    pub risk_reasons: Option<String>,
    pub ruleset_version: i64,
    pub preview_output: Option<String>,
    pub decision: String,
    pub decided_by: Option<String>,
    pub decided_at: Option<i64>,
    pub nonce_hash: Option<String>,
    pub consumed_at: Option<i64>,
    pub requested_at: i64,
    pub expires_at: i64,
}

pub async fn insert_approval(pool: &SqlitePool, row: &ApprovalRow) -> Result<(), McpError> {
    sqlx::query(
        r#"INSERT INTO mcp_approvals
        (id, client_id, host_id, session_handle, tool, args_hash, command_hash, command_preview, risk_tier, risk_reasons, ruleset_version, preview_output, decision, decided_by, decided_at, nonce_hash, consumed_at, requested_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"#,
    )
    .bind(&row.id)
    .bind(&row.client_id)
    .bind(&row.host_id)
    .bind(&row.session_handle)
    .bind(&row.tool)
    .bind(&row.args_hash)
    .bind(&row.command_hash)
    .bind(&row.command_preview)
    .bind(&row.risk_tier)
    .bind(&row.risk_reasons)
    .bind(row.ruleset_version)
    .bind(&row.preview_output)
    .bind(&row.decision)
    .bind(&row.decided_by)
    .bind(row.decided_at)
    .bind(&row.nonce_hash)
    .bind(row.consumed_at)
    .bind(row.requested_at)
    .bind(row.expires_at)
    .execute(pool)
    .await?;

    Ok(())
}

pub async fn get_approval_by_id(
    pool: &SqlitePool,
    id: &str,
) -> Result<Option<ApprovalRow>, McpError> {
    let row = sqlx::query_as::<_, ApprovalRow>(
        "SELECT id, client_id, host_id, session_handle, tool, args_hash, command_hash, command_preview, risk_tier, risk_reasons, ruleset_version, preview_output, decision, decided_by, decided_at, nonce_hash, consumed_at, requested_at, expires_at FROM mcp_approvals WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;

    Ok(row)
}

/// Atomically attempts to consume a nonce. Returns true if row count == 1.
pub async fn consume_nonce(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    approval_id: &str,
    now_ms: i64,
) -> Result<bool, McpError> {
    let res = sqlx::query(
        "UPDATE mcp_approvals SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL AND expires_at > ?",
    )
    .bind(now_ms)
    .bind(approval_id)
    .bind(now_ms)
    .execute(&mut **tx)
    .await?;

    Ok(res.rows_affected() == 1)
}

pub async fn update_approval_decision(
    pool: &SqlitePool,
    approval_id: &str,
    decision: &str,
    decided_by: Option<&str>,
    decided_at: i64,
) -> Result<(), McpError> {
    sqlx::query(
        "UPDATE mcp_approvals SET decision = ?, decided_by = ?, decided_at = ? WHERE id = ?",
    )
    .bind(decision)
    .bind(decided_by)
    .bind(decided_at)
    .bind(approval_id)
    .execute(pool)
    .await?;

    Ok(())
}

pub async fn list_pending_approvals(
    pool: &SqlitePool,
    now_ms: i64,
) -> Result<Vec<ApprovalRow>, McpError> {
    let rows = sqlx::query_as::<_, ApprovalRow>(
        r#"SELECT id, client_id, host_id, session_handle, tool, args_hash, command_hash,
           command_preview, risk_tier, risk_reasons, ruleset_version, preview_output,
           decision, decided_by, decided_at, nonce_hash, consumed_at, requested_at, expires_at
           FROM mcp_approvals
           WHERE decision = 'pending' AND expires_at > ?
           ORDER BY requested_at ASC"#,
    )
    .bind(now_ms)
    .fetch_all(pool)
    .await?;

    Ok(rows)
}
