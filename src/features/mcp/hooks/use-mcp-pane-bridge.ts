import { useEffect } from "react"
import { listen } from "@tauri-apps/api/event"

import { useConnectionStore } from "@/stores/connection.store"
import { useLayoutStore } from "@/stores/layout.store"
import { useSessionStore } from "@/stores/session.store"

export type McpPaneReadyPayload = {
  paneId: string
  sessionId: string
  hostId: string
  label: string
  showTerminal: boolean
  mcpHidden: boolean
}

/** Syncs MCP-created terminal panes into frontend session/connection state. */
export function useMcpPaneBridge() {
  useEffect(() => {
    let unlisten: (() => void) | undefined

    void listen<McpPaneReadyPayload>("mcp://pane-ready", (event) => {
      const { paneId, sessionId, hostId, label, showTerminal, mcpHidden } =
        event.payload

      useConnectionStore.getState().setConnected(hostId, sessionId)
      useSessionStore.getState().addPane({
        paneId,
        sessionId,
        hostId,
        title: label,
        mcpHidden: mcpHidden ?? !showTerminal,
      })

      if (showTerminal) {
        useLayoutStore.getState().setSelectedHostId(hostId)
        useLayoutStore.getState().setActivity("terminal")
        useSessionStore.getState().setActive(paneId)
      }
    }).then((fn) => {
      unlisten = fn
    })

    return () => {
      unlisten?.()
    }
  }, [])
}
