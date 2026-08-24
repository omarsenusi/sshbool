/** Parse and match keyboard chords (Mod+K, d, Mod+Shift+L). */

export type KeybindingCommand =
  | "palette.open"
  | "theme.toggle"
  | "vault.lock"
  | "activity.terminal"
  | "activity.sftp"
  | "activity.editor"
  | "activity.connections"

export const DEFAULT_KEYBINDINGS: Record<KeybindingCommand, string> = {
  "palette.open": "Mod+K",
  "theme.toggle": "d",
  "vault.lock": "Mod+Shift+L",
  "activity.terminal": "Mod+Shift+T",
  "activity.sftp": "Mod+Shift+F",
  "activity.editor": "Mod+Shift+E",
  "activity.connections": "Mod+Shift+C",
}

export const KEYBINDING_LABELS: Record<KeybindingCommand, string> = {
  "palette.open": "Open command palette",
  "theme.toggle": "Toggle light/dark theme",
  "vault.lock": "Lock vault",
  "activity.terminal": "Go to Terminal",
  "activity.sftp": "Go to SFTP",
  "activity.editor": "Go to Editor",
  "activity.connections": "Go to Connections",
}

const MODIFIERS = ["Mod", "Ctrl", "Alt", "Shift", "Meta"] as const

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  )
}

function normalizeKey(key: string): string {
  if (key === " ") return "Space"
  if (key.length === 1) return key.toUpperCase()
  return key
}

export function parseKeybinding(chord: string): {
  mod: boolean
  ctrl: boolean
  alt: boolean
  shift: boolean
  meta: boolean
  key: string
} {
  const parts = chord.split("+").map((p) => p.trim()).filter(Boolean)
  let mod = false
  let ctrl = false
  let alt = false
  let shift = false
  let meta = false
  let key = ""

  for (const part of parts) {
    const lower = part.toLowerCase()
    if (lower === "mod") {
      mod = true
      continue
    }
    if (lower === "ctrl" || lower === "control") {
      ctrl = true
      continue
    }
    if (lower === "alt") {
      alt = true
      continue
    }
    if (lower === "shift") {
      shift = true
      continue
    }
    if (lower === "meta" || lower === "cmd" || lower === "command") {
      meta = true
      continue
    }
    key = normalizeKey(part)
  }

  return { mod, ctrl, alt, shift, meta, key }
}

export function formatKeybindingForDisplay(chord: string): string {
  const isMac =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent)
  return chord
    .split("+")
    .map((p) => {
      const t = p.trim()
      if (t === "Mod") return isMac ? "⌘" : "Ctrl"
      if (t === "Shift") return isMac ? "⇧" : "Shift"
      if (t === "Alt") return isMac ? "⌥" : "Alt"
      return t
    })
    .join(isMac ? "" : "+")
}

export function matchesKeybinding(event: KeyboardEvent, chord: string): boolean {
  if (event.defaultPrevented || event.repeat) return false

  const parsed = parseKeybinding(chord)
  const eventKey = normalizeKey(event.key)

  if (parsed.key !== eventKey) return false

  const modPressed = event.metaKey || event.ctrlKey
  if (parsed.mod && !modPressed) return false
  if (parsed.ctrl && !event.ctrlKey) return false
  if (parsed.alt && !event.altKey) return false
  if (parsed.shift && !event.shiftKey) return false
  if (parsed.meta && !event.metaKey) return false

  // Single-letter shortcuts (theme.toggle) must not fire with modifiers unless specified
  if (
    !parsed.mod &&
    !parsed.ctrl &&
    !parsed.alt &&
    !parsed.meta &&
    !parsed.shift &&
    (event.metaKey || event.ctrlKey || event.altKey)
  ) {
    return false
  }

  // Mod+Key should not require both ctrl and meta unless both specified
  if (parsed.mod && !parsed.ctrl && !parsed.meta) {
    if (!(event.metaKey || event.ctrlKey)) return false
  }

  return true
}

export function findKeybindingConflicts(
  bindings: Record<string, string>,
): Map<string, string[]> {
  const byChord = new Map<string, string[]>()
  for (const [command, chord] of Object.entries(bindings)) {
    const normalized = chord.trim()
    if (!normalized) continue
    const list = byChord.get(normalized) ?? []
    list.push(command)
    byChord.set(normalized, list)
  }
  const conflicts = new Map<string, string[]>()
  for (const [chord, commands] of byChord) {
    if (commands.length > 1) conflicts.set(chord, commands)
  }
  return conflicts
}

export function isValidKeybinding(chord: string): boolean {
  const trimmed = chord.trim()
  if (!trimmed) return false
  const parts = trimmed.split("+").map((p) => p.trim()).filter(Boolean)
  if (parts.length === 0) return false
  const last = parts[parts.length - 1]!
  if (MODIFIERS.includes(last as (typeof MODIFIERS)[number])) return false
  return true
}
