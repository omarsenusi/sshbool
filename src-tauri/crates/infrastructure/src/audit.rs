//! Shared audit log entry recorder.

use crate::AppState;
use serde_json::Value;
use uuid::Uuid;

/// Appends an entry to the `audit_log` database table.
pub async fn audit(
    state: &AppState,
    action: &str,
    target: Option<&str>,
    result: &str,
    meta: Option<Value>,
) {
    let id = Uuid::now_v7().to_string();
    let now = chrono::Utc::now().timestamp_millis();
    let _ = sqlx::query(
        "INSERT INTO audit_log (id, at, actor, action, target, metadata_json, result) VALUES (?, ?, 'local', ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(now)
    .bind(action)
    .bind(target)
    .bind(meta.map(|m| m.to_string()))
    .bind(result)
    .execute(state.vault.pool())
    .await;
}
