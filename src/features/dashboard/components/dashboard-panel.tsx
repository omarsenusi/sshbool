import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import { useMutation } from "@tanstack/react-query"
import {
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  Cpu,
  HardDrive,
  Loader2,
  MemoryStick,
  RefreshCw,
  Server,
  Timer,
} from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { formatBytes } from "@/features/sftp/lib/format-bytes"
import { ipc } from "@/lib/ipc/commands"
import type {
  MonitoringProcessDto,
  MonitoringServiceDto,
  MonitoringSnapshot,
} from "@/lib/ipc/types"
import { cn } from "@/lib/utils"

const UI_MIN_MS = 250 // ≤ 4 Hz

type ConfirmState =
  | { kind: "kill"; pid: number; command: string }
  | { kind: "restart"; unit: string }
  | null

export function DashboardPanel({ hostId }: { hostId: string }) {
  const [snap, setSnap] = useState<MonitoringSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [live, setLive] = useState(false)
  const [confirm, setConfirm] = useState<ConfirmState>(null)
  const [refreshing, setRefreshing] = useState(false)

  const pending = useRef<MonitoringSnapshot | null>(null)
  const lastFlush = useRef(0)
  const rafId = useRef<number | null>(null)
  const timeoutId = useRef<ReturnType<typeof setTimeout> | null>(null)
  const startedRef = useRef(false)

  const clearSchedule = useCallback(() => {
    if (rafId.current != null) {
      cancelAnimationFrame(rafId.current)
      rafId.current = null
    }
    if (timeoutId.current != null) {
      clearTimeout(timeoutId.current)
      timeoutId.current = null
    }
  }, [])

  const flush = useCallback(() => {
    rafId.current = null
    const next = pending.current
    if (!next) return
    const now = performance.now()
    const elapsed = now - lastFlush.current
    if (elapsed < UI_MIN_MS) {
      timeoutId.current = setTimeout(() => {
        timeoutId.current = null
        lastFlush.current = performance.now()
        if (pending.current) setSnap(pending.current)
      }, UI_MIN_MS - elapsed)
      return
    }
    lastFlush.current = now
    setSnap(next)
  }, [])

  const applySnap = useCallback(
    (payload: MonitoringSnapshot) => {
      const base = pending.current
      pending.current = mergeSnap(base, payload)
      if (rafId.current == null && timeoutId.current == null) {
        rafId.current = requestAnimationFrame(flush)
      }
    },
    [flush],
  )

  useEffect(() => {
    let cancelled = false
    let unlisten: UnlistenFn | undefined

    async function start() {
      if (cancelled || document.visibilityState === "hidden") return
      if (startedRef.current) return
      try {
        await ipc.monitoringStart(hostId, 2000)
        if (cancelled) {
          await ipc.monitoringStop(hostId)
          return
        }
        startedRef.current = true
        setLive(true)
        setError(null)
        const one = await ipc.monitoringSnapshot(hostId)
        if (!cancelled) applySnap(one)
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e))
          setLive(false)
          startedRef.current = false
        }
      }
    }

    async function stop() {
      if (!startedRef.current) return
      startedRef.current = false
      setLive(false)
      try {
        await ipc.monitoringStop(hostId)
      } catch {
        /* ignore */
      }
    }

    void listen<MonitoringSnapshot>(`metrics://snapshot/${hostId}`, (event) => {
      applySnap(event.payload)
    }).then((fn) => {
      if (cancelled) fn()
      else unlisten = fn
    })

    void start()

    function onVisibility() {
      if (document.visibilityState === "hidden") void stop()
      else void start()
    }
    document.addEventListener("visibilitychange", onVisibility)

    return () => {
      cancelled = true
      document.removeEventListener("visibilitychange", onVisibility)
      unlisten?.()
      clearSchedule()
      void stop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restart only on host change
  }, [hostId])

  const kill = useMutation({
    mutationFn: (pid: number) => ipc.processKill(hostId, pid),
    onSuccess: async () => {
      setConfirm(null)
      const procs = (await ipc.processesList(hostId)) as MonitoringProcessDto[]
      setSnap((s) => (s ? { ...s, processes: procs } : s))
    },
  })
  const ctrl = useMutation({
    mutationFn: ({ unit, action }: { unit: string; action: string }) =>
      ipc.serviceControl(hostId, unit, action),
    onSuccess: async () => {
      setConfirm(null)
      const services = (await ipc.servicesList(hostId)) as MonitoringServiceDto[]
      setSnap((s) => (s ? { ...s, services } : s))
    },
  })

  async function onRefresh() {
    setRefreshing(true)
    try {
      const one = await ipc.monitoringSnapshot(hostId)
      applySnap(one)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRefreshing(false)
    }
  }

  const d = snap
  const procs = d?.processes ?? []
  const services = d?.services ?? []
  const memPct =
    d && d.memTotal > 0 ? (Number(d.memUsed) / Number(d.memTotal)) * 100 : 0
  const cpuPct = Number(d?.cpuPct ?? 0)

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-4 text-sm">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold tracking-tight">
              Server dashboard
            </h2>
            <LiveBadge live={live} />
          </div>
          {d?.os && (
            <p className="text-muted-foreground mt-0.5 truncate font-mono text-[11px]">
              {d.os}
            </p>
          )}
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={refreshing}
          onClick={() => void onRefresh()}
        >
          <RefreshCw
            className={cn("mr-1.5 size-3.5", refreshing && "animate-spin")}
          />
          Refresh
        </Button>
      </header>

      {error && (
        <p className="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border px-3 py-2 text-xs">
          {error}
        </p>
      )}

      {d && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
          <MetricCard
            icon={Cpu}
            label="CPU"
            value={`${cpuPct.toFixed(1)}%`}
            pct={cpuPct}
            tone={levelTone(cpuPct)}
          />
          <MetricCard
            icon={MemoryStick}
            label="Memory"
            value={`${formatBytes(Number(d.memUsed))} / ${formatBytes(Number(d.memTotal))}`}
            pct={memPct}
            tone={levelTone(memPct)}
          />
          <MetricCard
            icon={Activity}
            label="Load"
            value={`${fmtNum(d.load1)} / ${fmtNum(d.load5)} / ${fmtNum(d.load15)}`}
            hint="1 / 5 / 15 min"
          />
          <MetricCard
            icon={Timer}
            label="Uptime"
            value={formatUptime(Number(d.uptimeSecs))}
          />
          <MetricCard
            icon={ArrowDownToLine}
            label="Net ↓"
            value={`${formatBytes(d.network?.rxBps ?? 0)}/s`}
            accent="sky"
          />
          <MetricCard
            icon={ArrowUpFromLine}
            label="Net ↑"
            value={`${formatBytes(d.network?.txBps ?? 0)}/s`}
            accent="violet"
          />
        </div>
      )}

      {Array.isArray(d?.disks) && d.disks.length > 0 && (
        <section className="border-border bg-card/40 rounded-xl border p-3">
          <div className="mb-3 flex items-center gap-2">
            <HardDrive className="text-muted-foreground size-4" />
            <h3 className="text-sm font-semibold">Disks</h3>
          </div>
          <ul className="space-y-3">
            {d.disks.map((disk) => {
              const pct =
                disk.sizeBytes > 0
                  ? (disk.usedBytes / disk.sizeBytes) * 100
                  : 0
              const tone = levelTone(pct)
              return (
                <li key={disk.mount}>
                  <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
                    <span className="font-mono font-medium">{disk.mount}</span>
                    <span className="text-muted-foreground tabular-nums">
                      {formatBytes(disk.usedBytes)} / {formatBytes(disk.sizeBytes)}{" "}
                      <span className={cn("font-medium", toneText(tone))}>
                        ({pct.toFixed(0)}%)
                      </span>
                    </span>
                  </div>
                  <ProgressBar pct={pct} tone={tone} />
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-2">
        <section className="border-border bg-card/40 flex min-h-0 flex-col rounded-xl border">
          <div className="border-border flex items-center justify-between border-b px-3 py-2">
            <h3 className="text-sm font-semibold">Top processes</h3>
            <span className="text-muted-foreground text-[11px]">
              {procs.length} shown
            </span>
          </div>
          <div className="max-h-64 overflow-auto lg:max-h-none lg:flex-1">
            <div className="text-muted-foreground sticky top-0 grid grid-cols-[56px_56px_minmax(0,1fr)_auto] gap-2 border-b border-border/60 bg-background/90 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide backdrop-blur">
              <span>PID</span>
              <span>CPU</span>
              <span>Command</span>
              <span />
            </div>
            {procs.slice(0, 25).map((p) => {
              const cpu = Number(p.cpu)
              return (
                <div
                  key={String(p.pid)}
                  className="hover:bg-muted/40 grid grid-cols-[56px_56px_minmax(0,1fr)_auto] items-center gap-2 border-b border-border/30 px-3 py-1.5 font-mono text-xs"
                >
                  <span className="text-muted-foreground tabular-nums">
                    {p.pid}
                  </span>
                  <span
                    className={cn(
                      "tabular-nums font-medium",
                      cpu >= 50
                        ? "text-destructive"
                        : cpu >= 20
                          ? "text-amber-500"
                          : "text-foreground",
                    )}
                  >
                    {cpu.toFixed(1)}%
                  </span>
                  <span className="min-w-0 truncate" title={p.command}>
                    {p.command}
                  </span>
                  <Button
                    size="xs"
                    variant="destructive"
                    onClick={() =>
                      setConfirm({
                        kind: "kill",
                        pid: Number(p.pid),
                        command: String(p.command),
                      })
                    }
                  >
                    Kill
                  </Button>
                </div>
              )
            })}
            {procs.length === 0 && (
              <p className="text-muted-foreground px-3 py-6 text-center text-xs">
                Waiting for process sample…
              </p>
            )}
          </div>
        </section>

        <section className="border-border bg-card/40 flex min-h-0 flex-col rounded-xl border">
          <div className="border-border flex items-center justify-between border-b px-3 py-2">
            <div className="flex items-center gap-2">
              <Server className="text-muted-foreground size-4" />
              <h3 className="text-sm font-semibold">Services</h3>
            </div>
            <span className="text-muted-foreground text-[11px]">
              {services.length} shown
            </span>
          </div>
          <div className="max-h-64 overflow-auto lg:max-h-none lg:flex-1">
            {services.slice(0, 25).map((s) => (
              <div
                key={String(s.unit)}
                className="hover:bg-muted/40 flex items-center gap-2 border-b border-border/30 px-3 py-1.5 text-xs"
              >
                <span className="min-w-0 flex-1 truncate font-mono" title={s.unit}>
                  {s.unit}
                </span>
                <ServiceBadge active={String(s.active)} sub={String(s.sub)} />
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() =>
                    setConfirm({ kind: "restart", unit: String(s.unit) })
                  }
                >
                  Restart
                </Button>
              </div>
            ))}
            {services.length === 0 && (
              <p className="text-muted-foreground px-3 py-6 text-center text-xs">
                Waiting for services sample…
              </p>
            )}
          </div>
        </section>
      </div>

      <ConfirmActionDialog
        state={confirm}
        busy={kill.isPending || ctrl.isPending}
        onClose={() => {
          if (kill.isPending || ctrl.isPending) return
          setConfirm(null)
        }}
        onConfirm={() => {
          if (!confirm) return
          if (confirm.kind === "kill") kill.mutate(confirm.pid)
          else ctrl.mutate({ unit: confirm.unit, action: "restart" })
        }}
      />
    </div>
  )
}

function mergeSnap(
  prev: MonitoringSnapshot | null,
  next: MonitoringSnapshot,
): MonitoringSnapshot {
  return {
    ...next,
    processes: next.processes ?? prev?.processes,
    services: next.services ?? prev?.services,
  }
}

type Tone = "ok" | "warn" | "crit" | "neutral"

function levelTone(pct: number): Tone {
  if (pct >= 90) return "crit"
  if (pct >= 70) return "warn"
  return "ok"
}

function toneText(tone: Tone) {
  switch (tone) {
    case "crit":
      return "text-destructive"
    case "warn":
      return "text-amber-500"
    case "ok":
      return "text-emerald-500"
    default:
      return "text-muted-foreground"
  }
}

function toneBar(tone: Tone) {
  switch (tone) {
    case "crit":
      return "bg-destructive"
    case "warn":
      return "bg-amber-500"
    case "ok":
      return "bg-emerald-500"
    default:
      return "bg-primary"
  }
}

function LiveBadge({ live }: { live: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        live
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-500"
          : "border-border bg-muted text-muted-foreground",
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          live ? "bg-emerald-500 animate-pulse" : "bg-muted-foreground",
        )}
      />
      {live ? "Live" : "Paused"}
    </span>
  )
}

function MetricCard({
  icon: Icon,
  label,
  value,
  pct,
  tone = "neutral",
  accent,
  hint,
}: {
  icon: typeof Cpu
  label: string
  value: string
  pct?: number
  tone?: Tone
  accent?: "sky" | "violet"
  hint?: string
}) {
  const accentIcon =
    accent === "sky"
      ? "text-sky-500"
      : accent === "violet"
        ? "text-violet-500"
        : toneText(tone === "neutral" ? "ok" : tone)

  return (
    <div className="border-border bg-card/50 rounded-xl border p-3 shadow-sm">
      <div className="text-muted-foreground mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide">
        <Icon className={cn("size-3.5", accentIcon)} />
        {label}
      </div>
      <div className="font-mono text-base font-semibold tracking-tight tabular-nums">
        {value}
      </div>
      {hint && (
        <div className="text-muted-foreground mt-0.5 text-[10px]">{hint}</div>
      )}
      {pct != null && (
        <div className="mt-2">
          <ProgressBar pct={pct} tone={tone} />
        </div>
      )}
    </div>
  )
}

function ProgressBar({ pct, tone }: { pct: number; tone: Tone }) {
  const w = Math.min(100, Math.max(0, pct))
  return (
    <div className="bg-muted h-1.5 overflow-hidden rounded-full">
      <div
        className={cn("h-full rounded-full transition-[width] duration-300", toneBar(tone))}
        style={{ width: `${w}%` }}
      />
    </div>
  )
}

function ServiceBadge({ active, sub }: { active: string; sub: string }) {
  const a = active.toLowerCase()
  const ok = a === "active" || a === "running"
  const bad = a === "failed" || a === "inactive" || a === "dead"
  return (
    <span
      className={cn(
        "shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        ok && "border-emerald-500/35 bg-emerald-500/10 text-emerald-500",
        bad && "border-destructive/35 bg-destructive/10 text-destructive",
        !ok &&
          !bad &&
          "border-border bg-muted text-muted-foreground",
      )}
      title={sub}
    >
      {active}
    </span>
  )
}

function ConfirmActionDialog({
  state,
  busy,
  onClose,
  onConfirm,
}: {
  state: ConfirmState
  busy: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  if (!state) return null

  const isKill = state.kind === "kill"
  const title = isKill ? "Kill process?" : "Restart service?"
  const body = isKill
    ? `Are you sure you want to kill PID ${state.pid}?`
    : `Are you sure you want to restart ${state.unit}?`
  const detail = isKill ? state.command : undefined

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        className="border-border bg-background w-full max-w-md rounded-xl border p-4 shadow-lg"
      >
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-muted-foreground mt-2 text-xs">{body}</p>
        {detail && (
          <p className="bg-muted mt-3 max-h-20 overflow-auto rounded-md px-2 py-1.5 font-mono text-[11px] break-all">
            {detail}
          </p>
        )}
        <p className="text-muted-foreground mt-2 text-[11px]">
          This cannot be undone from the dashboard.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button size="sm" variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant={isKill ? "destructive" : "default"}
            disabled={busy}
            onClick={onConfirm}
          >
            {busy && <Loader2 className="mr-1 size-3.5 animate-spin" />}
            {isKill ? "Kill process" : "Restart service"}
          </Button>
        </div>
      </div>
    </div>
  )
}

function fmtNum(n: unknown) {
  const v = Number(n)
  if (Number.isNaN(v)) return "—"
  return v.toFixed(2)
}

function formatUptime(secs: number) {
  if (!secs || secs < 0) return "—"
  const d = Math.floor(secs / 86400)
  const h = Math.floor((secs % 86400) / 3600)
  const m = Math.floor((secs % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}
