//! Tauri IPC commands for MCP server management, pairing, host scoping, and activity logging.

use infrastructure::AppState;
use mcp::config::{LoopbackAddr, ServerConfig};
use mcp::pairing::{generate_6digit_code, hash_pairing_code};
use mcp::repo::clients::{grant_host_to_client, list_clients};
use mcp::{McpNotifier, McpServerHandle};
use serde_json::{json, Value};
use std::sync::{Arc, LazyLock};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::Mutex;

use crate::commands::license::require_feature;
use crate::error::AppError;

static MCP_HANDLE: LazyLock<Arc<Mutex<Option<McpServerHandle>>>> =
    LazyLock::new(|| Arc::new(Mutex::new(None)));

struct AppNotifier {
    app_handle: AppHandle,
}

impl McpNotifier for AppNotifier {
    fn approval_requested(&self, req: &mcp::ApprovalRequest) {
        let _ = self.app_handle.emit("mcp://approval-request", req);
    }
    fn call_recorded(&self, entry: &mcp::CallLogEntry) {
        let _ = self.app_handle.emit("mcp://call-recorded", entry);
    }
    fn server_state_changed(&self, state: &mcp::ServerState) {
        let _ = self.app_handle.emit("mcp://server-state", state);
    }
    fn pane_ready(&self, event: &mcp::PaneReadyEvent) {
        let _ = self.app_handle.emit("mcp://pane-ready", event);
    }
}

fn db(e: sqlx::Error) -> AppError {
    AppError::Db {
        engine: "sqlite".into(),
        message: e.to_string(),
    }
}

#[tauri::command]
pub async fn mcp_server_start(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    port: Option<u16>,
) -> Result<Value, AppError> {
    require_feature(&state, "mcp_server").await?;

    let mut lock = MCP_HANDLE.lock().await;
    if let Some(ref handle) = *lock {
        if handle.is_running() {
            return Ok(json!({
                "enabled": true,
                "port": handle.port(),
                "status": "running"
            }));
        }
        // Drop stale handle from a prior stop/crash so the port can be rebound.
        *lock = None;
    }

    let bind_port = port.unwrap_or(47821);
    let loopback = LoopbackAddr::new(bind_port).map_err(|e| AppError::Validation {
        field: "port".into(),
        message: e.to_string(),
    })?;

    let config = ServerConfig {
        bind_addr: loopback,
        ruleset_version: 1,
        approval_timeout_ms: 60000,
    };

    let notifier = Arc::new(AppNotifier { app_handle: app });
    let executor = Arc::new(crate::mcp_executor::AppMcpExecutor::new(
        state.inner().clone(),
        mcp::runtime::McpRuntimeState::global(),
    ));
    let handle = McpServerHandle::start(config, state.vault.pool().clone(), notifier, executor)
        .await
        .map_err(|e| AppError::Internal {
            message: format!("Failed to start MCP server: {e}"),
        })?;

    let port = handle.port();
    *lock = Some(handle);

    Ok(json!({
        "enabled": true,
        "port": port,
        "status": "started"
    }))
}

#[tauri::command]
pub async fn mcp_server_stop(
    _state: State<'_, Arc<AppState>>,
) -> Result<(), AppError> {
    let mut lock = MCP_HANDLE.lock().await;
    if let Some(handle) = lock.take() {
        handle.stop();
    }
    Ok(())
}

#[tauri::command]
pub async fn mcp_server_status(
    _state: State<'_, Arc<AppState>>,
) -> Result<Value, AppError> {
    let lock = MCP_HANDLE.lock().await;
    let (running, port) = match &*lock {
        Some(h) => (h.is_running(), h.port()),
        None => (false, 47821),
    };
    let runtime = mcp::runtime::McpRuntimeState::global();

    Ok(json!({
        "enabled": running,
        "port": port,
        "activeClientsCount": 0,
        "degradedVaultLocked": runtime.is_vault_locked() || runtime.is_kill_switch_active()
    }))
}

