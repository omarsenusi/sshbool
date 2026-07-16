//! Realtime host monitoring: SSH exec probes + push events.

use std::collections::HashMap;
use std::sync::{Arc, LazyLock, Mutex};

use infrastructure::AppState;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::watch;
use tokio::task::JoinHandle;
use uuid::Uuid;

use crate::error::AppError;
use crate::events::metrics_snapshot;

fn db(e: sqlx::Error) -> AppError {
    AppError::Db {
        engine: "sqlite".into(),
        message: e.to_string(),
    }
}

#[derive(Default, Clone)]
struct PrevCounters {
    cpu_total: f64,
    cpu_idle: f64,
    /// iface -> (rx_bytes, tx_bytes)
    net: HashMap<String, (u64, u64)>,
    sampled_at_ms: i64,
}

struct SamplerEntry {
    refcount: u32,
    stop_tx: watch::Sender<bool>,
    handle: JoinHandle<()>,
}

static SAMPLERS: LazyLock<Mutex<HashMap<String, SamplerEntry>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn clamp_interval(ms: u64) -> u64 {
    ms.clamp(1_000, 10_000)
}

fn build_probe(include_procs: bool, include_services: bool) -> String {
    let mut s = String::from(
        r#"
echo '---CPU---'
grep 'cpu ' /proc/stat | awk '{print $2+$3+$4+$5+$6+$7+$8,$5}'
echo '---MEM---'
awk '/MemTotal|MemAvailable|SwapTotal|SwapFree/{print $1,$2}' /proc/meminfo
echo '---LOAD---'
cat /proc/loadavg
echo '---UPTIME---'
awk '{print $1}' /proc/uptime
echo '---DISK---'
df -PB1 2>/dev/null | awk 'NR>1 && $6 !~ /^\/(run|sys|dev|proc|snap)/{print $6,$2,$3}'
echo '---NET---'
awk 'NR>2{gsub(":","",$1); print $1,$2,$10}' /proc/net/dev
echo '---OS---'
uname -r; . /etc/os-release 2>/dev/null; echo "$NAME $VERSION_ID"
"#,
    );
    if include_procs {
        s.push_str(
            r#"
echo '---PROCS---'
ps aux --sort=-%cpu 2>/dev/null | head -n 26
"#,
        );
    }
    if include_services {
        s.push_str(
            r#"
echo '---SERVICES---'
systemctl list-units --type=service --no-pager --no-legend 2>/dev/null | head -n 40
"#,
        );
    }
    s
}

struct ParsedProbe {
    cpu_total: f64,
    cpu_idle: f64,
    mem_total: i64,
    mem_avail: i64,
    swap_total: i64,
    swap_free: i64,
    load1: f64,
    load5: f64,
    load15: f64,
    uptime_secs: i64,
    disks: Vec<Value>,
    /// iface -> (rx, tx)
    net: HashMap<String, (u64, u64)>,
    os_line: String,
    processes: Option<Vec<Value>>,
    services: Option<Vec<Value>>,
}

