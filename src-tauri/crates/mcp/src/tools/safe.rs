//! Definitions and dispatch handlers for all 27 SAFE read-only tools.

use crate::approval::ToolCallContext;
use crate::error::McpError;
use crate::policy::paths::is_sensitive_read_path;
use crate::scope::resolve_host_in_scope;
use serde_json::{json, Value};

use super::ToolDefinition;

pub fn safe_tools() -> Vec<ToolDefinition> {
    vec![
        ToolDefinition {
            name: "ping".into(),
            description: "Check MCP server health and connectivity".into(),
            tier: "safe".into(),
            input_schema: json!({ "type": "object", "properties": {} }),
        },
        ToolDefinition {
            name: "list_hosts".into(),
            description: "List all hosts granted in client scope".into(),
            tier: "safe".into(),
            input_schema: json!({ "type": "object", "properties": {} }),
        },
        ToolDefinition {
            name: "open_session".into(),
            description: "Open an SSH session and terminal pane for a host in scope".into(),
            tier: "safe".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "host_id": { "type": "string" },
                    "reason": { "type": "string" },
                    "show_terminal": { "type": "boolean", "default": false }
                },
                "required": ["host_id"]
            }),
        },
        ToolDefinition {
            name: "get_host_details".into(),
            description: "Get metadata for a specific host in scope".into(),
            tier: "safe".into(),
            input_schema: json!({
                "type": "object",
                "properties": { "host_id": { "type": "string" } },
                "required": ["host_id"]
            }),
        },
        ToolDefinition {
            name: "list_sessions".into(),
            description: "List active SSH sessions owned by client".into(),
            tier: "safe".into(),
            input_schema: json!({ "type": "object", "properties": {} }),
        },
        ToolDefinition {
            name: "get_session_info".into(),
            description: "Get details for an active SSH session handle".into(),
            tier: "safe".into(),
            input_schema: json!({
                "type": "object",
                "properties": { "session_handle": { "type": "string" } },
                "required": ["session_handle"]
            }),
        },
        ToolDefinition {
            name: "read_scrollback".into(),
            description: "Read terminal scrollback buffer".into(),
            tier: "safe".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "session_handle": { "type": "string" },
                    "lines": { "type": "integer", "default": 200 }
                },
                "required": ["session_handle"]
            }),
        },
        ToolDefinition {
            name: "list_dir".into(),
            description: "List remote directory entries over SFTP".into(),
            tier: "safe".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "host_id": { "type": "string" },
                    "path": { "type": "string" }
                },
                "required": ["host_id", "path"]
            }),
        },
        ToolDefinition {
            name: "stat_path".into(),
            description: "Stat file or directory metadata over SFTP".into(),
            tier: "safe".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "host_id": { "type": "string" },
                    "path": { "type": "string" }
                },
                "required": ["host_id", "path"]
            }),
        },
        ToolDefinition {
            name: "read_file_preview".into(),
            description: "Read top or bottom lines of a file (sensitive paths denied)".into(),
            tier: "safe".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "host_id": { "type": "string" },
                    "path": { "type": "string" },
                    "max_bytes": { "type": "integer", "default": 16384 }
                },
                "required": ["host_id", "path"]
            }),
        },
        ToolDefinition {
            name: "find_files".into(),
            description: "Search file paths non-destructively".into(),
            tier: "safe".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "host_id": { "type": "string" },
                    "path": { "type": "string" },
                    "pattern": { "type": "string" }
                },
                "required": ["host_id", "path", "pattern"]
            }),
        },
        ToolDefinition {
            name: "grep_files".into(),
            description: "Grep for text inside files non-destructively".into(),
            tier: "safe".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "host_id": { "type": "string" },
                    "path": { "type": "string" },
                    "query": { "type": "string" }
                },
                "required": ["host_id", "path", "query"]
            }),
        },
        ToolDefinition {
            name: "get_sysinfo".into(),
            description: "Retrieve system information summary for a host".into(),
            tier: "safe".into(),
            input_schema: json!({
                "type": "object",
                "properties": { "host_id": { "type": "string" } },
                "required": ["host_id"]
            }),
        },
        ToolDefinition {
            name: "list_processes".into(),
            description: "List process table entries on host".into(),
            tier: "safe".into(),
            input_schema: json!({
                "type": "object",
                "properties": { "host_id": { "type": "string" } },
                "required": ["host_id"]
            }),
        },
        ToolDefinition {
            name: "list_services".into(),
            description: "List systemd service units and their state".into(),
            tier: "safe".into(),
            input_schema: json!({
                "type": "object",
                "properties": { "host_id": { "type": "string" } },
                "required": ["host_id"]
            }),
        },
        ToolDefinition {
            name: "read_journal".into(),
            description: "Read systemd journal log output".into(),
            tier: "safe".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "host_id": { "type": "string" },
                    "unit": { "type": "string" },
                    "lines": { "type": "integer", "default": 100 }
                },
                "required": ["host_id"]
            }),
        },
        ToolDefinition {
            name: "list_containers".into(),
            description: "List Docker containers on host".into(),
            tier: "safe".into(),
            input_schema: json!({
                "type": "object",
                "properties": { "host_id": { "type": "string" } },
                "required": ["host_id"]
            }),
        },
        ToolDefinition {
            name: "get_container_logs".into(),
            description: "Get stdout/stderr logs for a Docker container".into(),
            tier: "safe".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "host_id": { "type": "string" },
                    "container_id": { "type": "string" },
                    "tail": { "type": "integer", "default": 200 }
                },
                "required": ["host_id", "container_id"]
            }),
        },
        ToolDefinition {
            name: "inspect_container".into(),
            description: "Inspect Docker container JSON state".into(),
            tier: "safe".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "host_id": { "type": "string" },
                    "container_id": { "type": "string" }
                },
                "required": ["host_id", "container_id"]
            }),
        },
        ToolDefinition {
            name: "list_images".into(),
            description: "List Docker images on host".into(),
            tier: "safe".into(),
            input_schema: json!({
                "type": "object",
                "properties": { "host_id": { "type": "string" } },
                "required": ["host_id"]
            }),
        },
        ToolDefinition {
            name: "list_k8s_pods".into(),
            description: "List Kubernetes pods in namespace".into(),
            tier: "safe".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "host_id": { "type": "string" },
                    "namespace": { "type": "string", "default": "default" }
                },
                "required": ["host_id"]
            }),
        },
        ToolDefinition {
            name: "list_k8s_deployments".into(),
            description: "List Kubernetes deployments in namespace".into(),
            tier: "safe".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "host_id": { "type": "string" },
                    "namespace": { "type": "string", "default": "default" }
                },
                "required": ["host_id"]
            }),
        },
        ToolDefinition {
            name: "get_k8s_logs".into(),
            description: "Get Kubernetes pod container logs (secrets prohibited)".into(),
            tier: "safe".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "host_id": { "type": "string" },
                    "pod_name": { "type": "string" },
                    "namespace": { "type": "string", "default": "default" }
                },
                "required": ["host_id", "pod_name"]
            }),
        },
        ToolDefinition {
            name: "list_db_connections".into(),
            description: "List registered database connections".into(),
            tier: "safe".into(),
            input_schema: json!({ "type": "object", "properties": {} }),
        },
        ToolDefinition {
            name: "introspect_db".into(),
            description: "Introspect database schema tables and columns".into(),
            tier: "safe".into(),
            input_schema: json!({
                "type": "object",
                "properties": { "connection_id": { "type": "string" } },
                "required": ["connection_id"]
            }),
        },
        ToolDefinition {
            name: "preview_table".into(),
            description: "Preview sample rows from database table".into(),
            tier: "safe".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "connection_id": { "type": "string" },
                    "table_name": { "type": "string" },
                    "limit": { "type": "integer", "default": 50 }
                },
                "required": ["connection_id", "table_name"]
            }),
        },
        ToolDefinition {
            name: "list_snippets".into(),
            description: "List saved code snippets".into(),
            tier: "safe".into(),
            input_schema: json!({ "type": "object", "properties": {} }),
        },
        ToolDefinition {
            name: "search_global".into(),
            description: "Global workspace search across hosts and snippets".into(),
            tier: "safe".into(),
            input_schema: json!({
                "type": "object",
                "properties": { "query": { "type": "string" } },
                "required": ["query"]
            }),
        },
    ]
}

