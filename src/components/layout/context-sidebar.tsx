import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Activity,
  Database,
  FileCode2,
  HardDrive,
  Plug,
  PlugZap,
  TerminalSquare,
  Wrench,
} from "lucide-react"
import { useMemo } from "react"

import { Button } from "@/components/ui/button"
import {
  connectHost,
  disconnectHost,
} from "@/features/connections/connect-host"
import { HostTile } from "@/features/connections/components/host-tile"
import {
  flattenHosts,
  hostAccent,
} from "@/features/connections/host-appearance"
import { ipc } from "@/lib/ipc/commands"
import { cn } from "@/lib/utils"
import { useConnectionStore } from "@/stores/connection.store"
import {
  type ActivityId,
  HOST_SCOPED_ACTIVITIES,
  useLayoutStore,
} from "@/stores/layout.store"

const tools: { id: ActivityId; icon: typeof TerminalSquare; label: string }[] = [
  { id: "terminal", icon: TerminalSquare, label: "Terminal" },
  { id: "sftp", icon: HardDrive, label: "SFTP" },
  { id: "editor", icon: FileCode2, label: "Editor" },
  { id: "dashboard", icon: Activity, label: "Dashboard" },
  // Docker / Kubernetes hidden for now — bring back when ready.
  { id: "databases", icon: Database, label: "Databases" },
  { id: "devtools", icon: Wrench, label: "Dev Tools" },
]

export function ContextSidebar() {
  const activity = useLayoutStore((s) => s.activity)
  const setActivity = useLayoutStore((s) => s.setActivity)
  const selectedHostId = useLayoutStore((s) => s.selectedHostId)
  const byHost = useConnectionStore((s) => s.byHost)
  const qc = useQueryClient()
  const visible = !!selectedHostId

  const tree = useQuery({
    queryKey: ["hosts", "tree"],
    queryFn: () => ipc.hostsListTree(),
  })

  const host = useMemo(() => {
    if (!selectedHostId) return null
    return flattenHosts(tree.data ?? []).find((h) => h.id === selectedHostId) ?? null
  }, [tree.data, selectedHostId])

  const conn = host ? (byHost[host.id] ?? { status: "idle" as const }) : null
  const live = conn?.status === "connected"
  const connecting = conn?.status === "connecting"

  const connect = useMutation({
    mutationFn: async (hostId: string) => {
      await connectHost(hostId, { label: host?.label })
    },
    meta: { suppressToast: true },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["hosts"] })
      await qc.invalidateQueries({ queryKey: ["sftp"] })
    },
  })

  const disconnect = useMutation({
    mutationFn: async (hostId: string) => {
      await disconnectHost(hostId)
    },
    meta: { suppressToast: true },
    onSuccess: async (_d, hostId) => {
      await qc.cancelQueries({ queryKey: ["sftp", hostId] })
      await qc.removeQueries({ queryKey: ["sftp", hostId] })
      await qc.invalidateQueries({ queryKey: ["docker"] })
      await qc.invalidateQueries({ queryKey: ["k8s"] })
      await qc.invalidateQueries({ queryKey: ["db"] })
    },
  })

  return (
    <aside
      className={cn(
        "bg-sidebar border-border flex shrink-0 flex-col overflow-hidden border-r",
        "transition-[width,opacity,transform] duration-200 ease-out",
        visible
          ? "w-[var(--sidebar-w)] translate-x-0 opacity-100"
          : "pointer-events-none w-0 translate-x-[-6px] border-r-0 opacity-0",
      )}
      aria-label="Host tools"
      aria-hidden={!visible}
    >
      <div className="flex h-full w-[var(--sidebar-w)] flex-col">
        {host && conn ? (
          <>
            <div className="border-border space-y-3 border-b p-3">
              <div className="flex items-start gap-2.5">
                <HostTile
                  label={host.label}
                  accent={hostAccent(host)}
                  status={conn.status}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{host.label}</div>
                  <div className="text-muted-foreground truncate font-mono text-[11px]">
                    {host.username ? `${host.username}@` : ""}
                    {host.hostname}:{host.port}
                  </div>
                  <div
                    className={cn(
                      "mt-1 text-[11px] font-medium",
                      live && "text-emerald-600 dark:text-emerald-400",
                      connecting && "text-sky-600 dark:text-sky-400",
                      conn.status === "error" && "text-destructive",
                      conn.status === "idle" && "text-muted-foreground",
                    )}
                  >
                    {conn.status === "connected"
                      ? "Connected"
                      : conn.status === "connecting"
                        ? "Connecting…"
                      : conn.status === "error"
                        ? "Connection failed"
                        : "Not connected"}
                  </div>
                </div>
              </div>
              {live ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full"
                  disabled={disconnect.isPending}
                  onClick={() => disconnect.mutate(host.id)}
                >
                  <Plug className="size-3.5" />
                  Disconnect
                </Button>
              ) : (
                <Button
                  size="sm"
                  className="w-full"
                  disabled={connecting || connect.isPending}
                  onClick={() => connect.mutate(host.id)}
                >
                  <PlugZap className="size-3.5" />
                  {connecting ? "Connecting…" : "Connect"}
                </Button>
              )}
              {conn.status === "error" && conn.error && (
                <p className="text-destructive text-[11px] leading-snug">{conn.error}</p>
              )}
            </div>

            <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
              {tools.map(({ id, icon: Icon, label }) => {
                const active =
                  HOST_SCOPED_ACTIVITIES.includes(activity) && activity === id
                return (
                  <button
                    key={id}
                    type="button"
                    className={cn(
                      "hover:bg-sidebar-accent flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm",
                      active &&
                        "bg-sidebar-accent text-sidebar-accent-foreground font-medium",
                      !live && "opacity-70",
                    )}
                    onClick={() => setActivity(id)}
                  >
                    <Icon className="text-muted-foreground size-4 shrink-0" />
                    <span className="min-w-0 flex-1">{label}</span>
                    {live && (
                      <span
                        className="size-1.5 shrink-0 rounded-full bg-emerald-500"
                        title="Connected"
                        aria-hidden
                      />
                    )}
                  </button>
                )
              })}
            </nav>
          </>
        ) : null}
      </div>
    </aside>
  )
}
