//! Productivity, settings, search.

use application::{AppInfoDto, NoteDto, SearchResultDto, SnippetDto, TemplateDto};
use futures_util::StreamExt;
use infrastructure::AppState;
use serde::Serialize;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use tokio::io::AsyncWriteExt;
use uuid::Uuid;

use crate::error::AppError;

fn db(e: sqlx::Error) -> AppError {
    AppError::Db {
        engine: "sqlite".into(),
        message: e.to_string(),
    }
}

#[tauri::command]
pub async fn snippets_list(state: State<'_, Arc<AppState>>) -> Result<Vec<SnippetDto>, AppError> {
    let rows: Vec<(String, String, String, Option<String>, Option<String>, Option<String>, i64, i64)> =
        sqlx::query_as(
            "SELECT id, name, body, language, tags_json, shortcut, usage_count, is_favorite FROM snippets ORDER BY name",
        )
        .fetch_all(state.vault.pool())
        .await
        .map_err(db)?;
    Ok(rows
        .into_iter()
        .map(
            |(id, name, body, language, tags_json, shortcut, usage_count, is_favorite)| {
                SnippetDto {
                    id,
                    name,
                    body,
                    language,
                    tags_json,
                    shortcut,
                    usage_count,
                    is_favorite: is_favorite != 0,
                }
            },
        )
        .collect())
}

#[tauri::command]
pub async fn snippets_upsert(
    state: State<'_, Arc<AppState>>,
    snippet: serde_json::Value,
) -> Result<String, AppError> {
    let name = snippet["name"].as_str().unwrap_or("").to_string();
    let body = snippet["body"].as_str().unwrap_or("").to_string();
    let id = snippet["id"]
        .as_str()
        .map(|s| s.to_string())
        .unwrap_or_else(|| Uuid::now_v7().to_string());
    let now = chrono::Utc::now().timestamp_millis();
    sqlx::query(
        r#"INSERT INTO snippets (id, name, body, language, tags_json, shortcut, usage_count, is_favorite, created_at, updated_at)
           VALUES (?, ?, ?, NULL, NULL, NULL, 0, 0, ?, ?)
           ON CONFLICT(id) DO UPDATE SET name=excluded.name, body=excluded.body, updated_at=excluded.updated_at"#,
    )
    .bind(&id)
    .bind(&name)
    .bind(&body)
    .bind(now)
    .bind(now)
    .execute(state.vault.pool())
    .await
    .map_err(db)?;
    Ok(id)
}

#[tauri::command]
pub async fn snippets_delete(state: State<'_, Arc<AppState>>, id: String) -> Result<(), AppError> {
    sqlx::query("DELETE FROM snippets WHERE id = ?")
        .bind(&id)
        .execute(state.vault.pool())
        .await
        .map_err(db)?;
    Ok(())
}

#[tauri::command]
pub async fn snippets_run(
    state: State<'_, Arc<AppState>>,
    id: String,
    pane_id: String,
) -> Result<(), AppError> {
    let row: Option<(String,)> = sqlx::query_as("SELECT body FROM snippets WHERE id = ?")
        .bind(&id)
        .fetch_optional(state.vault.pool())
        .await
        .map_err(db)?;
    let Some((body,)) = row else {
        return Err(AppError::NotFound {
            entity: "snippet".into(),
            id: Some(id),
        });
    };
    state
        .connections
        .pane_write(&pane_id, body.as_bytes())
        .await?;
    sqlx::query("UPDATE snippets SET usage_count = usage_count + 1 WHERE id = ?")
        .bind(&id)
        .execute(state.vault.pool())
        .await
        .ok();
    Ok(())
}

