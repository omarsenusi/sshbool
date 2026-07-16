//! SSH session / PTY / SFTP manager (russh 0.62).

use std::collections::HashMap;
use std::sync::Arc;

use domain::DomainError;
use russh::client::{self, AuthResult, Handle};
use russh::keys::{decode_secret_key, HashAlg, PrivateKeyWithHashAlg, PublicKey};
use russh::ChannelMsg;
use tokio::sync::{mpsc, Mutex, RwLock};
use uuid::Uuid;

use crate::vault::VaultService;

struct ClientHandler {
    expected_fp: Option<String>,
    learned_fp: Arc<Mutex<Option<(String, String)>>>,
}

impl client::Handler for ClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &PublicKey,
    ) -> Result<bool, Self::Error> {
        let fp = fingerprint_sha256(server_public_key);
        let key_type = server_public_key.algorithm().to_string();
        *self.learned_fp.lock().await = Some((fp.clone(), key_type));
        if let Some(expected) = &self.expected_fp {
            Ok(expected == &fp)
        } else {
            Ok(true)
        }
    }
}

fn fingerprint_sha256(key: &PublicKey) -> String {
    let fp = key.fingerprint(HashAlg::Sha256);
    format!("SHA256:{fp}")
}

struct LiveSession {
    handle: Handle<ClientHandler>,
    host_id: String,
}

struct LivePane {
    host_id: String,
    session_id: String,
    writer: mpsc::Sender<Vec<u8>>,
    /// PTY resize control (cols, rows).
    resize: mpsc::Sender<(u32, u32)>,
}

/// Manages multiplexed SSH sessions.
pub struct ConnectionManager {
    vault: Arc<VaultService>,
    sessions: RwLock<HashMap<String, Arc<Mutex<LiveSession>>>>,
    host_to_session: RwLock<HashMap<String, String>>,
    panes: RwLock<HashMap<String, LivePane>>,
    pane_tx: RwLock<HashMap<String, mpsc::Sender<Vec<u8>>>>,
    /// Raw PTY output retained so pop-out / bring-back can restore the same screen.
    scrollback: RwLock<HashMap<String, Vec<u8>>>,
    forward_tasks: RwLock<HashMap<String, tokio::task::JoinHandle<()>>>,
}

const MAX_SCROLLBACK_BYTES: usize = 512_000;

impl ConnectionManager {
    /// Create manager.
    pub fn new(vault: Arc<VaultService>) -> Arc<Self> {
        Arc::new(Self {
            vault,
            sessions: RwLock::new(HashMap::new()),
            host_to_session: RwLock::new(HashMap::new()),
            panes: RwLock::new(HashMap::new()),
            pane_tx: RwLock::new(HashMap::new()),
            scrollback: RwLock::new(HashMap::new()),
            forward_tasks: RwLock::new(HashMap::new()),
        })
    }

    /// Open (or reuse) an authenticated session for a host.
    pub async fn session_open(&self, host_id: &str) -> Result<String, DomainError> {
        self.session_open_inner(host_id, &mut Vec::new()).await
    }

