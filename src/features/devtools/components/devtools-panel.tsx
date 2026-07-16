import { useMutation, useQuery } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { ipc } from "@/lib/ipc/commands"

export function DevtoolsPanel({ hostId }: { hostId: string }) {
  const [path, setPath] = useState(".")
  const [cmd, setCmd] = useState("ping -c 3 1.1.1.1")
  const [out, setOut] = useState("")
  const probe = useQuery({
    queryKey: ["devtools", "probe", hostId],
    queryFn: () => ipc.devtoolsProbe(hostId),
  })
  const git = useMutation({
    mutationFn: () => ipc.devtoolsGitStatus(hostId, path),
    onSuccess: setOut,
  })
  const run = useMutation({
    mutationFn: () => ipc.devtoolsRun(hostId, cmd),
    onSuccess: setOut,
  })

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-4 text-sm">
      <h2 className="text-lg font-semibold">Dev tools</h2>
      <section>
        <h3 className="mb-1 font-medium">Runtimes</h3>
        <pre className="bg-muted rounded-md p-2 font-mono text-xs whitespace-pre-wrap">
          {JSON.stringify(probe.data ?? {}, null, 2)}
        </pre>
      </section>
      <div className="flex flex-wrap gap-2">
        <input
          className="border-input bg-background rounded-md border px-2 py-1 font-mono text-xs"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="git path"
        />
        <Button size="sm" onClick={() => git.mutate()}>
          Git status
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <input
          className="border-input bg-background min-w-[240px] flex-1 rounded-md border px-2 py-1 font-mono text-xs"
          value={cmd}
          onChange={(e) => setCmd(e.target.value)}
        />
        <Button size="sm" variant="outline" onClick={() => run.mutate()}>
          Run diag
        </Button>
      </div>
      {out && (
        <pre className="bg-muted flex-1 overflow-auto rounded-md p-2 text-xs whitespace-pre-wrap">{out}</pre>
      )}
    </div>
  )
}
