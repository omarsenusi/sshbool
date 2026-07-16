import { File, Folder } from "lucide-react"
import { useCallback, useMemo, useRef, useState, type MouseEvent } from "react"

import { formatBytes, formatMtime } from "@/features/sftp/lib/format-bytes"
import type { SftpEntryDto } from "@/lib/ipc/types"
import { cn } from "@/lib/utils"

export type FileListProps = {
  entries: SftpEntryDto[]
  selected: string[]
  onSelect: (paths: string[], additive?: boolean, range?: boolean) => void
  /** Plain click: open folder / file immediately. */
  onOpen: (entry: SftpEntryDto) => void
  onContextMenu: (e: MouseEvent, entry: SftpEntryDto | null) => void
  dragSide: "local" | "remote"
  onDragStartEntries?: (entries: SftpEntryDto[]) => void
  dropHighlight?: boolean
  onDropOnPane?: () => void
  onDropOnEntry?: (entry: SftpEntryDto) => void
  onDragOverPane?: (e: React.DragEvent) => void
}

export function FileList({
  entries,
  selected,
  onSelect,
  onOpen,
  onContextMenu,
  dragSide,
  onDragStartEntries,
  dropHighlight,
  onDropOnPane,
  onDropOnEntry,
  onDragOverPane,
}: FileListProps) {
  const lastClicked = useRef<string | null>(null)
  const [dragOverPath, setDragOverPath] = useState<string | null>(null)

  const selectedSet = useMemo(() => new Set(selected), [selected])

  const handleClick = useCallback(
    (e: MouseEvent, entry: SftpEntryDto) => {
      const additive = e.ctrlKey || e.metaKey
      const range = e.shiftKey
      if (range && lastClicked.current) {
        const i0 = entries.findIndex((x) => x.path === lastClicked.current)
        const i1 = entries.findIndex((x) => x.path === entry.path)
        if (i0 >= 0 && i1 >= 0) {
          const [a, b] = i0 < i1 ? [i0, i1] : [i1, i0]
          onSelect(
            entries.slice(a, b + 1).map((x) => x.path),
            false,
            true,
          )
          return
        }
      }
      lastClicked.current = entry.path
      onSelect([entry.path], additive, false)

      // Immediate open on plain click (no delay).
      if (!additive && !range) {
        onOpen(entry)
      }
    },
    [entries, onSelect, onOpen],
  )

  return (
    <div
      className={cn(
        "min-h-0 flex-1 overflow-y-auto font-mono text-xs",
        dropHighlight && "bg-primary/5 ring-primary/30 ring-1 ring-inset",
      )}
      onContextMenu={(e) => {
        e.preventDefault()
        onContextMenu(e, null)
      }}
      onDragOver={(e) => {
        e.preventDefault()
        onDragOverPane?.(e)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setDragOverPath(null)
        onDropOnPane?.()
      }}
    >
      <div className="text-muted-foreground border-border sticky top-0 z-10 grid grid-cols-[minmax(0,1fr)_88px_140px] gap-2 border-b bg-background/95 px-2 py-1 text-[10px] uppercase tracking-wide backdrop-blur">
        <span>Name</span>
        <span className="text-right">Size</span>
        <span className="text-right">Modified</span>
      </div>
      {entries.length === 0 && (
        <p className="text-muted-foreground px-3 py-6 text-center text-xs">Empty folder</p>
      )}
      {entries.map((entry) => {
        const isSel = selectedSet.has(entry.path)
        return (
          <button
            key={entry.path}
            type="button"
            draggable
            className={cn(
              "hover:bg-muted/50 grid w-full grid-cols-[minmax(0,1fr)_88px_140px] items-center gap-2 px-2 py-1 text-left",
              isSel && "bg-muted",
              dragOverPath === entry.path && entry.isDir && "bg-primary/15 ring-primary/40 ring-1",
            )}
            onClick={(e) => handleClick(e, entry)}
            onContextMenu={(e) => {
              e.preventDefault()
              e.stopPropagation()
              if (!selectedSet.has(entry.path)) onSelect([entry.path])
              onContextMenu(e, entry)
            }}
            onDragStart={(e) => {
              const paths = selectedSet.has(entry.path) ? selected : [entry.path]
              const dragEntries = entries.filter((x) => paths.includes(x.path))
              e.dataTransfer.setData(
                "application/x-sshbool-sftp",
                JSON.stringify({ side: dragSide, paths: dragEntries.map((x) => x.path) }),
              )
              e.dataTransfer.effectAllowed = "copyMove"
              onDragStartEntries?.(dragEntries)
            }}
            onDragOver={(e) => {
              if (!entry.isDir) return
              e.preventDefault()
              e.stopPropagation()
              setDragOverPath(entry.path)
            }}
            onDragLeave={() => {
              if (dragOverPath === entry.path) setDragOverPath(null)
            }}
            onDrop={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setDragOverPath(null)
              if (entry.isDir) onDropOnEntry?.(entry)
            }}
          >
            <span className="flex min-w-0 items-center gap-2">
              {entry.isDir ? (
                <Folder className="size-3.5 shrink-0 text-amber-500" />
              ) : (
                <File className="size-3.5 text-muted-foreground shrink-0" />
              )}
              <span className="truncate">{entry.name}</span>
            </span>
            <span className="text-muted-foreground text-right tabular-nums">
              {entry.isDir ? "—" : formatBytes(entry.size)}
            </span>
            <span className="text-muted-foreground truncate text-right">
              {formatMtime(entry.mtime)}
            </span>
          </button>
        )
      })}
    </div>
  )
}
