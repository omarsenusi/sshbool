-- 0011_plugins.sql
CREATE TABLE IF NOT EXISTS plugins (
  id TEXT PRIMARY KEY NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  source TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  manifest_json TEXT NOT NULL,
  installed_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS plugin_permissions (
  id TEXT PRIMARY KEY NOT NULL,
  plugin_id TEXT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
  capability TEXT NOT NULL,
  granted INTEGER NOT NULL DEFAULT 0,
  granted_at INTEGER
);
