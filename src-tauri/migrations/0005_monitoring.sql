-- 0005_monitoring.sql
CREATE TABLE IF NOT EXISTS host_snapshots (
  id TEXT PRIMARY KEY NOT NULL,
  host_id TEXT NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  sampled_at INTEGER NOT NULL,
  cpu_pct REAL,
  mem_used INTEGER,
  mem_total INTEGER,
  swap_used INTEGER,
  swap_total INTEGER,
  load1 REAL,
  load5 REAL,
  load15 REAL,
  uptime_secs INTEGER,
  processes INTEGER,
  net_rx_bps REAL,
  net_tx_bps REAL,
  temp_c REAL,
  raw_json TEXT
);

CREATE INDEX IF NOT EXISTS ix_snapshots_host_sampled ON host_snapshots(host_id, sampled_at);

CREATE TABLE IF NOT EXISTS metric_series (
  id TEXT PRIMARY KEY NOT NULL,
  host_id TEXT NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  metric TEXT NOT NULL,
  bucket_start INTEGER NOT NULL,
  value REAL
);

CREATE INDEX IF NOT EXISTS ix_metric_series ON metric_series(host_id, metric, bucket_start);

CREATE TABLE IF NOT EXISTS disk_usage (
  id TEXT PRIMARY KEY NOT NULL,
  host_id TEXT NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  mount TEXT NOT NULL,
  fstype TEXT,
  size_bytes INTEGER,
  used_bytes INTEGER,
  sampled_at INTEGER NOT NULL
);
