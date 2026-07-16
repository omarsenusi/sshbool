import { ArrowUp, Eye, EyeOff, FolderPlus, Loader2, RefreshCw } from "lucide-react"
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
    const idx = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"))
    if (idx <= 0) {
      if (/^[A-Za-z]:\\?$/.test(normalized) || /^[A-Za-z]:$/.test(normalized)) return normalized
      return normalized
    }
    const parent = normalized.slice(0, idx)
    return parent.endsWith(":") ? `${parent}\\` : parent || normalized
  }
  return parentRemotePath(path)
}

export function joinPath(base: string, name: string, side: "local" | "remote"): string {
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
  onContextMenu: (e: MouseEvent, entry: SftpEntryDto | null) => void
  showHidden: boolean
  onToggleHidden: () => void
  dropHighlight?: boolean
  onDropOnPane?: () => void
  onDropOnEntry?: (entry: SftpEntryDto) => void
  onDragStartEntries?: (entries: SftpEntryDto[]) => void
  onDragOverPane?: (e: React.DragEvent) => void
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
  onContextMenu,
  showHidden,
  onToggleHidden,
  dropHighlight,
  onDropOnPane,
  onDropOnEntry,
  onDragStartEntries,
  onDragOverPane,
  className,
}: FilePaneProps) {
  const [draft, setDraft] = useState(path)
  const visible = useMemo(
    () => (showHidden ? entries : entries.filter((e) => !e.name.startsWith("."))),
    [entries, showHidden],
  )

  useEffect(() => {
    setDraft(path)
  }, [path])

  return (
    <section className={cn("border-border flex min-h-0 min-w-0 flex-1 flex-col border", className)}>
      <div className="border-border flex items-center gap-1 border-b px-2 py-1.5">
        <span className="text-muted-foreground shrink-0 text-[11px] font-semibold uppercase tracking-wide">
          {title}
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          <Button
            size="icon-xs"
            variant="ghost"
            title={showHidden ? "Hide dotfiles" : "Show dotfiles"}
            onClick={onToggleHidden}
          >
            {showHidden ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
          </Button>
          <Button size="icon-xs" variant="ghost" title="New folder" onClick={onMkdir}>
            <FolderPlus className="size-3.5" />
          </Button>
          <Button size="icon-xs" variant="ghost" title="Refresh" onClick={onRefresh}>
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
          </Button>
        </div>
      </div>
      <div className="border-border flex items-center gap-1 border-b px-2 py-1">
        <Button
          size="icon-xs"
          variant="ghost"
          title="Up"
          onClick={() => onPathChange(parentPath(path, side))}
        >
          <ArrowUp className="size-3.5" />
        </Button>
        <input
          className="border-input bg-background min-w-0 flex-1 rounded border px-2 py-1 font-mono text-[11px] outline-none"
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
        <p className="text-destructive border-border border-b px-2 py-1 text-[11px]">{error}</p>
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
          dropHighlight={dropHighlight}
          onDropOnPane={onDropOnPane}
          onDropOnEntry={onDropOnEntry}
          onDragOverPane={onDragOverPane}
        />
        {loading && visible.length === 0 && (
          <div className="bg-background/50 pointer-events-none absolute inset-0 flex items-start justify-center pt-8">
            <span className="text-muted-foreground bg-background/90 border-border inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] shadow-sm">
              <Loader2 className="size-3.5 animate-spin" />
              Loading…
            </span>
          </div>
        )}
      </div>
    </section>
  )
}
