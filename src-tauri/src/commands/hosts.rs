//! Host / group / known_hosts / session_open commands.

use application::{GroupDto, HostDto, HostSummaryDto, HostTreeNode, NewHostDto};
use infrastructure::AppState;
use std::sync::Arc;
use tauri::State;
use uuid::Uuid;

use crate::error::AppError;

#[derive(Debug, Clone, sqlx::FromRow)]
struct HostRow {
    id: String,
    group_id: Option<String>,
    label: String,
    hostname: String,
    port: i64,
    username: Option<String>,
    auth_method: String,
    identity_id: Option<String>,
    color: Option<String>,
    icon: Option<String>,
    is_favorite: i64,
    is_pinned: i64,
    notes: Option<String>,
    last_connected_at: Option<i64>,
    connect_count: i64,
    jump_host_id: Option<String>,
    proxy_id: Option<String>,
}

fn host_from_row(h: HostRow) -> HostDto {
    map_host(
        h.id,
        h.group_id,
        h.label,
        h.hostname,
        h.port,
        h.username,
        h.auth_method,
        h.identity_id,
        h.color,
        h.icon,
        h.is_favorite,
        h.is_pinned,
        h.notes,
        h.last_connected_at,
        h.connect_count,
        h.jump_host_id,
        h.proxy_id,
    )
}

fn map_host(
    id: String,
    group_id: Option<String>,
    label: String,
    hostname: String,
    port: i64,
    username: Option<String>,
    auth_method: String,
    identity_id: Option<String>,
    color: Option<String>,
    icon: Option<String>,
    is_favorite: i64,
    is_pinned: i64,
    notes: Option<String>,
    last_connected_at: Option<i64>,
    connect_count: i64,
    jump_host_id: Option<String>,
    proxy_id: Option<String>,
) -> HostDto {
    HostDto {
        id,
        group_id,
        label,
        hostname,
        port: port as u16,
        username,
        auth_method,
        identity_id,
        color,
        icon,
        is_favorite: is_favorite != 0,
        is_pinned: is_pinned != 0,
        notes,
        last_connected_at,
        connect_count,
        jump_host_id,
        proxy_id,
    }
}

async fn resolve_ssh_key_id(
    pool: &sqlx::SqlitePool,
    auth_method: &str,
    ssh_key_id: Option<String>,
) -> Result<Option<String>, AppError> {
    if auth_method != "key" {
        return Ok(None);
    }
    let needs_auto = match ssh_key_id.as_deref() {
        None | Some("") | Some("auto") => true,
        Some(_) => false,
    };
    if !needs_auto {
        // Verify the key exists so we don't bind a dangling settings value
        let id = ssh_key_id.expect("checked");
        let exists: Option<(String,)> = sqlx::query_as("SELECT id FROM ssh_keys WHERE id = ?")
            .bind(&id)
            .fetch_optional(pool)
            .await
            .map_err(db)?;
        if exists.is_none() {
            return Err(AppError::Validation {
                field: "sshKeyId".into(),
                message: "Selected SSH key was not found in the vault".into(),
            });
        }
        return Ok(Some(id));
    }
    let row: Option<(String,)> =
        sqlx::query_as("SELECT id FROM ssh_keys ORDER BY created_at DESC LIMIT 1")
            .fetch_optional(pool)
            .await
            .map_err(db)?;
    match row {
        Some((id,)) => Ok(Some(id)),
        None => Err(AppError::Validation {
            field: "sshKeyId".into(),
            message: "No SSH keys in vault — import or generate a key first, or pick Auto after adding one"
                .into(),
        }),
    }
}

