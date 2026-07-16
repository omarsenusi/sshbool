-- 0006_containers.sql
CREATE TABLE IF NOT EXISTS docker_hosts (
  id TEXT PRIMARY KEY NOT NULL,
  host_id TEXT NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  socket_path TEXT,
  tls_json TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS compose_files (
  id TEXT PRIMARY KEY NOT NULL,
  host_id TEXT REFERENCES hosts(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  name TEXT,
  content_cache TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS k8s_contexts (
  id TEXT PRIMARY KEY NOT NULL,
  host_id TEXT REFERENCES hosts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kubeconfig_ref TEXT,
  namespace TEXT,
  created_at INTEGER NOT NULL
);
