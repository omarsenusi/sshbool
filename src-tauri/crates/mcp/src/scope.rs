//! Host scope resolution enforcing client allowlists and zero-existence-oracle isolation.

use crate::error::McpError;
use serde_json::Value;
use sqlx::SqlitePool;

#[derive(Debug, Clone)]
pub struct HostScopeGrant {
    pub client_id: String,
    pub host_id: String,
    pub exec_allowed: bool,
    pub write_allowed: bool,
}

#[derive(Debug, sqlx::FromRow)]
struct ScopeRow {
    exec_allowed: i64,
    write_allowed: i64,
}

/// Resolves whether a given host is in scope for a paired client.
pub async fn resolve_host_in_scope(
    pool: &SqlitePool,
    client_id: &str,
    host_id: &str,
) -> Result<HostScopeGrant, McpError> {
    let row = sqlx::query_as::<_, ScopeRow>(
        "SELECT exec_allowed, write_allowed FROM mcp_client_hosts WHERE client_id = ? AND host_id = ?",
    )
    .bind(client_id)
    .bind(host_id)
    .fetch_optional(pool)
    .await?;

    match row {
        Some(r) => Ok(HostScopeGrant {
            client_id: client_id.to_string(),
            host_id: host_id.to_string(),
            exec_allowed: r.exec_allowed != 0,
            write_allowed: r.write_allowed != 0,
        }),
        None => Err(McpError::HostNotInScope(format!(
            "HOST_NOT_IN_SCOPE: Host {host_id} is not accessible for client"
        ))),
    }
}

/// Returns all hosts in scope for a paired client.
pub async fn list_hosts_in_scope(
    pool: &SqlitePool,
    client_id: &str,
) -> Result<Vec<String>, McpError> {
    let rows =
        sqlx::query_scalar::<_, String>("SELECT host_id FROM mcp_client_hosts WHERE client_id = ?")
            .bind(client_id)
            .fetch_all(pool)
            .await?;

    Ok(rows)
}

/// Resolves host id from tool args via explicit host_id or MCP session handle.
pub async fn resolve_tool_host_id(
    pool: &SqlitePool,
    sessions: &crate::session::SessionRegistry,
    client_id: &str,
    args: &Value,
) -> Result<String, McpError> {
    if let Some(host_id) = args.get("host_id").and_then(|v| v.as_str()) {
        resolve_host_in_scope(pool, client_id, host_id).await?;
        return Ok(host_id.to_string());
    }
    if let Some(handle) = args.get("session_handle").and_then(|v| v.as_str()) {
        let host_id = sessions.validate_and_touch(handle, client_id)?;
        resolve_host_in_scope(pool, client_id, &host_id).await?;
        return Ok(host_id);
    }
    Err(McpError::InvalidArguments(
        "Missing host_id or session_handle".into(),
    ))
}
