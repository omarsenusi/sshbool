-- 0004_transfers.sql
CREATE TABLE IF NOT EXISTS transfer_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  host_id TEXT NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  source_root TEXT NOT NULL,
  dest_root TEXT NOT NULL,
  status TEXT NOT NULL,
  total_bytes INTEGER NOT NULL DEFAULT 0,
  transferred_bytes INTEGER NOT NULL DEFAULT 0,
  total_items INTEGER NOT NULL DEFAULT 0,
  done_items INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS transfer_items (
  id TEXT PRIMARY KEY NOT NULL,
  job_id TEXT NOT NULL REFERENCES transfer_jobs(id) ON DELETE CASCADE,
  rel_path TEXT NOT NULL,
  size_bytes INTEGER,
  transferred_bytes INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  checksum TEXT,
  mtime INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sftp_bookmarks (
  id TEXT PRIMARY KEY NOT NULL,
  host_id TEXT NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  label TEXT,
  created_at INTEGER NOT NULL
);