#[tauri::command]
pub async fn notes_list(
    state: State<'_, Arc<AppState>>,
    host_id: Option<String>,
) -> Result<Vec<NoteDto>, AppError> {
    let rows: Vec<(String, Option<String>, String, String, Option<String>, i64)> = if let Some(
        hid,
    ) = host_id
    {
        sqlx::query_as(
            "SELECT id, host_id, title, body_md, color, pinned FROM notes WHERE host_id = ? OR host_id IS NULL ORDER BY pinned DESC, updated_at DESC",
        )
        .bind(&hid)
        .fetch_all(state.vault.pool())
        .await
        .map_err(db)?
    } else {
        sqlx::query_as(
            "SELECT id, host_id, title, body_md, color, pinned FROM notes ORDER BY pinned DESC, updated_at DESC",
        )
        .fetch_all(state.vault.pool())
        .await
        .map_err(db)?
    };
    Ok(rows
        .into_iter()
        .map(|(id, host_id, title, body_md, color, pinned)| NoteDto {
            id,
            host_id,
            title,
            body_md,
            color,
            pinned: pinned != 0,
        })
        .collect())
}

#[tauri::command]
pub async fn notes_upsert(
    state: State<'_, Arc<AppState>>,
    note: serde_json::Value,
) -> Result<String, AppError> {
    let title = note["title"].as_str().unwrap_or("").to_string();
    let body_md = note["bodyMd"].as_str().unwrap_or("").to_string();
    let host_id = note["hostId"].as_str().map(|s| s.to_string());
    let id = note["id"]
        .as_str()
        .map(|s| s.to_string())
        .unwrap_or_else(|| Uuid::now_v7().to_string());
    let now = chrono::Utc::now().timestamp_millis();
    sqlx::query(
        r#"INSERT INTO notes (id, host_id, title, body_md, color, pinned, created_at, updated_at)
           VALUES (?, ?, ?, ?, NULL, 0, ?, ?)
           ON CONFLICT(id) DO UPDATE SET title=excluded.title, body_md=excluded.body_md, host_id=excluded.host_id, updated_at=excluded.updated_at"#,
    )
    .bind(&id)
    .bind(&host_id)
    .bind(&title)
    .bind(&body_md)
    .bind(now)
    .bind(now)
    .execute(state.vault.pool())
    .await
    .map_err(db)?;
    Ok(id)
}

#[tauri::command]
pub async fn notes_delete(state: State<'_, Arc<AppState>>, id: String) -> Result<(), AppError> {
    sqlx::query("DELETE FROM notes WHERE id = ?")
        .bind(&id)
        .execute(state.vault.pool())
        .await
        .map_err(db)?;
    Ok(())
}

#[tauri::command]
pub async fn templates_list(state: State<'_, Arc<AppState>>) -> Result<Vec<TemplateDto>, AppError> {
    let rows: Vec<(String, String, String, String, Option<String>)> =
        sqlx::query_as("SELECT id, name, kind, body, variables_json FROM templates ORDER BY name")
            .fetch_all(state.vault.pool())
            .await
            .map_err(db)?;
    Ok(rows
        .into_iter()
        .map(|(id, name, kind, body, variables_json)| TemplateDto {
            id,
            name,
            kind,
            body,
            variables_json,
        })
        .collect())
}

#[tauri::command]
pub async fn templates_render(
    state: State<'_, Arc<AppState>>,
    id: String,
    vars: std::collections::HashMap<String, String>,
) -> Result<serde_json::Value, AppError> {
    let row: Option<(String,)> = sqlx::query_as("SELECT body FROM templates WHERE id = ?")
        .bind(&id)
        .fetch_optional(state.vault.pool())
        .await
        .map_err(db)?;
    let Some((mut body,)) = row else {
        return Err(AppError::NotFound {
            entity: "template".into(),
            id: Some(id),
        });
    };
    for (k, v) in vars {
        body = body.replace(&format!("{{{{{k}}}}}"), &v);
    }
    Ok(serde_json::json!({ "body": body }))
}

