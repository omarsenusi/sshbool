import { create } from "zustand"

import { normalizeRemotePath } from "@/features/sftp/lib/remote-path"

export type EditorTab = {
  id: string
  hostId: string
  path: string
  dirty: boolean
}

type EditorState = {
  tabs: EditorTab[]
  activeId: string | null
  openTab: (hostId: string, path: string) => string
  closeTab: (id: string) => void
  setActive: (id: string) => void
  setDirty: (id: string, dirty: boolean) => void
  updatePath: (id: string, path: string) => void
}

function tabId(hostId: string, path: string) {
  return `${hostId}::${path}`
}

export function editorTabTitle(path: string) {
  if (!path) return "New file"
  const parts = path.replace(/\\/g, "/").split("/")
  return parts[parts.length - 1] || path
}

export const useEditorStore = create<EditorState>((set, get) => ({
  tabs: [],
  activeId: null,
  openTab: (hostId, path) => {
    const normalized = path ? normalizeRemotePath(path) : ""
    if (!normalized) {
      const id = `${hostId}::new-${crypto.randomUUID()}`
      set((s) => ({
        tabs: [...s.tabs, { id, hostId, path: "", dirty: false }],
        activeId: id,
      }))
      return id
    }
    const id = tabId(hostId, normalized)
    const existing = get().tabs.find((t) => t.id === id)
    if (existing) {
      if (get().activeId !== id) set({ activeId: id })
      return id
    }
    set((s) => ({
      tabs: [...s.tabs, { id, hostId, path: normalized, dirty: false }],
      activeId: id,
    }))
    return id
  },
  closeTab: (id) =>
    set((s) => {
      const tabs = s.tabs.filter((t) => t.id !== id)
      const activeId =
        s.activeId === id ? (tabs[tabs.length - 1]?.id ?? null) : s.activeId
      return { tabs, activeId }
    }),
  setActive: (id) => {
    if (get().activeId === id) return
    set({ activeId: id })
  },
  setDirty: (id, dirty) =>
    set((s) => {
      const tab = s.tabs.find((t) => t.id === id)
      if (!tab || tab.dirty === dirty) return s
      return {
        tabs: s.tabs.map((t) => (t.id === id ? { ...t, dirty } : t)),
      }
    }),
  updatePath: (id, path) =>
    set((s) => {
      const tab = s.tabs.find((t) => t.id === id)
      if (!tab) return s
      const normalized = path ? normalizeRemotePath(path) : ""
      if (!normalized) {
        if (tab.path === "") return s
        return {
          tabs: s.tabs.map((t) => (t.id === id ? { ...t, path: "" } : t)),
        }
      }
      if (tab.path === normalized) return s
      const newId = tabId(tab.hostId, normalized)
      if (s.tabs.some((t) => t.id === newId && t.id !== id)) {
        return {
          tabs: s.tabs.filter((t) => t.id !== id),
          activeId: newId,
        }
      }
      return {
        tabs: s.tabs.map((t) =>
          t.id === id ? { ...t, id: newId, path: normalized, dirty: false } : t,
        ),
        activeId: s.activeId === id ? newId : s.activeId,
      }
    }),
}))
