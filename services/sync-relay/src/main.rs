//! Minimal local sync-relay stub for SSHBool Phase 4 client testing.
//! Run: `cargo run -p sync-relay` → http://127.0.0.1:8787

use axum::{
    extract::State,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::VecDeque;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use tower_http::cors::CorsLayer;

#[derive(Clone, Default)]
struct Store {
    items: Arc<Mutex<VecDeque<Value>>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PushBody {
    change_id: Option<String>,
    ciphertext_b64: Option<String>,
    nonce_b64: Option<String>,
}

#[derive(Serialize)]
struct Health {
    ok: bool,
    service: &'static str,
}

#[tokio::main]
async fn main() {
    let store = Store::default();
    let app = Router::new()
        .route("/health", get(|| async { Json(Health { ok: true, service: "sshbool-sync-relay" }) }))
        .route("/v1/push", post(push))
        .route("/v1/pull", get(pull))
        .route("/v1/devices", post(register_device))
        .layer(CorsLayer::permissive())
        .with_state(store);

    let addr = SocketAddr::from(([127, 0, 0, 1], 8787));
    println!("sync-relay listening on http://{addr}");
    let listener = tokio::net::TcpListener::bind(addr).await.expect("bind");
    axum::serve(listener, app).await.expect("serve");
}

async fn push(State(store): State<Store>, Json(body): Json<Value>) -> Json<Value> {
    let mut q = store.items.lock().unwrap();
    q.push_back(body);
    while q.len() > 100 {
        q.pop_front();
    }
    Json(json!({ "ok": true, "stored": q.len() }))
}

async fn pull(State(store): State<Store>) -> Json<Value> {
    let q = store.items.lock().unwrap();
    let items: Vec<_> = q.iter().cloned().collect();
    Json(json!({ "items": items }))
}

async fn register_device(Json(body): Json<PushBody>) -> Json<Value> {
    Json(json!({
        "ok": true,
        "deviceId": body.change_id.unwrap_or_else(|| uuid::Uuid::now_v7().to_string()),
        "ciphertextB64": body.ciphertext_b64,
        "nonceB64": body.nonce_b64,
    }))
}
