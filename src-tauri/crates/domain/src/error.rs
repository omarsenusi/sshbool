//! Domain error types.

use thiserror::Error;

/// Errors originating in the domain layer.
#[derive(Debug, Error)]
pub enum DomainError {
    /// Entity was not found.
    #[error("{entity} not found")]
    NotFound {
        /// Entity name.
        entity: &'static str,
        /// Optional id.
        id: Option<String>,
    },
    /// Validation failure.
    #[error("{field}: {message}")]
    Validation {
        /// Field name.
        field: String,
        /// Message.
        message: String,
    },
    /// Conflict / invariant violation.
    #[error("{0}")]
    Conflict(String),
    /// Vault is locked or password is wrong.
    #[error("unauthorized: {0}")]
    Unauthorized(&'static str),
    /// Cryptographic failure.
    #[error("crypto: {0}")]
    Crypto(String),
    /// Operation was canceled by the user.
    #[error("canceled")]
    Canceled,
}
