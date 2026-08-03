import { Image } from "@tauri-apps/api/image"
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow"
import {
  Minus,
  Monitor,
  Moon,
  Pin,
  PinOff,
  Square,
  Sun,
  X,
} from "lucide-react"
import { useTheme } from "next-themes"
import { useEffect, useState, type ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { WorkspaceSwitcher } from "@/components/layout/workspace-switcher"
import { TrayTrigger } from "@/components/tray/tray-popup"
import { ipc } from "@/lib/ipc/commands"
import { cn } from "@/lib/utils"

export type WindowChromeProps = {
  /** Primary title (defaults to SSHBool). */
  title?: string
  /** Secondary line next to the title. */
  subtitle?: string
  /** Middle slot — typically tabs. */
  children?: ReactNode
  showPin?: boolean
  showTheme?: boolean
  className?: string
}

/**
 * Shared frameless window chrome for the main app and pop-out windows.
 * Pin / theme / window controls always target *this* webview only.
 */
export function WindowChrome({
  title = "SSHBool",
  subtitle = "Infrastructure Workspace",
  children,
  showPin = true,
  showTheme = true,
  className,
}: WindowChromeProps) {
  const win = getCurrentWebviewWindow()
  const { theme, setTheme, resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const [pinned, setPinned] = useState(false)

  useEffect(() => setMounted(true), [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch("/app-icon.png")
        if (!res.ok || cancelled) return
        const buf = new Uint8Array(await res.arrayBuffer())
        const image = await Image.fromBytes(buf)
        if (cancelled) return
        await win.setIcon(image)
      } catch {
        /* optional */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [win])

  function cycleTheme() {
    const order = ["system", "light", "dark"] as const
    const current = theme ?? "system"
    const idx = order.indexOf(current as (typeof order)[number])
    const next = order[(idx + 1) % order.length] ?? "system"
    setTheme(next)
    void ipc.settingsSet("theme", next).catch(() => {})
  }

  async function togglePin(e?: React.MouseEvent) {
    e?.stopPropagation()
    try {
      const next = await ipc.windowTogglePin()
      setPinned(next)
    } catch {
      // Fallback to JS-side window API
      const next = !pinned
      try {
        await win.setAlwaysOnTop(next)
        setPinned(next)
      } catch { /* ignore */ }
    }
  }

  const ThemeIcon =
    !mounted || theme === "system"
      ? Monitor
      : resolvedTheme === "dark"
        ? Moon
        : Sun

  async function handleMinimize(e?: React.MouseEvent) {
    e?.stopPropagation()
    try {
      await ipc.windowMinimize()
    } catch {
      void win.minimize().catch(() => {})
    }
  }

  async function handleMaximize(e?: React.MouseEvent) {
    e?.stopPropagation()
    try {
      await ipc.windowToggleMaximize()
    } catch {
      void win.toggleMaximize().catch(() => {})
    }
  }

  async function handleClose(e?: React.MouseEvent) {
    e?.stopPropagation()
    try {
      await ipc.windowClose()
    } catch {
      void win.close().catch(() => {})
    }
  }

  function handleStartDrag(e: React.MouseEvent) {
    const target = e.target as HTMLElement
    // Ignore drag when clicking interactive elements like buttons, dropdowns, inputs
    if (target.closest("button") || target.closest("input") || target.closest("select")) {
      return
    }
    void win.startDragging().catch(() => {})
  }

  return (
    <header
      className={cn(
        "bg-sidebar border-border flex h-[var(--titlebar-h)] shrink-0 items-center border-b select-none cursor-default",
        className,
      )}
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      data-tauri-drag-region
      onMouseDown={handleStartDrag}
    >
      <div
        className="flex min-w-0 shrink-0 items-center gap-2 px-3"
        data-tauri-drag-region
      >
        {/* App icon — click opens tray popup */}
        <div style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
          <TrayTrigger />
        </div>
        <div className="flex min-w-0 items-center gap-2" data-tauri-drag-region>
          <span
            className="text-foreground text-[13px] font-semibold tracking-tight"
            data-tauri-drag-region
          >
            {title}
          </span>
          <div style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
            <WorkspaceSwitcher />
          </div>
        </div>
      </div>

      <div
        className="flex min-h-0 min-w-0 flex-1 items-center gap-1 overflow-hidden px-1"
        data-tauri-drag-region
      >
        {children}
      </div>

      <div
        className="flex shrink-0 items-center pr-1 z-30"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        {showPin && (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={pinned ? "Unpin this window" : "Pin this window on top"}
            aria-pressed={pinned}
            title={
              pinned
                ? "Unpin this window (only this window)"
                : "Pin this window on top (only this window)"
            }
            className={cn("text-muted-foreground", pinned && "text-primary bg-primary/10")}
            style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
            onClick={(e) => void togglePin(e)}
          >
            {pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
          </Button>
        )}
        {showTheme && (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Theme: ${theme ?? "system"}`}
            title={`Theme: ${mounted ? (theme ?? "system") : "…"} (click to cycle)`}
            className="text-muted-foreground"
            style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
            onClick={cycleTheme}
          >
            <ThemeIcon className="size-3.5" />
          </Button>
        )}
        <div className="bg-border mx-1 h-3.5 w-px" aria-hidden />
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Minimize"
          className="text-muted-foreground hover:text-foreground"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          onClick={handleMinimize}
        >
          <Minus className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Maximize"
          className="text-muted-foreground hover:text-foreground"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          onClick={handleMaximize}
        >
          <Square className="size-3!" />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Close"
          className="text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          onClick={handleClose}
        >
          <X className="size-3.5" />
        </Button>
      </div>
    </header>
  )
}
