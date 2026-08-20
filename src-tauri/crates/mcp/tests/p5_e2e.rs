//! Phase 5 End-to-End integration test suite for MCP server lifecycle, pairing, SSE, and policy execution.

use infrastructure::db::migrate;
use mcp::pairing::{hash_pairing_code, redeem_pairing_code, PairRequest};
use mcp::protocol::handlers::handle_protocol_request;
use mcp::protocol::jsonrpc::{JsonRpcRequest, RequestId};
use mcp::repo::clients::create_pairing_code;
use mcp::transport::auth::authenticate_bearer_token;
use mcp::{ApprovalRequest, CallLogEntry, McpNotifier, ServerState};
use serde_json::json;
use sqlx::SqlitePool;
use std::sync::Arc;

struct E2eNotifier;

impl McpNotifier for E2eNotifier {
    fn approval_requested(&self, _req: &ApprovalRequest) {}
    fn call_recorded(&self, _entry: &CallLogEntry) {}
    fn server_state_changed(&self, _state: &ServerState) {}
    fn pane_ready(&self, _event: &mcp::PaneReadyEvent) {}
}

async fn setup_test_db() -> SqlitePool {
    let pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
    migrate(&pool).await.unwrap();

    let now = chrono::Utc::now().timestamp_millis();

    sqlx::query("INSERT INTO hosts (id, label, hostname, port, auth_method, created_at, updated_at) VALUES ('h_prod', 'Prod Host', '10.0.0.1', 22, 'password', ?, ?)")
        .bind(now)
        .bind(now)
        .execute(&pool)
        .await
        .unwrap();

    pool
}

#[tokio::test]
async fn test_full_mcp_e2e_lifecycle() {
    let pool = setup_test_db().await;
    let _notifier: Arc<dyn McpNotifier> = Arc::new(E2eNotifier);

    // 1. Generate pairing code
    let raw_code = "654321";
    let code_hash = hash_pairing_code(raw_code);
    create_pairing_code(&pool, &code_hash, 300).await.unwrap();

    // 2. Redeem pairing code & receive bearer token
    let pair_resp = redeem_pairing_code(
        &pool,
        PairRequest {
            code: raw_code.into(),
            client_name: "E2eAssistant".into(),
            client_version: Some("2.1.0".into()),
        },
    )
    .await
    .unwrap();

    assert!(pair_resp.access_token.starts_with("sbmcp_"));
    assert_eq!(pair_resp.mode, "read_only");

    // 3. Authenticate bearer token
    let client = authenticate_bearer_token(&pool, &pair_resp.access_token)
        .await
        .unwrap();
    assert_eq!(client.name, "E2eAssistant");

    // 4. Initialize RPC request
    let init_req = JsonRpcRequest {
        jsonrpc: "2.0".into(),
        id: Some(RequestId::Number(1)),
        method: "initialize".into(),
        params: json!({}),
    };

    let notifier: Arc<dyn McpNotifier> = Arc::new(E2eNotifier);
    let init_resp = handle_protocol_request(
        &pool,
        &client.id,
        &client.name,
        &client.mode,
        &notifier,
        60000,
        init_req,
    )
    .await;

    assert!(init_resp.error.is_none());
    assert!(init_resp.result.unwrap()["instructions"]
        .as_str()
        .unwrap()
        .contains("SSHBool MCP Server"));

    // 5. Query tools/list in read_only mode
    let list_req = JsonRpcRequest {
        jsonrpc: "2.0".into(),
        id: Some(RequestId::Number(2)),
        method: "tools/list".into(),
        params: json!({}),
    };

    let list_resp = handle_protocol_request(
        &pool,
        &client.id,
        &client.name,
        &client.mode,
        &notifier,
        60000,
        list_req,
    )
    .await;

    let tools = list_resp.result.unwrap()["tools"].as_array().unwrap().clone();
    assert_eq!(tools.len(), 28, "Must contain exactly 28 SAFE tools in read_only mode");

    // 6. Verify calls ledger dual-write
    let call_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM mcp_calls")
        .fetch_one(&pool)
        .await
        .unwrap();

    assert_eq!(call_count, 2, "Ledger must contain 2 recorded RPC calls");
}
