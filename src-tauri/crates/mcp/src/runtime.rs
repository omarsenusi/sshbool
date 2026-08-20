//! Process-wide MCP runtime flags (vault lock, kill switch, executor, sessions).

use crate::approval::{global_broker, ApprovalOutcome};
use crate::executor::McpToolExecutor;
use crate::session::SessionRegistry;
use crate::{McpNotifier, ServerState};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock, RwLock};

static MCP_RUNTIME: OnceLock<Arc<McpRuntimeState>> = OnceLock::new();

/// Shared MCP runtime state accessible from vault lock and server lifecycle hooks.
pub struct McpRuntimeState {
    vault_locked: AtomicBool,
    kill_switch: AtomicBool,
    executor: RwLock<Option<Arc<dyn McpToolExecutor>>>,
    notifier: RwLock<Option<Arc<dyn McpNotifier>>>,
    pub sessions: SessionRegistry,
    bind_port: RwLock<u16>,
}

impl McpRuntimeState {
    fn new() -> Self {
        Self {
            vault_locked: AtomicBool::new(false),
            kill_switch: AtomicBool::new(false),
            executor: RwLock::new(None),
            notifier: RwLock::new(None),
            sessions: SessionRegistry::new(),
            bind_port: RwLock::new(47821),
        }
    }

    pub fn global() -> Arc<Self> {
        MCP_RUNTIME
            .get_or_init(|| Arc::new(Self::new()))
            .clone()
    }

    pub fn set_notifier(&self, notifier: Arc<dyn McpNotifier>) {
        if let Ok(mut lock) = self.notifier.write() {
            *lock = Some(notifier);
        }
    }

    pub fn set_executor(&self, executor: Arc<dyn McpToolExecutor>) {
        if let Ok(mut lock) = self.executor.write() {
            *lock = Some(executor);
        }
    }

    pub fn set_bind_port(&self, port: u16) {
        if let Ok(mut lock) = self.bind_port.write() {
            *lock = port;
        }
    }

    pub fn executor(&self) -> Option<Arc<dyn McpToolExecutor>> {
        self.executor.read().ok().and_then(|g| g.clone())
    }

    pub fn notifier(&self) -> Option<Arc<dyn McpNotifier>> {
        self.notifier.read().ok().and_then(|g| g.clone())
    }

    pub fn is_vault_locked(&self) -> bool {
        self.vault_locked.load(Ordering::SeqCst)
    }

    pub fn is_kill_switch_active(&self) -> bool {
        self.kill_switch.load(Ordering::SeqCst)
    }

    pub fn set_vault_locked(&self, locked: bool) {
        self.vault_locked.store(locked, Ordering::SeqCst);
        if locked {
            global_broker().cancel_all(ApprovalOutcome::Revoked);
            self.sessions.clear();
        }
        self.emit_state(locked || self.is_kill_switch_active());
    }

    pub fn on_vault_lock(&self) {
        self.set_vault_locked(true);
    }

    pub fn clear_vault_lock(&self) {
        self.set_vault_locked(false);
    }

    pub fn activate_kill_switch(&self) {
        self.kill_switch.store(true, Ordering::SeqCst);
        global_broker().cancel_all(ApprovalOutcome::Revoked);
        self.sessions.clear();
        self.emit_state(true);
    }

    pub fn deactivate_kill_switch(&self) {
        self.kill_switch.store(false, Ordering::SeqCst);
        self.emit_state(self.is_vault_locked());
    }

    fn emit_state(&self, degraded: bool) {
        let port = self.bind_port.read().map(|p| *p).unwrap_or(47821);
        if let Ok(guard) = self.notifier.read() {
            if let Some(notifier) = guard.as_ref() {
                notifier.server_state_changed(&ServerState {
                    enabled: true,
                    port,
                    active_clients_count: 0,
                    degraded_vault_locked: degraded,
                });
            }
        }
    }
}
