import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useMemo } from "react"

import {
  DEFAULT_KEYBINDINGS,
  isTypingTarget,
  matchesKeybinding,
  type KeybindingCommand,
} from "@/lib/keybinding-utils"
import { ipc } from "@/lib/ipc/commands"

export const KEYBINDINGS_QUERY_KEY = ["keybindings"] as const

export function useKeybindingsMap() {
  return useQuery({
    queryKey: KEYBINDINGS_QUERY_KEY,
    queryFn: async () => {
      const rows = await ipc.keybindingsList()
      const map = { ...DEFAULT_KEYBINDINGS }
      for (const row of rows) {
        const command = row.command as KeybindingCommand
        if (command in DEFAULT_KEYBINDINGS && row.keys) {
          map[command] = row.keys
        }
      }
      return map
    },
  })
}

/** Seed DB with defaults when empty (call from Keyboard settings). */
export async function seedDefaultKeybindings(): Promise<void> {
  const rows = await ipc.keybindingsList()
  if (rows.length > 0) return
  for (const [command, keys] of Object.entries(DEFAULT_KEYBINDINGS)) {
    await ipc.keybindingsSet(command, keys)
  }
}

export async function resetKeybindingsToDefaults(): Promise<void> {
  for (const [command, keys] of Object.entries(DEFAULT_KEYBINDINGS)) {
    await ipc.keybindingsSet(command, keys)
  }
}

export function useKeybinding(
  command: KeybindingCommand,
  handler: () => void,
  options?: { allowInInput?: boolean }
) {
  const { data: map } = useKeybindingsMap()
  const chord = map?.[command] ?? DEFAULT_KEYBINDINGS[command]

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!options?.allowInInput && isTypingTarget(event.target)) return
      if (!matchesKeybinding(event, chord)) return
      event.preventDefault()
      handler()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [chord, handler, options?.allowInInput])
}

export function useKeybindingsRegistry(
  handlers: Partial<Record<KeybindingCommand, () => void>>,
  options?: { allowInInput?: boolean }
) {
  const { data: map } = useKeybindingsMap()
  const merged = useMemo(() => ({ ...DEFAULT_KEYBINDINGS, ...map }), [map])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!options?.allowInInput && isTypingTarget(event.target)) return
      for (const [command, handler] of Object.entries(handlers) as [
        KeybindingCommand,
        () => void,
      ][]) {
        const chord = merged[command]
        if (!chord || !matchesKeybinding(event, chord)) continue
        event.preventDefault()
        handler()
        return
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [handlers, merged, options?.allowInInput])
}

export function useInvalidateKeybindings() {
  const qc = useQueryClient()
  return () => void qc.invalidateQueries({ queryKey: KEYBINDINGS_QUERY_KEY })
}
