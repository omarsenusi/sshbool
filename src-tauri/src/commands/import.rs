//! Import from third-party SSH clients.
//!
//! Thin IPC layer over [`infrastructure::import`]: the commands here are
//! source-agnostic, so registering a new importer in `import::sources()` makes
//! it available to the UI with no changes to this file.

use application::NewHostDto;
use infrastructure::import::{
    self, ImportError, ImportPreview, ImportedKey, ImportedSnippet, SourceInfo,
};
use infrastructure::AppState;
use std::sync::Arc;
use tauri::State;

use crate::error::AppError;

impl From<ImportError> for AppError {
    fn from(value: ImportError) -> Self {
        match value {
            ImportError::NotFound(message) => AppError::NotFound {
                entity: message,
                id: None,
            },
            ImportError::KeyUnavailable(message) => AppError::Crypto { message },
            ImportError::Unreadable(message) => AppError::Io { message },
        }
    }
}

/// List every import source and whether it can be read on this machine.
///
/// Probing touches the filesystem and (on macOS/Windows) the keychain, so it
/// runs on a blocking thread rather than stalling the async runtime.
#[tauri::command]
pub async fn import_sources() -> Result<Vec<SourceInfo>, AppError> {
    tokio::task::spawn_blocking(|| import::sources().iter().map(|s| s.probe()).collect())
        .await
        .map_err(|e| AppError::Internal {
            message: format!("probe import sources: {e}"),
        })
}

/// Read everything a source holds, without writing anything.
///
/// `secret` is an optional source-specific unlock value — for Termius, a
/// manually supplied local key when the keychain cannot be read.
#[tauri::command]
pub async fn import_scan(
    source: String,
    secret: Option<String>,
) -> Result<ImportPreview, AppError> {
    let handle = tokio::task::spawn_blocking(move || {
        let importer = import::source_by_id(&source).ok_or_else(|| AppError::NotFound {
            entity: format!("import source \"{source}\""),
            id: None,
        })?;
        importer.scan(secret.as_deref()).map_err(AppError::from)
    });

    handle.await.map_err(|e| AppError::Internal {
        message: format!("scan import source: {e}"),
    })?
}

/// What the user chose to bring across.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSelection {
    /// Hosts to create.
    #[serde(default)]
    pub hosts: Vec<NewHostDto>,
    /// Keys to add to the vault.
    #[serde(default)]
    pub keys: Vec<ImportedKey>,
    /// Snippets to save.
    #[serde(default)]
    pub snippets: Vec<ImportedSnippet>,
}

/// Outcome of a commit, including per-item failures.
#[derive(Debug, Clone, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    /// Hosts created.
    pub hosts: u32,
    /// Keys added to the vault.
    pub keys: u32,
    /// Snippets saved.
    pub snippets: u32,
    /// Items that could not be imported, with the reason.
    pub failures: Vec<String>,
}

/// Write the user's selection into the vault.
///
/// Individual failures are collected rather than aborting the run: a single
/// unparseable key should not discard an otherwise good import of 500 hosts.
#[tauri::command]
pub async fn import_commit(
    state: State<'_, Arc<AppState>>,
    selection: ImportSelection,
) -> Result<ImportResult, AppError> {
    let mut result = ImportResult::default();

    for key in selection.keys {
        let label = key.label.clone();
        match crate::commands::vault::keys_import(
            state.clone(),
            key.private_key,
            key.label,
            key.passphrase,
        )
        .await
        {
            Ok(_) => result.keys += 1,
            Err(e) => result
                .failures
                .push(format!("key \"{label}\": {}", error_text(&e))),
        }
    }

    for host in selection.hosts {
        let label = host.label.clone();
        match crate::commands::hosts::hosts_create(state.clone(), host).await {
            Ok(_) => result.hosts += 1,
            Err(e) => result
                .failures
                .push(format!("host \"{label}\": {}", error_text(&e))),
        }
    }

    for snippet in selection.snippets {
        let label = snippet.label.clone();
        let payload = serde_json::json!({
            "name": snippet.label,
            "body": snippet.script,
        });
        match crate::commands::productivity::snippets_upsert(state.clone(), payload).await {
            Ok(_) => result.snippets += 1,
            Err(e) => result
                .failures
                .push(format!("snippet \"{label}\": {}", error_text(&e))),
        }
    }

    Ok(result)
}

/// Flatten an AppError into a short message for the failure list.
fn error_text(error: &AppError) -> String {
    match error {
        AppError::Validation { message, .. }
        | AppError::Conflict { message }
        | AppError::Crypto { message }
        | AppError::Io { message }
        | AppError::Internal { message } => message.clone(),
        AppError::NotFound { entity, .. } => format!("not found: {entity}"),
        AppError::Unauthorized { reason } => reason.clone(),
        other => format!("{other:?}"),
    }
}