#[tauri::command]
pub async fn mcp_pairing_code_create(
    state: State<'_, Arc<AppState>>,
) -> Result<Value, AppError> {
    let raw_code = generate_6digit_code();
    let code_hash = hash_pairing_code(&raw_code);
    let ttl_secs = 300; // 5 minutes

    let _id = mcp::repo::clients::create_pairing_code(state.vault.pool(), &code_hash, ttl_secs)
        .await
        .map_err(|e| AppError::Internal { message: e.to_string() })?;

    let expires_at = chrono::Utc::now().timestamp_millis() + (ttl_secs * 1000);

    Ok(json!({
        "code": raw_code,
        "expiresAt": expires_at,
        "ttlSecs": ttl_secs
    }))
}

fn cursor_mcp_config(port: u16, access_token: &str) -> Value {
    json!({
        "mcpServers": {
            "sshbool": {
                "url": format!("http://127.0.0.1:{port}/mcp"),
                "headers": {
                    "Authorization": format!("Bearer {access_token}")
                }
            }
        }
    })
}

/// Pair a new MCP client from the desktop app and return a ready-to-paste Cursor config.
#[tauri::command]
pub async fn mcp_client_pair(
    state: State<'_, Arc<AppState>>,
    client_name: Option<String>,
    client_version: Option<String>,
) -> Result<Value, AppError> {
    require_feature(&state, "mcp_server").await?;

    let lock = MCP_HANDLE.lock().await;
    if lock.as_ref().is_none_or(|h| !h.is_running()) {
        return Err(AppError::Conflict {
            message: "Start the MCP server before pairing a client".into(),
        });
    }
    let port = lock.as_ref().map(|h| h.port()).unwrap_or(47821);
    drop(lock);

    let pair = mcp::pairing::pair_client_from_app(
        state.vault.pool(),
        mcp::pairing::LocalPairRequest {
            client_name: client_name.unwrap_or_else(|| "Cursor".into()),
            client_version,
        },
    )
    .await
    .map_err(|e| AppError::Internal {
        message: e.to_string(),
    })?;

    let config = cursor_mcp_config(port, &pair.access_token);

    Ok(json!({
        "clientId": pair.client_id,
        "accessToken": pair.access_token,
        "mode": pair.mode,
        "expiresAt": pair.expires_at,
        "port": port,
        "cursorConfig": serde_json::to_string_pretty(&config).unwrap_or_default(),
    }))
}

