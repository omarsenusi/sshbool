import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Monitor, Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { saveHostRailPrefs } from "@/hooks/use-host-rail-prefs"
import { ipc } from "@/lib/ipc/commands"
import { cn } from "@/lib/utils"
import { HOST_RAIL_SIZING, useLayoutStore } from "@/stores/layout.store"

import { LicenseSettings } from "@/features/license/components/license-settings"
import { AboutSettings } from "@/features/productivity/components/settings/about-settings"
import { UpdatesSettings } from "@/features/productivity/components/settings/updates-settings"
import { ConnectionsSettings } from "@/features/productivity/components/settings/connections-settings"
import { EditorSettingsPanel } from "@/features/productivity/components/settings/editor-settings-panel"
import { FontSelector } from "@/features/productivity/components/settings/font-selector"
import { KeyboardSettingsPanel } from "@/features/productivity/components/settings/keyboard-settings-panel"
import { SftpSettingsPanel } from "@/features/productivity/components/settings/sftp-settings-panel"
import {
  DEFAULT_TERMINAL_CLIPBOARD_SETTINGS,
  resolveTerminalClipboardSettings,
} from "@/features/terminal/terminal-clipboard-settings"
import { formatKeybindingForDisplay, isValidKeybinding } from "@/lib/keybinding-utils"

const SECTIONS = [
  "general",
  "appearance",
  "terminal",
  "editor",
  "sftp",
  "connections",
  "security",
  "license",
  // "team",
  // "keyboard",
  "updates",
  "about",
] as const

type Section = (typeof SECTIONS)[number]

function SecuritySettings() {
  const qc = useQueryClient()
  const lockQuery = useQuery({
    queryKey: ["settings", "lockOnStartup"],
    queryFn: async () => (await ipc.settingsGet("lockOnStartup")) === true,
  })
  const toggleLock = useMutation({
    mutationFn: async (newValue: boolean) => {
      await ipc.settingsSet("lockOnStartup", newValue)
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["settings", "lockOnStartup"] })
    },
  })

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-semibold">Security & Encryption</h2>
        <p className="text-muted-foreground mt-1 text-xs">
          Manage your master vault password and security options.
        </p>
      </div>
      <div className="space-y-4 pt-4 border-t border-border max-w-lg">
        <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
          <div className="space-y-0.5">
            <label className="text-sm font-medium cursor-pointer" htmlFor="lock-on-startup">
              Require Master Password on launch
            </label>
            <p className="text-muted-foreground text-xs">
              When enabled, SSHBool will lock the vault and ask for your password every time you open the app.
            </p>
          </div>
          <Switch
            id="lock-on-startup"
            checked={lockQuery.data ?? false}
            onCheckedChange={(checked) => toggleLock.mutate(checked)}
          />
        </div>

        <div className="pt-2">
          <Button size="sm" variant="outline" onClick={() => void ipc.vaultLock()}>
            Lock vault now
          </Button>
        </div>
      </div>
    </div>
  )
}


