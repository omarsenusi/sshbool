# Feature 14 — Server Dashboard

Backend: `infrastructure/monitoring/*` (doc 05 §3.4); domain `monitoring`; UI `features/dashboard`.

## 1. Scope checklist

Realtime monitoring · CPU · Memory · Swap · Disk · Filesystem · Load · Temperature · Network ·
Bandwidth · Processes · Docker · Services · Systemd · Uptime · Kernel · Distribution · Updates.

## 2. Collection strategy (agentless)

- No agent is installed on the remote host. Metrics are gathered by running lightweight,
  read-only probes over a **dedicated `exec` channel** on the host's already-open multiplexed SSH
  connection (doc 01 §7), on a per-host sampling interval (`monitoring_start({ hostId, intervalMs })`, default 2s while the dashboard tab is visible, paused when not).
- Probes prefer parsing `/proc` and standard CLI tools already present on virtually all Linux
  distros, with per-distro fallbacks so the dashboard degrades gracefully rather than failing:

| Metric | Primary source | Fallback |
|---|---|---|
| CPU % | `/proc/stat` delta | `top -bn1` |
| Memory / Swap | `/proc/meminfo` | `free -b` |
| Load | `/proc/loadavg` | `uptime` |
| Disk / Filesystem | `df -PB1` | `/proc/mounts` + `statvfs` via `stat -f` |
| Network / Bandwidth | `/proc/net/dev` delta (bytes/sec) | `ip -s link` |
| Temperature | `/sys/class/thermal/thermal_zone*/temp` | `sensors -j` (if `lm-sensors` present; omitted otherwise) |
| Processes | `/proc/[pid]/stat` + `/proc/[pid]/status` | `ps aux` |
| Services (systemd) | `systemctl list-units --type=service --output=json` | `service --status-all` (non-systemd) |
| Uptime | `/proc/uptime` | `uptime -p` |
| Kernel / Distro | `uname -r` + `/etc/os-release` | `lsb_release -a` |
| Updates | distro package manager dry-run (`apt list --upgradable`, `dnf check-update`, `pacman -Qu`) | omitted if unsupported |
| Docker | via the Containers feature (doc `features/15-docker-kubernetes.md`) surfaced as a dashboard widget | — |

- Parsers live in `infrastructure/monitoring/parsers/*.rs`, each independently unit-tested against
  captured real-world command output fixtures (no live host needed for tests).
- Windows/macOS remote targets get a reduced metric set (best-effort via `wmic`/PowerShell or
  `vm_stat`/`sysctl`) — full parity is Linux-first; documented per-OS capability matrix in-app.

## 3. Data model & down-sampling

- Each sample produces a `HostSnapshot` (latest state, upserted) and appends points to
  `metric_series` per metric, bucketed and capped per host (ring buffer, doc 04 §5 / doc 23) so
  dashboard history doesn't grow unbounded.
- `GetSeries({ hostId, metric, from, to })` powers sparklines/charts; `GetSnapshot` powers the
  current-value tiles.

## 4. UI composition

- `DashboardGrid` — draggable/resizable widget grid (persisted per host), widgets: `CpuWidget`,
  `MemoryWidget`, `SwapWidget`, `LoadWidget`, `DiskWidget`, `FilesystemWidget`, `NetworkWidget`,
  `TemperatureWidget`, `UptimeWidget`, `KernelWidget`, `ProcessesWidget`, `ServicesWidget`,
  `UpdatesWidget` (full inventory and wireframe in doc 06 §4.6 and doc 09 §6).
- Charts are lightweight custom SVG/canvas (`Sparkline`, `AreaChart`, `Gauge`) — no heavy charting
  library, to keep bundle size and render cost low (doc 23).
- `ProcessesWidget` is a virtualized, sortable table with a **Kill** action (`process_kill`,
  confirms for non-owned/system PIDs); `ServicesWidget` offers start/stop/restart
  (`service_control`) gated behind a confirmation for production hosts (color-labeled).

## 5. Realtime updates

- Snapshots stream via `metrics://snapshot/{hostId}` events (doc 07 §3), throttled to the widget's
  effective refresh rate (≤ 4 Hz per doc 23 render budget) regardless of sampling interval, so a
  fast collector never causes excessive re-renders.
- Widgets subscribe individually (`useSnapshot(hostId)`, `useSeries`) so an inactive/minimized
  dashboard tab can be fully unsubscribed, and `monitoring_stop` is called to stop server-side
  sampling when no widget needs it — avoiding wasted `exec` calls on idle hosts.

## 6. Alert thresholds (lightweight, local)

- Optional per-host thresholds (CPU/mem/disk %) trigger a toast + status-bar badge when crossed;
  no external alerting/paging in v1 (see doc 28 for future alerting integrations).

## 7. Commands & events

`monitoring_start/stop`, `monitoring_snapshot`, `monitoring_series`, `processes_list`,
`process_kill`, `services_list`, `service_control`, `disks_list`, `system_info`, `updates_list`
(doc 07 §4.5). Events: `metrics://snapshot/{hostId}`.

## 8. Acceptance criteria

- Dashboard renders live, correct CPU/mem/swap/load/disk/network/temp values against a real Ubuntu,
  Debian, and Alpine host (temperature widget gracefully hidden where unavailable).
- Killing a process and restarting a systemd service both work and reflect immediately.
- Leaving the dashboard tab stops server-side sampling (`monitoring_stop` verified via no further
  `exec` calls); reopening resumes cleanly.
- `metric_series` storage stays within its configured cap over a 24h soak test (no unbounded growth).
