import { Image } from "@tauri-apps/api/image"
import { getCurrentWindow } from "@tauri-apps/api/window"
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
  const win = getCurrentWindow()
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

  async function togglePin() {
    const next = !pinned
    try {
      // Always the current window — never broadcasts to other webviews.
      await win.setAlwaysOnTop(next)
      setPinned(next)
    } catch {
      /* permission / platform */
    }
  }

  const ThemeIcon =
    !mounted || theme === "system"
      ? Monitor
      : resolvedTheme === "dark"
        ? Moon
        : Sun

  return (
    <header
      className={cn(
        "bg-sidebar border-border flex h-[var(--titlebar-h)] shrink-0 items-center border-b select-none",
        className,
      )}
      data-tauri-drag-region
    >
      <div
        className="flex min-w-0 shrink-0 items-center gap-2 px-3"
        data-tauri-drag-region
      >
        <img
          src="/app-icon-32.png"
          alt=""
          width={18}
          height={18}
          className="size-[18px] rounded-sm object-cover"
          draggable={false}
        />
        <div className="flex min-w-0 items-baseline gap-2" data-tauri-drag-region>
          <span className="text-foreground text-[13px] font-semibold tracking-tight">
            {title}
          </span>
          {subtitle ? (
            <span className="text-muted-foreground hidden truncate text-[11px] sm:inline">
              {subtitle}
            </span>
          ) : null}
        </div>
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 items-center gap-1 overflow-hidden px-1">
        {children}
      </div>

      <div className="flex shrink-0 items-center pr-1">
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
            className={cn(
              "text-muted-foreground",
              pinned && "text-primary bg-primary/10",
            )}
            onClick={() => void togglePin()}
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
          onClick={() => void win.minimize()}
        >
          <Minus className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Maximize"
          className="text-muted-foreground hover:text-foreground"
          onClick={() => void win.toggleMaximize()}
        >
          <Square className="size-3!" />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Close"
          className="text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
          onClick={() => void win.close()}
        >
          <X className="size-3.5" />
        </Button>
      </div>
    </header>
  )
}
