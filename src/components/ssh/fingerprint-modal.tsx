import { useState } from "react"
import {
  ShieldCheck,
  Copy,
  Check,
  Server,
  Key,
  AlertTriangle,
  ShieldAlert,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { useTofuStore } from "@/stores/tofu.store"
import { ipc } from "@/lib/ipc/commands"
import { useConnectionStore } from "@/stores/connection.store"
import { useSessionStore } from "@/stores/session.store"
import { clearTerminalScrollback } from "@/features/terminal/terminal-scrollback"
import { toast } from "@/stores/toast.store"

export function FingerprintVerificationModal() {
  const pendingFingerprint = useTofuStore((s) => s.pendingFingerprint)
  const setPendingFingerprint = useTofuStore((s) => s.setPendingFingerprint)
  const pendingHostKeyChanged = useTofuStore((s) => s.pendingHostKeyChanged)
  const setPendingHostKeyChanged = useTofuStore(
    (s) => s.setPendingHostKeyChanged
  )

  const [copiedField, setCopiedField] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const copyToClipboard = (text: string, fieldName: string) => {
    navigator.clipboard.writeText(text)
    setCopiedField(fieldName)
    setTimeout(() => setCopiedField(null), 2000)
  }

  // Security alert when host key has changed
  if (pendingHostKeyChanged) {
    return (
      <div className="fixed inset-0 z-50 flex animate-in items-center justify-center bg-black/60 p-4 backdrop-blur-xs duration-150 fade-in">
        <div className="w-full max-w-md rounded-xl border border-destructive/40 bg-background p-5 text-foreground shadow-lg">
          <div className="mb-4 flex items-start gap-3.5 border-b border-border pb-3.5">
            <div className="mt-0.5 shrink-0 rounded-lg bg-destructive/10 p-2 text-destructive">
              <ShieldAlert className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-destructive">
                Host Key Verification Failed
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Security Warning — Server host key mismatch detected
              </p>
            </div>
          </div>

          <p className="mb-4 text-xs leading-relaxed text-muted-foreground">
            The host key offered by the server does not match the key saved in
            your database. This could indicate a Man-in-the-Middle attack or a
            server re-installation.
          </p>

          <div className="mb-5 space-y-2.5 rounded-lg border border-destructive/20 bg-destructive/5 p-3 font-mono text-xs">
            <div>
              <span className="mb-1 block font-sans text-[11px] text-muted-foreground">
                Expected (Database):
              </span>
              <code className="block rounded bg-muted/60 p-2 text-[11px] break-all text-foreground">
                {pendingHostKeyChanged.expected}
              </code>
            </div>
            <div>
              <span className="mb-1 block font-sans text-[11px] font-medium text-destructive">
                Received (Server):
              </span>
              <code className="block rounded bg-destructive/10 p-2 text-[11px] break-all text-destructive">
                {pendingHostKeyChanged.actual}
              </code>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button
              variant="destructive"
              size="sm"
              className="px-4 text-xs font-medium"
              onClick={() => {
                useConnectionStore
                  .getState()
                  .setError(
                    pendingHostKeyChanged.hostId,
                    "Host key changed — connection aborted"
                  )
                setPendingHostKeyChanged(null)
              }}
            >
              Abort Connection
            </Button>
          </div>
        </div>
      </div>
    )
  }

  if (!pendingFingerprint) return null

  // Format clean fingerprints
  const cleanSha256 = pendingFingerprint.fingerprint.startsWith("SHA256:")
    ? pendingFingerprint.fingerprint
    : `SHA256:${pendingFingerprint.fingerprint}`

  const cleanMd5 = pendingFingerprint.fingerprintMd5
    ? pendingFingerprint.fingerprintMd5.startsWith("MD5:")
      ? pendingFingerprint.fingerprintMd5
      : `MD5:${pendingFingerprint.fingerprintMd5}`
    : null

  const handleAcceptAndSave = async () => {
    setLoading(true)
    try {
      await ipc.knownHostsTrust(
        pendingFingerprint.host,
        pendingFingerprint.port,
        cleanSha256,
        pendingFingerprint.keyType
      )

      const { sessionId } = await ipc.sessionOpen(pendingFingerprint.hostId)
      useConnectionStore
        .getState()
        .setConnected(pendingFingerprint.hostId, sessionId)

      if (pendingFingerprint.opts?.openPane !== false) {
        const pane = await ipc.paneOpen(pendingFingerprint.hostId, 120, 40)
        clearTerminalScrollback(pane.paneId)
        useSessionStore.getState().addPane({
          ...pane,
          title: pendingFingerprint.opts?.label ?? pane.title,
        })
      }

      toast.success(
        "Host Trusted & Saved",
        `Fingerprint saved for ${pendingFingerprint.host}`
      )
      setPendingFingerprint(null)
    } catch (err) {
      toast.error(
        "Failed to connect",
        err instanceof Error ? err.message : String(err)
      )
      useConnectionStore
        .getState()
        .setError(pendingFingerprint.hostId, "Connection rejected")
      setPendingFingerprint(null)
    } finally {
      setLoading(false)
    }
  }

  const handleAcceptOnce = async () => {
    setLoading(true)
    try {
      const { sessionId } = await ipc.sessionOpen(pendingFingerprint.hostId)
      useConnectionStore
        .getState()
        .setConnected(pendingFingerprint.hostId, sessionId)

      if (pendingFingerprint.opts?.openPane !== false) {
        const pane = await ipc.paneOpen(pendingFingerprint.hostId, 120, 40)
        clearTerminalScrollback(pane.paneId)
        useSessionStore.getState().addPane({
          ...pane,
          title: pendingFingerprint.opts?.label ?? pane.title,
        })
      }

      toast.info(
        "Accepted Once",
        `Connected to ${pendingFingerprint.host} for this session only`
      )
      setPendingFingerprint(null)
    } catch (err) {
      toast.error(
        "Failed to connect",
        err instanceof Error ? err.message : String(err)
      )
      useConnectionStore
        .getState()
        .setError(pendingFingerprint.hostId, "Connection rejected")
      setPendingFingerprint(null)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex animate-in items-center justify-center bg-black/60 p-4 backdrop-blur-xs duration-150 fade-in">
      <div className="w-full max-w-lg rounded-xl border border-border bg-background p-5 text-foreground shadow-lg">
        {/* Modal Header */}
        <div className="mb-4 flex items-start gap-3.5 border-b border-border pb-3.5">
          <div className="mt-0.5 shrink-0 rounded-lg bg-muted p-2 text-foreground">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold tracking-tight">
                Host Key Verification
              </h2>
              <span className="rounded border border-border bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground uppercase">
                New Host Key
              </span>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              The authenticity of this remote host has not been verified yet.
            </p>
          </div>
        </div>

        {/* Host & Key Alg Details */}
        <div className="mb-3 grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-border bg-muted/20 p-2.5">
            <div className="mb-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Server className="h-3.5 w-3.5" />
              <span>Connecting To</span>
            </div>
            <div className="truncate font-mono text-xs font-medium text-foreground select-all">
              {pendingFingerprint.host}:{pendingFingerprint.port}
            </div>
          </div>
          <div className="rounded-lg border border-border bg-muted/20 p-2.5">
            <div className="mb-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Key className="h-3.5 w-3.5" />
              <span>Key Algorithm</span>
            </div>
            <div className="truncate font-mono text-xs font-medium text-foreground">
              {pendingFingerprint.keyType}
            </div>
          </div>
        </div>

        {/* Fingerprints Container */}
        <div className="mb-3 space-y-3 rounded-lg border border-border bg-muted/10 p-3.5">
          {/* SHA-256 */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                SHA-256 Fingerprint
              </span>
              <button
                type="button"
                onClick={() => copyToClipboard(cleanSha256, "sha256")}
                className="flex items-center gap-1 rounded border border-border bg-muted px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
              >
                {copiedField === "sha256" ? (
                  <>
                    <Check className="h-3 w-3 text-emerald-500" />
                    <span>Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" />
                    <span>Copy</span>
                  </>
                )}
              </button>
            </div>
            <code className="block rounded border border-border bg-muted/40 p-2 font-mono text-xs break-all text-foreground select-all">
              {cleanSha256}
            </code>
          </div>

          {/* MD5 Fingerprint */}
          {cleanMd5 && (
            <div>
              <div className="mb-1 flex items-center justify-between pt-1">
                <span className="text-xs font-medium text-muted-foreground">
                  MD5 Fingerprint
                </span>
                <button
                  type="button"
                  onClick={() => copyToClipboard(cleanMd5, "md5")}
                  className="flex items-center gap-1 rounded border border-border bg-muted px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
                >
                  {copiedField === "md5" ? (
                    <>
                      <Check className="h-3 w-3 text-emerald-500" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>
              <code className="block rounded border border-border bg-muted/40 p-2 font-mono text-xs break-all text-muted-foreground select-all">
                {cleanMd5}
              </code>
            </div>
          )}
        </div>

        {/* Warning Notice */}
        <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-border bg-muted/20 p-2.5 text-xs text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
          <span>
            Please verify the fingerprint with your administrator before
            accepting.
          </span>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-2 border-t border-border pt-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={loading}
            className="text-xs text-muted-foreground hover:text-foreground"
            onClick={() => {
              useConnectionStore
                .getState()
                .setError(
                  pendingFingerprint.hostId,
                  "Connection cancelled by user"
                )
              setPendingFingerprint(null)
            }}
          >
            Cancel
          </Button>

          <Button
            variant="outline"
            size="sm"
            disabled={loading}
            className="text-xs font-medium"
            onClick={handleAcceptOnce}
          >
            Accept Once
          </Button>

          <Button
            size="sm"
            disabled={loading}
            className="px-4 text-xs font-medium"
            onClick={handleAcceptAndSave}
          >
            {loading ? "Saving..." : "Accept & Save"}
          </Button>
        </div>
      </div>
    </div>
  )
}
