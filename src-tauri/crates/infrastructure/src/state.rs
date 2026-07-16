//! Shared app state: vault + connections + event sink hook.

use std::collections::HashMap;
use std::sync::Arc;

use sqlx::SqlitePool;
use tokio::sync::RwLock;

use crate::db::{default_db_path, migrate, open_pool};
use crate::ssh::ConnectionManager;
use crate::vault::VaultService;
use domain::DomainError;

/// Process-wide application state.
pub struct AppState {
    /// Vault.
    pub vault: Arc<VaultService>,
    /// DB pool (same as vault).
    pub pool: SqlitePool,
    /// SSH connections.
    pub connections: Arc<ConnectionManager>,
    /// Host id -> session id.
    pub host_sessions: RwLock<HashMap<String, String>>,
}

impl AppState {
    /// Bootstrap DB, migrations, vault, connection manager.
    pub async fn bootstrap() -> Result<Arc<Self>, DomainError> {
        let path = default_db_path();
        let pool = open_pool(&path).await?;
        migrate(&pool).await?;
        let vault = VaultService::new(pool.clone());
        let connections = ConnectionManager::new(vault.clone());
        Ok(Arc::new(Self {
            vault,
            pool,
            connections,
            host_sessions: RwLock::new(HashMap::new()),
        }))
    }
}
