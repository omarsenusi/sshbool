//! Terminal pane commands.

use application::PaneInfoDto;
use infrastructure::AppState;
use serde::Serialize;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};

use crate::error::AppError;
use crate::events::terminal_data;

#[derive(Clone, Serialize)]
struct TerminalBytes {
    bytes: Vec<u8>,
}

#[tauri::command]
pub async fn pane_open(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    host_id: String,
    cols: u32,
    rows: u32,
) -> Result<PaneInfoDto, AppError> {
    let (pane_id, session_id, mut rx) = state.connections.pane_open(&host_id, cols, rows).await?;

    let topic = terminal_data(&pane_id);
    let app2 = app.clone();
    let connections = state.connections.clone();
    let pane_id_sb = pane_id.clone();
    tokio::spawn(async move {
        while let Some(bytes) = rx.recv().await {
            connections
                .pane_scrollback_append(&pane_id_sb, &bytes)
                .await;
            let _ = app2.emit(&topic, TerminalBytes { bytes });
        }
    });

    let label: Option<(String,)> = sqlx::query_as("SELECT label FROM hosts WHERE id = ?")
        .bind(&host_id)
        .fetch_optional(state.vault.pool())
        .await
        .ok()
        .flatten();

    Ok(PaneInfoDto {
        pane_id,
        session_id,
        host_id: host_id.clone(),
        title: label.map(|(l,)| l).unwrap_or(host_id),
    })
}

#[tauri::command]
pub async fn pane_close(state: State<'_, Arc<AppState>>, pane_id: String) -> Result<(), AppError> {
    state.connections.pane_close(&pane_id).await?;
    Ok(())
}

#[tauri::command]
pub async fn pane_resize(
    state: State<'_, Arc<AppState>>,
    pane_id: String,
    cols: u32,
    rows: u32,
) -> Result<(), AppError> {
    state.connections.pane_resize(&pane_id, cols, rows).await?;
    Ok(())
}

#[tauri::command]
pub async fn pane_write(
    state: State<'_, Arc<AppState>>,
    pane_id: String,
    data: String,
) -> Result<(), AppError> {
    state
        .connections
        .pane_write(&pane_id, data.as_bytes())
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn pane_scrollback(
    state: State<'_, Arc<AppState>>,
    pane_id: String,
) -> Result<Vec<u8>, AppError> {
    Ok(state.connections.pane_scrollback_get(&pane_id).await)
}

#[tauri::command]
pub async fn sessions_list(state: State<'_, Arc<AppState>>) -> Result<Vec<PaneInfoDto>, AppError> {
    let list = state.connections.sessions_list().await;
    Ok(list
        .into_iter()
        .map(|(pane_id, session_id, host_id, title)| PaneInfoDto {
            pane_id,
            session_id,
            host_id,
            title,
        })
        .collect())
}

#[tauri::command]
pub async fn command_history_search(
    state: State<'_, Arc<AppState>>,
    query: String,
    limit: Option<u32>,
) -> Result<Vec<serde_json::Value>, AppError> {
    let limit = limit.unwrap_or(50) as i64;
    let q = format!("%{query}%");
    let rows: Vec<(String, String, i64)> = sqlx::query_as(
        "SELECT id, command, ran_at FROM command_history WHERE command LIKE ? ORDER BY ran_at DESC LIMIT ?",
    )
    .bind(&q)
    .bind(limit)
    .fetch_all(state.vault.pool())
    .await
    .map_err(|e| AppError::Db {
        engine: "sqlite".into(),
        message: e.to_string(),
    })?;
    Ok(rows
        .into_iter()
        .map(|(id, command, ran_at)| {
            serde_json::json!({ "id": id, "command": command, "ranAt": ran_at })
        })
        .collect())
}
