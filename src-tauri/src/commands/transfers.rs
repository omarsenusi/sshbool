//! SFTP, local FS, & transfer commands.

use application::{SftpEntryDto, TransferJobDto};
use domain::DomainError;
use infrastructure::ssh::SftpEntry;
use infrastructure::AppState;
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::SystemTime;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::error::AppError;
use crate::events::transfer_progress;

fn cancel_flags() -> &'static RwLock<HashMap<String, Arc<AtomicBool>>> {
    static FLAGS: OnceLock<RwLock<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
    FLAGS.get_or_init(|| RwLock::new(HashMap::new()))
}

async fn register_cancel(job_id: &str) -> Arc<AtomicBool> {
    let flag = Arc::new(AtomicBool::new(false));
    cancel_flags()
        .write()
        .await
        .insert(job_id.to_string(), Arc::clone(&flag));
    flag
}

async fn unregister_cancel(job_id: &str) {
    cancel_flags().write().await.remove(job_id);
}

fn is_canceled(flag: &AtomicBool) -> bool {
    flag.load(Ordering::Relaxed)
}

fn entry_dto(
    name: String,
    path: String,
    is_dir: bool,
    size: u64,
    mode: u32,
    mtime: i64,
    uid: u32,
    gid: u32,
) -> SftpEntryDto {
    SftpEntryDto {
        name,
        path,
        is_dir,
        size,
        mode,
        mtime,
        uid,
        gid,
    }
}

fn from_sftp(e: SftpEntry) -> SftpEntryDto {
    entry_dto(
        e.name,
        e.path,
        e.is_dir,
        e.size,
        e.mode,
        e.mtime,
        e.uid,
        e.gid,
    )
}

