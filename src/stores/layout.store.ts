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
  | "desktop"
  | "docker"
  | "kubernetes"
  | "databases"
  | "devtools"
  | "hostSettings"
  | "ai"
  | "keys"
  | "knownHosts"
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
  "desktop",
  "docker",
  "kubernetes",
  "databases",
  "devtools",
  "hostSettings",
]

/** App-level activities (host rail). */
export const GLOBAL_ACTIVITIES: ActivityId[] = [
  "home",
  "connections",
  "ai",
  "keys",
  "knownHosts",
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

/**
 * How the host rail renders entries.
 * - `icon`: compact vertical strip of host tiles (default).
 * - `label`: full-width rows showing the host name instead of an icon.
 */
export type HostRailMode = "icon" | "label"

/** Width bounds per rail mode, in px. Each mode remembers its own width. */
export const HOST_RAIL_SIZING: Record<
  HostRailMode,
  { min: number; max: number; default: number }
> = {
  icon: { min: 44, max: 120, default: 52 },
  label: { min: 150, max: 400, default: 220 },
}

export function clampHostRailWidth(mode: HostRailMode, width: number): number {
  const { min, max, default: fallback } = HOST_RAIL_SIZING[mode]
  if (!Number.isFinite(width)) return fallback
  return Math.min(Math.max(Math.round(width), min), max)
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
  /** Width of context sidebar in px. */
  sidebarWidth: number
  setSidebarWidth: (width: number) => void
  /** How the host rail renders entries. */
  hostRailMode: HostRailMode
  /** Rail width in px, tracked per mode so switching modes restores each size. */
  hostRailWidth: Record<HostRailMode, number>
  setHostRailMode: (mode: HostRailMode) => void
  setHostRailWidth: (mode: HostRailMode, width: number) => void
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
  sidebarWidth: 220,
  setSidebarWidth: (width) => set({ sidebarWidth: width }),
  hostRailMode: "icon",
  hostRailWidth: {
    icon: HOST_RAIL_SIZING.icon.default,
    label: HOST_RAIL_SIZING.label.default,
  },
  setHostRailMode: (mode) => set({ hostRailMode: mode }),
  setHostRailWidth: (mode, width) =>
    set((s) => ({
      hostRailWidth: {
        ...s.hostRailWidth,
        [mode]: clampHostRailWidth(mode, width),
      },
    })),
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
