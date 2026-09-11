//! Human approval gate for WRITE and DANGEROUS tier tool calls.

use crate::approval::grant::{CreateGrantParams, SessionGrant};
use crate::approval::nonce::hash_canonical_args;
use crate::approval::{global_broker, ApprovalOutcome, ApprovalResponse};
use crate::error::McpError;
use crate::executor::McpToolExecutor;
use crate::policy::tier::Tier;
use crate::repo::approvals::{insert_approval, update_approval_decision, ApprovalRow};
use crate::repo::grants::{consume_grant_use, find_active_grant, insert_grant, GrantRow};
use crate::runtime::McpRuntimeState;
use crate::{ApprovalRequest, McpNotifier};
use infrastructure::redact::redact;
use serde_json::Value;
use sqlx::SqlitePool;
use std::sync::Arc;
use uuid::Uuid;

const PREVIEW_MAX_BYTES: usize = 512;

pub struct ToolCallContext {
    pub pool: SqlitePool,
    pub client_id: String,
    pub client_name: String,
    pub mode: String,
    pub session_handle: Option<String>,
    pub notifier: Option<Arc<dyn McpNotifier>>,
    pub approval_timeout_ms: u64,
    pub runtime: Arc<McpRuntimeState>,
}

impl ToolCallContext {
    pub fn executor(&self) -> Option<Arc<dyn McpToolExecutor>> {
        self.runtime.executor()
    }
}

pub struct GateResult {
    pub grant_id: Option<String>,
}

struct HostMeta {
    label: Option<String>,
    production: bool,
}

struct GateConfig {
    tier: &'static str,
    grantable: bool,
    allow_session_grants: bool,
    risk_reasons: Vec<String>,
}

async fn load_host_meta(pool: &SqlitePool, host_id: &str) -> Result<HostMeta, McpError> {
    let row =
        sqlx::query_as::<_, (String, i64)>("SELECT label, production FROM hosts WHERE id = ?")
            .bind(host_id)
            .fetch_optional(pool)
            .await?;

    Ok(match row {
        Some((label, production)) => HostMeta {
            label: Some(label),
            production: production != 0,
        },
        None => HostMeta {
            label: None,
            production: false,
        },
    })
}

fn arg_shape(args: &Value) -> String {
    hex::encode(crate::approval::nonce::hash_canonical_args(args))
}

fn preview_text(tool_name: &str, args: &Value) -> String {
    match tool_name {
        "exec_command" => args
            .get("command")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        "exec_script" => args
            .get("script_content")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        "run_background_task" => args
            .get("command")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        _ => {
            let raw = args.to_string();
            let redacted = redact(&raw);
            if redacted.len() > PREVIEW_MAX_BYTES {
                redacted[..PREVIEW_MAX_BYTES].to_string()
            } else {
                redacted
            }
        }
    }
}

fn simple_unified_diff(old: &str, new: &str, path: &str) -> String {
    let mut out = format!("--- a/{path}\n+++ b/{path}\n");
    if old == new {
        out.push_str("(no changes)\n");
        return out;
    }
    let old_lines: Vec<&str> = old.lines().collect();
    let new_lines: Vec<&str> = new.lines().collect();
    let max = old_lines.len().max(new_lines.len());
    let mut shown = 0usize;
    for i in 0..max {
        let o = old_lines.get(i).copied().unwrap_or("");
        let n = new_lines.get(i).copied().unwrap_or("");
        if o != n {
            if !o.is_empty() {
                out.push_str(&format!("-{o}\n"));
            }
            if !n.is_empty() {
                out.push_str(&format!("+{n}\n"));
            }
            shown += 1;
            if shown >= 40 {
                out.push_str("...(truncated)\n");
                break;
            }
        }
    }
    out
}

async fn build_write_preview(
    executor: Option<Arc<dyn McpToolExecutor>>,
    tool_name: &str,
    args: &Value,
    host_id: &str,
) -> Option<String> {
    let exec = executor?;
    let path = args
        .get("path")
        .or_else(|| args.get("destination_path"))?
        .as_str()?;
    match tool_name {
        "write_file" => {
            let new_content = args["content"].as_str()?;
            let old = exec
                .sftp_read_preview(host_id, path, 256 * 1024)
                .await
                .ok()
                .and_then(|v| v["content"].as_str().map(str::to_string))
                .unwrap_or_default();
            Some(simple_unified_diff(&old, new_content, path))
        }
        "edit_file_delta" => {
            let target = args["target_content"].as_str()?;
            let replacement = args["replacement_content"].as_str()?;
            let old = exec
                .sftp_read_preview(host_id, path, 256 * 1024)
                .await
                .ok()
                .and_then(|v| v["content"].as_str().map(str::to_string))?;
            let new_content = old.replace(target, replacement);
            Some(simple_unified_diff(&old, &new_content, path))
        }
        _ => None,
    }
}

