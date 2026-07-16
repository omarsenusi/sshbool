import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Pencil, Plus, Star, Trash2 } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { AddHostForm } from "@/features/connections/components/add-host-form"
import {
  HOST_COLOR_PRESETS,
  flattenHosts,
  hostAccent,
  hostLetter,
} from "@/features/connections/host-appearance"
import { ipc } from "@/lib/ipc/commands"
import type { HostDto, HostTreeNode } from "@/lib/ipc/types"
import { cn } from "@/lib/utils"
import { useLayoutStore } from "@/stores/layout.store"

function HostNode({
  node,
  onSelect,
}: {
  node: HostTreeNode
  onSelect: (hostId: string) => void
}) {
  if (node.kind === "group") {
    return (
      <div className="space-y-1">
        <div className="text-muted-foreground px-2 py-1 text-xs font-medium uppercase">
          {node.group.name}
        </div>
        <div className="pl-2">
          {node.children.map((c, i) => (
            <HostNode key={i} node={c} onSelect={onSelect} />
          ))}
        </div>
      </div>
    )
  }

  const h = node.host
  const accent = hostAccent(h)
  return (
    <button
      type="button"
      className="hover:bg-muted/60 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm"
      onClick={() => onSelect(h.id)}
    >
      <span
        className="flex size-6 shrink-0 items-center justify-center rounded text-[11px] font-semibold text-white"
        style={{ backgroundColor: accent }}
      >
        {hostLetter(h.label)}
      </span>
      {h.isFavorite && <Star className="size-3 fill-current text-warning" />}
      <span className="min-w-0 flex-1 truncate font-medium">{h.label}</span>
      <span className="text-muted-foreground truncate text-xs">
        {h.username ? `${h.username}@` : ""}
        {h.hostname}:{h.port}
      </span>
    </button>
  )
}

function EditHostColor({
  host,
  onClose,
}: {
  host: HostDto
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [color, setColor] = useState(host.color ?? hostAccent(host))

  const update = useMutation({
    mutationFn: () => ipc.hostsUpdate({ ...host, color }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["hosts"] })
      onClose()
    },
  })

  return (
    <div className="border-border space-y-2 border-t p-3">
      <div className="text-sm font-medium">Color — {host.label}</div>
      <div className="flex flex-wrap gap-2">
        {HOST_COLOR_PRESETS.map((c) => (
          <button
            key={c}
            type="button"
            className={cn(
              "size-7 rounded-md",
              color === c && "ring-foreground ring-2 ring-offset-2",
            )}
            style={{ backgroundColor: c }}
            onClick={() => setColor(c)}
          />
        ))}
      </div>
      <div className="flex gap-2">
        <Button size="sm" disabled={update.isPending} onClick={() => update.mutate()}>
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

export function HostTree({
  embedded = false,
  onSelectHost,
}: {
  /** Render as a section inside Overview (no full-page chrome). */
  embedded?: boolean
  onSelectHost?: (hostId: string) => void
} = {}) {
  const qc = useQueryClient()
  const setSelectedHostId = useLayoutStore((s) => s.setSelectedHostId)
  const setActivity = useLayoutStore((s) => s.setActivity)
  const setAddHostOpen = useLayoutStore((s) => s.setAddHostOpen)
  const addHostOpen = useLayoutStore((s) => s.addHostOpen)
  const [editingId, setEditingId] = useState<string | null>(null)

  const tree = useQuery({
    queryKey: ["hosts", "tree"],
    queryFn: () => ipc.hostsListTree(),
  })

  const remove = useMutation({
    mutationFn: (id: string) => ipc.hostsDelete(id),
    onSuccess: (_d, id) => {
      if (useLayoutStore.getState().selectedHostId === id) {
        setSelectedHostId(null)
      }
      void qc.invalidateQueries({ queryKey: ["hosts"] })
    },
  })

  const hosts = flattenHosts(tree.data ?? [])
  const editing = editingId ? hosts.find((h) => h.id === editingId) : null

  function selectHost(id: string) {
    if (onSelectHost) {
      onSelectHost(id)
      return
    }
    setSelectedHostId(id)
    setActivity("terminal")
    useLayoutStore.getState().rememberView(id, "terminal")
  }

  if (addHostOpen) {
    return <AddHostForm />
  }

  const list = (
    <>
      {tree.isLoading && <p className="text-muted-foreground p-2 text-xs">Loading…</p>}
      {tree.data?.map((n, i) => (
        <div key={i} className="group relative">
          <HostNode node={n} onSelect={selectHost} />
          {n.kind === "host" && (
            <div className="absolute top-1 right-1 flex gap-0.5 opacity-0 group-hover:opacity-100">
              <Button
                variant="ghost"
                size="icon-xs"
                title="Edit color"
                onClick={() => setEditingId(n.host.id)}
              >
                <Pencil />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => remove.mutate(n.host.id)}
              >
                <Trash2 />
              </Button>
            </div>
          )}
        </div>
      ))}
      {tree.data?.length === 0 && (
        <p className="text-muted-foreground p-3 text-xs">No hosts yet. Add one to connect.</p>
      )}
      {editing && (
        <EditHostColor host={editing} onClose={() => setEditingId(null)} />
      )}
    </>
  )

  if (embedded) {
    return (
      <section className="border-border rounded-xl border">
        <div className="border-border flex items-center justify-between border-b px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold">Manage hosts</h2>
            <p className="text-muted-foreground text-xs">
              Select a host to open tools, or edit its tile color.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setAddHostOpen(true)}>
            <Plus className="size-3.5" />
            Add
          </Button>
        </div>
        <div className="p-2">{list}</div>
      </section>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-border flex items-center justify-between border-b px-3 py-2">
        <div>
          <h2 className="text-sm font-semibold">Manage hosts</h2>
          <p className="text-muted-foreground text-xs">
            Select a host to use tools, or edit its tile color.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setAddHostOpen(true)}>
          <Plus className="size-3.5" />
          Add
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">{list}</div>
    </div>
  )
}
