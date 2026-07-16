import { confirm } from "@tauri-apps/plugin-dialog"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { useEffect } from "react"

import { ipc } from "@/lib/ipc/commands"

function isBusy(status: string) {
  return status === "active" || status === "queued"
}

/** Warn before quitting while uploads/downloads are still running. */
export function useTransferCloseGuard(enabled = true) {
  useEffect(() => {
    if (!enabled) return

    let cancelled = false
    let unlisten: (() => void) | undefined

    void (async () => {
      const win = getCurrentWindow()
      unlisten = await win.onCloseRequested(async (event) => {
        let active = 0
        try {
          const list = await ipc.transfersList()
          active = list.filter((t) => isBusy(t.status)).length
        } catch {
          return
        }
        if (active === 0) return

        event.preventDefault()
        const ok = await confirm(
          active === 1
            ? "A file transfer is still in progress (upload/download). Close SSHBool anyway?"
            : `${active} file transfers are still in progress. Close SSHBool anyway?`,
          {
            title: "Transfers in progress",
            kind: "warning",
            okLabel: "Close anyway",
            cancelLabel: "Keep open",
          },
        )
        if (ok && !cancelled) {
          await win.destroy()
        }
      })
    })()

    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [enabled])
}
