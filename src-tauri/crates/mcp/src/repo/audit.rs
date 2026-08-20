//! Atomic dual-write to `mcp_calls` and `audit_log`.

use crate::error::McpError;
use crate::repo::calls::{record_call_tx, CallRow};
use serde_json::Value;
use sqlx::SqlitePool;
use uuid::Uuid;

/// Records an MCP call and matching audit_log entry in one transaction.
/// Callers MUST abort tool execution when this fails.
pub async fn record_dual_audit(
    pool: &SqlitePool,
    call_row: &CallRow,
    audit_action: &str,
    audit_target: Option<&str>,
    audit_result: &str,
    audit_meta: Option<Value>,
) -> Result<(), McpError> {
    let mut tx = pool.begin().await?;
    record_call_tx(&mut tx, call_row).await?;

    let id = Uuid::now_v7().to_string();
    let now = call_row.at;
    sqlx::query(
        "INSERT INTO audit_log (id, at, actor, action, target, metadata_json, result) VALUES (?, ?, 'mcp', ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(now)
    .bind(audit_action)
    .bind(audit_target)
    .bind(audit_meta.map(|m| m.to_string()))
    .bind(audit_result)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(())
}