async fn gate_tier_tool(
    ctx: &ToolCallContext,
    tool_name: &str,
    args: &Value,
    host_id: &str,
    config: GateConfig,
) -> Result<GateResult, McpError> {
    if ctx.runtime.is_vault_locked() {
        return Err(McpError::VaultLocked);
    }
    if ctx.runtime.is_kill_switch_active() {
        return Err(McpError::McpStopped);
    }

    let now = chrono::Utc::now().timestamp_millis();
    let shape = arg_shape(args);
    let host_meta = load_host_meta(&ctx.pool, host_id).await?;

    if config.allow_session_grants {
        if let Some(ref handle) = ctx.session_handle {
            if let Some(grant) =
                find_active_grant(&ctx.pool, &ctx.client_id, handle, tool_name, &shape, now).await?
            {
                if consume_grant_use(&ctx.pool, &grant.id).await? {
                    return Ok(GateResult {
                        grant_id: Some(grant.id),
                    });
                }
            }
        }
    }

    let Some(notifier) = ctx.notifier.clone() else {
        return Err(McpError::ApprovalDenied(
            "Human approval required but approval broker unavailable".into(),
        ));
    };

    let preview_output = if config.tier == "write" {
        build_write_preview(ctx.executor(), tool_name, args, host_id).await
    } else {
        None
    };

    let approval_uuid = Uuid::now_v7();
    let approval_id = approval_uuid.to_string();
    let expires_at = now + ctx.approval_timeout_ms as i64;
    let args_hash = hex::encode(hash_canonical_args(args));
    let command_preview = preview_text(tool_name, args);
    let risk_reasons_json =
        serde_json::to_string(&config.risk_reasons).unwrap_or_else(|_| "[]".into());
    let grantable = config.grantable && !host_meta.production;

    let row = ApprovalRow {
        id: approval_id.clone(),
        client_id: ctx.client_id.clone(),
        host_id: Some(host_id.to_string()),
        session_handle: ctx.session_handle.clone(),
        tool: tool_name.to_string(),
        args_hash,
        command_hash: None,
        command_preview: Some(command_preview.clone()),
        risk_tier: config.tier.into(),
        risk_reasons: Some(risk_reasons_json),
        ruleset_version: 1,
        preview_output: preview_output.clone(),
        decision: "pending".into(),
        decided_by: None,
        decided_at: None,
        nonce_hash: None,
        consumed_at: None,
        requested_at: now,
        expires_at,
    };
    insert_approval(&ctx.pool, &row).await?;

    notifier.approval_requested(&ApprovalRequest {
        id: approval_id.clone(),
        client_id: ctx.client_id.clone(),
        client_name: ctx.client_name.clone(),
        host_id: Some(host_id.to_string()),
        host_label: host_meta.label.clone(),
        production: host_meta.production,
        tool: tool_name.to_string(),
        command_preview: Some(command_preview),
        agent_reason: args
            .get("reason")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        risk_tier: config.tier.into(),
        risk_reasons: config.risk_reasons.clone(),
        preview_output,
        grantable,
        expires_at,
    });

    let rx = global_broker().register(approval_uuid);
    let response = tokio::time::timeout(
        std::time::Duration::from_millis(ctx.approval_timeout_ms),
        rx,
    )
    .await;

    match response {
        Ok(Ok(resp)) => match resp.outcome {
            ApprovalOutcome::AllowOnce => {
                update_approval_decision(
                    &ctx.pool,
                    &approval_id,
                    "allow_once",
                    resp.decided_by.as_deref(),
                    now,
                )
                .await?;
                Ok(GateResult { grant_id: None })
            }
            ApprovalOutcome::AllowSession => {
                if !grantable || !config.allow_session_grants {
                    update_approval_decision(&ctx.pool, &approval_id, "deny", Some("system"), now)
                        .await?;
                    return Err(McpError::InvalidArguments(
                        "Session grants are not available for this action".into(),
                    ));
                }
                let handle = ctx.session_handle.clone().ok_or_else(|| {
                    McpError::InvalidArguments("Session handle required for session grant".into())
                })?;
                let tier = if config.tier == "write" {
                    Tier::Write
                } else {
                    Tier::Dangerous
                };
                let grant = SessionGrant::new(CreateGrantParams {
                    client_id: ctx.client_id.clone(),
                    session_handle: handle.clone(),
                    host_id: Some(host_id.to_string()),
                    tool: tool_name.to_string(),
                    tier,
                    is_production_host: host_meta.production,
                    arg_shape: shape.clone(),
                    max_uses: 20,
                    ttl_mins: 15,
                    approval_id: Some(approval_id.clone()),
                })
                .map_err(|e| McpError::InvalidArguments(e.to_string()))?;

                let grant_row = GrantRow {
                    id: grant.id.clone(),
                    client_id: grant.client_id.clone(),
                    session_handle: grant.session_handle.clone(),
                    host_id: grant.host_id.clone(),
                    tool: grant.tool.clone(),
                    arg_shape_hash: hex::encode(grant.arg_shape_hash),
                    max_uses: grant.max_uses as i64,
                    uses: grant.uses as i64,
                    approval_id: grant.approval_id.clone(),
                    created_at: grant.created_at,
                    expires_at: grant.expires_at,
                    revoked_at: grant.revoked_at,
                };
                insert_grant(&ctx.pool, &grant_row).await?;
                consume_grant_use(&ctx.pool, &grant.id).await?;

                update_approval_decision(
                    &ctx.pool,
                    &approval_id,
                    "allow_session",
                    resp.decided_by.as_deref(),
                    now,
                )
                .await?;
                Ok(GateResult {
                    grant_id: Some(grant.id),
                })
            }
            ApprovalOutcome::Deny | ApprovalOutcome::Revoked => {
                update_approval_decision(
                    &ctx.pool,
                    &approval_id,
                    "deny",
                    resp.decided_by.as_deref(),
                    now,
                )
                .await?;
                Err(McpError::ApprovalDenied(
                    "Human denied the operation".into(),
                ))
            }
            ApprovalOutcome::Timeout => {
                update_approval_decision(&ctx.pool, &approval_id, "timeout", Some("system"), now)
                    .await?;
                Err(McpError::ApprovalDenied("Approval timed out".into()))
            }
        },
        Ok(Err(_)) => {
            update_approval_decision(&ctx.pool, &approval_id, "deny", Some("system"), now).await?;
            Err(McpError::ApprovalDenied("Approval channel closed".into()))
        }
        Err(_) => {
            global_broker().resolve(
                approval_uuid,
                ApprovalResponse {
                    outcome: ApprovalOutcome::Timeout,
                    decided_by: Some("system".into()),
                },
            );
            update_approval_decision(&ctx.pool, &approval_id, "timeout", Some("system"), now)
                .await?;
            Err(McpError::ApprovalDenied("Approval timed out".into()))
        }
    }
}

