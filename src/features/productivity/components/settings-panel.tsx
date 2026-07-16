import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Monitor, Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { ipc } from "@/lib/ipc/commands"
import { cn } from "@/lib/utils"

const SECTIONS = [
  "general",
  "appearance",
  "terminal",
  "editor",
  "sftp",
  "connections",
  "security",
  "license",
  "team",
  "keys",
  "keyboard",
  "updates",
  "about",
] as const

type Section = (typeof SECTIONS)[number]

export function SettingsPanel({ initial = "general" }: { initial?: Section }) {
  const [section, setSection] = useState<Section>(initial)
  const [token, setToken] = useState('dev:{"tier":"pro","expiresAt":null}')
  const [invite, setInvite] = useState("")
  const qc = useQueryClient()

  const info = useQuery({ queryKey: ["app-info"], queryFn: () => ipc.appInfo() })
  const density = useQuery({
    queryKey: ["settings", "density"],
    queryFn: () => ipc.settingsGet("density"),
  })
  const license = useQuery({ queryKey: ["license"], queryFn: () => ipc.licenseStatus() })
  const team = useQuery({ queryKey: ["team"], queryFn: () => ipc.teamStatus() })

  const setDensity = useMutation({
    mutationFn: (value: string) => ipc.settingsSet("density", value),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings"] }),
  })
  const activate = useMutation({
    mutationFn: () => ipc.licenseActivate(token),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["license"] }),
  })
  const clearLicense = useMutation({
    mutationFn: () => ipc.licenseClear(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["license"] }),
  })
  const joinTeam = useMutation({
    mutationFn: () => ipc.teamJoinStub(invite),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["team"] }),
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
            className={`hover:bg-muted/60 w-full rounded-md px-2 py-1.5 text-left text-sm capitalize ${
              section === s ? "bg-muted" : ""
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
              <select
                className="border-input bg-background rounded-md border px-2 py-1"
                value={String(density.data ?? "comfortable")}
                onChange={(e) => setDensity.mutate(e.target.value)}
              >
                <option value="comfortable">Comfortable</option>
                <option value="compact">Compact</option>
              </select>
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
          <div className="space-y-3">
            <h2 className="font-semibold">License / Upgrade</h2>
            <pre className="bg-muted rounded-md p-2 font-mono text-xs">
              {JSON.stringify(license.data ?? {}, null, 2)}
            </pre>
            <p className="text-muted-foreground text-xs">
              Free includes core SSH/SFTP/terminal/keys (up to 10 hosts). Pro unlocks sync, AI,
              dashboard extras. Use a <code>dev:{"{...}"}</code> token for local testing.
            </p>
            <textarea
              className="border-input bg-background min-h-16 w-full rounded-md border px-2 py-1 font-mono text-xs"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={() => activate.mutate()}>
                Activate
              </Button>
              <Button size="sm" variant="outline" onClick={() => clearLicense.mutate()}>
                Clear (Free)
              </Button>
            </div>
            {activate.isError && (
              <p className="text-destructive text-xs">{(activate.error as Error).message}</p>
            )}
          </div>
        )}
        {section === "team" && (
          <div className="space-y-3">
            <h2 className="font-semibold">Team</h2>
            <pre className="bg-muted rounded-md p-2 font-mono text-xs">
              {JSON.stringify(team.data ?? {}, null, 2)}
            </pre>
            <input
              className="border-input bg-background w-full rounded-md border px-2 py-1 text-xs"
              placeholder="Invite code"
              value={invite}
              onChange={(e) => setInvite(e.target.value)}
            />
            <Button size="sm" disabled={!invite} onClick={() => joinTeam.mutate()}>
              Join (stub)
            </Button>
            {joinTeam.isError && (
              <p className="text-destructive text-xs">{(joinTeam.error as Error).message}</p>
            )}
          </div>
        )}
        {section === "about" && (
          <div className="space-y-2">
            <h2 className="font-semibold">About</h2>
            <p>
              {info.data?.name ?? "SSHBool"} {info.data?.version ?? "0.1.0"}
            </p>
            <p className="text-muted-foreground text-xs">
              Tauri {info.data?.tauriVersion ?? "2"}
            </p>
          </div>
        )}
        {section === "updates" && (
          <div className="space-y-2">
            <h2 className="font-semibold">Updates</h2>
            <p className="text-muted-foreground text-xs">
              Auto-update is wired via Tauri updater plugin (stable channel).
            </p>
            <Button size="sm" variant="outline" disabled>
              Check for updates
            </Button>
          </div>
        )}
        {section === "security" && (
          <div className="space-y-2">
            <h2 className="font-semibold">Security</h2>
            <Button size="sm" variant="outline" onClick={() => void ipc.vaultLock()}>
              Lock vault now
            </Button>
          </div>
        )}
        {!["general", "appearance", "about", "updates", "security", "license", "team"].includes(
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

function AppearanceSettings() {
  const { theme, setTheme, resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const qc = useQueryClient()

  useEffect(() => setMounted(true), [])

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

  return (
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
  )
}
