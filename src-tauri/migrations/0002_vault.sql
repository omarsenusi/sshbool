-- 0002_vault.sql
CREATE TABLE IF NOT EXISTS vault (
  id TEXT PRIMARY KEY NOT NULL,
  kdf TEXT NOT NULL,
  kdf_salt BLOB NOT NULL,
  kdf_params TEXT NOT NULL,
  verifier BLOB NOT NULL,
  wrapped_data_key BLOB NOT NULL,
  keychain_backed INTEGER NOT NULL DEFAULT 0,
  biometric_enabled INTEGER NOT NULL DEFAULT 0,
  auto_lock_secs INTEGER NOT NULL DEFAULT 900,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS credentials (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  ciphertext BLOB NOT NULL,
  nonce BLOB NOT NULL,
  aad TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ssh_keys (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  key_type TEXT NOT NULL,
  public_key TEXT NOT NULL,
  private_ciphertext BLOB,
  private_nonce BLOB,
  fingerprint_sha256 TEXT NOT NULL,
  comment TEXT,
  has_passphrase INTEGER NOT NULL DEFAULT 0,
  hardware_backed INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_ssh_keys_fp ON ssh_keys(fingerprint_sha256);
