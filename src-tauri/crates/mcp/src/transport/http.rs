//! Axum HTTP router and request handlers for MCP server transport.

use crate::pairing::{redeem_pairing_code, PairRequest};
use crate::protocol::handlers::handle_protocol_request;
use crate::protocol::jsonrpc::JsonRpcRequest;
use crate::transport::auth::authenticate_bearer_token;
use crate::transport::sse::create_sse_stream;
use crate::runtime::McpRuntimeState;
use crate::McpNotifier;
use axum::extract::{Request, State};
use axum::http::{HeaderMap, HeaderValue, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::json;
use sqlx::SqlitePool;
use std::sync::Arc;

#[derive(Clone)]
pub struct AppState {
    pub pool: SqlitePool,
    pub bind_port: u16,
    pub notifier: Arc<dyn McpNotifier>,
    pub approval_timeout_ms: u64,
    pub runtime: Arc<McpRuntimeState>,
}

/// Router middleware that verifies Host and Origin headers are strictly loopback.
async fn verify_loopback_headers(
    request: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    if let Some(host) = request.headers().get("host").and_then(|v| v.to_str().ok()) {
        if !host.starts_with("127.0.0.1") && !host.starts_with("localhost") {
            return Err(StatusCode::FORBIDDEN);
        }
    }

    if let Some(origin) = request.headers().get("origin").and_then(|v| v.to_str().ok()) {
        if !origin.contains("127.0.0.1") && !origin.contains("localhost") {
            return Err(StatusCode::FORBIDDEN);
        }
    }

    Ok(next.run(request).await)
}

async fn handle_healthz() -> impl IntoResponse {
    Json(json!({ "status": "ok", "mcp": true }))
}

async fn handle_pair(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<PairRequest>,
) -> Response {
    match redeem_pairing_code(&state.pool, payload).await {
        Ok(res) => (StatusCode::OK, Json(json!(res))).into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, Json(json!({ "error": e.to_string() }))).into_response(),
    }
}

async fn handle_sse_endpoint(State(state): State<Arc<AppState>>) -> Response {
    let post_url = format!("http://127.0.0.1:{}/mcp", state.bind_port);
    create_sse_stream(post_url).into_response()
}

async fn handle_mcp_rpc(
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
    Json(payload): Json<JsonRpcRequest>,
) -> Response {
    let auth_header = match headers.get("authorization").and_then(|v| v.to_str().ok()) {
        Some(h) => h,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({ "jsonrpc": "2.0", "error": { "code": -32600, "message": "Missing Authorization header" } })),
            )
                .into_response();
        }
    };

    let token = auth_header.trim_start_matches("Bearer ").trim();
    let client = match authenticate_bearer_token(&state.pool, token).await {
        Ok(c) => c,
        Err(e) => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({ "jsonrpc": "2.0", "error": { "code": -32600, "message": e.to_string() } })),
            )
                .into_response();
        }
    };

    if state.runtime.is_vault_locked() {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({ "jsonrpc": "2.0", "error": { "code": -32603, "message": "Vault locked" } })),
        )
            .into_response();
    }
    if state.runtime.is_kill_switch_active() {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({ "jsonrpc": "2.0", "error": { "code": -32603, "message": "MCP kill switch active" } })),
        )
            .into_response();
    }

    let response = handle_protocol_request(
        &state.pool,
        &client.id,
        &client.name,
        &client.mode,
        &state.notifier,
        state.approval_timeout_ms,
        payload,
    )
    .await;

    let mut resp = Json(response).into_response();
    resp.headers_mut().insert("Content-Type", HeaderValue::from_static("application/json"));
    resp
}

/// Constructs the axum Router for the MCP HTTP server.
pub fn create_router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/healthz", get(handle_healthz))
        .route("/mcp/pair", post(handle_pair))
        .route("/mcp", get(handle_sse_endpoint).post(handle_mcp_rpc))
        .layer(middleware::from_fn(verify_loopback_headers))
        .with_state(state)
}
