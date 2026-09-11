//! Policy tiers and decision outcomes.

use serde::{Deserialize, Serialize};

/// Risk tier assignment for tools and commands.
/// Ordered such that Safe < Write < Dangerous.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Tier {
    Safe,
    Write,
    Dangerous,
}

impl Tier {
    pub fn as_str(&self) -> &'static str {
        match self {
            Tier::Safe => "safe",
            Tier::Write => "write",
            Tier::Dangerous => "dangerous",
        }
    }
}

impl std::fmt::Display for Tier {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

/// Data payload for a pending approval requirement.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingApprovalData {
    pub tool: String,
    pub command_preview: Option<String>,
    pub risk_tier: Tier,
    pub risk_reasons: Vec<String>,
    pub can_grant_session: bool,
}

/// Outcome of policy engine evaluation.
#[derive(Debug, Clone)]
pub enum Decision {
    Allow,
    NeedsApproval(PendingApprovalData),
    Deny { code: &'static str, message: String },
}
