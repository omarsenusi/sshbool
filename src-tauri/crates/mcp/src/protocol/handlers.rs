//! Handlers for standard MCP protocol RPC methods.

use crate::approval::nonce::hash_canonical_args;
use crate::approval::ToolCallContext;
use crate::error::McpError;
use crate::protocol::jsonrpc::{JsonRpcRequest, JsonRpcResponse};
use crate::repo::audit::record_dual_audit;
use crate::repo::calls::CallRow;
use crate::runtime::McpRuntimeState;
use crate::tools::{dispatch_tool_call, get_tools_for_mode, tool_risk_tier};
use crate::{CallLogEntry, McpNotifier};
use serde_json::{json, Value};
use sqlx::SqlitePool;
use std::sync::Arc;
use uuid::Uuid;

pub const AGENT_INSTRUCTIONS: &str = r#"You are operating through SSHBool MCP Server — an infrastructure desktop workspace tool.

SECURITY & OPERATIONAL CONTRACT:
1. Never request or transmit private SSH keys, master passwords, vault keys, or raw credential blobs.
2. Every tool call is gated by policy, audited, and logged to an immutable SQLite ledger.
3. Operations in read_only mode return diagnostic data only. Write or dangerous operations will be blocked or require explicit human approval.
4. Out-of-scope hosts do not exist in your workspace scope.
"#;