fn parse_probe(raw: &str) -> ParsedProbe {
    let mut cpu_total = 0.0_f64;
    let mut cpu_idle = 0.0_f64;
    let mut mem_total = 0_i64;
    let mut mem_avail = 0_i64;
    let mut swap_total = 0_i64;
    let mut swap_free = 0_i64;
    let mut load1 = 0.0;
    let mut load5 = 0.0;
    let mut load15 = 0.0;
    let mut uptime_secs = 0_i64;
    let mut disks = Vec::new();
    let mut net = HashMap::new();
    let mut os_line = String::new();
    let mut processes: Option<Vec<Value>> = None;
    let mut services: Option<Vec<Value>> = None;
    let mut section = "";

    for line in raw.lines() {
        if line.starts_with("---") {
            section = line;
            if section == "---PROCS---" {
                processes = Some(Vec::new());
            } else if section == "---SERVICES---" {
                services = Some(Vec::new());
            }
            continue;
        }
        match section {
            "---CPU---" => {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 2 {
                    cpu_total = parts[0].parse().unwrap_or(0.0);
                    cpu_idle = parts[1].parse().unwrap_or(0.0);
                }
            }
            "---MEM---" => {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 2 {
                    let v: i64 = parts[1].parse().unwrap_or(0) * 1024;
                    match parts[0] {
                        "MemTotal:" => mem_total = v,
                        "MemAvailable:" => mem_avail = v,
                        "SwapTotal:" => swap_total = v,
                        "SwapFree:" => swap_free = v,
                        _ => {}
                    }
                }
            }
            "---LOAD---" => {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 3 {
                    load1 = parts[0].parse().unwrap_or(0.0);
                    load5 = parts[1].parse().unwrap_or(0.0);
                    load15 = parts[2].parse().unwrap_or(0.0);
                }
            }
            "---UPTIME---" => {
                uptime_secs = line.trim().parse::<f64>().unwrap_or(0.0) as i64;
            }
            "---DISK---" => {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 3 {
                    disks.push(json!({
                        "mount": parts[0],
                        "sizeBytes": parts[1].parse::<i64>().unwrap_or(0),
                        "usedBytes": parts[2].parse::<i64>().unwrap_or(0),
                    }));
                }
            }
            "---NET---" => {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 3 {
                    let iface = parts[0].trim_end_matches(':');
                    if iface == "lo" {
                        continue;
                    }
                    let rx: u64 = parts[1].parse().unwrap_or(0);
                    let tx: u64 = parts[2].parse().unwrap_or(0);
                    net.insert(iface.to_string(), (rx, tx));
                }
            }
            "---OS---" => {
                if !line.trim().is_empty() {
                    if os_line.is_empty() {
                        os_line = line.to_string();
                    } else {
                        os_line = format!("{os_line} / {line}");
                    }
                }
            }
            "---PROCS---" => {
                if let Some(ref mut procs) = processes {
                    // skip header
                    if procs.is_empty() && line.contains("PID") && line.contains("%CPU") {
                        continue;
                    }
                    let parts: Vec<&str> = line.split_whitespace().collect();
                    if parts.len() < 11 {
                        continue;
                    }
                    procs.push(json!({
                        "user": parts[0],
                        "pid": parts[1].parse::<i64>().unwrap_or(0),
                        "cpu": parts[2].parse::<f64>().unwrap_or(0.0),
                        "mem": parts[3].parse::<f64>().unwrap_or(0.0),
                        "command": parts[10..].join(" "),
                    }));
                }
            }
            "---SERVICES---" => {
                if let Some(ref mut svcs) = services {
                    let parts: Vec<&str> = line.split_whitespace().collect();
                    if parts.len() >= 4 {
                        svcs.push(json!({
                            "unit": parts[0],
                            "load": parts[1],
                            "active": parts[2],
                            "sub": parts[3],
                        }));
                    }
                }
            }
            _ => {}
        }
    }

    ParsedProbe {
        cpu_total,
        cpu_idle,
        mem_total,
        mem_avail,
        swap_total,
        swap_free,
        load1,
        load5,
        load15,
        uptime_secs,
        disks,
        net,
        os_line,
        processes,
        services,
    }
}

fn cpu_pct_from_delta(prev: &PrevCounters, cur_total: f64, cur_idle: f64) -> f64 {
    if prev.cpu_total <= 0.0 || cur_total <= prev.cpu_total {
        // First sample fallback: cumulative ratio (rough).
        if cur_total > 0.0 {
            return ((cur_total - cur_idle) / cur_total * 100.0).clamp(0.0, 100.0);
        }
        return 0.0;
    }
    let d_total = cur_total - prev.cpu_total;
    let d_idle = cur_idle - prev.cpu_idle;
    if d_total <= 0.0 {
        return 0.0;
    }
    (((d_total - d_idle) / d_total) * 100.0).clamp(0.0, 100.0)
}

