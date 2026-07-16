-- 0001_init.sql
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY NOT NULL,
  parent_id TEXT REFERENCES groups(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  color TEXT,
  icon TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS identities (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  username TEXT,
  ssh_key_id TEXT,
  credential_id TEXT,
  agent_forwarding INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS proxies (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  host TEXT NOT NULL,
  port INTEGER NOT NULL,
  username TEXT,
  credential_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS terminal_profiles (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  font_family TEXT,
  font_size REAL,
  line_height REAL,
  color_scheme_json TEXT,
  cursor_style TEXT,
  scrollback INTEGER,
  bell INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS hosts (
  id TEXT PRIMARY KEY NOT NULL,
  group_id TEXT REFERENCES groups(id) ON DELETE SET NULL,
  label TEXT NOT NULL,
  hostname TEXT NOT NULL,
  port INTEGER NOT NULL DEFAULT 22,
  username TEXT,
  identity_id TEXT REFERENCES identities(id) ON DELETE SET NULL,
  auth_method TEXT NOT NULL,
  jump_host_id TEXT REFERENCES hosts(id) ON DELETE SET NULL,
  proxy_id TEXT REFERENCES proxies(id) ON DELETE SET NULL,
  use_compression INTEGER NOT NULL DEFAULT 0,
  keepalive_secs INTEGER,
  connection_sharing INTEGER NOT NULL DEFAULT 1,
  terminal_profile_id TEXT REFERENCES terminal_profiles(id) ON DELETE SET NULL,
  startup_command TEXT,
  environment TEXT,
  color TEXT,
  is_favorite INTEGER NOT NULL DEFAULT 0,
  is_pinned INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  last_connected_at INTEGER,
  connect_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE INDEX IF NOT EXISTS ix_hosts_group ON hosts(group_id);
CREATE INDEX IF NOT EXISTS ix_hosts_favorite ON hosts(is_favorite);
CREATE INDEX IF NOT EXISTS ix_hosts_pinned ON hosts(is_pinned);
CREATE INDEX IF NOT EXISTS ix_hosts_last_connected ON hosts(last_connected_at);

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL UNIQUE,
  color TEXT
);

CREATE TABLE IF NOT EXISTS host_tags (
  host_id TEXT NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (host_id, tag_id)
);

CREATE TABLE IF NOT EXISTS port_forwards (
  id TEXT PRIMARY KEY NOT NULL,
  host_id TEXT NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  bind_addr TEXT,
  bind_port INTEGER,
  dest_addr TEXT,
  dest_port INTEGER,
  auto_start INTEGER NOT NULL DEFAULT 0,
  label TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS known_hosts (
  id TEXT PRIMARY KEY NOT NULL,
  host TEXT NOT NULL,
  port INTEGER NOT NULL,
  key_type TEXT NOT NULL,
  fingerprint_sha256 TEXT NOT NULL,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_known_hosts_host_port ON known_hosts(host, port);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS themes (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  tokens_json TEXT NOT NULL,
  source TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS keybindings (
  id TEXT PRIMARY KEY NOT NULL,
  command TEXT NOT NULL,
  keys TEXT NOT NULL,
  when_context TEXT,
  created_at INTEGER NOT NULL
);
