//! Desktop WebSocket Bridge for in-app HTML5 Canvas Remote Desktop.
//!
//! 1. VNC mode: transparent loopback WebSocket proxy to SSH tunnel (noVNC).
//! 2. RDP mode: Guacamole WebSocket bridge → guacd → RDP over SSH tunnel.

use std::collections::HashMap;
use std::sync::{Arc, LazyLock};

use futures_util::{SinkExt, StreamExt};
use serde_json::Value;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{oneshot, Mutex};
use tokio_tungstenite::tungstenite::handshake::server::{Request, Response};
use tokio_tungstenite::tungstenite::Message;
use tracing::{info, warn};

use crate::guacamole_protocol::{to_instruction, Parser};
use crate::guacamole_token::decrypt_token;

pub static DESKTOP_BRIDGES: LazyLock<DesktopBridgeManager> =
    LazyLock::new(DesktopBridgeManager::new);

pub struct DesktopBridgeManager {
    bridges: Mutex<HashMap<String, oneshot::Sender<()>>>,
}

impl DesktopBridgeManager {
    pub fn new() -> Self {
        Self {
            bridges: Mutex::new(HashMap::new()),
        }
    }
}

impl Default for DesktopBridgeManager {
    fn default() -> Self {
        Self::new()
    }
}

impl DesktopBridgeManager {
    /// Start Guacamole WebSocket bridge for in-app RDP (guacd backend).
    pub async fn start_guacamole(&self, session_id: String) -> Result<u16, String> {
        self.stop(&session_id).await;

        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|e| format!("Failed to bind Guacamole bridge: {e}"))?;

        let ws_port = listener.local_addr().map_err(|e| e.to_string())?.port();

        let (shutdown_tx, mut shutdown_rx) = oneshot::channel::<()>();
        {
            let mut map = self.bridges.lock().await;
            map.insert(session_id.clone(), shutdown_tx);
        }

        tokio::spawn(async move {
            info!("DesktopBridge (Guacamole): listening on 127.0.0.1:{ws_port}");
            loop {
                tokio::select! {
                    _ = &mut shutdown_rx => {
                        info!("DesktopBridge (Guacamole): shutdown on port {ws_port}");
                        break;
                    }
                    accept_res = listener.accept() => {
                        match accept_res {
                            Ok((stream, _)) => {
                                tokio::spawn(handle_guacamole_connection(stream));
                            }
                            Err(e) => {
                                warn!("DesktopBridge (Guacamole): accept error: {e}");
                                break;
                            }
                        }
                    }
                }
            }
        });

        Ok(ws_port)
    }

    /// Start VNC mode bridge using loopback tokio-tungstenite WebSocket.
    pub async fn start_vnc(&self, session_id: String, target_tcp_port: u16) -> Result<u16, String> {
        self.stop(&session_id).await;

        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|e| format!("Failed to bind local WebSocket bridge: {e}"))?;

        let ws_port = listener.local_addr().map_err(|e| e.to_string())?.port();

        let (shutdown_tx, mut shutdown_rx) = oneshot::channel::<()>();
        {
            let mut map = self.bridges.lock().await;
            map.insert(session_id.clone(), shutdown_tx);
        }

        tokio::spawn(async move {
            info!(
                "DesktopBridge (VNC): active on 127.0.0.1:{ws_port} -> 127.0.0.1:{target_tcp_port}"
            );
            loop {
                tokio::select! {
                    _ = &mut shutdown_rx => {
                        info!("DesktopBridge: shutdown signal received for ws port {ws_port}");
                        break;
                    }
                    accept_res = listener.accept() => {
                        match accept_res {
                            Ok((stream, _)) => {
                                tokio::spawn(handle_vnc_connection(stream, target_tcp_port));
                            }
                            Err(e) => {
                                warn!("DesktopBridge: accept error: {e}");
                                break;
                            }
                        }
                    }
                }
            }
        });

        Ok(ws_port)
    }

    /// Stop an active bridge by session ID.
    pub async fn stop(&self, session_id: &str) {
        let mut map = self.bridges.lock().await;
        if let Some(tx) = map.remove(session_id) {
            let _ = tx.send(());
        }
    }
}

fn extract_token_from_request(req: &Request) -> Option<String> {
    let query = req.uri().query()?;
    for pair in query.split('&') {
        if let Some(token) = pair.strip_prefix("token=") {
            return Some(
                urlencoding::decode(token)
                    .map(|s| s.into_owned())
                    .unwrap_or_else(|_| token.to_string()),
            );
        }
    }
    None
}

