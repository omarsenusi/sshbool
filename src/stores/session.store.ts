import { create } from "zustand"

type SessionPane = {
  paneId: string
  sessionId: string
  hostId: string
  title: string
  /** Rendered in a separate OS window. */
  poppedOut?: boolean
}

type SessionState = {
  panes: SessionPane[]
  activePaneId: string | null
  addPane: (pane: SessionPane) => void
  removePane: (paneId: string) => void
  setActive: (paneId: string) => void
  setPoppedOut: (paneId: string, poppedOut: boolean) => void
}

export const useSessionStore = create<SessionState>((set) => ({
  panes: [],
  activePaneId: null,
  addPane: (pane) =>
    set((s) => ({
      panes: [...s.panes.filter((p) => p.paneId !== pane.paneId), pane],
      activePaneId: pane.paneId,
    })),
  removePane: (paneId) =>
    set((s) => {
      const panes = s.panes.filter((p) => p.paneId !== paneId)
      return {
        panes,
        activePaneId: s.activePaneId === paneId ? (panes[0]?.paneId ?? null) : s.activePaneId,
      }
    }),
  setActive: (paneId) => set({ activePaneId: paneId }),
  setPoppedOut: (paneId, poppedOut) =>
    set((s) => ({
      panes: s.panes.map((p) => (p.paneId === paneId ? { ...p, poppedOut } : p)),
    })),
}))
