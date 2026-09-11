import { useEffect, useState } from "react"
import {
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  ShieldAlert,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { ipc } from "@/lib/ipc/commands"

export interface TunnelConfig {
  id?: string
  hostId: string
  label: string
  kind: "local" | "remote" | "dynamic"
  bindAddr: string
  bindPort: number
  destAddr: string
  destPort: number
  autoStart: boolean
}

interface TunnelDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  hostId: string
  initialData?: Partial<TunnelConfig> | null
  existingForwards?: TunnelConfig[]
  onSave: (config: TunnelConfig) => Promise<void>
}

export function TunnelDialog({
  open,
  onOpenChange,
  hostId,
  initialData,
  existingForwards = [],
  onSave,
}: TunnelDialogProps) {
  const [label, setLabel] = useState("")
  const [kind, setKind] = useState<"local" | "remote" | "dynamic">("local")
  const [bindAddr, setBindAddr] = useState("127.0.0.1")
  const [bindPort, setBindPort] = useState<number>(8080)
  const [destAddr, setDestAddr] = useState("127.0.0.1")
  const [destPort, setDestPort] = useState<number>(80)
  const [autoStart, setAutoStart] = useState(false)

  const [checkingPort, setCheckingPort] = useState(false)
  const [portAvailable, setPortAvailable] = useState<boolean | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setLabel(initialData?.label ?? "")
      setKind(initialData?.kind ?? "local")
      setBindAddr(initialData?.bindAddr ?? "127.0.0.1")
      setBindPort(initialData?.bindPort ?? 8080)
      setDestAddr(initialData?.destAddr ?? "127.0.0.1")
      setDestPort(initialData?.destPort ?? 80)
      setAutoStart(initialData?.autoStart ?? false)
      setPortAvailable(null)
    }
  }, [open, initialData])

  useEffect(() => {
    if (!open || !bindPort || bindPort < 1 || bindPort > 65535) {
      setPortAvailable(null)
      return
    }

    let isMounted = true
    setCheckingPort(true)

    const timer = setTimeout(async () => {
      try {
        const free = await ipc.portCheckAvailable(bindAddr, bindPort)
        if (isMounted) {
          setPortAvailable(free)
        }
      } catch {
        if (isMounted) {
          setPortAvailable(true)
        }
      } finally {
        if (isMounted) {
          setCheckingPort(false)
        }
      }
    }, 300)

    return () => {
      isMounted = false
      clearTimeout(timer)
    }
  }, [open, bindAddr, bindPort])

  const isDuplicatePort = existingForwards.some(
    (f) =>
      f.id !== initialData?.id &&
      f.bindAddr === bindAddr &&
      Number(f.bindPort) === Number(bindPort)
  )

  const isPrivilegedPort = bindPort < 1024 && bindPort > 0

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!bindPort || isDuplicatePort || portAvailable === false) {
      return
    }

    setSaving(true)
    try {
      await onSave({
        id: initialData?.id,
        hostId,
        label: label.trim() || `${kind.toUpperCase()} :${bindPort}`,
        kind,
        bindAddr,
        bindPort: Number(bindPort),
        destAddr: kind === "dynamic" ? "" : destAddr,
        destPort: kind === "dynamic" ? 0 : Number(destPort),
        autoStart,
      })
      onOpenChange(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-md sm:max-w-[460px]">
        <form onSubmit={handleFormSubmit}>
          <DialogHeader>
            <DialogTitle>
              {initialData?.id ? "Edit SSH Tunnel" : "Add SSH Tunnel"}
            </DialogTitle>
            <DialogDescription>
              Configure port forwarding options between your local machine and
              remote host.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4 text-sm">
            <div className="grid gap-1.5">
              <Label htmlFor="label">Tunnel Label</Label>
              <Input
                id="label"
                placeholder="e.g. Web App Forward"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="kind">Forwarding Type</Label>
              <Select
                value={kind}
                onValueChange={(val) => {
                  if (val) setKind(val as "local" | "remote" | "dynamic")
                }}
              >
                <SelectTrigger id="kind" className="w-full">
                  <SelectValue placeholder="Select forwarding type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="local">
                    Local Forward (-L) &mdash; Local Port &rarr; Remote Host
                  </SelectItem>
                  <SelectItem value="remote">
                    Remote Forward (-R) &mdash; Remote Port &rarr; Local Host
                  </SelectItem>
                  <SelectItem value="dynamic">
                    Dynamic Proxy (-D) &mdash; SOCKS5 Proxy
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="bindAddr">Bind Address</Label>
                <Input
                  id="bindAddr"
                  value={bindAddr}
                  onChange={(e) => setBindAddr(e.target.value)}
                  placeholder="127.0.0.1"
                />
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="bindPort">Bind Port</Label>
                <Input
                  id="bindPort"
                  type="number"
                  min={1}
                  max={65535}
                  value={bindPort}
                  onChange={(e) => setBindPort(Number(e.target.value))}
                />
              </div>
            </div>

            {/* Port status alerts */}
            {checkingPort && (
              <div className="flex items-center gap-2 rounded-md bg-muted p-2.5 text-xs text-muted-foreground">
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                Checking local port availability...
              </div>
            )}

            {!checkingPort && portAvailable === false && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/20 bg-destructive/10 p-2.5 text-xs text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <strong className="font-semibold">
                    Port {bindPort} is in use!
                  </strong>
                  <p className="mt-0.5 opacity-90">
                    This port is currently bound by another process on your
                    machine.
                  </p>
                </div>
              </div>
            )}

            {isDuplicatePort && (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/20 bg-amber-500/10 p-2.5 text-xs text-amber-500">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <strong className="font-semibold">Port Conflict:</strong>
                  <p className="mt-0.5 opacity-90">
                    Port {bindPort} is already assigned to another tunnel on
                    this host.
                  </p>
                </div>
              </div>
            )}

            {isPrivilegedPort &&
              !isDuplicatePort &&
              portAvailable !== false && (
                <div className="flex items-start gap-2 rounded-md border border-sky-500/20 bg-sky-500/10 p-2.5 text-xs text-sky-400">
                  <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    Privileged ports (&lt;1024) may require administrative
                    privileges.
                  </span>
                </div>
              )}

            {!checkingPort && portAvailable === true && !isDuplicatePort && (
              <div className="flex items-center gap-2 rounded-md border border-emerald-500/20 bg-emerald-500/10 p-2.5 text-xs text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                Port {bindPort} is available.
              </div>
            )}

            {kind !== "dynamic" && (
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="destAddr">Destination Host</Label>
                  <Input
                    id="destAddr"
                    value={destAddr}
                    onChange={(e) => setDestAddr(e.target.value)}
                    placeholder="127.0.0.1"
                  />
                </div>

                <div className="grid gap-1.5">
                  <Label htmlFor="destPort">Destination Port</Label>
                  <Input
                    id="destPort"
                    type="number"
                    min={1}
                    max={65535}
                    value={destPort}
                    onChange={(e) => setDestPort(Number(e.target.value))}
                  />
                </div>
              </div>
            )}

            <div className="flex items-center justify-between rounded-md border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="autoStart" className="cursor-pointer">
                  Auto-start on connect
                </Label>
                <p className="text-xs text-muted-foreground">
                  Automatically start this tunnel when connected to the server.
                </p>
              </div>
              <Switch
                id="autoStart"
                checked={autoStart}
                onCheckedChange={setAutoStart}
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                saving ||
                !bindPort ||
                isDuplicatePort ||
                portAvailable === false
              }
            >
              {saving
                ? "Saving..."
                : initialData?.id
                  ? "Save Changes"
                  : "Create Tunnel"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