#[tauri::command]
pub async fn search_global(
    state: State<'_, Arc<AppState>>,
    query: String,
) -> Result<Vec<SearchResultDto>, AppError> {
    let mut out = Vec::new();
    let q = format!("%{query}%");
    let hosts: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT id, label, hostname FROM hosts WHERE deleted_at IS NULL AND (label LIKE ? OR hostname LIKE ?) LIMIT 20",
    )
    .bind(&q)
    .bind(&q)
    .fetch_all(state.vault.pool())
    .await
    .map_err(db)?;
    for (id, title, subtitle) in hosts {
        out.push(SearchResultDto {
            kind: "host".into(),
            id,
            title,
            subtitle: Some(subtitle),
        });
    }
    let snippets: Vec<(String, String)> =
        sqlx::query_as("SELECT id, name FROM snippets WHERE name LIKE ? OR body LIKE ? LIMIT 20")
            .bind(&q)
            .bind(&q)
            .fetch_all(state.vault.pool())
            .await
            .map_err(db)?;
    for (id, title) in snippets {
        out.push(SearchResultDto {
            kind: "snippet".into(),
            id,
            title,
            subtitle: None,
        });
    }
    let notes: Vec<(String, String)> =
        sqlx::query_as("SELECT id, title FROM notes WHERE title LIKE ? OR body_md LIKE ? LIMIT 20")
            .bind(&q)
            .bind(&q)
            .fetch_all(state.vault.pool())
            .await
            .map_err(db)?;
    for (id, title) in notes {
        out.push(SearchResultDto {
            kind: "note".into(),
            id,
            title,
            subtitle: None,
        });
    }
    Ok(out)
}

#[tauri::command]
pub async fn settings_get(
    state: State<'_, Arc<AppState>>,
    key: String,
) -> Result<serde_json::Value, AppError> {
    let row: Option<(String,)> = sqlx::query_as("SELECT value FROM settings WHERE key = ?")
        .bind(&key)
        .fetch_optional(state.vault.pool())
        .await
        .map_err(db)?;
    match row {
        Some((v,)) => Ok(serde_json::from_str(&v).unwrap_or(serde_json::Value::String(v))),
        None => Ok(serde_json::Value::Null),
    }
}

#[tauri::command]
pub async fn settings_set(
    state: State<'_, Arc<AppState>>,
    key: String,
    value: serde_json::Value,
) -> Result<(), AppError> {
    let now = chrono::Utc::now().timestamp_millis();
    let v = value.to_string();
    sqlx::query("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)")
        .bind(&key)
        .bind(&v)
        .bind(now)
        .execute(state.vault.pool())
        .await
        .map_err(db)?;
    if key == "lockOnStartup" && value == serde_json::Value::Bool(true) {
        state.vault.clear_launch_password().await?;
    }
    Ok(())
}

