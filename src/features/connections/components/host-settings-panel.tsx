import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Check,
  Eye,
  EyeOff,
  Globe,
  ImagePlus,
  Info,
  KeyRound,
  Palette,
  Save,
  Server,
  ShieldCheck,
  X,
} from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { HOST_COLOR_PRESETS } from "@/features/connections/host-appearance"
import { ipc } from "@/lib/ipc/commands"
import type { HostDto } from "@/lib/ipc/types"
import { cn } from "@/lib/utils"
const AUTO_KEY = "auto"
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
export function HostSettingsPanel({ hostId }: { hostId: string }) {
  const qc = useQueryClient()
  const iconInputRef = useRef<HTMLInputElement>(null)
  const [savedSuccess, setSavedSuccess] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const hostQuery = useQuery({
    queryKey: ["host", hostId],
    queryFn: () => ipc.hostsGet(hostId),
    enabled: !!hostId,
  })
  const keysQuery = useQuery({
    queryKey: ["keys"],
    queryFn: () => ipc.keysList(),
  })
  const workspacesQuery = useQuery<{ id: string; name: string }[]>({
    queryKey: ["settings", "workspaces"],
    queryFn: async () =>
      ((await ipc.settingsGet("workspaces")) as { id: string; name: string }[]) ?? [
        { id: "default", name: "Infrastructure Workspace" },
      ],
  })
  const hostWorkspacesQuery = useQuery<Record<string, string>>({
    queryKey: ["settings", "hostWorkspaces"],
    queryFn: async () =>
      ((await ipc.settingsGet("hostWorkspaces")) as Record<string, string>) ?? {},
  })
  const [form, setForm] = useState<HostDto | null>(null)
  const [assignedWsId, setAssignedWsId] = useState<string>("default")
  useEffect(() => {
    if (hostQuery.data) {
      setForm(hostQuery.data)
    }
  }, [hostQuery.data])
  useEffect(() => {
    if (hostWorkspacesQuery.data) {
      setAssignedWsId(hostWorkspacesQuery.data[hostId] ?? "default")
    }
  }, [hostWorkspacesQuery.data, hostId])
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!form) return
      const payload: HostDto = {
        ...form,
        password: form.authMethod === "password" ? form.password : null,
        sshKeyId:
          form.authMethod === "key"
            ? form.sshKeyId && form.sshKeyId.length > 0
              ? form.sshKeyId
              : AUTO_KEY
            : null,
      }
      await ipc.hostsUpdate(payload)
      const hostWs =
        ((await ipc.settingsGet("hostWorkspaces")) as Record<string, string>) ?? {}
      hostWs[hostId] = assignedWsId
      await ipc.settingsSet("hostWorkspaces", hostWs)
    },
    onSuccess: async () => {
      setSavedSuccess(true)
      await qc.invalidateQueries({ queryKey: ["hosts"] })
      await qc.invalidateQueries({ queryKey: ["host", hostId] })
      await qc.invalidateQueries({ queryKey: ["settings"] })
      setTimeout(() => setSavedSuccess(false), 3000)
    },
  })
  async function onIconPicked(file: File | undefined) {
    if (!file || !file.type.startsWith("image/")) return
    try {
      const icon = await fileToIconDataUrl(file)
      setForm((f) => (f ? { ...f, icon } : f))
    } catch {
      /* ignore bad files */
    }
  }
  if (hostQuery.isLoading || !form) {
    return (
      <div className="flex h-full flex-1 items-center justify-center p-6 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <Server className="size-3.5 animate-pulse text-primary" />
          <span>Loading configuration...</span>
        </div>
      </div>
    )
  }
  const keyValue = form.sshKeyId && form.sshKeyId.length > 0 ? form.sshKeyId : AUTO_KEY
  return (
    <div className="flex h-full flex-1 flex-col overflow-y-auto bg-background/30 p-4 md:p-6">
      <div className="mx-auto w-full max-w-4xl space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/50 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary border border-primary/20">
              <Server className="size-4" />
            </div>
            <div>
              <h1 className="text-sm font-semibold text-foreground">Server Settings</h1>
              <p className="text-[11px] text-muted-foreground">
                Configure connection address, authentication credentials, and tile style
              </p>
            </div>
          </div>
          <Button
            size="sm"
            disabled={saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
            className="h-8 px-4 text-xs gap-1.5 shadow-sm"
          >
            {savedSuccess ? (
              <>
                <Check className="size-3.5 text-emerald-400" />
                Saved!
              </>
            ) : (
              <>
                <Save className="size-3.5" />
                {saveMutation.isPending ? "Saving..." : "Save Changes"}
              </>
            )}
          </Button>
        </div>
        {/* Alerts */}
        {savedSuccess && (
          <div className="rounded-md bg-emerald-500/10 border border-emerald-500/30 px-3 py-2 text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
            <ShieldCheck className="size-4 shrink-0 text-emerald-500" />
            <span>Server settings updated successfully!</span>
          </div>
        )}
        {saveMutation.isError && (
          <div className="rounded-md bg-destructive/10 border border-destructive/30 px-3 py-2 text-xs text-destructive flex items-center gap-2">
            <X className="size-4 shrink-0" />
            <span>{(saveMutation.error as Error)?.message ?? "Failed to save settings"}</span>
          </div>
        )}
        {/* 2-Column Responsive Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Left Column: General Info & Credentials */}
          <div className="space-y-4">
            {/* General Info Card */}
            <div className="rounded-xl border border-border/70 bg-card/60 p-4 space-y-3.5 shadow-2xs">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                <Globe className="size-3.5 text-primary" />
                <span>General Information</span>
              </div>
              <div className="space-y-3">
                <div>
                  <Label htmlFor="host-label" className="text-[11px] text-muted-foreground font-medium">
                    Display Name
                  </Label>
                  <Input
                    id="host-label"
                    className="h-8 text-xs mt-1"
                    placeholder="e.g. Production Web Server"
                    value={form.label}
                    onChange={(e) => setForm({ ...form, label: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2">
                    <Label htmlFor="host-address" className="text-[11px] text-muted-foreground font-medium">
                      Hostname / IP
                    </Label>
                    <Input
                      id="host-address"
                      className="h-8 text-xs font-mono mt-1"
                      placeholder="192.168.1.1"
                      value={form.hostname}
                      onChange={(e) => setForm({ ...form, hostname: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label htmlFor="host-port" className="text-[11px] text-muted-foreground font-medium">
                      Port
                    </Label>
                    <Input
                      id="host-port"
                      type="number"
                      className="h-8 text-xs font-mono mt-1"
                      value={form.port}
                      onChange={(e) => setForm({ ...form, port: Number(e.target.value) || 22 })}
                    />
                  </div>
                </div>
                <div>
                  <Label htmlFor="host-user" className="text-[11px] text-muted-foreground font-medium">
                    SSH Username
                  </Label>
                  <Input
                    id="host-user"
                    className="h-8 text-xs font-mono mt-1"
                    placeholder="root"
                    value={form.username ?? ""}
                    onChange={(e) => setForm({ ...form, username: e.target.value })}
                  />
                </div>
                <div>
                  <Label className="text-[11px] text-muted-foreground font-medium">
                    Assigned Workspace
                  </Label>
                  <Select
                    value={assignedWsId}
                    onValueChange={(v) => v && setAssignedWsId(v)}
                  >
                    <SelectTrigger className="h-8 text-xs mt-1">
                      <SelectValue placeholder="Select Workspace">
                        {(v) =>
                          (workspacesQuery.data ?? []).find((w) => w.id === v)?.name ??
                          "Infrastructure Workspace"
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {(workspacesQuery.data ?? [
                        { id: "default", name: "Infrastructure Workspace" },
                      ]).map((w) => (
                        <SelectItem key={w.id} value={w.id} className="text-xs">
                          {w.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            {/* Authentication Card */}
            <div className="rounded-xl border border-border/70 bg-card/60 p-4 space-y-3.5 shadow-2xs">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                <KeyRound className="size-3.5 text-primary" />
                <span>Authentication & Security</span>
              </div>
              <div className="space-y-3">
                <div>
                  <Label className="text-[11px] text-muted-foreground font-medium">
                    Auth Method
                  </Label>
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
                    <SelectTrigger className="h-8 text-xs mt-1">
                      <SelectValue placeholder="Auth method">
                        {(v) =>
                          v === "password"
                            ? "Password Authentication"
                            : v === "key"
                              ? "SSH Key Pair"
                              : v === "agent"
                                ? "SSH Agent"
                                : "Select Auth"
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="password" className="text-xs">Password Authentication</SelectItem>
                      <SelectItem value="key" className="text-xs">SSH Key Pair</SelectItem>
                      <SelectItem value="agent" className="text-xs">SSH Agent</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {form.authMethod === "password" && (
                  <div>
                    <Label htmlFor="host-password" className="text-[11px] text-muted-foreground font-medium">
                      Server Password
                    </Label>
                    <div className="relative mt-1">
                      <Input
                        id="host-password"
                        type={showPassword ? "text" : "password"}
                        className="h-8 text-xs pr-8 font-mono"
                        placeholder="Enter password"
                        value={form.password ?? ""}
                        onChange={(e) => setForm({ ...form, password: e.target.value })}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        className="absolute right-1 top-1 size-6 text-muted-foreground hover:text-foreground"
                        onClick={() => setShowPassword(!showPassword)}
                        title={showPassword ? "Hide" : "Show"}
                      >
                        {showPassword ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
                      </Button>
                    </div>
                  </div>
                )}
                {form.authMethod === "key" && (
                  <div>
                    <Label className="text-[11px] text-muted-foreground font-medium">
                      SSH Key Selection
                    </Label>
                    <Select
                      value={keyValue}
                      onValueChange={(v) => {
                        if (!v) return
                        setForm({ ...form, sshKeyId: v })
                      }}
                    >
                      <SelectTrigger className="h-8 text-xs mt-1">
                        <SelectValue placeholder="Choose key">
                          {(v) => {
                            if (v === AUTO_KEY || !v) return "Auto Key (latest in vault)"
                            const k = (keysQuery.data ?? []).find((x) => x.id === v)
                            return k ? `${k.name} · ${k.keyType}` : "Choose key"
                          }}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={AUTO_KEY} className="text-xs">Auto Key (latest in vault)</SelectItem>
                        {(keysQuery.data ?? []).map((k) => (
                          <SelectItem key={k.id} value={k.id} className="text-xs">
                            {k.name} · {k.keyType}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            </div>
          </div>
          {/* Right Column: Style & Quick Overview */}
          <div className="space-y-4">
            {/* Tile Style & Icon Card */}
            <div className="rounded-xl border border-border/70 bg-card/60 p-4 space-y-4 shadow-2xs">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                <Palette className="size-3.5 text-primary" />
                <span>Tile Appearance</span>
              </div>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-[11px] text-muted-foreground font-medium">
                      Server Icon Image
                    </Label>
                    <p className="text-[10px] text-muted-foreground">Upload a custom image logo</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className={cn(
                        "border-input bg-background relative flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border shadow-2xs transition-transform hover:scale-105",
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
                        <ImagePlus className="size-4 text-white/90" />
                      )}
                    </button>
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      className="h-7 text-[11px] px-2.5"
                      onClick={() => iconInputRef.current?.click()}
                    >
                      Upload
                    </Button>
                    {form.icon && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        className="h-7 text-[11px] px-1.5 text-muted-foreground hover:text-destructive"
                        onClick={() => setForm({ ...form, icon: null })}
                      >
                        <X className="size-3.5" />
                      </Button>
                    )}
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
                <div>
                  <Label className="text-[11px] text-muted-foreground font-medium block mb-2">
                    Accent Color Presets
                  </Label>
                  <div className="flex flex-wrap gap-2.5">
                    {HOST_COLOR_PRESETS.map((c) => {
                      const isSelected = form.color === c
                      return (
                        <button
                          key={c}
                          type="button"
                          aria-label={`Color ${c}`}
                          className={cn(
                            "relative flex size-7 items-center justify-center rounded-md shadow-2xs transition-transform hover:scale-110",
                            isSelected && "ring-2 ring-primary ring-offset-2 ring-offset-background scale-105",
                          )}
                          style={{ backgroundColor: c }}
                          onClick={() => setForm({ ...form, color: c })}
                        >
                          {isSelected && <Check className="size-3.5 text-white drop-shadow" />}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>
            {/* Quick Connection Target Card */}
            <div className="rounded-xl border border-border/70 bg-card/60 p-4 space-y-3 shadow-2xs">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                <Info className="size-3.5 text-primary" />
                <span>Connection Target Summary</span>
              </div>
              <div className="rounded-lg bg-muted/40 p-3 space-y-1.5 font-mono text-xs border border-border/40">
                <div className="flex items-center justify-between text-muted-foreground text-[11px]">
                  <span>Target SSH Spec</span>
                  <span className="text-emerald-500 font-sans font-medium">Ready</span>
                </div>
                <div className="text-foreground font-bold truncate">
                  ssh {form.username ?? "root"}@{form.hostname}:{form.port}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}