export function SettingsPanel({ initial = "general" }: { initial?: Section }) {
  const [section, setSection] = useState<Section>(initial)
  const qc = useQueryClient()

  const density = useQuery({
    queryKey: ["settings", "density"],
    queryFn: () => ipc.settingsGet("density"),
  })

  const setDensity = useMutation({
    mutationFn: (value: string) => ipc.settingsSet("density", value),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings"] }),
  })
  const prune = useMutation({
    mutationFn: () => ipc.retentionPrune(30),
  })

  return (
    <div className="flex h-full">
      <aside className="border-border w-48 shrink-0 overflow-y-auto border-r p-2">
        {SECTIONS.map((s) => (
          <button
            key={s}
            type="button"
            className={`hover:bg-muted/60 w-full rounded-md px-2 py-1.5 text-left text-sm capitalize ${section === s ? "bg-muted" : ""
              }`}
            onClick={() => setSection(s)}
          >
            {s}
          </button>
        ))}
      </aside>
      <div className="min-w-0 flex-1 overflow-y-auto p-4 text-sm">
        {section === "general" && (
          <div className="space-y-3">
            <h2 className="font-semibold">General</h2>
            <label className="flex items-center gap-2">
              Density
              <Select
                value={String(density.data ?? "comfortable")}
                onValueChange={(v) => {
                  if (v) setDensity.mutate(v)
                }}
              >
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="comfortable">Comfortable</SelectItem>
                  <SelectItem value="compact">Compact</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <Button size="sm" variant="outline" onClick={() => prune.mutate()}>
              Prune old metrics/audit (30d)
            </Button>
            {prune.data && (
              <pre className="bg-muted rounded-md p-2 text-xs">{JSON.stringify(prune.data, null, 2)}</pre>
            )}
          </div>
        )}
        {section === "appearance" && (
          <AppearanceSettings />
        )}
        {section === "license" && (
          <LicenseSettings />
        )}
        {section === "about" && (
          <AboutSettings />
        )}
        {section === "updates" && (
          <UpdatesSettings />
        )}
        {section === "security" && (
          <SecuritySettings />
        )}
        {section === "terminal" && (
          <TerminalSettings />
        )}
        {section === "connections" && <ConnectionsSettings />}
        {section === "editor" && <EditorSettingsPanel />}
        {section === "sftp" && <SftpSettingsPanel />}
        {section === "keyboard" && <KeyboardSettingsPanel />}
        {!["general", "appearance", "terminal", "about", "updates", "security", "license", "team", "connections", "editor", "sftp", "keyboard"].includes(
          section,
        ) && (
            <div>
              <h2 className="font-semibold capitalize">{section}</h2>
              <p className="text-muted-foreground mt-2 text-xs">
                Settings for {section} are available and persisted via settings_get/set.
              </p>
            </div>
          )}
      </div>
    </div>
  )
}

function HostRailSettings() {
  const mode = useLayoutStore((s) => s.hostRailMode)
  const width = useLayoutStore((s) => s.hostRailWidth[s.hostRailMode])
  const setHostRailMode = useLayoutStore((s) => s.setHostRailMode)
  const setHostRailWidth = useLayoutStore((s) => s.setHostRailWidth)
  const bounds = HOST_RAIL_SIZING[mode]

  return (
    <div className="space-y-3 max-w-md">
      <div>
        <h3 className="text-sm font-semibold">Host Rail</h3>
        <p className="text-muted-foreground mt-1 text-xs mb-3">
          Show hosts as compact icons, or as horizontal tabs labelled with the
          server name. Drag the rail's right edge to resize it — each style
          remembers its own width.
        </p>
      </div>

      <div className="space-y-3">
        <label className="flex items-center gap-3 text-xs font-medium">
          <span className="w-12 shrink-0">Style</span>
          <Select
            value={mode}
            onValueChange={(v) => {
              if (v !== "icon" && v !== "label") return
              setHostRailMode(v)
              saveHostRailPrefs()
            }}
          >
            <SelectTrigger className="w-40 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="icon">Icons</SelectItem>
              <SelectItem value="label">Server names</SelectItem>
            </SelectContent>
          </Select>
        </label>

        <label className="flex items-center gap-3 text-xs font-medium">
          <span className="w-12 shrink-0">Width</span>
          <input
            type="range"
            className="flex-1 accent-primary"
            min={bounds.min}
            max={bounds.max}
            step={2}
            value={width}
            aria-label="Host rail width"
            onChange={(e) => setHostRailWidth(mode, Number(e.target.value))}
            onPointerUp={() => saveHostRailPrefs()}
            onKeyUp={() => saveHostRailPrefs()}
          />
          <span className="text-muted-foreground w-10 shrink-0 text-right font-mono text-xs">
            {width}px
          </span>
        </label>
      </div>
    </div>
  )
}

