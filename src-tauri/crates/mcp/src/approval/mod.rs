//! Approval broker primitives, nonce handling, and session grants.

pub mod gate;
pub mod grant;
pub mod nonce;

pub use gate::{gate_dangerous_tool, gate_write_tool, GateResult, ToolCallContext};

pub use grant::SessionGrant;
pub use nonce::{hash_canonical_args, hash_command_bytes, ApprovalNonce};

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use tokio::sync::oneshot;
use uuid::Uuid;

static GLOBAL_BROKER: OnceLock<ApprovalBroker> = OnceLock::new();

pub fn global_broker() -> &'static ApprovalBroker {
    GLOBAL_BROKER.get_or_init(ApprovalBroker::new)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ApprovalOutcome {
    AllowOnce,
    AllowSession,
    Deny,
    Timeout,
    Revoked,
}

#[derive(Debug, Clone)]
pub struct ApprovalResponse {
    pub outcome: ApprovalOutcome,
    pub decided_by: Option<String>,
}

/// Actor holding in-flight approval requests awaiting human GUI input.
#[derive(Clone, Default)]
pub struct ApprovalBroker {
    pending: Arc<Mutex<HashMap<Uuid, oneshot::Sender<ApprovalResponse>>>>,
}

impl ApprovalBroker {
    pub fn new() -> Self {
        Self {
            pending: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Registers a pending approval request and returns a oneshot receiver for the decision.
    pub fn register(&self, id: Uuid) -> oneshot::Receiver<ApprovalResponse> {
        let (tx, rx) = oneshot::channel();
        let mut map = self.pending.lock().expect("approval broker lock");
        map.insert(id, tx);
        rx
    }

    /// Resolves a pending approval with a human response. Returns true if request was present.
    pub fn resolve(&self, id: Uuid, response: ApprovalResponse) -> bool {
        let sender = {
            let mut map = self.pending.lock().expect("approval broker lock");
            map.remove(&id)
        };
        if let Some(tx) = sender {
            let _ = tx.send(response);
            true
        } else {
            false
        }
    }

    /// Cancels all pending approval requests (e.g. on vault lock or kill switch).
    pub fn cancel_all(&self, reason: ApprovalOutcome) {
        let senders = {
            let mut map = self.pending.lock().expect("approval broker lock");
            std::mem::take(&mut *map)
        };
        for (_id, tx) in senders {
            let _ = tx.send(ApprovalResponse {
                outcome: reason.clone(),
                decided_by: Some("system".into()),
            });
        }
    }

    /// Returns the number of currently pending approvals.
    pub fn pending_count(&self) -> usize {
        let map = self.pending.lock().expect("approval broker lock");
        map.len()
    }
}
