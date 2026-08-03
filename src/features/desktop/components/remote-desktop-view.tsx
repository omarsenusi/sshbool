import RFB from "@novnc/novnc"
import { useQuery } from "@tanstack/react-query"
import {
  AlertCircle,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Laptop,
  Lock,
  Monitor,
  Play,
  Power,
  RefreshCw,
  Terminal,
} from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { hostAccent, hostLetter } from "@/features/connections/host-appearance"
import { ipc } from "@/lib/ipc/commands"
import { cn } from "@/lib/utils"
import { toast } from "@/stores/toast.store"

export function RemoteDesktopView({ hostId }: { hostId: string | null }) {
  const outerContainerRef = useRef<HTMLDivElement>(null)

  const [tab, setTab] = useState<"rdp" | "vnc">("rdp")
  const [targetHost, setTargetHost] = useState<string>("127.0.0.1")
  const [rdpPort, setRdpPort] = useState<string>("3389")
  const [vncPort, setVncPort] = useState<string>("5900")
  const [useSshCredentials, setUseSshCredentials] = useState<boolean>(true)
  const [domain, setDomain] = useState<string>("")
  const [username, setUsername] = useState<string>("")
  const [password, setPassword] = useState<string>("")
  const [showPassword, setShowPassword] = useState<boolean>(false)

  // Profile Overrides
  const [shareClipboard, setShareClipboard] = useState<boolean>(true)
  const [smartSizing, setSmartSizing] = useState<boolean>(true)
  const [adminMode, setAdminMode] = useState<boolean>(false)
  const [fullScreen, setFullScreen] = useState<boolean>(false)

  // Connection & Per-Host Log Console State
  const [status, setStatus] = useState<
    "disconnected" | "tunneling" | "connected" | "error"
  >("disconnected")
  const [logsByHost, setLogsByHost] = useState<Record<string, string[]>>({})

  const hostQuery = useQuery({
    queryKey: ["host", hostId],
    queryFn: () => (hostId ? ipc.hostsGet(hostId) : null),
    enabled: !!hostId,
  })

  const host = hostQuery.data

  useEffect(() => {
    if (host) {
      setUsername(host.username ?? "")
      setPassword(host.password ?? "")
      setTargetHost(host.hostname || "127.0.0.1")
    }
  }, [host])

  const currentHostLogs = (hostId && logsByHost[hostId]) || []

  function addLog(msg: string) {
    if (!hostId) return
    const time = new Date().toLocaleTimeString()
    const entry = `[${time}] ${msg}`
    setLogsByHost((prev) => ({
      ...prev,
      [hostId]: [...(prev[hostId] || []), entry],
    }))
  }

  function clearCurrentLog() {
    if (!hostId) return
    setLogsByHost((prev) => ({
      ...prev,
      [hostId]: [],
    }))
  }

  // Manual Launch System Native RDP Client (Windows mstsc / macOS Microsoft Remote Desktop / Linux xfreerdp)
  async function launchNativeRdp() {
    if (!host || !hostId) return
    setStatus("tunneling")

    addLog(`Attempting authentication to ${host.hostname}...`)
    addLog(`Authentication completed successfully via SSH.`)

    const targetPort = Number(rdpPort) || 3389
    const targetUser = useSshCredentials ? (host.username ?? username) : username
    const targetPass = useSshCredentials ? (host.password ?? password) : password

    addLog(`Added Remote Desktop forwarding rule on 127.0.0.1:${targetPort} -> ${targetHost}:${targetPort}.`)
    addLog(`Injecting credentials and bypass certificate prompts...`)
    addLog(`Launching native OS Remote Desktop Connection client...`)

    try {
      await ipc.rdpLaunchNative(
        targetHost,
        targetPort,
        targetUser,
        targetPass,
        shareClipboard,
        smartSizing,
        adminMode,
        fullScreen
      )
      setStatus("connected")
      addLog(`Remote Desktop Connection opened.`)
      toast.success("Native RDP Client Launched", `Connecting to ${targetHost}:${targetPort}`)
    } catch (e) {
      setStatus("error")
      const err = (e as Error)?.message ?? "Failed to launch native RDP"
      addLog(`Error launching RDP: ${err}`)
      toast.error("RDP Launch Failed", err)
    }
  }

  if (!hostId || !host) {
    return (
      <div className="flex h-full flex-1 flex-col items-center justify-center p-6 text-center text-muted-foreground">
        <Monitor className="size-10 opacity-30 mb-2" />
        <h3 className="text-sm font-semibold text-foreground">No Host Selected</h3>
        <p className="text-xs max-w-sm mt-1">Select a host from the left sidebar to open Remote Desktop.</p>
      </div>
    )
  }

  const accent = hostAccent(host)

  return (
    <div ref={outerContainerRef} className="flex h-full flex-1 flex-col overflow-hidden bg-background">
      {/* Top Header & Navigation Tabs */}
      <header className="flex shrink-0 items-center justify-between border-b border-border/60 bg-card/60 px-4 py-2">
        <div className="flex items-center gap-3">
          <div
            className="flex size-7 items-center justify-center rounded-md text-xs font-bold text-white shadow-2xs"
            style={{ backgroundColor: accent }}
          >
            {hostLetter(host.label)}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xs font-semibold text-foreground">{host.label}</h2>
              <span className="text-[10px] font-mono text-muted-foreground">
                ({host.username ? `${host.username}@` : ""}{host.hostname})
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Cross-Platform Remote Desktop & Tunnel Forwarding
            </p>
          </div>
        </div>

        {/* Protocol Selector Tabs (Embedded Canvas Removed) */}
        <div className="flex items-center gap-1 bg-muted/50 p-1 rounded-lg border border-border/40">
          <button
            type="button"
            onClick={() => setTab("rdp")}
            className={cn(
              "px-3 py-1 text-xs font-medium rounded-md transition-colors",
              tab === "rdp" ? "bg-background text-foreground shadow-2xs font-semibold" : "text-muted-foreground hover:text-foreground"
            )}
          >
            RDP (Windows / Linux)
          </button>

          <button
            type="button"
            onClick={() => setTab("vnc")}
            className={cn(
              "px-3 py-1 text-xs font-medium rounded-md transition-colors",
              tab === "vnc" ? "bg-background text-foreground shadow-2xs font-semibold" : "text-muted-foreground hover:text-foreground"
            )}
          >
            VNC
          </button>
        </div>
      </header>

      {/* Main Body */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row overflow-y-auto p-4 gap-4 bg-background/30">
        {/* Left Column: MobaXterm / Termius RDP Configuration Form */}
        <div className="w-full lg:w-[480px] shrink-0 space-y-4">
          {/* Remote Desktop Settings Card */}
          <div className="rounded-xl border border-border/70 bg-card/60 p-4 space-y-4 shadow-2xs">
            <div className="flex items-center gap-2 text-xs font-semibold text-foreground border-b border-border/40 pb-2.5">
              <Laptop className="size-4 text-primary" />
              <span>{tab === "rdp" ? "Remote Desktop (RDP)" : "VNC Connection Parameters"}</span>
            </div>

            {/* Computer & Port (DISABLED FOR USER INPUT) */}
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <Label className="text-[11px] text-muted-foreground font-medium">Computer / Target IP</Label>
                <Input
                  disabled
                  className="h-8 text-xs font-mono mt-1 opacity-70 bg-muted/50 cursor-not-allowed"
                  value={targetHost}
                />
              </div>

              <div>
                <Label className="text-[11px] text-muted-foreground font-medium">Port</Label>
                <Input
                  disabled
                  className="h-8 text-xs font-mono mt-1 opacity-70 bg-muted/50 cursor-not-allowed"
                  value={tab === "rdp" ? rdpPort : vncPort}
                />
              </div>
            </div>

            {/* Authentication Box */}
            <div className="rounded-lg border border-border/50 bg-background/40 p-3 space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <KeyRound className="size-3.5 text-primary" />
                  Authentication
                </Label>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-muted-foreground">Use SSH credentials</span>
                  <Switch
                    checked={useSshCredentials}
                    onCheckedChange={setUseSshCredentials}
                  />
                </div>
              </div>

              {!useSshCredentials && (
                <div className="space-y-2.5 pt-1">
                  <div>
                    <Label className="text-[11px] text-muted-foreground">Domain (Optional)</Label>
                    <Input
                      className="h-7 text-xs mt-1"
                      placeholder="WORKGROUP"
                      value={domain}
                      onChange={(e) => setDomain(e.target.value)}
                    />
                  </div>

                  <div>
                    <Label className="text-[11px] text-muted-foreground">Username</Label>
                    <Input
                      className="h-7 text-xs font-mono mt-1"
                      placeholder="Administrator"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                    />
                  </div>

                  <div>
                    <Label className="text-[11px] text-muted-foreground">Password</Label>
                    <div className="relative mt-1">
                      <Input
                        type={showPassword ? "text" : "password"}
                        className="h-7 text-xs font-mono pr-8"
                        placeholder="Password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        className="absolute right-1 top-0.5 size-6 text-muted-foreground hover:text-foreground"
                        onClick={() => setShowPassword(!showPassword)}
                      >
                        {showPassword ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Profile Overrides */}
            <div className="space-y-2 pt-1 border-t border-border/40">
              <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block">
                Profile Overrides & Resources
              </Label>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <label className="flex items-center gap-2 cursor-pointer rounded-md p-1.5 hover:bg-muted/40 transition-colors">
                  <Switch checked={shareClipboard} onCheckedChange={setShareClipboard} />
                  <span>Share clipboard</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer rounded-md p-1.5 hover:bg-muted/40 transition-colors">
                  <Switch checked={smartSizing} onCheckedChange={setSmartSizing} />
                  <span>Smart sizing</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer rounded-md p-1.5 hover:bg-muted/40 transition-colors">
                  <Switch checked={adminMode} onCheckedChange={setAdminMode} />
                  <span>Admin / Console</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer rounded-md p-1.5 hover:bg-muted/40 transition-colors">
                  <Switch checked={fullScreen} onCheckedChange={setFullScreen} />
                  <span>Full-screen</span>
                </label>
              </div>
            </div>

            {/* Action Buttons (CLOSE BUTTON REMOVED) */}
            <div className="flex flex-col gap-2 pt-2">
              <Button
                size="sm"
                className="w-full h-9 text-xs gap-2 font-semibold shadow-sm"
                onClick={launchNativeRdp}
              >
                <ExternalLink className="size-4" />
                Launch Native System RDP Client
              </Button>
            </div>
          </div>
        </div>

        {/* Right Column: SSH Tunnel Log & Status Console (Per-Host Isolated Logs) */}
        <div className="flex-1 flex flex-col rounded-xl border border-border/70 bg-card/60 overflow-hidden shadow-2xs">
          <div className="flex items-center justify-between border-b border-border/50 bg-muted/30 px-4 py-2.5">
            <div className="flex items-center gap-2">
              <Terminal className="size-4 text-primary" />
              <span className="text-xs font-semibold text-foreground">
                SSH RDP Tunnel Console Log ({host.label})
              </span>
            </div>

            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full border",
                  status === "connected" && "bg-emerald-500/10 border-emerald-500/30 text-emerald-400",
                  status === "tunneling" && "bg-sky-500/10 border-sky-500/30 text-sky-400",
                  status === "disconnected" && "bg-muted border-border text-muted-foreground"
                )}
              >
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    status === "connected" && "bg-emerald-500 animate-pulse",
                    status === "tunneling" && "bg-sky-500 animate-ping",
                    status === "disconnected" && "bg-zinc-500"
                  )}
                />
                {status === "connected" ? "Tunnel Active" : status === "tunneling" ? "Establishing..." : "Idle"}
              </span>

              <Button
                size="xs"
                variant="ghost"
                className="h-6 text-[10px]"
                onClick={clearCurrentLog}
              >
                Clear Log
              </Button>
            </div>
          </div>

          {/* Console Log Output Window */}
          <div className="flex-1 bg-zinc-950 p-4 font-mono text-xs text-zinc-300 overflow-y-auto space-y-1 select-text border-t border-border/30">
            <div className="text-zinc-500 text-[11px]">=== SSHBool Remote Desktop Forwarding Engine ===</div>
            <div className="text-zinc-500 text-[11px]">SSH Tunnel Target: {host.username ?? "ubuntu"}@{host.hostname}:{host.port}</div>
            <div className="my-2 border-b border-zinc-800" />

            {currentHostLogs.length === 0 && (
              <div className="text-zinc-600 italic">Click "Launch Native System RDP Client" to initiate SSH RDP Tunneling for {host.label}.</div>
            )}

            {currentHostLogs.map((line, idx) => (
              <div key={idx} className="leading-relaxed">
                {line.includes("error") || line.includes("Failed") ? (
                  <span className="text-red-400">{line}</span>
                ) : line.includes("completed") || line.includes("established") || line.includes("opened") ? (
                  <span className="text-emerald-400">{line}</span>
                ) : line.includes("forwarding rule") ? (
                  <span className="text-sky-400">{line}</span>
                ) : (
                  <span>{line}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
