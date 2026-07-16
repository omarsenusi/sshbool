-- 0007_datastores.sql
CREATE TABLE IF NOT EXISTS db_connections (
  id TEXT PRIMARY KEY NOT NULL,
  host_id TEXT REFERENCES hosts(id) ON DELETE SET NULL,
  engine TEXT NOT NULL,
  name TEXT NOT NULL,
  host TEXT,
  port INTEGER,
  database_name TEXT,
  username TEXT,
  credential_id TEXT,
  ssl_json TEXT,
  tunnel_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS saved_queries (
  id TEXT PRIMARY KEY NOT NULL,
  db_connection_id TEXT NOT NULL REFERENCES db_connections(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sql TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS query_history (
  id TEXT PRIMARY KEY NOT NULL,
  db_connection_id TEXT REFERENCES db_connections(id) ON DELETE SET NULL,
  sql TEXT NOT NULL,
  ran_at INTEGER NOT NULL,
  duration_ms INTEGER,
  row_count INTEGER,
  error TEXT
);

CREATE INDEX IF NOT EXISTS ix_query_history_ran ON query_history(ran_at);
