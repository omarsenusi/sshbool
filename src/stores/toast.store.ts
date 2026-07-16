import { create } from "zustand"

export type ToastKind = "success" | "error" | "info"

export type ToastItem = {
  id: string
  kind: ToastKind
  title: string
  description?: string
}

type ToastState = {
  items: ToastItem[]
  push: (kind: ToastKind, title: string, description?: string) => void
  dismiss: (id: string) => void
}

export const useToastStore = create<ToastState>((set) => ({
  items: [],
  push: (kind, title, description) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    set((s) => ({ items: [...s.items.slice(-4), { id, kind, title, description }] }))
    window.setTimeout(() => {
      set((s) => ({ items: s.items.filter((t) => t.id !== id) }))
    }, 4500)
  },
  dismiss: (id) => set((s) => ({ items: s.items.filter((t) => t.id !== id) })),
}))

export const toast = {
  success: (title: string, description?: string) =>
    useToastStore.getState().push("success", title, description),
  error: (title: string, description?: string) =>
    useToastStore.getState().push("error", title, description),
  info: (title: string, description?: string) =>
    useToastStore.getState().push("info", title, description),
}
