//! Server handle managing the lifecycle of the loopback MCP HTTP/SSE server.

use crate::config::ServerConfig;
use crate::error::McpError;
use crate::executor::McpToolExecutor;
use crate::runtime::McpRuntimeState;
use crate::transport::http::{create_router, AppState};
use crate::{McpNotifier, ServerState};
use sqlx::SqlitePool;
use std::sync::{Arc, Mutex};
use tokio::net::TcpListener;
use tokio_util::sync::CancellationToken;

/// Managed runtime handle for the MCP server.
#[derive(Clone)]
pub struct McpServerHandle {
    config: ServerConfig,
    _pool: SqlitePool,
    _notifier: Arc<dyn McpNotifier>,
    cancel_token: CancellationToken,
    running: Arc<Mutex<bool>>,
}

impl McpServerHandle {
    pub async fn start(
        config: ServerConfig,
        pool: SqlitePool,
        notifier: Arc<dyn McpNotifier>,
        executor: Arc<dyn McpToolExecutor>,
    ) -> Result<Self, McpError> {
        let runtime = McpRuntimeState::global();
        runtime.set_notifier(notifier.clone());
        runtime.set_executor(executor);
        runtime.set_bind_port(config.bind_addr.port());
        runtime.deactivate_kill_switch();
        if !runtime.is_vault_locked() {
            // vault may still be locked from prior session; leave flag as-is until unlock
        }

        let bind_addr = config.bind_addr.addr();
        let listener = TcpListener::bind(bind_addr)
            .await
            .map_err(|e| McpError::NonLoopbackBind(format!("Failed to bind {bind_addr}: {e}")))?;

        let cancel_token = CancellationToken::new();
        let running = Arc::new(Mutex::new(true));

        let app_state = Arc::new(AppState {
            pool: pool.clone(),
            bind_port: config.bind_addr.port(),
            notifier: notifier.clone(),
            approval_timeout_ms: config.approval_timeout_ms,
            runtime: runtime.clone(),
        });

        let router = create_router(app_state);

        let cancel_child = cancel_token.clone();
        let running_child = running.clone();
        let notifier_child = notifier.clone();
        let port = config.bind_addr.port();
        let degraded = runtime.is_vault_locked() || runtime.is_kill_switch_active();

        tokio::spawn(async move {
            tracing::info!("MCP Server listening on http://{}", bind_addr);
            notifier_child.server_state_changed(&ServerState {
                enabled: true,
                port,
                active_clients_count: 0,
                degraded_vault_locked: degraded,
            });

            axum::serve(listener, router)
                .with_graceful_shutdown(async move {
                    cancel_child.cancelled().await;
                })
                .await
                .ok();

            let mut lock = running_child.lock().unwrap();
            *lock = false;

            notifier_child.server_state_changed(&ServerState {
                enabled: false,
                port,
                active_clients_count: 0,
                degraded_vault_locked: false,
            });
            tracing::info!("MCP Server shut down.");
        });

        Ok(Self {
            config,
            _pool: pool,
            _notifier: notifier,
            cancel_token,
            running,
        })
    }

    pub fn stop(&self) {
        self.cancel_token.cancel();
        let mut lock = self.running.lock().unwrap();
        *lock = false;
    }

    pub fn is_running(&self) -> bool {
        *self.running.lock().unwrap()
    }

    pub fn port(&self) -> u16 {
        self.config.bind_addr.port()
    }
}
