import { useMutation, useQuery } from "@tanstack/react-query"
import { AppWindow, Plus } from "lucide-react"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { WindowTab, WindowTabStrip } from "@/components/layout/window-tab"
import { TerminalPane } from "@/features/terminal/components/terminal-pane"
import {
  closeTerminalPopout,
  openTerminalPopout,
} from "@/features/terminal/open-terminal-popout"
import { ipc } from "@/lib/ipc/commands"
import { cn } from "@/lib/utils"
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
  const [hostId, setHostId] = useState(selectedHostId ?? "")

  const recent = useQuery({
    queryKey: ["hosts", "recent"],
    queryFn: () => ipc.hostsListRecent(20),
  })

  useEffect(() => {
    if (selectedHostId) setHostId(selectedHostId)
  }, [selectedHostId])

  const openPane = useMutation({
    mutationFn: async (id: string) => {
      await ipc.sessionOpen(id)
      const pane = await ipc.paneOpen(id, 120, 40)
      const label = recent.data?.find((h) => h.id === id)?.label
      return { ...pane, title: label ?? pane.title }
    },
    onSuccess: (pane) => {
      addPane(pane)
    },
  })

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

  const active = panes.find((p) => p.paneId === activePaneId) ?? panes[0]

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
            <select
              className="border-input bg-background rounded-md border px-2 py-1 text-xs"
              value={hostId}
              onChange={(e) => setHostId(e.target.value)}
            >
              <option value="">Select host…</option>
              {recent.data?.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.label}
                </option>
              ))}
            </select>
            <Button
              size="icon-xs"
              disabled={!hostId || openPane.isPending}
              onClick={() => openPane.mutate(hostId)}
            >
              <Plus />
            </Button>
          </>
        }
      >
        {panes.map((p) => (
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
        {panes.length === 0 && (
          <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
            Open a terminal pane for a connected host.
          </div>
        )}
        {panes.map((p) => {
          const isActive = p.paneId === active?.paneId
          const paneVisible = visible && isActive && !p.poppedOut
          return (
            <div
              key={p.paneId}
              className={cn(
                "relative h-full w-full",
                !isActive && "pointer-events-none absolute inset-0 invisible",
              )}
              aria-hidden={!isActive}
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
