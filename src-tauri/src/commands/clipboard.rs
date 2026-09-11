//! System clipboard IPC (uses tauri-plugin-clipboard-manager on a background thread).

use tauri::AppHandle;
use tauri_plugin_clipboard_manager::ClipboardExt;

use crate::error::AppError;

#[tauri::command]
pub async fn clipboard_write_text(app: AppHandle, text: String) -> Result<(), AppError> {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        app.clipboard()
            .write_text(text)
            .map_err(|e| AppError::Internal {
                message: e.to_string(),
            })
    })
    .await
    .map_err(|e| AppError::Internal {
        message: e.to_string(),
    })?
}

#[tauri::command]
pub async fn clipboard_read_text(app: AppHandle) -> Result<String, AppError> {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        app.clipboard().read_text().map_err(|e| AppError::Internal {
            message: e.to_string(),
        })
    })
    .await
    .map_err(|e| AppError::Internal {
        message: e.to_string(),
    })?
}