#[tauri::command]
pub async fn hosts_list_tree(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<HostTreeNode>, AppError> {
    let groups: Vec<(
        String,
        Option<String>,
        String,
        Option<String>,
        Option<String>,
        i64,
    )> = sqlx::query_as(
        "SELECT id, parent_id, name, color, icon, sort_order FROM groups ORDER BY sort_order, name",
    )
    .fetch_all(state.vault.pool())
    .await
    .map_err(db)?;

    let hosts: Vec<HostRow> = sqlx::query_as(
        r#"SELECT id, group_id, label, hostname, port, username, auth_method, identity_id, color, icon,
           is_favorite, is_pinned, notes, last_connected_at, connect_count, jump_host_id, proxy_id
           FROM hosts WHERE deleted_at IS NULL ORDER BY is_pinned DESC, label"#,
    )
    .fetch_all(state.vault.pool())
    .await
    .map_err(db)?;

    let mut nodes: Vec<HostTreeNode> = groups
        .into_iter()
        .map(
            |(id, parent_id, name, color, icon, sort_order)| HostTreeNode::Group {
                group: GroupDto {
                    id: id.clone(),
                    parent_id,
                    name,
                    color,
                    icon,
                    sort_order,
                },
                children: hosts
                    .iter()
                    .filter(|h| h.group_id.as_deref() == Some(id.as_str()))
                    .cloned()
                    .map(|h| HostTreeNode::Host {
                        host: host_from_row(h),
                    })
                    .collect(),
            },
        )
        .collect();

    // Ungrouped hosts
    for h in hosts.into_iter().filter(|h| h.group_id.is_none()) {
        nodes.push(HostTreeNode::Host {
            host: host_from_row(h),
        });
    }
    Ok(nodes)
}

#[tauri::command]
pub async fn hosts_get(state: State<'_, Arc<AppState>>, id: String) -> Result<HostDto, AppError> {
    let row: Option<HostRow> = sqlx::query_as(
        r#"SELECT id, group_id, label, hostname, port, username, auth_method, identity_id, color, icon,
           is_favorite, is_pinned, notes, last_connected_at, connect_count, jump_host_id, proxy_id FROM hosts WHERE id = ?"#,
    )
    .bind(&id)
    .fetch_optional(state.vault.pool())
    .await
    .map_err(db)?;
    let Some(h) = row else {
        return Err(AppError::NotFound {
            entity: "host".into(),
            id: Some(id),
        });
    };
    Ok(host_from_row(h))
}

#[tauri::command]
pub async fn hosts_create(
    state: State<'_, Arc<AppState>>,
    host: NewHostDto,
) -> Result<String, AppError> {
    crate::commands::license::assert_can_add_host(&state).await?;
    let id = Uuid::now_v7().to_string();
    let now = chrono::Utc::now().timestamp_millis();
    let resolved_key =
        resolve_ssh_key_id(state.vault.pool(), &host.auth_method, host.ssh_key_id.clone()).await?;
    // identity_id references identities(id) — never store an ssh_keys id here.
    // SSH keys are bound via settings key host:{id}:ssh_key.
    sqlx::query(
        r#"INSERT INTO hosts
        (id, group_id, label, hostname, port, username, identity_id, auth_method, jump_host_id, proxy_id, use_compression, connection_sharing, color, icon, is_favorite, is_pinned, notes, connect_count, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?, 0, 0, ?, 0, ?, ?)"#,
    )
    .bind(&id)
    .bind(&host.group_id)
    .bind(&host.label)
    .bind(&host.hostname)
    .bind(host.port as i64)
    .bind(&host.username)
    .bind(&host.identity_id)
    .bind(&host.auth_method)
    .bind(&host.jump_host_id)
    .bind(&host.proxy_id)
    .bind(&host.color)
    .bind(&host.icon)
    .bind(&host.notes)
    .bind(now)
    .bind(now)
    .execute(state.vault.pool())
    .await
    .map_err(db)?;

    if let Some(password) = host.password.filter(|p| !p.is_empty()) {
        let cred_id = Uuid::now_v7().to_string();
        let (ct, nonce) = state
            .vault
            .seal_secret(password.as_bytes(), &format!("cred:{cred_id}"))
            .await?;
        sqlx::query(
            "INSERT INTO credentials (id, name, kind, ciphertext, nonce, aad, created_at, updated_at) VALUES (?, ?, 'password', ?, ?, ?, ?, ?)",
        )
        .bind(&cred_id)
        .bind(format!("{} password", host.label))
        .bind(&ct)
        .bind(&nonce)
        .bind(format!("cred:{cred_id}"))
        .bind(now)
        .bind(now)
        .execute(state.vault.pool())
        .await
        .map_err(db)?;
        sqlx::query("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)")
            .bind(format!("host:{id}:cred"))
            .bind(&cred_id)
            .bind(now)
            .execute(state.vault.pool())
            .await
            .map_err(db)?;
    }
    if let Some(key_id) = resolved_key {
        sqlx::query("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)")
            .bind(format!("host:{id}:ssh_key"))
            .bind(&key_id)
            .bind(now)
            .execute(state.vault.pool())
            .await
            .map_err(db)?;
    }

    let _ = sqlx::query(
        "INSERT INTO fts_hosts(rowid, label, hostname, notes) SELECT rowid, label, hostname, COALESCE(notes,'') FROM hosts WHERE id = ?",
    )
    .bind(&id)
    .execute(state.vault.pool())
    .await;

    Ok(id)
}

#[tauri::command]
pub async fn hosts_update(state: State<'_, Arc<AppState>>, host: HostDto) -> Result<(), AppError> {
    let now = chrono::Utc::now().timestamp_millis();
    sqlx::query(
        r#"UPDATE hosts SET group_id=?, label=?, hostname=?, port=?, username=?, auth_method=?, identity_id=?, jump_host_id=?, proxy_id=?, color=?, icon=?, notes=?, is_favorite=?, is_pinned=?, updated_at=? WHERE id=?"#,
    )
    .bind(&host.group_id)
    .bind(&host.label)
    .bind(&host.hostname)
    .bind(host.port as i64)
    .bind(&host.username)
    .bind(&host.auth_method)
    .bind(&host.identity_id)
    .bind(&host.jump_host_id)
    .bind(&host.proxy_id)
    .bind(&host.color)
    .bind(&host.icon)
    .bind(&host.notes)
    .bind(if host.is_favorite { 1 } else { 0 })
    .bind(if host.is_pinned { 1 } else { 0 })
    .bind(now)
    .bind(&host.id)
    .execute(state.vault.pool())
    .await
    .map_err(db)?;
    Ok(())
}

#[tauri::command]
pub async fn hosts_delete(state: State<'_, Arc<AppState>>, id: String) -> Result<(), AppError> {
    let now = chrono::Utc::now().timestamp_millis();
    sqlx::query("UPDATE hosts SET deleted_at = ?, updated_at = ? WHERE id = ?")
        .bind(now)
        .bind(now)
        .bind(&id)
        .execute(state.vault.pool())
        .await
        .map_err(db)?;
    Ok(())
}

#[tauri::command]
pub async fn hosts_toggle_favorite(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    sqlx::query("UPDATE hosts SET is_favorite = 1 - is_favorite, updated_at = ? WHERE id = ?")
        .bind(chrono::Utc::now().timestamp_millis())
        .bind(&id)
        .execute(state.vault.pool())
        .await
        .map_err(db)?;
    let row: (i64,) = sqlx::query_as("SELECT is_favorite FROM hosts WHERE id = ?")
        .bind(&id)
        .fetch_one(state.vault.pool())
        .await
        .map_err(db)?;
    Ok(row.0 != 0)
}

#[tauri::command]
pub async fn hosts_toggle_pin(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    sqlx::query("UPDATE hosts SET is_pinned = 1 - is_pinned, updated_at = ? WHERE id = ?")
        .bind(chrono::Utc::now().timestamp_millis())
        .bind(&id)
        .execute(state.vault.pool())
        .await
        .map_err(db)?;
    let row: (i64,) = sqlx::query_as("SELECT is_pinned FROM hosts WHERE id = ?")
        .bind(&id)
        .fetch_one(state.vault.pool())
        .await
        .map_err(db)?;
    Ok(row.0 != 0)
}

#[tauri::command]
pub async fn hosts_search(
    state: State<'_, Arc<AppState>>,
    query: String,
) -> Result<Vec<HostSummaryDto>, AppError> {
    let q = format!("%{query}%");
    let rows: Vec<(String, String, String, i64, Option<String>, i64, Option<i64>)> = sqlx::query_as(
        r#"SELECT id, label, hostname, port, username, is_favorite, last_connected_at
           FROM hosts WHERE deleted_at IS NULL AND (label LIKE ? OR hostname LIKE ? OR COALESCE(notes,'') LIKE ?)
           ORDER BY last_connected_at DESC LIMIT 50"#,
    )
    .bind(&q)
    .bind(&q)
    .bind(&q)
    .fetch_all(state.vault.pool())
    .await
    .map_err(db)?;
    Ok(rows
        .into_iter()
        .map(
            |(id, label, hostname, port, username, is_favorite, last_connected_at)| {
                HostSummaryDto {
                    id,
                    label,
                    hostname,
                    port: port as u16,
                    username,
                    is_favorite: is_favorite != 0,
                    last_connected_at,
                }
            },
        )
        .collect())
}

#[tauri::command]
pub async fn hosts_list_recent(
    state: State<'_, Arc<AppState>>,
    limit: Option<u32>,
) -> Result<Vec<HostSummaryDto>, AppError> {
    let limit = limit.unwrap_or(20) as i64;
    let rows: Vec<(
        String,
        String,
        String,
        i64,
        Option<String>,
        i64,
        Option<i64>,
    )> = sqlx::query_as(
        r#"SELECT id, label, hostname, port, username, is_favorite, last_connected_at
           FROM hosts WHERE deleted_at IS NULL
           ORDER BY COALESCE(last_connected_at, 0) DESC LIMIT ?"#,
    )
    .bind(limit)
    .fetch_all(state.vault.pool())
    .await
    .map_err(db)?;
    Ok(rows
        .into_iter()
        .map(
            |(id, label, hostname, port, username, is_favorite, last_connected_at)| {
                HostSummaryDto {
                    id,
                    label,
                    hostname,
                    port: port as u16,
                    username,
                    is_favorite: is_favorite != 0,
                    last_connected_at,
                }
            },
        )
        .collect())
}

#[tauri::command]
pub async fn hosts_import(
    _state: State<'_, Arc<AppState>>,
    format: String,
    content: String,
) -> Result<serde_json::Value, AppError> {
    let mut hosts = Vec::new();
    if format == "ssh_config" {
        let mut current: Option<NewHostDto> = None;
        for line in content.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            let mut parts = line.split_whitespace();
            let Some(key) = parts.next() else { continue };
            let rest = parts.collect::<Vec<_>>().join(" ");
            match key.to_lowercase().as_str() {
                "host" if rest != "*" => {
                    if let Some(h) = current.take() {
                        hosts.push(h);
                    }
                    current = Some(NewHostDto {
                        label: rest.clone(),
                        hostname: rest,
                        port: 22,
                        username: None,
                        auth_method: "key".into(),
                        group_id: None,
                        identity_id: None,
                        notes: None,
                        color: None,
                        icon: None,
                        password: None,
                        ssh_key_id: Some("auto".into()),
                        jump_host_id: None,
                        proxy_id: None,
                    });
                }
                "hostname" => {
                    if let Some(h) = current.as_mut() {
                        h.hostname = rest;
                    }
                }
                "user" => {
                    if let Some(h) = current.as_mut() {
                        h.username = Some(rest);
                    }
                }
                "port" => {
                    if let Some(h) = current.as_mut() {
                        h.port = rest.parse().unwrap_or(22);
                    }
                }
                _ => {}
            }
        }
        if let Some(h) = current.take() {
            hosts.push(h);
        }
    } else if format == "json" {
        hosts = serde_json::from_str(&content).map_err(|e| AppError::Validation {
            field: "content".into(),
            message: e.to_string(),
        })?;
    } else {
        return Err(AppError::Validation {
            field: "format".into(),
            message: "supported: ssh_config, json".into(),
        });
    }
    let count = hosts.len();
    Ok(serde_json::json!({ "hosts": hosts, "count": count }))
}

