import { useEffect, useRef, useState } from "react"
// @ts-expect-error novnc lacks top-level module declaration
import RFB from "@novnc/novnc"
import {
  Maximize2,
  Minimize2,
  PowerOff,
  RefreshCw,
  Scaling,
  ShieldAlert,
  Keyboard,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface EmbeddedDesktopCanvasProps {
  wsUrl: string
  password?: string
  onDisconnect: () => void
  onStatusChange?: (
    status: "connecting" | "connected" | "disconnected" | "error"
  ) => void
}

/** noVNC canvas for VNC sessions over SSH tunnel. RDP uses GuacamoleDesktopCanvas. */
export function EmbeddedDesktopCanvas({
  wsUrl,
  password,
  onDisconnect,
  onStatusChange,
}: EmbeddedDesktopCanvasProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const rfbRef = useRef<RFB | null>(null)

  const [connState, setConnState] = useState<
    "connecting" | "connected" | "disconnected" | "error"
  >("connecting")
  const [scaleViewport, setScaleViewport] = useState<boolean>(true)
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    const handleFsChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener("fullscreenchange", handleFsChange)
    return () =>
      document.removeEventListener("fullscreenchange", handleFsChange)
  }, [])

  useEffect(() => {
    if (!containerRef.current || !wsUrl) return

    setConnState("connecting")
    setErrorMessage(null)
    onStatusChange?.("connecting")

    try {
      const options: {
        credentials?: { password?: string }
        wsProtocols?: string[]
      } = { wsProtocols: ["binary"] }
      if (password) options.credentials = { password }

      const rfb = new RFB(containerRef.current, wsUrl, options)
      rfbRef.current = rfb
      rfb.scaleViewport = scaleViewport
      rfb.clipViewport = false
      rfb.focusOnClick = true

      rfb.addEventListener("connect", () => {
        setConnState("connected")
        onStatusChange?.("connected")
      })

      rfb.addEventListener("disconnect", (e: CustomEvent) => {
        setConnState("disconnected")
        onStatusChange?.("disconnected")
        if (e.detail && !e.detail.clean) {
          setErrorMessage("VNC session closed.")
        }
      })

      rfb.addEventListener("securityfailure", (e: CustomEvent) => {
        setConnState("error")
        onStatusChange?.("error")
        setErrorMessage(e.detail?.reason ?? "Authentication failed.")
      })

      return () => {
        try {
          rfb.disconnect()
        } catch {
          // Ignore disconnect error
        }
        rfbRef.current = null
      }
    } catch (err) {
      setConnState("error")
      setErrorMessage(
        (err as Error)?.message ?? "Failed to initialize VNC canvas"
      )
      onStatusChange?.("error")
    }
  }, [wsUrl, password, onStatusChange])

  const toggleScaling = () => {
    const next = !scaleViewport
    setScaleViewport(next)
    if (rfbRef.current) rfbRef.current.scaleViewport = next
  }

  const handleCtrlAltDel = () => rfbRef.current?.sendCtrlAltDel()

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
          Live Desktop (VNC)
        </span>
        <div className="flex items-center gap-1">
          <Button
            size="icon-xs"
            variant="ghost"
            className="size-7"
            onClick={handleCtrlAltDel}
          >
            <Keyboard className="size-3.5" />
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            className="size-7"
            onClick={toggleScaling}
          >
            <Scaling className="size-3.5" />
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            className="size-7"
            onClick={toggleFullscreen}
          >
            {isFullscreen ? (
              <Minimize2 className="size-3.5" />
            ) : (
              <Maximize2 className="size-3.5" />
            )}
          </Button>
          <Button
            size="xs"
            variant="destructive"
            className="h-7 gap-1.5 px-2.5 text-xs"
            onClick={onDisconnect}
          >
            <PowerOff className="size-3" />
            Disconnect
          </Button>
        </div>
      </div>

      <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-black">
        {connState === "connecting" && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-zinc-950/80">
            <RefreshCw className="size-6 animate-spin text-primary" />
            <p className="text-xs text-zinc-300">Connecting to VNC…</p>
          </div>
        )}
        {connState === "error" && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 p-6 text-center">
            <ShieldAlert className="size-8 text-red-400" />
            <p className="text-xs text-zinc-400">{errorMessage}</p>
            <Button size="sm" variant="outline" onClick={onDisconnect}>
              Close
            </Button>
          </div>
        )}
        <div
          ref={containerRef}
          className="flex h-full w-full items-center justify-center overflow-auto select-none"
        />
      </div>
    </div>
  )
}
