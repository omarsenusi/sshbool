import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, Check, Download, KeyRound, Loader2 } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { hostKey, toNewHost } from "@/features/connections/import-mapping"
import { ipc } from "@/lib/ipc/commands"
import type { ImportPreview, ImportSourceInfo } from "@/lib/ipc/types"
import { cn } from "@/lib/utils"
import { toast } from "@/stores/toast.store"

/** Availability is a Rust enum: a bare string, or an object for NeedsInput. */
function needsInputReason(source: ImportSourceInfo): string | null {
  const a = source.availability
  return typeof a === "object" && a !== null && "needsInput" in a
    ? a.needsInput.reason
    : null
}

function isReady(source: ImportSourceInfo): boolean {
  return source.availability === "ready"
}

function isNotFound(source: ImportSourceInfo): boolean {
  return source.availability === "notFound"
}

export function ImportPanel() {
  const qc = useQueryClient()
  const [sourceId, setSourceId] = useState<string | null>(null)
  const [manualKey, setManualKey] = useState("")
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [skipHosts, setSkipHosts] = useState<Set<string>>(new Set())
  const [skipKeys, setSkipKeys] = useState<Set<string>>(new Set())
  const [skipSnippets, setSkipSnippets] = useState<Set<string>>(new Set())

  const sources = useQuery({
    queryKey: ["import", "sources"],
    queryFn: () => ipc.importSources(),
    staleTime: 30_000,
  })

  // Preselect the first source that is actually usable.
  useEffect(() => {
    if (sourceId || !sources.data?.length) return
    setSourceId((sources.data.find((s) => !isNotFound(s)) ?? sources.data[0]).id)
  }, [sources.data, sourceId])

  const source = sources.data?.find((s) => s.id === sourceId) ?? null

  const scan = useMutation({
    mutationFn: () => ipc.importScan(sourceId!, manualKey || undefined),
    onSuccess: (data) => {
      setPreview(data)
      setSkipHosts(new Set())
      setSkipKeys(new Set())
      setSkipSnippets(new Set())
    },
  })

  const selection = useMemo(() => {
    if (!preview) return { hosts: [], keys: [], snippets: [] }
    return {
      hosts: preview.hosts
        .filter((h) => !skipHosts.has(hostKey(h)))
        .map(toNewHost),
      keys: preview.keys.filter((k) => !skipKeys.has(k.label)),
      snippets: preview.snippets.filter((s) => !skipSnippets.has(s.label)),
    }
  }, [preview, skipHosts, skipKeys, skipSnippets])

  const total =
    selection.hosts.length + selection.keys.length + selection.snippets.length

  const commit = useMutation({
    mutationFn: () => ipc.importCommit(selection),
    meta: { suppressToast: true },
    onSuccess: async (result) => {
      await qc.invalidateQueries({ queryKey: ["hosts"] })
      await qc.invalidateQueries({ queryKey: ["keys"] })
      await qc.invalidateQueries({ queryKey: ["snippets"] })
      const parts = [
        result.hosts && `${result.hosts} host${result.hosts === 1 ? "" : "s"}`,
        result.keys && `${result.keys} key${result.keys === 1 ? "" : "s"}`,
        result.snippets && `${result.snippets} snippet${result.snippets === 1 ? "" : "s"}`,
      ].filter(Boolean)
      if (result.failures.length) {
        toast.error(
          `Imported ${parts.join(", ") || "nothing"}`,
          `${result.failures.length} item(s) failed — ${result.failures[0]}`,
        )
      } else {
        toast.success("Import complete", `Added ${parts.join(", ")}.`)
      }
      setPreview(null)
    },
  })

  function toggle(set: Set<string>, key: string): Set<string> {
    const next = new Set(set)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  }

  const reason = source ? needsInputReason(source) : null
  const keyRequired = !!reason || (source ? !isReady(source) : false)

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-semibold">Import</h2>
        <p className="text-muted-foreground mt-1 text-xs">
          Bring hosts, SSH keys and snippets across from another SSH client.
          Nothing is written to the other application — it is only read.
        </p>
      </div>

      {sources.isLoading && (
        <p className="text-muted-foreground flex items-center gap-2 text-xs">
          <Loader2 className="size-3.5 animate-spin" />
          Looking for installed clients…
        </p>
      )}

      <div className="grid max-w-2xl gap-2 sm:grid-cols-2">
        {(sources.data ?? []).map((s) => {
          const disabled = isNotFound(s)
          return (
            <button
              key={s.id}
              type="button"
              disabled={disabled}
              onClick={() => {
                setSourceId(s.id)
                setPreview(null)
              }}
              className={cn(
                "flex flex-col items-start gap-1 rounded-lg border px-3 py-3 text-left transition-colors",
                sourceId === s.id ? "border-primary bg-muted/80" : "border-border",
                disabled ? "cursor-not-allowed opacity-50" : "hover:bg-muted/60",
              )}
            >
              <span className="text-sm font-medium">{s.name}</span>
              <span className="text-muted-foreground text-[11px]">
                {disabled ? "Not installed on this machine" : s.description}
              </span>
              {s.detectedPath && (
                <span
                  className="text-muted-foreground/80 w-full truncate font-mono text-[10px]"
                  title={s.detectedPath}
                >
                  {s.detectedPath}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {source && !isNotFound(source) && (
        <div className="max-w-2xl space-y-3">
          {reason && (
            <div className="border-border bg-muted/40 flex gap-2 rounded-lg border p-3">
              <KeyRound className="text-muted-foreground mt-0.5 size-4 shrink-0" />
              <div className="min-w-0 flex-1 space-y-2">
                <p className="text-xs">{reason}</p>
                <input
                  type="password"
                  className="border-input bg-background w-full rounded-md border px-2 py-1.5 font-mono text-xs"
                  placeholder="Paste the encryption key (base64 or hex)"
                  value={manualKey}
                  onChange={(e) => setManualKey(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
            </div>
          )}

          <Button
            size="sm"
            disabled={scan.isPending || (keyRequired && !manualKey.trim())}
            onClick={() => scan.mutate()}
          >
            {scan.isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Download className="size-3.5" />
            )}
            {scan.isPending ? "Reading…" : `Scan ${source.name}`}
          </Button>

          {scan.isError && (
            <p className="text-destructive text-xs">
              {(scan.error as Error).message}
            </p>
          )}
        </div>
      )}

      {preview && (
        <div className="max-w-3xl space-y-4 border-t pt-4">
          {preview.warnings.map((w) => (
            <div
              key={w}
              className="flex gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <p className="text-xs leading-snug">{w}</p>
            </div>
          ))}

          <Section
            title="Hosts"
            count={selection.hosts.length}
            total={preview.hosts.length}
          >
            {preview.hosts.map((h) => {
              const key = hostKey(h)
              const skipped = skipHosts.has(key)
              return (
                <Row
                  key={key}
                  checked={!skipped}
                  onToggle={() => setSkipHosts((s) => toggle(s, key))}
                  title={h.label}
                  subtitle={`${h.username ? `${h.username}@` : ""}${h.hostname}:${h.port}`}
                  badge={
                    h.password ? (
                      <span className="text-emerald-600 dark:text-emerald-400">
                        password
                      </span>
                    ) : h.passwordConfidence === "ambiguous" ? (
                      <span
                        className="text-amber-600 dark:text-amber-400"
                        title={h.passwordNote ?? undefined}
                      >
                        password unclear
                      </span>
                    ) : null
                  }
                />
              )
            })}
          </Section>

          <Section
            title="SSH keys"
            count={selection.keys.length}
            total={preview.keys.length}
          >
            {preview.keys.map((k) => (
              <Row
                key={k.label}
                checked={!skipKeys.has(k.label)}
                onToggle={() => setSkipKeys((s) => toggle(s, k.label))}
                title={k.label}
                subtitle={k.passphrase ? "encrypted key" : "unencrypted key"}
              />
            ))}
          </Section>

          <Section
            title="Snippets"
            count={selection.snippets.length}
            total={preview.snippets.length}
          >
            {preview.snippets.map((s) => (
              <Row
                key={s.label}
                checked={!skipSnippets.has(s.label)}
                onToggle={() => setSkipSnippets((x) => toggle(x, s.label))}
                title={s.label}
                subtitle={s.script.split("\n")[0]?.slice(0, 60)}
              />
            ))}
          </Section>

          <div className="flex items-center gap-3 border-t pt-3">
            <Button
              size="sm"
              disabled={commit.isPending || total === 0}
              onClick={() => commit.mutate()}
            >
              {commit.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Check className="size-3.5" />
              )}
              Import {total} item{total === 1 ? "" : "s"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={commit.isPending}
              onClick={() => setPreview(null)}
            >
              Cancel
            </Button>
          </div>

          {commit.isError && (
            <p className="text-destructive text-xs">
              {(commit.error as Error).message}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function Section({
  title,
  count,
  total,
  children,
}: {
  title: string
  count: number
  total: number
  children: React.ReactNode
}) {
  if (total === 0) return null
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-medium">{title}</h3>
        <span className="text-muted-foreground text-[11px]">
          {count} of {total} selected
        </span>
      </div>
      <div className="border-border max-h-64 overflow-y-auto rounded-lg border">
        {children}
      </div>
    </div>
  )
}

function Row({
  checked,
  onToggle,
  title,
  subtitle,
  badge,
}: {
  checked: boolean
  onToggle: () => void
  title: string
  subtitle?: string
  badge?: React.ReactNode
}) {
  return (
    <label className="hover:bg-muted/40 flex cursor-pointer items-center gap-2.5 border-b px-3 py-1.5 last:border-b-0">
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="accent-primary size-3.5 shrink-0"
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium">{title}</span>
        {subtitle && (
          <span className="text-muted-foreground block truncate font-mono text-[10px]">
            {subtitle}
          </span>
        )}
      </span>
      {badge && <span className="shrink-0 text-[10px]">{badge}</span>}
    </label>
  )
}