#[tauri::command]
pub async fn hosts_import_commit(
    state: State<'_, Arc<AppState>>,
    hosts: Vec<NewHostDto>,
) -> Result<serde_json::Value, AppError> {
    let mut imported = 0u32;
    for h in hosts {
        hosts_create(state.clone(), h).await?;
        imported += 1;
    }
    Ok(serde_json::json!({ "imported": imported }))
}

#[tauri::command]
pub async fn hosts_export(
    state: State<'_, Arc<AppState>>,
    format: String,
) -> Result<serde_json::Value, AppError> {
    let tree = hosts_list_tree(state).await?;
    let mut flat = Vec::new();
    fn collect(nodes: &[HostTreeNode], out: &mut Vec<HostDto>) {
        for n in nodes {
            match n {
                HostTreeNode::Host { host } => out.push(host.clone()),
                HostTreeNode::Group { children, .. } => collect(children, out),
            }
        }
    }
    collect(&tree, &mut flat);
    let content = if format == "yaml" {
        serde_yaml::to_string(&flat).map_err(|e| AppError::Internal {
            message: e.to_string(),
        })?
    } else {
        serde_json::to_string_pretty(&flat).map_err(|e| AppError::Internal {
            message: e.to_string(),
        })?
    };
    Ok(serde_json::json!({ "content": content }))
}