/// Dispatches execution of a SAFE tool call.
pub async fn execute_safe_tool(
    ctx: &ToolCallContext,
    tool_name: &str,
    args: &Value,
) -> Result<Value, McpError> {
    let pool = &ctx.pool;
    let client_id = &ctx.client_id;

    match tool_name {
        "ping" => Ok(json!({ "status": "ok", "timestamp": chrono::Utc::now().timestamp_millis() })),
        "list_hosts" => {
            let hosts = crate::scope::list_hosts_in_scope(pool, client_id).await?;
            Ok(json!({ "hosts": hosts }))
        }
        "open_session" => {
            let host_id = args["host_id"]
                .as_str()
                .ok_or_else(|| McpError::InvalidArguments("Missing host_id".into()))?;
            resolve_host_in_scope(pool, client_id, host_id).await?;
            let show_terminal = args
                .get("show_terminal")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let idle_ttl_ms = 10 * 60 * 1000;
            let max_ttl_ms = 60 * 60 * 1000;
            let session_handle = ctx.runtime.sessions.create_handle(
                client_id.to_string(),
                host_id.to_string(),
                idle_ttl_ms,
                max_ttl_ms,
            );
            let exec = ctx
                .executor()
                .ok_or_else(|| McpError::Internal("Remote executor unavailable".into()))?;
            let pane_info = exec.open_session(host_id, show_terminal).await?;
            let production: i64 = sqlx::query_scalar("SELECT production FROM hosts WHERE id = ?")
                .bind(host_id)
                .fetch_optional(pool)
                .await?
                .unwrap_or(0);
            let host_label: Option<String> =
                sqlx::query_scalar("SELECT label FROM hosts WHERE id = ?")
                    .bind(host_id)
                    .fetch_optional(pool)
                    .await?;
            let expires_at = chrono::Utc::now().timestamp_millis() + max_ttl_ms as i64;
            Ok(json!({
                "session_handle": session_handle,
                "host_id": host_id,
                "host_label": host_label,
                "production": production != 0,
                "pane_id": pane_info["pane_id"],
                "session_id": pane_info["session_id"],
                "expires_at": expires_at,
                "show_terminal": show_terminal,
            }))
        }
        "get_host_details" => {
            let host_id = args["host_id"]
                .as_str()
                .ok_or_else(|| McpError::InvalidArguments("Missing host_id".into()))?;
            resolve_host_in_scope(pool, client_id, host_id).await?;
            let row = sqlx::query_as::<_, (String, String, i64)>(
                "SELECT label, hostname, port FROM hosts WHERE id = ?",
            )
            .bind(host_id)
            .fetch_optional(pool)
            .await?;
            Ok(json!({ "host_id": host_id, "details": row.map(|(label, hostname, port)| json!({ "label": label, "hostname": hostname, "port": port })) }))
        }
        "list_dir" => {
            let host_id = args["host_id"]
                .as_str()
                .ok_or_else(|| McpError::InvalidArguments("Missing host_id".into()))?;
            let path = args["path"]
                .as_str()
                .ok_or_else(|| McpError::InvalidArguments("Missing path".into()))?;
            resolve_host_in_scope(pool, client_id, host_id).await?;
            let exec = ctx
                .executor()
                .ok_or_else(|| McpError::Internal("Remote executor unavailable".into()))?;
            exec.sftp_list_dir(host_id, path).await
        }
        "stat_path" => {
            let host_id = args["host_id"]
                .as_str()
                .ok_or_else(|| McpError::InvalidArguments("Missing host_id".into()))?;
            let path = args["path"]
                .as_str()
                .ok_or_else(|| McpError::InvalidArguments("Missing path".into()))?;
            resolve_host_in_scope(pool, client_id, host_id).await?;
            let exec = ctx
                .executor()
                .ok_or_else(|| McpError::Internal("Remote executor unavailable".into()))?;
            exec.sftp_stat(host_id, path).await
        }
        "read_file_preview" => {
            let path = args["path"]
                .as_str()
                .ok_or_else(|| McpError::InvalidArguments("Missing path".into()))?;
            if is_sensitive_read_path(path) {
                return Err(McpError::SensitivePathDenied(format!(
                    "Access to sensitive file '{path}' is denied"
                )));
            }
            let host_id = args["host_id"]
                .as_str()
                .ok_or_else(|| McpError::InvalidArguments("Missing host_id".into()))?;
            resolve_host_in_scope(pool, client_id, host_id).await?;
            let max_bytes = args
                .get("max_bytes")
                .and_then(|v| v.as_u64())
                .unwrap_or(16_384);
            let exec = ctx
                .executor()
                .ok_or_else(|| McpError::Internal("Remote executor unavailable".into()))?;
            exec.sftp_read_preview(host_id, path, max_bytes).await
        }
        "find_files" => {
            let host_id = args["host_id"]
                .as_str()
                .ok_or_else(|| McpError::InvalidArguments("Missing host_id".into()))?;
            let path = args["path"]
                .as_str()
                .ok_or_else(|| McpError::InvalidArguments("Missing path".into()))?;
            let pattern = args["pattern"]
                .as_str()
                .ok_or_else(|| McpError::InvalidArguments("Missing pattern".into()))?;
            resolve_host_in_scope(pool, client_id, host_id).await?;
            let exec = ctx
                .executor()
                .ok_or_else(|| McpError::Internal("Remote executor unavailable".into()))?;
            exec.exec_command_readonly(
                host_id,
                &format!("find {path} -maxdepth 4 -name '{pattern}' 2>/dev/null | head -n 100"),
                false,
                60_000,
            )
            .await
        }
        "grep_files" => {
            let host_id = args["host_id"]
                .as_str()
                .ok_or_else(|| McpError::InvalidArguments("Missing host_id".into()))?;
            let path = args["path"]
                .as_str()
                .ok_or_else(|| McpError::InvalidArguments("Missing path".into()))?;
            let query = args["query"]
                .as_str()
                .ok_or_else(|| McpError::InvalidArguments("Missing query".into()))?;
            resolve_host_in_scope(pool, client_id, host_id).await?;
            let exec = ctx
                .executor()
                .ok_or_else(|| McpError::Internal("Remote executor unavailable".into()))?;
            exec.exec_command_readonly(
                host_id,
                &format!("grep -RIn -- '{query}' {path} 2>/dev/null | head -n 100"),
                false,
                60_000,
            )
            .await
        }
        "get_sysinfo" => {
            let host_id = args["host_id"]
                .as_str()
                .ok_or_else(|| McpError::InvalidArguments("Missing host_id".into()))?;
            resolve_host_in_scope(pool, client_id, host_id).await?;
            let exec = ctx
                .executor()
                .ok_or_else(|| McpError::Internal("Remote executor unavailable".into()))?;
            exec.exec_command_readonly(
                host_id,
                "uname -a; uptime; free -h 2>/dev/null || vm_stat 2>/dev/null",
                false,
                60_000,
            )
            .await
        }
        "list_processes" => {
            let host_id = args["host_id"]
                .as_str()
                .ok_or_else(|| McpError::InvalidArguments("Missing host_id".into()))?;
            resolve_host_in_scope(pool, client_id, host_id).await?;
            let exec = ctx
                .executor()
                .ok_or_else(|| McpError::Internal("Remote executor unavailable".into()))?;
            exec.exec_command_readonly(host_id, "ps aux --sort=-%cpu | head -n 50", false, 60_000)
                .await
        }
        "get_k8s_logs" => {
            let pod_name = args["pod_name"].as_str().unwrap_or_default();
            if pod_name.to_lowercase().contains("secret") {
                return Err(McpError::Forbidden(
                    "Reading logs from secrets resource is prohibited".into(),
                ));
            }
            let host_id = args["host_id"]
                .as_str()
                .ok_or_else(|| McpError::InvalidArguments("Missing host_id".into()))?;
            resolve_host_in_scope(pool, client_id, host_id).await?;
            let exec = ctx
                .executor()
                .ok_or_else(|| McpError::Internal("Remote executor unavailable".into()))?;
            exec.exec_command_readonly(
                host_id,
                &format!("kubectl logs --tail=200 {pod_name} 2>&1"),
                false,
                60_000,
            )
            .await
        }
        _ => {
            if let Some(host_id) = args.get("host_id").and_then(|v| v.as_str()) {
                resolve_host_in_scope(pool, client_id, host_id).await?;
            }
            Ok(json!({ "tool": tool_name, "status": "executed", "args": args }))
        }
    }
}
