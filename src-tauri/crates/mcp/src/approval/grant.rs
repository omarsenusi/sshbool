//! Session-scoped grant primitives for bounded WRITE tier authorizations.

use crate::policy::tier::Tier;
use sha2::{Digest, Sha256};
use uuid::Uuid;

/// Parameters for creating a new SessionGrant.
#[derive(Debug, Clone)]
pub struct CreateGrantParams {
    pub client_id: String,
    pub session_handle: String,
    pub host_id: Option<String>,
    pub tool: String,
    pub tier: Tier,
    pub is_production_host: bool,
    pub arg_shape: String,
    pub max_uses: u32,
    pub ttl_mins: u64,
    pub approval_id: Option<String>,
}

/// Session-scoped grant authorization.
#[derive(Debug, Clone)]
pub struct SessionGrant {
    pub id: String,
    pub client_id: String,
    pub session_handle: String,
    pub host_id: Option<String>,
    pub tool: String,
    pub arg_shape_hash: [u8; 32],
    pub max_uses: u32,
    pub uses: u32,
    pub approval_id: Option<String>,
    pub created_at: i64,
    pub expires_at: i64,
    pub revoked_at: Option<i64>,
}

impl SessionGrant {
    pub fn new(params: CreateGrantParams) -> Result<Self, &'static str> {
        if params.tier == Tier::Dangerous {
            return Err("Session grants are forbidden for DANGEROUS tier operations");
        }
        if params.is_production_host {
            return Err("Session grants are forbidden on production hosts");
        }

        let now = chrono::Utc::now().timestamp_millis();
        let bounded_ttl = params.ttl_mins.clamp(1, 60);
        let expires_at = now + (bounded_ttl as i64 * 60 * 1000);

        let mut hasher = Sha256::new();
        hasher.update(params.arg_shape.as_bytes());
        let arg_shape_hash = hasher.finalize().into();

        Ok(Self {
            id: Uuid::now_v7().to_string(),
            client_id: params.client_id,
            session_handle: params.session_handle,
            host_id: params.host_id,
            tool: params.tool,
            arg_shape_hash,
            max_uses: params.max_uses.clamp(1, 100),
            uses: 0,
            approval_id: params.approval_id,
            created_at: now,
            expires_at,
            revoked_at: None,
        })
    }

    pub fn is_valid(&self, client_id: &str, session_handle: &str, tool: &str, arg_shape: &str, now_ms: i64) -> bool {
        if self.revoked_at.is_some() {
            return false;
        }
        if self.uses >= self.max_uses {
            return false;
        }
        if now_ms >= self.expires_at {
            return false;
        }
        if self.client_id != client_id || self.session_handle != session_handle || self.tool != tool {
            return false;
        }

        let mut hasher = Sha256::new();
        hasher.update(arg_shape.as_bytes());
        let hash: [u8; 32] = hasher.finalize().into();

        self.arg_shape_hash == hash
    }

    pub fn use_grant(&mut self) -> Result<(), &'static str> {
        if self.uses >= self.max_uses {
            return Err("Grant max uses reached");
        }
        self.uses += 1;
        Ok(())
    }
}