fn file_mtime(meta: &std::fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn join_remote(base: &str, name: &str) -> String {
    if base.is_empty() || base == "." {
        name.to_string()
    } else if base.ends_with('/') {
        format!("{base}{name}")
    } else {
        format!("{base}/{name}")
    }
}

fn home_dir() -> Result<PathBuf, AppError> {
    dirs::home_dir().ok_or_else(|| AppError::Io {
        message: "home directory not found".into(),
    })
}

async fn resolve_remote_dest(
    state: &AppState,
    host_id: &str,
    local_path: &str,
    remote_path: &str,
) -> Result<String, AppError> {
    let file_name = Path::new(local_path)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("upload.bin");
    if remote_path.ends_with('/') {
        return Ok(format!("{remote_path}{file_name}"));
    }
    match state.connections.sftp_stat(host_id, remote_path).await {
        Ok(meta) if meta.is_dir => Ok(join_remote(remote_path, file_name)),
        Ok(_) => Ok(remote_path.to_string()),
        Err(_) => Ok(remote_path.to_string()),
    }
}

async fn resolve_local_dest(remote_path: &str, local_path: &str) -> Result<String, AppError> {
    let file_name = Path::new(remote_path)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("download.bin");
    let p = PathBuf::from(local_path);
    if local_path.ends_with('/')
        || local_path.ends_with('\\')
        || tokio::fs::metadata(&p)
            .await
            .map(|m| m.is_dir())
            .unwrap_or(false)
    {
        Ok(p.join(file_name).to_string_lossy().into_owned())
    } else {
        Ok(local_path.to_string())
    }
}

async fn begin_job(
    state: &AppState,
    host_id: &str,
    kind: &str,
    source: &str,
    dest: &str,
    total_bytes: i64,
) -> Result<String, AppError> {
    let id = Uuid::now_v7().to_string();
    let now = chrono::Utc::now().timestamp_millis();
    sqlx::query(
        r#"INSERT INTO transfer_jobs
        (id, host_id, kind, source_root, dest_root, status, total_bytes, transferred_bytes, total_items, done_items, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'active', ?, 0, 1, 0, ?, ?)"#,
    )
    .bind(&id)
    .bind(host_id)
    .bind(kind)
    .bind(source)
    .bind(dest)
    .bind(total_bytes)
    .bind(now)
    .bind(now)
    .execute(state.vault.pool())
    .await
    .map_err(|e| AppError::Db {
        engine: "sqlite".into(),
        message: e.to_string(),
    })?;
    Ok(id)
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TransferProgressPayload {
    id: String,
    host_id: String,
    kind: String,
    source_root: String,
    dest_root: String,
    status: String,
    total_bytes: i64,
    transferred_bytes: i64,
    total_items: i64,
    done_items: i64,
    error: Option<String>,
}

fn emit_progress(app: &AppHandle, payload: TransferProgressPayload) {
    let topic = transfer_progress(&payload.id);
    let _ = app.emit(&topic, payload.clone());
    let _ = app.emit("transfer://progress", payload);
}

async fn bump_progress(
    app: &AppHandle,
    state: &AppState,
    job_id: &str,
    host_id: &str,
    kind: &str,
    source: &str,
    dest: &str,
    transferred: i64,
    total: i64,
) -> Result<(), AppError> {
    let now = chrono::Utc::now().timestamp_millis();
    let result = sqlx::query(
        r#"UPDATE transfer_jobs
           SET transferred_bytes = ?, total_bytes = ?, updated_at = ?
           WHERE id = ? AND status = 'active'"#,
    )
    .bind(transferred)
    .bind(total)
    .bind(now)
    .bind(job_id)
    .execute(state.vault.pool())
    .await
    .map_err(|e| AppError::Db {
        engine: "sqlite".into(),
        message: e.to_string(),
    })?;
    if result.rows_affected() == 0 {
        return Ok(());
    }
    emit_progress(
        app,
        TransferProgressPayload {
            id: job_id.to_string(),
            host_id: host_id.to_string(),
            kind: kind.to_string(),
            source_root: source.to_string(),
            dest_root: dest.to_string(),
            status: "active".into(),
            total_bytes: total,
            transferred_bytes: transferred,
            total_items: 1,
            done_items: 0,
            error: None,
        },
    );
    Ok(())
}

async fn finish_job(
    app: &AppHandle,
    state: &AppState,
    job_id: &str,
    host_id: &str,
    kind: &str,
    source: &str,
    dest: &str,
    bytes: i64,
    transferred: i64,
    status: &str,
    error: Option<&str>,
) -> Result<(), AppError> {
    let now = chrono::Utc::now().timestamp_millis();
    let done_items = if status == "done" { 1i64 } else { 0i64 };
    sqlx::query(
        r#"UPDATE transfer_jobs
           SET status = ?, transferred_bytes = ?, total_bytes = ?, done_items = ?, error = ?, updated_at = ?
           WHERE id = ? AND status = 'active'"#,
    )
    .bind(status)
    .bind(transferred)
    .bind(bytes)
    .bind(done_items)
    .bind(error)
    .bind(now)
    .bind(job_id)
    .execute(state.vault.pool())
    .await
    .map_err(|e| AppError::Db {
        engine: "sqlite".into(),
        message: e.to_string(),
    })?;
    emit_progress(
        app,
        TransferProgressPayload {
            id: job_id.to_string(),
            host_id: host_id.to_string(),
            kind: kind.to_string(),
            source_root: source.to_string(),
            dest_root: dest.to_string(),
            status: status.into(),
            total_bytes: bytes,
            transferred_bytes: transferred,
            total_items: 1,
            done_items,
            error: error.map(|s| s.to_string()),
        },
    );
    Ok(())
}

async fn mark_canceled(
    app: &AppHandle,
    state: &AppState,
    job_id: &str,
    host_id: &str,
    kind: &str,
    source: &str,
    dest: &str,
    transferred: i64,
    total: i64,
) -> Result<(), AppError> {
    let now = chrono::Utc::now().timestamp_millis();
    sqlx::query(
        r#"UPDATE transfer_jobs
           SET status = 'canceled', updated_at = ?
           WHERE id = ? AND status IN ('active', 'queued', 'paused', 'running')"#,
    )
    .bind(now)
    .bind(job_id)
    .execute(state.vault.pool())
    .await
    .map_err(|e| AppError::Db {
        engine: "sqlite".into(),
        message: e.to_string(),
    })?;
    emit_progress(
        app,
        TransferProgressPayload {
            id: job_id.to_string(),
            host_id: host_id.to_string(),
            kind: kind.to_string(),
            source_root: source.to_string(),
            dest_root: dest.to_string(),
            status: "canceled".into(),
            total_bytes: total,
            transferred_bytes: transferred,
            total_items: 1,
            done_items: 0,
            error: None,
        },
    );
    Ok(())
}

async fn upload_one(
    app: &AppHandle,
    state: &Arc<AppState>,
    host_id: &str,
    local_path: &str,
    remote_path: &str,
) -> Result<String, AppError> {
    let bytes = tokio::fs::read(local_path)
        .await
        .map_err(|e| AppError::Io {
            message: e.to_string(),
        })?;
    let dest = resolve_remote_dest(state, host_id, local_path, remote_path).await?;
    let total = bytes.len() as i64;
    let job_id = begin_job(state, host_id, "upload", local_path, &dest, total).await?;
    let cancel = register_cancel(&job_id).await;

    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<(i64, i64)>();
    {
        let app = app.clone();
        let state = Arc::clone(state);
        let job_id = job_id.clone();
        let host_id = host_id.to_string();
        let local_path = local_path.to_string();
        let dest = dest.clone();
        tokio::spawn(async move {
            let mut last = -1i64;
            while let Some((done, tot)) = rx.recv().await {
                // Throttle DB writes to ~every 2% or 64KB step already in chunks.
                if done == tot || done - last >= (tot / 50).max(1) || last < 0 {
                    last = done;
                    let _ = bump_progress(
                        &app, &state, &job_id, &host_id, "upload", &local_path, &dest, done, tot,
                    )
                    .await;
                }
            }
        });
    }

    let cancel_flag = Arc::clone(&cancel);
    let write_result = state
        .connections
        .sftp_write_bytes_progress(host_id, &dest, &bytes, None, |done, tot| {
            let _ = tx.send((done as i64, tot as i64));
            !is_canceled(&cancel_flag)
        })
        .await;
    drop(tx);
    unregister_cancel(&job_id).await;

    match write_result {
        Ok(_) => {
            finish_job(
                app,
                state,
                &job_id,
                host_id,
                "upload",
                local_path,
                &dest,
                total,
                total,
                "done",
                None,
            )
            .await?;
            Ok(job_id)
        }
        Err(e) if matches!(e, DomainError::Canceled) || is_canceled(&cancel) => {
            let _ = mark_canceled(
                app, state, &job_id, host_id, "upload", local_path, &dest, 0, total,
            )
            .await;
            Ok(job_id)
        }
        Err(e) => {
            let msg = e.to_string();
            let _ = finish_job(
                app,
                state,
                &job_id,
                host_id,
                "upload",
                local_path,
                &dest,
                total,
                0,
                "error",
                Some(&msg),
            )
            .await;
            Err(e.into())
        }
    }
}

async fn download_one(
    app: &AppHandle,
    state: &Arc<AppState>,
    host_id: &str,
    remote_path: &str,
    local_path: &str,
) -> Result<String, AppError> {
    let meta = state.connections.sftp_stat(host_id, remote_path).await?;
    let total = meta.size as i64;
    let dest = resolve_local_dest(remote_path, local_path).await?;
    let job_id = begin_job(state, host_id, "download", remote_path, &dest, total).await?;
    let cancel = register_cancel(&job_id).await;
    let _ = bump_progress(
        app, state, &job_id, host_id, "download", remote_path, &dest, 0, total,
    )
    .await;

    if is_canceled(&cancel) {
        unregister_cancel(&job_id).await;
        let _ = mark_canceled(
            app, state, &job_id, host_id, "download", remote_path, &dest, 0, total,
        )
        .await;
        return Ok(job_id);
    }

    let read_result = state
        .connections
        .sftp_read_bytes(host_id, remote_path, None)
        .await;

    if is_canceled(&cancel) {
        unregister_cancel(&job_id).await;
        let _ = mark_canceled(
            app, state, &job_id, host_id, "download", remote_path, &dest, 0, total,
        )
        .await;
        return Ok(job_id);
    }

    match read_result {
        Ok((bytes, _)) => {
            let total = bytes.len() as i64;
            if is_canceled(&cancel) {
                unregister_cancel(&job_id).await;
                let _ = mark_canceled(
                    app, state, &job_id, host_id, "download", remote_path, &dest, 0, total,
                )
                .await;
                return Ok(job_id);
            }
            let _ = bump_progress(
                app,
                state,
                &job_id,
                host_id,
                "download",
                remote_path,
                &dest,
                total / 2,
                total,
            )
            .await;
            if let Some(parent) = Path::new(&dest).parent() {
                tokio::fs::create_dir_all(parent)
                    .await
                    .map_err(|e| AppError::Io {
                        message: e.to_string(),
                    })?;
            }
            if is_canceled(&cancel) {
                unregister_cancel(&job_id).await;
                let _ = mark_canceled(
                    app, state, &job_id, host_id, "download", remote_path, &dest, 0, total,
                )
                .await;
                return Ok(job_id);
            }
            tokio::fs::write(&dest, &bytes)
                .await
                .map_err(|e| AppError::Io {
                    message: e.to_string(),
                })?;
            unregister_cancel(&job_id).await;
            if is_canceled(&cancel) {
                let _ = tokio::fs::remove_file(&dest).await;
                let _ = mark_canceled(
                    app, state, &job_id, host_id, "download", remote_path, &dest, 0, total,
                )
                .await;
                return Ok(job_id);
            }
            finish_job(
                app,
                state,
                &job_id,
                host_id,
                "download",
                remote_path,
                &dest,
                total,
                total,
                "done",
                None,
            )
            .await?;
            Ok(job_id)
        }
        Err(e) => {
            unregister_cancel(&job_id).await;
            if is_canceled(&cancel) {
                let _ = mark_canceled(
                    app, state, &job_id, host_id, "download", remote_path, &dest, 0, total,
                )
                .await;
                return Ok(job_id);
            }
            let msg = e.to_string();
            let _ = finish_job(
                app,
                state,
                &job_id,
                host_id,
                "download",
                remote_path,
                &dest,
                total,
                0,
                "error",
                Some(&msg),
            )
            .await;
            Err(e.into())
        }
    }
}

#[tauri::command]
pub async fn sftp_list_dir(
    state: State<'_, Arc<AppState>>,
    host_id: String,
    path: String,
) -> Result<Vec<SftpEntryDto>, AppError> {
    let entries = state.connections.sftp_list_dir(&host_id, &path).await?;
    Ok(entries.into_iter().map(from_sftp).collect())
}

#[tauri::command]
pub async fn sftp_stat(
    state: State<'_, Arc<AppState>>,
    host_id: String,
    path: String,
) -> Result<SftpEntryDto, AppError> {
    let e = state.connections.sftp_stat(&host_id, &path).await?;
    Ok(from_sftp(e))
}

#[tauri::command]
pub async fn sftp_mkdir(
    state: State<'_, Arc<AppState>>,
    host_id: String,
    path: String,
) -> Result<(), AppError> {
    state.connections.sftp_mkdir(&host_id, &path).await?;
    Ok(())
}

#[tauri::command]
pub async fn sftp_rename(
    state: State<'_, Arc<AppState>>,
    host_id: String,
    from: String,
    to: String,
) -> Result<(), AppError> {
    state.connections.sftp_rename(&host_id, &from, &to).await?;
    Ok(())
}

#[tauri::command]
pub async fn sftp_delete(
    state: State<'_, Arc<AppState>>,
    host_id: String,
    path: String,
    recursive: bool,
) -> Result<(), AppError> {
    state
        .connections
        .sftp_delete(&host_id, &path, recursive)
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn sftp_copy(
    state: State<'_, Arc<AppState>>,
    host_id: String,
    from: String,
    to: String,
) -> Result<(), AppError> {
    state.connections.sftp_copy(&host_id, &from, &to).await?;
    Ok(())
}

#[tauri::command]
pub async fn sftp_chmod(
    state: State<'_, Arc<AppState>>,
    host_id: String,
    path: String,
    mode: u32,
) -> Result<(), AppError> {
    state.connections.sftp_chmod(&host_id, &path, mode).await?;
    Ok(())
}

#[tauri::command]
pub async fn sftp_read(
    state: State<'_, Arc<AppState>>,
    host_id: String,
    path: String,
) -> Result<serde_json::Value, AppError> {
    let (content, mtime) = state.connections.sftp_read(&host_id, &path).await?;
    Ok(serde_json::json!({ "content": content, "mtime": mtime }))
}

#[tauri::command]
pub async fn sftp_write(
    state: State<'_, Arc<AppState>>,
    host_id: String,
    path: String,
    content: String,
    expected_mtime: Option<i64>,
) -> Result<serde_json::Value, AppError> {
    let mtime = state
        .connections
        .sftp_write(&host_id, &path, &content, expected_mtime)
        .await?;
    Ok(serde_json::json!({ "mtime": mtime }))
}

#[tauri::command]
pub async fn local_home() -> Result<String, AppError> {
    Ok(home_dir()?.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn local_list_dir(path: String) -> Result<Vec<SftpEntryDto>, AppError> {
    let root = if path.is_empty() || path == "." {
        home_dir()?
    } else {
        PathBuf::from(&path)
    };
    let mut rd = tokio::fs::read_dir(&root).await.map_err(|e| AppError::Io {
        message: e.to_string(),
    })?;
    let mut out = Vec::new();
    while let Some(entry) = rd.next_entry().await.map_err(|e| AppError::Io {
        message: e.to_string(),
    })? {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name == "." || name == ".." {
            continue;
        }
        let full = entry.path();
        let meta = entry.metadata().await.map_err(|e| AppError::Io {
            message: e.to_string(),
        })?;
        let is_dir = meta.is_dir();
        let size = if is_dir { 0 } else { meta.len() };
        #[cfg(unix)]
        let mode = {
            use std::os::unix::fs::PermissionsExt;
            meta.permissions().mode()
        };
        #[cfg(not(unix))]
        let mode = 0u32;
        out.push(entry_dto(
            name,
            full.to_string_lossy().into_owned(),
            is_dir,
            size,
            mode,
            file_mtime(&meta),
            0,
            0,
        ));
    }
    out.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(out)
}

#[tauri::command]
pub async fn local_mkdir(path: String) -> Result<(), AppError> {
    tokio::fs::create_dir_all(&path)
        .await
        .map_err(|e| AppError::Io {
            message: e.to_string(),
        })
}

#[tauri::command]
pub async fn local_rename(from: String, to: String) -> Result<(), AppError> {
    tokio::fs::rename(&from, &to)
        .await
        .map_err(|e| AppError::Io {
            message: e.to_string(),
        })
}

#[tauri::command]
pub async fn local_delete(path: String, recursive: bool) -> Result<(), AppError> {
    let meta = tokio::fs::metadata(&path).await.map_err(|e| AppError::Io {
        message: e.to_string(),
    })?;
    if meta.is_dir() {
        if recursive {
            tokio::fs::remove_dir_all(&path)
                .await
                .map_err(|e| AppError::Io {
                    message: e.to_string(),
                })
        } else {
            tokio::fs::remove_dir(&path)
                .await
                .map_err(|e| AppError::Io {
                    message: e.to_string(),
                })
        }
    } else {
        tokio::fs::remove_file(&path)
            .await
            .map_err(|e| AppError::Io {
                message: e.to_string(),
            })
    }
}

#[tauri::command]
pub async fn transfer_upload(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    host_id: String,
    local_path: String,
    remote_path: String,
) -> Result<String, AppError> {
    upload_one(&app, &state, &host_id, &local_path, &remote_path).await
}

#[tauri::command]
pub async fn transfer_upload_many(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    host_id: String,
    local_paths: Vec<String>,
    remote_dir: String,
) -> Result<Vec<String>, AppError> {
    let mut ids = Vec::new();
    for local_path in local_paths {
        ids.push(upload_one(&app, &state, &host_id, &local_path, &remote_dir).await?);
    }
    Ok(ids)
}

#[tauri::command]
pub async fn transfer_download(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    host_id: String,
    remote_path: String,
    local_path: String,
) -> Result<String, AppError> {
    download_one(&app, &state, &host_id, &remote_path, &local_path).await
}

#[tauri::command]
pub async fn transfers_list(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<TransferJobDto>, AppError> {
    let rows: Vec<(
        String,
        String,
        String,
        String,
        String,
        String,
        i64,
        i64,
        i64,
        i64,
        Option<String>,
    )> = sqlx::query_as(
        r#"SELECT id, host_id, kind, source_root, dest_root, status, total_bytes, transferred_bytes, total_items, done_items, error
           FROM transfer_jobs ORDER BY created_at DESC LIMIT 100"#,
    )
    .fetch_all(state.vault.pool())
    .await
    .map_err(|e| AppError::Db {
        engine: "sqlite".into(),
        message: e.to_string(),
    })?;
    Ok(rows
        .into_iter()
        .map(
            |(
                id,
                host_id,
                kind,
                source_root,
                dest_root,
                status,
                total_bytes,
                transferred_bytes,
                total_items,
                done_items,
                error,
            )| TransferJobDto {
                id,
                host_id,
                kind,
                source_root,
                dest_root,
                status,
                total_bytes,
                transferred_bytes,
                total_items,
                done_items,
                error,
            },
        )
        .collect())
}

#[tauri::command]
pub async fn transfer_pause(
    state: State<'_, Arc<AppState>>,
    job_id: String,
) -> Result<(), AppError> {
    sqlx::query("UPDATE transfer_jobs SET status = 'paused', updated_at = ? WHERE id = ?")
        .bind(chrono::Utc::now().timestamp_millis())
        .bind(&job_id)
        .execute(state.vault.pool())
        .await
        .map_err(|e| AppError::Db {
            engine: "sqlite".into(),
            message: e.to_string(),
        })?;
    Ok(())
}

#[tauri::command]
pub async fn transfer_resume(
    state: State<'_, Arc<AppState>>,
    job_id: String,
) -> Result<(), AppError> {
    sqlx::query("UPDATE transfer_jobs SET status = 'running', updated_at = ? WHERE id = ?")
        .bind(chrono::Utc::now().timestamp_millis())
        .bind(&job_id)
        .execute(state.vault.pool())
        .await
        .map_err(|e| AppError::Db {
            engine: "sqlite".into(),
            message: e.to_string(),
        })?;
    Ok(())
}

#[tauri::command]
pub async fn transfer_cancel(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    job_id: String,
) -> Result<(), AppError> {
    if let Some(flag) = cancel_flags().read().await.get(&job_id) {
        flag.store(true, Ordering::Relaxed);
    }

    let row: Option<(String, String, String, String, i64, i64)> = sqlx::query_as(
        r#"SELECT host_id, kind, source_root, dest_root, transferred_bytes, total_bytes
           FROM transfer_jobs WHERE id = ?"#,
    )
    .bind(&job_id)
    .fetch_optional(state.vault.pool())
    .await
    .map_err(|e| AppError::Db {
        engine: "sqlite".into(),
        message: e.to_string(),
    })?;

    let Some((host_id, kind, source, dest, transferred, total)) = row else {
        return Ok(());
    };

    mark_canceled(
        &app,
        &state,
        &job_id,
        &host_id,
        &kind,
        &source,
        &dest,
        transferred,
        total,
    )
    .await
}
