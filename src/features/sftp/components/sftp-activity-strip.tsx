import { Loader2, X } from "lucide-react"
import { useMemo, useState } from "react"

import { formatBytes } from "@/features/sftp/lib/format-bytes"
import { ipc } from "@/lib/ipc/commands"
import type { TransferJobDto } from "@/lib/ipc/types"
import {
  activityProgressPct,
  useSftpActivityStore,
  type SftpActivityEntry,
} from "@/stores/sftp-activity.store"
import { cn } from "@/lib/utils"

function kindLabel(kind: SftpActivityEntry["kind"] | string) {
  return kind
}

function statusClass(status: string) {
  if (status === "running" || status === "active" || status === "queued")
    return "text-foreground"
  if (status === "done" || status === "completed") return "text-emerald-500"
  if (status === "error" || status === "failed") return "text-destructive"
  if (status === "canceled" || status === "cancelled") return "text-muted-foreground"
  return "text-muted-foreground"
}

function transferPct(t: TransferJobDto): number {
  if (t.status === "done" || t.status === "completed") return 100
  if (t.status === "canceled" || t.status === "cancelled") {
    if (t.totalBytes <= 0) return 0
    return Math.min(
      100,
      Math.max(0, Math.round((t.transferredBytes / t.totalBytes) * 100)),
    )
  }
  if (t.totalBytes <= 0) {
    if (t.totalItems > 0) {
      return Math.min(100, Math.round((t.doneItems / t.totalItems) * 100))
    }
    return t.status === "active" || t.status === "queued" ? 0 : 0
  }
  return Math.min(
    100,
    Math.max(0, Math.round((t.transferredBytes / t.totalBytes) * 100)),
  )
}

function SizePct({
  done,
  total,
  pct,
  status,
  error,
}: {
  done?: number | null
  total?: number | null
  pct: number | null
  status: string
  error?: string | null
}) {
  if (status === "error" && error) {
    return (
      <span className={cn("ml-auto shrink-0 tabular-nums", statusClass(status))}>
        {error}
      </span>
    )
  }

  const sizeText =
    total != null && total > 0
      ? done != null && done !== total && status !== "done"
        ? `${formatBytes(done)} / ${formatBytes(total)}`
        : formatBytes(total)
      : done != null && done > 0
        ? formatBytes(done)
        : null

  return (
    <span
      className={cn(
        "ml-auto flex shrink-0 items-center gap-1.5 tabular-nums",
        statusClass(status),
      )}
    >
      {sizeText && <span>{sizeText}</span>}
      {pct != null && <span>{pct}%</span>}
      <span>{status}</span>
    </span>
  )
}

function ProgressBar({ pct, active }: { pct: number | null; active: boolean }) {
  // Hide once finished — only show while in progress.
  if (!active) return null
  const width = pct ?? 15
  return (
    <div className="bg-muted mt-0.5 h-1 w-full overflow-hidden rounded-full">
      <div
        className={cn(
          "bg-primary h-full rounded-full transition-[width] duration-200",
          pct == null && "animate-pulse",
        )}
        style={{ width: `${width}%` }}
      />
    </div>
  )
}

function CancelTransferButton({ jobId }: { jobId: string }) {
  const [pending, setPending] = useState(false)

  return (
    <button
      type="button"
      title="Cancel transfer"
      aria-label="Cancel transfer"
      disabled={pending}
      className="text-muted-foreground hover:bg-destructive/15 hover:text-destructive shrink-0 rounded p-0.5 disabled:opacity-50"
      onClick={(e) => {
        e.stopPropagation()
        setPending(true)
        void ipc.transferCancel(jobId).finally(() => setPending(false))
      }}
    >
      <X className="size-3" />
    </button>
  )
}

export function SftpActivityStrip({
  hostId,
  transfers,
}: {
  hostId: string
  transfers: TransferJobDto[]
}) {
  const allEntries = useSftpActivityStore((s) => s.entries)
  // File ops only — uploads/downloads live in the transfers list (with size + %).
  const entries = useMemo(
    () =>
      allEntries
        .filter(
          (e) =>
            e.hostId === hostId &&
            e.kind !== "upload" &&
            e.kind !== "download",
        )
        .slice(0, 12),
    [allEntries, hostId],
  )
  const hostTransfers = useMemo(
    () => transfers.filter((t) => t.hostId === hostId).slice(0, 8),
    [transfers, hostId],
  )

  const busy =
    entries.some((e) => e.status === "running") ||
    hostTransfers.some((t) => t.status === "active" || t.status === "queued")

  if (entries.length === 0 && hostTransfers.length === 0) return null

  return (
    <div className="border-border text-muted-foreground max-h-32 overflow-y-auto border-t px-3 py-1.5 text-[11px]">
      <div className="mb-1 flex items-center gap-2 font-semibold uppercase tracking-wide">
        <span>Activity</span>
        {busy && (
          <span className="text-foreground inline-flex items-center gap-1 normal-case tracking-normal">
            <Loader2 className="size-3 animate-spin" />
            Working…
          </span>
        )}
      </div>
      <ul className="space-y-1">
        {entries.map((e) => {
          const pct = activityProgressPct(e)
          const active = e.status === "running"
          return (
            <li key={e.id} className="min-w-0">
              <div className="flex min-w-0 items-center gap-2 truncate">
                {active ? (
                  <Loader2 className="text-foreground size-3 shrink-0 animate-spin" />
                ) : null}
                <span
                  className={cn(
                    "shrink-0 font-medium",
                    statusClass(e.status),
                  )}
                >
                  {kindLabel(e.kind)}
                </span>
                {e.side && (
                  <span className="shrink-0 opacity-60">[{e.side}]</span>
                )}
                <span className="min-w-0 truncate">{e.label}</span>
                <SizePct
                  done={e.bytesDone}
                  total={e.bytesTotal}
                  pct={pct}
                  status={e.status}
                  error={e.error}
                />
              </div>
              <ProgressBar pct={pct} active={active} />
            </li>
          )
        })}
        {hostTransfers.map((t) => {
          const pct = transferPct(t)
          const active = t.status === "active" || t.status === "queued"
          return (
            <li key={t.id} className="min-w-0">
              <div className="flex min-w-0 items-center gap-2 truncate">
                {active && (
                  <Loader2 className="text-foreground size-3 shrink-0 animate-spin" />
                )}
                <span className="text-foreground shrink-0 font-medium">
                  {t.kind}
                </span>
                <span className="min-w-0 truncate">{t.sourceRoot}</span>
                <span>→</span>
                <span className="min-w-0 truncate">{t.destRoot}</span>
                <SizePct
                  done={t.transferredBytes}
                  total={t.totalBytes}
                  pct={pct}
                  status={t.status}
                  error={t.error}
                />
                {active && <CancelTransferButton jobId={t.id} />}
              </div>
              <ProgressBar pct={pct} active={active} />
            </li>
          )
        })}
      </ul>
    </div>
  )
}
