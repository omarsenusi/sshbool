import { useState } from "react"
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow"
import { Minus, Square, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { formatAppError, IpcError, ipc } from "@/lib/ipc/commands"
import { useVaultStore } from "@/stores/vault.store"

export function UnlockScreen() {
  const setStatus = useVaultStore((s) => s.setStatus)
  const status = useVaultStore((s) => s.status)
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const win = getCurrentWebviewWindow()

  const initialized = status?.initialized ?? false

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      if (!initialized) {
        if (password.length < 6) {
          setError("Password must be at least 6 characters")
          return
        }
        if (password !== confirm) {
          setError("Passwords do not match")
          return
        }
        await ipc.vaultInit(password)
      } else {
        await ipc.vaultUnlock(password)
      }
      setStatus(await ipc.vaultStatus())
      setPassword("")
      setConfirm("")
    } catch (err) {
      setError(
        err instanceof IpcError ? formatAppError(err.appError) : String(err)
      )
    } finally {
      setBusy(false)
    }
  }

  const handleStartDrag = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    // Ignore drag when clicking inputs, buttons, etc.
    if (
      target.closest("button") ||
      target.closest("input") ||
      target.closest("form")
    ) {
      return
    }
    void win.startDragging().catch(() => {})
  }

  const handleMinimize = async (e?: React.MouseEvent) => {
    e?.stopPropagation()
    try {
      await ipc.windowMinimize()
    } catch {
      void win.minimize().catch(() => {})
    }
  }

  const handleMaximize = async (e?: React.MouseEvent) => {
    e?.stopPropagation()
    try {
      await ipc.windowToggleMaximize()
    } catch {
      void win.toggleMaximize().catch(() => {})
    }
  }

  const handleClose = async (e?: React.MouseEvent) => {
    e?.stopPropagation()
    try {
      await ipc.windowClose()
    } catch {
      void win.close().catch(() => {})
    }
  }

  return (
    <div
      className="relative flex h-full w-full flex-col items-center justify-center bg-[radial-gradient(ellipse_at_top,oklch(0.62_0.19_265/0.12),transparent_55%)] select-none"
      onMouseDown={handleStartDrag}
      data-tauri-drag-region
    >
      {/* Titlebar header for window controls */}
      <header
        className="absolute top-0 right-0 left-0 flex h-[36px] items-center justify-between px-3 select-none"
        data-tauri-drag-region
      >
        {/* Brand logo/name */}
        <div
          className="flex items-center gap-2 text-xs font-semibold text-muted-foreground"
          data-tauri-drag-region
        >
          <span>SSHBool</span>
        </div>

        {/* Window controls */}
        <div className="z-50 flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Minimize"
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
            onClick={handleMinimize}
          >
            <Minus className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Maximize"
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
            onClick={handleMaximize}
          >
            <Square className="size-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Close"
            className="h-6 w-6 text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
            onClick={handleClose}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </header>

      <form
        onSubmit={(e) => void submit(e)}
        className="glass z-10 w-full max-w-sm space-y-4 rounded-xl p-6 shadow-md"
      >
        <div>
          <h1 className="text-lg font-semibold tracking-tight">SSHBool</h1>
          <p className="text-sm text-muted-foreground">
            {initialized
              ? "Unlock your vault to continue."
              : "Create a master password for your vault."}
          </p>
        </div>
        <label className="block space-y-1.5 text-sm">
          <span>Master password</span>
          <input
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
        {!initialized && (
          <label className="block space-y-1.5 text-sm">
            <span>Confirm password</span>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" className="w-full" disabled={busy || !password}>
          {busy ? "…" : initialized ? "Unlock" : "Create vault"}
        </Button>
      </form>
    </div>
  )
}
