//! MCP protocol module.

pub mod handlers;
pub mod jsonrpc;

pub use handlers::{handle_protocol_request, AGENT_INSTRUCTIONS};
pub use jsonrpc::{JsonRpcErrorObject, JsonRpcRequest, JsonRpcResponse, RequestId};
