export type EditorPopoutParams = {
  hostId: string
  path: string
}

export function parseEditorPopoutParams(): EditorPopoutParams | null {
  const q = new URLSearchParams(window.location.search)
  if (q.get("mode") !== "editor-popout") return null
  const hostId = q.get("hostId")
  const path = q.get("path")
  if (!hostId || !path) return null
  return { hostId, path }
}
