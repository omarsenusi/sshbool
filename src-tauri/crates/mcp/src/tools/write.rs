//! Definitions and dispatch handlers for all 8 WRITE tier tools.

use crate::approval::ToolCallContext;
use crate::error::McpError;
use crate::policy::paths::{is_hard_deny_delete_path, is_sensitive_read_path};
use crate::scope::resolve_host_in_scope;
use base64::Engine;
use serde_json::{json, Value};
use sqlx::SqlitePool;

use super::ToolDefinition;

pub fn write_tools() -> Vec<ToolDefinition> {
    vec![
        ToolDefinition {
            name: "write_file".into(),
            description: "Write full file contents over SFTP".into(),
            tier: "write".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "host_id": { "type": "string" },
                    "path": { "type": "string" },
                    "content": { "type": "string" },
                    "expected_mtime": { "type": "integer", "description": "Reject if remote mtime differs (STALE_MTIME protection)" }
                },
                "required": ["host_id", "path", "content"]
            }),
        },
        ToolDefinition {
            name: "edit_file_delta".into(),
            description: "Apply targeted string/patch edits to a remote file".into(),
            tier: "write".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "host_id": { "type": "string" },
                    "path": { "type": "string" },
                    "target_content": { "type": "string" },
                    "replacement_content": { "type": "string" },
                    "expected_mtime": { "type": "integer" }
                },
                "required": ["host_id", "path", "target_content", "replacement_content"]
            }),
        },
        ToolDefinition {
            name: "create_dir".into(),
            description: "Create directory structure on remote host".into(),
            tier: "write".into(),
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
            name: "rm_path".into(),
            description: "Remove file or directory (root & system paths hard-denied)".into(),
            tier: "write".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "host_id": { "type": "string" },
                    "path": { "type": "string" },
                    "recursive": { "type": "boolean", "default": false }
                },
                "required": ["host_id", "path"]
            }),
        },
        ToolDefinition {
            name: "chmod_path".into(),
            description: "Change file or directory mode bits".into(),
            tier: "write".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "host_id": { "type": "string" },
                    "path": { "type": "string" },
                    "mode": { "type": "string" }
                },
                "required": ["host_id", "path", "mode"]
            }),
        },
        ToolDefinition {
            name: "chown_path".into(),
            description: "Change file ownership (user:group)".into(),
            tier: "write".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "host_id": { "type": "string" },
                    "path": { "type": "string" },
                    "owner": { "type": "string" }
                },
                "required": ["host_id", "path", "owner"]
            }),
        },
        ToolDefinition {
            name: "upload_file".into(),
            description: "Upload binary payload to remote path over SFTP".into(),
            tier: "write".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "host_id": { "type": "string" },
                    "destination_path": { "type": "string" },
                    "base64_payload": { "type": "string" },
                    "expected_mtime": { "type": "integer" }
                },
                "required": ["host_id", "destination_path", "base64_payload"]
            }),
        },
        ToolDefinition {
            name: "kill_process".into(),
            description: "Send termination signal (SIGTERM/SIGKILL) to process ID".into(),
            tier: "write".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "host_id": { "type": "string" },
                    "pid": { "type": "integer" },
                    "signal": { "type": "string", "default": "SIGTERM" }
                },
                "required": ["host_id", "pid"]
            }),
        },
    ]
}

fn parse_mode(mode: &str) -> Result<u32, McpError> {
    let trimmed = mode.trim();
    let parsed = if let Some(stripped) = trimmed.strip_prefix("0o") {
        u32::from_str_radix(stripped, 8)
    } else if trimmed.starts_with('0') && trimmed.len() > 1 {
        u32::from_str_radix(trimmed, 8)
    } else {
        trimmed.parse::<u32>()
    }
    .map_err(|_| McpError::InvalidArguments(format!("Invalid mode: {mode}")))?;
    Ok(parsed)
}

/// Pre-approval path and scope validation for WRITE tools.
pub async fn validate_write_tool(
    pool: &SqlitePool,
    client_id: &str,
    tool_name: &str,
    args: &Value,
) -> Result<(), McpError> {
    let host_id = args["host_id"]
        .as_str()
        .ok_or_else(|| McpError::InvalidArguments("Missing host_id".into()))?;
    resolve_host_in_scope(pool, client_id, host_id).await?;

    match tool_name {
        "write_file" | "edit_file_delta" | "upload_file" => {
            let path = args
                .get("path")
                .or_else(|| args.get("destination_path"))
                .and_then(|v| v.as_str())
                .ok_or_else(|| McpError::InvalidArguments("Missing target path".into()))?;
            if is_sensitive_read_path(path) {
                return Err(McpError::SensitivePathDenied(format!(
                    "Writing to sensitive location '{path}' is strictly prohibited"
                )));
            }
        }
        "rm_path" => {
            let path = args["path"]
                .as_str()
                .ok_or_else(|| McpError::InvalidArguments("Missing path".into()))?;
            if is_hard_deny_delete_path(path) {
                return Err(McpError::SensitivePathDenied(format!(
                    "HARD_DENY: Removal of protected system path '{path}' is forbidden"
                )));
            }
        }
        _ => {}
    }
    Ok(())
}

