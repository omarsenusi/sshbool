import { clearTerminalScrollback } from "@/features/terminal/terminal-scrollback"
import { formatAppError, IpcError, ipc } from "@/lib/ipc/commands"
import { useConnectionStore } from "@/stores/connection.store"
import { useSessionStore } from "@/stores/session.store"
import { toast } from "@/stores/toast.store"

function errMessage(err: unknown): string {
  if (err instanceof IpcError) return formatAppError(err.appError)
  if (err instanceof Error) return err.message
  return String(err)
}

/** Open SSH session for a host (shared by all tools). Optionally opens a terminal pane. */
export async function connectHost(
  hostId: string,
  opts?: { label?: string; openPane?: boolean },
): Promise<void> {
  const conn = useConnectionStore.getState()
  conn.clearError(hostId)
  conn.setConnecting(hostId)

  try {
    const { sessionId } = await ipc.sessionOpen(hostId)
    conn.setConnected(hostId, sessionId)

    if (opts?.openPane !== false) {
      const panes = useSessionStore.getState().panes
      const existing = panes.find((p) => p.hostId === hostId && !p.poppedOut)
      if (!existing) {
        const pane = await ipc.paneOpen(hostId, 120, 40)
        clearTerminalScrollback(pane.paneId)
        useSessionStore.getState().addPane({
          ...pane,
          title: opts?.label ?? pane.title,
        })
      }
    }

    toast.success("Connected", opts?.label ?? "SSH session ready")
  } catch (err) {
    const message = errMessage(err)
    conn.setError(hostId, message)
    toast.error("Connection failed", message)
    throw err
  }
}

/** Tear down SSH session + panes; SFTP/tools lose access until reconnect. */
export async function disconnectHost(hostId: string): Promise<void> {
  const session = useConnectionStore.getState().byHost[hostId]
  const panes = useSessionStore.getState().panes.filter((p) => p.hostId === hostId)
  const removePane = useSessionStore.getState().removePane

  for (const p of panes) {
    try {
      await ipc.paneClose(p.paneId)
    } catch {
      /* already gone */
    }
    removePane(p.paneId)
  }

  const sessionId = session?.sessionId ?? panes[0]?.sessionId
  if (sessionId) {
    try {
      await ipc.sessionClose(sessionId)
    } catch {
      /* already gone */
    }
  }

  useConnectionStore.getState().setIdle(hostId)
  toast.info("Disconnected")
}