fn net_bps(prev: &PrevCounters, cur: &HashMap<String, (u64, u64)>, now_ms: i64) -> (f64, f64) {
    if prev.sampled_at_ms <= 0 || now_ms <= prev.sampled_at_ms {
        return (0.0, 0.0);
    }
    let dt = (now_ms - prev.sampled_at_ms) as f64 / 1000.0;
    if dt <= 0.0 {
        return (0.0, 0.0);
    }
    let mut rx = 0.0_f64;
    let mut tx = 0.0_f64;
    for (iface, (crx, ctx)) in cur {
        if let Some((prx, ptx)) = prev.net.get(iface) {
            if *crx >= *prx {
                rx += (*crx - *prx) as f64;
            }
            if *ctx >= *ptx {
                tx += (*ctx - *ptx) as f64;
            }
        }
    }
    (rx / dt, tx / dt)
}

async fn persist_and_build_snap(
    state: &AppState,
    host_id: &str,
    parsed: &ParsedProbe,
    prev: &PrevCounters,
    now: i64,
) -> Result<(Value, PrevCounters), AppError> {
    let cpu_pct = cpu_pct_from_delta(prev, parsed.cpu_total, parsed.cpu_idle);
    let (rx_bps, tx_bps) = net_bps(prev, &parsed.net, now);
    let mem_used = (parsed.mem_total - parsed.mem_avail).max(0);
    let swap_used = (parsed.swap_total - parsed.swap_free).max(0);

    let mut snap = json!({
        "hostId": host_id,
        "sampledAt": now,
        "cpuPct": cpu_pct,
        "memUsed": mem_used,
        "memTotal": parsed.mem_total,
        "swapUsed": swap_used,
        "swapTotal": parsed.swap_total,
        "load1": parsed.load1,
        "load5": parsed.load5,
        "load15": parsed.load15,
        "uptimeSecs": parsed.uptime_secs,
        "disks": parsed.disks,
        "os": parsed.os_line,
        "network": {
            "rxBps": rx_bps,
            "txBps": tx_bps,
        },
    });

    if let Some(ref procs) = parsed.processes {
        snap["processes"] = json!(procs);
    }
    if let Some(ref svcs) = parsed.services {
        snap["services"] = json!(svcs);
    }

    let id = Uuid::now_v7().to_string();
    sqlx::query(
        r#"INSERT INTO host_snapshots
        (id, host_id, sampled_at, cpu_pct, mem_used, mem_total, swap_used, swap_total, load1, load5, load15, uptime_secs, raw_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"#,
    )
    .bind(&id)
    .bind(host_id)
    .bind(now)
    .bind(cpu_pct)
    .bind(mem_used)
    .bind(parsed.mem_total)
    .bind(swap_used)
    .bind(parsed.swap_total)
    .bind(parsed.load1)
    .bind(parsed.load5)
    .bind(parsed.load15)
    .bind(parsed.uptime_secs)
    .bind(snap.to_string())
    .execute(state.vault.pool())
    .await
    .map_err(db)?;

    for (metric, value) in [
        ("cpu", cpu_pct),
        (
            "mem",
            if parsed.mem_total > 0 {
                mem_used as f64 / parsed.mem_total as f64 * 100.0
            } else {
                0.0
            },
        ),
        ("load1", parsed.load1),
    ] {
        let sid = Uuid::now_v7().to_string();
        let _ = sqlx::query(
            "INSERT INTO metric_series (id, host_id, metric, bucket_start, value) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(&sid)
        .bind(host_id)
        .bind(metric)
        .bind(now)
        .bind(value)
        .execute(state.vault.pool())
        .await;
    }
    let _ = sqlx::query("DELETE FROM metric_series WHERE host_id = ? AND bucket_start < ?")
        .bind(host_id)
        .bind(now - 3_600_000)
        .execute(state.vault.pool())
        .await;

    let next_prev = PrevCounters {
        cpu_total: parsed.cpu_total,
        cpu_idle: parsed.cpu_idle,
        net: parsed.net.clone(),
        sampled_at_ms: now,
    };

    Ok((snap, next_prev))
}

async fn sample_once(
    state: &Arc<AppState>,
    host_id: &str,
    include_procs: bool,
    include_services: bool,
    prev: &PrevCounters,
) -> Result<(Value, PrevCounters), AppError> {
    let script = build_probe(include_procs, include_services);
    let raw = state.connections.exec_command(host_id, &script).await?;
    let parsed = parse_probe(&raw);
    let now = chrono::Utc::now().timestamp_millis();
    persist_and_build_snap(state, host_id, &parsed, prev, now).await
}

fn spawn_sampler(
    app: AppHandle,
    state: Arc<AppState>,
    host_id: String,
    interval_ms: u64,
    stop_rx: watch::Receiver<bool>,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        let mut stop_rx = stop_rx;
        let mut prev = PrevCounters::default();
        let mut tick: u64 = 0;
        let interval = clamp_interval(interval_ms);

        // Prime CPU counters with a quick double sample so first emit is accurate.
        {
            let script = "grep 'cpu ' /proc/stat | awk '{print $2+$3+$4+$5+$6+$7+$8,$5}'; sleep 0.15; grep 'cpu ' /proc/stat | awk '{print $2+$3+$4+$5+$6+$7+$8,$5}'";
            if let Ok(raw) = state.connections.exec_command(&host_id, script).await {
                let lines: Vec<&str> = raw.lines().filter(|l| !l.trim().is_empty()).collect();
                if let Some(line) = lines.first() {
                    let p: Vec<&str> = line.split_whitespace().collect();
                    if p.len() >= 2 {
                        prev.cpu_total = p[0].parse().unwrap_or(0.0);
                        prev.cpu_idle = p[1].parse().unwrap_or(0.0);
                        prev.sampled_at_ms = chrono::Utc::now().timestamp_millis() - 150;
                    }
                }
                // Prefer second sample as the "previous" baseline right before the loop.
                if let Some(line) = lines.get(1) {
                    let p: Vec<&str> = line.split_whitespace().collect();
                    if p.len() >= 2 {
                        prev.cpu_total = p[0].parse().unwrap_or(prev.cpu_total);
                        prev.cpu_idle = p[1].parse().unwrap_or(prev.cpu_idle);
                        prev.sampled_at_ms = chrono::Utc::now().timestamp_millis();
                    }
                }
            }
        }

        loop {
            if *stop_rx.borrow() {
                break;
            }

            let include_procs = tick % 2 == 0;
            let include_services = tick % 8 == 0;
            match sample_once(
                &state,
                &host_id,
                include_procs,
                include_services,
                &prev,
            )
            .await
            {
                Ok((snap, next_prev)) => {
                    prev = next_prev;
                    let topic = metrics_snapshot(&host_id);
                    let _ = app.emit(&topic, snap);
                }
                Err(e) => {
                    tracing::warn!(host_id = %host_id, error = %e, "monitoring sample failed");
                }
            }

            tick = tick.wrapping_add(1);

            tokio::select! {
                _ = tokio::time::sleep(std::time::Duration::from_millis(interval)) => {}
                _ = stop_rx.changed() => {
                    if *stop_rx.borrow() {
                        break;
                    }
                }
            }
        }
    })
}

