import { isValidKeybinding, matchesKeybinding } from "@/lib/keybinding-utils"

export type TerminalClipboardSettings = {
  selectToCopy: boolean
  contextMenu: boolean
  copyShortcut: string
  pasteShortcut: string
  altCopyShortcut: string
  altPasteShortcut: string
}

export const DEFAULT_TERMINAL_CLIPBOARD_SETTINGS: TerminalClipboardSettings = {
  selectToCopy: false,
  contextMenu: false,
  copyShortcut: "Ctrl+Shift+C",
  pasteShortcut: "Ctrl+Shift+V",
  altCopyShortcut: "Ctrl+C",
  altPasteShortcut: "Ctrl+V",
}

const BUILTIN_COPY_SHORTCUTS = ["Ctrl+Insert"] as const
const BUILTIN_PASTE_SHORTCUTS = ["Shift+Insert"] as const

export function isTerminalSettingEnabled(value: unknown, defaultEnabled = true): boolean {
  if (value === false) return false
  if (value === true) return true
  return defaultEnabled
}

function readShortcut(value: unknown, fallback: string): string {
  if (typeof value === "string" && isValidKeybinding(value.trim())) {
    return value.trim()
  }
  return fallback
}

export function resolveTerminalClipboardSettings(raw: {
  selectToCopy?: unknown
  contextMenu?: unknown
  copyShortcut?: unknown
  pasteShortcut?: unknown
  altCopyShortcut?: unknown
  altPasteShortcut?: unknown
  legacySelectToCopy?: unknown
  legacyRightClickPaste?: unknown
}): TerminalClipboardSettings {
  let selectToCopy = false
  if (raw.selectToCopy !== null && raw.selectToCopy !== undefined) {
    selectToCopy = raw.selectToCopy === true
  } else if (raw.legacySelectToCopy !== null && raw.legacySelectToCopy !== undefined) {
    selectToCopy = raw.legacySelectToCopy === true
  }

  let contextMenu = false
  if (raw.contextMenu !== null && raw.contextMenu !== undefined) {
    contextMenu = raw.contextMenu === true
  }

  return {
    selectToCopy,
    contextMenu,
    copyShortcut: readShortcut(raw.copyShortcut, DEFAULT_TERMINAL_CLIPBOARD_SETTINGS.copyShortcut),
    pasteShortcut: readShortcut(raw.pasteShortcut, DEFAULT_TERMINAL_CLIPBOARD_SETTINGS.pasteShortcut),
    altCopyShortcut: readShortcut(
      raw.altCopyShortcut,
      DEFAULT_TERMINAL_CLIPBOARD_SETTINGS.altCopyShortcut,
    ),
    altPasteShortcut: readShortcut(
      raw.altPasteShortcut,
      DEFAULT_TERMINAL_CLIPBOARD_SETTINGS.altPasteShortcut,
    ),
  }
}

export function getTerminalCopyShortcuts(settings: TerminalClipboardSettings): string[] {
  return [
    settings.copyShortcut,
    settings.altCopyShortcut,
    ...BUILTIN_COPY_SHORTCUTS,
  ].filter(Boolean)
}

export function getTerminalPasteShortcuts(settings: TerminalClipboardSettings): string[] {
  return [
    settings.pasteShortcut,
    settings.altPasteShortcut,
    ...BUILTIN_PASTE_SHORTCUTS,
  ].filter(Boolean)
}

/** True when the pressed chord should copy the current selection. */
export function isTerminalCopyShortcut(event: KeyboardEvent, settings: TerminalClipboardSettings): boolean {
  return getTerminalCopyShortcuts(settings).some((chord) => matchesKeybinding(event, chord))
}

/** True when the pressed chord should paste from the clipboard. */
export function isTerminalPasteShortcut(event: KeyboardEvent, settings: TerminalClipboardSettings): boolean {
  return getTerminalPasteShortcuts(settings).some((chord) => matchesKeybinding(event, chord))
}

/**
 * Ctrl+C without a selection must reach the remote shell as SIGINT.
 * Shift-copy shortcuts should never send SIGINT even without a selection.
 */
export function shouldSendInterruptForCopyShortcut(
  event: KeyboardEvent,
  settings: TerminalClipboardSettings,
): boolean {
  if (!matchesKeybinding(event, settings.altCopyShortcut)) return false
  return !event.shiftKey
}
