//! MCP error types and JSON-RPC error mapping.

use thiserror::Error;

/// Core error type for the MCP crate.
#[derive(Debug, Error)]
pub enum McpError {
    #[error("Non-loopback bind address rejected: {0}")]
    NonLoopbackBind(String),

    #[error("Vault is locked")]
    VaultLocked,

    #[error("MCP server stopped")]
    McpStopped,

    #[error("Forbidden origin/host: {0}")]
    ForbiddenOrigin(String),

    #[error("Unauthorized: {0}")]
    Unauthorized(String),

    #[error("Token expired")]
    TokenExpired,

    #[error("Client disabled")]
    ClientDisabled,

    #[error("Rate limited, retry after {retry_after_secs}s")]
    RateLimited { retry_after_secs: u64 },

    #[error("Payload too large")]
    PayloadTooLarge,

    #[error("Tool not available: {0}")]
    ToolNotAvailable(String),

    #[error("Forbidden: {0}")]
    Forbidden(String),

    #[error("Invalid arguments: {0}")]
    InvalidArguments(String),

    #[error("Session expired: {0}")]
    SessionExpired(String),

    #[error("Host not in scope: {0}")]
    HostNotInScope(String),

    #[error("Hard invariant violation denied: {0}")]
    HardDeny(String),

    #[error("Capability not granted: {0}")]
    CapabilityNotGranted(String),

    #[error("Approval denied: {0}")]
    ApprovalDenied(String),

    #[error("Stale mtime: {0}")]
    StaleMtime(String),

    #[error("Sensitive path read denied: {0}")]
    SensitivePathDenied(String),

    #[error("Plan token mismatch: {0}")]
    PlanTokenMismatch(String),

    #[error("Plan token required for unplanned dangerous call")]
    PlanTokenRequired,

    #[error("Execution timed out: {0}")]
    ExecTimeout(String),

    #[error("Database error: {0}")]
    Db(String),

    #[error("Internal error: {0}")]
    Internal(String),
}

impl From<sqlx::Error> for McpError {
    fn from(e: sqlx::Error) -> Self {
        McpError::Db(e.to_string())
    }
}

impl From<domain::DomainError> for McpError {
    fn from(e: domain::DomainError) -> Self {
        match e {
            domain::DomainError::NotFound { entity, id } => {
                McpError::InvalidArguments(format!("{entity} not found: {:?}", id))
            }
            domain::DomainError::Validation { field, message } => {
                McpError::InvalidArguments(format!("{field}: {message}"))
            }
            domain::DomainError::Unauthorized(_) => McpError::VaultLocked,
            domain::DomainError::Conflict(msg) if msg.contains("changed on disk") => {
                McpError::StaleMtime(msg)
            }
            domain::DomainError::Conflict(msg) => McpError::Internal(msg),
            domain::DomainError::Crypto(msg) => McpError::Internal(msg),
            domain::DomainError::Canceled => McpError::ApprovalDenied("canceled".into()),
            domain::DomainError::FingerprintUnknown { host, .. } => {
                McpError::HostNotInScope(host)
            }
            domain::DomainError::HostKeyChanged { host, .. } => {
                McpError::HostNotInScope(host)
            }
        }
    }
}
