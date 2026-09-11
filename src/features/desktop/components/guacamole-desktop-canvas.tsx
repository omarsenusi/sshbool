import { useEffect, useRef, useState } from "react"
import Guacamole from "guacamole-common-js"

const { Client, WebSocketTunnel, Mouse, Keyboard: GuacKeyboard } = Guacamole
import {
  Maximize2,
  Minimize2,
  PowerOff,
  RefreshCw,
  Scaling,
  ShieldAlert,
  Keyboard as KeyboardIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface GuacamoleDesktopCanvasProps {
  wsUrl: string
  token: string
  width?: number
  height?: number
  onDisconnect: () => void
  onStatusChange?: (status: "connecting" | "connected" | "disconnected" | "error") => void
}

export function GuacamoleDesktopCanvas({
  wsUrl,
  token,
  width = 1280,
  height = 720,
  onDisconnect,
  onStatusChange,
}: GuacamoleDesktopCanvasProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const displayRef = useRef<HTMLDivElement | null>(null)
  const clientRef = useRef<InstanceType<typeof Client> | null>(null)
  const tunnelRef = useRef<InstanceType<typeof WebSocketTunnel> | null>(null)

  const [connState, setConnState] = useState<"connecting" | "connected" | "disconnected" | "error">("connecting")
  const [scaleViewport, setScaleViewport] = useState(true)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [desktopDims, setDesktopDims] = useState({ width, height })

  useEffect(() => {
    const handleFsChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener("fullscreenchange", handleFsChange)
    return () => document.removeEventListener("fullscreenchange", handleFsChange)
  }, [])

  useEffect(() => {
    if (!displayRef.current || !wsUrl || !token) return

    let cancelled = false
    setConnState("connecting")
    setErrorMessage(null)
    onStatusChange?.("connecting")

    const tunnelUrl = `${wsUrl}${wsUrl.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`
    const tunnel = new WebSocketTunnel(tunnelUrl)
    const client = new Client(tunnel)
    tunnelRef.current = tunnel
    clientRef.current = client

    const display = client.getDisplay()
    const displayElement = display.getElement()
    displayElement.style.margin = "0 auto"
    displayRef.current.innerHTML = ""
    displayRef.current.appendChild(displayElement)

    client.onstatechange = (state: number) => {
      if (cancelled) return
      if (state === Client.State.CONNECTED) {
        setConnState("connected")
        onStatusChange?.("connected")
        const layer = display.getDefaultLayer()
        if (layer) {
          setDesktopDims({ width: layer.width, height: layer.height })
        }
      } else if (state === Client.State.DISCONNECTED) {
        setConnState("disconnected")
        onStatusChange?.("disconnected")
      } else if (state === Client.State.CONNECTING) {
        setConnState("connecting")
        onStatusChange?.("connecting")
      }
    }

    client.onerror = (err: { message?: string }) => {
      if (cancelled) return
      setConnState("error")
      setErrorMessage(err?.message || "RDP connection failed")
      onStatusChange?.("error")
    }

    display.onresize = (w: number, h: number) => {
      if (w > 0 && h > 0) {
        setDesktopDims({ width: w, height: h })
      }
    }

    const mouse = new Mouse(displayElement)
    mouse.onmousedown =
      mouse.onmouseup =
      mouse.onmousemove =
        (mouseState) => {
          client.sendMouseState(mouseState)
        }

    const keyboard = new GuacKeyboard(document)
    keyboard.onkeydown = (keysym: number) => {
      client.sendKeyEvent(1, keysym)
    }
    keyboard.onkeyup = (keysym: number) => {
      client.sendKeyEvent(0, keysym)
    }

    client.connect()

    return () => {
      cancelled = true
      keyboard.onkeydown = keyboard.onkeyup = null
      mouse.onmousedown = mouse.onmouseup = mouse.onmousemove = null
      try {
        client.disconnect()
      } catch {}
      clientRef.current = null
      tunnelRef.current = null
    }
  }, [wsUrl, token, onStatusChange])

  const toggleScaling = () => setScaleViewport((v) => !v)

  const handleCtrlAltDel = () => {
    clientRef.current?.sendKeyEvent(1, 0xffe3)
    clientRef.current?.sendKeyEvent(1, 0xffe9)
    clientRef.current?.sendKeyEvent(1, 0xffff)
    clientRef.current?.sendKeyEvent(0, 0xffff)
    clientRef.current?.sendKeyEvent(0, 0xffe9)
    clientRef.current?.sendKeyEvent(0, 0xffe3)
  }

  const toggleFullscreen = () => {
    const el = rootRef.current
    if (!el) return
    if (!document.fullscreenElement) {
      el.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {})
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {})
    }
  }

  return (
    <div
      ref={rootRef}
      className="flex h-full w-full flex-col overflow-hidden bg-zinc-950 rounded-xl border border-border/70 shadow-2xs"
    >
      <div className="flex shrink-0 items-center justify-between border-b border-zinc-800 bg-zinc-900/90 px-3 py-1.5 backdrop-blur-xs">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full border",
              connState === "connected" && "bg-emerald-500/10 border-emerald-500/30 text-emerald-400",
              connState === "connecting" && "bg-sky-500/10 border-sky-500/30 text-sky-400",
              connState === "disconnected" && "bg-zinc-500/10 border-zinc-700 text-zinc-400",
              connState === "error" && "bg-red-500/10 border-red-500/30 text-red-400",
            )}
          >
            <span
              className={cn(
                "size-1.5 rounded-full",
                connState === "connected" && "bg-emerald-500 animate-pulse",
                connState === "connecting" && "bg-sky-500 animate-ping",
                connState === "disconnected" && "bg-zinc-500",
                connState === "error" && "bg-red-500",
              )}
            />
            {connState === "connected"
              ? `Live Desktop (RDP) • ${desktopDims.width}×${desktopDims.height}`
              : connState === "connecting"
                ? "Connecting via Guacamole…"
                : connState === "error"
                  ? "Connection Failed"
                  : "Disconnected"}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <Button
            size="icon-xs"
            variant="ghost"
            title="Send Ctrl+Alt+Del"
            className="text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 size-7"
            onClick={handleCtrlAltDel}
          >
            <KeyboardIcon className="size-3.5" />
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            title={scaleViewport ? "Disable Smart Sizing (1:1)" : "Enable Smart Sizing (Fit)"}
            className={cn(
              "size-7 transition-colors",
              scaleViewport ? "text-primary hover:text-primary/90 bg-primary/10" : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800",
            )}
            onClick={toggleScaling}
          >
            <Scaling className="size-3.5" />
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
            className="text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 size-7"
            onClick={toggleFullscreen}
          >
            {isFullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
          </Button>
          <div className="h-4 w-px bg-zinc-800 mx-1" />
          <Button size="xs" variant="destructive" className="h-7 text-xs gap-1.5 font-medium px-2.5" onClick={onDisconnect}>
            <PowerOff className="size-3" />
            Disconnect
          </Button>
        </div>
      </div>

      <div className="relative flex-1 overflow-hidden flex items-center justify-center bg-black">
        {connState === "connecting" && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-zinc-950/80 gap-3 backdrop-blur-xs text-center p-4">
            <RefreshCw className="size-6 animate-spin text-primary" />
            <p className="text-xs text-zinc-300 font-medium">Connecting to RDP via guacd…</p>
            <p className="text-[11px] text-zinc-500">Credentials handled securely in Rust — never exposed to the UI</p>
          </div>
        )}

        {connState === "error" && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-zinc-950/90 gap-3 text-center p-6">
            <ShieldAlert className="size-8 text-red-400" />
            <p className="text-sm font-semibold text-red-300">Desktop Connection Error</p>
            <p className="text-xs text-zinc-400 max-w-md">{errorMessage ?? "Failed to connect to the desktop service."}</p>
            <Button size="sm" variant="outline" className="mt-2 text-xs" onClick={onDisconnect}>
              Close Viewer
            </Button>
          </div>
        )}

        <div
          ref={displayRef}
          className={cn(
            "h-full w-full flex items-center justify-center overflow-auto select-none p-1 bg-black",
            scaleViewport && "[&_canvas]:max-h-full [&_canvas]:max-w-full [&_canvas]:object-contain",
          )}
        />
      </div>
    </div>
  )
}
