//! Infrastructure adapters: persistence, crypto, SSH, shell safety, redaction, and audit.

pub mod audit;
pub mod crypto;
pub mod db;
pub mod redact;
pub mod shellsafe;
pub mod ssh;
pub mod state;
pub mod vault;

pub use audit::audit;
pub use redact::redact;
pub use shellsafe::*;
pub use state::AppState;
