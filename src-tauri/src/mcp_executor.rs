//! App-level MCP tool executor over `ConnectionManager`.

use async_trait::async_trait;
use infrastructure::AppState;
use mcp::error::McpError;
use mcp::executor::McpToolExecutor;
use mcp::runtime::McpRuntimeState;
use mcp::{PaneReadyEvent};
use serde_json::{json, Value};
use std::sync::Arc;

const MCP_PANE_COLS: u32 = 120;
const MCP_PANE_ROWS: u32 = 40;

pub struct AppMcpExecutor {
    state: Arc<AppState>,
    runtime: Arc<McpRuntimeState>,
}

impl AppMcpExecutor {
    pub fn new(state: Arc<AppState>, runtime: Arc<McpRuntimeState>) -> Self {
        Self { state, runtime }
    }

    fn emit_pane_ready(
        &self,
        pane_id: &str,
        session_id: &str,
        host_id: &str,
        label: &str,
        show_terminal: bool,
    ) {
        if let Some(notifier) = self.runtime.notifier() {
            notifier.pane_ready(&PaneReadyEvent {
                    pane_id: pane_id.to_string(),
                    session_id: session_id.to_string(),
                    host_id: host_id.to_string(),
                    label: label.to_string(),
                    show_terminal,
                    mcp_hidden: !show_terminal,
                });
        }
    }

    async fn host_label(&self, host_id: &str) -> String {
        sqlx::query_scalar::<_, String>("SELECT label FROM hosts WHERE id = ?")
            .bind(host_id)
            .fetch_optional(self.state.vault.pool())
            .await
            .ok()
            .flatten()
            .unwrap_or_else(|| host_id.to_string())
    }

    async fn ensure_mcp_pane(
        &self,
        host_id: &str,
        show_terminal: bool,
    ) -> Result<(String, String, bool), McpError> {
        if let Some(pane_id) = self.state.connections.find_pane_for_host(host_id).await {
            let panes = self.state.connections.sessions_list().await;
            let session_id = panes
                .iter()
                .find(|(pid, _, _, _)| pid == &pane_id)
                .map(|(_, sid, _, _)| sid.clone())
                .unwrap_or_default();
            self.emit_pane_ready(
                &pane_id,
                &session_id,
                host_id,
                &self.host_label(host_id).await,
                show_terminal,
            );
            return Ok((pane_id, session_id, false));
        }

        let (pane_id, session_id) = self
            .state
            .connections
            .pane_open_mcp(host_id, MCP_PANE_COLS, MCP_PANE_ROWS)
            .await
            .map_err(|e| McpError::Internal(e.to_string()))?;
        let label = self.host_label(host_id).await;
        self.emit_pane_ready(
            &pane_id,
            &session_id,
            host_id,
            &label,
            show_terminal,
        );
        Ok((pane_id, session_id, true))
    }
}

#[async_trait]
impl McpToolExecutor for AppMcpExecutor {
    async fn sftp_list_dir(&self, host_id: &str, path: &str) -> Result<Value, McpError> {
        let entries = self
            .state
            .connections
            .sftp_list_dir(host_id, path)
            .await?;
        let items: Vec<Value> = entries
            .iter()
            .map(|e| {
                json!({
                    "name": e.name,
                    "path": e.path,
                    "isDir": e.is_dir,
                    "size": e.size,
                    "mode": e.mode,
                    "mtime": e.mtime,
                })
            })
            .collect();
        Ok(json!({ "entries": items }))
    }

    async fn sftp_stat(&self, host_id: &str, path: &str) -> Result<Value, McpError> {
        let e = self.state.connections.sftp_stat(host_id, path).await?;
        Ok(json!({
            "name": e.name,
            "path": e.path,
            "isDir": e.is_dir,
            "size": e.size,
            "mode": e.mode,
            "mtime": e.mtime,
        }))
    }

    async fn sftp_read_preview(
        &self,
        host_id: &str,
        path: &str,
        max_bytes: u64,
    ) -> Result<Value, McpError> {
        let (content, mtime) = self
            .state
            .connections
            .sftp_read(host_id, path)
            .await?;
        let truncated = if content.len() as u64 > max_bytes {
            content[..max_bytes as usize].to_string()
        } else {
            content
        };
        Ok(json!({ "path": path, "content": truncated, "mtime": mtime }))
    }

