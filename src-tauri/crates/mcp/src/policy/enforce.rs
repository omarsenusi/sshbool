//! Runtime budget enforcement for MCP clients.

use crate::error::McpError;
use crate::repo::policies::get_budget_for_client;
use sqlx::SqlitePool;

/// Returns an error and suspends the client when per-minute call budget is exceeded.
pub async fn enforce_call_budget(pool: &SqlitePool, client_id: &str) -> Result<(), McpError> {
    let budget = get_budget_for_client(pool, client_id).await?;
    let Some(budget) = budget else {
        return Ok(());
    };

    let now = chrono::Utc::now().timestamp_millis();
    let window_start = now - 60_000;
    let count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM mcp_calls WHERE client_id = ? AND at >= ?")
            .bind(client_id)
            .bind(window_start)
            .fetch_one(pool)
            .await?;

    if count >= budget.calls_per_min {
        sqlx::query("UPDATE mcp_clients SET suspended_reason = ?, updated_at = ? WHERE id = ?")
            .bind("budget_exceeded")
            .bind(now)
            .bind(client_id)
            .execute(pool)
            .await?;
        return Err(McpError::RateLimited {
            retry_after_secs: 60,
        });
    }

    Ok(())
}
