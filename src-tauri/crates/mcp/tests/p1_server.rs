//! Phase 1 integration tests covering transport, scope isolation, read-only tool catalog, and session handle ownership.

use infrastructure::db::migrate;
use mcp::approval::ToolCallContext;
use mcp::runtime::McpRuntimeState;
use mcp::pairing::{hash_pairing_code, pair_client_from_app, redeem_pairing_code, LocalPairRequest, PairRequest};
use mcp::policy::paths::is_sensitive_read_path;
use mcp::protocol::handlers::handle_protocol_request;
use mcp::protocol::jsonrpc::{JsonRpcRequest, RequestId};
use mcp::repo::clients::create_pairing_code;
use mcp::scope::resolve_host_in_scope;
use mcp::session::SessionRegistry;
use mcp::tools::dispatch_tool_call;
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
    pool
}

fn test_ctx(pool: &SqlitePool, mode: &str) -> ToolCallContext {
    ToolCallContext {
        pool: pool.clone(),
        client_id: "client_1".into(),
        client_name: "TestClient".into(),
        mode: mode.into(),
        session_handle: None,
        notifier: None,
        approval_timeout_ms: 60_000,
        runtime: McpRuntimeState::global(),
    }
}

#[tokio::test]
async fn test_tools_list_in_read_only_mode_contains_only_safe_tools() {
    let pool = setup_test_db().await;

    let req = JsonRpcRequest {
        jsonrpc: "2.0".into(),
        id: Some(RequestId::Number(1)),
        method: "tools/list".into(),
        params: json!({}),
    };

    let notifier: Arc<dyn McpNotifier> = Arc::new(TestNotifier);
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
    assert!(resp.error.is_none());

    let result = resp.result.unwrap();
    let tools = result["tools"].as_array().unwrap();

    assert_eq!(tools.len(), 28, "Expected exactly 28 safe tools in read_only mode");

    let dangerous_names = ["exec_command", "rm_path", "write_file", "kill_process", "sudo"];
    for tool in tools {
        let name = tool["name"].as_str().unwrap();
        assert!(
            !dangerous_names.contains(&name),
            "Dangerous tool `{name}` must not appear in read_only mode"
        );
    }
}

#[tokio::test]
async fn test_calling_hidden_tool_returns_tool_not_available() {
    let pool = setup_test_db().await;

    let ctx = test_ctx(&pool, "read_only");
    let res = dispatch_tool_call(
        &ctx,
        "exec_command",
        &json!({ "command": "rm -rf /" }),
    )
    .await;

    assert!(res.is_err());
    let err_str = res.unwrap_err().to_string();
    assert!(
        err_str.contains("TOOL_NOT_AVAILABLE"),
        "Expected TOOL_NOT_AVAILABLE, got: {err_str}"
    );
}

#[tokio::test]
async fn test_out_of_scope_host_returns_host_not_in_scope() {
    let pool = setup_test_db().await;

    let res = resolve_host_in_scope(&pool, "client_1", "ungranted_host_99").await;
    assert!(res.is_err());
    let err_str = res.unwrap_err().to_string();
    assert!(
        err_str.contains("HOST_NOT_IN_SCOPE"),
        "Expected HOST_NOT_IN_SCOPE, got: {err_str}"
    );
}

#[test]
fn test_session_handle_not_owned_returns_session_not_owned() {
    let registry = SessionRegistry::new();
    let handle = registry.create_handle("client_A".into(), "host_1".into(), 60000, 3600000);

    // Client B attempts to use Client A's session handle
    let res = registry.validate_and_touch(&handle, "client_B");
    assert!(res.is_err());
    let err_str = res.unwrap_err().to_string();
    assert!(
        err_str.contains("SESSION_NOT_OWNED"),
        "Expected SESSION_NOT_OWNED, got: {err_str}"
    );

    // Client A using own handle succeeds
    assert!(registry.validate_and_touch(&handle, "client_A").is_ok());
}

#[tokio::test]
async fn test_sensitive_path_read_hard_denied() {
    assert!(is_sensitive_read_path("/etc/shadow"));
    assert!(is_sensitive_read_path("~/.ssh/id_rsa"));
    assert!(is_sensitive_read_path("/app/.env"));

    let pool = setup_test_db().await;
    let ctx = test_ctx(&pool, "read_only");
    let res = dispatch_tool_call(
        &ctx,
        "read_file_preview",
        &json!({ "host_id": "h1", "path": "/etc/shadow" }),
    )
    .await;

    assert!(res.is_err());
    let err_str = res.unwrap_err().to_string();
    assert!(
        err_str.contains("sensitive"),
        "Expected sensitive path denial, got: {err_str}"
    );
}

#[tokio::test]
async fn test_pairing_code_redemption_and_lockout() {
    let pool = setup_test_db().await;

    let raw_code = "849201";
    let code_hash = hash_pairing_code(raw_code);
    create_pairing_code(&pool, &code_hash, 300).await.unwrap();

    // 1. Failed attempts
    let bad_req = PairRequest {
        code: "000000".into(),
        client_name: "Attacker".into(),
        client_version: None,
    };
    assert!(redeem_pairing_code(&pool, bad_req.clone()).await.is_err());
    assert!(redeem_pairing_code(&pool, bad_req.clone()).await.is_err());
    assert!(redeem_pairing_code(&pool, bad_req.clone()).await.is_err());

    // 4th attempt must be locked out
    let good_req = PairRequest {
        code: raw_code.into(),
        client_name: "ValidClient".into(),
        client_version: Some("1.0".into()),
    };
    assert!(redeem_pairing_code(&pool, good_req).await.is_err());
}

#[tokio::test]
async fn test_pair_client_from_app_mints_read_only_token() {
    let pool = setup_test_db().await;

    let resp = pair_client_from_app(
        &pool,
        LocalPairRequest {
            client_name: "Cursor".into(),
            client_version: Some("1.0".into()),
        },
    )
    .await
    .unwrap();

    assert!(resp.client_id.len() > 0);
    assert!(resp.access_token.starts_with("sbmcp_"));
    assert_eq!(resp.mode, "read_only");
    assert!(resp.expires_at > chrono::Utc::now().timestamp_millis());

    let row: (String, String) = sqlx::query_as(
        "SELECT name, mode FROM mcp_clients WHERE id = ?",
    )
    .bind(&resp.client_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(row.0, "Cursor");
    assert_eq!(row.1, "read_only");
}
