import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog"
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  FileUp,
  KeyRound,
  Pencil,
  Trash2,
} from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { formatAppError, IpcError, ipc } from "@/lib/ipc/commands"
import type { GenerateKeyDto, SshKeyDto } from "@/lib/ipc/types"
import { cn } from "@/lib/utils"
import { toast } from "@/stores/toast.store"

function errMsg(e: unknown) {
  if (e instanceof IpcError) return formatAppError(e.appError)
  if (e instanceof Error) return e.message
  return String(e)
}

function shortFp(fp: string) {
  const clean = fp.replace(/^SHA256:/i, "")
  if (clean.length <= 20) return fp
  return `SHA256:${clean.slice(0, 10)}…${clean.slice(-10)}`
}

const fieldClass =
  "border-input bg-background placeholder:text-muted-foreground/70 w-full rounded-md border px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"

export function KeyManager() {
  const qc = useQueryClient()
  const [form, setForm] = useState<GenerateKeyDto>({
    name: "",
    keyType: "ed25519",
    comment: "",
    passphrase: "",
  })
  const [importName, setImportName] = useState("")
  const [importContent, setImportContent] = useState("")
  const [importPath, setImportPath] = useState<string | null>(null)
  const [passphrase, setPassphrase] = useState("")
  const [showPaste, setShowPaste] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState("")

  const keys = useQuery({ queryKey: ["keys"], queryFn: () => ipc.keysList() })

  const generate = useMutation({
    mutationFn: () =>
      ipc.keysGenerate({
        ...form,
        comment: form.comment?.trim() || undefined,
        passphrase: form.passphrase?.trim() || undefined,
      }),
    onSuccess: async (key) => {
      setForm({ name: "", keyType: "ed25519", comment: "", passphrase: "" })
      void qc.invalidateQueries({ queryKey: ["keys"] })
      setExpandedId(key.id)
      try {
        await navigator.clipboard.writeText(key.publicKey)
        toast.success("Key generated", `${key.name} — public key copied`)
      } catch {
        toast.success("Key generated", key.name)
      }
    },
  })

  const importKey = useMutation({
    mutationFn: async () => {
      const name = importName.trim()
      if (importPath) {
        return ipc.keysImportFile(importPath, name || undefined, passphrase || undefined)
      }
      if (!name) throw new Error("Name required")
      return ipc.keysImport(importContent, name, passphrase || undefined)
    },
    onSuccess: (key) => {
      setImportContent("")
      setImportName("")
      setImportPath(null)
      setPassphrase("")
      setShowPaste(false)
      void qc.invalidateQueries({ queryKey: ["keys"] })
      setExpandedId(key.id)
      toast.success("Key imported", key.name)
    },
  })

  const remove = useMutation({
    mutationFn: (id: string) => ipc.keysDelete(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["keys"] })
      toast.success("Key deleted")
    },
  })

  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => ipc.keysRename(id, name),
    onSuccess: () => {
      setRenamingId(null)
      void qc.invalidateQueries({ queryKey: ["keys"] })
      toast.success("Key renamed")
    },
  })

  async function pickPrivateKeyFile() {
    try {
      const picked = await openDialog({
        multiple: false,
        title: "Select OpenSSH private key",
        filters: [
          { name: "All files", extensions: ["*"] },
          { name: "Private key", extensions: ["pem", "key", "ppk"] },
        ],
      })
      if (!picked || Array.isArray(picked)) return

      const path = picked
      const base = path.replace(/\\/g, "/").split("/").pop() || path
      if (/\.pub$/i.test(base)) {
        toast.error(
          "Public key selected",
          "Choose the private key (same name, usually without .pub).",
        )
        return
      }

      setImportPath(path)
      setImportContent("")
      setShowPaste(false)
      if (!importName.trim()) {
        setImportName(base.replace(/\.(pem|key|ppk)$/i, ""))
      }
      toast.info("Private key selected", base)
    } catch (e) {
      toast.error("Could not open file picker", errMsg(e))
    }
  }

  async function copyPublic(id: string) {
    try {
      const r = await ipc.keysCopyPublic(id)
      await navigator.clipboard.writeText(r.openssh)
      toast.success("Public key copied")
    } catch (e) {
      toast.error("Copy failed", errMsg(e))
    }
  }

  async function exportPrivate(key: SshKeyDto) {
    const master = window.prompt(
      `Export private key “${key.name}”?\nRe-enter your vault master password to confirm:`,
    )
    if (master == null) return
    if (!master.trim()) {
      toast.error("Password required", "Master password is required to export a private key.")
      return
    }
    try {
      const path = await saveDialog({
        title: "Save private key",
        defaultPath: key.name,
        filters: [
          { name: "Private key", extensions: ["pem", "key"] },
          { name: "All files", extensions: ["*"] },
        ],
      })
      if (!path) return
      await ipc.keysExportPrivateFile(key.id, master, path)
      toast.success("Private key saved", path)
    } catch (e) {
      toast.error("Export failed", errMsg(e))
    }
  }

  const canImport = !!importPath || (!!importContent.trim() && !!importName.trim())
  const keyCount = keys.data?.length ?? 0

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <header className="border-border flex shrink-0 items-end justify-between gap-4 border-b px-5 py-3.5">
        <div>
          <h2 className="text-base font-semibold tracking-tight">SSH Key Manager</h2>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Keys stay encrypted in your vault. Copy the public key into{" "}
            <code className="font-mono text-[11px]">authorized_keys</code>.
          </p>
        </div>
        <div className="text-muted-foreground shrink-0 text-right text-[11px]">
          <div className="text-foreground text-lg font-semibold tabular-nums leading-none">
            {keyCount}
          </div>
          <div className="mt-0.5 uppercase tracking-wider">in vault</div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Actions rail — full height, not floating in the middle */}
        <aside className="border-border bg-muted/15 flex w-[340px] shrink-0 flex-col gap-0 overflow-y-auto border-r">
          <section className="border-border space-y-3 border-b p-4">
            <div className="flex items-center gap-2 text-[11px] font-semibold tracking-wide uppercase">
              <KeyRound className="text-primary size-3.5" />
              Generate
            </div>
            <label className="block space-y-1">
              <span className="text-muted-foreground text-[11px]">Name</span>
              <input
                className={fieldClass}
                placeholder="laptop-ed25519"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-muted-foreground text-[11px]">Type</span>
              <Select
                value={form.keyType}
                onValueChange={(v) => {
                  if (!v) return
                  setForm({
                    ...form,
                    keyType: v as GenerateKeyDto["keyType"],
                  })
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ed25519">Ed25519 (recommended)</SelectItem>
                  <SelectItem value="rsa">RSA 4096</SelectItem>
                  <SelectItem value="ecdsa">ECDSA P-256</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label className="block space-y-1">
              <span className="text-muted-foreground text-[11px]">Comment</span>
              <input
                className={fieldClass}
                placeholder="optional"
                value={form.comment ?? ""}
                onChange={(e) => setForm({ ...form, comment: e.target.value })}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-muted-foreground text-[11px]">Passphrase</span>
              <input
                type="password"
                className={fieldClass}
                placeholder="optional"
                value={form.passphrase ?? ""}
                onChange={(e) => setForm({ ...form, passphrase: e.target.value })}
                autoComplete="new-password"
              />
            </label>
            <Button
              size="sm"
              className="w-full"
              disabled={!form.name.trim() || generate.isPending}
              onClick={() => generate.mutate()}
            >
              {generate.isPending ? "Generating…" : "Generate key"}
            </Button>
            {generate.isError && (
              <p className="text-destructive text-xs">{errMsg(generate.error)}</p>
            )}
          </section>

          <section className="flex flex-1 flex-col space-y-3 p-4">
            <div className="flex items-center gap-2 text-[11px] font-semibold tracking-wide uppercase">
              <FileUp className="text-primary size-3.5" />
              Import private key
            </div>
            <p className="text-muted-foreground text-[11px] leading-relaxed">
              Choose the <span className="text-foreground font-medium">private</span> file
              (often no extension) — not <code className="font-mono">*.pub</code>.
            </p>
            <label className="block space-y-1">
              <span className="text-muted-foreground text-[11px]">Name in vault</span>
              <input
                className={fieldClass}
                placeholder="from file name if empty"
                value={importName}
                onChange={(e) => setImportName(e.target.value)}
              />
            </label>
            <div className="flex flex-col gap-2">
              <Button
                size="sm"
                variant="outline"
                type="button"
                className="w-full justify-start"
                onClick={() => void pickPrivateKeyFile()}
              >
                <FileUp className="size-3.5" />
                Choose private key file
              </Button>
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground text-left text-[11px] underline-offset-2 hover:underline"
                onClick={() => {
                  setShowPaste((v) => !v)
                  if (showPaste) setImportContent("")
                }}
              >
                {showPaste ? "Hide paste box" : "Or paste PEM instead"}
              </button>
            </div>
            {importPath && (
              <div className="bg-background border-border flex items-center gap-2 rounded-md border px-2.5 py-2 text-[11px]">
                <Check className="size-3.5 shrink-0 text-emerald-500" />
                <span className="min-w-0 truncate font-mono" title={importPath}>
                  {importPath}
                </span>
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground ml-auto shrink-0"
                  onClick={() => setImportPath(null)}
                >
                  Clear
                </button>
              </div>
            )}
            {showPaste && (
              <textarea
                className={cn(fieldClass, "min-h-28 font-mono text-xs")}
                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                value={importContent}
                onChange={(e) => {
                  setImportContent(e.target.value)
                  setImportPath(null)
                }}
                spellCheck={false}
              />
            )}
            <label className="block space-y-1">
              <span className="text-muted-foreground text-[11px]">Key passphrase</span>
              <input
                type="password"
                className={fieldClass}
                placeholder="if the file is encrypted"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                autoComplete="off"
              />
            </label>
            <Button
              size="sm"
              className="mt-auto w-full"
              variant="outline"
              disabled={!canImport || importKey.isPending}
              onClick={() => {
                if (!importPath && !importName.trim()) {
                  toast.error("Name required", "Give the key a name before importing.")
                  return
                }
                importKey.mutate()
              }}
            >
              {importKey.isPending ? "Importing…" : "Import into vault"}
            </Button>
            {importKey.isError && (
              <p className="text-destructive text-xs">{errMsg(importKey.error)}</p>
            )}
          </section>
        </aside>

        {/* Keys fill the rest of the window */}
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="border-border text-muted-foreground flex shrink-0 items-center justify-between border-b px-5 py-2.5 text-[11px] font-semibold tracking-wider uppercase">
            <span>Vault keys</span>
            <span className="font-mono normal-case tracking-normal opacity-70">
              {keyCount} stored
            </span>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {keys.isLoading && (
              <p className="text-muted-foreground px-1 text-xs">Loading keys…</p>
            )}
            {keys.data?.length === 0 && (
              <div className="border-border text-muted-foreground flex h-full min-h-48 flex-col items-center justify-center rounded-xl border border-dashed px-6 text-center">
                <KeyRound className="mb-3 size-8 opacity-30" />
                <p className="text-sm font-medium text-foreground/80">No keys yet</p>
                <p className="mt-1 max-w-sm text-xs">
                  Generate a new key on the left, or import an existing OpenSSH private key.
                </p>
              </div>
            )}
            <ul className="space-y-2">
              {keys.data?.map((k) => {
                const open = expandedId === k.id
                const renaming = renamingId === k.id
                return (
                  <li
                    key={k.id}
                    className={cn(
                      "border-border bg-card overflow-hidden rounded-xl border transition-shadow",
                      open && "ring-primary/20 shadow-sm ring-1",
                    )}
                  >
                    <div className="flex items-start gap-2 px-3 py-3">
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-foreground mt-0.5 shrink-0 rounded p-0.5"
                        onClick={() => setExpandedId(open ? null : k.id)}
                        aria-label={open ? "Collapse" : "Expand"}
                      >
                        {open ? (
                          <ChevronDown className="size-4" />
                        ) : (
                          <ChevronRight className="size-4" />
                        )}
                      </button>
                      <div className="min-w-0 flex-1">
                        {renaming ? (
                          <form
                            className="flex flex-wrap gap-2"
                            onSubmit={(e) => {
                              e.preventDefault()
                              if (!renameValue.trim()) return
                              rename.mutate({ id: k.id, name: renameValue.trim() })
                            }}
                          >
                            <input
                              className={cn(fieldClass, "min-w-0 flex-1 py-1.5")}
                              value={renameValue}
                              onChange={(e) => setRenameValue(e.target.value)}
                              autoFocus
                            />
                            <Button size="xs" type="submit" disabled={rename.isPending}>
                              Save
                            </Button>
                            <Button
                              size="xs"
                              variant="ghost"
                              type="button"
                              onClick={() => setRenamingId(null)}
                            >
                              Cancel
                            </Button>
                          </form>
                        ) : (
                          <button
                            type="button"
                            className="block w-full truncate text-left text-sm font-semibold hover:underline"
                            onClick={() => setExpandedId(open ? null : k.id)}
                          >
                            {k.name}
                          </button>
                        )}
                        <div className="text-muted-foreground mt-1.5 flex flex-wrap items-center gap-1.5 font-mono text-[11px]">
                          <span className="bg-muted rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                            {k.keyType}
                          </span>
                          <span className="opacity-80" title={k.fingerprintSha256}>
                            {shortFp(k.fingerprintSha256)}
                          </span>
                          {k.hasPassphrase && (
                            <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-600 dark:text-amber-400">
                              passphrase
                            </span>
                          )}
                          <span className="opacity-50">{k.source}</span>
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-0.5">
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          title="Copy public key"
                          onClick={() => void copyPublic(k.id)}
                        >
                          <Copy className="size-3.5" />
                        </Button>
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          title="Rename"
                          onClick={() => {
                            setRenamingId(k.id)
                            setRenameValue(k.name)
                          }}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          title="Delete"
                          className="hover:text-destructive"
                          onClick={() => {
                            if (
                              window.confirm(
                                `Delete key “${k.name}”? Hosts using it will need another key.`,
                              )
                            ) {
                              remove.mutate(k.id)
                            }
                          }}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </div>
                    {open && (
                      <div className="border-border bg-muted/25 border-t px-4 py-3">
                        <div className="text-muted-foreground mb-1.5 text-[10px] font-semibold tracking-wide uppercase">
                          Public key
                        </div>
                        <pre className="bg-background border-border max-h-32 overflow-auto rounded-lg border p-3 font-mono text-[11px] leading-relaxed break-all whitespace-pre-wrap">
                          {k.publicKey}
                        </pre>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button size="sm" variant="outline" onClick={() => void copyPublic(k.id)}>
                            <Copy className="size-3.5" />
                            Copy public
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => void exportPrivate(k)}>
                            Export private…
                          </Button>
                        </div>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        </main>
      </div>
    </div>
  )
}