#[tauri::command]
pub async fn groups_create(
    state: State<'_, Arc<AppState>>,
    name: String,
    parent_id: Option<String>,
) -> Result<String, AppError> {
    let id = Uuid::now_v7().to_string();
    let now = chrono::Utc::now().timestamp_millis();
    sqlx::query(
        "INSERT INTO groups (id, parent_id, name, color, icon, sort_order, created_at, updated_at) VALUES (?, ?, ?, NULL, NULL, 0, ?, ?)",
    )
    .bind(&id)
    .bind(&parent_id)
    .bind(&name)
    .bind(now)
    .bind(now)
    .execute(state.vault.pool())
    .await
    .map_err(db)?;
    Ok(id)
}

#[tauri::command]
pub async fn groups_rename(
    state: State<'_, Arc<AppState>>,
    id: String,
    name: String,
) -> Result<(), AppError> {
    sqlx::query("UPDATE groups SET name = ?, updated_at = ? WHERE id = ?")
        .bind(&name)
        .bind(chrono::Utc::now().timestamp_millis())
        .bind(&id)
        .execute(state.vault.pool())
        .await
        .map_err(db)?;
    Ok(())
}

#[tauri::command]
pub async fn groups_delete(state: State<'_, Arc<AppState>>, id: String) -> Result<(), AppError> {
    sqlx::query("DELETE FROM groups WHERE id = ?")
        .bind(&id)
        .execute(state.vault.pool())
        .await
        .map_err(db)?;
    Ok(())
}

