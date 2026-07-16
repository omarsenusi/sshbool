-- 0015_team.sql
CREATE TABLE IF NOT EXISTS team_memberships (
  id TEXT PRIMARY KEY NOT NULL,
  team_id TEXT NOT NULL,
  team_name TEXT,
  role TEXT NOT NULL DEFAULT 'member',
  invite_code TEXT,
  joined_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS shared_directories (
  id TEXT PRIMARY KEY NOT NULL,
  team_id TEXT NOT NULL,
  name TEXT NOT NULL,
  metadata_json TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS team_policies (
  id TEXT PRIMARY KEY NOT NULL,
  team_id TEXT NOT NULL UNIQUE,
  policy_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
