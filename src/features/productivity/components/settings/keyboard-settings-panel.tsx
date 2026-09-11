import { useEffect, useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  resetKeybindingsToDefaults,
  seedDefaultKeybindings,
  useInvalidateKeybindings,
  useKeybindingsMap,
} from "@/hooks/use-keybindings"
import { ipc } from "@/lib/ipc/commands"
import {
  DEFAULT_KEYBINDINGS,
  findKeybindingConflicts,
  formatKeybindingForDisplay,
  isValidKeybinding,
  KEYBINDING_LABELS,
  type KeybindingCommand,
} from "@/lib/keybinding-utils"

const COMMANDS = Object.keys(DEFAULT_KEYBINDINGS) as KeybindingCommand[]

const CONTEXT_SHORTCUTS = [
  { keys: "Ctrl/Cmd+S", action: "Save remote file (editor)" },
  { keys: "F2", action: "Rename (SFTP)" },
  { keys: "Delete", action: "Delete selected (SFTP)" },
  { keys: "Ctrl/Cmd+C/X/V/A", action: "Copy/cut/paste/select all (SFTP)" },
]

export function KeyboardSettingsPanel() {
  const { data: map, isLoading, refetch } = useKeybindingsMap()
  const invalidate = useInvalidateKeybindings()
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [editing, setEditing] = useState<KeybindingCommand | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [seeding, setSeeding] = useState(false)

  useEffect(() => {
    void seedDefaultKeybindings().then(() => refetch())
  }, [refetch])

  const merged = useMemo(
    () => ({ ...DEFAULT_KEYBINDINGS, ...map, ...draft }),
    [map, draft]
  )

  const conflicts = useMemo(() => findKeybindingConflicts(merged), [merged])

  async function saveCommand(command: KeybindingCommand, keys: string) {
    const trimmed = keys.trim()
    if (!isValidKeybinding(trimmed)) {
      setError("Invalid shortcut. Example: Mod+K, Mod+Shift+L, d")
      return
    }
    setError(null)
    await ipc.keybindingsSet(command, trimmed)
    setDraft((d) => {
      const next = { ...d }
      delete next[command]
      return next
    })
    invalidate()
    setEditing(null)
  }

  async function handleReset() {
    setSeeding(true)
    try {
      await resetKeybindingsToDefaults()
      setDraft({})
      invalidate()
      await refetch()
    } finally {
      setSeeding(false)
    }
  }

  if (isLoading) {
    return <p className="text-xs text-muted-foreground">Loading keybindings…</p>
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-semibold">Keyboard</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Global shortcuts. Use Mod for Ctrl on Windows/Linux or ⌘ on macOS.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={seeding}
          onClick={() => void handleReset()}
        >
          Reset defaults
        </Button>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {conflicts.size > 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
          {Array.from(conflicts.entries()).map(([chord, cmds]) => (
            <p key={chord}>
              Conflict: <strong>{formatKeybindingForDisplay(chord)}</strong>{" "}
              used by {cmds.join(", ")}
            </p>
          ))}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="p-3 text-left font-medium">Action</th>
              <th className="p-3 text-left font-medium">Shortcut</th>
              <th className="w-28 p-3 text-right font-medium">Edit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {COMMANDS.map((command) => {
              const current = merged[command] ?? DEFAULT_KEYBINDINGS[command]
              const isEditing = editing === command
              return (
                <tr key={command}>
                  <td className="p-3">{KEYBINDING_LABELS[command]}</td>
                  <td className="p-3">
                    {isEditing ? (
                      <input
                        autoFocus
                        className="w-full max-w-xs rounded-md border border-input bg-background px-2 py-1 font-mono text-xs"
                        defaultValue={current}
                        placeholder="Mod+K"
                        onKeyDown={(e) => {
                          if (e.key === "Escape") {
                            setEditing(null)
                            return
                          }
                          if (e.key === "Enter") {
                            void saveCommand(command, e.currentTarget.value)
                          }
                        }}
                        onBlur={(e) =>
                          void saveCommand(command, e.target.value)
                        }
                      />
                    ) : (
                      <code className="rounded bg-muted px-2 py-0.5 font-mono text-xs">
                        {formatKeybindingForDisplay(current)}
                      </code>
                    )}
                  </td>
                  <td className="p-3 text-right">
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => setEditing(isEditing ? null : command)}
                    >
                      {isEditing ? "Cancel" : "Edit"}
                    </Button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="border-t border-border pt-4">
        <h3 className="mb-2 text-sm font-semibold">
          Context shortcuts (fixed)
        </h3>
        <ul className="space-y-1 text-xs text-muted-foreground">
          {CONTEXT_SHORTCUTS.map(({ keys, action }) => (
            <li key={keys} className="flex gap-2">
              <code className="shrink-0 font-mono text-foreground">{keys}</code>
              <span>{action}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
