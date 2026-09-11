import { useQuery } from "@tanstack/react-query"
import {
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Laptop,
  Monitor,
  MonitorPlay,
  PowerOff,
  TerminalSquare,
} from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { hostAccent, hostLetter } from "@/features/connections/host-appearance"
import { ipc } from "@/lib/ipc/commands"
import { cn } from "@/lib/utils"
import { toast } from "@/stores/toast.store"
import {
  PASSWORD_PLACEHOLDER,
  resolveVaultPassword,
} from "@/features/desktop/credentials"
import { EmbeddedDesktopCanvas } from "./embedded-desktop-canvas"
import { GuacamoleDesktopCanvas } from "./guacamole-desktop-canvas"

/**
 * ============================================================================
 * [UNDER DEVELOPMENT / ميزة قيد التطوير]
 * Embedded In-App Desktop (Canvas / Guacamole / noVNC):
 * تم إخفاء ميزة تشغيل سطح المكتب داخل التطبيق (Embedded Canvas) مؤقتاً لأنها لا تزال
 * قيد التطوير والتحسين.
 * إذا أردت إرجاعها وتفعيلها في أي وقت، قم بتغيير القيمة أدناه إلى: `true`.
 * To re-enable the embedded desktop canvas, change the flag below to `true`.
 * ============================================================================
 */
const ENABLE_EMBEDDED_DESKTOP = false

