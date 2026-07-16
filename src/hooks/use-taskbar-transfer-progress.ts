import { getCurrentWindow, ProgressBarStatus } from "@tauri-apps/api/window"
import { useEffect, useMemo, useRef } from "react"

import {
  useActiveTransfers,
} from "@/hooks/use-transfers-sync"
import type { TransferJobDto } from "@/lib/ipc/types"

function aggregateProgress(active: TransferJobDto[]): {
  progress: number
  indeterminate: boolean
} | null {
  if (active.length === 0) return null

  let totalBytes = 0
  let doneBytes = 0
  let known = 0
  for (const t of active) {
    if (t.totalBytes > 0) {
      totalBytes += t.totalBytes
      doneBytes += Math.min(t.transferredBytes, t.totalBytes)
      known++
    }
  }

  if (known === 0 || totalBytes <= 0) {
    return { progress: 0, indeterminate: true }
  }

  return {
    progress: Math.min(100, Math.max(0, Math.round((doneBytes / totalBytes) * 100))),
    indeterminate: false,
  }
}

/** Shows Windows taskbar progress on the app icon during transfers. */
export function useTaskbarTransferProgress(enabled = true) {
  const active = useActiveTransfers()
  const state = useMemo(
    () => (enabled ? aggregateProgress(active) : null),
    [active, enabled],
  )
  const lastKey = useRef<string>("")

  useEffect(() => {
    if (!enabled) {
      if (lastKey.current !== "none") {
        lastKey.current = "none"
        void getCurrentWindow()
          .setProgressBar({ status: ProgressBarStatus.None })
          .catch(() => {})
      }
      return
    }

    const win = getCurrentWindow()
    const key = state
      ? state.indeterminate
        ? "indeterminate"
        : `normal:${state.progress}`
      : "none"

    if (key === lastKey.current) return
    lastKey.current = key

    void (async () => {
      try {
        if (!state) {
          await win.setProgressBar({ status: ProgressBarStatus.None })
          return
        }
        if (state.indeterminate) {
          await win.setProgressBar({ status: ProgressBarStatus.Indeterminate })
          return
        }
        await win.setProgressBar({
          status: ProgressBarStatus.Normal,
          progress: state.progress,
        })
      } catch {
        /* permission / platform */
      }
    })()
  }, [state, enabled])

  useEffect(() => {
    return () => {
      void getCurrentWindow()
        .setProgressBar({ status: ProgressBarStatus.None })
        .catch(() => {})
    }
  }, [])
}