    async fn session_open_inner(
        &self,
        host_id: &str,
        chain: &mut Vec<String>,
    ) -> Result<String, DomainError> {
        if let Some(sid) = self.host_to_session.read().await.get(host_id).cloned() {
            return Ok(sid);
        }
        if chain.contains(&host_id.to_string()) {
            return Err(DomainError::Validation {
                field: "jumpHostId".into(),
                message: "ProxyJump cycle detected".into(),
            });
        }
        chain.push(host_id.to_string());

        let row: Option<(String, String, i64, String, Option<String>)> = sqlx::query_as(
            r#"SELECT hostname, COALESCE(username,''), port, auth_method, jump_host_id
               FROM hosts WHERE id = ? AND deleted_at IS NULL"#,
        )
        .bind(host_id)
        .fetch_optional(self.vault.pool())
        .await
        .map_err(|e| DomainError::Crypto(e.to_string()))?;

        let Some((hostname, username, port, auth_method, jump_host_id)) = row else {
            return Err(DomainError::NotFound {
                entity: "host",
                id: Some(host_id.into()),
            });
        };
        let username = if username.is_empty() {
            "root".into()
        } else {
            username
        };
        let port = port as u16;

        let known: Option<(String,)> = sqlx::query_as(
            "SELECT fingerprint_sha256 FROM known_hosts WHERE host = ? AND port = ? LIMIT 1",
        )
        .bind(&hostname)
        .bind(port as i64)
        .fetch_optional(self.vault.pool())
        .await
        .map_err(|e| DomainError::Crypto(e.to_string()))?;

        let learned_fp = Arc::new(Mutex::new(None));
        let config = Arc::new(client::Config::default());
        let handler = ClientHandler {
            expected_fp: known.as_ref().map(|k| k.0.clone()),
            learned_fp: learned_fp.clone(),
        };

        let mut handle = if let Some(jump_id) = jump_host_id.filter(|s| !s.is_empty()) {
            let jump_sid = Box::pin(self.session_open_inner(&jump_id, chain)).await?;
            let jump_live = self.sessions.read().await.get(&jump_sid).cloned().ok_or(
                DomainError::NotFound {
                    entity: "session",
                    id: Some(jump_sid),
                },
            )?;
            let jump_guard = jump_live.lock().await;
            let channel = jump_guard
                .handle
                .channel_open_direct_tcpip(
                    hostname.as_str(),
                    port as u32,
                    "127.0.0.1",
                    0,
                )
                .await
                .map_err(|e| DomainError::Conflict(format!("ProxyJump channel: {e}")))?;
            drop(jump_guard);
            let stream = channel.into_stream();
            client::connect_stream(config, stream, handler)
                .await
                .map_err(|e| DomainError::Conflict(format!("ProxyJump connect: {e}")))?
        } else {
            client::connect(config, (hostname.as_str(), port), handler)
                .await
                .map_err(|e| DomainError::Conflict(format!("connection failed: {e}")))?
        };

        let auth_ok = self
            .authenticate(&mut handle, host_id, &username, &auth_method)
            .await?;

        if !auth_ok {
            return Err(DomainError::Unauthorized("bad_password"));
        }

        if let Some((fp, key_type)) = learned_fp.lock().await.clone() {
            if known.is_none() {
                let id = Uuid::now_v7().to_string();
                let now = chrono::Utc::now().timestamp_millis();
                let _ = sqlx::query(
                    "INSERT INTO known_hosts (id, host, port, key_type, fingerprint_sha256, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                )
                .bind(&id)
                .bind(&hostname)
                .bind(port as i64)
                .bind(&key_type)
                .bind(&fp)
                .bind(now)
                .bind(now)
                .execute(self.vault.pool())
                .await;
            }
        }

        let session_id = Uuid::now_v7().to_string();
        let now = chrono::Utc::now().timestamp_millis();
        sqlx::query(
            "INSERT INTO sessions (id, host_id, started_at, client_version, created_at) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(&session_id)
        .bind(host_id)
        .bind(now)
        .bind(env!("CARGO_PKG_VERSION"))
        .bind(now)
        .execute(self.vault.pool())
        .await
        .map_err(|e| DomainError::Crypto(e.to_string()))?;

        sqlx::query(
            "UPDATE hosts SET last_connected_at = ?, connect_count = connect_count + 1, updated_at = ? WHERE id = ?",
        )
        .bind(now)
        .bind(now)
        .bind(host_id)
        .execute(self.vault.pool())
        .await
        .ok();

        let live = Arc::new(Mutex::new(LiveSession {
            handle,
            host_id: host_id.to_string(),
        }));
        self.sessions.write().await.insert(session_id.clone(), live);
        self.host_to_session
            .write()
            .await
            .insert(host_id.to_string(), session_id.clone());
        Ok(session_id)
    }

    async fn authenticate(
        &self,
        handle: &mut Handle<ClientHandler>,
        host_id: &str,
        username: &str,
        auth_method: &str,
    ) -> Result<bool, DomainError> {
        match auth_method {
            "password" => {
                let secret = self.load_host_password(host_id).await?;
                let res = handle
                    .authenticate_password(username, secret)
                    .await
                    .map_err(|e| DomainError::Conflict(format!("auth: {e}")))?;
                Ok(matches!(res, AuthResult::Success))
            }
            "agent" => Err(DomainError::Conflict(
                "SSH agent auth requires a running agent; use password or key for now".into(),
            )),
            "key" => {
                let (priv_pem, passphrase) = self.load_host_key(host_id).await?;
                let key = decode_secret_key(&priv_pem, passphrase.as_deref())
                    .map_err(|e| DomainError::Crypto(format!("key decode: {e}")))?;
                let hash = handle
                    .best_supported_rsa_hash()
                    .await
                    .map_err(|e| DomainError::Conflict(format!("auth: {e}")))?
                    .flatten();
                let res = handle
                    .authenticate_publickey(
                        username,
                        PrivateKeyWithHashAlg::new(Arc::new(key), hash),
                    )
                    .await
                    .map_err(|e| DomainError::Conflict(format!("auth: {e}")))?;
                Ok(matches!(res, AuthResult::Success))
            }
            "fido2" => Err(DomainError::Conflict(
                "FIDO2/YubiKey auth is stubbed — use password or key for now".into(),
            )),
            other => Err(DomainError::Validation {
                field: "authMethod".into(),
                message: format!("unsupported auth method: {other}"),
            }),
        }
    }

    /// Start a local TCP forward through an SSH session (local → remote).
    pub async fn port_forward_start(
        self: &Arc<Self>,
        forward_id: &str,
        host_id: &str,
        bind_addr: &str,
        bind_port: u16,
        dest_addr: &str,
        dest_port: u16,
    ) -> Result<(), DomainError> {
        let session_id = self.session_open(host_id).await?;
        let live = self.sessions.read().await.get(&session_id).cloned().ok_or(
            DomainError::NotFound {
                entity: "session",
                id: Some(session_id),
            },
        )?;

        let listener = tokio::net::TcpListener::bind((bind_addr, bind_port))
            .await
            .map_err(|e| DomainError::Conflict(format!("bind {bind_addr}:{bind_port}: {e}")))?;

        let dest_addr = dest_addr.to_string();
        let mgr = Arc::clone(self);
        let fid = forward_id.to_string();
        let handle = tokio::spawn(async move {
            loop {
                let Ok((mut socket, peer)) = listener.accept().await else {
                    break;
                };
                let live = live.clone();
                let dest_addr = dest_addr.clone();
                tokio::spawn(async move {
                    let guard = live.lock().await;
                    let channel = match guard
                        .handle
                        .channel_open_direct_tcpip(
                            dest_addr.as_str(),
                            dest_port as u32,
                            peer.ip().to_string(),
                            peer.port() as u32,
                        )
                        .await
                    {
                        Ok(c) => c,
                        Err(_) => return,
                    };
                    drop(guard);
                    let mut stream = channel.into_stream();
                    let _ = tokio::io::copy_bidirectional(&mut socket, &mut stream).await;
                });
            }
            let _ = mgr.forward_tasks.write().await.remove(&fid);
        });
        self.forward_tasks
            .write()
            .await
            .insert(forward_id.to_string(), handle);
        Ok(())
    }

    /// Stop a running local forward.
    pub async fn port_forward_stop(&self, forward_id: &str) -> Result<(), DomainError> {
        if let Some(h) = self.forward_tasks.write().await.remove(forward_id) {
            h.abort();
        }
        Ok(())
    }

    /// Close session.
    pub async fn session_close(&self, session_id: &str) -> Result<(), DomainError> {
        if let Some(live) = self.sessions.write().await.remove(session_id) {
            let host_id = live.lock().await.host_id.clone();
            self.host_to_session.write().await.remove(&host_id);
            let _ = live
                .lock()
                .await
                .handle
                .disconnect(russh::Disconnect::ByApplication, "", "")
                .await;
        }
        let now = chrono::Utc::now().timestamp_millis();
        let _ = sqlx::query("UPDATE sessions SET ended_at = ? WHERE id = ?")
            .bind(now)
            .bind(session_id)
            .execute(self.vault.pool())
            .await;
        Ok(())
    }

    /// Open PTY pane.
    pub async fn pane_open(
        self: &Arc<Self>,
        host_id: &str,
        cols: u32,
        rows: u32,
    ) -> Result<(String, String, mpsc::Receiver<Vec<u8>>), DomainError> {
        let session_id = self.session_open(host_id).await?;
        let live =
            self.sessions
                .read()
                .await
                .get(&session_id)
                .cloned()
                .ok_or(DomainError::NotFound {
                    entity: "session",
                    id: Some(session_id.clone()),
                })?;

        let guard = live.lock().await;
        let mut channel = guard
            .handle
            .channel_open_session()
            .await
            .map_err(|e| DomainError::Conflict(format!("channel: {e}")))?;

        channel
            .request_pty(false, "xterm-256color", cols, rows, 0, 0, &[])
            .await
            .map_err(|e| DomainError::Conflict(format!("pty: {e}")))?;
        // UTF-8 locale so Arabic and other Unicode input/output work in the shell.
        let _ = channel.set_env(false, "LANG", "C.UTF-8").await;
        let _ = channel.set_env(false, "LC_ALL", "C.UTF-8").await;
        let _ = channel.set_env(false, "LC_CTYPE", "C.UTF-8").await;
        let _ = channel.set_env(false, "TERM", "xterm-256color").await;
        channel
            .request_shell(false)
            .await
            .map_err(|e| DomainError::Conflict(format!("shell: {e}")))?;
        drop(guard);

        let pane_id = Uuid::now_v7().to_string();
        let (out_tx, out_rx) = mpsc::channel::<Vec<u8>>(256);
        let (in_tx, mut in_rx) = mpsc::channel::<Vec<u8>>(256);
        let (resize_tx, mut resize_rx) = mpsc::channel::<(u32, u32)>(8);

        self.pane_tx
            .write()
            .await
            .insert(pane_id.clone(), out_tx.clone());
        self.panes.write().await.insert(
            pane_id.clone(),
            LivePane {
                host_id: host_id.to_string(),
                session_id: session_id.clone(),
                writer: in_tx,
                resize: resize_tx,
            },
        );

        let now = chrono::Utc::now().timestamp_millis();
        let _ = sqlx::query(
            "INSERT INTO session_panes (id, session_id, kind, title, created_at) VALUES (?, ?, 'shell', ?, ?)",
        )
        .bind(&pane_id)
        .bind(&session_id)
        .bind(host_id)
        .bind(now)
        .execute(self.vault.pool())
        .await;

        tokio::spawn(async move {
            loop {
                tokio::select! {
                    msg = channel.wait() => {
                        match msg {
                            Some(ChannelMsg::Data { ref data }) => {
                                let _ = out_tx.send(data.to_vec()).await;
                            }
                            Some(ChannelMsg::ExtendedData { ref data, .. }) => {
                                let _ = out_tx.send(data.to_vec()).await;
                            }
                            None | Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) => break,
                            _ => {}
                        }
                    }
                    Some(bytes) = in_rx.recv() => {
                        if channel.data(&bytes[..]).await.is_err() {
                            break;
                        }
                    }
                    Some((cols, rows)) = resize_rx.recv() => {
                        // SSH window-change so TUIs (htop/vim/tmux) match local size.
                        if channel
                            .window_change(cols, rows, 0, 0)
                            .await
                            .is_err()
                        {
                            break;
                        }
                    }
                }
            }
        });

        Ok((pane_id, session_id, out_rx))
    }

    /// Write to pane.
    pub async fn pane_write(&self, pane_id: &str, data: &[u8]) -> Result<(), DomainError> {
        let panes = self.panes.read().await;
        let pane = panes.get(pane_id).ok_or(DomainError::NotFound {
            entity: "pane",
            id: Some(pane_id.into()),
        })?;
        pane.writer
            .send(data.to_vec())
            .await
            .map_err(|_| DomainError::Conflict("pane closed".into()))?;
        Ok(())
    }

    /// Resize pane — send SSH window-change so remote TUIs match local size.
    pub async fn pane_resize(
        &self,
        pane_id: &str,
        cols: u32,
        rows: u32,
    ) -> Result<(), DomainError> {
        let cols = cols.max(2);
        let rows = rows.max(2);
        let panes = self.panes.read().await;
        let pane = panes.get(pane_id).ok_or(DomainError::NotFound {
            entity: "pane",
            id: Some(pane_id.into()),
        })?;
        pane.resize
            .send((cols, rows))
            .await
            .map_err(|_| DomainError::Conflict("pane closed".into()))?;
        Ok(())
    }

    /// Close pane.
    pub async fn pane_close(&self, pane_id: &str) -> Result<(), DomainError> {
        self.panes.write().await.remove(pane_id);
        self.pane_tx.write().await.remove(pane_id);
        self.scrollback.write().await.remove(pane_id);
        Ok(())
    }

    /// Append PTY output to the retained scrollback for this pane.
    pub async fn pane_scrollback_append(&self, pane_id: &str, data: &[u8]) {
        if data.is_empty() {
            return;
        }
        let mut map = self.scrollback.write().await;
        let buf = map.entry(pane_id.to_string()).or_default();
        buf.extend_from_slice(data);
        if buf.len() > MAX_SCROLLBACK_BYTES {
            let excess = buf.len() - MAX_SCROLLBACK_BYTES;
            buf.drain(0..excess);
        }
    }

    /// Full retained scrollback (may be empty for a brand-new pane).
    pub async fn pane_scrollback_get(&self, pane_id: &str) -> Vec<u8> {
        self.scrollback
            .read()
            .await
            .get(pane_id)
            .cloned()
            .unwrap_or_default()
    }

    /// Run a non-interactive command on the host and return stdout+stderr.
    pub async fn exec_command(&self, host_id: &str, command: &str) -> Result<String, DomainError> {
        let session_id = self.session_open(host_id).await?;
        let live = self.sessions.read().await.get(&session_id).cloned().ok_or(
            DomainError::NotFound {
                entity: "session",
                id: Some(session_id),
            },
        )?;
        let guard = live.lock().await;
        let mut channel = guard
            .handle
            .channel_open_session()
            .await
            .map_err(|e| DomainError::Conflict(format!("exec channel: {e}")))?;
        channel
            .exec(true, command)
            .await
            .map_err(|e| DomainError::Conflict(format!("exec: {e}")))?;
        drop(guard);

        let mut out = Vec::new();
        loop {
            match channel.wait().await {
                Some(ChannelMsg::Data { ref data }) => out.extend_from_slice(data),
                Some(ChannelMsg::ExtendedData { ref data, .. }) => out.extend_from_slice(data),
                None | Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) => break,
                Some(ChannelMsg::ExitStatus { .. }) => {}
                _ => {}
            }
        }
        Ok(String::from_utf8_lossy(&out).into_owned())
    }

