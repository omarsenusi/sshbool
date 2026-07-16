import { useQuery, useQueryClient } from "@tanstack/react-query"
import { listen } from "@tauri-apps/api/event"
import { useEffect, useMemo } from "react"

import { ipc } from "@/lib/ipc/commands"
import type { TransferJobDto } from "@/lib/ipc/types"

const TRANSFERS_KEY = ["transfers", "list"] as const

export function isTransferActive(t: TransferJobDto) {
  return t.status === "active" || t.status === "queued"
}

/** Keeps transfer list + live progress fresh app-wide (survives leaving SFTP). */
export function useTransfersSync(enabled = true) {
  const qc = useQueryClient()

  useQuery({
    queryKey: TRANSFERS_KEY,
    queryFn: () => ipc.transfersList(),
    enabled,
    refetchInterval: (q) => {
      if (!enabled) return false
      const rows = q.state.data ?? []
      return rows.some(isTransferActive) ? 500 : 4000
    },
  })

  useEffect(() => {
    if (!enabled) return
    let unlisten: (() => void) | undefined
    void listen<TransferJobDto>("transfer://progress", (event) => {
      const p = event.payload
      qc.setQueryData<TransferJobDto[]>(TRANSFERS_KEY, (old) => {
        if (!old) return [p]
        const idx = old.findIndex((t) => t.id === p.id)
        if (idx >= 0) {
          const next = [...old]
          next[idx] = { ...next[idx], ...p }
          return next
        }
        return [p, ...old]
      })
    }).then((fn) => {
      unlisten = fn
    })
    return () => {
      unlisten?.()
    }
  }, [qc, enabled])
}

export function useActiveTransfers() {
  const { data } = useQuery({
    queryKey: TRANSFERS_KEY,
    queryFn: () => ipc.transfersList(),
    staleTime: 1_000,
  })
  return useMemo(() => (data ?? []).filter(isTransferActive), [data])
}
