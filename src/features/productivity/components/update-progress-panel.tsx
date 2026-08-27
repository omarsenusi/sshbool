import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react"

import { getDonePhaseLabel, type UpdaterProgress } from "@/lib/update-engine"
import { cn } from "@/lib/utils"

const PHASE_LABELS: Record<UpdaterProgress["phase"], string> = {
  idle: "Ready",
  checking: "Checking…",
  downloading: "Downloading",
  installing: "Installing",
  done: "Complete",
  error: "Update failed",
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) {
    return "0 B"
  }
  const units = ["B", "KB", "MB", "GB"]
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

function statusDetail(progress: UpdaterProgress): string {
  if (progress.phase === "downloading") {
    if (progress.downloadedBytes != null && progress.totalBytes != null && progress.totalBytes > 0) {
      return `${formatBytes(progress.downloadedBytes)} / ${formatBytes(progress.totalBytes)}`
    }
    return "Downloading update package…"
  }
  if (progress.phase === "installing") {
    return "Launching Windows installer…"
  }
  if (progress.phase === "done") {
    return progress.message ?? "Finished"
  }
  if (progress.phase === "checking") {
    return "Preparing…"
  }
  return ""
}

type Props = {
  progress: UpdaterProgress
  currentVersion?: string
  latestVersion?: string
  platform?: string | null
  installDir?: string
  className?: string
}

export function UpdateProgressPanel({
  progress,
  currentVersion,
  latestVersion,
  platform,
  installDir,
  className,
}: Props) {
  const activePhase = progress.phase !== "idle" && progress.phase !== "error"
  const showBar = activePhase

  const percent =
    progress.percent ??
    (progress.totalBytes && progress.totalBytes > 0 && progress.downloadedBytes != null
      ? Math.round((progress.downloadedBytes / progress.totalBytes) * 100)
      : null)

  const title =
    progress.phase === "done" && progress.resultMode
      ? getDonePhaseLabel(progress.resultMode)
      : PHASE_LABELS[progress.phase]

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-start gap-2">
        {progress.phase === "error" ? (
          <AlertTriangle className="text-destructive mt-0.5 size-4 shrink-0" />
        ) : progress.phase === "done" ? (
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />
        ) : (
          <Loader2 className="text-primary mt-0.5 size-4 shrink-0 animate-spin" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{title}</p>
          {currentVersion && latestVersion && (
            <p className="text-muted-foreground text-xs">
              {currentVersion} → <span className="text-foreground font-medium">{latestVersion}</span>
              {platform ? (
                <>
                  {" · "}
                  <span className="font-medium">{platform}</span>
                </>
              ) : null}
            </p>
          )}
          {installDir && progress.phase === "downloading" && (
            <p className="text-muted-foreground mt-1 truncate text-[11px]">
              Target install path: <span className="font-medium">{installDir}</span>
            </p>
          )}
          {progress.phase === "error" && progress.message && (
            <p className="text-destructive mt-1 text-xs">{progress.message}</p>
          )}
          {progress.phase === "done" && progress.message && (
            <p className="text-muted-foreground mt-1 text-[11px] leading-relaxed">{progress.message}</p>
          )}
        </div>
      </div>

      {showBar && progress.phase !== "done" && (
        <div className="space-y-1.5">
          <div className="bg-muted h-2 overflow-hidden rounded-full">
            <div
              className={cn(
                "bg-primary h-full transition-[width] duration-200",
                percent == null && progress.phase !== "installing" && "w-1/3 animate-pulse",
                progress.phase === "installing" && "w-full animate-pulse",
              )}
              style={
                percent != null && progress.phase === "downloading"
                  ? { width: `${percent}%` }
                  : undefined
              }
            />
          </div>
          <div className="text-muted-foreground flex items-center justify-between text-[11px]">
            <span>{statusDetail(progress)}</span>
            {percent != null && progress.phase === "downloading" ? <span>{percent}%</span> : null}
          </div>
        </div>
      )}
    </div>
  )
}
