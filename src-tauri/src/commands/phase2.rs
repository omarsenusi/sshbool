//! Phase 2 commands: tunnels, monitoring, docker, AI, recording/sync extras.

use infrastructure::AppState;
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
    let dir = if path.ends_with('/') {
        path.trim_end_matches('/').to_string()
    } else if let Some(i) = path.rfind('/') {
        path[..i].to_string()
    } else {
        ".".into()
    };
    state
        .connections
        .exec_command(
            &host_id,
            &format!("cd {dir} 2>/dev/null; git status -sb 2>&1; echo '---'; git diff --stat 2>&1 | head -n 40"),
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
    state
        .connections
        .exec_command(&host_id, &format!("git diff -- {path} 2>&1 | head -n 500"))
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
    let cmd = match action.as_str() {
        "start" => format!("docker start {container_id}"),
        "stop" => format!("docker stop {container_id}"),
        "restart" => format!("docker restart {container_id}"),
        "remove" => format!("docker rm -f {container_id}"),
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
    let n = tail.unwrap_or(200);
    state
        .connections
        .exec_command(
            &host_id,
            &format!("docker logs --tail {n} {container_id} 2>&1"),
        )
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
    let action = match action.as_str() {
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
            &format!("cd $(dirname {path}) && docker compose -f $(basename {path}) {action} 2>&1"),
        )
        .await
        .map_err(Into::into)
}

// ── AI Assistant ─────────────────────────────────────────────────────

fn redact(text: &str) -> String {
    let mut out = text.to_string();
    for pat in [
        r"(?i)password\s*[:=]\s*\S+",
        r"(?i)api[_-]?key\s*[:=]\s*\S+",
        r"-----BEGIN[^-]+PRIVATE KEY-----[\s\S]*?-----END[^-]+PRIVATE KEY-----",
        r"(?i)Bearer\s+[A-Za-z0-9\-._~+/]+=*",
    ] {
        if let Ok(re) = regex::Regex::new(pat) {
            out = re.replace_all(&out, "[REDACTED]").into_owned();
        }
    }
    out
}

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

#[tauri::command]
pub async fn folders_compare(
    state: State<'_, Arc<AppState>>,
    host_id: String,
    local_root: String,
    remote_root: String,
) -> Result<Value, AppError> {
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
    host: String,
    port: u16,
    username: Option<String>,
    password: Option<String>,
    share_clipboard: Option<bool>,
    smart_sizing: Option<bool>,
    admin_mode: Option<bool>,
    full_screen: Option<bool>,
    width: Option<u32>,
    height: Option<u32>,
    color_depth: Option<u32>,
    performance: Option<String>,
) -> Result<(), AppError> {
    let u = username.unwrap_or_default();
    let p = password.unwrap_or_default();
    let addr = format!("{host}:{port}");

    #[cfg(target_os = "windows")]
    {
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
        let perf_str = performance.as_deref().unwrap_or("auto");
        let connection_val = match perf_str {
            "modem" => 1,
            "broadband" => 2,
            "lan" => 5,
            _ => 6, // auto
        };

        // 1. Store credentials into Windows Credential Manager via cmdkey so mstsc auto-logins!
        if !u.is_empty() && !p.is_empty() {
            let _ = Command::new("cmdkey")
                .args([
                    &format!("/generic:TERMSRV/{host}"),
                    &format!("/user:{u}"),
                    &format!("/pass:{p}"),
                ])
                .status();

            let _ = Command::new("cmdkey")
                .args([
                    &format!("/generic:TERMSRV/{addr}"),
                    &format!("/user:{u}"),
                    &format!("/pass:{p}"),
                ])
                .status();
        }

        // 2. Generate temporary .rdp file applying all exact profile override toggles!
        let rdp_content = format!(
            "full address:s:{addr}\r\n\
             username:s:{u}\r\n\
             prompt for credentials:i:0\r\n\
             authentication level:i:2\r\n\
             redirectclipboard:i:{clipboard_val}\r\n\
             smart sizing:i:{sizing_val}\r\n\
             administrative session:i:{admin_val}\r\n\
             screen mode id:i:{screen_mode_val}\r\n\
             desktopwidth:i:{w}\r\n\
             desktopheight:i:{h}\r\n\
             session bpp:i:{bpp}\r\n\
             connection type:i:{connection_val}\r\n"
        );

        let temp_path = std::env::temp_dir().join("sshbool_remote_desktop.rdp");
        if let Ok(mut file) = std::fs::File::create(&temp_path) {
            let _ = file.write_all(rdp_content.as_bytes());

            let mut args = vec!["/c", "start", "mstsc.exe", temp_path.to_str().unwrap_or("")];
            if admin_mode.unwrap_or(false) {
                args.push("/admin");
            }
            if full_screen.unwrap_or(false) {
                args.push("/f");
            }

            let _ = Command::new("cmd").args(args).spawn();
        } else {
            let mut args = vec!["/c", "start", "mstsc.exe", "/v:", &addr];
            if admin_mode.unwrap_or(false) {
                args.push("/admin");
            }
            if full_screen.unwrap_or(false) {
                args.push("/f");
            }
            let _ = Command::new("cmd").args(args).spawn();
        }
    }

    #[cfg(target_os = "macos")]
    {
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
            "full address:s:{addr}\r\n\
             username:s:{u}\r\n\
             prompt for credentials:i:0\r\n\
             authentication level:i:2\r\n\
             redirectclipboard:i:{clipboard_val}\r\n\
             smart sizing:i:{sizing_val}\r\n\
             administrative session:i:{admin_val}\r\n\
             screen mode id:i:{screen_mode_val}\r\n\
             desktopwidth:i:{w}\r\n\
             desktopheight:i:{h}\r\n\
             session bpp:i:{bpp}\r\n"
        );

        let temp_path = std::env::temp_dir().join("sshbool_remote_desktop.rdp");
        if let Ok(mut file) = std::fs::File::create(&temp_path) {
            let _ = file.write_all(rdp_content.as_bytes());
            let _ = Command::new("open").arg(&temp_path).spawn();
        } else {
            let url = format!(
                "rdp://full%20address=s:{addr}&username=s:{u}&redirectclipboard=i:{clipboard_val}&smartsizing=i:{sizing_val}&desktopwidth=i:{w}&desktopheight=i:{h}&bpp=i:{bpp}"
            );
            let _ = Command::new("open").arg(&url).spawn();
        }
    }

    #[cfg(target_os = "linux")]
    {
        use std::process::Command;

        let is_wayland = std::env::var("XDG_SESSION_TYPE")
            .map(|v| v.to_lowercase() == "wayland")
            .unwrap_or(false)
            || std::env::var("WAYLAND_DISPLAY").is_ok();

        let w = width.unwrap_or(1920);
        let h = height.unwrap_or(1080);
        let bpp = color_depth.unwrap_or(32);
        let perf_str = performance.as_deref().unwrap_or("auto");

        let mut args = vec![
            format!("/v:{addr}"),
            format!("/u:{u}"),
            format!("/p:{p}"),
            "/cert-ignore".to_string(),
        ];
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
        } else {
            args.push(format!("/size:{w}x{h}"));
        }
        args.push(format!("/bpp:{bpp}"));
        args.push(format!("/network:{perf_str}"));

        let mut spawned = false;
        let mut last_error_msg = String::new();

        // 1. Try Wayland native client if running in Wayland session
        if is_wayland {
            let mut cmd = Command::new("wlfreerdp");
            cmd.args(&args);
            match cmd.spawn() {
                Ok(_) => {
                    spawned = true;
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
            match cmd.spawn() {
                Ok(_) => {
                    spawned = true;
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

    Ok(())
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
