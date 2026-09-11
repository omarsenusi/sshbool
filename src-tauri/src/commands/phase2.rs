//! Phase 2 commands: tunnels, monitoring, docker, AI, recording/sync extras.

use infrastructure::{redact, validate_container_id, validate_safe_remote_path, AppState};
use serde_json::{json, Value};
use std::sync::Arc;
use tauri::State;
use uuid::Uuid;

use crate::error::AppError;
use tauri::Manager;

fn db(e: sqlx::Error) -> AppError {
    AppError::Db {
        engine: "sqlite".into(),
        message: e.to_string(),
    }
}

async fn pick_local_port() -> Result<u16, AppError> {
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
        .await
        .map_err(|e| AppError::Internal {
            message: format!("failed to pick local port for RDP tunnel: {e}"),
        })?;
    let port = listener
        .local_addr()
        .map_err(|e| AppError::Internal {
            message: format!("failed to read local port for RDP tunnel: {e}"),
        })?
        .port();
    Ok(port)
}

async fn resolve_host_vault_password(
    state: &State<'_, Arc<AppState>>,
    host_id: &str,
) -> Option<String> {
    let cred_id = sqlx::query_as::<_, (String,)>("SELECT value FROM settings WHERE key = ?")
        .bind(format!("host:{host_id}:cred"))
        .fetch_optional(state.vault.pool())
        .await
        .ok()?;
    let (cid,) = cred_id?;
    let secret = sqlx::query_as::<_, (Vec<u8>, Vec<u8>)>(
        "SELECT ciphertext, nonce FROM credentials WHERE id = ?",
    )
    .bind(&cid)
    .fetch_optional(state.vault.pool())
    .await
    .ok()?;
    let (ct, nonce) = secret?;
    state
        .vault
        .open_secret(&ct, &nonce, &format!("cred:{cid}"))
        .await
        .ok()
        .map(|plain| String::from_utf8_lossy(&plain).into_owned())
}

// ── Proxies & port forwards ──────────────────────────────────────────

#[tauri::command]
pub async fn proxies_list(state: State<'_, Arc<AppState>>) -> Result<Vec<Value>, AppError> {
    let rows: Vec<(String, String, String, String, i64, Option<String>)> =
        sqlx::query_as("SELECT id, name, kind, host, port, username FROM proxies ORDER BY name")
            .fetch_all(state.vault.pool())
            .await
            .map_err(db)?;
    Ok(rows
        .into_iter()
        .map(|(id, name, kind, host, port, username)| {
            json!({ "id": id, "name": name, "kind": kind, "host": host, "port": port, "username": username })
        })
        .collect())
}

#[tauri::command]
pub async fn proxies_upsert(
    state: State<'_, Arc<AppState>>,
    proxy: Value,
) -> Result<String, AppError> {
    let id = proxy["id"]
        .as_str()
        .map(str::to_string)
        .unwrap_or_else(|| Uuid::now_v7().to_string());
    let now = chrono::Utc::now().timestamp_millis();
    sqlx::query(
        r#"INSERT INTO proxies (id, name, kind, host, port, username, credential_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)
           ON CONFLICT(id) DO UPDATE SET name=excluded.name, kind=excluded.kind, host=excluded.host,
             port=excluded.port, username=excluded.username, updated_at=excluded.updated_at"#,
    )
    .bind(&id)
    .bind(proxy["name"].as_str().unwrap_or("proxy"))
    .bind(proxy["kind"].as_str().unwrap_or("socks5"))
    .bind(proxy["host"].as_str().unwrap_or("127.0.0.1"))
    .bind(proxy["port"].as_i64().unwrap_or(1080))
    .bind(proxy["username"].as_str())
    .bind(now)
    .bind(now)
    .execute(state.vault.pool())
    .await
    .map_err(db)?;
    Ok(id)
}

#[tauri::command]
pub async fn port_forwards_upsert(
    state: State<'_, Arc<AppState>>,
    forward: Value,
) -> Result<String, AppError> {
    let id = forward["id"]
        .as_str()
        .map(str::to_string)
        .unwrap_or_else(|| Uuid::now_v7().to_string());
    let now = chrono::Utc::now().timestamp_millis();
    sqlx::query(
        r#"INSERT INTO port_forwards (id, host_id, kind, bind_addr, bind_port, dest_addr, dest_port, auto_start, label, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET kind=excluded.kind, bind_addr=excluded.bind_addr, bind_port=excluded.bind_port,
             dest_addr=excluded.dest_addr, dest_port=excluded.dest_port, auto_start=excluded.auto_start, label=excluded.label"#,
    )
    .bind(&id)
    .bind(forward["hostId"].as_str().unwrap_or(""))
    .bind(forward["kind"].as_str().unwrap_or("local"))
    .bind(forward["bindAddr"].as_str().unwrap_or("127.0.0.1"))
    .bind(forward["bindPort"].as_i64().unwrap_or(0))
    .bind(forward["destAddr"].as_str())
    .bind(forward["destPort"].as_i64())
    .bind(if forward["autoStart"].as_bool().unwrap_or(false) {
        1
    } else {
        0
    })
    .bind(forward["label"].as_str())
    .bind(now)
    .execute(state.vault.pool())
    .await
    .map_err(db)?;
    Ok(id)
}

