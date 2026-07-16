-- 0014_licensing.sql
CREATE TABLE IF NOT EXISTS license_state (
  id TEXT PRIMARY KEY NOT NULL,
  tier TEXT NOT NULL DEFAULT 'free',
  token_blob TEXT,
  signed_at INTEGER,
  expires_at INTEGER,
  last_validated_at INTEGER,
  device_fingerprint TEXT,
  updated_at INTEGER NOT NULL
);
