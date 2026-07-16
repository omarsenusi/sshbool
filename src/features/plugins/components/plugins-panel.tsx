import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { ipc } from "@/lib/ipc/commands"

export function PluginsPanel() {
  const qc = useQueryClient()
  const [query, setQuery] = useState("")
  const list = useQuery({ queryKey: ["plugins"], queryFn: () => ipc.pluginsList() })
  const market = useQuery({
    queryKey: ["plugins", "market", query],
    queryFn: () => ipc.pluginsSearchMarketplace(query),
  })

  const install = useMutation({
    mutationFn: (manifest: Record<string, unknown>) => ipc.pluginsInstall(manifest),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["plugins"] }),
  })
  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      ipc.pluginsSetEnabled(id, enabled),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["plugins"] }),
  })

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4 text-sm">
      <h2 className="text-lg font-semibold">Plugins</h2>
      <section>
        <h3 className="mb-2 font-medium">Installed</h3>
        {(list.data ?? []).length === 0 && (
          <p className="text-muted-foreground text-xs">No plugins installed.</p>
        )}
        {(list.data ?? []).map((p) => (
          <div key={String(p.id)} className="flex items-center gap-2 py-1">
            <span className="flex-1">
              {String(p.name)} <span className="text-muted-foreground text-xs">v{String(p.version)}</span>
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => toggle.mutate({ id: String(p.id), enabled: !p.enabled })}
            >
              {p.enabled ? "Disable" : "Enable"}
            </Button>
          </div>
        ))}
      </section>
      <section className="space-y-2">
        <h3 className="font-medium">Marketplace</h3>
        <div className="flex gap-2">
          <input
            className="border-input bg-background flex-1 rounded-md border px-2 py-1 text-xs"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search…"
          />
          <Button size="sm" onClick={() => market.refetch()}>
            Search
          </Button>
        </div>
        {(market.data ?? []).map((item) => (
          <div key={String(item.slug)} className="flex items-center gap-2 border-b border-border/40 py-1">
            <div className="min-w-0 flex-1">
              <div>{String(item.name)}</div>
              <div className="text-muted-foreground text-xs">{String(item.description ?? "")}</div>
            </div>
            <Button
              size="sm"
              onClick={() =>
                install.mutate({
                  slug: item.slug,
                  name: item.name,
                  version: item.version ?? "0.1.0",
                  permissions: item.permissions ?? [],
                  paid: item.paid ?? false,
                })
              }
            >
              Install
            </Button>
          </div>
        ))}
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            install.mutate({
              slug: "sample-theme",
              name: "Sample Theme",
              version: "0.1.0",
              permissions: ["ui.theme"],
            })
          }
        >
          Install sample theme
        </Button>
      </section>
    </div>
  )
}
