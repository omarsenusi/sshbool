//! Sqlx repository layer for the immutable mcp_calls ledger.

use crate::error::McpError;
use sqlx::SqlitePool;

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct CallRow {
    pub id: String,
    pub at: i64,
    pub client_id: Option<String>,
    pub client_name: Option<String>,
    pub host_id: Option<String>,
    pub host_label: Option<String>,
    pub session_handle: Option<String>,
    pub tool: String,
    pub args_hash: Option<String>,
    pub command_preview: Option<String>,
    pub risk_tier: Option<String>,
    pub risk_reasons: Option<String>,
    pub ruleset_version: Option<i64>,
    pub decision: String,
    pub approval_id: Option<String>,
    pub grant_id: Option<String>,
    pub duration_ms: Option<i64>,
    pub result_bytes: Option<i64>,
    pub truncated: i64,
    pub error_code: Option<String>,
    pub reason: Option<String>,
}

/// Records a call entry into the `mcp_calls` table within an open transaction.
/// If this database write fails, the transaction aborts and the caller MUST fail the tool execution.
pub async fn record_call_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    row: &CallRow,
) -> Result<(), McpError> {
    sqlx::query(
        r#"INSERT INTO mcp_calls
        (id, at, client_id, client_name, host_id, host_label, session_handle, tool, args_hash, command_preview, risk_tier, risk_reasons, ruleset_version, decision, approval_id, grant_id, duration_ms, result_bytes, truncated, error_code, reason)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"#,
    )
    .bind(&row.id)
    .bind(row.at)
    .bind(&row.client_id)
    .bind(&row.client_name)
    .bind(&row.host_id)
    .bind(&row.host_label)
    .bind(&row.session_handle)
    .bind(&row.tool)
    .bind(&row.args_hash)
    .bind(&row.command_preview)
    .bind(&row.risk_tier)
    .bind(&row.risk_reasons)
    .bind(row.ruleset_version)
    .bind(&row.decision)
    .bind(&row.approval_id)
    .bind(&row.grant_id)
    .bind(row.duration_ms)
    .bind(row.result_bytes)
    .bind(row.truncated)
    .bind(&row.error_code)
    .bind(&row.reason)
    .execute(&mut **tx)
    .await?;

    Ok(())
}

/// Standalone call record helper when outside of an active transaction.
pub async fn record_call(
    pool: &SqlitePool,
    row: &CallRow,
) -> Result<(), McpError> {
    let mut tx = pool.begin().await?;
    record_call_tx(&mut tx, row).await?;
    tx.commit().await?;
    Ok(())
}
