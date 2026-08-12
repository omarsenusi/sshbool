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
import { HostRow } from "@/features/connections/components/host-row"
import { HostTile } from "@/features/connections/components/host-tile"
import {
  flattenHosts,
  hostAccent,
} from "@/features/connections/host-appearance"
import {
  saveHostRailPrefs,
  useHostRailPrefs,
} from "@/hooks/use-host-rail-prefs"
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
  const railMode = useLayoutStore((s) => s.hostRailMode)
  const railWidth = useLayoutStore((s) => s.hostRailWidth[s.hostRailMode])
  const setHostRailWidth = useLayoutStore((s) => s.setHostRailWidth)
  const clearError = useConnectionStore((s) => s.clearError)
  const byHost = useConnectionStore((s) => s.byHost)

  useHostRailPrefs()
  const labelMode = railMode === "label"

  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = railWidth
    const onMouseMove = (moveEvent: MouseEvent) => {
      setHostRailWidth(railMode, startWidth + (moveEvent.clientX - startX))
    }
    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove)
      window.removeEventListener("mouseup", onMouseUp)
      saveHostRailPrefs()
    }
    window.addEventListener("mousemove", onMouseMove)
    window.addEventListener("mouseup", onMouseUp)
  }

  // Keyboard resize for parity with the mouse handle.
  const handleResizeKey = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 24 : 8
    const delta =
      e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0
    if (!delta) return
    e.preventDefault()
    setHostRailWidth(railMode, railWidth + delta)
    saveHostRailPrefs()
  }

  const tree = useQuery({
    queryKey: ["hosts", "tree"],
    queryFn: () => ipc.hostsListTree(),
  })

  const urlWsId = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("wsId") : null
  const activeWorkspaceIdQuery = useQuery<string>({
    queryKey: ["settings", "activeWorkspaceId", urlWsId],
    queryFn: async () => {
      if (urlWsId) return urlWsId
      return ((await ipc.settingsGet("activeWorkspaceId")) as string) ?? "default"
    },
  })
  const hostWorkspacesQuery = useQuery<Record<string, string>>({
    queryKey: ["settings", "hostWorkspaces"],
    queryFn: async () => (await ipc.settingsGet("hostWorkspaces")) as Record<string, string> ?? {},
  })
  const activeWsId = activeWorkspaceIdQuery.data ?? urlWsId ?? "default"
  const hostWorkspaces = hostWorkspacesQuery.data ?? {}
  const allHosts = flattenHosts(tree.data ?? [])
  const hosts = allHosts.filter((h) => {
    const wsId = hostWorkspaces[h.id] ?? "default"
    return activeWsId === "default" ? wsId === "default" : wsId === activeWsId
  })
  const homeActive = activity === "home" || activity === "connections"

  return (
    <nav
      className={cn(
        "bg-sidebar border-border relative flex shrink-0 flex-col overflow-hidden border-r",
        labelMode ? "items-stretch" : "items-center",
      )}
      style={{ width: `${railWidth}px` }}
      aria-label="Hosts"
    >
      <div
        className={cn(
          "flex h-[var(--titlebar-h)] w-full shrink-0 items-center gap-2",
          labelMode ? "justify-start px-2.5" : "justify-center",
        )}
        title="SSHBool"
        data-tauri-drag-region
      >
        <img
          src="/app-icon-32.png"
          alt=""
          width={28}
          height={28}
          className="size-7 shrink-0 rounded-md object-cover"
          draggable={false}
        />
        {labelMode && (
          <span className="truncate text-sm font-semibold">SSHBool</span>
        )}
      </div>

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize host rail"
        tabIndex={0}
        className="hover:bg-primary/50 active:bg-primary focus-visible:bg-primary absolute top-0 right-0 bottom-0 z-30 w-1.5 cursor-col-resize transition-colors outline-none"
        onMouseDown={handleResizeStart}
        onKeyDown={handleResizeKey}
        title="Drag to resize host rail"
      />

      <div
        className={cn(
          "flex min-h-0 w-full flex-1 flex-col gap-1.5 overflow-y-auto px-1.5 py-2",
          labelMode ? "items-stretch" : "items-center",
        )}
      >
        <button
          type="button"
          aria-label="Overview"
          title="Overview"
          aria-current={homeActive ? "page" : undefined}
          className={cn(
            "text-muted-foreground relative flex shrink-0 items-center rounded-md transition-all",
            labelMode
              ? "w-full gap-2 px-2 py-1.5"
              : "size-8 justify-center",
            homeActive
              ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-sm"
              : "hover:bg-sidebar-accent/60",
          )}
          onClick={() => {
            setSelectedHostId(null)
            setAddHostOpen(false)
            setActivity("home")
          }}
        >
          {homeActive && (
            <span
              className={cn(
                "bg-primary absolute top-1/2 h-7 w-1 -translate-y-1/2 rounded-r-full shadow-sm",
                labelMode ? "-left-[6px]" : "-left-[10px]",
              )}
              aria-hidden
            />
          )}
          <Home className="size-4 shrink-0" />
          {labelMode && (
            <span className="min-w-0 flex-1 truncate text-left text-sm">
              Overview
            </span>
          )}
        </button>

        {hosts.map((host) => {
          const status = byHost[host.id]?.status ?? "idle"
          const Entry = labelMode ? HostRow : HostTile
          return (
            <Entry
              key={host.id}
              label={host.label}
              accent={hostAccent(host)}
              icon={host.icon}
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
          size={labelMode ? "sm" : "icon"}
          aria-label="Add host"
          title="Add host"
          className={cn(
            "text-muted-foreground shrink-0 rounded-md border border-dashed",
            labelMode ? "w-full justify-start gap-2 px-2" : "size-8",
          )}
          onClick={() => {
            setSelectedHostId(null)
            setAddHostOpen(true)
            setActivity("home")
          }}
        >
          <Plus className="size-4 shrink-0" />
          {labelMode && <span className="truncate">Add host</span>}
        </Button>
      </div>

      <div
        className={cn(
          "border-border flex w-full flex-col gap-0.5 border-t px-1.5 py-2",
          labelMode ? "items-stretch" : "items-center",
        )}
      >
        {bottomGlobals.map(({ id, icon: Icon, label }) => (
          <Button
            key={id}
            variant="ghost"
            size={labelMode ? "sm" : "icon"}
            aria-label={label}
            title={label}
            aria-current={activity === id ? "page" : undefined}
            className={cn(
              "text-muted-foreground",
              labelMode ? "w-full justify-start gap-2 px-2" : "size-8",
              activity === id &&
                "bg-sidebar-accent text-sidebar-accent-foreground",
            )}
            onClick={() => {
              setSelectedHostId(null)
              setActivity(id)
            }}
          >
            <Icon className="size-4 shrink-0" />
            {labelMode && <span className="truncate">{label}</span>}
          </Button>
        ))}
      </div>
    </nav>
  )
}
