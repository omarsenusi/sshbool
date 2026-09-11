import {
  ArrowUp,
  Eye,
  EyeOff,
  FilePlus,
  FolderPlus,
  Loader2,
  RefreshCw,
} from "lucide-react"
import { useEffect, useMemo, useState, type MouseEvent } from "react"

import { Button } from "@/components/ui/button"
import { FileList } from "@/features/sftp/components/file-list"
import {
  joinRemotePath,
  normalizeRemotePath,
  parentRemotePath,
} from "@/features/sftp/lib/remote-path"
import type { SftpEntryDto } from "@/lib/ipc/types"
import { cn } from "@/lib/utils"

export function parentPath(path: string, side: "local" | "remote"): string {
  if (side === "local") {
    const normalized = path.replace(/[/\\]+$/, "")
    const idx = Math.max(
      normalized.lastIndexOf("/"),
      normalized.lastIndexOf("\\")
    )
    if (idx <= 0) {
      if (/^[A-Za-z]:\\?$/.test(normalized) || /^[A-Za-z]:$/.test(normalized))
        return normalized
      return normalized
    }
    const parent = normalized.slice(0, idx)
    return parent.endsWith(":") ? `${parent}\\` : parent || normalized
  }
  return parentRemotePath(path)
}

export function joinPath(
  base: string,
  name: string,
  side: "local" | "remote"
): string {
  if (side === "local") {
    const sep = base.includes("\\") ? "\\" : "/"
    if (base.endsWith("\\") || base.endsWith("/")) return `${base}${name}`
    return `${base}${sep}${name}`
  }
  return joinRemotePath(base, name)
}

export { normalizeRemotePath }

type FilePaneProps = {
  title: string
  side: "local" | "remote"
  path: string
  onPathChange: (path: string) => void
  entries: SftpEntryDto[]
  loading?: boolean
  error?: string | null
  selected: string[]
  onSelect: (paths: string[], additive?: boolean, range?: boolean) => void
  onOpen: (entry: SftpEntryDto) => void
  onRefresh: () => void
  onMkdir: () => void
  onNewFile?: () => void
  onContextMenu: (e: MouseEvent, entry: SftpEntryDto | null) => void
  showHidden: boolean
  onToggleHidden: () => void
  dropHighlight?: boolean
  highlightDropPath?: string | null
  onDragStartEntries?: (entries: SftpEntryDto[]) => void
  onDragSessionMove?: (x: number, y: number) => void
  onDragSessionEnd?: (x: number, y: number) => void
  focused?: boolean
  className?: string
}

export function FilePane({
  title,
  side,
  path,
  onPathChange,
  entries,
  loading,
  error,
  selected,
  onSelect,
  onOpen,
  onRefresh,
  onMkdir,
  onNewFile,
  onContextMenu,
  showHidden,
  onToggleHidden,
  dropHighlight,
  highlightDropPath,
  onDragStartEntries,
  onDragSessionMove,
  onDragSessionEnd,
  focused,
  className,
}: FilePaneProps) {
  const [draft, setDraft] = useState(path)
  const visible = useMemo(
    () =>
      showHidden ? entries : entries.filter((e) => !e.name.startsWith(".")),
    [entries, showHidden]
  )

  useEffect(() => {
    setDraft(path)
  }, [path])

  return (
    <section
      data-sftp-pane={side}
      data-sftp-dir={path}
      className={cn(
        "flex min-h-0 min-w-0 flex-1 flex-col border border-border",
        focused && "ring-1 ring-primary/40",
        dropHighlight && "bg-primary/5",
        className
      )}
    >
      <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
        <span className="shrink-0 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
          {title}
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          <Button
            size="icon-xs"
            variant="ghost"
            title={showHidden ? "Hide dotfiles" : "Show dotfiles"}
            onClick={onToggleHidden}
          >
            {showHidden ? (
              <EyeOff className="size-3.5" />
            ) : (
              <Eye className="size-3.5" />
            )}
          </Button>
          {onNewFile && (
            <Button
              size="icon-xs"
              variant="ghost"
              title="New file"
              onClick={onNewFile}
            >
              <FilePlus className="size-3.5" />
            </Button>
          )}
          <Button
            size="icon-xs"
            variant="ghost"
            title="New folder"
            onClick={onMkdir}
          >
            <FolderPlus className="size-3.5" />
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            title="Refresh"
            onClick={onRefresh}
          >
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
          </Button>
        </div>
      </div>
      <div className="flex items-center gap-1 border-b border-border px-2 py-1">
        <Button
          size="icon-xs"
          variant="ghost"
          title="Up"
          onClick={() => onPathChange(parentPath(path, side))}
        >
          <ArrowUp className="size-3.5" />
        </Button>
        <input
          className="min-w-0 flex-1 rounded border border-input bg-background px-2 py-1 font-mono text-[11px] outline-none"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            if (draft.trim() && draft !== path) onPathChange(draft.trim())
            else setDraft(path)
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              if (draft.trim()) onPathChange(draft.trim())
              ;(e.target as HTMLInputElement).blur()
            }
          }}
        />
      </div>
      {error && (
        <p className="border-b border-border px-2 py-1 text-[11px] text-destructive">
          {error}
        </p>
      )}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <FileList
          entries={visible}
          selected={selected}
          onSelect={onSelect}
          onOpen={onOpen}
          onContextMenu={onContextMenu}
          dragSide={side}
          onDragStartEntries={onDragStartEntries}
          onDragSessionMove={onDragSessionMove}
          onDragSessionEnd={onDragSessionEnd}
          dropHighlight={dropHighlight}
          highlightDropPath={highlightDropPath}
        />
        {loading && visible.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-start justify-center bg-background/50 pt-8">
            <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background/90 px-2 py-1 text-[11px] text-muted-foreground shadow-sm">
              <Loader2 className="size-3.5 animate-spin" />
              Loading…
            </span>
          </div>
        )}
      </div>
    </section>
  )
}
