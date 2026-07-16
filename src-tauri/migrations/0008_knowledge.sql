-- 0008_knowledge.sql
CREATE TABLE IF NOT EXISTS snippets (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  body TEXT NOT NULL,
  language TEXT,
  tags_json TEXT,
  shortcut TEXT,
  usage_count INTEGER NOT NULL DEFAULT 0,
  is_favorite INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY NOT NULL,
  host_id TEXT REFERENCES hosts(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  body_md TEXT NOT NULL,
  color TEXT,
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  body TEXT NOT NULL,
  variables_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
