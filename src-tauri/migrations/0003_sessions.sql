-- 0003_sessions.sql
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY NOT NULL,
  host_id TEXT NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  exit_reason TEXT,
  client_version TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_sessions_host ON sessions(host_id);
CREATE INDEX IF NOT EXISTS ix_sessions_started ON sessions(started_at);

CREATE TABLE IF NOT EXISTS session_panes (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  layout_json TEXT,
  title TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS recordings (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  pane_id TEXT REFERENCES session_panes(id) ON DELETE SET NULL,
  path TEXT NOT NULL,
  format TEXT NOT NULL,
  size_bytes INTEGER,
  duration_ms INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS command_history (
  id TEXT PRIMARY KEY NOT NULL,
  host_id TEXT REFERENCES hosts(id) ON DELETE SET NULL,
  command TEXT NOT NULL,
  cwd TEXT,
  exit_code INTEGER,
  ran_at INTEGER NOT NULL,
  duration_ms INTEGER
);

CREATE INDEX IF NOT EXISTS ix_command_history_ran ON command_history(ran_at);
