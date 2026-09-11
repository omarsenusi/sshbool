//! Server configuration and LoopbackAddr binding type.

use crate::error::McpError;
use std::net::SocketAddr;

/// Rejects any address that is not loopback. Construction is the enforcement point,
/// so a misconfigured port cannot expose the server on a LAN interface.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LoopbackAddr(SocketAddr);

impl LoopbackAddr {
    pub fn new(port: u16) -> Result<Self, McpError> {
        let addr_str = format!("127.0.0.1:{port}");
        let addr: SocketAddr = addr_str
            .parse()
            .map_err(|e: std::net::AddrParseError| McpError::NonLoopbackBind(e.to_string()))?;
        if !addr.ip().is_loopback() {
            return Err(McpError::NonLoopbackBind(addr_str));
        }
        Ok(Self(addr))
    }

    pub fn parse(s: &str) -> Result<Self, McpError> {
        let addr: SocketAddr = s
            .parse()
            .map_err(|e: std::net::AddrParseError| McpError::NonLoopbackBind(e.to_string()))?;
        if !addr.ip().is_loopback() {
            return Err(McpError::NonLoopbackBind(s.to_string()));
        }
        Ok(Self(addr))
    }

    pub fn addr(&self) -> SocketAddr {
        self.0
    }

    pub fn port(&self) -> u16 {
        self.0.port()
    }
}

/// Server runtime configuration settings.
#[derive(Debug, Clone)]
pub struct ServerConfig {
    pub bind_addr: LoopbackAddr,
    pub ruleset_version: u32,
    pub approval_timeout_ms: u64,
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            bind_addr: LoopbackAddr::new(47821).expect("47821 loopback"),
            ruleset_version: 1,
            approval_timeout_ms: 60000,
        }
    }
}
