import { create } from "zustand"

export type HostConnStatus = "idle" | "connecting" | "connected" | "error"

export type HostConnection = {
  status: HostConnStatus
  sessionId?: string
  error?: string
}

type ConnectionState = {
  byHost: Record<string, HostConnection>
  get: (hostId: string) => HostConnection
  setConnecting: (hostId: string) => void
  setConnected: (hostId: string, sessionId: string) => void
  setError: (hostId: string, error: string) => void
  setIdle: (hostId: string) => void
  clearError: (hostId: string) => void
  isConnected: (hostId: string) => boolean
  isConnecting: (hostId: string) => boolean
}

const idle: HostConnection = { status: "idle" }

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  byHost: {},
  get: (hostId) => get().byHost[hostId] ?? idle,
  setConnecting: (hostId) =>
    set((s) => ({
      byHost: {
        ...s.byHost,
        [hostId]: { status: "connecting", sessionId: s.byHost[hostId]?.sessionId },
      },
    })),
  setConnected: (hostId, sessionId) =>
    set((s) => ({
      byHost: {
        ...s.byHost,
        [hostId]: { status: "connected", sessionId },
      },
    })),
  setError: (hostId, error) =>
    set((s) => ({
      byHost: {
        ...s.byHost,
        [hostId]: { status: "error", error },
      },
    })),
  setIdle: (hostId) =>
    set((s) => {
      const next = { ...s.byHost }
      delete next[hostId]
      return { byHost: next }
    }),
  clearError: (hostId) =>
    set((s) => {
      const cur = s.byHost[hostId]
      if (!cur || cur.status !== "error") return s
      const next = { ...s.byHost }
      delete next[hostId]
      return { byHost: next }
    }),
  isConnected: (hostId) => get().byHost[hostId]?.status === "connected",
  isConnecting: (hostId) => get().byHost[hostId]?.status === "connecting",
}))
