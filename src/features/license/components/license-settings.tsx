import { useQuery } from "@tanstack/react-query"
import {
  CheckCircle2,
  Copy,
  Cpu,
  HardDrive,
  KeyRound,
  Laptop,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ipc } from "@/lib/ipc/commands"
import { toast } from "@/stores/toast.store"

export function LicenseSettings() {
  const [copied, setCopied] = useState(false)

  const licenseQuery = useQuery({
    queryKey: ["license"],
    queryFn: () => ipc.licenseStatus(),
  })

  const data = licenseQuery.data ?? {}
  const licenseKey = (data.licenseKey as string) || (data.deviceId as string) || "SB-DEVICE-UUID-KEY"
  const tier = (data.tier as string) || "pro"

  function copyLicenseKey() {
    if (!licenseKey) return
    navigator.clipboard.writeText(licenseKey)
    setCopied(true)
    toast.success("License Key Copied", "Device Machine ID copied to clipboard.")
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div>
        <h2 className="text-lg font-bold tracking-tight text-foreground flex items-center gap-2">
          <ShieldCheck className="size-5 text-emerald-400" />
          License & Device Verification
        </h2>
        <p className="text-xs text-muted-foreground mt-1">
          Manage your software license status, hardware binding, and active enterprise features.
        </p>
      </div>

      {/* Hero Status Card */}
      <div className="relative overflow-hidden rounded-xl border border-emerald-500/30 bg-gradient-to-br from-emerald-950/40 via-card to-background p-5 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 px-3 py-1 text-xs font-semibold text-emerald-400">
                <span className="size-2 rounded-full bg-emerald-400 animate-pulse" />
                License Active & Valid
              </span>
              <span className="rounded-md bg-primary/10 border border-primary/20 px-2 py-0.5 text-[11px] font-mono text-primary font-bold uppercase">
                {tier.toUpperCase()} TIER
              </span>
            </div>
            <h3 className="text-base font-bold text-foreground">
              Pro Lifetime License
            </h3>
            <p className="text-xs text-muted-foreground max-w-lg">
              Your software license is automatically bound to this machine. All pro tools and features are fully unlocked.
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-right">
              <span className="text-[10px] uppercase font-mono tracking-wider text-muted-foreground block">
                Expiration
              </span>
              <span className="text-xs font-semibold text-emerald-400">
                Never (Perpetual)
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Machine ID / License Key Card */}
      <div className="rounded-xl border border-border/70 bg-card/60 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-semibold text-foreground flex items-center gap-2">
            <KeyRound className="size-4 text-primary" />
            UUID / Device Hardware Fingerprint
          </Label>
          <span className="text-[10px] font-mono text-muted-foreground">
            64-Character Cryptographic Hash
          </span>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Input
              readOnly
              value={licenseKey}
              className="h-9 font-mono text-xs bg-muted/40 tracking-wider text-foreground pr-10 border-border/60 select-all"
            />
            <Cpu className="absolute right-3 top-2.5 size-4 text-muted-foreground/60" />
          </div>

          <Button
            size="sm"
            variant="outline"
            className="h-9 gap-2 text-xs font-semibold shrink-0"
            onClick={copyLicenseKey}
          >
            {copied ? (
              <>
                <CheckCircle2 className="size-4 text-emerald-400" />
                Copied
              </>
            ) : (
              <>
                <Copy className="size-4" />
                Copy Key
              </>
            )}
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          This Machine Key is generated from your hardware UUID. It remains persistent whether you reboot, close the app, or switch OS.
        </p>
      </div>

      {/* Unlocked Features Grid */}
      <div className="space-y-3">
        <Label className="text-xs font-semibold text-foreground uppercase tracking-wider block">
          Unlocked Enterprise Features
        </Label>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
          <div className="rounded-lg border border-border/60 bg-card/40 p-3 space-y-1">
            <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
              <Zap className="size-4 text-emerald-400" />
              <span>Unlimited Hosts</span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Connect to unlimited SSH servers, jump hosts, and network targets.
            </p>
          </div>

          <div className="rounded-lg border border-border/60 bg-card/40 p-3 space-y-1">
            <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
              <Laptop className="size-4 text-sky-400" />
              <span>Remote Desktop (RDP/VNC)</span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Full cross-platform RDP and VNC native client integration.
            </p>
          </div>

          <div className="rounded-lg border border-border/60 bg-card/40 p-3 space-y-1">
            <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
              <Sparkles className="size-4 text-purple-400" />
              <span>AI Copilot & Diagnostics</span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Integrated terminal AI copilot for auto-fixes and command suggestions.
            </p>
          </div>

          <div className="rounded-lg border border-border/60 bg-card/40 p-3 space-y-1">
            <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
              <HardDrive className="size-4 text-amber-400" />
              <span>SFTP & Remote Editor</span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Full-featured SFTP file manager and code editor with syntax highlighting.
            </p>
          </div>

          <div className="rounded-lg border border-border/60 bg-card/40 p-3 space-y-1">
            <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
              <ShieldCheck className="size-4 text-emerald-400" />
              <span>Master Vault Encryption</span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              AES-256 encrypted credential vault for passwords and SSH keys.
            </p>
          </div>

          <div className="rounded-lg border border-border/60 bg-card/40 p-3 space-y-1">
            <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
              <CheckCircle2 className="size-4 text-emerald-400" />
              <span>Team & Workspaces</span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Shared team workspaces, session logs, and audit trail aggregation.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
