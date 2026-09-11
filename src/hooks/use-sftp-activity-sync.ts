import { listen } from "@tauri-apps/api/event"
import { useEffect } from "react"

import {
  applySftpActivityEvent,
  type SftpActivityEvent,
} from "@/stores/sftp-activity.store"

/** Keeps SFTP activity log in sync across app windows (e.g. editor popout saves). */
export function useSftpActivitySync() {
  useEffect(() => {
    let unlisten: (() => void) | undefined
    void listen<SftpActivityEvent>("sftp://activity", (event) => {
      applySftpActivityEvent(event.payload)
    }).then((fn) => {
      unlisten = fn
    })
    return () => {
      unlisten?.()
    }
  }, [])
}
