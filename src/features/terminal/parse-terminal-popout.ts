export type TerminalPopoutParams = {
  paneId: string
  hostId: string
  title: string
}

/** Kept in a separate module so Fast Refresh works for the pop-out window component. */
export function parseTerminalPopoutParams(): TerminalPopoutParams | null {
  const q = new URLSearchParams(window.location.search)
  if (q.get("mode") !== "terminal-popout") return null
  const paneId = q.get("paneId")
  if (!paneId) return null
  return {
    paneId,
    hostId: q.get("hostId") ?? "",
    title: q.get("title") ?? "Terminal",
  }
}
