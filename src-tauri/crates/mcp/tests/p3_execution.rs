//! Phase 3 integration tests covering execution engine, dangerous tool catalog, evasion detection, and policy classifiers.

use infrastructure::db::migrate;
use mcp::approval::ToolCallContext;
use mcp::runtime::McpRuntimeState;
use mcp::tools::{dispatch_tool_call, get_tools_for_mode};
use serde_json::json;
use sqlx::SqlitePool;

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
    sqlx::query("INSERT INTO mcp_clients (id, name, token_hash, token_issued_at, token_expires_at, mode, enabled, paired_at, updated_at) VALUES ('client_1', 'Client 1', 'hash_123', ?, ?, 'full', 1, ?, ?)")
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

fn test_ctx(pool: &SqlitePool) -> ToolCallContext {
    ToolCallContext {
        pool: pool.clone(),
        client_id: "client_1".into(),
        client_name: "Client 1".into(),
        mode: "full".into(),
        session_handle: None,
        notifier: None,
        approval_timeout_ms: 60_000,
        runtime: McpRuntimeState::global(),
    }
}

#[tokio::test]
async fn test_dangerous_tool_catalog_availability_in_full_mode() {
    let read_only_tools = get_tools_for_mode("read_only");
    assert_eq!(read_only_tools.len(), 28);

    let assisted_tools = get_tools_for_mode("assisted");
    assert_eq!(assisted_tools.len(), 36); // 28 + 8

    let full_tools = get_tools_for_mode("full");
    assert_eq!(full_tools.len(), 46); // 28 + 8 + 10

    let names: Vec<String> = full_tools.into_iter().map(|t| t.name).collect();
    assert!(names.contains(&"exec_command".to_string()));
    assert!(names.contains(&"reboot_host".to_string()));
    assert!(names.contains(&"k8s_apply".to_string()));
}

#[tokio::test]
async fn test_command_obfuscation_evasion_hard_denied() {
    let pool = setup_test_db().await;
    let ctx = test_ctx(&pool);

    let res = dispatch_tool_call(
        &ctx,
        "exec_command",
        &json!({
            "host_id": "host_1",
            "command": "echo aW1wb3J0IG9z... | base64 -d | sh",
            "reason": "test obfuscation detection"
        }),
    )
    .await;

    assert!(res.is_err());
    let err_str = res.unwrap_err().to_string();
    assert!(
        err_str.contains("EVASION_DENIED"),
        "Obfuscation must trigger EVASION_DENIED, got: {err_str}"
    );
}

#[tokio::test]
async fn test_hard_deny_command_execution() {
    let pool = setup_test_db().await;
    let ctx = test_ctx(&pool);

    let res = dispatch_tool_call(
        &ctx,
        "exec_command",
        &json!({
            "host_id": "host_1",
            "command": "rm -rf / --no-preserve-root",
            "reason": "test hard deny"
        }),
    )
    .await;

    assert!(res.is_err());
    let err_str = res.unwrap_err().to_string();
    assert!(
        err_str.contains("HARD_DENY"),
        "Catastrophic command must trigger HARD_DENY, got: {err_str}"
    );
}

#[tokio::test]
async fn test_k8s_apply_secrets_prohibited() {
    let pool = setup_test_db().await;
    let ctx = test_ctx(&pool);

    let res = dispatch_tool_call(
        &ctx,
        "k8s_apply",
        &json!({
            "host_id": "host_1",
            "manifest_yaml": "apiVersion: v1\nkind: Secret\nmetadata:\n  name: db-secret\ndata:\n  password: cGFzc3dvcmQ=",
            "reason": "test k8s secret block"
        }),
    )
    .await;

    assert!(res.is_err());
    let err_str = res.unwrap_err().to_string();
    assert!(
        err_str.contains("prohibited"),
        "K8s secret apply must be prohibited, got: {err_str}"
    );
}

#[tokio::test]
async fn test_dangerous_exec_requires_approval_without_notifier() {
    let pool = setup_test_db().await;
    let ctx = test_ctx(&pool);

    let res = dispatch_tool_call(
        &ctx,
        "restart_service",
        &json!({
            "host_id": "host_1",
            "unit": "nginx.service",
            "reason": "restart after config change"
        }),
    )
    .await;

    assert!(res.is_err());
    let err_str = res.unwrap_err().to_string();
    assert!(
        err_str.contains("Approval") || err_str.contains("approval"),
        "Dangerous tool must require approval, got: {err_str}"
    );
}
