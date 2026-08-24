import { useMemo } from "react"

import { useSetting } from "@/hooks/use-setting"
import { SETTINGS } from "@/lib/settings-defaults"

const DEFAULT_EDITOR_FONT = "'JetBrains Mono', 'DejaVu Sans Mono', monospace"

export function useEditorMonacoOptions() {
  const fontSize = useSetting(SETTINGS.editor.fontSize)
  const tabSize = useSetting(SETTINGS.editor.tabSize)
  const wordWrap = useSetting(SETTINGS.editor.wordWrap)
  const font = useSetting(SETTINGS.editor.font)
  const minimap = useSetting(SETTINGS.editor.minimap)
  const autoSave = useSetting(SETTINGS.editor.autoSave)

  const monacoOptions = useMemo(
    () => ({
      fontFamily: font.value?.trim()
        ? `"${font.value.trim()}", ${DEFAULT_EDITOR_FONT}`
        : DEFAULT_EDITOR_FONT,
      fontSize: Number(fontSize.value) || 13,
      tabSize: Number(tabSize.value) || 4,
      wordWrap: wordWrap.value === "on" ? ("on" as const) : ("off" as const),
      minimap: { enabled: !!minimap.value },
      automaticLayout: true,
    }),
    [font.value, fontSize.value, tabSize.value, wordWrap.value, minimap.value],
  )

  return {
    monacoOptions,
    autoSave: !!autoSave.value,
  }
}
