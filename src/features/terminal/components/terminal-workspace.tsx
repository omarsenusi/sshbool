import { useMutation, useQuery } from "@tanstack/react-query"
import { AppWindow, Plus } from "lucide-react"
import { useEffect, useMemo } from "react"

import { Button } from "@/components/ui/button"
import { WindowTab, WindowTabStrip } from "@/components/layout/window-tab"
import { flattenHosts } from "@/features/connections/host-appearance"
import { TerminalPane } from "@/features/terminal/components/terminal-pane"
import {
  closeTerminalPopout,
  openTerminalPopout,
} from "@/features/terminal/open-terminal-popout"
import { ipc } from "@/lib/ipc/commands"
import { cn } from "@/lib/utils"
import { useConnectionStore } from "@/stores/connection.store"
import { useLayoutStore } from "@/stores/layout.store"
import { useSessionStore } from "@/stores/session.store"

export function TerminalWorkspace({ visible = true }: { visible?: boolean }) {
  const panes = useSessionStore((s) => s.panes)
  const activePaneId = useSessionStore((s) => s.activePaneId)
  const addPane = useSessionStore((s) => s.addPane)
  const removePane = useSessionStore((s) => s.removePane)
  const setActive = useSessionStore((s) => s.setActive)
  const setPoppedOut = useSessionStore((s) => s.setPoppedOut)
  const selectedHostId = useLayoutStore((s) => s.selectedHostId)
  const connected = useConnectionStore((s) =>
    selectedHostId ? s.byHost[selectedHostId]?.status === "connected" : false,
  )

  const tree = useQuery({
    queryKey: ["hosts"],
    queryFn: () => ipc.hostsListTree(),
  })
  const hosts = flattenHosts(tree.data ?? [])
  const selectedHost = selectedHostId
    ? hosts.find((h) => h.id === selectedHostId)
    : undefined
  const hostLabel = selectedHost?.label ?? null

  /** Only panes for the selected server — never mix hosts in the UI. */
  const hostPanes = useMemo(
    () => (selectedHostId ? panes.filter((p) => p.hostId === selectedHostId) : []),
    [panes, selectedHostId],
  )

  const active =
    hostPanes.find((p) => p.paneId === activePaneId) ?? hostPanes[0] ?? null

  // When switching servers, focus that server's terminal tab (if any).
  useEffect(() => {
    if (!selectedHostId || hostPanes.length === 0) return
    const onHost = hostPanes.some((p) => p.paneId === activePaneId)
    if (!onHost) setActive(hostPanes[0]!.paneId)
  }, [selectedHostId, hostPanes, activePaneId, setActive])

  const openPane = useMutation({
    mutationFn: async (id: string) => {
      const label = hosts.find((h) => h.id === id)?.label
      const pane = await ipc.paneOpen(id, 120, 40)
      return { ...pane, title: label ?? pane.title }
    },
    onSuccess: (pane) => {
      addPane(pane)
    },
  })

  // Auto-open one terminal for the selected connected host.
  useEffect(() => {
    if (!visible || !selectedHostId || !connected || !hostLabel) return
    if (hostPanes.length > 0 || openPane.isPending) return
    openPane.mutate(selectedHostId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, selectedHostId, connected, hostLabel, hostPanes.length])

  const closePane = useMutation({
    mutationFn: async (paneId: string) => {
      try {
        await closeTerminalPopout(paneId)
      } catch {
        /* no popout */
      }
      await ipc.paneClose(paneId)
      removePane(paneId)
    },
  })

  async function popOut(pane: { paneId: string; hostId: string; title: string }) {
    const ok = await openTerminalPopout({
      ...pane,
      onClosed: () => setPoppedOut(pane.paneId, false),
    })
    if (ok) setPoppedOut(pane.paneId, true)
  }

  async function bringBack(paneId: string) {
    try {
      await closeTerminalPopout(paneId)
    } catch {
      /* already closed */
    }
    setPoppedOut(paneId, false)
  }

  return (
    <div className="flex h-full flex-col">
      <WindowTabStrip
        trailing={
          <>
            {active && !active.poppedOut && (
              <Button
                size="sm"
                variant="outline"
                title="Open terminal in a separate window"
                onClick={() => void popOut(active)}
              >
                <AppWindow className="mr-1 size-3.5" />
                Pop out
              </Button>
            )}
            {active?.poppedOut && (
              <Button
                size="sm"
                variant="outline"
                title="Show terminal in this window again"
                onClick={() => void bringBack(active.paneId)}
              >
                Bring back
              </Button>
            )}
            {hostLabel && (
              <span
                className="text-foreground/80 max-w-[10rem] truncate text-xs font-semibold"
                title={
                  selectedHost
                    ? `${selectedHost.username ?? "root"}@${selectedHost.hostname}`
                    : hostLabel
                }
              >
                {hostLabel}
              </span>
            )}
            <Button
              size="icon-xs"
              title={
                connected
                  ? `New terminal on ${hostLabel ?? "host"}`
                  : "Connect the selected host first"
              }
              disabled={!selectedHostId || !connected || openPane.isPending}
              onClick={() => {
                if (selectedHostId) openPane.mutate(selectedHostId)
              }}
            >
              <Plus />
            </Button>
          </>
        }
      >
        {hostPanes.map((p) => (
          <WindowTab
            key={p.paneId}
            title={p.title}
            active={p.paneId === active?.paneId}
            leading={p.poppedOut ? <span aria-hidden>↗</span> : undefined}
            onSelect={() => setActive(p.paneId)}
            onClose={() => closePane.mutate(p.paneId)}
          />
        ))}
      </WindowTabStrip>
      <div className="relative min-h-0 flex-1">
        {hostPanes.length === 0 && (
          <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
            {!selectedHostId
              ? "Select a host from the rail."
              : !connected
                ? "Connect this host to open a terminal."
                : openPane.isPending
                  ? "Opening terminal…"
                  : "Open a terminal pane for this host."}
          </div>
        )}
        {/* Keep all panes mounted so other hosts' buffers survive; only show selected host. */}
        {panes.map((p) => {
          const forSelected = !!selectedHostId && p.hostId === selectedHostId
          const isActive = forSelected && p.paneId === active?.paneId
          const paneVisible = visible && isActive && !p.poppedOut
          return (
            <div
              key={p.paneId}
              className={cn(
                "relative h-full w-full",
                (!forSelected || !isActive) &&
                  "pointer-events-none absolute inset-0 invisible",
              )}
              aria-hidden={!forSelected || !isActive}
            >
              {!p.poppedOut && (
                <TerminalPane paneId={p.paneId} hostId={p.hostId} visible={paneVisible} />
              )}
              {p.poppedOut && isActive && (
                <div className="bg-background absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 text-sm">
                  <p className="text-muted-foreground">
                    Terminal is in a separate window (same SSH session + history).
                  </p>
                  <Button size="sm" variant="outline" onClick={() => void popOut(p)}>
                    Focus window
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void bringBack(p.paneId)}>
                    Show here again
                  </Button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
