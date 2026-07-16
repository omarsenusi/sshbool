import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import { useEffect } from "react"

export function useEvent<T>(topic: string, handler: (payload: T) => void) {
  useEffect(() => {
    let unlisten: UnlistenFn | undefined
    let cancelled = false

    void listen<T>(topic, (event) => {
      if (!cancelled) handler(event.payload)
    }).then((fn) => {
      unlisten = fn
    })

    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [topic, handler])
}
