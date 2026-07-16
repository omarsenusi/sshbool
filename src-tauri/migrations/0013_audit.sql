-- 0013_audit.sql
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY NOT NULL,
  at INTEGER NOT NULL,
  actor TEXT,
  action TEXT NOT NULL,
  target TEXT,
  metadata_json TEXT,
  result TEXT
);

CREATE INDEX IF NOT EXISTS ix_audit_at ON audit_log(at);
