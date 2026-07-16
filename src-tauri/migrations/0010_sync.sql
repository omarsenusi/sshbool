-- 0010_sync.sql
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  platform TEXT,
  public_key BLOB NOT NULL,
  last_seen_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_state (
  id TEXT PRIMARY KEY NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  endpoint TEXT,
  account_id TEXT,
  last_pull_at INTEGER,
  last_push_at INTEGER,
  vector_clock_json TEXT,
  root_key_wrapped BLOB
);

CREATE TABLE IF NOT EXISTS sync_changes (
  id TEXT PRIMARY KEY NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  op TEXT NOT NULL,
  ciphertext BLOB NOT NULL,
  nonce BLOB,
  rev INTEGER NOT NULL DEFAULT 0,
  acked INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_sync_changes_acked ON sync_changes(acked, created_at);
