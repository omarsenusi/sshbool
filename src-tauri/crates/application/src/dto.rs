//! IPC DTOs (camelCase for the frontend).

use serde::{Deserialize, Serialize};

/// Vault status DTO.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultStatusDto {
    /// Initialized.
    pub initialized: bool,
    /// Locked.
    pub locked: bool,
    /// Biometric.
    pub biometric: bool,
}

/// New host input.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewHostDto {
    /// Label.
    pub label: String,
    /// Hostname.
    pub hostname: String,
    /// Port.
    pub port: u16,
    /// Username.
    pub username: Option<String>,
    /// Auth method.
    pub auth_method: String,
    /// Group.
    pub group_id: Option<String>,
    /// Identity.
    pub identity_id: Option<String>,
    /// Notes.
    pub notes: Option<String>,
    /// Color.
    pub color: Option<String>,
    /// Custom tile icon (data URL).
    #[serde(default)]
    pub icon: Option<String>,
    /// Password (ephemeral, never stored plaintext).
    pub password: Option<String>,
    /// SSH key id (`auto` = latest vault key).
    pub ssh_key_id: Option<String>,
    /// ProxyJump host id.
    #[serde(default)]
    pub jump_host_id: Option<String>,
    /// Outbound proxy id.
    #[serde(default)]
    pub proxy_id: Option<String>,
}

/// Host DTO.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostDto {
    /// Id.
    pub id: String,
    /// Group.
    pub group_id: Option<String>,
    /// Label.
    pub label: String,
    /// Hostname.
    pub hostname: String,
    /// Port.
    pub port: u16,
    /// Username.
    pub username: Option<String>,
    /// Auth method.
    pub auth_method: String,
    /// Identity.
    pub identity_id: Option<String>,
    /// Color.
    pub color: Option<String>,
    /// Custom tile icon (data URL).
    pub icon: Option<String>,
    /// Favorite.
    pub is_favorite: bool,
    /// Pinned.
    pub is_pinned: bool,
    /// Notes.
    pub notes: Option<String>,
    /// Last connected.
    pub last_connected_at: Option<i64>,
    /// Connect count.
    pub connect_count: i64,
    /// ProxyJump host id.
    pub jump_host_id: Option<String>,
    /// Outbound proxy id.
    pub proxy_id: Option<String>,
}

/// Host summary.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostSummaryDto {
    /// Id.
    pub id: String,
    /// Label.
    pub label: String,
    /// Hostname.
    pub hostname: String,
    /// Port.
    pub port: u16,
    /// Username.
    pub username: Option<String>,
    /// Favorite.
    pub is_favorite: bool,
    /// Last connected.
    pub last_connected_at: Option<i64>,
}

/// Group DTO.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupDto {
    /// Id.
    pub id: String,
    /// Parent.
    pub parent_id: Option<String>,
    /// Name.
    pub name: String,
    /// Color.
    pub color: Option<String>,
    /// Icon.
    pub icon: Option<String>,
    /// Sort.
    pub sort_order: i64,
}

/// Host tree node.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum HostTreeNode {
    /// Group node.
    Group {
        /// Group.
        group: GroupDto,
        /// Children.
        children: Vec<HostTreeNode>,
    },
    /// Host node.
    Host {
        /// Host.
        host: HostDto,
    },
}

/// Generate key request.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateKeyDto {
    /// Name.
    pub name: String,
    /// Type.
    pub key_type: String,
    /// Bits.
    pub bits: Option<u32>,
    /// Comment.
    pub comment: Option<String>,
    /// Passphrase.
    pub passphrase: Option<String>,
}

/// SSH key DTO.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshKeyDto {
    /// Id.
    pub id: String,
    /// Name.
    pub name: String,
    /// Type.
    pub key_type: String,
    /// Public key.
    pub public_key: String,
    /// Fingerprint.
    pub fingerprint_sha256: String,
    /// Comment.
    pub comment: Option<String>,
    /// Has passphrase.
    pub has_passphrase: bool,
    /// Hardware.
    pub hardware_backed: bool,
    /// Source.
    pub source: String,
    /// Created.
    pub created_at: i64,
}

/// Pane info.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaneInfoDto {
    /// Pane id.
    pub pane_id: String,
    /// Session id.
    pub session_id: String,
    /// Host id.
    pub host_id: String,
    /// Title.
    pub title: String,
}

/// SFTP entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpEntryDto {
    /// Name.
    pub name: String,
    /// Path.
    pub path: String,
    /// Is directory.
    pub is_dir: bool,
    /// Size.
    pub size: u64,
    /// Mode.
    pub mode: u32,
    /// Mtime.
    pub mtime: i64,
    /// Uid.
    pub uid: u32,
    /// Gid.
    pub gid: u32,
}

/// Transfer job.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferJobDto {
    /// Id.
    pub id: String,
    /// Host.
    pub host_id: String,
    /// Kind.
    pub kind: String,
    /// Source.
    pub source_root: String,
    /// Dest.
    pub dest_root: String,
    /// Status.
    pub status: String,
    /// Total bytes.
    pub total_bytes: i64,
    /// Transferred.
    pub transferred_bytes: i64,
    /// Total items.
    pub total_items: i64,
    /// Done items.
    pub done_items: i64,
    /// Error.
    pub error: Option<String>,
}

/// Snippet.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnippetDto {
    /// Id.
    pub id: String,
    /// Name.
    pub name: String,
    /// Body.
    pub body: String,
    /// Language.
    pub language: Option<String>,
    /// Tags json.
    pub tags_json: Option<String>,
    /// Shortcut.
    pub shortcut: Option<String>,
    /// Usage.
    pub usage_count: i64,
    /// Favorite.
    pub is_favorite: bool,
}

/// Note.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteDto {
    /// Id.
    pub id: String,
    /// Host.
    pub host_id: Option<String>,
    /// Title.
    pub title: String,
    /// Body.
    pub body_md: String,
    /// Color.
    pub color: Option<String>,
    /// Pinned.
    pub pinned: bool,
}

/// Template.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateDto {
    /// Id.
    pub id: String,
    /// Name.
    pub name: String,
    /// Kind.
    pub kind: String,
    /// Body.
    pub body: String,
    /// Variables.
    pub variables_json: Option<String>,
}

/// Search hit.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResultDto {
    /// Kind.
    pub kind: String,
    /// Id.
    pub id: String,
    /// Title.
    pub title: String,
    /// Subtitle.
    pub subtitle: Option<String>,
}

/// App info.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfoDto {
    /// Name.
    pub name: String,
    /// Version.
    pub version: String,
    /// Tauri version.
    pub tauri_version: String,
}