/// Executes a WRITE tier tool call after approval.
pub async fn execute_write_tool(
    ctx: &ToolCallContext,
    tool_name: &str,
    args: &Value,
    host_id: &str,
) -> Result<Value, McpError> {
    let exec = ctx
        .executor()
        .ok_or_else(|| McpError::Internal("Remote executor unavailable".into()))?;
    let expected_mtime = args.get("expected_mtime").and_then(|v| v.as_i64());

    match tool_name {
        "write_file" => {
            let path = args["path"]
                .as_str()
                .ok_or_else(|| McpError::InvalidArguments("Missing path".into()))?;
            let content = args["content"]
                .as_str()
                .ok_or_else(|| McpError::InvalidArguments("Missing content".into()))?;
            exec.sftp_write(host_id, path, content, expected_mtime)
                .await
        }
        "edit_file_delta" => {
            let path = args["path"]
                .as_str()
                .ok_or_else(|| McpError::InvalidArguments("Missing path".into()))?;
            let target = args["target_content"]
                .as_str()
                .ok_or_else(|| McpError::InvalidArguments("Missing target_content".into()))?;
            let replacement = args["replacement_content"]
                .as_str()
                .ok_or_else(|| McpError::InvalidArguments("Missing replacement_content".into()))?;
            let preview = exec.sftp_read_preview(host_id, path, 512 * 1024).await?;
            let old = preview["content"]
                .as_str()
                .ok_or_else(|| McpError::Internal("Failed to read file for edit".into()))?;
            if !old.contains(target) {
                return Err(McpError::InvalidArguments(
                    "target_content not found in file".into(),
                ));
            }
            let new_content = old.replace(target, replacement);
            exec.sftp_write(host_id, path, &new_content, expected_mtime)
                .await
        }
        "upload_file" => {
            let path = args["destination_path"]
                .as_str()
                .ok_or_else(|| McpError::InvalidArguments("Missing destination_path".into()))?;
            let payload = args["base64_payload"]
                .as_str()
                .ok_or_else(|| McpError::InvalidArguments("Missing base64_payload".into()))?;
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(payload)
                .map_err(|e| McpError::InvalidArguments(format!("Invalid base64: {e}")))?;
            exec.sftp_write_bytes(host_id, path, &bytes, expected_mtime)
                .await
        }
        "create_dir" => {
            let path = args["path"]
                .as_str()
                .ok_or_else(|| McpError::InvalidArguments("Missing path".into()))?;
            exec.sftp_mkdir(host_id, path).await
        }
        "rm_path" => {
            let path = args["path"]
                .as_str()
                .ok_or_else(|| McpError::InvalidArguments("Missing path".into()))?;
            let recursive = args.get("recursive").and_then(|v| v.as_bool()).unwrap_or(false);
            exec.sftp_delete(host_id, path, recursive).await
        }
        "chmod_path" => {
            let path = args["path"]
                .as_str()
                .ok_or_else(|| McpError::InvalidArguments("Missing path".into()))?;
            let mode = args["mode"]
                .as_str()
                .ok_or_else(|| McpError::InvalidArguments("Missing mode".into()))?;
            exec.sftp_chmod(host_id, path, parse_mode(mode)?).await
        }
        "chown_path" => {
            let path = args["path"]
                .as_str()
                .ok_or_else(|| McpError::InvalidArguments("Missing path".into()))?;
            let owner = args["owner"]
                .as_str()
                .ok_or_else(|| McpError::InvalidArguments("Missing owner".into()))?;
            exec.exec_command(
                host_id,
                &format!("chown {owner} {path}"),
                super::exec_show_terminal(args),
                super::exec_timeout_ms(args),
            )
                .await
        }
        "kill_process" => {
            let pid = args["pid"]
                .as_i64()
                .ok_or_else(|| McpError::InvalidArguments("Missing pid".into()))?;
            let signal = args
                .get("signal")
                .and_then(|v| v.as_str())
                .unwrap_or("SIGTERM");
            exec.exec_command(
                host_id,
                &format!("kill -s {signal} {pid}"),
                super::exec_show_terminal(args),
                super::exec_timeout_ms(args),
            )
                .await
        }
        _ => Err(McpError::ToolNotAvailable(format!("Unknown write tool: {tool_name}"))),
    }
}
