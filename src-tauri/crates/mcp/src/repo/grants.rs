//! Session grant persistence for bounded WRITE tier authorizations.

use crate::error::McpError;
use sqlx::SqlitePool;

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct GrantRow {
    pub id: String,
    pub client_id: String,
    pub session_handle: String,
    pub host_id: Option<String>,
    pub tool: String,
    pub arg_shape_hash: String,
    pub max_uses: i64,
    pub uses: i64,
    pub approval_id: Option<String>,
    pub created_at: i64,
    pub expires_at: i64,
    pub revoked_at: Option<i64>,
}

pub async fn find_active_grant(
    pool: &SqlitePool,
    client_id: &str,
    session_handle: &str,
    tool: &str,
    arg_shape_hash: &str,
    now_ms: i64,
) -> Result<Option<GrantRow>, McpError> {
    let row = sqlx::query_as::<_, GrantRow>(
        r#"SELECT id, client_id, session_handle, host_id, tool, arg_shape_hash, max_uses, uses,
           approval_id, created_at, expires_at, revoked_at
           FROM mcp_grants
           WHERE client_id = ? AND session_handle = ? AND tool = ? AND arg_shape_hash = ?
             AND revoked_at IS NULL AND expires_at > ? AND uses < max_uses
           ORDER BY created_at DESC LIMIT 1"#,
    )
    .bind(client_id)
    .bind(session_handle)
    .bind(tool)
    .bind(arg_shape_hash)
    .bind(now_ms)
    .fetch_optional(pool)
    .await?;

    Ok(row)
}

pub async fn insert_grant(pool: &SqlitePool, row: &GrantRow) -> Result<(), McpError> {
    sqlx::query(
        r#"INSERT INTO mcp_grants
        (id, client_id, session_handle, host_id, tool, arg_shape_hash, max_uses, uses,
         approval_id, created_at, expires_at, revoked_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"#,
    )
    .bind(&row.id)
    .bind(&row.client_id)
    .bind(&row.session_handle)
    .bind(&row.host_id)
    .bind(&row.tool)
    .bind(&row.arg_shape_hash)
    .bind(row.max_uses)
    .bind(row.uses)
    .bind(&row.approval_id)
    .bind(row.created_at)
    .bind(row.expires_at)
    .bind(row.revoked_at)
    .execute(pool)
    .await?;

    Ok(())
}

pub async fn consume_grant_use(pool: &SqlitePool, grant_id: &str) -> Result<bool, McpError> {
    let res = sqlx::query(
        "UPDATE mcp_grants SET uses = uses + 1 WHERE id = ? AND uses < max_uses AND revoked_at IS NULL",
    )
    .bind(grant_id)
    .execute(pool)
    .await?;

    Ok(res.rows_affected() == 1)
}

pub async fn list_grants_for_client(
    pool: &SqlitePool,
    client_id: &str,
    now_ms: i64,
) -> Result<Vec<GrantRow>, McpError> {
    let rows = sqlx::query_as::<_, GrantRow>(
        r#"SELECT id, client_id, session_handle, host_id, tool, arg_shape_hash, max_uses, uses,
           approval_id, created_at, expires_at, revoked_at
           FROM mcp_grants
           WHERE client_id = ? AND revoked_at IS NULL AND expires_at > ?
           ORDER BY created_at DESC"#,
    )
    .bind(client_id)
    .bind(now_ms)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn list_all_active_grants(
    pool: &SqlitePool,
    now_ms: i64,
) -> Result<Vec<GrantRow>, McpError> {
    let rows = sqlx::query_as::<_, GrantRow>(
        r#"SELECT id, client_id, session_handle, host_id, tool, arg_shape_hash, max_uses, uses,
           approval_id, created_at, expires_at, revoked_at
           FROM mcp_grants
           WHERE revoked_at IS NULL AND expires_at > ?
           ORDER BY created_at DESC"#,
    )
    .bind(now_ms)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn revoke_grant(pool: &SqlitePool, grant_id: &str, now_ms: i64) -> Result<(), McpError> {
    sqlx::query("UPDATE mcp_grants SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL")
        .bind(now_ms)
        .bind(grant_id)
        .execute(pool)
        .await?;
    Ok(())
}