function AppearanceSettings() {
  const { theme, setTheme, resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const qc = useQueryClient()

  useEffect(() => setMounted(true), [])

  const appFontQuery = useQuery({
    queryKey: ["settings", "appFont"],
    queryFn: () => ipc.settingsGet("appFont") as Promise<string | null>,
  })
  const [appFont, setAppFont] = useState("")
  useEffect(() => {
    if (appFontQuery.data !== undefined) setAppFont(appFontQuery.data ?? "")
  }, [appFontQuery.data])
  const saveFont = useMutation({
    mutationFn: async () => {
      await ipc.settingsSet("appFont", appFont || null)
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["settings"] })
    },
  })
  const options = [
    { id: "system" as const, label: "System", hint: "Follow OS light/dark", icon: Monitor },
    { id: "light" as const, label: "Light", hint: "Always light", icon: Sun },
    { id: "dark" as const, label: "Dark", hint: "Always dark", icon: Moon },
  ]

  function choose(id: "system" | "light" | "dark") {
    setTheme(id)
    void ipc.settingsSet("theme", id).then(() => {
      void qc.invalidateQueries({ queryKey: ["settings"] })
    })
  }

  const current = mounted ? (theme ?? "system") : "system"
  const POPULAR_FONTS = ["Inter", "Roboto", "Outfit", "Cairo", "Tajawal"]

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div>
          <h2 className="font-semibold">Appearance</h2>
          <p className="text-muted-foreground mt-1 text-xs">
            Theme follows your system by default. Change it here or via the title-bar icon.
            Press <kbd className="bg-muted rounded px-1">d</kbd> to flip light/dark quickly.
          </p>
        </div>
        <div className="grid max-w-lg gap-2 sm:grid-cols-3">
          {options.map(({ id, label, hint, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => choose(id)}
              className={cn(
                "hover:bg-muted/60 flex flex-col items-start gap-1 rounded-lg border px-3 py-3 text-left transition-colors",
                current === id ? "border-primary bg-muted/80" : "border-border",
              )}
            >
              <Icon className="text-muted-foreground size-4" />
              <span className="text-sm font-medium">{label}</span>
              <span className="text-muted-foreground text-[11px]">{hint}</span>
            </button>
          ))}
        </div>
        {mounted && (
          <p className="text-muted-foreground text-xs">
            Active: <span className="text-foreground font-medium">{current}</span>
            {current === "system" && resolvedTheme ? ` → ${resolvedTheme}` : null}
          </p>
        )}
      </div>

      <div className="space-y-4 pt-4 border-t border-border">
        <HostRailSettings />
      </div>

      <div className="space-y-4 pt-4 border-t border-border">
        <FontSelector
          label="App Font (Google Fonts)"
          description="Select a popular UI font or type any Google Font name to apply it to the whole app."
          value={appFont}
          onChange={setAppFont}
          onSave={() => saveFont.mutate()}
          isSaving={saveFont.isPending}
          popularFonts={POPULAR_FONTS}
        />
      </div>
    </div>
  )
}

