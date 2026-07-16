import { Loader2 } from "lucide-react"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"

export function RenameDialog({
  open,
  initial,
  title = "Rename",
  onClose,
  onSubmit,
}: {
  open: boolean
  initial: string
  title?: string
  onClose: () => void
  onSubmit: (name: string) => void | Promise<void>
}) {
  const [name, setName] = useState(initial)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setName(initial)
      setBusy(false)
    }
  }, [open, initial])

  async function submit() {
    const trimmed = name.trim()
    if (!trimmed || busy) return
    setBusy(true)
    try {
      await onSubmit(trimmed)
    } catch {
      setBusy(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="border-border bg-background w-full max-w-sm rounded-xl border p-4 shadow-lg">
        <h3 className="text-sm font-semibold">{title}</h3>
        <input
          autoFocus
          disabled={busy}
          className="border-input bg-background mt-3 w-full rounded-md border px-3 py-2 text-sm outline-none disabled:opacity-60"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit()
            if (e.key === "Escape" && !busy) onClose()
          }}
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button size="sm" variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" disabled={!name.trim() || busy} onClick={() => void submit()}>
            {busy && <Loader2 className="mr-1 size-3.5 animate-spin" />}
            Save
          </Button>
        </div>
      </div>
    </div>
  )
}

export function ConfirmDeleteDialog({
  open,
  names,
  isDir,
  onClose,
  onConfirm,
}: {
  open: boolean
  names: string[]
  isDir: boolean
  onClose: () => void
  onConfirm: () => void | Promise<void>
}) {
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) setBusy(false)
  }, [open])

  if (!open) return null
  const label = names.length === 1 ? `"${names[0]}"` : `${names.length} items`

  async function confirm() {
    if (busy) return
    setBusy(true)
    try {
      await onConfirm()
    } catch {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="border-border bg-background w-full max-w-sm rounded-xl border p-4 shadow-lg">
        <h3 className="text-sm font-semibold">Delete {label}?</h3>
        <p className="text-muted-foreground mt-2 text-xs">
          This cannot be undone.
          {isDir ? " Folders will be deleted recursively." : ""}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button size="sm" variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={busy}
            onClick={() => void confirm()}
          >
            {busy && <Loader2 className="mr-1 size-3.5 animate-spin" />}
            Delete
          </Button>
        </div>
      </div>
    </div>
  )
}

export function ChmodDialog({
  open,
  initial = "644",
  onClose,
  onSubmit,
}: {
  open: boolean
  initial?: string
  onClose: () => void
  onSubmit: (mode: number) => void | Promise<void>
}) {
  const [octal, setOctal] = useState(initial)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setOctal(initial)
      setBusy(false)
    }
  }, [open, initial])

  async function apply() {
    const n = Number.parseInt(octal, 8)
    if (Number.isNaN(n) || busy) return
    setBusy(true)
    try {
      await onSubmit(n)
    } catch {
      setBusy(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="border-border bg-background w-full max-w-sm rounded-xl border p-4 shadow-lg">
        <h3 className="text-sm font-semibold">Change permissions</h3>
        <p className="text-muted-foreground mt-1 text-xs">Octal mode, e.g. 755 or 644</p>
        <input
          autoFocus
          disabled={busy}
          className="border-input bg-background mt-3 w-full rounded-md border px-3 py-2 font-mono text-sm outline-none disabled:opacity-60"
          value={octal}
          onChange={(e) => setOctal(e.target.value)}
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button size="sm" variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" disabled={busy} onClick={() => void apply()}>
            {busy && <Loader2 className="mr-1 size-3.5 animate-spin" />}
            Apply
          </Button>
        </div>
      </div>
    </div>
  )
}
