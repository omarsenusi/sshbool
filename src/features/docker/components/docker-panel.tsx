import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { ipc } from "@/lib/ipc/commands"

export function DockerPanel({ hostId }: { hostId: string }) {
  const qc = useQueryClient()
  const [logs, setLogs] = useState("")
  const containers = useQuery({
    queryKey: ["docker", "containers", hostId],
    queryFn: () => ipc.dockerListContainers(hostId),
  })
  const images = useQuery({
    queryKey: ["docker", "images", hostId],
    queryFn: () => ipc.dockerListImages(hostId),
  })
  const action = useMutation({
    mutationFn: ({ id, act }: { id: string; act: string }) =>
      ipc.dockerContainerAction(hostId, id, act),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["docker", "containers", hostId] }),
  })

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4 text-sm">
      <h2 className="text-lg font-semibold">Docker</h2>
      {containers.isError && (
        <p className="text-destructive text-xs">{(containers.error as Error).message}</p>
      )}
      <section>
        <h3 className="mb-2 font-medium">Containers</h3>
        <div className="space-y-1 font-mono text-xs">
          {(containers.data ?? []).map((c) => (
            <div key={String(c.id)} className="border-border flex flex-wrap items-center gap-2 border-b py-1">
              <span className="w-20 truncate">{String(c.id)}</span>
              <span className="min-w-0 flex-1 truncate">{String(c.name)}</span>
              <span className="text-muted-foreground">{String(c.status)}</span>
              <Button size="sm" variant="ghost" onClick={() => action.mutate({ id: String(c.id), act: "start" })}>
                Start
              </Button>
              <Button size="sm" variant="ghost" onClick={() => action.mutate({ id: String(c.id), act: "stop" })}>
                Stop
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void ipc.dockerLogs(hostId, String(c.id)).then(setLogs)}
              >
                Logs
              </Button>
            </div>
          ))}
        </div>
      </section>
      {logs && (
        <pre className="bg-muted max-h-48 overflow-auto rounded-md p-2 font-mono text-xs whitespace-pre-wrap">
          {logs}
        </pre>
      )}
      <section>
        <h3 className="mb-2 font-medium">Images</h3>
        <ul className="font-mono text-xs">
          {(images.data ?? []).slice(0, 30).map((img) => (
            <li key={String(img.id)}>
              {String(img.repository)}:{String(img.tag)} — {String(img.size)}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