#[tauri::command]
pub async fn mcp_clients_list(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<Value>, AppError> {
    let clients = list_clients(state.vault.pool())
        .await
        .map_err(|e| AppError::Internal { message: e.to_string() })?;

    let mut result = Vec::new();
    for c in clients {
        let hosts: Vec<String> = sqlx::query_scalar::<_, String>(
            "SELECT host_id FROM mcp_client_hosts WHERE client_id = ?",
        )
        .bind(&c.id)
        .fetch_all(state.vault.pool())
        .await
        .unwrap_or_default();

        result.push(json!({
            "id": c.id,
            "name": c.name,
            "clientVersion": c.client_version,
            "mode": c.mode,
            "enabled": c.enabled != 0,
            "suspendedReason": c.suspended_reason,
            "pairedAt": c.paired_at,
            "lastSeenAt": c.last_seen_at,
            "allowedHosts": hosts,
        }));
    }

    Ok(result)
}

#[tauri::command]
pub async fn mcp_client_set_mode(
    state: State<'_, Arc<AppState>>,
    client_id: String,
    mode: String,
) -> Result<(), AppError> {
    let now = chrono::Utc::now().timestamp_millis();
    sqlx::query("UPDATE mcp_clients SET mode = ?, updated_at = ? WHERE id = ?")
        .bind(&mode)
        .bind(now)
        .bind(&client_id)
        .execute(state.vault.pool())
        .await
        .map_err(db)?;
    Ok(())
}

#[tauri::command]
pub async fn mcp_client_set_enabled(
    state: State<'_, Arc<AppState>>,
    client_id: String,
    enabled: bool,
) -> Result<(), AppError> {
    let now = chrono::Utc::now().timestamp_millis();
    sqlx::query("UPDATE mcp_clients SET enabled = ?, updated_at = ? WHERE id = ?")
        .bind(if enabled { 1 } else { 0 })
        .bind(now)
        .bind(&client_id)
        .execute(state.vault.pool())
        .await
        .map_err(db)?;
    Ok(())
}

#[tauri::command]
pub async fn mcp_client_delete(
    state: State<'_, Arc<AppState>>,
    client_id: String,
) -> Result<(), AppError> {
    sqlx::query("DELETE FROM mcp_clients WHERE id = ?")
        .bind(&client_id)
        .execute(state.vault.pool())
        .await
        .map_err(db)?;
    Ok(())
}

#[tauri::command]
pub async fn mcp_client_grant_host(
    state: State<'_, Arc<AppState>>,
    client_id: String,
    host_id: String,
    exec_allowed: Option<bool>,
    write_allowed: Option<bool>,
) -> Result<(), AppError> {
    grant_host_to_client(
        state.vault.pool(),
        &client_id,
        &host_id,
        exec_allowed.unwrap_or(true),
        write_allowed.unwrap_or(true),
        Some("user"),
    )
    .await
    .map_err(|e| AppError::Internal { message: e.to_string() })?;

    Ok(())
}

#[tauri::command]
pub async fn mcp_client_revoke_host(
    state: State<'_, Arc<AppState>>,
    client_id: String,
    host_id: String,
) -> Result<(), AppError> {
    sqlx::query("DELETE FROM mcp_client_hosts WHERE client_id = ? AND host_id = ?")
        .bind(&client_id)
        .bind(&host_id)
        .execute(state.vault.pool())
        .await
        .map_err(db)?;
    Ok(())
}

#[tauri::command]
pub async fn mcp_calls_list(
    state: State<'_, Arc<AppState>>,
    limit: Option<i64>,
) -> Result<Vec<Value>, AppError> {
    let lim = limit.unwrap_or(100);
    let rows = sqlx::query_as::<_, mcp::repo::calls::CallRow>(
        "SELECT id, at, client_id, client_name, host_id, host_label, session_handle, tool, args_hash, command_preview, risk_tier, risk_reasons, ruleset_version, decision, approval_id, grant_id, duration_ms, result_bytes, truncated, error_code, reason FROM mcp_calls ORDER BY at DESC LIMIT ?",
    )
    .bind(lim)
    .fetch_all(state.vault.pool())
    .await
    .map_err(db)?;

    Ok(rows
        .into_iter()
        .map(|r| {
            json!({
                "id": r.id,
                "at": r.at,
                "clientName": r.client_name,
                "hostLabel": r.host_label,
                "tool": r.tool,
                "riskTier": r.risk_tier,
                "decision": r.decision,
                "durationMs": r.duration_ms,
                "resultBytes": r.result_bytes,
                "errorCode": r.error_code,
            })
        })
        .collect())
}

#[tauri::command]
pub async fn mcp_approvals_pending(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<Value>, AppError> {
    let now = chrono::Utc::now().timestamp_millis();
    let rows = mcp::repo::approvals::list_pending_approvals(state.vault.pool(), now)
        .await
        .map_err(|e| AppError::Internal { message: e.to_string() })?;

    let mut result = Vec::with_capacity(rows.len());
    for row in rows {
        let client_name: Option<String> = sqlx::query_scalar(
            "SELECT name FROM mcp_clients WHERE id = ?",
        )
        .bind(&row.client_id)
        .fetch_optional(state.vault.pool())
        .await
        .map_err(db)?;

        let host_meta: Option<(String, i64)> = if let Some(ref host_id) = row.host_id {
            sqlx::query_as("SELECT label, production FROM hosts WHERE id = ?")
                .bind(host_id)
                .fetch_optional(state.vault.pool())
                .await
                .map_err(db)?
        } else {
            None
        };

        let risk_reasons: Vec<String> = row
            .risk_reasons
            .as_deref()
            .and_then(|s| serde_json::from_str(s).ok())
            .unwrap_or_default();

        let (host_label, production) = host_meta
            .map(|(label, prod)| (Some(label), prod != 0))
            .unwrap_or((None, false));

        result.push(json!({
            "approvalId": row.id,
            "clientId": row.client_id,
            "clientName": client_name.unwrap_or_else(|| "Unknown client".into()),
            "hostId": row.host_id,
            "hostLabel": host_label,
            "production": production,
            "tool": row.tool,
            "riskTier": row.risk_tier,
            "riskReasons": risk_reasons,
            "commandText": row.command_preview,
            "previewOutput": row.preview_output,
            "grantable": !production && row.risk_tier != "dangerous",
            "requestedAt": row.requested_at,
            "expiresAt": row.expires_at,
        }));
    }

    Ok(result)
}

#[tauri::command]
pub async fn mcp_approval_respond(
    state: State<'_, Arc<AppState>>,
    approval_id: String,
    decision: String,
) -> Result<(), AppError> {
    let now = chrono::Utc::now().timestamp_millis();

    let row = mcp::repo::approvals::get_approval_by_id(state.vault.pool(), &approval_id)
        .await
        .map_err(|e| AppError::Internal { message: e.to_string() })?
        .ok_or_else(|| AppError::NotFound {
            entity: "approval".into(),
            id: Some(approval_id.clone()),
        })?;

    if row.decision != "pending" {
        return Err(AppError::Conflict {
            message: "approval already resolved".into(),
        });
    }

    if now >= row.expires_at {
        return Err(AppError::Conflict {
            message: "approval already resolved".into(),
        });
    }

    let production = if let Some(ref host_id) = row.host_id {
        sqlx::query_scalar::<_, i64>("SELECT production FROM hosts WHERE id = ?")
            .bind(host_id)
            .fetch_optional(state.vault.pool())
            .await
            .map_err(db)?
            .unwrap_or(0)
            != 0
    } else {
        false
    };

    if decision == "allow_session" && (row.risk_tier == "dangerous" || production) {
        return Err(AppError::Validation {
            field: "decision".into(),
            message: "session grants are not available for this action".into(),
        });
    }

    let db_decision = match decision.as_str() {
        "allow_once" => "allow_once",
        "allow_session" => "allow_session",
        _ => "deny",
    };

    let outcome = match decision.as_str() {
        "allow_once" => mcp::approval::ApprovalOutcome::AllowOnce,
        "allow_session" => mcp::approval::ApprovalOutcome::AllowSession,
        _ => mcp::approval::ApprovalOutcome::Deny,
    };

    if let Ok(parsed_uuid) = uuid::Uuid::parse_str(&approval_id) {
        let resolved = mcp::approval::global_broker().resolve(
            parsed_uuid,
            mcp::approval::ApprovalResponse {
                outcome,
                decided_by: Some("user".into()),
            },
        );

        if !resolved {
            return Err(AppError::Conflict {
                message: "no pending approval gate — the request may have timed out".into(),
            });
        }
    }

    mcp::repo::approvals::update_approval_decision(
        state.vault.pool(),
        &approval_id,
        db_decision,
        Some("user"),
        now,
    )
    .await
    .map_err(|e| AppError::Internal { message: e.to_string() })?;

    Ok(())
}

#[tauri::command]
pub async fn mcp_kill_switch(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<Value, AppError> {
    require_feature(&state, "mcp_server").await?;

    mcp::runtime::McpRuntimeState::global().activate_kill_switch();

    let now = chrono::Utc::now().timestamp_millis();
    sqlx::query(
        "UPDATE mcp_clients SET token_hash = ?, token_expires_at = ?, enabled = 0, suspended_reason = ?, updated_at = ? WHERE enabled = 1",
    )
    .bind(format!("revoked_{now}"))
    .bind(now)
    .bind("kill_switch")
    .bind(now)
    .execute(state.vault.pool())
    .await
    .map_err(db)?;

    let mut lock = MCP_HANDLE.lock().await;
    if let Some(handle) = lock.take() {
        handle.stop();
    }

    let _ = app.emit(
        "mcp://server-state",
        mcp::ServerState {
            enabled: false,
            port: 47821,
            active_clients_count: 0,
            degraded_vault_locked: true,
        },
    );

    Ok(json!({ "status": "kill_switch_activated" }))
}

#[tauri::command]
pub async fn mcp_grants_list(
    state: State<'_, Arc<AppState>>,
    client_id: Option<String>,
) -> Result<Vec<Value>, AppError> {
    let now = chrono::Utc::now().timestamp_millis();
    let rows = if let Some(cid) = client_id {
        mcp::repo::grants::list_grants_for_client(state.vault.pool(), &cid, now)
            .await
            .map_err(|e| AppError::Internal { message: e.to_string() })?
    } else {
        mcp::repo::grants::list_all_active_grants(state.vault.pool(), now)
            .await
            .map_err(|e| AppError::Internal { message: e.to_string() })?
    };

    Ok(rows
        .into_iter()
        .map(|g| {
            json!({
                "id": g.id,
                "clientId": g.client_id,
                "sessionHandle": g.session_handle,
                "hostId": g.host_id,
                "tool": g.tool,
                "uses": g.uses,
                "maxUses": g.max_uses,
                "expiresAt": g.expires_at,
                "createdAt": g.created_at,
            })
        })
        .collect())
}

#[tauri::command]
pub async fn mcp_grant_revoke(
    state: State<'_, Arc<AppState>>,
    grant_id: String,
) -> Result<(), AppError> {
    let now = chrono::Utc::now().timestamp_millis();
    mcp::repo::grants::revoke_grant(state.vault.pool(), &grant_id, now)
        .await
        .map_err(|e| AppError::Internal { message: e.to_string() })?;
    Ok(())
}

#[tauri::command]
pub async fn mcp_budgets_get(
    state: State<'_, Arc<AppState>>,
    client_id: String,
) -> Result<Value, AppError> {
    let row = mcp::repo::policies::get_budget_for_client(state.vault.pool(), &client_id)
        .await
        .map_err(|e| AppError::Internal { message: e.to_string() })?
        .ok_or_else(|| AppError::NotFound {
            entity: "mcp_budget".into(),
            id: Some(client_id.clone()),
        })?;

    Ok(json!({
        "clientId": row.client_id,
        "callsPerMin": row.calls_per_min,
        "execsPerMin": row.execs_per_min,
        "concurrentCalls": row.concurrent_calls,
        "concurrentExecs": row.concurrent_execs,
        "maxHandles": row.max_handles,
        "maxResultBytes": row.max_result_bytes,
        "execTimeoutMs": row.exec_timeout_ms,
        "maxPendingApprovals": row.max_pending_approvals,
        "approvalsPerHour": row.approvals_per_hour,
        "handleIdleMs": row.handle_idle_ms,
        "handleMaxMs": row.handle_max_ms,
    }))
}

#[tauri::command]
pub async fn mcp_budgets_set(
    state: State<'_, Arc<AppState>>,
    client_id: String,
    calls_per_min: Option<i64>,
    execs_per_min: Option<i64>,
    max_pending_approvals: Option<i64>,
) -> Result<(), AppError> {
    let now = chrono::Utc::now().timestamp_millis();
    let existing = mcp::repo::policies::get_budget_for_client(state.vault.pool(), &client_id)
        .await
        .map_err(|e| AppError::Internal { message: e.to_string() })?
        .ok_or_else(|| AppError::NotFound {
            entity: "mcp_budget".into(),
            id: Some(client_id.clone()),
        })?;

    sqlx::query(
        "UPDATE mcp_budgets SET calls_per_min = ?, execs_per_min = ?, max_pending_approvals = ?, updated_at = ? WHERE client_id = ?",
    )
    .bind(calls_per_min.unwrap_or(existing.calls_per_min))
    .bind(execs_per_min.unwrap_or(existing.execs_per_min))
    .bind(max_pending_approvals.unwrap_or(existing.max_pending_approvals))
    .bind(now)
    .bind(&client_id)
    .execute(state.vault.pool())
    .await
    .map_err(db)?;
    Ok(())
}

#[tauri::command]
pub async fn mcp_policy_list(
    state: State<'_, Arc<AppState>>,
    client_id: String,
) -> Result<Vec<Value>, AppError> {
    let rows = mcp::repo::policies::get_policies_for_client(state.vault.pool(), &client_id)
        .await
        .map_err(|e| AppError::Internal { message: e.to_string() })?;

    Ok(rows
        .into_iter()
        .map(|p| {
            json!({
                "id": p.id,
                "clientId": p.client_id,
                "tool": p.tool,
                "tierOverride": p.tier_override,
                "requiresApproval": p.requires_approval,
                "rateLimitPerMin": p.rate_limit_per_min,
                "disabled": p.disabled != 0,
            })
        })
        .collect())
}
