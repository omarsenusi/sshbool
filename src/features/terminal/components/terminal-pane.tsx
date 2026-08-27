import { useQuery } from "@tanstack/react-query"
import { FitAddon } from "@xterm/addon-fit"
import { SearchAddon } from "@xterm/addon-search"
import { Unicode11Addon } from "@xterm/addon-unicode11"
import { WebLinksAddon } from "@xterm/addon-web-links"
import { Terminal } from "@xterm/xterm"
import { useEffect, useRef, useMemo, useState } from "react"
import "@xterm/xterm/css/xterm.css"

import { listen } from "@tauri-apps/api/event"

import { TerminalContextMenu } from "@/features/terminal/components/terminal-context-menu"
import {
  isArabicLetter,
  prepareTextForXterm,
} from "@/features/terminal/arabic-xterm"
import {
  attachTerminalClipboardHandlers,
  type TerminalClipboardActions,
} from "@/features/terminal/terminal-clipboard"
import {
  DEFAULT_TERMINAL_CLIPBOARD_SETTINGS,
  resolveTerminalClipboardSettings,
  type TerminalClipboardSettings,
} from "@/features/terminal/terminal-clipboard-settings"
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

type ContextMenuState = {
  x: number
  y: number
  hasSelection: boolean
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

async function loadTerminalClipboardSettings(): Promise<TerminalClipboardSettings> {
  const [
    selectToCopy,
    contextMenu,
    copyShortcut,
    pasteShortcut,
    altCopyShortcut,
    altPasteShortcut,
    legacySelectToCopy,
    legacyRightClickPaste,
  ] = await Promise.all([
    ipc.settingsGet("terminalSelectToCopy"),
    ipc.settingsGet("terminalContextMenu"),
    ipc.settingsGet("terminalCopyShortcut"),
    ipc.settingsGet("terminalPasteShortcut"),
    ipc.settingsGet("terminalAltCopyShortcut"),
    ipc.settingsGet("terminalAltPasteShortcut"),
    ipc.settingsGet("terminalRightClickCopy"),
    ipc.settingsGet("terminalRightClickPaste"),
  ])

  return resolveTerminalClipboardSettings({
    selectToCopy,
    contextMenu,
    copyShortcut,
    pasteShortcut,
    altCopyShortcut,
    altPasteShortcut,
    legacySelectToCopy,
    legacyRightClickPaste,
  })
}

export function TerminalPane({ paneId, fontSize = 14, visible = true }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const clipboardActionsRef = useRef<TerminalClipboardActions | null>(null)
  const visibleRef = useRef(visible)
  visibleRef.current = visible

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)

  const terminalFontQuery = useQuery({
    queryKey: ["settings", "terminalFont"],
    queryFn: () => ipc.settingsGet("terminalFont") as Promise<string | null>,
  })
  const clipboardSettingsQuery = useQuery({
    queryKey: ["settings", "terminalClipboard"],
    queryFn: loadTerminalClipboardSettings,
  })

  const clipboardSettingsRef = useRef<TerminalClipboardSettings>(DEFAULT_TERMINAL_CLIPBOARD_SETTINGS)
  clipboardSettingsRef.current = clipboardSettingsQuery.data ?? DEFAULT_TERMINAL_CLIPBOARD_SETTINGS

  const customFont = terminalFontQuery.data?.trim()
  const font = useMemo(() => {
    return customFont
      ? `"${customFont}", ${TERMINAL_FONT_FAMILY}`
      : TERMINAL_FONT_FAMILY
  }, [customFont])

  useEffect(() => {
    if (visible) return
    const helper = containerRef.current?.querySelector<HTMLTextAreaElement>(".xterm-helper-textarea")
    helper?.blur()
  }, [visible])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    let disposed = false
    let resizeTimer: number | null = null
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: font,
      fontSize,
      theme: TERMINAL_THEME,
      allowProposedApi: true,
      drawBoldTextInBrightColors: true,
      minimumContrastRatio: 1,
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

    const { cleanup: detachClipboard, actions } = attachTerminalClipboardHandlers({
      term,
      container: el,
      getSettings: () => clipboardSettingsRef.current,
      getIsActive: () => visibleRef.current,
      onOpenContextMenu: (point) => {
        setContextMenu(point)
      },
      onPaste: (text) => {
        void ipc.paneWrite(paneId, text)
      },
    })
    clipboardActionsRef.current = actions

    let lastData = ""

    const onData = term.onData((data) => {
      let toSend = data

      if (
        lastData &&
        data.length > lastData.length &&
        data.startsWith(lastData)
      ) {
        toSend = data.slice(lastData.length)
      }

      lastData = data

      const helperArea = el.querySelector<HTMLTextAreaElement>(".xterm-helper-textarea")
      if (helperArea) {
        helperArea.value = ""
      }

      if (toSend) {
        void ipc.paneWrite(paneId, toSend)
      }
    })

    let unlisten: (() => void) | undefined
    const decoder = new TextDecoder("utf-8")
    const isWindows =
      typeof navigator !== "undefined" &&
      /win/i.test(navigator.userAgent || navigator.platform)

    void (async () => {
      try {
        const history = await ipc.paneScrollback(paneId)
        if (disposed) return
        if (history.length > 0) {
          const historyBytes = Uint8Array.from(history)
          if (isWindows) {
            const text = decoder.decode(historyBytes, { stream: true })
            if ([...text].some(isArabicLetter)) {
              term.write(prepareTextForXterm(text))
              return
            }
          }
          term.write(historyBytes)
        }
      } catch {
        /* pane may be brand new */
      }

      if (disposed) return

      unlisten = await listen<{ bytes: number[] }>(`terminal://data/${paneId}`, (event) => {
        if (disposed) return
        const data = Uint8Array.from(event.payload.bytes)
        if (isWindows) {
          const chunk = decoder.decode(data, { stream: true })
          if ([...chunk].some(isArabicLetter)) {
            term.write(prepareTextForXterm(chunk))
            return
          }
        }
        term.write(data)
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

    const onResize = term.onResize(({ cols, rows }) => {
      if (disposed || !visibleRef.current) return
      if (cols >= 2 && rows >= 2) void ipc.paneResize(paneId, cols, rows)
    })

    return () => {
      disposed = true
      if (resizeTimer != null) window.clearTimeout(resizeTimer)
      detachClipboard()
      clipboardActionsRef.current = null
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

  useEffect(() => {
    if (!termRef.current) return

    if (termRef.current.options.fontFamily !== font) {
      termRef.current.options.fontFamily = font

      void document.fonts.load(`${fontSize}px ${font}`).then(() => {
        if (termRef.current && fitRef.current) {
          const termPrivate = termRef.current as unknown as { clearTextureAtlas?: () => void }
          if (typeof termPrivate.clearTextureAtlas === "function") {
            termPrivate.clearTextureAtlas()
          }
          fitRef.current.fit()
        }
      })
    }
  }, [font, fontSize])

  return (
    <>
      <div
        ref={containerRef}
        className="h-full w-full"
        dir="ltr"
        style={{
          fontFamily: font,
          fontSize: `${fontSize}px`,
        }}
      />
      {contextMenu && (
        <TerminalContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          settings={clipboardSettingsRef.current}
          hasSelection={contextMenu.hasSelection}
          onCopy={() => void clipboardActionsRef.current?.copySelection()}
          onPaste={() => void clipboardActionsRef.current?.pasteFromClipboard()}
          onSelectAll={() => clipboardActionsRef.current?.selectAll()}
          onClose={() => {
            setContextMenu(null)
            clipboardActionsRef.current?.focus()
          }}
        />
      )}
    </>
  )
}
