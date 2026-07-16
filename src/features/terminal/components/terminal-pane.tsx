import { FitAddon } from "@xterm/addon-fit"
import { SearchAddon } from "@xterm/addon-search"
import { Unicode11Addon } from "@xterm/addon-unicode11"
import { WebLinksAddon } from "@xterm/addon-web-links"
import { Terminal } from "@xterm/xterm"
import { useEffect, useRef } from "react"
import "@xterm/xterm/css/xterm.css"

import { listen } from "@tauri-apps/api/event"

import { ArabicXtermFixer } from "@/features/terminal/arabic-xterm"
import {
  TERMINAL_FONT_FAMILY,
  TERMINAL_THEME,
} from "@/features/terminal/terminal-theme"
import { ipc } from "@/lib/ipc/commands"

type Props = {
  paneId: string
  hostId?: string
  fontSize?: number
  /** Only the foreground pane should fit/resize the PTY. */
  visible?: boolean
}

function resizePty(paneId: string, fit: FitAddon, fallback = false) {
  try {
    fit.fit()
    const d = fit.proposeDimensions()
    if (d && d.cols >= 2 && d.rows >= 2) {
      void ipc.paneResize(paneId, d.cols, d.rows)
      return
    }
    if (fallback) void ipc.paneResize(paneId, 80, 24)
  } catch {
    /* disposed */
  }
}

export function TerminalPane({ paneId, fontSize = 13, visible = true }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const visibleRef = useRef(visible)
  visibleRef.current = visible

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    let disposed = false
    let resizeTimer: number | null = null
    const arabicFix = new ArabicXtermFixer()
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize,
      lineHeight: 1.25,
      theme: TERMINAL_THEME,
      allowProposedApi: true,
      scrollback: 10_000,
      // Keep LF as-is — convertEol breaks fullscreen TUIs (htop/vim/tmux).
      convertEol: false,
      macOptionIsMeta: true,
    })
    const fit = new FitAddon()
    fitRef.current = fit
    termRef.current = term
    term.loadAddon(fit)
    term.loadAddon(new SearchAddon())
    term.loadAddon(new WebLinksAddon())
    const unicode11 = new Unicode11Addon()
    term.loadAddon(unicode11)
    term.unicode.activeVersion = "11"
    term.open(el)

    const onData = term.onData((data) => {
      void ipc.paneWrite(paneId, data)
    })

    let unlisten: (() => void) | undefined

    void (async () => {
      // Restore the authoritative PTY history from Rust (works across pop-out windows).
      try {
        const history = await ipc.paneScrollback(paneId)
        if (disposed) return
        if (history.length > 0) {
          const fixed = arabicFix.feed(Uint8Array.from(history))
          if (fixed) term.write(fixed)
        }
      } catch {
        /* pane may be brand new */
      }

      if (disposed) return

      unlisten = await listen<{ bytes: number[] }>(`terminal://data/${paneId}`, (event) => {
        if (disposed) return
        const data = Uint8Array.from(event.payload.bytes)
        const fixed = arabicFix.feed(data)
        if (fixed) term.write(fixed)
      })

      if (disposed) {
        unlisten()
        return
      }

      if (visibleRef.current) {
        resizePty(paneId, fit, true)
        try {
          term.refresh(0, term.rows - 1)
          term.focus()
        } catch {
          /* disposed */
        }
      }
    })()

    const ro = new ResizeObserver(() => {
      if (disposed || !visibleRef.current) return
      if (resizeTimer != null) window.clearTimeout(resizeTimer)
      resizeTimer = window.setTimeout(() => {
        resizeTimer = null
        resizePty(paneId, fit)
      }, 50)
    })
    ro.observe(el)

    // Also sync when xterm itself reports a size change.
    const onResize = term.onResize(({ cols, rows }) => {
      if (disposed || !visibleRef.current) return
      if (cols >= 2 && rows >= 2) void ipc.paneResize(paneId, cols, rows)
    })

    return () => {
      disposed = true
      if (resizeTimer != null) window.clearTimeout(resizeTimer)
      onData.dispose()
      onResize.dispose()
      unlisten?.()
      ro.disconnect()
      fitRef.current = null
      termRef.current = null
      term.dispose()
    }
  }, [paneId, fontSize])

  useEffect(() => {
    if (!visible) return
    const fit = fitRef.current
    const term = termRef.current
    if (!fit || !term) return
    const t = window.setTimeout(() => {
      resizePty(paneId, fit, true)
      try {
        term.refresh(0, term.rows - 1)
        term.focus()
      } catch {
        /* disposed */
      }
    }, 40)
    return () => window.clearTimeout(t)
  }, [visible, paneId])

  return (
    <div
      ref={containerRef}
      className="h-full w-full"
      dir="ltr"
      lang="ar"
      style={{ unicodeBidi: "plaintext" }}
    />
  )
}