pub async fn handle_protocol_request(
    pool: &SqlitePool,
    client_id: &str,
    client_name: &str,
    mode: &str,
    notifier: &Arc<dyn McpNotifier>,
    approval_timeout_ms: u64,
    req: JsonRpcRequest,
) -> JsonRpcResponse {
    let runtime = McpRuntimeState::global();
    if runtime.is_vault_locked() {
        return JsonRpcResponse::error(
            req.id.clone(),
            -32603,
            "Vault is locked — MCP server degraded".to_string(),
        );
    }
    if runtime.is_kill_switch_active() {
        return JsonRpcResponse::error(
            req.id.clone(),
            -32603,
            "MCP kill switch active".to_string(),
        );
    }

    let call_id = Uuid::now_v7().to_string();
    let started = std::time::Instant::now();
    let now = chrono::Utc::now().timestamp_millis();
    let id = req.id.clone();

    let tool_name = if req.method == "tools/call" {
        req.params["name"].as_str().map(str::to_string)
    } else {
        None
    };
    let tool_args = if req.method == "tools/call" {
        Some(&req.params["arguments"])
    } else {
        None
    };
    let host_id = tool_args
        .and_then(|a| a.get("host_id"))
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let host_label = if let Some(ref hid) = host_id {
        sqlx::query_scalar::<_, String>("SELECT label FROM hosts WHERE id = ?")
            .bind(hid)
            .fetch_optional(pool)
            .await
            .ok()
            .flatten()
    } else {
        None
    };

    let result = match req.method.as_str() {
        "initialize" => Ok(json!({
            "protocolVersion": "2024-11-05",
            "capabilities": {
                "tools": { "listChanged": false },
                "resources": { "subscribe": false, "listChanged": false },
                "prompts": { "listChanged": false }
            },
            "serverInfo": {
                "name": "SSHBool MCP Server",
                "version": env!("CARGO_PKG_VERSION")
            },
            "instructions": AGENT_INSTRUCTIONS
        })),
        "tools/list" => {
            let tools = get_tools_for_mode(mode);
            let tool_objs: Vec<Value> = tools
                .into_iter()
                .map(|t| {
                    json!({
                        "name": t.name,
                        "description": t.description,
                        "inputSchema": t.input_schema
                    })
                })
                .collect();
            Ok(json!({ "tools": tool_objs }))
        }
        "tools/call" => {
            let name = tool_name.clone().unwrap_or_default();
            let args = &req.params["arguments"];
            if let Err(e) = crate::policy::enforce::enforce_call_budget(pool, client_id).await {
                Err(e)
            } else {
            let ctx = ToolCallContext {
                pool: pool.clone(),
                client_id: client_id.to_string(),
                client_name: client_name.to_string(),
                mode: mode.to_string(),
                session_handle: req.params["sessionHandle"]
                    .as_str()
                    .or_else(|| args.get("session_handle").and_then(|v| v.as_str()))
                    .map(str::to_string),
                notifier: Some(notifier.clone()),
                approval_timeout_ms,
                runtime: runtime.clone(),
            };
            dispatch_tool_call(&ctx, &name, args).await
            }
        }
        "resources/list" => Ok(json!({
            "resources": [
                {
                    "uri": "sshbool://facts",
                    "name": "Host System Facts",
                    "description": "Hardware and OS facts mirror",
                    "mimeType": "application/json"
                }
            ]
        })),
        "resources/read" => Ok(json!({
            "contents": [
                {
                    "uri": "sshbool://facts",
                    "mimeType": "application/json",
                    "text": "{\"status\":\"active\"}"
                }
            ]
        })),
        "prompts/list" => Ok(json!({
            "prompts": [
                {
                    "name": "triage-service",
                    "description": "Triage an unhealthy service"
                }
            ]
        })),
        "prompts/get" => Ok(json!({
            "description": "Triage service instructions",
            "messages": [
                {
                    "role": "user",
                    "content": {
                        "type": "text",
                        "text": "Please check systemctl status and read journalctl logs."
                    }
                }
            ]
        })),
        _ => Err(McpError::ToolNotAvailable(format!(
            "Method '{}' not found",
            req.method
        ))),
    };

    let duration_ms = started.elapsed().as_millis() as i64;
    let (decision, err_code, res_val) = match &result {
        Ok(v) => ("allow", None, Some(v.clone())),
        Err(e) => {
            let code = match e {
                McpError::ToolNotAvailable(_) => "-32601",
                McpError::InvalidArguments(_) => "-32602",
                McpError::SensitivePathDenied(_) => "SENSITIVE_PATH_DENIED",
                McpError::ApprovalDenied(_) => "APPROVAL_DENIED",
                McpError::VaultLocked => "VAULT_LOCKED",
                McpError::McpStopped => "MCP_STOPPED",
                McpError::StaleMtime(_) => "STALE_MTIME",
                McpError::HardDeny(_) => "HARD_DENY",
                _ => "-32603",
            };
            ("deny", Some(code.to_string()), None)
        }
    };

    let risk_tier = tool_name
        .as_deref()
        .and_then(tool_risk_tier)
        .unwrap_or("safe");
    let args_hash = tool_args.map(|a| hex::encode(hash_canonical_args(a)));
    let command_preview = tool_args.map(preview_args);

    let call_row = CallRow {
        id: call_id.clone(),
        at: now,
        client_id: Some(client_id.to_string()),
        client_name: Some(client_name.to_string()),
        host_id: host_id.clone(),
        host_label: host_label.clone(),
        session_handle: req.params["sessionHandle"]
            .as_str()
            .map(str::to_string),
        tool: tool_name.clone().unwrap_or_else(|| req.method.clone()),
        args_hash,
        command_preview,
        risk_tier: Some(risk_tier.into()),
        risk_reasons: None,
        ruleset_version: Some(1),
        decision: decision.into(),
        approval_id: None,
        grant_id: None,
        duration_ms: Some(duration_ms),
        result_bytes: res_val.as_ref().map(|v| v.to_string().len() as i64),
        truncated: 0,
        error_code: err_code.clone(),
        reason: tool_args
            .and_then(|a| a.get("reason"))
            .and_then(|v| v.as_str())
            .map(str::to_string),
    };

    let audit_meta = json!({
        "client_id": client_id,
        "tool": tool_name,
        "host_id": host_id,
        "decision": decision,
        "error_code": err_code,
        "duration_ms": duration_ms,
    });

    if let Err(audit_err) = record_dual_audit(
        pool,
        &call_row,
        "mcp.tool_call",
        tool_name.as_deref(),
        decision,
        Some(audit_meta),
    )
    .await
    {
        return JsonRpcResponse::error(id, -32603, format!("Audit write failed: {audit_err}"));
    }

    notifier.call_recorded(&CallLogEntry {
        id: call_id,
        at: now,
        client_id: Some(client_id.to_string()),
        client_name: Some(client_name.to_string()),
        host_id,
        host_label,
        tool: tool_name.unwrap_or_else(|| req.method.clone()),
        risk_tier: Some(risk_tier.into()),
        decision: decision.into(),
        duration_ms: Some(duration_ms),
        result_bytes: res_val.as_ref().map(|v| v.to_string().len() as i64),
        error_code: err_code,
    });

    match result {
        Ok(val) => JsonRpcResponse::success(id, val),
        Err(e) => JsonRpcResponse::error(id, -32603, e.to_string()),
    }
}

fn preview_args(args: &Value) -> String {
    let raw = args.to_string();
    let redacted = infrastructure::redact::redact(&raw);
    if redacted.len() > 512 {
        redacted[..512].to_string()
    } else {
        redacted
    }
}
