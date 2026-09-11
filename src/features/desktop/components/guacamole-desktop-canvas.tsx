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
  onStatusChange?: (
    status: "connecting" | "connected" | "disconnected" | "error"
  ) => void
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

  const [connState, setConnState] = useState<
    "connecting" | "connected" | "disconnected" | "error"
  >("connecting")
  const [scaleViewport, setScaleViewport] = useState(true)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [desktopDims, setDesktopDims] = useState({ width, height })

  useEffect(() => {
    const handleFsChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener("fullscreenchange", handleFsChange)
    return () =>
      document.removeEventListener("fullscreenchange", handleFsChange)
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
      } catch {
        // Ignore disconnect error
      }
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
      el.requestFullscreen()
        .then(() => setIsFullscreen(true))
        .catch(() => {})
    } else {
      document
        .exitFullscreen()
        .then(() => setIsFullscreen(false))
        .catch(() => {})
    }
  }

  return (
    <div
      ref={rootRef}
      className="flex h-full w-full flex-col overflow-hidden rounded-xl border border-border/70 bg-zinc-950 shadow-2xs"
    >
      <div className="flex shrink-0 items-center justify-between border-b border-zinc-800 bg-zinc-900/90 px-3 py-1.5 backdrop-blur-xs">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium",
              connState === "connected" &&
                "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
              connState === "connecting" &&
                "border-sky-500/30 bg-sky-500/10 text-sky-400",
              connState === "disconnected" &&
                "border-zinc-700 bg-zinc-500/10 text-zinc-400",
              connState === "error" &&
                "border-red-500/30 bg-red-500/10 text-red-400"
            )}
          >
            <span
              className={cn(
                "size-1.5 rounded-full",
                connState === "connected" && "animate-pulse bg-emerald-500",
                connState === "connecting" && "animate-ping bg-sky-500",
                connState === "disconnected" && "bg-zinc-500",
                connState === "error" && "bg-red-500"
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
            className="size-7 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
            onClick={handleCtrlAltDel}
          >
            <KeyboardIcon className="size-3.5" />
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            title={
              scaleViewport
                ? "Disable Smart Sizing (1:1)"
                : "Enable Smart Sizing (Fit)"
            }
            className={cn(
              "size-7 transition-colors",
              scaleViewport
                ? "bg-primary/10 text-primary hover:text-primary/90"
                : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
            )}
            onClick={toggleScaling}
          >
            <Scaling className="size-3.5" />
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
            className="size-7 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
            onClick={toggleFullscreen}
          >
            {isFullscreen ? (
              <Minimize2 className="size-3.5" />
            ) : (
              <Maximize2 className="size-3.5" />
            )}
          </Button>
          <div className="mx-1 h-4 w-px bg-zinc-800" />
          <Button
            size="xs"
            variant="destructive"
            className="h-7 gap-1.5 px-2.5 text-xs font-medium"
            onClick={onDisconnect}
          >
            <PowerOff className="size-3" />
            Disconnect
          </Button>
        </div>
      </div>

      <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-black">
        {connState === "connecting" && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-zinc-950/80 p-4 text-center backdrop-blur-xs">
            <RefreshCw className="size-6 animate-spin text-primary" />
            <p className="text-xs font-medium text-zinc-300">
              Connecting to RDP via guacd…
            </p>
            <p className="text-[11px] text-zinc-500">
              Credentials handled securely in Rust — never exposed to the UI
            </p>
          </div>
        )}

        {connState === "error" && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-zinc-950/90 p-6 text-center">
            <ShieldAlert className="size-8 text-red-400" />
            <p className="text-sm font-semibold text-red-300">
              Desktop Connection Error
            </p>
            <p className="max-w-md text-xs text-zinc-400">
              {errorMessage ?? "Failed to connect to the desktop service."}
            </p>
            <Button
              size="sm"
              variant="outline"
              className="mt-2 text-xs"
              onClick={onDisconnect}
            >
              Close Viewer
            </Button>
          </div>
        )}

        <div
          ref={displayRef}
          className={cn(
            "flex h-full w-full items-center justify-center overflow-auto bg-black p-1 select-none",
            scaleViewport &&
              "[&_canvas]:max-h-full [&_canvas]:max-w-full [&_canvas]:object-contain"
          )}
        />
      </div>
    </div>
  )
}
