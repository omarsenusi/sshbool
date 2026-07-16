import { useState } from "react"

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

  const initialized = status?.initialized ?? false

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      if (!initialized) {
        if (password.length < 8) {
          setError("Password must be at least 8 characters")
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
      setError(err instanceof IpcError ? formatAppError(err.appError) : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(ellipse_at_top,oklch(0.62_0.19_265/0.12),transparent_55%)]">
      <form
        onSubmit={(e) => void submit(e)}
        className="glass w-full max-w-sm space-y-4 rounded-xl p-6 shadow-md"
      >
        <div>
          <h1 className="text-lg font-semibold tracking-tight">SSHBool</h1>
          <p className="text-muted-foreground text-sm">
            {initialized ? "Unlock your vault to continue." : "Create a master password for your vault."}
          </p>
        </div>
        <label className="block space-y-1.5 text-sm">
          <span>Master password</span>
          <input
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="border-input bg-background focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2"
          />
        </label>
        {!initialized && (
          <label className="block space-y-1.5 text-sm">
            <span>Confirm password</span>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="border-input bg-background focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2"
            />
          </label>
        )}
        {error && <p className="text-destructive text-sm">{error}</p>}
        <Button type="submit" className="w-full" disabled={busy || !password}>
          {busy ? "…" : initialized ? "Unlock" : "Create vault"}
        </Button>
      </form>
    </div>
  )
}
