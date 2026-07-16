import { useQuery } from "@tanstack/react-query"
import {
  Bot,
  Cloud,
  FolderKey,
  Home,
  Plus,
  Settings,
  Shield,
} from "lucide-react"

import { Button } from "@/components/ui/button"
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

const bottomGlobals: { id: ActivityId; icon: typeof Home; label: string }[] = [
  { id: "ai", icon: Bot, label: "AI" },
  { id: "keys", icon: FolderKey, label: "Keys" },
  // Plugins hidden for now — bring back when ready.
  { id: "audit", icon: Shield, label: "Audit" },
  { id: "sync", icon: Cloud, label: "Sync" },
  { id: "settings", icon: Settings, label: "Settings" },
]

export function HostRail() {
  const activity = useLayoutStore((s) => s.activity)
  const setActivity = useLayoutStore((s) => s.setActivity)
  const selectedHostId = useLayoutStore((s) => s.selectedHostId)
  const setSelectedHostId = useLayoutStore((s) => s.setSelectedHostId)
  const setAddHostOpen = useLayoutStore((s) => s.setAddHostOpen)
  const rememberView = useLayoutStore((s) => s.rememberView)
  const clearError = useConnectionStore((s) => s.clearError)
  const byHost = useConnectionStore((s) => s.byHost)

  const tree = useQuery({
    queryKey: ["hosts", "tree"],
    queryFn: () => ipc.hostsListTree(),
  })

  const hosts = flattenHosts(tree.data ?? [])
  const homeActive = activity === "home" || activity === "connections"

  return (
    <nav
      className="bg-sidebar border-border flex w-[var(--hostrail-w)] shrink-0 flex-col items-center overflow-hidden border-r"
      aria-label="Hosts"
    >
      <div
        className="flex h-[var(--titlebar-h)] w-full shrink-0 items-center justify-center"
        title="SSHBool"
        data-tauri-drag-region
      >
        <img
          src="/app-icon-32.png"
          alt=""
          width={28}
          height={28}
          className="size-7 rounded-md object-cover"
          draggable={false}
        />
      </div>

      <div className="flex min-h-0 w-full flex-1 flex-col items-center gap-1.5 overflow-y-auto px-1.5 py-2">
        <button
          type="button"
          aria-label="Overview"
          title="Overview"
          aria-current={homeActive ? "page" : undefined}
          className={cn(
            "text-muted-foreground relative flex size-9 shrink-0 items-center justify-center rounded-md transition-transform",
            homeActive
              ? "bg-sidebar-accent text-sidebar-accent-foreground scale-105 shadow-sm"
              : "hover:bg-sidebar-accent/60 hover:scale-105",
          )}
          onClick={() => {
            setSelectedHostId(null)
            setAddHostOpen(false)
            setActivity("home")
          }}
        >
          <Home className="size-4" />
        </button>

        {hosts.map((host) => {
          const status = byHost[host.id]?.status ?? "idle"
          return (
            <HostTile
              key={host.id}
              label={host.label}
              accent={hostAccent(host)}
              selected={selectedHostId === host.id}
              status={status}
              title={
                status === "error"
                  ? `${host.label} — ${byHost[host.id]?.error ?? "Connection failed"}`
                  : status === "connecting"
                    ? `${host.label} — Connecting…`
                    : status === "connected"
                      ? `${host.label} — Connected`
                      : host.label
              }
              onClick={() => {
                setSelectedHostId(host.id)
                if (status === "error") clearError(host.id)
                const current = useLayoutStore.getState().activity
                const next = HOST_SCOPED_ACTIVITIES.includes(current)
                  ? current
                  : "terminal"
                setActivity(next)
                rememberView(host.id, next)
              }}
            />
          )
        })}

        <Button
          variant="ghost"
          size="icon"
          aria-label="Add host"
          title="Add host"
          className="text-muted-foreground size-9 shrink-0 rounded-md border border-dashed"
          onClick={() => {
            setSelectedHostId(null)
            setAddHostOpen(true)
            setActivity("home")
          }}
        >
          <Plus className="size-4" />
        </Button>
      </div>

      <div className="border-border flex w-full flex-col items-center gap-0.5 border-t px-1.5 py-2">
        {bottomGlobals.map(({ id, icon: Icon, label }) => (
          <Button
            key={id}
            variant="ghost"
            size="icon"
            aria-label={label}
            title={label}
            aria-current={activity === id ? "page" : undefined}
            className={cn(
              "text-muted-foreground size-8",
              activity === id && "bg-sidebar-accent text-sidebar-accent-foreground",
            )}
            onClick={() => {
              setSelectedHostId(null)
              setActivity(id)
            }}
          >
            <Icon className="size-4" />
          </Button>
        ))}
      </div>
    </nav>
  )
}
