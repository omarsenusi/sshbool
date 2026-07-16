//! Infrastructure adapters: persistence, crypto, SSH.

pub mod crypto;
pub mod db;
pub mod ssh;
pub mod state;
pub mod vault;

pub use state::AppState;