#[tauri::command]
pub async fn keybindings_list(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<serde_json::Value>, AppError> {
    let rows: Vec<(String, String, String)> =
        sqlx::query_as("SELECT id, command, keys FROM keybindings")
            .fetch_all(state.vault.pool())
            .await
            .map_err(db)?;
    Ok(rows
        .into_iter()
        .map(
            |(id, command, keys)| serde_json::json!({ "id": id, "command": command, "keys": keys }),
        )
        .collect())
}

#[tauri::command]
pub async fn keybindings_set(
    state: State<'_, Arc<AppState>>,
    command: String,
    keys: String,
) -> Result<(), AppError> {
    let id = Uuid::now_v7().to_string();
    let now = chrono::Utc::now().timestamp_millis();
    sqlx::query("DELETE FROM keybindings WHERE command = ?")
        .bind(&command)
        .execute(state.vault.pool())
        .await
        .map_err(db)?;
    sqlx::query(
        "INSERT INTO keybindings (id, command, keys, when_context, created_at) VALUES (?, ?, ?, NULL, ?)",
    )
    .bind(&id)
    .bind(&command)
    .bind(&keys)
    .bind(now)
    .execute(state.vault.pool())
    .await
    .map_err(db)?;
    Ok(())
}

#[tauri::command]
pub async fn app_info() -> Result<AppInfoDto, AppError> {
    let (install_dir, exe_path) = resolve_install_context();
    Ok(AppInfoDto {
        name: "SSHBool".into(),
        version: env!("CARGO_PKG_VERSION").into(),
        tauri_version: "2".into(),
        update_platform: detect_update_platform(),
        install_dir,
        exe_path,
        is_packaged: !cfg!(debug_assertions),
    })
}

fn resolve_install_context() -> (String, String) {
    let exe = std::env::current_exe().ok();
    let exe_path = exe
        .as_ref()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default();

    let install_dir = exe
        .as_ref()
        .and_then(|path| find_app_bundle_dir(path))
        .or_else(|| {
            exe.as_ref()
                .and_then(|path| path.parent())
                .map(|dir| dir.to_string_lossy().into_owned())
        })
        .unwrap_or_default();

    (install_dir, exe_path)
}

fn find_app_bundle_dir(path: &std::path::Path) -> Option<String> {
    for ancestor in path.ancestors() {
        if ancestor.extension().and_then(|ext| ext.to_str()) == Some("app") {
            return Some(ancestor.to_string_lossy().into_owned());
        }
    }
    None
}

fn detect_update_platform() -> String {
    let os = match std::env::consts::OS {
        "macos" => "darwin",
        other => other,
    };
    format!("{}-{}", os, std::env::consts::ARCH)
}

#[tauri::command]
pub async fn update_download_and_install(
    app: AppHandle,
    url: String,
    file_name: String,
) -> Result<(), AppError> {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|error| AppError::Internal {
            message: format!("Failed to create download client: {error}"),
        })?;

    let response = client.get(&url).send().await.map_err(|error| AppError::Internal {
        message: format!("Failed to download update: {error}"),
    })?;

    if !response.status().is_success() {
        return Err(AppError::Internal {
            message: format!("Failed to download update ({})", response.status()),
        });
    }

    let total_bytes = response.content_length().unwrap_or(0);
    let path = std::env::temp_dir().join(&file_name);
    let mut file = tokio::fs::File::create(&path).await.map_err(|error| AppError::Internal {
        message: format!("Failed to create installer file: {error}"),
    })?;

    emit_update_progress(&app, "downloading", 0, total_bytes);

    let mut downloaded_bytes: u64 = 0;
    let mut stream = response.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| AppError::Internal {
            message: format!("Failed while downloading update: {error}"),
        })?;
        file.write_all(&chunk).await.map_err(|error| AppError::Internal {
            message: format!("Failed to write installer file: {error}"),
        })?;
        downloaded_bytes += chunk.len() as u64;
        emit_update_progress(&app, "downloading", downloaded_bytes, total_bytes);
    }

    file.flush().await.map_err(|error| AppError::Internal {
        message: format!("Failed to finalize installer file: {error}"),
    })?;

    emit_update_progress(
        &app,
        "installing",
        downloaded_bytes,
        total_bytes.max(downloaded_bytes),
    );

    spawn_installer(&path).map_err(|error| AppError::Internal {
        message: format!("Failed to launch installer: {error}"),
    })?;

    Ok(())
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateProgressPayload {
    phase: String,
    downloaded_bytes: u64,
    total_bytes: u64,
}

fn emit_update_progress(app: &AppHandle, phase: &str, downloaded_bytes: u64, total_bytes: u64) {
    let _ = app.emit(
        "update://progress",
        UpdateProgressPayload {
            phase: phase.to_string(),
            downloaded_bytes,
            total_bytes,
        },
    );
}

fn spawn_installer(path: &std::path::Path) -> std::io::Result<()> {
    let ext = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    if ext == "msi" {
        std::process::Command::new("msiexec")
            .arg("/i")
            .arg(path)
            .args(["/passive", "/norestart"])
            .spawn()?;
        return Ok(());
    }

    std::process::Command::new(path).spawn()?;
    Ok(())
}
