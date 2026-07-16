import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { ipc } from "@/lib/ipc/commands"

export function SyncPanel() {
  const qc = useQueryClient()
  const [endpoint, setEndpoint] = useState("http://127.0.0.1:8787")
  const status = useQuery({ queryKey: ["sync-status"], queryFn: () => ipc.syncStatus() })
  const devices = useQuery({ queryKey: ["sync-devices"], queryFn: () => ipc.syncDevicesList() })

  const configure = useMutation({
    mutationFn: (enabled: boolean) => ipc.syncConfigure(enabled, endpoint),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sync-status"] }),
  })
  const push = useMutation({ mutationFn: () => ipc.syncPush() })
  const pull = useMutation({ mutationFn: () => ipc.syncPull() })
  const enable = useMutation({
    mutationFn: () => ipc.syncEnable(endpoint),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sync-status"] }),
  })

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-4 text-sm">
      <h2 className="text-lg font-semibold">Cloud sync</h2>
      <p className="text-muted-foreground text-xs">
        E2E-encrypted sync. Requires Pro/Team. Local relay stub:{" "}
        <code>services/sync-relay</code>
      </p>
      <pre className="bg-muted rounded-md p-2 font-mono text-xs">
        {JSON.stringify(status.data ?? {}, null, 2)}
      </pre>
      <label className="flex flex-col gap-1 text-xs">
        Relay endpoint
        <input
          className="border-input bg-background rounded-md border px-2 py-1 font-mono"
          value={endpoint}
          onChange={(e) => setEndpoint(e.target.value)}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => enable.mutate()}>
          Enable
        </Button>
        <Button size="sm" variant="outline" onClick={() => configure.mutate(false)}>
          Disable
        </Button>
        <Button size="sm" variant="outline" onClick={() => push.mutate()}>
          Push
        </Button>
        <Button size="sm" variant="outline" onClick={() => pull.mutate()}>
          Pull
        </Button>
      </div>
      {(push.data || pull.data) && (
        <pre className="bg-muted rounded-md p-2 text-xs">
          {JSON.stringify(push.data ?? pull.data, null, 2)}
        </pre>
      )}
      {(enable.isError || push.isError || pull.isError) && (
        <p className="text-destructive text-xs">
          {((enable.error ?? push.error ?? pull.error) as Error).message}
        </p>
      )}
      <section>
        <h3 className="mb-1 font-medium">Paired devices</h3>
        <ul className="text-xs">
          {(devices.data ?? []).map((d) => (
            <li key={String(d.id)}>
              {String(d.name)} ({String(d.platform)})
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
