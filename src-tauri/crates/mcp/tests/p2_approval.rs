//! Phase 2 integration tests covering approval broker, nonce binding, session grants, and write-tier safety invariants.

use infrastructure::db::migrate;
use mcp::approval::grant::{CreateGrantParams, SessionGrant};
use mcp::approval::{
    hash_canonical_args, hash_command_bytes, ApprovalBroker, ApprovalOutcome, ApprovalResponse,
    ToolCallContext,
};
use mcp::policy::tier::Tier;
use mcp::repo::approvals::{consume_nonce, insert_approval, ApprovalRow};
use mcp::runtime::McpRuntimeState;
use mcp::tools::dispatch_tool_call;
use serde_json::json;
use sqlx::SqlitePool;
use uuid::Uuid;

async fn setup_test_db() -> SqlitePool {
    let pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
    migrate(&pool).await.unwrap();

    let now = chrono::Utc::now().timestamp_millis();

    // Insert dummy host
    sqlx::query("INSERT INTO hosts (id, label, hostname, port, auth_method, created_at, updated_at) VALUES ('host_1', 'Host 1', '127.0.0.1', 22, 'password', ?, ?)")
        .bind(now)
        .bind(now)
        .execute(&pool)
        .await
        .unwrap();

    // Insert dummy client
    sqlx::query("INSERT INTO mcp_clients (id, name, token_hash, token_issued_at, token_expires_at, mode, enabled, paired_at, updated_at) VALUES ('client_1', 'Client 1', 'hash_123', ?, ?, 'assisted', 1, ?, ?)")
        .bind(now)
        .bind(now + 3600000)
        .bind(now)
        .bind(now)
        .execute(&pool)
        .await
        .unwrap();

    // Grant host to client
    sqlx::query("INSERT INTO mcp_client_hosts (id, client_id, host_id, exec_allowed, write_allowed, granted_at) VALUES ('ch_1', 'client_1', 'host_1', 1, 1, ?)")
        .bind(now)
        .execute(&pool)
        .await
        .unwrap();

    pool
}

#[tokio::test]
async fn test_nonce_replay_attack_prevention() {
    let pool = setup_test_db().await;
    let now = chrono::Utc::now().timestamp_millis();
    let approval_id = Uuid::now_v7().to_string();

    let row = ApprovalRow {
        id: approval_id.clone(),
        client_id: "client_1".into(),
        host_id: Some("host_1".into()),
        session_handle: Some("mcp_sh_123".into()),
        tool: "exec_command".into(),
        args_hash: hex::encode(hash_canonical_args(&json!({ "command": "ls -l" }))),
        command_hash: Some(hex::encode(hash_command_bytes(b"ls -l"))),
        command_preview: Some("ls -l".into()),
        risk_tier: "write".into(),
        risk_reasons: None,
        ruleset_version: 1,
        preview_output: None,
        decision: "allow_once".into(),
        decided_by: Some("user".into()),
        decided_at: Some(now),
        nonce_hash: Some("nonce_123".into()),
        consumed_at: None,
        requested_at: now,
        expires_at: now + 60000,
    };

    insert_approval(&pool, &row).await.unwrap();

    let mut tx = pool.begin().await.unwrap();

    // 1st consumption succeeds
    let first = consume_nonce(&mut tx, &approval_id, now).await.unwrap();
    assert!(first, "First nonce consumption must succeed");
    tx.commit().await.unwrap();

    // 2nd consumption MUST fail (replay attack defense)
    let mut tx2 = pool.begin().await.unwrap();
    let second = consume_nonce(&mut tx2, &approval_id, now + 10)
        .await
        .unwrap();
    assert!(!second, "Second nonce consumption MUST be rejected");
}

#[tokio::test]
async fn test_session_grant_creation_and_consumption() {
    let mut grant = SessionGrant::new(CreateGrantParams {
        client_id: "client_1".into(),
        session_handle: "mcp_sh_100".into(),
        host_id: Some("host_1".into()),
        tool: "write_file".into(),
        tier: Tier::Write,
        is_production_host: false,
        arg_shape: "arg_shape_abc".into(),
        max_uses: 5,
        ttl_mins: 60,
        approval_id: Some("app_1".into()),
    })
    .unwrap();

    assert_eq!(grant.uses, 0);
    assert!(grant.use_grant().is_ok());
    assert_eq!(grant.uses, 1);

    // Consume remaining 4 times
    assert!(grant.use_grant().is_ok());
    assert!(grant.use_grant().is_ok());
    assert!(grant.use_grant().is_ok());
    assert!(grant.use_grant().is_ok());
    assert_eq!(grant.uses, 5);

    // 6th consume MUST fail
    assert!(grant.use_grant().is_err(), "Exceeding max_uses must fail");
}

#[tokio::test]
async fn test_sensitive_write_path_hard_denied() {
    let pool = setup_test_db().await;

    // Direct write to /etc/shadow
    let ctx = ToolCallContext {
        pool: pool.clone(),
        client_id: "client_1".into(),
        client_name: "Client 1".into(),
        mode: "assisted".into(),
        session_handle: None,
        notifier: None,
        approval_timeout_ms: 60_000,
        runtime: McpRuntimeState::global(),
    };
    let res = dispatch_tool_call(
        &ctx,
        "write_file",
        &json!({
            "host_id": "host_1",
            "path": "/etc/shadow",
            "content": "root:*:19000:0:99999:7:::"
        }),
    )
    .await;

    assert!(res.is_err());
    let err_str = res.unwrap_err().to_string();
    assert!(
        err_str.contains("sensitive"),
        "Writing to sensitive location must be denied: {err_str}"
    );
}

#[tokio::test]
async fn test_hard_deny_delete_protected_paths() {
    let pool = setup_test_db().await;

    // Delete root /
    let ctx = ToolCallContext {
        pool: pool.clone(),
        client_id: "client_1".into(),
        client_name: "Client 1".into(),
        mode: "assisted".into(),
        session_handle: None,
        notifier: None,
        approval_timeout_ms: 60_000,
        runtime: McpRuntimeState::global(),
    };
    let res = dispatch_tool_call(
        &ctx,
        "rm_path",
        &json!({
            "host_id": "host_1",
            "path": "/"
        }),
    )
    .await;

    assert!(res.is_err());
    let err_str = res.unwrap_err().to_string();
    assert!(
        err_str.contains("HARD_DENY"),
        "Deleting root path must be hard-denied: {err_str}"
    );
}

#[tokio::test]
async fn test_approval_broker_resolution() {
    let broker = ApprovalBroker::new();
    let id = Uuid::now_v7();

    let rx = broker.register(id);
    assert_eq!(broker.pending_count(), 1);

    let resolved = broker.resolve(
        id,
        ApprovalResponse {
            outcome: ApprovalOutcome::AllowOnce,
            decided_by: Some("user".into()),
        },
    );

    assert!(resolved);
    assert_eq!(broker.pending_count(), 0);

    let resp = rx.await.unwrap();
    assert_eq!(resp.outcome, ApprovalOutcome::AllowOnce);
}