#[tauri::command]
pub async fn tags_list(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<serde_json::Value>, AppError> {
    let rows: Vec<(String, String, Option<String>)> =
        sqlx::query_as("SELECT id, name, color FROM tags ORDER BY name")
            .fetch_all(state.vault.pool())
            .await
            .map_err(db)?;
    Ok(rows
        .into_iter()
        .map(|(id, name, color)| serde_json::json!({ "id": id, "name": name, "color": color }))
        .collect())
}

#[tauri::command]
pub async fn tags_add(
    state: State<'_, Arc<AppState>>,
    host_id: String,
    tag: String,
) -> Result<(), AppError> {
    let tag_id = Uuid::now_v7().to_string();
    let _ = sqlx::query("INSERT OR IGNORE INTO tags (id, name, color) VALUES (?, ?, NULL)")
        .bind(&tag_id)
        .bind(&tag)
        .execute(state.vault.pool())
        .await;
    let existing: Option<(String,)> = sqlx::query_as("SELECT id FROM tags WHERE name = ?")
        .bind(&tag)
        .fetch_optional(state.vault.pool())
        .await
        .map_err(db)?;
    let tid = existing.map(|t| t.0).unwrap_or(tag_id);
    sqlx::query("INSERT OR IGNORE INTO host_tags (host_id, tag_id) VALUES (?, ?)")
        .bind(&host_id)
        .bind(&tid)
        .execute(state.vault.pool())
        .await
        .map_err(db)?;
    Ok(())
}

#[tauri::command]
pub async fn tags_remove(
    state: State<'_, Arc<AppState>>,
    host_id: String,
    tag_id: String,
) -> Result<(), AppError> {
    sqlx::query("DELETE FROM host_tags WHERE host_id = ? AND tag_id = ?")
        .bind(&host_id)
        .bind(&tag_id)
        .execute(state.vault.pool())
        .await
        .map_err(db)?;
    Ok(())
}

#[tauri::command]
pub async fn known_hosts_list(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<serde_json::Value>, AppError> {
    let rows: Vec<(String, String, i64, String, String, i64, i64)> = sqlx::query_as(
        "SELECT id, host, port, key_type, fingerprint_sha256, first_seen_at, last_seen_at FROM known_hosts ORDER BY host",
    )
    .fetch_all(state.vault.pool())
    .await
    .map_err(db)?;
    Ok(rows
        .into_iter()
        .map(
            |(id, host, port, key_type, fingerprint_sha256, first_seen_at, last_seen_at)| {
                serde_json::json!({
                    "id": id,
                    "host": host,
                    "port": port,
                    "keyType": key_type,
                    "fingerprintSha256": fingerprint_sha256,
                    "firstSeenAt": first_seen_at,
                    "lastSeenAt": last_seen_at
                })
            },
        )
        .collect())
}

#[tauri::command]
pub async fn known_hosts_trust(
    state: State<'_, Arc<AppState>>,
    host: String,
    port: u16,
    fingerprint: String,
    key_type: String,
) -> Result<(), AppError> {
    let id = Uuid::now_v7().to_string();
    let now = chrono::Utc::now().timestamp_millis();
    sqlx::query(
        "INSERT INTO known_hosts (id, host, port, key_type, fingerprint_sha256, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&host)
    .bind(port as i64)
    .bind(&key_type)
    .bind(&fingerprint)
    .bind(now)
    .bind(now)
    .execute(state.vault.pool())
    .await
    .map_err(db)?;
    Ok(())
}

#[tauri::command]
pub async fn session_open(
    state: State<'_, Arc<AppState>>,
    host_id: String,
    key_passphrase: Option<String>,
) -> Result<serde_json::Value, AppError> {
    let session_id = state
        .connections
        .session_open_with_key_pass(&host_id, key_passphrase)
        .await?;
    Ok(serde_json::json!({ "sessionId": session_id }))
}

#[tauri::command]
pub async fn session_close(
    state: State<'_, Arc<AppState>>,
    session_id: String,
) -> Result<(), AppError> {
    state.connections.session_close(&session_id).await?;
    Ok(())
}

fn db(e: sqlx::Error) -> AppError {
    AppError::Db {
        engine: "sqlite".into(),
        message: e.to_string(),
    }
}
