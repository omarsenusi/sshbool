//! Productivity, settings, search.

use application::{AppInfoDto, NoteDto, SearchResultDto, SnippetDto, TemplateDto};
use infrastructure::AppState;
use std::sync::Arc;
use tauri::State;
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
    Ok(AppInfoDto {
        name: "SSHBool".into(),
        version: env!("CARGO_PKG_VERSION").into(),
        tauri_version: "2".into(),
    })
}