#[allow(clippy::result_large_err)]
async fn handle_guacamole_connection(stream: TcpStream) {
    let token_cell: Arc<std::sync::Mutex<Option<String>>> = Arc::new(std::sync::Mutex::new(None));
    let token_capture = token_cell.clone();

    let ws = match tokio_tungstenite::accept_hdr_async(
        stream,
        move |req: &Request, response: Response| {
            if let Some(token) = extract_token_from_request(req) {
                if let Ok(mut guard) = token_capture.lock() {
                    *guard = Some(token);
                }
            } else {
                warn!("Guacamole bridge: missing token in WebSocket URL");
            }
            Ok(response)
        },
    )
    .await
    {
        Ok(ws) => ws,
        Err(e) => {
            warn!("Guacamole bridge: WebSocket handshake failed: {e}");
            return;
        }
    };

    let token = token_cell.lock().ok().and_then(|mut g| g.take());
    let Some(token) = token else {
        warn!("Guacamole bridge: rejected connection without token");
        return;
    };

    let settings = match decrypt_and_merge_settings(&token) {
        Ok(s) => s,
        Err(e) => {
            warn!("Guacamole bridge: token decrypt failed: {e}");
            return;
        }
    };

    let mut guacd = match TcpStream::connect(("127.0.0.1", 4822)).await {
        Ok(tcp) => tcp,
        Err(e) => {
            warn!("Guacamole bridge: cannot reach guacd: {e}");
            return;
        }
    };

    if let Err(e) = guacd
        .write_all(to_instruction(&["select", "rdp"]).as_bytes())
        .await
    {
        warn!("Guacamole bridge: failed to send select: {e}");
        return;
    }

    let (mut ws_sender, mut ws_receiver) = ws.split();
    let (mut guacd_read, mut guacd_write) = guacd.into_split();

    let settings = Arc::new(settings);
    let mut parser = Parser::default();
    let mut guacd_ready = false;
    let mut guacd_buf = vec![0u8; 65536];
    let mut ws_send_buffer: Vec<String> = Vec::new();

    loop {
        tokio::select! {
            ws_msg = ws_receiver.next() => {
                match ws_msg {
                    Some(Ok(Message::Text(text))) => {
                        let payload = text.to_string();
                        if guacd_ready {
                            if guacd_write.write_all(payload.as_bytes()).await.is_err() {
                                break;
                            }
                        } else {
                            ws_send_buffer.push(payload);
                        }
                    }
                    Some(Ok(Message::Binary(data))) => {
                        let text = String::from_utf8_lossy(&data).into_owned();
                        if guacd_ready {
                            if guacd_write.write_all(text.as_bytes()).await.is_err() {
                                break;
                            }
                        } else {
                            ws_send_buffer.push(text);
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Err(e)) => {
                        warn!("Guacamole bridge: WS recv error: {e}");
                        break;
                    }
                    _ => {}
                }
            }
            read_res = guacd_read.read(&mut guacd_buf) => {
                match read_res {
                    Ok(0) => break,
                    Ok(n) => {
                        let chunk = String::from_utf8_lossy(&guacd_buf[..n]);
                        for (opcode, params) in parser.receive(&chunk) {
                            if opcode == "args" && !guacd_ready {
                                let reply = build_handshake_reply(&settings, &params);
                                for line in reply {
                                    if guacd_write.write_all(line.as_bytes()).await.is_err() {
                                        return;
                                    }
                                }
                            } else if opcode == "ready" {
                                guacd_ready = true;
                                let conn_id = params.first().map(String::as_str).unwrap_or("");
                                let ready_msg = to_instruction(&["", conn_id]);
                                if ws_sender.send(Message::Text(ready_msg.into())).await.is_err() {
                                    return;
                                }
                                for buffered in ws_send_buffer.drain(..) {
                                    if guacd_write.write_all(buffered.as_bytes()).await.is_err() {
                                        return;
                                    }
                                }
                            } else {
                                let mut elements = vec![opcode.as_str()];
                                for p in &params {
                                    elements.push(p.as_str());
                                }
                                let msg = to_instruction(&elements);
                                if ws_sender.send(Message::Text(msg.into())).await.is_err() {
                                    return;
                                }
                            }
                        }
                    }
                    Err(e) => {
                        warn!("Guacamole bridge: guacd read error: {e}");
                        break;
                    }
                }
            }
        }
    }
}

fn decrypt_and_merge_settings(token: &str) -> Result<HashMap<String, String>, String> {
    let payload = decrypt_token(token)?;
    let settings_val = payload
        .pointer("/connection/settings")
        .ok_or("token missing connection.settings")?;

    let mut settings: HashMap<String, String> = HashMap::new();

    // Defaults aligned with guacamole-lite
    settings.insert("port".into(), "3389".into());
    settings.insert("width".into(), "1024".into());
    settings.insert("height".into(), "768".into());
    settings.insert("dpi".into(), "96".into());

    if let Value::Object(map) = settings_val {
        for (k, v) in map {
            let s = match v {
                Value::String(s) => s.clone(),
                Value::Bool(b) => b.to_string(),
                Value::Number(n) => n.to_string(),
                _ => continue,
            };
            settings.insert(k.clone(), s);
        }
    }

    Ok(settings)
}

fn build_handshake_reply(settings: &HashMap<String, String>, arg_names: &[String]) -> Vec<String> {
    let mut protocol_version = "1_0_0".to_string();
    let mut connect_args: Vec<String> = Vec::new();

    for arg_name in arg_names {
        if let Some(stripped) = arg_name.strip_prefix("VERSION_") {
            protocol_version = if stripped == "1_0_0" || stripped == "1_1_0" {
                stripped.to_string()
            } else {
                "1_1_0".to_string()
            };
            connect_args.push(format!("VERSION_{protocol_version}"));
        } else {
            connect_args.push(settings.get(arg_name).cloned().unwrap_or_default());
        }
    }

    let width = settings
        .get("width")
        .cloned()
        .unwrap_or_else(|| "1024".into());
    let height = settings
        .get("height")
        .cloned()
        .unwrap_or_else(|| "768".into());
    let dpi = settings.get("dpi").cloned().unwrap_or_else(|| "96".into());

    let mut out = vec![
        to_instruction(&["size", &width, &height, &dpi]),
        to_instruction(&["audio", "audio/L16"]),
        to_instruction(&["video"]),
        to_instruction(&["image", "image/png", "image/jpeg"]),
    ];

    if protocol_version == "1_1_0" {
        let tz = settings.get("timezone").map(String::as_str).unwrap_or("");
        out.push(to_instruction(&["timezone", tz]));
    }

    let connect: Vec<&str> = std::iter::once("connect")
        .chain(connect_args.iter().map(String::as_str))
        .collect();
    out.push(to_instruction(&connect));

    out
}

async fn handle_vnc_connection(stream: TcpStream, target_tcp_port: u16) {
    let ws_stream = match tokio_tungstenite::accept_async(stream).await {
        Ok(ws) => ws,
        Err(e) => {
            warn!("DesktopBridge: WebSocket handshake failed: {e}");
            return;
        }
    };

    let tcp_stream = match TcpStream::connect(("127.0.0.1", target_tcp_port)).await {
        Ok(tcp) => tcp,
        Err(e) => {
            warn!("DesktopBridge: Failed to connect to tunnel port {target_tcp_port}: {e}");
            return;
        }
    };

    let (mut ws_sender, mut ws_receiver) = ws_stream.split();
    let (mut tcp_read, mut tcp_write) = tcp_stream.into_split();

    let ws_to_tcp = async {
        while let Some(msg_res) = ws_receiver.next().await {
            match msg_res {
                Ok(Message::Binary(data)) => {
                    if tcp_write.write_all(&data).await.is_err() {
                        break;
                    }
                }
                Ok(Message::Close(_)) => break,
                Err(e) => {
                    warn!("DesktopBridge: WS receive error: {e}");
                    break;
                }
                _ => {}
            }
        }
    };

    let tcp_to_ws = async {
        let mut buf = vec![0u8; 65536];
        loop {
            match tcp_read.read(&mut buf).await {
                Ok(0) => break,
                Ok(n) => {
                    let msg = Message::Binary(buf[..n].to_vec().into());
                    if ws_sender.send(msg).await.is_err() {
                        break;
                    }
                }
                Err(e) => {
                    warn!("DesktopBridge: TCP read error: {e}");
                    break;
                }
            }
        }
    };

    tokio::select! {
        _ = ws_to_tcp => {},
        _ = tcp_to_ws => {},
    }
}
