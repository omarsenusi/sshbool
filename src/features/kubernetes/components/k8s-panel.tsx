import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { ipc } from "@/lib/ipc/commands"

export function K8sPanel({ hostId }: { hostId: string }) {
  const [ns, setNs] = useState("default")
  const [logs, setLogs] = useState("")
  const pods = useQuery({
    queryKey: ["k8s", "pods", hostId, ns],
    queryFn: () => ipc.k8sGetPods(hostId, ns),
  })
  const deploys = useQuery({
    queryKey: ["k8s", "deploy", hostId, ns],
    queryFn: () => ipc.k8sGetDeployments(hostId, ns),
  })

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4 text-sm">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold">Kubernetes</h2>
        <input
          className="border-input bg-background rounded-md border px-2 py-1 text-xs"
          value={ns}
          onChange={(e) => setNs(e.target.value)}
          placeholder="namespace"
        />
        <Button size="sm" variant="outline" onClick={() => { void pods.refetch(); void deploys.refetch() }}>
          Refresh
        </Button>
      </div>
      {pods.isError && <p className="text-destructive text-xs">{(pods.error as Error).message}</p>}
      <section>
        <h3 className="mb-2 font-medium">Pods</h3>
        <div className="font-mono text-xs">
          {(pods.data ?? []).map((p) => (
            <div key={String(p.name)} className="flex items-center gap-2 py-0.5">
              <span className="min-w-0 flex-1 truncate">{String(p.name)}</span>
              <span>{String(p.status)}</span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void ipc.k8sLogs(hostId, ns, String(p.name)).then(setLogs)}
              >
                Logs
              </Button>
            </div>
          ))}
        </div>
      </section>
      <section>
        <h3 className="mb-2 font-medium">Deployments</h3>
        <ul className="font-mono text-xs">
          {(deploys.data ?? []).map((d) => (
            <li key={String(d.name)}>
              {String(d.name)} — ready {String(d.ready)}
            </li>
          ))}
        </ul>
      </section>
      {logs && (
        <pre className="bg-muted max-h-48 overflow-auto rounded-md p-2 text-xs whitespace-pre-wrap">{logs}</pre>
      )}
    </div>
  )
}
