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
  RefreshCw,
  Layers,
} from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ipc } from "@/lib/ipc/commands"
import { toast } from "@/stores/toast.store"

interface FeatureItem {
  key: string
  title: string
  description: string
  icon: React.ComponentType<{ className?: string }>
  iconColor: string
}

const FEATURE_REGISTRY: FeatureItem[] = [
  {
    key: "unlimited_hosts",
    title: "Unlimited Hosts",
    description: "Connect to unlimited SSH servers, jump hosts, and network targets.",
    icon: Zap,
    iconColor: "text-amber-500",
  },
  {
    key: "editor",
    title: "SFTP & Remote Editor",
    description: "Full-featured SFTP file manager and code editor with syntax highlighting.",
    icon: HardDrive,
    iconColor: "text-blue-500",
  },
  {
    key: "ai",
    title: "AI Copilot & Diagnostics",
    description: "Integrated terminal AI copilot for auto-fixes and command suggestions.",
    icon: Sparkles,
    iconColor: "text-purple-500",
  },
  {
    key: "desktop",
    title: "Remote Desktop (RDP/VNC)",
    description: "Full cross-platform RDP and VNC native client integration.",
    icon: Laptop,
    iconColor: "text-sky-500",
  },
  {
    key: "vault",
    title: "Master Vault Encryption",
    description: "AES-256 encrypted credential vault for passwords and SSH keys.",
    icon: ShieldCheck,
    iconColor: "text-emerald-500",
  },
  {
    key: "team",
    title: "Team & Workspaces",
    description: "Shared team workspaces, session logs, and audit trail aggregation.",
    icon: CheckCircle2,
    iconColor: "text-indigo-500",
  },
  {
    key: "sync",
    title: "Cloud Sync",
    description: "Securely sync your hosts, sessions, and configurations across devices.",
    icon: RefreshCw,
    iconColor: "text-teal-500",
  },
  {
    key: "docker",
    title: "Docker Container Panel",
    description: "Manage Docker containers, images, volumes, and logs natively.",
    icon: Layers,
    iconColor: "text-cyan-500",
  },
]

export function LicenseSettings() {
  const [copied, setCopied] = useState(false)

  const licenseQuery = useQuery({
    queryKey: ["license"],
    queryFn: () => ipc.licenseStatus(),
  })

  const data = licenseQuery.data ?? {}
  const licenseKey = (data.licenseKey as string) || (data.deviceId as string) || "SB-DEVICE-UUID-KEY"
  const tier = (data.tier as string) || "free"
  const isActivated = !!data.activated

  // Parse actual active features from token data
  const rawFeatures = (data.features as string[]) || []
  
  // Filter feature items to show only those present in the token's features list
  const unlockedFeatures = FEATURE_REGISTRY.filter((f) => 
    rawFeatures.includes(f.key) || 
    (f.key === "ai" && rawFeatures.includes("ai_copilot")) ||
    (f.key === "editor" && rawFeatures.includes("sftp_editor")) ||
    (f.key === "team" && rawFeatures.includes("teams_workspaces")) ||
    (f.key === "vault" && rawFeatures.includes("vault_encryption"))
  )

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
        <h2 className="text-base font-semibold tracking-tight text-foreground flex items-center gap-2">
          <ShieldCheck className="size-4.5 text-foreground" />
          License & Device Verification
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Manage your software license status, hardware binding, and active enterprise features.
        </p>
      </div>

      {/* Hero Status Card */}
      <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              {isActivated ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                  <span className="size-1.5 rounded-full bg-emerald-500" />
                  License Active & Valid
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 border border-amber-500/20 px-2.5 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
                  <span className="size-1.5 rounded-full bg-amber-500" />
                  Free Tier
                </span>
              )}
              <span className="rounded-md bg-muted border border-border px-2 py-0.5 text-[10px] font-mono text-muted-foreground font-medium uppercase">
                {tier} TIER
              </span>
            </div>
            <h3 className="text-sm font-semibold text-foreground">
              {isActivated ? `${tier.charAt(0).toUpperCase() + tier.slice(1)} License` : "Free Tier Workspace"}
            </h3>
            <p className="text-xs text-muted-foreground max-w-lg">
              {isActivated 
                ? "Your software license is automatically bound to this machine. All authorized enterprise features are fully unlocked."
                : "Verify your license key to unlock advanced developer features, team spaces, and cloud backups."}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <div className="rounded-lg border border-border bg-muted/40 px-3.5 py-2 text-right min-w-[120px]">
              <span className="text-[9px] uppercase font-mono tracking-wider text-muted-foreground block">
                Expiration
              </span>
              <span className="text-xs font-medium text-foreground">
                {isActivated ? "Never (Perpetual)" : "No Expiry"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Machine ID / License Key Card */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-3.5 shadow-sm">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-medium text-foreground flex items-center gap-2">
            <KeyRound className="size-4 text-muted-foreground" />
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
              className="h-9 font-mono text-xs bg-muted/30 tracking-wider text-foreground pr-10 border-border select-all focus-visible:ring-0"
            />
            <Cpu className="absolute right-3 top-2.5 size-4 text-muted-foreground/40" />
          </div>

          <Button
            size="sm"
            variant="outline"
            className="h-9 gap-1.5 text-xs font-medium shrink-0 px-3"
            onClick={copyLicenseKey}
          >
            {copied ? (
              <>
                <CheckCircle2 className="size-3.5 text-emerald-500" />
                Copied
              </>
            ) : (
              <>
                <Copy className="size-3.5" />
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
          {isActivated ? "Unlocked Features" : "Standard Features"}
        </Label>

        {unlockedFeatures.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {unlockedFeatures.map((f) => {
              const IconComponent = f.icon
              return (
                <div key={f.key} className="rounded-xl border border-border bg-card p-4 space-y-1.5 shadow-sm hover:border-muted-foreground/20 transition-colors">
                  <div className="flex items-center gap-2 text-xs font-medium text-foreground">
                    <IconComponent className={`size-4 ${f.iconColor}`} />
                    <span>{f.title}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-normal">
                    {f.description}
                  </p>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground bg-muted/10">
            No enterprise features currently active.
          </div>
        )}
      </div>
    </div>
  )
}

