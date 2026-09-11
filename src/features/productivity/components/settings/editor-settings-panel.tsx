import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useSetting } from "@/hooks/use-setting"
import { SETTINGS, type EditorWordWrap } from "@/lib/settings-defaults"

import { FontSelector } from "./font-selector"

const fieldClass =
  "border-input bg-background w-full max-w-xs rounded-md border px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"

export function EditorSettingsPanel() {
  const fontSize = useSetting(SETTINGS.editor.fontSize)
  const tabSize = useSetting(SETTINGS.editor.tabSize)
  const wordWrap = useSetting(SETTINGS.editor.wordWrap)
  const font = useSetting(SETTINGS.editor.font)
  const minimap = useSetting(SETTINGS.editor.minimap)
  const autoSave = useSetting(SETTINGS.editor.autoSave)

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-semibold">Editor</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Remote file editor (Monaco) appearance and save behavior.
        </p>
      </div>

      <div className="max-w-lg space-y-4 border-t border-border pt-4">
        <label className="block space-y-1">
          <span className="text-sm font-medium">Font size</span>
          <input
            type="number"
            min={10}
            max={32}
            className={fieldClass}
            value={Number(fontSize.value)}
            onChange={(e) => fontSize.setValue(Number(e.target.value) || 13)}
          />
        </label>

        <label className="block space-y-1">
          <span className="text-sm font-medium">Tab size</span>
          <input
            type="number"
            min={2}
            max={8}
            className={fieldClass}
            value={Number(tabSize.value)}
            onChange={(e) => tabSize.setValue(Number(e.target.value) || 4)}
          />
        </label>

        <label className="block space-y-1">
          <span className="text-sm font-medium">Word wrap</span>
          <Select
            value={String(wordWrap.value)}
            onValueChange={(v) => {
              if (v) wordWrap.setValue(v as EditorWordWrap)
            }}
          >
            <SelectTrigger className="max-w-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="off">Off</SelectItem>
              <SelectItem value="on">On</SelectItem>
            </SelectContent>
          </Select>
        </label>

        <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
          <div className="space-y-0.5">
            <label className="text-sm font-medium" htmlFor="editor-minimap">
              Minimap
            </label>
            <p className="text-xs text-muted-foreground">
              Show code minimap on the right.
            </p>
          </div>
          <Switch
            id="editor-minimap"
            checked={!!minimap.value}
            onCheckedChange={(v) => minimap.setValue(v)}
          />
        </div>

        <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
          <div className="space-y-0.5">
            <label className="text-sm font-medium" htmlFor="editor-autosave">
              Auto-save
            </label>
            <p className="text-xs text-muted-foreground">
              Save changes automatically after you stop typing (~1.5s).
            </p>
          </div>
          <Switch
            id="editor-autosave"
            checked={!!autoSave.value}
            onCheckedChange={(v) => autoSave.setValue(v)}
          />
        </div>
      </div>

      <div className="border-t border-border pt-4">
        <FontSelector
          label="Editor font (Google Fonts)"
          description="Coding font for the remote Monaco editor."
          value={font.value ?? ""}
          onChange={(v) => font.setValue(v || null)}
          onSave={() => font.setValue(font.value ?? null)}
          isSaving={font.isSaving}
          popularFonts={[
            "JetBrains Mono",
            "Fira Code",
            "Source Code Pro",
            "Ubuntu Mono",
            "Inconsolata",
          ]}
        />
      </div>
    </div>
  )
}
