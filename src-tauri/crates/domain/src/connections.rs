//! Connection / host domain types.

use serde::{Deserialize, Serialize};

use crate::ids::{GroupId, HostId};

/// Host connection profile.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Host {
    /// Id.
    pub id: HostId,
    /// Group.
    pub group_id: Option<GroupId>,
    /// Label.
    pub label: String,
    /// Hostname / IP.
    pub hostname: String,
    /// Port.
    pub port: u16,
    /// Username.
    pub username: Option<String>,
    /// Auth method.
    pub auth_method: String,
    /// Identity id.
    pub identity_id: Option<String>,
    /// Color.
    pub color: Option<String>,
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
}

/// Host group.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Group {
    /// Id.
    pub id: GroupId,
    /// Parent.
    pub parent_id: Option<GroupId>,
    /// Name.
    pub name: String,
    /// Color.
    pub color: Option<String>,
    /// Icon.
    pub icon: Option<String>,
    /// Sort order.
    pub sort_order: i64,
}
