export type ErDiagramPopoutParams = {
  connectionId: string
  hostId: string
  name: string
}

export function parseErDiagramPopoutParams(): ErDiagramPopoutParams | null {
  const params = new URLSearchParams(window.location.search)
  if (params.get("mode") !== "er-popout") return null

  const connectionId = params.get("connectionId")
  const hostId = params.get("hostId")
  const name = params.get("name")

  if (!connectionId || !hostId) return null

  return {
    connectionId,
    hostId,
    name: name || "Database",
  }
}