export function RemoteDesktopView({ hostId }: { hostId: string | null }) {
  const outerContainerRef = useRef<HTMLDivElement>(null)

  const [tab, setTab] = useState<"rdp" | "vnc">("rdp")
  /** Local end of the SSH tunnel (mstsc connects here). */
  const [localEndpoint] = useState<string>("127.0.0.1")
  /** RDP service address as seen from the SSH host (usually localhost). */
  const [remoteTarget, setRemoteTarget] = useState<string>("127.0.0.1")
  const rdpPort = "3389"
  const vncPort = "5900"
  const [useSshCredentials, setUseSshCredentials] = useState<boolean>(true)
  const [domain, setDomain] = useState<string>("")
  const [username, setUsername] = useState<string>("")
  const [password, setPassword] = useState<string>("")
  const [showPassword, setShowPassword] = useState<boolean>(false)
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(true)

  // In-App Desktop Session State
  const [inAppSession, setInAppSession] = useState<{
    sessionId: string
    wsPort: number
    wsUrl: string
    protocol: "rdp" | "vnc"
    token?: string
    vncPassword?: string
    username?: string
  } | null>(null)
  const [inAppConnecting, setInAppConnecting] = useState(false)
  const [guacdSetupBusy, setGuacdSetupBusy] = useState(false)
  const [guacdSetupHint, setGuacdSetupHint] = useState<string | null>(null)
  const [activeView, setActiveView] = useState<"canvas" | "console">(
    ENABLE_EMBEDDED_DESKTOP ? "canvas" : "console"
  )

  // Profile Overrides
  const [shareClipboard, setShareClipboard] = useState<boolean>(true)
  const [smartSizing, setSmartSizing] = useState<boolean>(true)
  const [adminMode, setAdminMode] = useState<boolean>(false)
  const [resolutionMode, setResolutionMode] = useState<
    "fullscreen" | "1920x1080" | "1280x720" | "1024x768" | "custom"
  >("1280x720")
  const [customWidth, setCustomWidth] = useState<string>("1280")
  const [customHeight, setCustomHeight] = useState<string>("720")
  const [colorDepth, setColorDepth] = useState<"16" | "24" | "32">("32")
  const [performancePreset, setPerformancePreset] = useState<
    "modem" | "broadband" | "lan" | "auto"
  >("auto")

  // Connection & Per-Host Log Console State
  const [status, setStatus] = useState<
    "disconnected" | "tunneling" | "connected" | "error"
  >("disconnected")
  const [logsByHost, setLogsByHost] = useState<Record<string, string[]>>({})
  const launchingRef = useRef(false)
  const [launching, setLaunching] = useState(false)

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

  useEffect(() => {
    setInAppSession(null)
    setActiveView("console")
    setStatus("disconnected")
  }, [hostId])

  function resolveDimensions() {
    let w = 1280
    let h = 720
    if (resolutionMode === "custom") {
      w = Number(customWidth) || 1280
      h = Number(customHeight) || 720
    } else if (resolutionMode !== "fullscreen") {
      const [wStr, hStr] = resolutionMode.split("x")
      if (wStr && hStr) {
        w = Number(wStr) || 1280
        h = Number(hStr) || 720
      }
    } else if (typeof window !== "undefined") {
      w = window.innerWidth
      h = window.innerHeight
    }
    return { w, h }
  }

  async function setupGuacd(installDocker = false) {
    if (guacdSetupBusy) return
    setGuacdSetupBusy(true)
    setGuacdSetupHint(null)
    addLog(
      installDocker
        ? "Installing Docker Desktop for guacd..."
        : "Setting up guacd (Docker container)..."
    )
    try {
      const result = await ipc.desktopGuacdSetup(installDocker)
      setGuacdSetupHint(result.message)
      addLog(`guacd ready: ${result.message.split("\n")[0]}`)
      toast.success(
        "guacd Ready",
        "In-app RDP backend is available on 127.0.0.1:4822"
      )
    } catch (e) {
      const err = (e as Error)?.message ?? "Failed to set up guacd"
      setGuacdSetupHint(err)
      addLog(`guacd setup failed: ${err}`)
      toast.error("guacd Setup", err)
    } finally {
      setGuacdSetupBusy(false)
    }
  }

  async function connectInAppDesktop() {
    if (!host || !hostId || inAppConnecting) return
    setInAppConnecting(true)
    setStatus("tunneling")
    setActiveView("canvas")
    addLog(`Initiating embedded desktop session for ${host.hostname}...`)

    const targetPort =
      tab === "rdp" ? Number(rdpPort) || 3389 : Number(vncPort) || 5900
    const { w, h } = resolveDimensions()

    const manualUser = useSshCredentials
      ? (host.username ?? username)
      : username
    const manualPass =
      useSshCredentials && password !== PASSWORD_PLACEHOLDER
        ? password
        : useSshCredentials
          ? undefined
          : password

    try {
      if (tab === "rdp") {
        addLog(
          "Starting Guacamole/guacd RDP bridge (Termix-style in-app desktop)..."
        )
        const session = await ipc.desktopGuacamoleConnect(
          hostId,
          remoteTarget,
          targetPort,
          manualUser || undefined,
          manualPass || undefined,
          domain || undefined,
          useSshCredentials,
          w,
          h,
          Number(colorDepth) || 32,
          performancePreset
        )

        const wsUrl = session.wsUrl || `ws://127.0.0.1:${session.wsPort}`
        setInAppSession({
          sessionId: session.sessionId,
          wsPort: session.wsPort,
          wsUrl,
          protocol: "rdp",
          token: session.token,
          username: session.username,
        })
        addLog(`Guacamole bridge active on ${wsUrl}`)
        addLog(
          `RDP tunnel → ${session.remoteHost}:${session.remotePort} (auto-login via guacd)`
        )
        toast.success("Embedded RDP Ready", "Guacamole session active")
      } else {
        const session = await ipc.desktopInappConnect(
          hostId,
          remoteTarget,
          targetPort,
          tab
        )
        const wsUrl = session.wsUrl || `ws://127.0.0.1:${session.wsPort}`
        setInAppSession({
          sessionId: session.sessionId,
          wsPort: session.wsPort,
          wsUrl,
          protocol: "vnc",
          vncPassword:
            resolveVaultPassword(password, session.vaultPassword) || undefined,
        })
        addLog(`VNC WebSocket bridge active on ${wsUrl}`)
        toast.success("Embedded VNC Ready", "noVNC stream active")
      }

      setStatus("connected")
    } catch (e) {
      setStatus("error")
      const err = (e as Error)?.message ?? "Failed to connect in-app desktop"
      addLog(`Error connecting in-app desktop: ${err}`)
      if (tab === "rdp" && /guacd/i.test(err)) {
        setGuacdSetupHint(err)
      }
      toast.error("In-App Desktop Error", err)
    } finally {
      setInAppConnecting(false)
    }
  }

  async function disconnectInAppDesktop() {
    if (!hostId) return
    const targetPort =
      tab === "rdp" ? Number(rdpPort) || 3389 : Number(vncPort) || 5900
    try {
      await ipc.desktopInappDisconnect(hostId, targetPort)
      addLog("Embedded desktop session closed.")
    } catch (e) {
      console.error("Disconnect error:", e)
    } finally {
      setInAppSession(null)
      setStatus("disconnected")
    }
  }

  // Manual Launch System Native RDP Client (Windows mstsc / macOS Microsoft Remote Desktop / Linux xfreerdp)
  async function launchNativeRdp() {
    if (!host || !hostId || launchingRef.current) return
    launchingRef.current = true
    setLaunching(true)
    setStatus("tunneling")

    addLog(`Opening SSH session to ${host.hostname}:${host.port}...`)

    const targetPort = Number(rdpPort) || 3389
    const targetUser = useSshCredentials
      ? (host.username ?? username)
      : username
    // Native RDP resolves vault password in Rust when placeholder is sent
    const nativePass = useSshCredentials
      ? (host.password ?? password)
      : password

    let finalWidth: number | undefined
    let finalHeight: number | undefined
    const finalFullScreen = resolutionMode === "fullscreen"

    if (resolutionMode === "custom") {
      finalWidth = Number(customWidth) || 1280
      finalHeight = Number(customHeight) || 720
    } else if (resolutionMode !== "fullscreen") {
      const [wStr, hStr] = resolutionMode.split("x")
      if (wStr && hStr) {
        finalWidth = Number(wStr)
        finalHeight = Number(hStr)
      }
    }

    try {
      const tunnel = await ipc.rdpLaunchNative(
        hostId,
        remoteTarget,
        targetPort,
        targetUser,
        nativePass,
        domain,
        shareClipboard,
        smartSizing,
        adminMode,
        finalFullScreen,
        finalWidth,
        finalHeight,
        Number(colorDepth),
        performancePreset,
        useSshCredentials
      )
      addLog(
        `SSH tunnel active: ${tunnel.localHost}:${tunnel.localPort} → ${tunnel.remoteHost}:${tunnel.remotePort}`
      )
      if (tunnel.rdpClient === "freerdp") {
        addLog(
          "FreeRDP connected — waiting for xRDP login screen (may take ~10s)..."
        )
        addLog(
          "Password is typed only inside FreeRDP windows (never on command line)."
        )
      } else if (tunnel.rdpClient === "mstsc") {
        addLog(
          "Native Remote Desktop (mstsc) opened. Enter password in the session window."
        )
      } else if (tunnel.autoLogin) {
        addLog("Remote Desktop session started with saved credentials.")
      } else if (useSshCredentials && !host.password) {
        addLog(
          "Warning: no SSH password saved for this host — add one in host settings."
        )
      }
      addLog(
        `Launching native Remote Desktop client to ${tunnel.localHost}:${tunnel.localPort}...`
      )
      setStatus("connected")
      if (tunnel.rdpClient === "freerdp") {
        addLog(
          "FreeRDP window should appear — check the taskbar if it is behind other windows."
        )
      } else {
        addLog(`Remote Desktop Connection (mstsc) opened.`)
      }
      toast.success(
        "Native RDP Client Launched",
        `${tunnel.localHost}:${tunnel.localPort} → ${tunnel.remoteHost}:${tunnel.remotePort}`
      )
    } catch (e) {
      setStatus("error")
      const err = (e as Error)?.message ?? "Failed to launch native RDP"
      addLog(`Error launching RDP: ${err}`)
      toast.error("RDP Launch Failed", err)
    } finally {
      launchingRef.current = false
      setLaunching(false)
    }
  }

  if (!hostId || !host) {
    return (
      <div className="flex h-full flex-1 flex-col items-center justify-center p-6 text-center text-muted-foreground">
        <Monitor className="mb-2 size-10 opacity-30" />
        <h3 className="text-sm font-semibold text-foreground">
          No Host Selected
        </h3>
        <p className="mt-1 max-w-sm text-xs">
          Select a host from the left sidebar to open Remote Desktop.
        </p>
      </div>
    )
  }

  const accent = hostAccent(host)

  return (
    <div
      ref={outerContainerRef}
      className="flex h-full flex-1 flex-col overflow-hidden bg-background"
    >
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
              <h2 className="text-xs font-semibold text-foreground">
                {host.label}
              </h2>
              <span className="font-mono text-[10px] text-muted-foreground">
                ({host.username ? `${host.username}@` : ""}
                {host.hostname})
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Cross-Platform Remote Desktop & Tunnel Forwarding
            </p>
          </div>
        </div>

        {/* Protocol Selector Tabs (Embedded Canvas Removed) */}
        <div className="flex items-center gap-1 rounded-lg border border-border/40 bg-muted/50 p-1">
          <button
            type="button"
            onClick={() => setTab("rdp")}
            className={cn(
              "rounded-md px-3 py-1 text-xs font-medium transition-colors",
              tab === "rdp"
                ? "bg-background font-semibold text-foreground shadow-2xs"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            RDP (Windows / Linux)
          </button>

          <button
            type="button"
            onClick={() => setTab("vnc")}
            className={cn(
              "rounded-md px-3 py-1 text-xs font-medium transition-colors",
              tab === "vnc"
                ? "bg-background font-semibold text-foreground shadow-2xs"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            VNC
          </button>

          <button
            type="button"
            onClick={() => setSidebarOpen((v) => !v)}
            title={
              sidebarOpen
                ? "Hide Settings Panel (Expand Canvas)"
                : "Show Settings Panel"
            }
            className="ml-1 rounded-md border border-border/50 bg-background/50 px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
          >
            {sidebarOpen ? "Hide Panel" : "Show Panel"}
          </button>
        </div>
      </header>

      {/* Main Body */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto bg-background/30 p-4 lg:flex-row">
        {/* Left Column: MobaXterm / Termius RDP Configuration Form */}
        {sidebarOpen && (
          <div className="w-full shrink-0 space-y-4 lg:w-[480px]">
            {/* Remote Desktop Settings Card */}
            <div className="space-y-4 rounded-xl border border-border/70 bg-card/60 p-4 shadow-2xs">
              <div className="flex items-center gap-2 border-b border-border/40 pb-2.5 text-xs font-semibold text-foreground">
                <Laptop className="size-4 text-primary" />
                <span>
                  {tab === "rdp"
                    ? "Remote Desktop (RDP)"
                    : "VNC Connection Parameters"}
                </span>
              </div>

              {/* Computer & Port */}
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <Label className="text-[11px] font-medium text-muted-foreground">
                    Local tunnel endpoint
                  </Label>
                  <Input
                    readOnly
                    className="mt-1 h-8 bg-muted/50 font-mono text-xs"
                    value={localEndpoint}
                  />
                </div>

                <div>
                  <Label className="text-[11px] font-medium text-muted-foreground">
                    Local port
                  </Label>
                  <Input
                    readOnly
                    className="mt-1 h-8 bg-muted/50 font-mono text-xs"
                    value="auto"
                    title="Assigned automatically when the tunnel starts"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <Label className="text-[11px] font-medium text-muted-foreground">
                    Remote RDP target (via SSH)
                  </Label>
                  <Input
                    className="mt-1 h-8 font-mono text-xs"
                    placeholder="127.0.0.1"
                    value={remoteTarget}
                    onChange={(e) => setRemoteTarget(e.target.value)}
                  />
                </div>

                <div>
                  <Label className="text-[11px] font-medium text-muted-foreground">
                    Port
                  </Label>
                  <Input
                    disabled
                    className="mt-1 h-8 cursor-not-allowed bg-muted/50 font-mono text-xs opacity-70"
                    value={tab === "rdp" ? rdpPort : vncPort}
                  />
                </div>
              </div>

              {/* Authentication Box */}
              <div className="space-y-3 rounded-lg border border-border/50 bg-background/40 p-3">
                <div className="flex items-center justify-between">
                  <Label className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                    <KeyRound className="size-3.5 text-primary" />
                    Authentication
                  </Label>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-muted-foreground">
                      Use SSH username/password for RDP login
                    </span>
                    <Switch
                      checked={useSshCredentials}
                      onCheckedChange={setUseSshCredentials}
                    />
                  </div>
                </div>

                {!useSshCredentials && (
                  <div className="space-y-2.5 pt-1">
                    <div>
                      <Label className="text-[11px] text-muted-foreground">
                        Domain (Optional)
                      </Label>
                      <Input
                        className="mt-1 h-7 text-xs"
                        placeholder="WORKGROUP"
                        value={domain}
                        onChange={(e) => setDomain(e.target.value)}
                      />
                    </div>

                    <div>
                      <Label className="text-[11px] text-muted-foreground">
                        Username
                      </Label>
                      <Input
                        className="mt-1 h-7 font-mono text-xs"
                        placeholder="Administrator"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                      />
                    </div>

                    <div>
                      <Label className="text-[11px] text-muted-foreground">
                        Password
                      </Label>
                      <div className="relative mt-1">
                        <Input
                          type={showPassword ? "text" : "password"}
                          className="h-7 pr-8 font-mono text-xs"
                          placeholder="Password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          className="absolute top-0.5 right-1 size-6 text-muted-foreground hover:text-foreground"
                          onClick={() => setShowPassword(!showPassword)}
                        >
                          {showPassword ? (
                            <EyeOff className="size-3" />
                          ) : (
                            <Eye className="size-3" />
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                {useSshCredentials && (
                  <div className="space-y-2 border-t border-border/30 pt-1">
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>
                        User:{" "}
                        <strong className="font-mono text-foreground">
                          {host?.username || username || "ubuntu"}
                        </strong>
                      </span>
                      <span className="rounded border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                        Vault In-Memory
                      </span>
                    </div>
                    <div className="relative">
                      <Input
                        type={showPassword ? "text" : "password"}
                        className="h-7 bg-muted/30 pr-8 font-mono text-xs"
                        placeholder="Password (auto-loaded from Vault if saved, or type here)"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        className="absolute top-0.5 right-1 size-6 text-muted-foreground hover:text-foreground"
                        onClick={() => setShowPassword(!showPassword)}
                      >
                        {showPassword ? (
                          <EyeOff className="size-3" />
                        ) : (
                          <Eye className="size-3" />
                        )}
                      </Button>
                    </div>
                    <p className="text-[10px] leading-relaxed text-muted-foreground">
                      Zero-leak security: Credentials remain strictly in RAM
                      memory and are never written to disk or command lines.
                    </p>
                  </div>
                )}
              </div>

              {/* Display & Quality Settings */}
              <div className="space-y-3 border-t border-border/40 pt-2">
                <Label className="block text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                  Display & Quality Settings
                </Label>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-[11px] text-muted-foreground">
                      Resolution
                    </Label>
                    <Select
                      value={resolutionMode}
                      onValueChange={(val) =>
                        val &&
                        setResolutionMode(
                          val as
                            | "fullscreen"
                            | "1920x1080"
                            | "1280x720"
                            | "1024x768"
                            | "custom"
                        )
                      }
                    >
                      <SelectTrigger className="mt-1 h-7 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="fullscreen">
                          Fullscreen (Monitor)
                        </SelectItem>
                        <SelectItem value="1920x1080">
                          1920x1080 (FHD)
                        </SelectItem>
                        <SelectItem value="1280x720">1280x720 (HD)</SelectItem>
                        <SelectItem value="1024x768">1024x768 (XGA)</SelectItem>
                        <SelectItem value="custom">Custom…</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label className="text-[11px] text-muted-foreground">
                      Connection Speed
                    </Label>
                    <Select
                      value={performancePreset}
                      onValueChange={(val) =>
                        val &&
                        setPerformancePreset(
                          val as "auto" | "modem" | "broadband" | "lan"
                        )
                      }
                    >
                      <SelectTrigger className="mt-1 h-7 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">auto</SelectItem>
                        <SelectItem value="lan">LAN (high speed)</SelectItem>
                        <SelectItem value="broadband">Broadband</SelectItem>
                        <SelectItem value="modem">Low bandwidth</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {resolutionMode === "custom" && (
                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <div>
                      <Label className="text-[11px] text-muted-foreground">
                        Width (px)
                      </Label>
                      <Input
                        type="number"
                        className="mt-1 h-7 font-mono text-xs"
                        value={customWidth}
                        onChange={(e) => setCustomWidth(e.target.value)}
                      />
                    </div>
                    <div>
                      <Label className="text-[11px] text-muted-foreground">
                        Height (px)
                      </Label>
                      <Input
                        type="number"
                        className="mt-1 h-7 font-mono text-xs"
                        value={customHeight}
                        onChange={(e) => setCustomHeight(e.target.value)}
                      />
                    </div>
                  </div>
                )}

                <div>
                  <Label className="text-[11px] text-muted-foreground">
                    Color Depth
                  </Label>
                  <Select
                    value={colorDepth}
                    onValueChange={(val) =>
                      val && setColorDepth(val as "16" | "24" | "32")
                    }
                  >
                    <SelectTrigger className="mt-1 h-7 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="32">
                        32-bit (Highest Quality, Cleanest)
                      </SelectItem>
                      <SelectItem value="24">24-bit (True Color)</SelectItem>
                      <SelectItem value="16">16-bit (High Color)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Profile Overrides */}
              <div className="space-y-3 border-t border-border/40 pt-2">
                <Label className="block text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                  Profile Overrides & Resources
                </Label>

                <div className="grid grid-cols-3 gap-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">
                      Clipboard
                    </span>
                    <Switch
                      checked={shareClipboard}
                      onCheckedChange={setShareClipboard}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">
                      Smart size
                    </span>
                    <Switch
                      checked={smartSizing}
                      onCheckedChange={setSmartSizing}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">
                      Admin / Console
                    </span>
                    <Switch
                      checked={adminMode}
                      onCheckedChange={setAdminMode}
                    />
                  </div>
                </div>
              </div>

              {/* Connection Actions */}
              <div className="space-y-2 border-t border-border/40 pt-2">
                {/*
                ================================================================
                [قيد التطوير / UNDER DEVELOPMENT]
                زر الاتصال المدمج (In-App Desktop Session):
                مخفي حالياً لأن الميزة قيد التطوير.
                لإعادة تفعيله، قم بتغيير ENABLE_EMBEDDED_DESKTOP إلى true في أعلى الملف.
                ================================================================
              */}
                {ENABLE_EMBEDDED_DESKTOP &&
                  (inAppSession ? (
                    <Button
                      size="sm"
                      variant="destructive"
                      className="h-9 w-full gap-2 text-xs font-semibold shadow-sm"
                      onClick={disconnectInAppDesktop}
                    >
                      <PowerOff className="size-4" />
                      Disconnect In-App Desktop
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      className="h-9 w-full gap-2 text-xs font-semibold shadow-sm"
                      disabled={inAppConnecting || launching}
                      onClick={connectInAppDesktop}
                    >
                      <MonitorPlay className="size-4" />
                      {inAppConnecting
                        ? "Starting Desktop Session…"
                        : "Connect In-App Desktop"}
                    </Button>
                  ))}

                <Button
                  type="button"
                  size="sm"
                  variant={ENABLE_EMBEDDED_DESKTOP ? "outline" : "default"}
                  className="h-9 w-full gap-2 text-xs font-semibold shadow-sm"
                  disabled={launching || inAppConnecting}
                  onClick={launchNativeRdp}
                >
                  <ExternalLink className="size-3.5" />
                  {launching
                    ? "Launching…"
                    : "Launch Native System Client (mstsc)"}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Right Column: In-App Desktop Canvas or Tunnel Console Log */}
        <div className="flex min-h-[480px] flex-1 flex-col overflow-hidden rounded-xl border border-border/70 bg-card/60 shadow-2xs">
          <div className="flex items-center justify-between border-b border-border/50 bg-muted/30 px-3 py-2">
            <div className="flex items-center gap-1.5 rounded-lg border border-border/40 bg-muted/60 p-0.5">
              {/*
                ================================================================
                [قيد التطوير / UNDER DEVELOPMENT]
                تبويب Embedded Canvas:
                مخفي حالياً لأن الميزة تحت التطوير.
                يتفعل تلقائياً عند تغيير ENABLE_EMBEDDED_DESKTOP = true في أعلى الملف.
                ================================================================
              */}
              {ENABLE_EMBEDDED_DESKTOP && (
                <button
                  type="button"
                  onClick={() => setActiveView("canvas")}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                    activeView === "canvas"
                      ? "bg-background font-semibold text-foreground shadow-2xs"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <MonitorPlay className="size-3.5 text-primary" />
                  <span>Embedded Canvas</span>
                  {inAppSession && (
                    <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
                  )}
                </button>
              )}
              <button
                type="button"
                onClick={() => setActiveView("console")}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  activeView === "console"
                    ? "bg-background font-semibold text-foreground shadow-2xs"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <TerminalSquare className="size-3.5" />
                <span>Tunnel Console</span>
              </button>
            </div>

            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium",
                  status === "connected" &&
                    "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
                  status === "tunneling" &&
                    "border-sky-500/30 bg-sky-500/10 text-sky-400",
                  status === "disconnected" &&
                    "border-zinc-700 bg-zinc-500/10 text-zinc-400"
                )}
              >
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    status === "connected" && "animate-pulse bg-emerald-500",
                    status === "tunneling" && "animate-ping bg-sky-500",
                    status === "disconnected" && "bg-zinc-500"
                  )}
                />
                {status === "connected"
                  ? "Active"
                  : status === "tunneling"
                    ? "Connecting..."
                    : "Idle"}
              </span>

              {activeView === "console" && (
                <Button
                  size="xs"
                  variant="ghost"
                  className="h-6 text-[10px]"
                  onClick={clearCurrentLog}
                >
                  Clear Log
                </Button>
              )}
            </div>
          </div>

          {/*
            ====================================================================
            [قيد التطوير / UNDER DEVELOPMENT]
            عرض Embedded In-App Desktop Canvas:
            مخفي حالياً لأنه قيد التطوير. يتم عرض شاشة Tunnel Console بشكل افتراضي.
            يتفعل تلقائياً عند تغيير ENABLE_EMBEDDED_DESKTOP = true في أعلى الملف.
            ====================================================================
          */}
          {ENABLE_EMBEDDED_DESKTOP && activeView === "canvas" ? (
            inAppSession ? (
              <div className="relative flex flex-1 flex-col overflow-hidden bg-zinc-950">
                {inAppSession.protocol === "rdp" && inAppSession.token ? (
                  <GuacamoleDesktopCanvas
                    wsUrl={inAppSession.wsUrl}
                    token={inAppSession.token}
                    width={resolveDimensions().w}
                    height={resolveDimensions().h}
                    onDisconnect={disconnectInAppDesktop}
                  />
                ) : (
                  <EmbeddedDesktopCanvas
                    wsUrl={inAppSession.wsUrl}
                    password={inAppSession.vncPassword}
                    onDisconnect={disconnectInAppDesktop}
                  />
                )}
              </div>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center bg-zinc-950/40 p-8 text-center">
                <div className="mb-3 flex size-14 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10">
                  <MonitorPlay className="size-7 text-primary" />
                </div>
                <h3 className="text-sm font-semibold text-foreground">
                  Embedded In-App Desktop
                </h3>
                <p className="mt-1 mb-4 max-w-md text-xs leading-relaxed text-muted-foreground">
                  RDP via Guacamole/guacd (Termix-style). VNC via noVNC.
                  Credentials stay in Rust — never in the browser.
                </p>
                {tab === "rdp" && guacdSetupHint && (
                  <div className="mb-4 max-w-lg rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-left text-[11px] whitespace-pre-wrap text-amber-100/90">
                    {guacdSetupHint}
                  </div>
                )}
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <Button
                    size="sm"
                    className="gap-2 font-semibold shadow-sm"
                    disabled={inAppConnecting || launching || guacdSetupBusy}
                    onClick={connectInAppDesktop}
                  >
                    <MonitorPlay className="size-4" />
                    {inAppConnecting
                      ? "Starting Canvas Bridge…"
                      : "Connect In-App Desktop"}
                  </Button>
                  {tab === "rdp" && (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-2"
                        disabled={guacdSetupBusy || inAppConnecting}
                        onClick={() => setupGuacd(false)}
                      >
                        {guacdSetupBusy
                          ? "Setting up guacd…"
                          : "Set up guacd (Docker)"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-[11px]"
                        disabled={guacdSetupBusy}
                        onClick={() => setupGuacd(true)}
                      >
                        Install Docker Desktop
                      </Button>
                    </>
                  )}
                </div>
              </div>
            )
          ) : (
            /* Console Log Output Window */
            <div className="flex-1 space-y-1 overflow-y-auto border-t border-border/30 bg-zinc-950 p-4 font-mono text-xs text-zinc-300 select-text">
              <div className="text-[11px] text-zinc-500">
                === SSHBool Remote Desktop Forwarding Engine ===
              </div>
              <div className="text-[11px] text-zinc-500">
                SSH Tunnel Target: {host.username ?? "ubuntu"}@{host.hostname}:
                {host.port}
              </div>
              <div className="my-2 border-b border-zinc-800" />

              {currentHostLogs.length === 0 && (
                <div className="text-zinc-600 italic">
                  Launch Native Client to view logs for {host.label}.
                </div>
              )}

              {currentHostLogs.map((line, idx) => (
                <div key={idx} className="leading-relaxed">
                  {line.includes("error") || line.includes("Failed") ? (
                    <span className="text-red-400">{line}</span>
                  ) : line.includes("completed") ||
                    line.includes("established") ||
                    line.includes("opened") ||
                    line.includes("active") ? (
                    <span className="text-emerald-400">{line}</span>
                  ) : line.includes("forwarding rule") ||
                    line.includes("WebSocket") ? (
                    <span className="text-sky-400">{line}</span>
                  ) : (
                    <span>{line}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