#[tauri::command]
pub async fn port_forwards_delete(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<(), AppError> {
    sqlx::query("DELETE FROM port_forwards WHERE id = ?")
        .bind(&id)
        .execute(state.vault.pool())
        .await
        .map_err(db)?;
    Ok(())
}

#[tauri::command]
pub async fn port_forwards_list(
    state: State<'_, Arc<AppState>>,
    host_id: String,
) -> Result<Vec<Value>, AppError> {
    let rows: Vec<(String, String, Option<String>, Option<i64>, Option<String>, Option<i64>, String)> =
        sqlx::query_as(
            "SELECT id, kind, bind_addr, bind_port, dest_addr, dest_port, COALESCE(label,'') FROM port_forwards WHERE host_id = ?",
        )
        .bind(&host_id)
        .fetch_all(state.vault.pool())
        .await
        .map_err(db)?;
    Ok(rows
        .into_iter()
        .map(
            |(id, kind, bind_addr, bind_port, dest_addr, dest_port, label)| {
                json!({
                    "id": id, "kind": kind, "bindAddr": bind_addr, "bindPort": bind_port,
                    "destAddr": dest_addr, "destPort": dest_port, "label": label
                })
            },
        )
        .collect())
}

#[tauri::command]
pub async fn port_forwards_start(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<(), AppError> {
    let row: Option<(String, Option<String>, Option<i64>, Option<String>, Option<i64>)> =
        sqlx::query_as(
            "SELECT host_id, bind_addr, bind_port, dest_addr, dest_port FROM port_forwards WHERE id = ?",
        )
        .bind(&id)
        .fetch_optional(state.vault.pool())
        .await
        .map_err(db)?;
    let Some((host_id, bind_addr, bind_port, dest_addr, dest_port)) = row else {
        return Err(AppError::NotFound {
            entity: "port_forward".into(),
            id: Some(id),
        });
    };
    state
        .connections
        .port_forward_start(
            &id,
            &host_id,
            bind_addr.as_deref().unwrap_or("127.0.0.1"),
            bind_port.unwrap_or(0) as u16,
            dest_addr.as_deref().unwrap_or("127.0.0.1"),
            dest_port.unwrap_or(0) as u16,
        )
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn port_forwards_stop(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<(), AppError> {
    state.connections.port_forward_stop(&id).await?;
    Ok(())
}

#[tauri::command]
pub async fn port_check_available(
    bind_addr: String,
    bind_port: u16,
) -> Result<bool, AppError> {
    match tokio::net::TcpListener::bind((bind_addr.as_str(), bind_port)).await {
        Ok(_) => Ok(true),
        Err(_) => Ok(false),
    }
}


#[tauri::command]
pub async fn auth_fido2_status() -> Result<Value, AppError> {
    Ok(json!({
        "available": false,
        "message": "FIDO2/YubiKey support is stubbed for Phase 2 — password and key auth work today."
    }))
}

#[tauri::command]
pub async fn editor_git_status(
    state: State<'_, Arc<AppState>>,
    host_id: String,
    path: String,
) -> Result<String, AppError> {
    let safe_path = validate_safe_remote_path(&path)?;
    state
        .connections
        .exec_command(
            &host_id,
            &format!("cd {safe_path} 2>/dev/null; git status -sb 2>&1; echo '---'; git diff --stat 2>&1 | head -n 40"),
        )
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn editor_diff(
    state: State<'_, Arc<AppState>>,
    host_id: String,
    path: String,
) -> Result<String, AppError> {
    let safe_path = validate_safe_remote_path(&path)?;
    state
        .connections
        .exec_command(
            &host_id,
            &format!("git diff -- {safe_path} 2>&1 | head -n 500"),
        )
        .await
        .map_err(Into::into)
}

// ── Docker (via remote CLI over SSH) ─────────────────────────────────

#[tauri::command]
pub async fn docker_list_containers(
    state: State<'_, Arc<AppState>>,
    host_id: String,
) -> Result<Vec<Value>, AppError> {
    let out = state
        .connections
        .exec_command(
            &host_id,
            "docker ps -a --format '{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}' 2>&1",
        )
        .await?;
    if out.to_lowercase().contains("permission denied") || out.contains("Cannot connect") {
        return Err(AppError::Connection {
            message: out.lines().next().unwrap_or("docker unavailable").into(),
            retryable: false,
        });
    }
    Ok(out
        .lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|line| {
            let p: Vec<&str> = line.split('\t').collect();
            if p.len() < 4 {
                return None;
            }
            Some(json!({
                "id": p[0], "name": p[1], "image": p[2], "status": p[3],
                "ports": p.get(4).copied().unwrap_or("")
            }))
        })
        .collect())
}

#[tauri::command]
pub async fn docker_container_action(
    state: State<'_, Arc<AppState>>,
    host_id: String,
    container_id: String,
    action: String,
) -> Result<(), AppError> {
    let safe_id = validate_container_id(&container_id)?;
    let cmd = match action.as_str() {
        "start" => format!("docker start {safe_id}"),
        "stop" => format!("docker stop {safe_id}"),
        "restart" => format!("docker restart {safe_id}"),
        "remove" => format!("docker rm -f {safe_id}"),
        _ => {
            return Err(AppError::Validation {
                field: "action".into(),
                message: "start|stop|restart|remove".into(),
            })
        }
    };
    state.connections.exec_command(&host_id, &cmd).await?;
    Ok(())
}

#[tauri::command]
pub async fn docker_list_images(
    state: State<'_, Arc<AppState>>,
    host_id: String,
) -> Result<Vec<Value>, AppError> {
    let out = state
        .connections
        .exec_command(
            &host_id,
            "docker images --format '{{.Repository}}\t{{.Tag}}\t{{.ID}}\t{{.Size}}\t{{.CreatedSince}}'",
        )
        .await?;
    Ok(out
        .lines()
        .filter_map(|line| {
            let p: Vec<&str> = line.split('\t').collect();
            if p.len() < 4 {
                return None;
            }
            Some(json!({
                "repository": p[0], "tag": p[1], "id": p[2], "size": p[3],
                "created": p.get(4).copied().unwrap_or("")
            }))
        })
        .collect())
}

#[tauri::command]
pub async fn docker_logs(
    state: State<'_, Arc<AppState>>,
    host_id: String,
    container_id: String,
    tail: Option<u32>,
) -> Result<String, AppError> {
    let safe_id = validate_container_id(&container_id)?;
    let n = tail.unwrap_or(200).min(5000);
    state
        .connections
        .exec_command(&host_id, &format!("docker logs --tail {n} {safe_id} 2>&1"))
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn docker_compose_action(
    state: State<'_, Arc<AppState>>,
    host_id: String,
    path: String,
    action: String,
) -> Result<String, AppError> {
    let safe_path = validate_safe_remote_path(&path)?;
    let action_str = match action.as_str() {
        "up" => "up -d",
        "down" => "down",
        "restart" => "restart",
        "ps" => "ps",
        _ => {
            return Err(AppError::Validation {
                field: "action".into(),
                message: "up|down|restart|ps".into(),
            })
        }
    };
    state
        .connections
        .exec_command(
            &host_id,
            &format!("docker compose -f {safe_path} {action_str} 2>&1"),
        )
        .await
        .map_err(Into::into)
}

// ── AI Assistant ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn ai_providers_list(state: State<'_, Arc<AppState>>) -> Result<Vec<Value>, AppError> {
    let rows: Vec<(
        String,
        String,
        Option<String>,
        Option<String>,
        Option<String>,
        i64,
    )> = sqlx::query_as(
        "SELECT id, kind, name, base_url, model, enabled FROM ai_providers ORDER BY created_at",
    )
    .fetch_all(state.vault.pool())
    .await
    .map_err(db)?;
    Ok(rows
        .into_iter()
        .map(|(id, kind, name, base_url, model, enabled)| {
            json!({
                "id": id, "kind": kind, "name": name, "baseUrl": base_url,
                "model": model, "enabled": enabled != 0
            })
        })
        .collect())
}

#[tauri::command]
pub async fn ai_providers_upsert(
    state: State<'_, Arc<AppState>>,
    provider: Value,
) -> Result<String, AppError> {
    let id = provider["id"]
        .as_str()
        .map(str::to_string)
        .unwrap_or_else(|| Uuid::now_v7().to_string());
    let now = chrono::Utc::now().timestamp_millis();
    sqlx::query(
        r#"INSERT INTO ai_providers (id, kind, name, base_url, model, credential_id, enabled, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET kind=excluded.kind, name=excluded.name, base_url=excluded.base_url,
             model=excluded.model, enabled=excluded.enabled, updated_at=excluded.updated_at"#,
    )
    .bind(&id)
    .bind(provider["kind"].as_str().unwrap_or("ollama"))
    .bind(provider["name"].as_str())
    .bind(provider["baseUrl"].as_str().unwrap_or("http://127.0.0.1:11434"))
    .bind(provider["model"].as_str().unwrap_or("llama3.2"))
    .bind(provider["credentialId"].as_str())
    .bind(if provider["enabled"].as_bool().unwrap_or(true) {
        1
    } else {
        0
    })
    .bind(now)
    .bind(now)
    .execute(state.vault.pool())
    .await
    .map_err(db)?;
    Ok(id)
}

#[tauri::command]
pub async fn ai_send(
    state: State<'_, Arc<AppState>>,
    message: String,
    system: Option<String>,
    conversation_id: Option<String>,
) -> Result<Value, AppError> {
    let message = redact(&message);
    let system = system.unwrap_or_else(|| {
        "You are SSHBool AI copilot for sysadmins. Be concise. Prefer safe shell commands.".into()
    });

    let row: Option<(String, Option<String>, Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT kind, base_url, model, credential_id FROM ai_providers WHERE enabled = 1 ORDER BY updated_at DESC LIMIT 1",
    )
    .fetch_optional(state.vault.pool())
    .await
    .map_err(db)?;

    let (kind, base_url, model, cred_id) = row.unwrap_or_else(|| {
        (
            "ollama".into(),
            Some("http://127.0.0.1:11434".into()),
            Some("llama3.2".into()),
            None,
        )
    });

    let api_key = if let Some(cid) = cred_id {
        let secret: Option<(Vec<u8>, Vec<u8>)> =
            sqlx::query_as("SELECT ciphertext, nonce FROM credentials WHERE id = ?")
                .bind(&cid)
                .fetch_optional(state.vault.pool())
                .await
                .map_err(db)?;
        if let Some((ct, nonce)) = secret {
            let plain = state
                .vault
                .open_secret(&ct, &nonce, &format!("cred:{cid}"))
                .await?;
            Some(String::from_utf8_lossy(&plain).into_owned())
        } else {
            None
        }
    } else {
        None
    };

    let base = base_url.unwrap_or_else(|| "http://127.0.0.1:11434".into());
    let model = model.unwrap_or_else(|| "llama3.2".into());

    let client = reqwest::Client::new();
    let reply = if kind == "ollama" {
        let url = format!("{}/api/chat", base.trim_end_matches('/'));
        let body = json!({
            "model": model,
            "stream": false,
            "messages": [
                { "role": "system", "content": system },
                { "role": "user", "content": message }
            ]
        });
        let res = client
            .post(url)
            .json(&body)
            .send()
            .await
            .map_err(|e| AppError::Connection {
                message: format!("ollama: {e}"),
                retryable: true,
            })?;
        let v: Value = res.json().await.map_err(|e| AppError::Internal {
            message: e.to_string(),
        })?;
        v["message"]["content"]
            .as_str()
            .unwrap_or("No response from Ollama")
            .to_string()
    } else {
        // OpenAI-compatible
        let url = format!("{}/v1/chat/completions", base.trim_end_matches('/'));
        let mut req = client.post(url).json(&json!({
            "model": model,
            "messages": [
                { "role": "system", "content": system },
                { "role": "user", "content": message }
            ]
        }));
        if let Some(key) = api_key {
            req = req.bearer_auth(key);
        }
        let res = req.send().await.map_err(|e| AppError::Connection {
            message: format!("ai provider: {e}"),
            retryable: true,
        })?;
        let v: Value = res.json().await.map_err(|e| AppError::Internal {
            message: e.to_string(),
        })?;
        v["choices"][0]["message"]["content"]
            .as_str()
            .unwrap_or("No response")
            .to_string()
    };

    let now = chrono::Utc::now().timestamp_millis();
    let conv_id = if let Some(cid) = conversation_id {
        cid
    } else {
        let cid = Uuid::now_v7().to_string();
        sqlx::query(
            "INSERT INTO ai_conversations (id, host_id, title, created_at, updated_at) VALUES (?, NULL, ?, ?, ?)",
        )
        .bind(&cid)
        .bind(message.chars().take(48).collect::<String>())
        .bind(now)
        .bind(now)
        .execute(state.vault.pool())
        .await
        .map_err(db)?;
        cid
    };

    for (role, content) in [("user", message.as_str()), ("assistant", reply.as_str())] {
        let mid = Uuid::now_v7().to_string();
        sqlx::query(
            "INSERT INTO ai_messages (id, conversation_id, role, content, tokens, created_at) VALUES (?, ?, ?, ?, NULL, ?)",
        )
        .bind(&mid)
        .bind(&conv_id)
        .bind(role)
        .bind(content)
        .bind(now)
        .execute(state.vault.pool())
        .await
        .map_err(db)?;
    }

    Ok(json!({ "conversationId": conv_id, "reply": reply }))
}

#[tauri::command]
pub async fn ai_explain_command(
    state: State<'_, Arc<AppState>>,
    command: String,
) -> Result<Value, AppError> {
    ai_send(
        state,
        format!("Explain this Linux/shell command briefly and warn about dangers:\n`{command}`"),
        Some("You explain shell commands for operators.".into()),
        None,
    )
    .await
}

#[tauri::command]
pub async fn ai_generate_command(
    state: State<'_, Arc<AppState>>,
    goal: String,
) -> Result<Value, AppError> {
    ai_send(
        state,
        format!("Generate a safe shell command for: {goal}\nReturn only the command and a one-line explanation."),
        Some("You generate shell commands. Prefer non-destructive flags.".into()),
        None,
    )
    .await
}

// ── Session recording / folder sync stubs (working MVP of Phase 2 extras) ─

#[tauri::command]
pub async fn recording_start(
    state: State<'_, Arc<AppState>>,
    session_id: String,
    pane_id: Option<String>,
) -> Result<String, AppError> {
    let id = Uuid::now_v7().to_string();
    let now = chrono::Utc::now().timestamp_millis();
    let path = format!("recordings/{id}.cast");
    sqlx::query(
        "INSERT INTO recordings (id, session_id, pane_id, path, format, size_bytes, duration_ms, created_at) VALUES (?, ?, ?, ?, 'asciicast-v2', 0, 0, ?)",
    )
    .bind(&id)
    .bind(&session_id)
    .bind(&pane_id)
    .bind(&path)
    .bind(now)
    .execute(state.vault.pool())
    .await
    .map_err(db)?;
    Ok(id)
}

#[tauri::command]
pub async fn recording_stop(state: State<'_, Arc<AppState>>, id: String) -> Result<(), AppError> {
    // Marker stop — bytes are written by terminal event tap in a follow-up.
    let _ =
        sqlx::query("UPDATE recordings SET duration_ms = COALESCE(duration_ms, 0) WHERE id = ?")
            .bind(&id)
            .execute(state.vault.pool())
            .await;
    Ok(())
}

fn validate_local_sandbox(path: &std::path::Path) -> Result<std::path::PathBuf, AppError> {
    let home = dirs::home_dir().ok_or_else(|| AppError::Validation {
        field: "path".into(),
        message: "user home directory not found".into(),
    })?;
    let canonical_home = home.canonicalize().map_err(|e| AppError::Validation {
        field: "path".into(),
        message: format!("failed to canonicalize home directory: {e}"),
    })?;

    let mut check_path = path.to_path_buf();
    while !check_path.exists() {
        if let Some(parent) = check_path.parent() {
            check_path = parent.to_path_buf();
        } else {
            break;
        }
    }

    let canonical_path = check_path
        .canonicalize()
        .map_err(|e| AppError::Validation {
            field: "path".into(),
            message: format!("invalid path: {e}"),
        })?;

    if !canonical_path.starts_with(&canonical_home) {
        return Err(AppError::Validation {
            field: "path".into(),
            message: "path lies outside of the user home directory sandbox".into(),
        });
    }

    Ok(canonical_path)
}

#[tauri::command]
pub async fn folders_compare(
    state: State<'_, Arc<AppState>>,
    host_id: String,
    local_root: String,
    remote_root: String,
) -> Result<Value, AppError> {
    let p_local = std::path::Path::new(&local_root);
    validate_local_sandbox(p_local)?;
    let remote = state
        .connections
        .sftp_list_dir(&host_id, &remote_root)
        .await?;
    let local_entries = std::fs::read_dir(&local_root)
        .map_err(|e| AppError::Io {
            message: e.to_string(),
        })?
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect::<std::collections::HashSet<_>>();

    let remote_names: std::collections::HashSet<_> =
        remote.iter().map(|e| e.name.clone()).collect();
    let only_local: Vec<_> = local_entries.difference(&remote_names).cloned().collect();
    let only_remote: Vec<_> = remote_names.difference(&local_entries).cloned().collect();
    let both: Vec<_> = local_entries.intersection(&remote_names).cloned().collect();
    Ok(json!({
        "onlyLocal": only_local,
        "onlyRemote": only_remote,
        "both": both,
    }))
}

#[tauri::command]
pub async fn rdp_launch_native(
    _app: tauri::AppHandle,
    state: State<'_, Arc<AppState>>,
    host_id: Option<String>,
    host: String,
    port: u16,
    username: Option<String>,
    password: Option<String>,
    domain: Option<String>,
    share_clipboard: Option<bool>,
    smart_sizing: Option<bool>,
    admin_mode: Option<bool>,
    full_screen: Option<bool>,
    width: Option<u32>,
    height: Option<u32>,
    color_depth: Option<u32>,
    performance: Option<String>,
    use_ssh_credentials: Option<bool>,
) -> Result<Value, AppError> {
    let u = username.unwrap_or_default();
    let d = domain.unwrap_or_default();
    let use_ssh = use_ssh_credentials.unwrap_or(true);
    let hid = host_id.ok_or(AppError::Validation {
        field: "hostId".into(),
        message: "hostId is required to establish the SSH RDP tunnel".into(),
    })?;

    let mut p = password.as_deref().unwrap_or("").to_string();
    if p == "••••••••" || (use_ssh && p.is_empty()) {
        tracing::info!("RDP Launch: Resolving vault password for host_id = {}", hid);
        if let Some(vault_pass) = resolve_host_vault_password(&state, &hid).await {
            p = vault_pass;
            tracing::info!(
                "RDP Launch: Successfully decrypted password from vault (len={})",
                p.len()
            );
        } else {
            tracing::warn!("RDP Launch: No vault password found for host {}", hid);
        }
    }

    if use_ssh && p.is_empty() {
        return Err(AppError::Validation {
            field: "password".into(),
            message: "No SSH password saved for this host. Add a password in host settings or turn off “Use SSH credentials” and enter RDP credentials manually.".into(),
        });
    }

    let remote_dest = if host.is_empty() || host == "localhost" {
        "127.0.0.1".to_string()
    } else {
        host.clone()
    };

    match state
        .connections
        .probe_remote_tcp(&hid, &remote_dest, port)
        .await
    {
        Ok(true) => tracing::info!(
            "RDP Launch: remote {remote_dest}:{port} is reachable on SSH host {hid}"
        ),
        Ok(false) => {
            return Err(AppError::Internal {
                message: format!(
                    "No RDP service is listening on {remote_dest}:{port} on the SSH host. \
                     On Linux install/start xRDP (sudo apt install xrdp && sudo systemctl enable --now xrdp). \
                     On Windows enable Remote Desktop."
                ),
            });
        }
        Err(e) => tracing::warn!("RDP Launch: remote port probe failed: {e}"),
    }

    let tunnel_forward_id = format!("rdp-tunnel-{hid}");
    let local_port = if state.connections.forward_is_active(&tunnel_forward_id).await {
        if let Some(existing) = state
            .connections
            .forward_local_port(&tunnel_forward_id)
            .await
        {
            tracing::info!(
                "RDP Launch: reusing active tunnel on 127.0.0.1:{existing} -> {remote_dest}:{port}"
            );
            existing
        } else {
            let _ = state.connections.port_forward_stop(&tunnel_forward_id).await;
            let picked = pick_local_port().await?;
            state
                .connections
                .port_forward_start(
                    &tunnel_forward_id,
                    &hid,
                    "127.0.0.1",
                    picked,
                    &remote_dest,
                    port,
                )
                .await?;
            picked
        }
    } else {
        let _ = state.connections.port_forward_stop(&tunnel_forward_id).await;
        let picked = pick_local_port().await?;
        state
            .connections
            .port_forward_start(
                &tunnel_forward_id,
                &hid,
                "127.0.0.1",
                picked,
                &remote_dest,
                port,
            )
            .await?;
        picked
    };

    tokio::time::sleep(std::time::Duration::from_millis(1200)).await;

    let connect_host = "127.0.0.1";
    #[cfg(not(target_os = "windows"))]
    let rdp_client = "native";
    #[cfg(target_os = "windows")]
    let (rdp_client, freerdp_fallback) = {
        let w = width.unwrap_or(1920);
        let h = height.unwrap_or(1080);
        let bpp = color_depth.unwrap_or(32);
        let perf_str = performance.as_deref().unwrap_or("auto");
        let connection_val = match perf_str {
            "modem" => 1,
            "broadband" => 2,
            "lan" => 5,
            _ => 6,
        };
        let mstsc_opts = crate::rdp_windows::MstscLaunchOpts {
            connect_host,
            local_port,
            username: &u,
            password: &p,
            domain: &d,
            share_clipboard: share_clipboard.unwrap_or(true),
            smart_sizing: smart_sizing.unwrap_or(true),
            admin_mode: admin_mode.unwrap_or(false),
            full_screen: full_screen.unwrap_or(false),
            width: w,
            height: h,
            color_depth: bpp,
            connection_type: connection_val,
        };

        crate::rdp_windows::launch_mstsc(&mstsc_opts)
            .map_err(|message| AppError::Internal { message })?;
        ("mstsc", false)
    };

    #[cfg(target_os = "macos")]
    {
        let connect_addr = format!("{connect_host}:{local_port}");
        use std::io::Write;
        use std::process::Command;

        let clipboard_val = if share_clipboard.unwrap_or(true) {
            1
        } else {
            0
        };
        let sizing_val = if smart_sizing.unwrap_or(true) { 1 } else { 0 };
        let admin_val = if admin_mode.unwrap_or(false) { 1 } else { 0 };
        let screen_mode_val = if full_screen.unwrap_or(false) { 2 } else { 1 };

        let w = width.unwrap_or(1920);
        let h = height.unwrap_or(1080);
        let bpp = color_depth.unwrap_or(32);

        let rdp_content = format!(
            "full address:s:{connect_addr}\r\n\
             username:s:{u}\r\n\
             prompt for credentials:i:0\r\n\
             authentication level:i:0\r\n\
             redirectclipboard:i:{clipboard_val}\r\n\
             smart sizing:i:{sizing_val}\r\n\
             administrative session:i:{admin_val}\r\n\
             screen mode id:i:{screen_mode_val}\r\n\
             desktopwidth:i:{w}\r\n\
             desktopheight:i:{h}\r\n\
             session bpp:i:{bpp}\r\n"
        );

        let temp_file_name = format!(".sshbool_rdp_{}.rdp", Uuid::now_v7());
        let temp_path = std::env::temp_dir().join(&temp_file_name);
        if let Ok(mut file) = std::fs::File::create(&temp_path) {
            let _ = file.write_all(rdp_content.as_bytes());
            let _ = Command::new("open").arg(&temp_path).spawn();
        } else {
            let url = format!(
                "rdp://full%20address=s:{connect_addr}&username=s:{u}&redirectclipboard=i:{clipboard_val}&smartsizing=i:{sizing_val}&desktopwidth=i:{w}&desktopheight=i:{h}&bpp=i:{bpp}"
            );
            let _ = Command::new("open").arg(&url).spawn();
        }
    }

    #[cfg(target_os = "linux")]
    {
        let connect_addr = format!("{connect_host}:{local_port}");
        use std::io::Write;
        use std::process::Command;

        let is_wayland = std::env::var("XDG_SESSION_TYPE")
            .map(|v| v.to_lowercase() == "wayland")
            .unwrap_or(false)
            || std::env::var("WAYLAND_DISPLAY").is_ok();

        let w = width.unwrap_or(1920);
        let h = height.unwrap_or(1080);
        let bpp = color_depth.unwrap_or(32);
        let perf_str = performance.as_deref().unwrap_or("auto");
        let _connection_val = match perf_str {
            "modem" => 1,
            "broadband" => 2,
            "lan" => 5,
            _ => 6, // auto
        };

        let has_pass = !p.is_empty();

        let mut args = vec![
            format!("/v:{connect_addr}"),
            format!("/u:{u}"),
            "/cert:tofu".to_string(),
        ];
        if has_pass {
            args.push("/from-stdin:force".to_string());
        }
        if share_clipboard.unwrap_or(true) {
            args.push("+clipboard".to_string());
        } else {
            args.push("-clipboard".to_string());
        }
        if smart_sizing.unwrap_or(true) {
            args.push("/smart-sizing".to_string());
        }
        if admin_mode.unwrap_or(false) {
            args.push("/admin".to_string());
        }
        if full_screen.unwrap_or(false) {
            args.push("/f".to_string());
        } else if width.is_some() || height.is_some() {
            args.push(format!("/size:{w}x{h}"));
        }
        args.push(format!("/bpp:{bpp}"));
        let mut spawned = false;
        let mut last_error_msg = String::new();

        // 1. Try Wayland native client if running in Wayland session
        if is_wayland {
            let mut cmd = Command::new("wlfreerdp");
            cmd.args(&args);
            if has_pass {
                cmd.stdin(std::process::Stdio::piped());
            }
            match cmd.spawn() {
                Ok(mut child) => {
                    spawned = true;
                    if has_pass {
                        let p_clone = p.clone();
                        std::thread::spawn(move || {
                            if let Some(mut stdin) = child.stdin.take() {
                                let _ = stdin.write_all(p_clone.as_bytes());
                                let _ = stdin.flush();
                            }
                            let _ = child.wait();
                        });
                    }
                }
                Err(e) => {
                    last_error_msg = e.to_string();
                }
            }
        }

        // 2. Fallback to X11 client (xfreerdp)
        if !spawned {
            let mut cmd = Command::new("xfreerdp");
            cmd.args(&args);
            if has_pass {
                cmd.stdin(std::process::Stdio::piped());
            }
            match cmd.spawn() {
                Ok(mut child) => {
                    spawned = true;
                    if has_pass {
                        let p_clone = p.clone();
                        std::thread::spawn(move || {
                            if let Some(mut stdin) = child.stdin.take() {
                                let _ = stdin.write_all(p_clone.as_bytes());
                                let _ = stdin.flush();
                            }
                            let _ = child.wait();
                        });
                    }
                }
                Err(e) => {
                    last_error_msg = e.to_string();
                }
            }
        }

        if !spawned {
            let msg = if is_wayland {
                format!(
                    "RDP client not found (tried wlfreerdp and xfreerdp). \
                     Please install FreeRDP to connect. Since you are on Wayland, you can run:\n\
                     'sudo apt install freerdp2-wayland' (for native wlfreerdp)\n\
                     or 'sudo apt install freerdp2-x11' (for xfreerdp via XWayland).\n\
                     Details: {last_error_msg}"
                )
            } else {
                format!(
                    "RDP client 'xfreerdp' not found in PATH. Please install FreeRDP to connect, e.g. run:\n\
                     'sudo apt install freerdp2-x11' or 'sudo apt install freerdp3-x11'.\n\
                     Details: {last_error_msg}"
                )
            };
            return Err(AppError::Internal { message: msg });
        }
    }

    #[cfg(not(target_os = "windows"))]
    let freerdp_fallback = false;

    Ok(json!({
        "localHost": connect_host,
        "localPort": local_port,
        "remoteHost": remote_dest,
        "remotePort": port,
        "forwardId": tunnel_forward_id,
        "rdpClient": rdp_client,
        "autoLogin": use_ssh && !p.is_empty(),
        "freerdpFallback": freerdp_fallback,
    }))
}

#[tauri::command]
pub async fn workspace_window_open(
    app: tauri::AppHandle,
    ws_id: String,
    title: String,
) -> Result<(), AppError> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let label = format!("ws_win_{ws_id}_{now}");
    let url_str = format!("index.html?wsId={ws_id}");
    let url = tauri::WebviewUrl::App(url_str.into());

    let _ = tauri::WebviewWindowBuilder::new(&app, &label, url)
        .title(&title)
        .inner_size(1200.0, 800.0)
        .decorations(false)
        .shadow(true)
        .build();

    Ok(())
}

#[tauri::command]
pub async fn window_minimize(window: tauri::Window) -> Result<(), AppError> {
    let _ = window.minimize();
    Ok(())
}

#[tauri::command]
pub async fn window_toggle_maximize(window: tauri::Window) -> Result<(), AppError> {
    if window.is_maximized().unwrap_or(false) {
        let _ = window.unmaximize();
    } else {
        let _ = window.maximize();
    }
    Ok(())
}

#[tauri::command]
pub async fn window_close(window: tauri::Window) -> Result<(), AppError> {
    let _ = window.close();
    Ok(())
}

#[tauri::command]
pub async fn window_toggle_pin(window: tauri::Window) -> Result<bool, AppError> {
    let current = window.is_always_on_top().unwrap_or(false);
    let next = !current;
    let _ = window.set_always_on_top(next);
    Ok(next)
}

/// Returns active SSH sessions + workspaces for the system tray popup.
#[tauri::command]
pub async fn tray_get_data(state: State<'_, Arc<AppState>>) -> Result<Value, AppError> {
    // Active sessions
    let sessions = state.connections.sessions_list().await;
    let sessions_json: Vec<Value> = sessions
        .into_iter()
        .map(|(pane_id, session_id, host_id, title)| {
            json!({
                "paneId": pane_id,
                "sessionId": session_id,
                "hostId": host_id,
                "title": title,
            })
        })
        .collect();

    // Hosts info for each active session (label + workspace_id)
    let pool = state.vault.pool();
    let mut enriched: Vec<Value> = Vec::new();
    for s in &sessions_json {
        let host_id = s["hostId"].as_str().unwrap_or("");
        let row: Option<(String, Option<String>)> =
            sqlx::query_as("SELECT label, workspace_id FROM hosts WHERE id = ?")
                .bind(host_id)
                .fetch_optional(pool)
                .await
                .unwrap_or(None);
        let mut entry = s.clone();
        if let Some((label, ws_id)) = row {
            entry["label"] = json!(label);
            entry["workspaceId"] = json!(ws_id.unwrap_or_default());
        }
        enriched.push(entry);
    }

    Ok(json!({ "sessions": enriched }))
}

/// Opens a workspace window and optionally highlights a specific host.
#[tauri::command]
pub async fn workspace_window_open_with_host(
    app: tauri::AppHandle,
    ws_id: String,
    host_id: Option<String>,
    title: String,
) -> Result<(), AppError> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let label = format!("ws_win_{ws_id}_{now}");
    let mut url_str = format!("index.html?wsId={ws_id}");
    if let Some(hid) = host_id {
        url_str.push_str(&format!("&focusHost={hid}"));
    }
    let url = tauri::WebviewUrl::App(url_str.into());

    let _ = tauri::WebviewWindowBuilder::new(&app, &label, url)
        .title(&title)
        .inner_size(1200.0, 800.0)
        .decorations(false)
        .shadow(true)
        .build();

    Ok(())
}

/// Quit the entire application (used from system tray popup).
#[tauri::command]
pub async fn app_quit(app: tauri::AppHandle) -> Result<(), AppError> {
    app.exit(0);
    Ok(())
}

/// Explicitly close/destroy the tray popup window.
#[tauri::command]
pub async fn tray_close(app: tauri::AppHandle) -> Result<(), AppError> {
    if let Some(win) = app.get_webview_window("tray_popup") {
        let _ = win.close();
    }
    Ok(())
}

async fn ensure_desktop_tunnel(
    state: &State<'_, Arc<AppState>>,
    host_id: &str,
    dest_host: &str,
    remote_port: u16,
) -> Result<u16, AppError> {
    let tunnel_id = format!("inapp-desktop-tunnel-{host_id}");

    let local_tcp_port = if state.connections.forward_is_active(&tunnel_id).await {
        if let Some(existing) = state.connections.forward_local_port(&tunnel_id).await {
            existing
        } else {
            let _ = state.connections.port_forward_stop(&tunnel_id).await;
            let picked = pick_local_port().await?;
            state
                .connections
                .port_forward_start(
                    &tunnel_id,
                    host_id,
                    "127.0.0.1",
                    picked,
                    dest_host,
                    remote_port,
                )
                .await?;
            picked
        }
    } else {
        let _ = state.connections.port_forward_stop(&tunnel_id).await;
        let picked = pick_local_port().await?;
        state
            .connections
            .port_forward_start(
                &tunnel_id,
                host_id,
                "127.0.0.1",
                picked,
                dest_host,
                remote_port,
            )
            .await?;
        picked
    };

    tokio::time::sleep(std::time::Duration::from_millis(600)).await;
    Ok(local_tcp_port)
}

/// Connect to in-app VNC desktop via local WebSocket-to-SSH bridge (noVNC).
#[tauri::command]
pub async fn desktop_inapp_connect(
    state: State<'_, Arc<AppState>>,
    host_id: String,
    remote_target: String,
    remote_port: u16,
    protocol: Option<String>,
) -> Result<Value, AppError> {
    let dest_host = if remote_target.is_empty() || remote_target == "localhost" {
        "127.0.0.1".to_string()
    } else {
        remote_target
    };

    let local_tcp_port =
        ensure_desktop_tunnel(&state, &host_id, &dest_host, remote_port).await?;

    let session_id = format!("{host_id}-{remote_port}");
    let proto = protocol.unwrap_or_else(|| "vnc".into());

    let ws_port = crate::desktop_bridge::DESKTOP_BRIDGES
        .start_vnc(session_id.clone(), local_tcp_port)
        .await
        .map_err(|e| AppError::Internal { message: e })?;

    let vault_pass = resolve_host_vault_password(&state, &host_id)
        .await
        .unwrap_or_default();

    Ok(json!({
        "sessionId": session_id,
        "wsPort": ws_port,
        "wsUrl": format!("ws://127.0.0.1:{ws_port}"),
        "localTcpPort": local_tcp_port,
        "remoteHost": dest_host,
        "remotePort": remote_port,
        "protocol": proto,
        "vaultPassword": vault_pass,
    }))
}

/// Connect to in-app RDP via Guacamole + guacd (credentials stay in Rust token).
#[tauri::command]
pub async fn desktop_guacamole_connect(
    app: tauri::AppHandle,
    state: State<'_, Arc<AppState>>,
    host_id: String,
    remote_target: String,
    remote_port: u16,
    username: Option<String>,
    password: Option<String>,
    domain: Option<String>,
    use_ssh_credentials: Option<bool>,
    width: Option<u32>,
    height: Option<u32>,
    color_depth: Option<u32>,
    performance: Option<String>,
) -> Result<Value, AppError> {
    let use_ssh = use_ssh_credentials.unwrap_or(true);
    let dest_host = if remote_target.is_empty() || remote_target == "localhost" {
        "127.0.0.1".to_string()
    } else {
        remote_target
    };

    let host_row: Option<(Option<String>,)> =
        sqlx::query_as("SELECT username FROM hosts WHERE id = ?")
            .bind(&host_id)
            .fetch_optional(state.vault.pool())
            .await
            .ok()
            .flatten();

    let vault_user = host_row.and_then(|r| r.0).unwrap_or_default();

    let mut u = username.unwrap_or_default();
    if u.is_empty() && use_ssh {
        u = vault_user.clone();
    }

    let vault_pass = resolve_host_vault_password(&state, &host_id).await;
    let p = crate::rdp_credentials::resolve_rdp_password(
        &password.unwrap_or_default(),
        use_ssh,
        vault_pass.as_deref(),
    );

    if use_ssh && p.is_empty() {
        return Err(AppError::Validation {
            field: "password".into(),
            message: "No SSH password saved for this host. Add a password in host settings or enter RDP credentials manually.".into(),
        });
    }

    if u.is_empty() {
        return Err(AppError::Validation {
            field: "username".into(),
            message: "RDP username is required.".into(),
        });
    }

    crate::guacd_manager::ensure_guacd_running(Some(&app))
        .await
        .map_err(|message| AppError::Internal { message })?;

    let local_tcp_port =
        ensure_desktop_tunnel(&state, &host_id, &dest_host, remote_port).await?;

    let session_id = format!("{host_id}-{remote_port}");
    let ws_port = crate::desktop_bridge::DESKTOP_BRIDGES
        .start_guacamole(session_id.clone())
        .await
        .map_err(|e| AppError::Internal { message: e })?;

    let w = width.unwrap_or(1280);
    let h = height.unwrap_or(720);
    let bpp = color_depth.unwrap_or(32);
    let perf = performance.unwrap_or_else(|| "auto".into());

    let token = crate::guacamole_token::build_rdp_token(
        "127.0.0.1",
        local_tcp_port,
        &u,
        &p,
        domain.as_deref(),
        w,
        h,
        bpp,
        &perf,
    )
    .map_err(|message| AppError::Internal { message })?;

    Ok(json!({
        "sessionId": session_id,
        "wsPort": ws_port,
        "wsUrl": format!("ws://127.0.0.1:{ws_port}"),
        "token": token,
        "localTcpPort": local_tcp_port,
        "remoteHost": dest_host,
        "remotePort": remote_port,
        "protocol": "rdp",
        "username": u,
    }))
}

/// Install/start guacd (Docker container or bundled binary).
#[tauri::command]
pub async fn desktop_guacd_setup(
    app: tauri::AppHandle,
    install_docker: Option<bool>,
) -> Result<Value, AppError> {
    let install = install_docker.unwrap_or(false);
    let message = crate::guacd_manager::provision_guacd_bundle(Some(&app), install)
        .map_err(|e| AppError::Internal { message: e })?;

    if !install {
        crate::guacd_manager::ensure_guacd_running(Some(&app))
            .await
            .map_err(|e| AppError::Internal { message: e })?;
    }

    Ok(json!({ "ok": true, "message": message }))
}

/// Disconnect in-app desktop bridge and stop tunnel.
#[tauri::command]
pub async fn desktop_inapp_disconnect(
    state: State<'_, Arc<AppState>>,
    host_id: String,
    remote_port: Option<u16>,
) -> Result<(), AppError> {
    let port = remote_port.unwrap_or(5900);
    let session_id = format!("{host_id}-{port}");
    crate::desktop_bridge::DESKTOP_BRIDGES.stop(&session_id).await;

    let tunnel_id = format!("inapp-desktop-tunnel-{host_id}");
    let _ = state.connections.port_forward_stop(&tunnel_id).await;
    Ok(())
}