    /// List open panes.
    pub async fn sessions_list(&self) -> Vec<(String, String, String, String)> {
        self.panes
            .read()
            .await
            .iter()
            .map(|(pid, p)| {
                (
                    pid.clone(),
                    p.session_id.clone(),
                    p.host_id.clone(),
                    p.host_id.clone(),
                )
            })
            .collect()
    }

    async fn open_sftp(
        &self,
        host_id: &str,
    ) -> Result<russh_sftp::client::SftpSession, DomainError> {
        let session_id = self.session_open(host_id).await?;
        let live =
            self.sessions
                .read()
                .await
                .get(&session_id)
                .cloned()
                .ok_or(DomainError::NotFound {
                    entity: "session",
                    id: Some(session_id),
                })?;
        let guard = live.lock().await;
        let channel = guard
            .handle
            .channel_open_session()
            .await
            .map_err(|e| DomainError::Conflict(format!("sftp channel: {e}")))?;
        channel
            .request_subsystem(true, "sftp")
            .await
            .map_err(|e| DomainError::Conflict(format!("sftp subsystem: {e}")))?;
        russh_sftp::client::SftpSession::new(channel.into_stream())
            .await
            .map_err(|e| DomainError::Conflict(format!("sftp: {e}")))
    }

    /// SFTP list directory.
    pub async fn sftp_list_dir(
        &self,
        host_id: &str,
        path: &str,
    ) -> Result<Vec<SftpEntry>, DomainError> {
        let sftp = self.open_sftp(host_id).await?;
        let request = if path.is_empty() { "." } else { path };
        // Resolve `.` / relative paths to absolute so entries never become `.filename`.
        let resolved = sftp
            .canonicalize(request)
            .await
            .unwrap_or_else(|_| request.to_string());
        let base = resolved.trim_end_matches('/').to_string();
        let base = if base.is_empty() { "/".to_string() } else { base };

        let entries = sftp
            .read_dir(&base)
            .await
            .map_err(|e| DomainError::Conflict(format!("readdir: {e}")))?;

        let mut out = Vec::new();
        for entry in entries {
            let name = entry.file_name();
            if name == "." || name == ".." {
                continue;
            }
            let meta = entry.metadata();
            let full = join_remote(&base, &name);
            out.push(SftpEntry {
                name,
                path: full,
                is_dir: meta.file_type().is_dir(),
                size: meta.size.unwrap_or(0),
                mode: meta.permissions.unwrap_or(0),
                mtime: meta.mtime.unwrap_or(0) as i64,
                uid: meta.uid.unwrap_or(0),
                gid: meta.gid.unwrap_or(0),
            });
        }
        out.sort_by(|a, b| match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.cmp(&b.name),
        });
        Ok(out)
    }

    /// Read remote file as UTF-8 (lossy). Cap 5MB for editor.
    pub async fn sftp_read(&self, host_id: &str, path: &str) -> Result<(String, i64), DomainError> {
        let (bytes, mtime) = self.sftp_read_bytes(host_id, path, Some(5_000_000)).await?;
        Ok((String::from_utf8_lossy(&bytes).into_owned(), mtime))
    }

    /// Read remote file as raw bytes. Optional size cap (bytes).
    pub async fn sftp_read_bytes(
        &self,
        host_id: &str,
        path: &str,
        max_bytes: Option<u64>,
    ) -> Result<(Vec<u8>, i64), DomainError> {
        let sftp = self.open_sftp(host_id).await?;
        let meta = sftp
            .metadata(path)
            .await
            .map_err(|e| DomainError::Conflict(e.to_string()))?;
        let mtime = meta.mtime.unwrap_or(0) as i64;
        let size = meta.size.unwrap_or(0);
        if let Some(max) = max_bytes {
            if size > max {
                return Err(DomainError::Conflict(format!(
                    "file too large (>{max} bytes)"
                )));
            }
        }
        let mut file = sftp
            .open(path)
            .await
            .map_err(|e| DomainError::Conflict(e.to_string()))?;
        let mut buf = Vec::with_capacity(size as usize);
        tokio::io::AsyncReadExt::read_to_end(&mut file, &mut buf)
            .await
            .map_err(|e| DomainError::Conflict(e.to_string()))?;
        Ok((buf, mtime))
    }

    /// Atomic UTF-8 write: temp + rename (editor).
    pub async fn sftp_write(
        &self,
        host_id: &str,
        path: &str,
        content: &str,
        expected_mtime: Option<i64>,
    ) -> Result<i64, DomainError> {
        self.sftp_write_bytes(host_id, path, content.as_bytes(), expected_mtime)
            .await
    }

    /// Atomic binary write: temp + rename.
    pub async fn sftp_write_bytes(
        &self,
        host_id: &str,
        path: &str,
        content: &[u8],
        expected_mtime: Option<i64>,
    ) -> Result<i64, DomainError> {
        self.sftp_write_bytes_progress(host_id, path, content, expected_mtime, |_, _| true)
            .await
    }

    /// Atomic binary write with byte progress callback `(done, total) -> continue`.
    /// Return `false` from the callback to cancel; the temp file is cleaned up.
    pub async fn sftp_write_bytes_progress<F>(
        &self,
        host_id: &str,
        path: &str,
        content: &[u8],
        expected_mtime: Option<i64>,
        mut on_progress: F,
    ) -> Result<i64, DomainError>
    where
        F: FnMut(u64, u64) -> bool + Send,
    {
        let sftp = self.open_sftp(host_id).await?;
        if let Some(exp) = expected_mtime {
            if let Ok(meta) = sftp.metadata(path).await {
                let cur = meta.mtime.unwrap_or(0) as i64;
                if cur != exp {
                    return Err(DomainError::Conflict(
                        "file changed on disk; reload or force save".into(),
                    ));
                }
            }
        }
        let total = content.len() as u64;
        let tmp = format!("{path}.sshbool.tmp");
        {
            let mut file = sftp
                .create(&tmp)
                .await
                .map_err(|e| DomainError::Conflict(e.to_string()))?;
            use tokio::io::AsyncWriteExt;
            const CHUNK: usize = 64 * 1024;
            let mut written: u64 = 0;
            if !on_progress(0, total) {
                drop(file);
                let _ = sftp.remove_file(&tmp).await;
                return Err(DomainError::Canceled);
            }
            for chunk in content.chunks(CHUNK) {
                file.write_all(chunk)
                    .await
                    .map_err(|e| DomainError::Conflict(e.to_string()))?;
                written += chunk.len() as u64;
                if !on_progress(written, total) {
                    drop(file);
                    let _ = sftp.remove_file(&tmp).await;
                    return Err(DomainError::Canceled);
                }
            }
            file.shutdown()
                .await
                .map_err(|e| DomainError::Conflict(e.to_string()))?;
        }
        let _ = sftp.remove_file(path).await;
        sftp.rename(&tmp, path)
            .await
            .map_err(|e| DomainError::Conflict(e.to_string()))?;
        let meta = sftp.metadata(path).await.ok();
        Ok(meta.and_then(|m| m.mtime).unwrap_or(0) as i64)
    }

    /// Stat a single remote path.
    pub async fn sftp_stat(&self, host_id: &str, path: &str) -> Result<SftpEntry, DomainError> {
        let sftp = self.open_sftp(host_id).await?;
        let meta = sftp
            .metadata(path)
            .await
            .map_err(|e| DomainError::Conflict(e.to_string()))?;
        let name = path
            .rsplit('/')
            .next()
            .filter(|s| !s.is_empty())
            .unwrap_or(path)
            .to_string();
        Ok(SftpEntry {
            name,
            path: path.to_string(),
            is_dir: meta.file_type().is_dir(),
            size: meta.size.unwrap_or(0),
            mode: meta.permissions.unwrap_or(0),
            mtime: meta.mtime.unwrap_or(0) as i64,
            uid: meta.uid.unwrap_or(0),
            gid: meta.gid.unwrap_or(0),
        })
    }

    pub async fn sftp_mkdir(&self, host_id: &str, path: &str) -> Result<(), DomainError> {
        let sftp = self.open_sftp(host_id).await?;
        sftp.create_dir(path)
            .await
            .map_err(|e| DomainError::Conflict(e.to_string()))
    }

    pub async fn sftp_rename(
        &self,
        host_id: &str,
        from: &str,
        to: &str,
    ) -> Result<(), DomainError> {
        let sftp = self.open_sftp(host_id).await?;
        sftp.rename(from, to)
            .await
            .map_err(|e| DomainError::Conflict(e.to_string()))
    }

    pub async fn sftp_delete(
        &self,
        host_id: &str,
        path: &str,
        recursive: bool,
    ) -> Result<(), DomainError> {
        let sftp = self.open_sftp(host_id).await?;
        Self::sftp_delete_path(&sftp, path, recursive).await
    }

    async fn sftp_delete_path(
        sftp: &russh_sftp::client::SftpSession,
        path: &str,
        recursive: bool,
    ) -> Result<(), DomainError> {
        let is_dir = sftp
            .metadata(path)
            .await
            .map(|m| m.file_type().is_dir())
            .unwrap_or(false);
        if is_dir {
            if recursive {
                let entries = sftp
                    .read_dir(path)
                    .await
                    .map_err(|e| DomainError::Conflict(format!("readdir: {e}")))?;
                for entry in entries {
                    let name = entry.file_name();
                    if name == "." || name == ".." {
                        continue;
                    }
                    let child = join_remote(path, &name);
                    Box::pin(Self::sftp_delete_path(sftp, &child, true)).await?;
                }
            }
            sftp.remove_dir(path)
                .await
                .map_err(|e| DomainError::Conflict(e.to_string()))
        } else {
            sftp.remove_file(path)
                .await
                .map_err(|e| DomainError::Conflict(e.to_string()))
        }
    }

    /// Copy remote file or directory (recursive).
    pub async fn sftp_copy(
        &self,
        host_id: &str,
        from: &str,
        to: &str,
    ) -> Result<(), DomainError> {
        let sftp = self.open_sftp(host_id).await?;
        Self::sftp_copy_path(&sftp, from, to).await
    }

    async fn sftp_copy_path(
        sftp: &russh_sftp::client::SftpSession,
        from: &str,
        to: &str,
    ) -> Result<(), DomainError> {
        let meta = sftp
            .metadata(from)
            .await
            .map_err(|e| DomainError::Conflict(e.to_string()))?;
        if meta.file_type().is_dir() {
            let _ = sftp.create_dir(to).await;
            let entries = sftp
                .read_dir(from)
                .await
                .map_err(|e| DomainError::Conflict(format!("readdir: {e}")))?;
            for entry in entries {
                let name = entry.file_name();
                if name == "." || name == ".." {
                    continue;
                }
                let src = join_remote(from, &name);
                let dst = join_remote(to, &name);
                Box::pin(Self::sftp_copy_path(sftp, &src, &dst)).await?;
            }
            Ok(())
        } else {
            let mut file = sftp
                .open(from)
                .await
                .map_err(|e| DomainError::Conflict(e.to_string()))?;
            let mut buf = Vec::new();
            tokio::io::AsyncReadExt::read_to_end(&mut file, &mut buf)
                .await
                .map_err(|e| DomainError::Conflict(e.to_string()))?;
            let tmp = format!("{to}.sshbool.tmp");
            {
                let mut out = sftp
                    .create(&tmp)
                    .await
                    .map_err(|e| DomainError::Conflict(e.to_string()))?;
                use tokio::io::AsyncWriteExt;
                out.write_all(&buf)
                    .await
                    .map_err(|e| DomainError::Conflict(e.to_string()))?;
                out.shutdown()
                    .await
                    .map_err(|e| DomainError::Conflict(e.to_string()))?;
            }
            let _ = sftp.remove_file(to).await;
            sftp.rename(&tmp, to)
                .await
                .map_err(|e| DomainError::Conflict(e.to_string()))
        }
    }

    pub async fn sftp_chmod(
        &self,
        host_id: &str,
        path: &str,
        mode: u32,
    ) -> Result<(), DomainError> {
        let sftp = self.open_sftp(host_id).await?;
        let meta = russh_sftp::protocol::FileAttributes {
            permissions: Some(mode),
            ..Default::default()
        };
        sftp.set_metadata(path, meta)
            .await
            .map_err(|e| DomainError::Conflict(e.to_string()))
    }

    async fn load_host_password(&self, host_id: &str) -> Result<String, DomainError> {
        let key = format!("host:{host_id}:cred");
        let row: Option<(String,)> = sqlx::query_as("SELECT value FROM settings WHERE key = ?")
            .bind(&key)
            .fetch_optional(self.vault.pool())
            .await
            .map_err(|e| DomainError::Crypto(e.to_string()))?;
        let Some((cred_id,)) = row else {
            return Err(DomainError::NotFound {
                entity: "credential",
                id: Some(host_id.into()),
            });
        };
        let row: Option<(Vec<u8>, Vec<u8>)> =
            sqlx::query_as("SELECT ciphertext, nonce FROM credentials WHERE id = ?")
                .bind(&cred_id)
                .fetch_optional(self.vault.pool())
                .await
                .map_err(|e| DomainError::Crypto(e.to_string()))?;
        let Some((ct, nonce)) = row else {
            return Err(DomainError::NotFound {
                entity: "credential",
                id: Some(cred_id),
            });
        };
        let plain = self
            .vault
            .open_secret(&ct, &nonce, &format!("cred:{cred_id}"))
            .await?;
        String::from_utf8(plain).map_err(|e| DomainError::Crypto(e.to_string()))
    }

    async fn load_host_key(&self, host_id: &str) -> Result<(String, Option<String>), DomainError> {
        let key = format!("host:{host_id}:ssh_key");
        let row: Option<(String,)> = sqlx::query_as("SELECT value FROM settings WHERE key = ?")
            .bind(&key)
            .fetch_optional(self.vault.pool())
            .await
            .map_err(|e| DomainError::Crypto(e.to_string()))?;
        let Some((key_id,)) = row else {
            return Err(DomainError::NotFound {
                entity: "ssh_key",
                id: Some(host_id.into()),
            });
        };
        let row = sqlx::query_as::<_, (Option<Vec<u8>>, Option<Vec<u8>>)>(
            "SELECT private_ciphertext, private_nonce FROM ssh_keys WHERE id = ?",
        )
        .bind(&key_id)
        .fetch_optional(self.vault.pool())
        .await
        .map_err(|e| DomainError::Crypto(e.to_string()))?;
        let Some((Some(ct), Some(nonce))) = row else {
            return Err(DomainError::NotFound {
                entity: "ssh_key",
                id: Some(key_id),
            });
        };
        let plain = self
            .vault
            .open_secret(&ct, &nonce, &format!("key:{key_id}"))
            .await?;
        let pem = String::from_utf8(plain).map_err(|e| DomainError::Crypto(e.to_string()))?;
        Ok((pem, None))
    }
}

/// SFTP directory entry.
pub struct SftpEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub mode: u32,
    pub mtime: i64,
    pub uid: u32,
    pub gid: u32,
}

fn join_remote(base: &str, name: &str) -> String {
    if base.is_empty() || base == "." {
        format!("./{name}")
    } else if base == "/" {
        format!("/{name}")
    } else if base.ends_with('/') {
        format!("{base}{name}")
    } else {
        format!("{base}/{name}")
    }
}
