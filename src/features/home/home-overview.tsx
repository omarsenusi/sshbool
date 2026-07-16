import { useQuery } from "@tanstack/react-query"
import {
  Activity,
  Bot,
  Cable,
  Clock3,
  FolderKey,
  HardDrive,
  LayoutDashboard,
  Plus,
  Server,
  Settings,
  TerminalSquare,
} from "lucide-react"
import type { ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { HostTree } from "@/features/connections/components/host-tree"
import {
  flattenHosts,
  hostAccent,
  hostLetter,
} from "@/features/connections/host-appearance"
import { ipc } from "@/lib/ipc/commands"
import { cn } from "@/lib/utils"
import { useConnectionStore } from "@/stores/connection.store"
import {
  type ActivityId,
  useLayoutStore,
} from "@/stores/layout.store"
import { useSessionStore } from "@/stores/session.store"
import { useVaultStore } from "@/stores/vault.store"

function formatWhen(ts: number | null | undefined) {
  if (!ts) return "—"
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(ts))
  } catch {
    return "—"
  }
}

function formatRelative(ts: number | null | undefined) {
  if (!ts) return "—"
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function HomeOverview() {
  const setActivity = useLayoutStore((s) => s.setActivity)
  const setSelectedHostId = useLayoutStore((s) => s.setSelectedHostId)
  const setAddHostOpen = useLayoutStore((s) => s.setAddHostOpen)
  const lastViewed = useLayoutStore((s) => s.lastViewed)
  const addHostOpen = useLayoutStore((s) => s.addHostOpen)
  const byHost = useConnectionStore((s) => s.byHost)
  const panes = useSessionStore((s) => s.panes)
  const vaultStatus = useVaultStore((s) => s.status)

  const tree = useQuery({
    queryKey: ["hosts", "tree"],
    queryFn: () => ipc.hostsListTree(),
  })
  const recent = useQuery({
    queryKey: ["hosts", "recent-home"],
    queryFn: () => ipc.hostsListRecent(8),
  })
  const audit = useQuery({
    queryKey: ["audit", "home"],
    queryFn: () => ipc.auditList(10),
  })
  const appInfo = useQuery({
    queryKey: ["app-info"],
    queryFn: () => ipc.appInfo(),
  })

  const hosts = flattenHosts(tree.data ?? [])
  const connectedHosts = hosts.filter((h) => byHost[h.id]?.status === "connected")
  const openPanes = panes.length

  const lastHost =
    (lastViewed?.hostId
      ? hosts.find((h) => h.id === lastViewed.hostId)
      : null) ??
    (recent.data?.[0]
      ? hosts.find((h) => h.id === recent.data![0]!.id) ?? null
      : null) ??
    hosts[0] ??
    null

  const lastConn = lastHost ? byHost[lastHost.id] : undefined

  function openHost(hostId: string, activity: ActivityId = "terminal") {
    setSelectedHostId(hostId)
    setActivity(activity)
    useLayoutStore.getState().rememberView(hostId, activity)
  }

  if (addHostOpen) {
    return <HostTree />
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="flex w-full flex-col gap-5 p-4 pb-8 lg:p-5">
        {/* Header — full width, left aligned */}
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Overview</h1>
            <p className="text-muted-foreground mt-0.5 text-sm">
              {connectedHosts.length > 0
                ? `${connectedHosts.length} connected · ${openPanes} terminal${openPanes === 1 ? "" : "s"} open`
                : "Pick a host from the rail, or manage them below."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setAddHostOpen(true)
                setActivity("home")
              }}
            >
              <Plus className="size-3.5" />
              Add host
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setActivity("settings")}>
              <Settings className="size-3.5" />
              Settings
            </Button>
          </div>
        </header>

        {/* Stats strip — edge to edge */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-6">
          <StatChip icon={<Server className="size-3.5" />} label="Hosts" value={hosts.length} />
          <StatChip
            icon={<Cable className="size-3.5" />}
            label="Connected"
            value={connectedHosts.length}
            tone={connectedHosts.length > 0 ? "ok" : undefined}
          />
          <StatChip
            icon={<TerminalSquare className="size-3.5" />}
            label="Terminals"
            value={openPanes}
          />
          <StatChip
            icon={<Clock3 className="size-3.5" />}
            label="Recent"
            value={recent.data?.length ?? 0}
          />
          <StatChip
            icon={<FolderKey className="size-3.5" />}
            label="Vault"
            value={vaultStatus?.locked ? "Locked" : "Open"}
            tone={vaultStatus?.locked ? "warn" : "ok"}
          />
          <StatChip
            icon={<Activity className="size-3.5" />}
            label="Version"
            value={appInfo.data?.version ?? "—"}
          />
        </div>

        {/* Main row: last server + side panels */}
        <div className="grid gap-4 xl:grid-cols-12">
          <section className="border-border bg-card/30 xl:col-span-7 rounded-xl border p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                Last server
              </h2>
              {lastHost && (
                <Button size="sm" variant="ghost" onClick={() => openHost(lastHost.id)}>
                  Open tools
                </Button>
              )}
            </div>
            {!lastHost ? (
              <p className="text-muted-foreground text-sm">
                No hosts yet — add one to get started.
              </p>
            ) : (
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <div
                  className="flex size-14 shrink-0 items-center justify-center rounded-xl text-xl font-semibold text-white"
                  style={{ backgroundColor: hostAccent(lastHost) }}
                >
                  {hostLetter(lastHost.label)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-base font-semibold">{lastHost.label}</div>
                  <div className="text-muted-foreground truncate font-mono text-xs">
                    {lastHost.username ? `${lastHost.username}@` : ""}
                    {lastHost.hostname}:{lastHost.port}
                  </div>
                  <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    <StatusPill status={lastConn?.status ?? "idle"} />
                    <span>Last seen {formatRelative(lastHost.lastConnectedAt)}</span>
                    {lastViewed?.hostId === lastHost.id && (
                      <span>
                        Tool: <span className="text-foreground">{lastViewed.activity}</span>
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 sm:max-w-[220px] sm:justify-end">
                  <Button size="sm" onClick={() => openHost(lastHost.id, "terminal")}>
                    <TerminalSquare className="size-3.5" />
                    Terminal
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => openHost(lastHost.id, "sftp")}
                  >
                    <HardDrive className="size-3.5" />
                    SFTP
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => openHost(lastHost.id, "dashboard")}
                  >
                    <LayoutDashboard className="size-3.5" />
                    Dashboard
                  </Button>
                </div>
              </div>
            )}
          </section>

          <div className="flex flex-col gap-4 xl:col-span-5">
            {/* Connected now */}
            <section className="border-border bg-card/30 flex-1 rounded-xl border p-4">
              <h2 className="text-muted-foreground mb-3 text-xs font-semibold tracking-wide uppercase">
                Connected now
              </h2>
              {connectedHosts.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  Nothing connected. Select a host and press Connect.
                </p>
              ) : (
                <ul className="space-y-1">
                  {connectedHosts.map((h) => (
                    <li key={h.id}>
                      <button
                        type="button"
                        className="hover:bg-muted/50 flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm"
                        onClick={() => openHost(h.id)}
                      >
                        <span
                          className="flex size-7 items-center justify-center rounded-md text-[11px] font-semibold text-white"
                          style={{ backgroundColor: hostAccent(h) }}
                        >
                          {hostLetter(h.label)}
                        </span>
                        <span className="min-w-0 flex-1 truncate font-medium">{h.label}</span>
                        <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Quick jumps */}
            <section className="border-border bg-card/30 rounded-xl border p-4">
              <h2 className="text-muted-foreground mb-3 text-xs font-semibold tracking-wide uppercase">
                Quick open
              </h2>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <QuickBtn
                  icon={<Bot className="size-3.5" />}
                  label="AI"
                  onClick={() => setActivity("ai")}
                />
                <QuickBtn
                  icon={<FolderKey className="size-3.5" />}
                  label="Keys"
                  onClick={() => setActivity("keys")}
                />
                <QuickBtn
                  icon={<Activity className="size-3.5" />}
                  label="Audit"
                  onClick={() => setActivity("audit")}
                />
                <QuickBtn
                  icon={<Settings className="size-3.5" />}
                  label="Settings"
                  onClick={() => setActivity("settings")}
                />
                {lastHost && (
                  <>
                    <QuickBtn
                      icon={<HardDrive className="size-3.5" />}
                      label="SFTP"
                      onClick={() => openHost(lastHost.id, "sftp")}
                    />
                    <QuickBtn
                      icon={<LayoutDashboard className="size-3.5" />}
                      label="Metrics"
                      onClick={() => openHost(lastHost.id, "dashboard")}
                    />
                  </>
                )}
              </div>
            </section>
          </div>
        </div>

        {/* Open terminals */}
        {panes.length > 0 && (
          <section className="border-border bg-card/30 rounded-xl border p-4">
            <h2 className="text-muted-foreground mb-3 text-xs font-semibold tracking-wide uppercase">
              Open terminals
            </h2>
            <div className="flex flex-wrap gap-2">
              {panes.map((p) => {
                const host = hosts.find((h) => h.id === p.hostId)
                return (
                  <button
                    key={p.paneId}
                    type="button"
                    className="border-border hover:bg-muted/50 flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-sm"
                    onClick={() => {
                      setSelectedHostId(p.hostId)
                      setActivity("terminal")
                      useSessionStore.getState().setActive(p.paneId)
                    }}
                  >
                    <TerminalSquare className="text-muted-foreground size-3.5" />
                    <span className="max-w-[160px] truncate font-medium">
                      {p.title || host?.label || "Terminal"}
                    </span>
                    {p.poppedOut && (
                      <span className="text-muted-foreground text-[10px]">pop-out</span>
                    )}
                  </button>
                )
              })}
            </div>
          </section>
        )}

        {/* Bottom: manage hosts + activity */}
        <div className="grid gap-4 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <HostTree embedded onSelectHost={openHost} />
          </div>

          <div className="flex flex-col gap-4 lg:col-span-5">
            <section className="border-border bg-card/30 rounded-xl border p-4">
              <h2 className="text-muted-foreground mb-3 flex items-center gap-2 text-xs font-semibold tracking-wide uppercase">
                <Clock3 className="size-3.5" />
                Recent hosts
              </h2>
              <ul className="space-y-0.5">
                {(recent.data ?? []).length === 0 && (
                  <li className="text-muted-foreground text-xs">No recent connections.</li>
                )}
                {(recent.data ?? []).map((h) => (
                  <li key={h.id}>
                    <button
                      type="button"
                      className="hover:bg-muted/50 flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm"
                      onClick={() => openHost(h.id)}
                    >
                      <span
                        className="flex size-6 items-center justify-center rounded text-[10px] font-semibold text-white"
                        style={{ backgroundColor: hostAccent(h) }}
                      >
                        {hostLetter(h.label)}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-medium">{h.label}</span>
                      <span className="text-muted-foreground shrink-0 text-[11px]">
                        {formatRelative(h.lastConnectedAt)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>

            <section className="border-border bg-card/30 flex-1 rounded-xl border p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="text-muted-foreground flex items-center gap-2 text-xs font-semibold tracking-wide uppercase">
                  <Activity className="size-3.5" />
                  Activity
                </h2>
                <Button size="sm" variant="ghost" onClick={() => setActivity("audit")}>
                  Full log
                </Button>
              </div>
              <ul className="space-y-1.5">
                {(audit.data ?? []).length === 0 && (
                  <li className="text-muted-foreground text-xs">No events yet.</li>
                )}
                {(audit.data ?? []).slice(0, 8).map((row, i) => {
                  const r = row as Record<string, unknown>
                  const action = String(r.action ?? r.kind ?? r.event ?? "event")
                  const at =
                    typeof r.at === "number"
                      ? r.at
                      : typeof r.ts === "number"
                        ? r.ts
                        : null
                  return (
                    <li
                      key={i}
                      className="text-muted-foreground flex items-baseline justify-between gap-3 text-xs"
                    >
                      <span className="text-foreground min-w-0 truncate font-medium">
                        {action}
                      </span>
                      <span className="shrink-0 tabular-nums">{formatWhen(at)}</span>
                    </li>
                  )
                })}
              </ul>
            </section>
          </div>
        </div>
      </div>
    </div>
  )
}

function StatChip({
  icon,
  label,
  value,
  tone,
}: {
  icon: ReactNode
  label: string
  value: string | number
  tone?: "ok" | "warn"
}) {
  return (
    <div className="border-border bg-card/30 flex items-center gap-3 rounded-xl border px-3 py-2.5">
      <div
        className={cn(
          "text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-lg",
          tone === "ok" && "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
          tone === "warn" && "bg-amber-500/10 text-amber-600 dark:text-amber-400",
          !tone && "bg-muted/50",
        )}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-muted-foreground truncate text-[11px]">{label}</div>
        <div className="truncate text-sm font-semibold tabular-nums">{value}</div>
      </div>
    </div>
  )
}

function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 font-medium",
        status === "connected" && "text-emerald-600 dark:text-emerald-400",
        status === "connecting" && "text-sky-600 dark:text-sky-400",
        status === "error" && "text-destructive",
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          status === "connected" && "bg-emerald-500",
          status === "connecting" && "bg-sky-500",
          status === "error" && "bg-destructive",
          status === "idle" && "bg-muted-foreground/40",
        )}
      />
      {status}
    </span>
  )
}

function QuickBtn({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="border-border hover:bg-muted/50 flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-xs font-medium"
    >
      <span className="text-muted-foreground">{icon}</span>
      {label}
    </button>
  )
}
