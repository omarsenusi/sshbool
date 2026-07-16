import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { HOST_COLOR_PRESETS } from "@/features/connections/host-appearance"
import { ipc } from "@/lib/ipc/commands"
import type { NewHostDto } from "@/lib/ipc/types"
import { cn } from "@/lib/utils"
import { useLayoutStore } from "@/stores/layout.store"

const emptyForm = (): NewHostDto => ({
  label: "",
  hostname: "",
  port: 22,
  username: "root",
  authMethod: "password",
  password: "",
  color: HOST_COLOR_PRESETS[0]!,
})

export function AddHostForm({ onDone }: { onDone?: () => void }) {
  const qc = useQueryClient()
  const setSelectedHostId = useLayoutStore((s) => s.setSelectedHostId)
  const setAddHostOpen = useLayoutStore((s) => s.setAddHostOpen)
  const [form, setForm] = useState<NewHostDto>(emptyForm)

  const create = useMutation({
    mutationFn: () => ipc.hostsCreate(form),
    onSuccess: async (id) => {
      setForm(emptyForm())
      setAddHostOpen(false)
      setSelectedHostId(id)
      await qc.invalidateQueries({ queryKey: ["hosts"] })
      onDone?.()
    },
  })

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-3 p-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Add host</h2>
        <p className="text-muted-foreground text-sm">
          Saved servers appear as colored tiles in the left rail.
        </p>
      </div>
      <input
        className="border-input bg-background w-full rounded-md border px-2 py-1.5 text-sm"
        placeholder="Label"
        value={form.label}
        onChange={(e) => setForm({ ...form, label: e.target.value })}
      />
      <input
        className="border-input bg-background w-full rounded-md border px-2 py-1.5 text-sm"
        placeholder="Hostname"
        value={form.hostname}
        onChange={(e) => setForm({ ...form, hostname: e.target.value })}
      />
      <div className="flex gap-2">
        <input
          className="border-input bg-background w-full rounded-md border px-2 py-1.5 text-sm"
          placeholder="User"
          value={form.username ?? ""}
          onChange={(e) => setForm({ ...form, username: e.target.value })}
        />
        <input
          className="border-input bg-background w-24 rounded-md border px-2 py-1.5 text-sm"
          type="number"
          value={form.port}
          onChange={(e) => setForm({ ...form, port: Number(e.target.value) || 22 })}
        />
      </div>
      <select
        className="border-input bg-background w-full rounded-md border px-2 py-1.5 text-sm"
        value={form.authMethod}
        onChange={(e) => setForm({ ...form, authMethod: e.target.value })}
      >
        <option value="password">Password</option>
        <option value="key">SSH Key</option>
        <option value="agent">Agent</option>
      </select>
      {form.authMethod === "password" && (
        <input
          type="password"
          className="border-input bg-background w-full rounded-md border px-2 py-1.5 text-sm"
          placeholder="Password"
          value={form.password ?? ""}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
        />
      )}
      <div className="space-y-1.5">
        <div className="text-muted-foreground text-xs font-medium">Tile color</div>
        <div className="flex flex-wrap gap-2">
          {HOST_COLOR_PRESETS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Color ${c}`}
              className={cn(
                "size-7 rounded-md",
                form.color === c && "ring-foreground ring-2 ring-offset-2",
              )}
              style={{ backgroundColor: c }}
              onClick={() => setForm({ ...form, color: c })}
            />
          ))}
        </div>
      </div>
      <div className="flex gap-2 pt-1">
        <Button
          className="flex-1"
          disabled={!form.label || !form.hostname || create.isPending}
          onClick={() => create.mutate()}
        >
          Add host
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            setAddHostOpen(false)
            onDone?.()
          }}
        >
          Cancel
        </Button>
      </div>
    </div>
  )
}
