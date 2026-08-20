//! Per-client budget definitions and default limits.

use serde::{Deserialize, Serialize};

/// Budget parameters for a paired client.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClientBudget {
    pub client_id: String,
    pub calls_per_min: u32,
    pub execs_per_min: u32,
    pub concurrent_calls: u32,
    pub concurrent_execs: u32,
    pub max_handles: u32,
    pub max_result_bytes: u32,
    pub exec_timeout_ms: u64,
    pub max_pending_approvals: u32,
    pub approvals_per_hour: u32,
    pub handle_idle_ms: u64,
    pub handle_max_ms: u64,
    pub updated_at: i64,
}

impl ClientBudget {
    pub fn default_for_client(client_id: impl Into<String>) -> Self {
        Self {
            client_id: client_id.into(),
            calls_per_min: 60,
            execs_per_min: 10,
            concurrent_calls: 4,
            concurrent_execs: 2,
            max_handles: 8,
            max_result_bytes: 262_144, // 256 KiB
            exec_timeout_ms: 60_000,
            max_pending_approvals: 3,
            approvals_per_hour: 40,
            handle_idle_ms: 600_000,   // 10 minutes
            handle_max_ms: 3_600_000,  // 60 minutes
            updated_at: chrono::Utc::now().timestamp_millis(),
        }
    }
}