    async fn sftp_write(
        &self,
        host_id: &str,
        path: &str,
        content: &str,
        expected_mtime: Option<i64>,
    ) -> Result<Value, McpError> {
        let mtime = self
            .state
            .connections
            .sftp_write(host_id, path, content, expected_mtime)
            .await?;
        Ok(json!({ "path": path, "mtime": mtime, "status": "written" }))
    }

    async fn sftp_write_bytes(
        &self,
        host_id: &str,
        path: &str,
        content: &[u8],
        expected_mtime: Option<i64>,
    ) -> Result<Value, McpError> {
        let mtime = self
            .state
            .connections
            .sftp_write_bytes(host_id, path, content, expected_mtime)
            .await?;
        Ok(json!({ "path": path, "mtime": mtime, "status": "written" }))
    }

    async fn sftp_mkdir(&self, host_id: &str, path: &str) -> Result<Value, McpError> {
        self.state.connections.sftp_mkdir(host_id, path).await?;
        Ok(json!({ "path": path, "status": "created" }))
    }

    async fn sftp_delete(
        &self,
        host_id: &str,
        path: &str,
        recursive: bool,
    ) -> Result<Value, McpError> {
        self.state
            .connections
            .sftp_delete(host_id, path, recursive)
            .await?;
        Ok(json!({ "path": path, "status": "deleted" }))
    }

    async fn sftp_rename(&self, host_id: &str, from: &str, to: &str) -> Result<Value, McpError> {
        self.state
            .connections
            .sftp_rename(host_id, from, to)
            .await?;
        Ok(json!({ "from": from, "to": to, "status": "renamed" }))
    }

    async fn sftp_chmod(&self, host_id: &str, path: &str, mode: u32) -> Result<Value, McpError> {
        self.state
            .connections
            .sftp_chmod(host_id, path, mode)
            .await?;
        Ok(json!({ "path": path, "mode": mode, "status": "chmod" }))
    }

    async fn open_session(
        &self,
        host_id: &str,
        show_terminal: bool,
    ) -> Result<Value, McpError> {
        let (pane_id, session_id, created) = self.ensure_mcp_pane(host_id, show_terminal).await?;
        let label = self.host_label(host_id).await;
        let production: i64 = sqlx::query_scalar("SELECT production FROM hosts WHERE id = ?")
            .bind(host_id)
            .fetch_optional(self.state.vault.pool())
            .await
            .ok()
            .flatten()
            .unwrap_or(0);

        Ok(json!({
            "pane_id": pane_id,
            "session_id": session_id,
            "host_id": host_id,
            "host_label": label,
            "production": production != 0,
            "pane_created": created,
            "show_terminal": show_terminal,
        }))
    }

    async fn exec_command(
        &self,
        host_id: &str,
        command: &str,
        show_terminal: bool,
        timeout_ms: u64,
    ) -> Result<Value, McpError> {
        let (pane_id, _, _) = self.ensure_mcp_pane(host_id, show_terminal).await?;
        match self
            .state
            .connections
            .exec_in_pane(&pane_id, command, timeout_ms)
            .await
        {
            Ok(output) if !output.trim().is_empty() => Ok(json!({
                "stdout": output,
                "status": "executed",
                "pane_id": pane_id,
                "mode": "pane",
            })),
            Ok(_) | Err(_) => {
                let output = self
                    .state
                    .connections
                    .exec_command(host_id, command)
                    .await
                    .map_err(|e| McpError::Internal(e.to_string()))?;
                Ok(json!({
                    "stdout": output,
                    "status": "executed",
                    "pane_id": pane_id,
                    "mode": "headless_fallback",
                }))
            }
        }
    }

    async fn exec_command_readonly(
        &self,
        host_id: &str,
        command: &str,
        show_terminal: bool,
        timeout_ms: u64,
    ) -> Result<Value, McpError> {
        self.exec_command(host_id, command, show_terminal, timeout_ms)
            .await
    }
}
