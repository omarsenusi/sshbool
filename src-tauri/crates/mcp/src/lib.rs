//! SSHBool Model Context Protocol (MCP) Server Crate.
//!
//! Provides the core policy engine, risk classifier, approval broker, and data repository
//! for security-gated MCP integration over SSHBool infrastructure.

pub mod config;
pub mod error;
pub mod policy;
pub mod approval;
pub mod repo;
pub mod pairing;
pub mod protocol;
pub mod scope;
pub mod session;
pub mod tools;
pub mod transport;
pub mod server;
pub mod executor;
pub mod runtime;

pub use config::{LoopbackAddr, ServerConfig};
pub use error::McpError;
pub use server::McpServerHandle;

use serde::{Deserialize, Serialize};

/// Event payload when an MCP-managed terminal pane is ready.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaneReadyEvent {
    pub pane_id: String,
    pub session_id: String,
    pub host_id: String,
    pub label: String,
    pub show_terminal: bool,
    pub mcp_hidden: bool,
}

/// Event payload when approval is requested.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalRequest {
    pub id: String,
    pub client_id: String,
    pub client_name: String,
    pub host_id: Option<String>,
    pub host_label: Option<String>,
    pub production: bool,
    pub tool: String,
    pub command_preview: Option<String>,
    pub agent_reason: Option<String>,
    pub risk_tier: String,
    pub risk_reasons: Vec<String>,
    pub preview_output: Option<String>,
    pub grantable: bool,
    pub expires_at: i64,
}

/// Event payload when a tool call is recorded.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CallLogEntry {
    pub id: String,
    pub at: i64,
    pub client_id: Option<String>,
    pub client_name: Option<String>,
    pub host_id: Option<String>,
    pub host_label: Option<String>,
    pub tool: String,
    pub risk_tier: Option<String>,
    pub decision: String,
    pub duration_ms: Option<i64>,
    pub result_bytes: Option<i64>,
    pub error_code: Option<String>,
}

/// Event payload when MCP server state changes.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerState {
    pub enabled: bool,
    pub port: u16,
    pub active_clients_count: usize,
    pub degraded_vault_locked: bool,
}

/// Implemented by the top-level app crate over `tauri::AppHandle` to emit events without coupling `mcp` to `tauri`.
pub trait McpNotifier: Send + Sync + 'static {
    fn approval_requested(&self, req: &ApprovalRequest);
    fn call_recorded(&self, entry: &CallLogEntry);
    fn server_state_changed(&self, state: &ServerState);
    fn pane_ready(&self, event: &PaneReadyEvent);
}
