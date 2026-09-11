//! Single-use approval nonce primitives bound to client, host, tool, canonical arguments, and command bytes.

use sha2::{Digest, Sha256};
use uuid::Uuid;

/// Computes SHA-256 hash of canonical JSON string (keys sorted recursively, no insignificant whitespace).
pub fn hash_canonical_args(args: &serde_json::Value) -> [u8; 32] {
    let canonical_str = to_canonical_json_string(args);
    let mut hasher = Sha256::new();
    hasher.update(canonical_str.as_bytes());
    hasher.finalize().into()
}

/// Computes SHA-256 hash of raw command bytes.
pub fn hash_command_bytes(bytes: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hasher.finalize().into()
}

fn to_canonical_json_string(val: &serde_json::Value) -> String {
    match val {
        serde_json::Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            let entries: Vec<String> = keys
                .into_iter()
                .map(|k| {
                    format!(
                        "{}:{}",
                        serde_json::to_string(k).unwrap(),
                        to_canonical_json_string(&map[k])
                    )
                })
                .collect();
            format!("{{{}}}", entries.join(","))
        }
        serde_json::Value::Array(arr) => {
            let items: Vec<String> = arr.iter().map(to_canonical_json_string).collect();
            format!("[{}]", items.join(","))
        }
        other => serde_json::to_string(other).unwrap_or_default(),
    }
}

/// Single-use approval nonce.
#[derive(Debug, Clone)]
pub struct ApprovalNonce {
    pub id: Uuid,
    pub client_id: String,
    pub host_id: String,
    pub tool: String,
    pub args_hash: [u8; 32],
    pub command_hash: Option<[u8; 32]>,
    pub ruleset_version: u32,
    pub issued_at: i64,
    pub expires_at: i64,
    pub consumed: bool,
}

impl ApprovalNonce {
    pub fn new(
        client_id: String,
        host_id: String,
        tool: String,
        args: &serde_json::Value,
        command_bytes: Option<&[u8]>,
        ruleset_version: u32,
        ttl_secs: u64,
    ) -> Self {
        let now = chrono::Utc::now().timestamp_millis();
        let expires_at = now + (ttl_secs as i64 * 1000);
        Self {
            id: Uuid::now_v7(),
            client_id,
            host_id,
            tool,
            args_hash: hash_canonical_args(args),
            command_hash: command_bytes.map(hash_command_bytes),
            ruleset_version,
            issued_at: now,
            expires_at,
            consumed: false,
        }
    }

    /// Validates parameters against nonce binding and marks consumed if valid.
    pub fn verify_and_consume(
        &mut self,
        client_id: &str,
        host_id: &str,
        tool: &str,
        args: &serde_json::Value,
        command_bytes: Option<&[u8]>,
        now_ms: i64,
    ) -> Result<(), &'static str> {
        if self.consumed {
            return Err("Nonce already consumed");
        }
        if now_ms >= self.expires_at {
            return Err("Nonce expired");
        }
        if self.client_id != client_id {
            return Err("Client mismatch");
        }
        if self.host_id != host_id {
            return Err("Host mismatch");
        }
        if self.tool != tool {
            return Err("Tool mismatch");
        }
        if self.args_hash != hash_canonical_args(args) {
            return Err("Arguments hash mismatch");
        }
        if let Some(expected_cmd_hash) = self.command_hash {
            let Some(actual_bytes) = command_bytes else {
                return Err("Missing command bytes for exec tool");
            };
            if expected_cmd_hash != hash_command_bytes(actual_bytes) {
                return Err("Command bytes hash mismatch");
            }
        }

        self.consumed = true;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_canonical_args_hash_invariant_to_key_order() {
        let args1 = json!({ "b": 2, "a": 1 });
        let args2 = json!({ "a": 1, "b": 2 });
        assert_eq!(hash_canonical_args(&args1), hash_canonical_args(&args2));
    }

    #[test]
    fn test_nonce_verify_and_consume() {
        let args = json!({"path": "/var/log/app.log"});
        let cmd = b"rm -rf /var/log/app.log";
        let mut nonce = ApprovalNonce::new(
            "client1".into(),
            "host1".into(),
            "exec_command".into(),
            &args,
            Some(cmd),
            1,
            120,
        );

        let now = chrono::Utc::now().timestamp_millis();
        assert!(nonce
            .verify_and_consume("client1", "host1", "exec_command", &args, Some(cmd), now)
            .is_ok());

        // Replay attempt must fail
        assert!(nonce
            .verify_and_consume("client1", "host1", "exec_command", &args, Some(cmd), now)
            .is_err());
    }
}
