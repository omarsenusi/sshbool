import { emit, listen } from "@tauri-apps/api/event"

const MAX_CHARS = 500_000

const memory = new Map<string, string>()
const serializers = new Map<string, () => string>()

export const TERM_SCROLLBACK_REQUEST = "sshbool://term-scrollback/request"
export const TERM_SCROLLBACK_RESPONSE = "sshbool://term-scrollback/response"

export type ScrollbackPayload = { paneId: string; data: string }

export function appendTerminalScrollback(paneId: string, chunk: string) {
  if (!chunk) return
  const prev = memory.get(paneId) ?? ""
  let next = prev + chunk
  if (next.length > MAX_CHARS) next = next.slice(next.length - MAX_CHARS)
  memory.set(paneId, next)
}

export function getTerminalScrollback(paneId: string): string {
  const live = serializers.get(paneId)?.()
  if (live) return live
  return memory.get(paneId) ?? ""
}

/** Register a live xterm serializer (main window pane). */
export function registerTerminalSerializer(paneId: string, serialize: () => string) {
  serializers.set(paneId, serialize)
}

export function unregisterTerminalSerializer(paneId: string) {
  serializers.delete(paneId)
}

export function clearTerminalScrollback(paneId: string) {
  memory.delete(paneId)
  serializers.delete(paneId)
}

const pendingRestore = new Map<string, string>()

export function setPendingRestore(paneId: string, data: string) {
  pendingRestore.set(paneId, data)
}

export function takePendingRestore(paneId: string): string {
  const data = pendingRestore.get(paneId) ?? ""
  pendingRestore.delete(paneId)
  return data
}

/** Main window: answer pop-out requests with current buffer. */
export function startScrollbackBridge() {
  return listen<{ paneId: string }>(TERM_SCROLLBACK_REQUEST, (event) => {
    const paneId = event.payload?.paneId
    if (!paneId) return
    const data = getTerminalScrollback(paneId)
    void emit(TERM_SCROLLBACK_RESPONSE, { paneId, data } satisfies ScrollbackPayload)
  })
}

/** Push scrollback to any listening pop-out (call after window created). */
export async function pushScrollbackToPopout(paneId: string) {
  const data = getTerminalScrollback(paneId)
  await emit(TERM_SCROLLBACK_RESPONSE, { paneId, data } satisfies ScrollbackPayload)
}

/** Pop-out window: request + wait for scrollback from the main window. */
export async function fetchScrollbackFromMain(
  paneId: string,
  timeoutMs = 2500,
): Promise<string> {
  return await new Promise((resolve) => {
    let done = false
    const finish = (data: string) => {
      if (done) return
      done = true
      window.clearTimeout(timer)
      void unlistenThen()
      resolve(data)
    }

    let unlisten: (() => void) | undefined
    const unlistenThen = () => {
      unlisten?.()
    }

    const timer = window.setTimeout(() => finish(memory.get(paneId) ?? ""), timeoutMs)

    void listen<ScrollbackPayload>(TERM_SCROLLBACK_RESPONSE, (event) => {
      if (event.payload?.paneId !== paneId) return
      finish(event.payload.data ?? "")
    }).then((fn) => {
      unlisten = fn
      if (done) fn()
    })

    void emit(TERM_SCROLLBACK_REQUEST, { paneId })
  })
}
