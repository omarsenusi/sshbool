import { File, Folder } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, type MouseEvent } from "react"

import { formatBytes, formatMtime } from "@/features/sftp/lib/format-bytes"
import type { SftpEntryDto } from "@/lib/ipc/types"
import { cn } from "@/lib/utils"

export type InternalSftpDrag = { side: "local" | "remote"; paths: string[] }

const DRAG_THRESHOLD_PX = 6

export type FileListProps = {
  entries: SftpEntryDto[]
  selected: string[]
  onSelect: (paths: string[], additive?: boolean, range?: boolean) => void
  /** Double-click (or Enter) opens a folder / file. Single click only selects. */
  onOpen: (entry: SftpEntryDto) => void
  onContextMenu: (e: MouseEvent, entry: SftpEntryDto | null) => void
  dragSide: "local" | "remote"
  onDragStartEntries?: (entries: SftpEntryDto[]) => void
  onDragSessionMove?: (x: number, y: number) => void
  onDragSessionEnd?: (x: number, y: number) => void
  dropHighlight?: boolean
  highlightDropPath?: string | null
}

export function FileList({
  entries,
  selected,
  onSelect,
  onOpen,
  onContextMenu,
  dragSide,
  onDragStartEntries,
  onDragSessionMove,
  onDragSessionEnd,
  dropHighlight,
  highlightDropPath,
}: FileListProps) {
  const lastClicked = useRef<string | null>(null)
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  const entriesRef = useRef(entries)
  entriesRef.current = entries
  const dragOccurred = useRef(false)
  const collapseTimer = useRef<number | null>(null)
  const press = useRef<{
    pointerId: number
    x: number
    y: number
    entry: SftpEntryDto
    dragging: boolean
  } | null>(null)

  const onDragStartEntriesRef = useRef(onDragStartEntries)
  onDragStartEntriesRef.current = onDragStartEntries
  const onDragSessionMoveRef = useRef(onDragSessionMove)
  onDragSessionMoveRef.current = onDragSessionMove
  const onDragSessionEndRef = useRef(onDragSessionEnd)
  onDragSessionEndRef.current = onDragSessionEnd

  const selectedSet = useMemo(() => new Set(selected), [selected])

  const cancelCollapse = useCallback(() => {
    if (collapseTimer.current != null) {
      window.clearTimeout(collapseTimer.current)
      collapseTimer.current = null
    }
  }, [])

  useEffect(() => () => cancelCollapse(), [cancelCollapse])

  useEffect(() => {
    function entriesForDrag(entry: SftpEntryDto) {
      const current = selectedRef.current
      const paths = current.includes(entry.path) ? current : [entry.path]
      return entriesRef.current.filter((x) => paths.includes(x.path))
    }

    function onMove(e: PointerEvent) {
      const p = press.current
      if (!p || e.pointerId !== p.pointerId) return
      const dx = e.clientX - p.x
      const dy = e.clientY - p.y
      if (!p.dragging) {
        if (dx * dx + dy * dy < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return
        p.dragging = true
        dragOccurred.current = true
        cancelCollapse()
        document.body.style.userSelect = "none"
        document.body.style.cursor = "grabbing"
        onDragStartEntriesRef.current?.(entriesForDrag(p.entry))
      }
      onDragSessionMoveRef.current?.(e.clientX, e.clientY)
    }

    function onUp(e: PointerEvent) {
      const p = press.current
      if (!p || e.pointerId !== p.pointerId) return
      press.current = null
      document.body.style.userSelect = ""
      document.body.style.cursor = ""
      if (p.dragging) {
        dragOccurred.current = true
        onDragSessionEndRef.current?.(e.clientX, e.clientY)
      }
    }

    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
    window.addEventListener("pointercancel", onUp)
    return () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      window.removeEventListener("pointercancel", onUp)
      document.body.style.userSelect = ""
      document.body.style.cursor = ""
    }
  }, [cancelCollapse])

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
    },
    [entries, onSelect],
  )

  return (
    <div
      data-sftp-list-side={dragSide}
      className={cn(
        "min-h-0 h-full flex-1 overflow-y-auto font-mono text-xs",
        dropHighlight && "bg-primary/5 ring-primary/30 ring-1 ring-inset",
      )}
      onContextMenu={(e) => {
        e.preventDefault()
        onContextMenu(e, null)
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
          <div
            key={entry.path}
            role="button"
            tabIndex={0}
            data-sftp-drop-folder={entry.isDir ? entry.path : undefined}
            className={cn(
              "hover:bg-muted/50 grid w-full cursor-default grid-cols-[minmax(0,1fr)_88px_140px] items-center gap-2 px-2 py-1 text-left select-none",
              isSel && "bg-muted",
              highlightDropPath === entry.path &&
                entry.isDir &&
                "bg-primary/15 ring-primary/40 ring-1",
            )}
            onPointerDown={(e) => {
              if (e.button !== 0) return
              dragOccurred.current = false
              cancelCollapse()
              const additive = e.ctrlKey || e.metaKey
              const range = e.shiftKey
              // Pressing an already-selected row must keep the multi-selection,
              // otherwise a drag would collapse to the one file under the cursor.
              if (!additive && !range && !selectedSet.has(entry.path)) {
                lastClicked.current = entry.path
                onSelect([entry.path], false, false)
              }
              press.current = {
                pointerId: e.pointerId,
                x: e.clientX,
                y: e.clientY,
                entry,
                dragging: false,
              }
            }}
            onClick={(e) => {
              if (dragOccurred.current) {
                dragOccurred.current = false
                return
              }
              const additive = e.ctrlKey || e.metaKey
              const range = e.shiftKey
              if (
                !additive &&
                !range &&
                selectedSet.has(entry.path) &&
                selected.length > 1
              ) {
                lastClicked.current = entry.path
                cancelCollapse()
                collapseTimer.current = window.setTimeout(() => {
                  onSelect([entry.path], false, false)
                  collapseTimer.current = null
                }, 0)
                return
              }
              handleClick(e, entry)
            }}
            onDoubleClick={(e) => {
              e.preventDefault()
              onOpen(entry)
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
                e.preventDefault()
                onOpen(entry)
              }
            }}
            onContextMenu={(e) => {
              e.preventDefault()
              e.stopPropagation()
              if (!selectedSet.has(entry.path)) onSelect([entry.path])
              onContextMenu(e, entry)
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
          </div>
        )
      })}
    </div>
  )
}