/// Ensures a WRITE tier call has human approval or a valid session grant.
pub async fn gate_write_tool(
    ctx: &ToolCallContext,
    tool_name: &str,
    args: &Value,
    host_id: &str,
) -> Result<GateResult, McpError> {
    gate_tier_tool(
        ctx,
        tool_name,
        args,
        host_id,
        GateConfig {
            tier: "write",
            grantable: true,
            allow_session_grants: true,
            risk_reasons: vec!["Write tier tool requires human approval".to_string()],
        },
    )
    .await
}

/// Ensures a DANGEROUS tier call has human approval. Session grants are never allowed.
pub async fn gate_dangerous_tool(
    ctx: &ToolCallContext,
    tool_name: &str,
    args: &Value,
    host_id: &str,
) -> Result<GateResult, McpError> {
    gate_tier_tool(
        ctx,
        tool_name,
        args,
        host_id,
        GateConfig {
            tier: "dangerous",
            grantable: false,
            allow_session_grants: false,
            risk_reasons: vec!["Dangerous tier tool requires human approval".to_string()],
        },
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::preview_text;
    use serde_json::json;

    #[test]
    fn preview_text_exec_command_returns_exact_command() {
        let args = json!({
            "host_id": "h1",
            "command": "ls -la /tmp",
            "reason": "list files"
        });
        assert_eq!(preview_text("exec_command", &args), "ls -la /tmp");
    }

    #[test]
    fn preview_text_other_tools_redacts_json() {
        let args = json!({ "path": "/etc/hosts", "content": "hello" });
        let preview = preview_text("write_file", &args);
        assert!(preview.contains("path"));
    }
}
