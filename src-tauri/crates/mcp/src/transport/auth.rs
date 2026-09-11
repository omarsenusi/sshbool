//! Bearer token authentication logic using constant-time comparison.

use crate::error::McpError;
use crate::repo::clients::{get_client_by_token_hash, ClientRow};
use sha2::{Digest, Sha256};
use sqlx::SqlitePool;
use subtle::ConstantTimeEq;

/// Extracts and validates bearer token string.
pub fn hash_token(token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    hex::encode(hasher.finalize())
}

/// Authenticates a raw `Authorization: Bearer sbmcp_...` header string against DB.
pub async fn authenticate_bearer_token(
    pool: &SqlitePool,
    token: &str,
) -> Result<ClientRow, McpError> {
    if !token.starts_with("sbmcp_") || token.len() < 30 {
        return Err(McpError::Unauthorized("Invalid token format".into()));
    }

    let token_hash = hash_token(token);
    let client = get_client_by_token_hash(pool, &token_hash)
        .await?
        .ok_or_else(|| McpError::Unauthorized("Invalid or revoked token".into()))?;

    // Verify token hash match in constant time
    let computed = hash_token(token);
    if computed
        .as_bytes()
        .ct_eq(client.token_hash.as_bytes())
        .unwrap_u8()
        != 1
    {
        return Err(McpError::Unauthorized("Invalid token".into()));
    }

    if client.enabled == 0 {
        return Err(McpError::ClientDisabled);
    }

    if let Some(reason) = &client.suspended_reason {
        return Err(McpError::Unauthorized(format!(
            "Client suspended: {reason}"
        )));
    }

    let now = chrono::Utc::now().timestamp_millis();
    if now >= client.token_expires_at {
        return Err(McpError::TokenExpired);
    }

    Ok(client)
}
