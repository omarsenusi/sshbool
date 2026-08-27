import { clipboardReadText, clipboardWriteText } from "@/lib/clipboard"
import type { Terminal } from "@xterm/xterm"

import {
  DEFAULT_TERMINAL_CLIPBOARD_SETTINGS,
  isTerminalCopyShortcut,
  isTerminalPasteShortcut,
  shouldSendInterruptForCopyShortcut,
  type TerminalClipboardSettings,
} from "@/features/terminal/terminal-clipboard-settings"

export { isTerminalSettingEnabled } from "@/features/terminal/terminal-clipboard-settings"

export function prepareTextForTerminalPaste(text: string): string {
  return text.replace(/\r?\n/g, "\r")
}

export type TerminalClipboardActions = {
  copySelection: () => Promise<boolean>
  pasteFromClipboard: () => Promise<void>
  selectAll: () => void
  hasSelection: () => boolean
  focus: () => void
}

export type TerminalClipboardOptions = {
  term: Terminal
  container: HTMLElement
  getSettings: () => TerminalClipboardSettings
  getIsActive: () => boolean
  onOpenContextMenu: (point: { x: number; y: number; hasSelection: boolean }) => void
  onPaste: (text: string) => void
}

function isPaneEligible(container: HTMLElement, getIsActive: () => boolean): boolean {
  if (!getIsActive()) return false
  if (!container.isConnected) return false
  if (container.closest('[aria-hidden="true"]')) return false

  const rect = container.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

function isMouseEventInPane(container: HTMLElement, event: MouseEvent): boolean {
  const target = event.target
  return target instanceof Node && container.contains(target)
}

export function attachTerminalClipboardHandlers(opts: TerminalClipboardOptions): {
  cleanup: () => void
  actions: TerminalClipboardActions
} {
  const { term, container, getSettings, getIsActive, onOpenContextMenu, onPaste } = opts

  const focus = () => {
    try {
      term.focus()
    } catch {
      /* disposed */
    }
  }

  const copySelection = async (): Promise<boolean> => {
    if (!term.hasSelection()) return false
    const text = term.getSelection()
    if (!text) return false
    await clipboardWriteText(text)
    term.clearSelection()
    return true
  }

  const pasteFromClipboard = async (): Promise<void> => {
    const text = await clipboardReadText()
    if (!text) return
    onPaste(prepareTextForTerminalPaste(text))
  }

  const actions: TerminalClipboardActions = {
    copySelection,
    pasteFromClipboard,
    selectAll: () => term.selectAll(),
    hasSelection: () => term.hasSelection(),
    focus,
  }

  const handleKeyboardShortcut = (event: KeyboardEvent): boolean => {
    if (event.type !== "keydown" || event.repeat) return false
    if (!isPaneEligible(container, getIsActive)) return false

    const settings = getSettings()

    if (isTerminalPasteShortcut(event, settings)) {
      event.preventDefault()
      event.stopPropagation()
      void pasteFromClipboard()
      return true
    }

    if (isTerminalCopyShortcut(event, settings)) {
      if (term.hasSelection()) {
        event.preventDefault()
        event.stopPropagation()
        void copySelection()
        return true
      }

      if (shouldSendInterruptForCopyShortcut(event, settings)) {
        return false
      }

      event.preventDefault()
      event.stopPropagation()
      return true
    }

    return false
  }

  let lastKeyboardHandledAt = 0

  const customKeyHandler = (event: KeyboardEvent) => {
    const handled = handleKeyboardShortcut(event)
    if (handled) lastKeyboardHandledAt = event.timeStamp
    return !handled
  }

  const onWindowKeyDown = (event: KeyboardEvent) => {
    if (event.timeStamp - lastKeyboardHandledAt < 30) return
    if (!isPaneEligible(container, getIsActive)) return
    const active = document.activeElement
    if (!(active instanceof Node) || !container.contains(active)) return
    if (handleKeyboardShortcut(event)) {
      lastKeyboardHandledAt = event.timeStamp
    }
  }

  const onMouseDown = (event: MouseEvent) => {
    if (!isPaneEligible(container, getIsActive)) return
    if (!isMouseEventInPane(container, event)) return
    focus()
  }

  const onContextMenuCapture = (event: MouseEvent) => {
    if (!isPaneEligible(container, getIsActive)) return
    if (!isMouseEventInPane(container, event)) return

    event.preventDefault()
    event.stopImmediatePropagation()
    focus()

    const settings = getSettings()

    if (settings.contextMenu) {
      onOpenContextMenu({
        x: event.clientX,
        y: event.clientY,
        hasSelection: term.hasSelection(),
      })
      return
    }

    // PuTTY-style: selection stays after drag; right-click copies then clears.
    if (term.hasSelection()) {
      void copySelection()
      return
    }

    void pasteFromClipboard()
  }

  term.attachCustomKeyEventHandler(customKeyHandler)
  window.addEventListener("keydown", onWindowKeyDown, true)
  container.addEventListener("mousedown", onMouseDown)
  container.addEventListener("contextmenu", onContextMenuCapture, true)

  const cleanup = () => {
    window.removeEventListener("keydown", onWindowKeyDown, true)
    container.removeEventListener("mousedown", onMouseDown)
    container.removeEventListener("contextmenu", onContextMenuCapture, true)
    term.attachCustomKeyEventHandler(() => true)
  }

  return { cleanup, actions }
}

export function emptyTerminalClipboardSettings(): TerminalClipboardSettings {
  return { ...DEFAULT_TERMINAL_CLIPBOARD_SETTINGS }
}