#[tauri::command]
pub async fn monitoring_start(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    host_id: String,
    interval_ms: Option<u64>,
) -> Result<(), AppError> {
    let interval = clamp_interval(interval_ms.unwrap_or(2_000));
    let mut map = SAMPLERS.lock().map_err(|_| AppError::Internal {
        message: "monitoring lock poisoned".into(),
    })?;

    if let Some(entry) = map.get_mut(&host_id) {
        entry.refcount = entry.refcount.saturating_add(1);
        return Ok(());
    }

    let (stop_tx, stop_rx) = watch::channel(false);
    let app_state: Arc<AppState> = (*state).clone();
    let handle = spawn_sampler(app, app_state, host_id.clone(), interval, stop_rx);
    map.insert(
        host_id,
        SamplerEntry {
            refcount: 1,
            stop_tx,
            handle,
        },
    );
    Ok(())
}

#[tauri::command]
pub async fn monitoring_stop(host_id: String) -> Result<(), AppError> {
    let mut map = SAMPLERS.lock().map_err(|_| AppError::Internal {
        message: "monitoring lock poisoned".into(),
    })?;

    let should_remove = if let Some(entry) = map.get_mut(&host_id) {
        entry.refcount = entry.refcount.saturating_sub(1);
        entry.refcount == 0
    } else {
        false
    };

    if should_remove {
        if let Some(entry) = map.remove(&host_id) {
            let _ = entry.stop_tx.send(true);
            entry.handle.abort();
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn monitoring_snapshot(
    state: State<'_, Arc<AppState>>,
    host_id: String,
) -> Result<Value, AppError> {
    let prev = PrevCounters::default();
    let (snap, _) = sample_once(&state, &host_id, true, true, &prev).await?;
    Ok(snap)
}

#[tauri::command]
pub async fn monitoring_series(
    state: State<'_, Arc<AppState>>,
    host_id: String,
    metric: String,
) -> Result<Vec<Value>, AppError> {
    let rows: Vec<(i64, f64)> = sqlx::query_as(
        "SELECT bucket_start, value FROM metric_series WHERE host_id = ? AND metric = ? ORDER BY bucket_start DESC LIMIT 120",
    )
    .bind(&host_id)
    .bind(&metric)
    .fetch_all(state.vault.pool())
    .await
    .map_err(db)?;
    Ok(rows
        .into_iter()
        .rev()
        .map(|(t, v)| json!({ "t": t, "v": v }))
        .collect())
}

#[tauri::command]
pub async fn processes_list(
    state: State<'_, Arc<AppState>>,
    host_id: String,
) -> Result<Vec<Value>, AppError> {
    let out = state
        .connections
        .exec_command(&host_id, "ps aux --sort=-%cpu | head -n 40")
        .await?;
    let mut procs = Vec::new();
    for (i, line) in out.lines().enumerate() {
        if i == 0 {
            continue;
        }
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 11 {
            continue;
        }
        procs.push(json!({
            "user": parts[0],
            "pid": parts[1].parse::<i64>().unwrap_or(0),
            "cpu": parts[2].parse::<f64>().unwrap_or(0.0),
            "mem": parts[3].parse::<f64>().unwrap_or(0.0),
            "command": parts[10..].join(" "),
        }));
    }
    Ok(procs)
}

#[tauri::command]
pub async fn process_kill(
    state: State<'_, Arc<AppState>>,
    host_id: String,
    pid: i64,
) -> Result<(), AppError> {
    state
        .connections
        .exec_command(&host_id, &format!("kill {pid}"))
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn services_list(
    state: State<'_, Arc<AppState>>,
    host_id: String,
) -> Result<Vec<Value>, AppError> {
    let out = state
        .connections
        .exec_command(
            &host_id,
            "systemctl list-units --type=service --no-pager --no-legend 2>/dev/null | head -n 50",
        )
        .await?;
    let mut services = Vec::new();
    for line in out.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 4 {
            services.push(json!({
                "unit": parts[0],
                "load": parts[1],
                "active": parts[2],
                "sub": parts[3],
            }));
        }
    }
    Ok(services)
}

#[tauri::command]
pub async fn service_control(
    state: State<'_, Arc<AppState>>,
    host_id: String,
    unit: String,
    action: String,
) -> Result<(), AppError> {
    let action = match action.as_str() {
        "start" | "stop" | "restart" => action,
        _ => {
            return Err(AppError::Validation {
                field: "action".into(),
                message: "start|stop|restart".into(),
            })
        }
    };
    state
        .connections
        .exec_command(&host_id, &format!("systemctl {action} {unit}"))
        .await?;
    Ok(())
}
