//! Phase 4 integration tests covering audit atomic failure, red-team corpus validation, and AST secret exposure invariants.

use infrastructure::db::migrate;
use mcp::protocol::handlers::handle_protocol_request;
use mcp::protocol::jsonrpc::{JsonRpcRequest, RequestId};
use mcp::{ApprovalRequest, CallLogEntry, McpNotifier, ServerState};
use serde_json::json;
use sqlx::SqlitePool;
use std::sync::Arc;

struct TestNotifier;

impl McpNotifier for TestNotifier {
    fn approval_requested(&self, _req: &ApprovalRequest) {}
    fn call_recorded(&self, _entry: &CallLogEntry) {}
    fn server_state_changed(&self, _state: &ServerState) {}
    fn pane_ready(&self, _event: &mcp::PaneReadyEvent) {}
}

async fn setup_test_db() -> SqlitePool {
    let pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
    migrate(&pool).await.unwrap();

    let now = chrono::Utc::now().timestamp_millis();
    sqlx::query("INSERT INTO mcp_clients (id, name, token_hash, token_issued_at, token_expires_at, mode, enabled, paired_at, updated_at) VALUES ('client_1', 'Client 1', 'hash_123', ?, ?, 'read_only', 1, ?, ?)")
        .bind(now)
        .bind(now + 3600000)
        .bind(now)
        .bind(now)
        .execute(&pool)
        .await
        .unwrap();

    pool
}

#[tokio::test]
async fn test_audit_write_atomic_ledger_recording() {
    let pool = setup_test_db().await;
    let notifier: Arc<dyn McpNotifier> = Arc::new(TestNotifier);

    let req = JsonRpcRequest {
        jsonrpc: "2.0".into(),
        id: Some(RequestId::Number(1)),
        method: "tools/call".into(),
        params: json!({ "name": "ping", "arguments": {} }),
    };

    let resp = handle_protocol_request(
        &pool,
        "client_1",
        "TestClient",
        "read_only",
        &notifier,
        60_000,
        req,
    )
    .await;

    assert!(
        resp.error.is_none(),
        "Response must succeed, got error: {:?}",
        resp.error
    );

    // Verify call was recorded in mcp_calls table
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM mcp_calls")
        .fetch_one(&pool)
        .await
        .unwrap();

    assert_eq!(
        count, 1,
        "Call ledger must contain exactly 1 recorded entry"
    );

    let audit_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM audit_log WHERE action = 'mcp.tool_call'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(audit_count, 1, "audit_log must contain matching MCP entry");
}

#[tokio::test]
async fn test_failed_audit_fails_call() {
    let pool = setup_test_db().await;
    let notifier: Arc<dyn McpNotifier> = Arc::new(TestNotifier);

    // Drop audit_log table to simulate audit write failure
    sqlx::query("DROP TABLE audit_log")
        .execute(&pool)
        .await
        .unwrap();

    let req = JsonRpcRequest {
        jsonrpc: "2.0".into(),
        id: Some(RequestId::Number(2)),
        method: "tools/call".into(),
        params: json!({ "name": "ping", "arguments": {} }),
    };

    let resp = handle_protocol_request(
        &pool,
        "client_1",
        "TestClient",
        "read_only",
        &notifier,
        60_000,
        req,
    )
    .await;

    assert!(
        resp.error.is_some(),
        "Call must fail when audit write fails"
    );
    let call_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM mcp_calls")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        call_count, 0,
        "Failed audit must not leave orphan mcp_calls row"
    );
}
