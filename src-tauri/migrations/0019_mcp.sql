-- 0019_mcp.sql
-- MCP server: clients, scope, policy, approvals, and the call ledger.
-- See docs/mcp/05-database-schema.md

-- ── Server state ────────────────────────────────────────────────────
-- Single row, id = 'current'.
CREATE TABLE IF NOT EXISTS mcp_server_state (
  id                  TEXT PRIMARY KEY NOT NULL,
  enabled             INTEGER NOT NULL DEFAULT 0,
  autostart           INTEGER NOT NULL DEFAULT 0,
  bind_addr           TEXT NOT NULL DEFAULT '127.0.0.1',
  port                INTEGER NOT NULL DEFAULT 47821,
  ruleset_version     INTEGER NOT NULL DEFAULT 1,
  approval_timeout_ms INTEGER NOT NULL DEFAULT 60000,
  last_started_at     INTEGER,
  last_stopped_at     INTEGER,
  updated_at          INTEGER NOT NULL
);

INSERT OR IGNORE INTO mcp_server_state (id, enabled, updated_at)
VALUES ('current', 0, 0);

-- ── Paired clients ──────────────────────────────────────────────────
-- token_hash: SHA-256 of the bearer token. Constant-time compared.
-- token_sealed: vault-AEAD ciphertext, retained only for the one-time
--   reveal in the pairing dialog, cleared once revealed.
CREATE TABLE IF NOT EXISTS mcp_clients (
  id                TEXT PRIMARY KEY NOT NULL,
  name              TEXT NOT NULL,
  client_version    TEXT,
  token_hash        TEXT NOT NULL,
  token_sealed      TEXT,
  token_issued_at   INTEGER NOT NULL,
  token_expires_at  INTEGER NOT NULL,
  workspace_id      TEXT NOT NULL DEFAULT 'default',
  mode              TEXT NOT NULL DEFAULT 'read_only',
  strict_plans      INTEGER NOT NULL DEFAULT 0,
  enabled           INTEGER NOT NULL DEFAULT 1,
  suspended_reason  TEXT,
  paired_at         INTEGER NOT NULL,
  last_seen_at      INTEGER,
  updated_at        INTEGER NOT NULL,
  CHECK (mode IN ('read_only', 'assisted', 'full'))
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_mcp_clients_token ON mcp_clients(token_hash);
CREATE INDEX IF NOT EXISTS ix_mcp_clients_enabled ON mcp_clients(enabled);

-- ── Pairing codes ───────────────────────────────────────────────────
-- Short-lived, single-use. code_hash is SHA-256, the plaintext code
-- lives only in the UI for its 5-minute lifetime.
CREATE TABLE IF NOT EXISTS mcp_pairing_codes (
  id          TEXT PRIMARY KEY NOT NULL,
  code_hash   TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  consumed_at INTEGER,
  attempts    INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS ix_mcp_pairing_expires ON mcp_pairing_codes(expires_at);

-- ── Host scope ──────────────────────────────────────────────────────
-- Presence of a row = the host is visible to the client.
-- Absence = invisible, not merely denied.
CREATE TABLE IF NOT EXISTS mcp_client_hosts (
  id            TEXT PRIMARY KEY NOT NULL,
  client_id     TEXT NOT NULL REFERENCES mcp_clients(id) ON DELETE CASCADE,
  host_id       TEXT NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  exec_allowed  INTEGER NOT NULL DEFAULT 0,
  write_allowed INTEGER NOT NULL DEFAULT 0,
  granted_at    INTEGER NOT NULL,
  granted_by    TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_mcp_client_hosts
  ON mcp_client_hosts(client_id, host_id);
CREATE INDEX IF NOT EXISTS ix_mcp_client_hosts_host
  ON mcp_client_hosts(host_id);

-- ── Per-tool policy overrides ───────────────────────────────────────
-- tier_override may only RAISE the tier above the catalog default.
-- Enforced in Rust and in the UI, the DB cannot express the ordering.
CREATE TABLE IF NOT EXISTS mcp_policies (
  id                TEXT PRIMARY KEY NOT NULL,
  client_id         TEXT NOT NULL REFERENCES mcp_clients(id) ON DELETE CASCADE,
  tool              TEXT NOT NULL,
  tier_override     TEXT,
  requires_approval INTEGER,
  rate_limit_per_min INTEGER,
  disabled          INTEGER NOT NULL DEFAULT 0,
  updated_at        INTEGER NOT NULL,
  CHECK (tier_override IS NULL OR tier_override IN ('safe', 'write', 'dangerous'))
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_mcp_policies_client_tool
  ON mcp_policies(client_id, tool);

-- ── Per-client budgets ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mcp_budgets (
  client_id             TEXT PRIMARY KEY NOT NULL
                          REFERENCES mcp_clients(id) ON DELETE CASCADE,
  calls_per_min         INTEGER NOT NULL DEFAULT 60,
  execs_per_min         INTEGER NOT NULL DEFAULT 10,
  concurrent_calls      INTEGER NOT NULL DEFAULT 4,
  concurrent_execs      INTEGER NOT NULL DEFAULT 2,
  max_handles           INTEGER NOT NULL DEFAULT 8,
  max_result_bytes      INTEGER NOT NULL DEFAULT 262144,
  exec_timeout_ms       INTEGER NOT NULL DEFAULT 60000,
  max_pending_approvals INTEGER NOT NULL DEFAULT 3,
  approvals_per_hour    INTEGER NOT NULL DEFAULT 40,
  handle_idle_ms        INTEGER NOT NULL DEFAULT 600000,
  handle_max_ms         INTEGER NOT NULL DEFAULT 3600000,
  updated_at            INTEGER NOT NULL
);

-- ── Approvals ───────────────────────────────────────────────────────
-- args_hash / command_hash are hex SHA-256. command_preview is
-- redacted and capped at 512 bytes. Raw command text is never stored.
CREATE TABLE IF NOT EXISTS mcp_approvals (
  id              TEXT PRIMARY KEY NOT NULL,
  client_id       TEXT NOT NULL REFERENCES mcp_clients(id) ON DELETE CASCADE,
  host_id         TEXT REFERENCES hosts(id) ON DELETE SET NULL,
  session_handle  TEXT,
  tool            TEXT NOT NULL,
  args_hash       TEXT NOT NULL,
  command_hash    TEXT,
  command_preview TEXT,
  risk_tier       TEXT NOT NULL,
  risk_reasons    TEXT,
  ruleset_version INTEGER NOT NULL,
  preview_output  TEXT,
  decision        TEXT NOT NULL DEFAULT 'pending',
  decided_by      TEXT,
  decided_at      INTEGER,
  nonce_hash      TEXT,
  consumed_at     INTEGER,
  requested_at    INTEGER NOT NULL,
  expires_at      INTEGER NOT NULL,
  CHECK (risk_tier IN ('safe', 'write', 'dangerous')),
  CHECK (decision IN ('pending','allow_once','allow_session','deny','timeout','revoked'))
);

CREATE INDEX IF NOT EXISTS ix_mcp_approvals_client
  ON mcp_approvals(client_id, requested_at);
CREATE INDEX IF NOT EXISTS ix_mcp_approvals_pending
  ON mcp_approvals(decision, expires_at);

-- ── Session-scoped grants ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mcp_grants (
  id             TEXT PRIMARY KEY NOT NULL,
  client_id      TEXT NOT NULL REFERENCES mcp_clients(id) ON DELETE CASCADE,
  session_handle TEXT NOT NULL,
  host_id        TEXT REFERENCES hosts(id) ON DELETE CASCADE,
  tool           TEXT NOT NULL,
  arg_shape_hash TEXT NOT NULL,
  max_uses       INTEGER NOT NULL DEFAULT 20,
  uses           INTEGER NOT NULL DEFAULT 0,
  approval_id    TEXT REFERENCES mcp_approvals(id) ON DELETE SET NULL,
  created_at     INTEGER NOT NULL,
  expires_at     INTEGER NOT NULL,
  revoked_at     INTEGER
);

CREATE INDEX IF NOT EXISTS ix_mcp_grants_lookup
  ON mcp_grants(client_id, session_handle, tool);
CREATE INDEX IF NOT EXISTS ix_mcp_grants_expires
  ON mcp_grants(expires_at);

-- ── Call ledger ─────────────────────────────────────────────────────
-- One row per tool call, including denials and errors. This is the
-- forensic record, audit_log carries the summary.
CREATE TABLE IF NOT EXISTS mcp_calls (
  id              TEXT PRIMARY KEY NOT NULL,
  at              INTEGER NOT NULL,
  client_id       TEXT,
  client_name     TEXT,
  host_id         TEXT,
  host_label      TEXT,
  session_handle  TEXT,
  tool            TEXT NOT NULL,
  args_hash       TEXT,
  command_preview TEXT,
  risk_tier       TEXT,
  risk_reasons    TEXT,
  ruleset_version INTEGER,
  decision        TEXT NOT NULL,
  approval_id     TEXT,
  grant_id        TEXT,
  duration_ms     INTEGER,
  result_bytes    INTEGER,
  truncated       INTEGER NOT NULL DEFAULT 0,
  error_code      TEXT,
  reason          TEXT,
  CHECK (decision IN ('allow','allow_grant','allow_approved','deny','hard_deny','error','timeout'))
);

CREATE INDEX IF NOT EXISTS ix_mcp_calls_at ON mcp_calls(at);
CREATE INDEX IF NOT EXISTS ix_mcp_calls_client ON mcp_calls(client_id, at);
CREATE INDEX IF NOT EXISTS ix_mcp_calls_decision ON mcp_calls(decision, at);

-- ── Cached host facts ───────────────────────────────────────────────
-- Fed by host_facts / sshbool://host/{id}/facts. 15-minute TTL.
CREATE TABLE IF NOT EXISTS mcp_host_facts (
  host_id      TEXT PRIMARY KEY NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  facts_json   TEXT NOT NULL,
  collected_at INTEGER NOT NULL
);

-- ── Production flag on hosts ────────────────────────────────────────
-- Production hosts always require approval and never allow session
-- grants. See docs/mcp/03-security-and-policy-engine.md section 3.
ALTER TABLE hosts ADD COLUMN production INTEGER NOT NULL DEFAULT 0;
