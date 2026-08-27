import { Download, ExternalLink, Loader2, ShieldAlert } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { UpdateProgressPanel } from "@/features/productivity/components/update-progress-panel"
import type { ChangelogEntry } from "@/lib/api"
import type { UpdaterProgress } from "@/lib/update-engine"
import { cn } from "@/lib/utils"

const CATEGORY_LABELS: Record<string, string> = {
  added: "Added",
  improved: "Improved",
  fixed: "Fixed",
  security: "Security",
  deprecated: "Deprecated",
  removed: "Removed",
}

type Props = {
  open: boolean
  currentVersion: string
  latestVersion: string
  platform?: string | null
  installDir?: string
  platformSummary?: string | null
  notes?: string | null
  changelog?: ChangelogEntry[]
  isForced?: boolean
  isCritical?: boolean
  installing?: boolean
  canInstall?: boolean
  installLabel?: string
  isGithubFallback?: boolean
  progress?: UpdaterProgress
  onLater?: () => void
  onInstall: () => void
}

export function UpdateAvailableDialog({
  open,
  currentVersion,
  latestVersion,
  platform,
  installDir,
  platformSummary,
  notes,
  changelog = [],
  isForced = false,
  isCritical = false,
  installing = false,
  canInstall = true,
  installLabel = "Install update",
  isGithubFallback = false,
  progress,
  onLater,
  onInstall,
}: Props) {
  const showProgress =
    installing && progress && progress.phase !== "idle" && progress.phase !== "error"

  return (
    <Dialog
      open={open}
      disablePointerDismissal
      onOpenChange={(nextOpen, eventDetails) => {
        if (!nextOpen) {
          eventDetails.cancel()
        }
      }}
    >
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isForced ? <ShieldAlert className="text-destructive size-4" /> : null}
            {isForced ? "Required update" : "Update available"}
          </DialogTitle>
          <DialogDescription>
            SSHBool {currentVersion} →{" "}
            <span className="text-foreground font-medium">{latestVersion}</span>
            {isCritical ? (
              <span className="text-destructive ml-2 font-medium">Critical</span>
            ) : null}
          </DialogDescription>
          {!showProgress && platformSummary ? (
            <p className="text-muted-foreground text-[11px]">{platformSummary}</p>
          ) : null}
        </DialogHeader>

        {showProgress && progress ? (
          <UpdateProgressPanel
            progress={progress}
            currentVersion={currentVersion}
            latestVersion={latestVersion}
            platform={platform}
            installDir={installDir}
          />
        ) : (
          <div className="max-h-52 space-y-3 overflow-y-auto pr-1">
            {isForced && (
              <p className="text-destructive text-xs">
                This update is mandatory. Install it to keep using SSHBool safely.
              </p>
            )}

            {notes && changelog.length === 0 && (
              <p className="text-muted-foreground whitespace-pre-line text-xs leading-relaxed">
                {notes}
              </p>
            )}

            {changelog.length > 0 && (
              <ul className="space-y-1.5">
                {changelog.map((entry) => (
                  <li key={entry.description} className="flex gap-2 text-xs">
                    <span
                      className={cn(
                        "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase",
                        entry.category === "security" && "bg-destructive/10 text-destructive",
                        entry.category === "added" && "bg-emerald-500/10 text-emerald-600",
                        entry.category === "fixed" && "bg-amber-500/10 text-amber-600",
                        entry.category === "improved" && "bg-blue-500/10 text-blue-600",
                        !["security", "added", "fixed", "improved"].includes(entry.category) &&
                          "bg-muted text-muted-foreground",
                      )}
                    >
                      {CATEGORY_LABELS[entry.category] ?? entry.category}
                    </span>
                    <span className="text-muted-foreground">{entry.description}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <DialogFooter>
          {!isForced && !installing && onLater && (
            <Button size="sm" variant="ghost" onClick={onLater}>
              Skip for now
            </Button>
          )}
          <Button size="sm" disabled={installing || !canInstall} onClick={onInstall}>
            {installing ? (
              <Loader2 className="mr-2 size-3.5 animate-spin" />
            ) : isGithubFallback ? (
              <ExternalLink className="mr-2 size-3.5" />
            ) : (
              <Download className="mr-2 size-3.5" />
            )}
            {canInstall ? installLabel : "Install unavailable"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
