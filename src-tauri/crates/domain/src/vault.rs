//! Vault domain types and ports.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use crate::error::DomainError;
use crate::ids::{CredentialId, KeyId};

/// Vault lock status.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultStatus {
    /// Whether a vault row exists.
    pub initialized: bool,
    /// Whether the DEK is not in memory.
    pub locked: bool,
    /// Biometric unlock enabled.
    pub biometric: bool,
}

/// SSH key metadata (never includes private material).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshKeyMeta {
    /// Id.
    pub id: KeyId,
    /// Display name.
    pub name: String,
    /// Key algorithm.
    pub key_type: String,
    /// OpenSSH public key.
    pub public_key: String,
    /// SHA256 fingerprint.
    pub fingerprint_sha256: String,
    /// Comment.
    pub comment: Option<String>,
    /// Has passphrase.
    pub has_passphrase: bool,
    /// Hardware-backed.
    pub hardware_backed: bool,
    /// Source.
    pub source: String,
    /// Created at epoch ms.
    pub created_at: i64,
}

/// Credential metadata (no secret).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CredentialMeta {
    /// Id.
    pub id: CredentialId,
    /// Name.
    pub name: String,
    /// Kind.
    pub kind: String,
    /// Created at.
    pub created_at: i64,
}

/// Port for vault operations.
#[async_trait]
pub trait VaultPort: Send + Sync {
    /// Current status.
    async fn status(&self) -> Result<VaultStatus, DomainError>;
    /// Initialize vault with master password.
    async fn init(&self, password: &str) -> Result<(), DomainError>;
    /// Unlock with password.
    async fn unlock(&self, password: &str) -> Result<(), DomainError>;
    /// Lock and zeroize keys.
    async fn lock(&self) -> Result<(), DomainError>;
}