function TerminalSettings() {
  const qc = useQueryClient()
  const terminalFontQuery = useQuery({
    queryKey: ["settings", "terminalFont"],
    queryFn: () => ipc.settingsGet("terminalFont") as Promise<string | null>,
  })
  const clipboardQuery = useQuery({
    queryKey: ["settings", "terminalClipboard"],
    queryFn: async () => {
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
    },
  })

  const [terminalFont, setTerminalFont] = useState("")
  const [copyShortcut, setCopyShortcut] = useState(DEFAULT_TERMINAL_CLIPBOARD_SETTINGS.copyShortcut)
  const [pasteShortcut, setPasteShortcut] = useState(DEFAULT_TERMINAL_CLIPBOARD_SETTINGS.pasteShortcut)
  const [altCopyShortcut, setAltCopyShortcut] = useState(DEFAULT_TERMINAL_CLIPBOARD_SETTINGS.altCopyShortcut)
  const [altPasteShortcut, setAltPasteShortcut] = useState(DEFAULT_TERMINAL_CLIPBOARD_SETTINGS.altPasteShortcut)
  const [shortcutError, setShortcutError] = useState<string | null>(null)

  useEffect(() => {
    if (terminalFontQuery.data !== undefined) setTerminalFont(terminalFontQuery.data ?? "")
  }, [terminalFontQuery.data])

  useEffect(() => {
    if (!clipboardQuery.data) return
    setCopyShortcut(clipboardQuery.data.copyShortcut)
    setPasteShortcut(clipboardQuery.data.pasteShortcut)
    setAltCopyShortcut(clipboardQuery.data.altCopyShortcut)
    setAltPasteShortcut(clipboardQuery.data.altPasteShortcut)
  }, [clipboardQuery.data])

  const saveFont = useMutation({
    mutationFn: async () => {
      await ipc.settingsSet("terminalFont", terminalFont || null)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings"] }),
  })
  const toggleContextMenu = useMutation({
    mutationFn: async (enabled: boolean) => {
      await ipc.settingsSet("terminalContextMenu", enabled)
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["settings", "terminalClipboard"] })
    },
  })
  const saveShortcuts = useMutation({
    mutationFn: async () => {
      const next = [copyShortcut, pasteShortcut, altCopyShortcut, altPasteShortcut]
      if (next.some((value) => !isValidKeybinding(value.trim()))) {
        throw new Error("Invalid shortcut. Example: Ctrl+Shift+C")
      }
      await ipc.settingsSet("terminalCopyShortcut", copyShortcut.trim())
      await ipc.settingsSet("terminalPasteShortcut", pasteShortcut.trim())
      await ipc.settingsSet("terminalAltCopyShortcut", altCopyShortcut.trim())
      await ipc.settingsSet("terminalAltPasteShortcut", altPasteShortcut.trim())
    },
    onSuccess: () => {
      setShortcutError(null)
      void qc.invalidateQueries({ queryKey: ["settings", "terminalClipboard"] })
    },
    onError: (error) => {
      setShortcutError(error instanceof Error ? error.message : String(error))
    },
  })

  const POPULAR_FONTS = ["JetBrains Mono", "Fira Code", "Source Code Pro", "Ubuntu Mono", "Inconsolata"]
  const clipboard = clipboardQuery.data ?? DEFAULT_TERMINAL_CLIPBOARD_SETTINGS

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div>
          <h2 className="font-semibold">Terminal</h2>
          <p className="text-muted-foreground mt-1 text-xs">
            PuTTY-style mouse: left-click selects and keeps the highlight; right-click copies the selection or pastes when nothing is selected.
          </p>
        </div>
      </div>
      <div className="space-y-4 pt-4 border-t border-border max-w-lg">
        <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
          <div className="space-y-0.5">
            <label className="text-sm font-medium cursor-pointer" htmlFor="terminal-context-menu">
              Right-click menu (instead of PuTTY mode)
            </label>
            <p className="text-muted-foreground text-xs">
              When enabled, right-click opens a Copy / Paste menu instead of copying or pasting immediately.
            </p>
          </div>
          <Switch
            id="terminal-context-menu"
            checked={clipboard.contextMenu}
            onCheckedChange={(checked) => toggleContextMenu.mutate(checked)}
          />
        </div>

        <div className="space-y-3 rounded-lg border p-4">
          <div>
            <h3 className="text-sm font-medium">Keyboard shortcuts</h3>
            <p className="text-muted-foreground mt-1 text-xs">
              Defaults follow common terminal tools. {formatKeybindingForDisplay(clipboard.altCopyShortcut)} copies only when text is selected; otherwise it sends interrupt (SIGINT).
            </p>
          </div>
          <label className="block space-y-1.5 text-sm">
            <span>Copy selection</span>
            <input
              value={copyShortcut}
              onChange={(e) => setCopyShortcut(e.target.value)}
              className="border-input bg-background focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2"
              placeholder="Ctrl+Shift+C"
            />
          </label>
          <label className="block space-y-1.5 text-sm">
            <span>Paste</span>
            <input
              value={pasteShortcut}
              onChange={(e) => setPasteShortcut(e.target.value)}
              className="border-input bg-background focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2"
              placeholder="Ctrl+Shift+V"
            />
          </label>
          <label className="block space-y-1.5 text-sm">
            <span>Alt copy (selection only, otherwise interrupt)</span>
            <input
              value={altCopyShortcut}
              onChange={(e) => setAltCopyShortcut(e.target.value)}
              className="border-input bg-background focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2"
              placeholder="Ctrl+C"
            />
          </label>
          <label className="block space-y-1.5 text-sm">
            <span>Alt paste</span>
            <input
              value={altPasteShortcut}
              onChange={(e) => setAltPasteShortcut(e.target.value)}
              className="border-input bg-background focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2"
              placeholder="Ctrl+V"
            />
          </label>
          {shortcutError && <p className="text-destructive text-xs">{shortcutError}</p>}
          <Button size="sm" onClick={() => saveShortcuts.mutate()} disabled={saveShortcuts.isPending}>
            Save shortcuts
          </Button>
        </div>

        <FontSelector
          label="Terminal Font (Google Fonts)"
          description="Select a popular coding font or type any Google Font name for the terminal."
          value={terminalFont}
          onChange={setTerminalFont}
          onSave={() => saveFont.mutate()}
          isSaving={saveFont.isPending}
          popularFonts={POPULAR_FONTS}
        />
      </div>
    </div>
  )
}
