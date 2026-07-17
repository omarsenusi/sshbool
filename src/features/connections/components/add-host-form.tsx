import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ImagePlus, X } from "lucide-react"
import { useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { HOST_COLOR_PRESETS } from "@/features/connections/host-appearance"
import { ipc } from "@/lib/ipc/commands"
import type { NewHostDto } from "@/lib/ipc/types"
import { cn } from "@/lib/utils"
import { useLayoutStore } from "@/stores/layout.store"

const AUTO_KEY = "auto"

const emptyForm = (): NewHostDto => ({
  label: "",
  hostname: "",
  port: 22,
  username: "root",
  authMethod: "key",
  sshKeyId: AUTO_KEY,
  password: "",
  color: HOST_COLOR_PRESETS[0]!,
  icon: null,
})

async function fileToIconDataUrl(file: File): Promise<string> {
  const raw = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ""))
    reader.onerror = () => reject(reader.error ?? new Error("read failed"))
    reader.readAsDataURL(file)
  })
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image()
    el.onload = () => resolve(el)
    el.onerror = () => reject(new Error("invalid image"))
    el.src = raw
  })
  const max = 96
  const scale = Math.min(1, max / Math.max(img.width, img.height))
  const w = Math.max(1, Math.round(img.width * scale))
  const h = Math.max(1, Math.round(img.height * scale))
  const canvas = document.createElement("canvas")
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext("2d")
  if (!ctx) return raw
  ctx.drawImage(img, 0, 0, w, h)
  return canvas.toDataURL("image/png")
}

export function AddHostForm({ onDone }: { onDone?: () => void }) {
  const qc = useQueryClient()
  const setSelectedHostId = useLayoutStore((s) => s.setSelectedHostId)
  const setAddHostOpen = useLayoutStore((s) => s.setAddHostOpen)
  const [form, setForm] = useState<NewHostDto>(emptyForm)
  const iconInputRef = useRef<HTMLInputElement>(null)

  const keys = useQuery({
    queryKey: ["keys"],
    queryFn: () => ipc.keysList(),
  })

  const create = useMutation({
    mutationFn: () => {
      const payload: NewHostDto = {
        ...form,
        password: form.authMethod === "password" ? form.password : null,
        sshKeyId:
          form.authMethod === "key"
            ? form.sshKeyId && form.sshKeyId.length > 0
              ? form.sshKeyId
              : AUTO_KEY
            : null,
      }
      return ipc.hostsCreate(payload)
    },
    onSuccess: async (id) => {
      setForm(emptyForm())
      setAddHostOpen(false)
      setSelectedHostId(id)
      await qc.invalidateQueries({ queryKey: ["hosts"] })
      onDone?.()
    },
  })

  async function onIconPicked(file: File | undefined) {
    if (!file || !file.type.startsWith("image/")) return
    try {
      const icon = await fileToIconDataUrl(file)
      setForm((f) => ({ ...f, icon }))
    } catch {
      /* ignore bad files */
    }
  }

  const keyValue = form.sshKeyId && form.sshKeyId.length > 0 ? form.sshKeyId : AUTO_KEY

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

      <div className="space-y-1.5">
        <div className="text-muted-foreground text-xs font-medium">Auth method</div>
        <Select
          value={form.authMethod}
          onValueChange={(v) => {
            if (!v) return
            setForm({
              ...form,
              authMethod: v,
              sshKeyId: v === "key" ? (form.sshKeyId ?? AUTO_KEY) : null,
              password: v === "password" ? (form.password ?? "") : "",
            })
          }}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Auth method">
              {(v) =>
                v === "password"
                  ? "Password"
                  : v === "key"
                    ? "SSH Key"
                    : v === "agent"
                      ? "Agent"
                      : "Auth method"
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="password">Password</SelectItem>
            <SelectItem value="key">SSH Key</SelectItem>
            <SelectItem value="agent">Agent</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {form.authMethod === "password" && (
        <input
          type="password"
          className="border-input bg-background w-full rounded-md border px-2 py-1.5 text-sm"
          placeholder="Password"
          value={form.password ?? ""}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
        />
      )}

      {form.authMethod === "key" && (
        <div className="space-y-1.5">
          <div className="text-muted-foreground text-xs font-medium">SSH Key</div>
          <Select
            value={keyValue}
            onValueChange={(v) => {
              if (!v) return
              setForm({ ...form, sshKeyId: v })
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Choose key">
                {(v) => {
                  if (v === AUTO_KEY || !v) return "Auto key (latest in vault)"
                  const k = (keys.data ?? []).find((x) => x.id === v)
                  return k ? `${k.name} · ${k.keyType}` : "Choose key"
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={AUTO_KEY}>Auto key (latest in vault)</SelectItem>
              {(keys.data ?? []).map((k) => (
                <SelectItem key={k.id} value={k.id}>
                  {k.name} · {k.keyType}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {(keys.data?.length ?? 0) === 0 && (
            <p className="text-muted-foreground text-xs">
              No keys in vault yet — import one in Key Manager, or Auto will fail until a key
              exists.
            </p>
          )}
        </div>
      )}

      <div className="space-y-1.5">
        <div className="text-muted-foreground text-xs font-medium">Server icon</div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            className={cn(
              "border-input bg-background relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md border",
              !form.icon && "text-muted-foreground hover:bg-muted/40",
            )}
            style={
              form.icon
                ? undefined
                : { backgroundColor: form.color ?? HOST_COLOR_PRESETS[0] }
            }
            onClick={() => iconInputRef.current?.click()}
            title="Upload icon"
          >
            {form.icon ? (
              <img src={form.icon} alt="" className="size-full object-cover" />
            ) : (
              <ImagePlus className="size-5 text-white/90" />
            )}
          </button>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full justify-start"
              onClick={() => iconInputRef.current?.click()}
            >
              Upload image
            </Button>
            {form.icon && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-muted-foreground h-7 justify-start px-2"
                onClick={() => setForm({ ...form, icon: null })}
              >
                <X className="size-3.5" />
                Remove icon
              </Button>
            )}
          </div>
          <input
            ref={iconInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={(e) => {
              void onIconPicked(e.target.files?.[0])
              e.target.value = ""
            }}
          />
        </div>
      </div>

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
      {create.isError && (
        <p className="text-destructive text-xs">
          {(create.error as Error)?.message ?? "Could not add host"}
        </p>
      )}
    </div>
  )
}
