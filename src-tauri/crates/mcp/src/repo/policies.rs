//! Sqlx repository layer for per-tool policies and client budgets.

use crate::error::McpError;
use sqlx::SqlitePool;

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct PolicyRow {
    pub id: String,
    pub client_id: String,
    pub tool: String,
    pub tier_override: Option<String>,
    pub requires_approval: Option<i64>,
    pub rate_limit_per_min: Option<i64>,
    pub disabled: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct BudgetRow {
    pub client_id: String,
    pub calls_per_min: i64,
    pub execs_per_min: i64,
    pub concurrent_calls: i64,
    pub concurrent_execs: i64,
    pub max_handles: i64,
    pub max_result_bytes: i64,
    pub exec_timeout_ms: i64,
    pub max_pending_approvals: i64,
    pub approvals_per_hour: i64,
    pub handle_idle_ms: i64,
    pub handle_max_ms: i64,
    pub updated_at: i64,
}

pub async fn get_budget_for_client(
    pool: &SqlitePool,
    client_id: &str,
) -> Result<Option<BudgetRow>, McpError> {
    let row = sqlx::query_as::<_, BudgetRow>(
        "SELECT client_id, calls_per_min, execs_per_min, concurrent_calls, concurrent_execs, max_handles, max_result_bytes, exec_timeout_ms, max_pending_approvals, approvals_per_hour, handle_idle_ms, handle_max_ms, updated_at FROM mcp_budgets WHERE client_id = ?",
    )
    .bind(client_id)
    .fetch_optional(pool)
    .await?;

    Ok(row)
}

pub async fn get_policies_for_client(
    pool: &SqlitePool,
    client_id: &str,
) -> Result<Vec<PolicyRow>, McpError> {
    let rows = sqlx::query_as::<_, PolicyRow>(
        "SELECT id, client_id, tool, tier_override, requires_approval, rate_limit_per_min, disabled, updated_at FROM mcp_policies WHERE client_id = ?",
    )
    .bind(client_id)
    .fetch_all(pool)
    .await?;

    Ok(rows)
}
