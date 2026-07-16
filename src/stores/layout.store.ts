import { create } from "zustand"

import { normalizeRemotePath } from "@/features/sftp/lib/remote-path"
import { useEditorStore } from "@/stores/editor.store"

export type ActivityId =
  | "home"
  | "connections"
  | "terminal"
  | "sftp"
  | "editor"
  | "dashboard"
  | "docker"
  | "kubernetes"
  | "databases"
  | "devtools"
  | "ai"
  | "keys"
  | "plugins"
  | "audit"
  | "sync"
  | "settings"

/** Tools that require a selected host (shown in context sidebar). */
export const HOST_SCOPED_ACTIVITIES: ActivityId[] = [
  "terminal",
  "sftp",
  "editor",
  "dashboard",
  "docker",
  "kubernetes",
  "databases",
  "devtools",
]

/** App-level activities (host rail). */
export const GLOBAL_ACTIVITIES: ActivityId[] = [
  "home",
  "connections",
  "ai",
  "keys",
  "plugins",
  "audit",
  "sync",
  "settings",
]

export type LastViewed = {
  hostId: string
  activity: ActivityId
  at: number
}

type LayoutState = {
  activity: ActivityId
  sidebarOpen: boolean
  selectedHostId: string | null
  /** Host ids with at least one open pane/session in this app window. */
  liveHostIds: string[]
  /** When true, connections main shows the add-host form. */
  addHostOpen: boolean
  lastViewed: LastViewed | null
  /** @deprecated Prefer editor store openTab — kept for callers. */
  editorPath: string
  setActivity: (activity: ActivityId) => void
  toggleSidebar: () => void
  setSelectedHostId: (id: string | null) => void
  markHostLive: (hostId: string) => void
  unmarkHostLive: (hostId: string) => void
  setLiveHostIds: (ids: string[]) => void
  setAddHostOpen: (open: boolean) => void
  rememberView: (hostId: string, activity: ActivityId) => void
  setEditorPath: (path: string) => void
  openEditor: (hostId: string, path: string) => void
}

export const useLayoutStore = create<LayoutState>((set) => ({
  activity: "home",
  sidebarOpen: true,
  selectedHostId: null,
  liveHostIds: [],
  addHostOpen: false,
  lastViewed: null,
  editorPath: "",
  setActivity: (activity) =>
    set((s) => {
      if (
        s.selectedHostId &&
        HOST_SCOPED_ACTIVITIES.includes(activity)
      ) {
        return {
          activity,
          lastViewed: {
            hostId: s.selectedHostId,
            activity,
            at: Date.now(),
          },
        }
      }
      return { activity }
    }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSelectedHostId: (id) => set({ selectedHostId: id }),
  markHostLive: (hostId) =>
    set((s) =>
      s.liveHostIds.includes(hostId)
        ? s
        : { liveHostIds: [...s.liveHostIds, hostId] },
    ),
  unmarkHostLive: (hostId) =>
    set((s) => ({ liveHostIds: s.liveHostIds.filter((id) => id !== hostId) })),
  setLiveHostIds: (ids) => set({ liveHostIds: ids }),
  setAddHostOpen: (open) => set({ addHostOpen: open }),
  rememberView: (hostId, activity) =>
    set({ lastViewed: { hostId, activity, at: Date.now() } }),
  setEditorPath: (path) => set({ editorPath: path }),
  openEditor: (hostId, path) => {
    const normalized = normalizeRemotePath(path)
    set({
      selectedHostId: hostId,
      activity: "editor",
      editorPath: normalized,
      lastViewed: { hostId, activity: "editor", at: Date.now() },
    })
    useEditorStore.getState().openTab(hostId, normalized)
  },
}))
