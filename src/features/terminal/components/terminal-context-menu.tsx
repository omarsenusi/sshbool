import {
  FileContextMenu,
  type MenuItem,
} from "@/features/sftp/components/file-context-menu"
import { formatKeybindingForDisplay } from "@/lib/keybinding-utils"

import type { TerminalClipboardSettings } from "@/features/terminal/terminal-clipboard-settings"

export function TerminalContextMenu({
  x,
  y,
  settings,
  hasSelection,
  onCopy,
  onPaste,
  onSelectAll,
  onClose,
}: {
  x: number
  y: number
  settings: TerminalClipboardSettings
  hasSelection: boolean
  onCopy: () => void
  onPaste: () => void
  onSelectAll: () => void
  onClose: () => void
}) {
  const copyHint = formatKeybindingForDisplay(settings.copyShortcut)
  const pasteHint = formatKeybindingForDisplay(settings.pasteShortcut)

  const items: MenuItem[] = [
    {
      type: "item",
      label: hasSelection ? `Copy (${copyHint})` : `Copy (${copyHint})`,
      disabled: !hasSelection,
      onClick: onCopy,
    },
    {
      type: "item",
      label: `Paste (${pasteHint})`,
      onClick: onPaste,
    },
    { type: "sep" },
    {
      type: "item",
      label: "Select all",
      onClick: onSelectAll,
    },
  ]

  return <FileContextMenu x={x} y={y} items={items} onClose={onClose} />
}
