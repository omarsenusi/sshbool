//! Remote execution trait — implemented by the app crate over `ConnectionManager`.

use async_trait::async_trait;
use serde_json::Value;

use crate::error::McpError;

/// SSH/SFTP operations invoked by MCP tool handlers.
#[async_trait]
pub trait McpToolExecutor: Send + Sync + 'static {
    async fn sftp_list_dir(&self, host_id: &str, path: &str) -> Result<Value, McpError>;
    async fn sftp_stat(&self, host_id: &str, path: &str) -> Result<Value, McpError>;
    async fn sftp_read_preview(
        &self,
        host_id: &str,
        path: &str,
        max_bytes: u64,
    ) -> Result<Value, McpError>;
    async fn sftp_write(
        &self,
        host_id: &str,
        path: &str,
        content: &str,
        expected_mtime: Option<i64>,
    ) -> Result<Value, McpError>;
    async fn sftp_write_bytes(
        &self,
        host_id: &str,
        path: &str,
        content: &[u8],
        expected_mtime: Option<i64>,
    ) -> Result<Value, McpError>;
    async fn sftp_mkdir(&self, host_id: &str, path: &str) -> Result<Value, McpError>;
    async fn sftp_delete(
        &self,
        host_id: &str,
        path: &str,
        recursive: bool,
    ) -> Result<Value, McpError>;
    async fn sftp_rename(&self, host_id: &str, from: &str, to: &str) -> Result<Value, McpError>;
    async fn sftp_chmod(&self, host_id: &str, path: &str, mode: u32) -> Result<Value, McpError>;
    async fn open_session(&self, host_id: &str, show_terminal: bool) -> Result<Value, McpError>;
    async fn exec_command(
        &self,
        host_id: &str,
        command: &str,
        show_terminal: bool,
        timeout_ms: u64,
    ) -> Result<Value, McpError>;
    async fn exec_command_readonly(
        &self,
        host_id: &str,
        command: &str,
        show_terminal: bool,
        timeout_ms: u64,
    ) -> Result<Value, McpError>;
}
