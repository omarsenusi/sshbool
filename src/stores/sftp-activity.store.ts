import { create } from "zustand"

export type SftpActivityKind =
  | "rename"
  | "delete"
  | "mkdir"
  | "chmod"
  | "paste"
  | "move"
  | "copy"
  | "upload"
  | "download"

export type SftpActivityStatus = "running" | "done" | "error"

export type SftpActivityEntry = {
  id: string
  hostId: string
  kind: SftpActivityKind
  label: string
  side?: "local" | "remote"
  status: SftpActivityStatus
  error?: string
  /** Bytes completed so far. */
  bytesDone?: number
  /** Total bytes when known. */
  bytesTotal?: number
  at: number
}

type SftpActivityState = {
  entries: SftpActivityEntry[]
  start: (opts: {
    hostId: string
    kind: SftpActivityKind
    label: string
    side?: "local" | "remote"
    bytesTotal?: number
  }) => string
  setProgress: (id: string, bytesDone: number, bytesTotal?: number) => void
  finish: (
    id: string,
    status: "done" | "error",
    opts?: { error?: string; bytesDone?: number; bytesTotal?: number },
  ) => void
  clear: (hostId?: string) => void
}

const MAX = 40

function newId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export const useSftpActivityStore = create<SftpActivityState>((set) => ({
  entries: [],
  start: ({ hostId, kind, label, side, bytesTotal }) => {
    const id = newId()
    const entry: SftpActivityEntry = {
      id,
      hostId,
      kind,
      label,
      side,
      status: "running",
      bytesDone: 0,
      bytesTotal,
      at: Date.now(),
    }
    set((s) => ({ entries: [entry, ...s.entries].slice(0, MAX) }))
    return id
  },
  setProgress: (id, bytesDone, bytesTotal) =>
    set((s) => ({
      entries: s.entries.map((e) =>
        e.id === id
          ? {
              ...e,
              bytesDone,
              bytesTotal: bytesTotal ?? e.bytesTotal,
              at: Date.now(),
            }
          : e,
      ),
    })),
  finish: (id, status, opts) =>
    set((s) => ({
      entries: s.entries.map((e) => {
        if (e.id !== id) return e
        const bytesTotal = opts?.bytesTotal ?? e.bytesTotal
        const bytesDone =
          opts?.bytesDone ??
          (status === "done" ? (bytesTotal ?? e.bytesDone) : e.bytesDone)
        return {
          ...e,
          status,
          error: opts?.error,
          bytesDone,
          bytesTotal,
          at: Date.now(),
        }
      }),
    })),
  clear: (hostId) =>
    set((s) => ({
      entries: hostId ? s.entries.filter((e) => e.hostId !== hostId) : [],
    })),
}))

/** Run an op with running → done/error logged in the activity strip. */
export async function runSftpActivity<T>(
  opts: {
    hostId: string
    kind: SftpActivityKind
    label: string
    side?: "local" | "remote"
    bytesTotal?: number
  },
  fn: () => Promise<T>,
): Promise<T> {
  const { start, finish } = useSftpActivityStore.getState()
  const id = start(opts)
  try {
    const result = await fn()
    finish(id, "done", {
      bytesDone: opts.bytesTotal,
      bytesTotal: opts.bytesTotal,
    })
    return result
  } catch (err) {
    finish(id, "error", {
      error: err instanceof Error ? err.message : String(err),
      bytesTotal: opts.bytesTotal,
    })
    throw err
  }
}

export function activityProgressPct(entry: {
  bytesDone?: number
  bytesTotal?: number
  status: string
}): number | null {
  if (entry.status === "done") return 100
  const total = entry.bytesTotal
  if (total == null || total <= 0) return null
  const done = entry.bytesDone ?? 0
  return Math.min(100, Math.max(0, Math.round((done / total) * 100)))
}
