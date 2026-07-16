import { useQuery } from "@tanstack/react-query"
import { File, Folder } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"

import { ipc } from "@/lib/ipc/commands"
import type { SftpEntryDto } from "@/lib/ipc/types"
import { cn } from "@/lib/utils"
import {
  joinRemotePath,
  normalizeRemotePath,
  splitRemotePath,
} from "@/features/sftp/lib/remote-path"

function splitPath(path: string): { dir: string; fragment: string } {
  return splitRemotePath(path)
}

function joinRemote(dir: string, name: string) {
  return joinRemotePath(dir, name)
}

type Props = {
  hostId: string
  value: string
  onChange: (path: string) => void
  onCommit?: (path: string) => void
  placeholder?: string
  className?: string
}

export function RemotePathInput({
  hostId,
  value,
  onChange,
  onCommit,
  placeholder = "/etc/nginx/nginx.conf",
  className,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [box, setBox] = useState({ left: 0, top: 0, width: 0 })

  const { dir, fragment } = useMemo(() => splitPath(value), [value])

  const listing = useQuery({
    queryKey: ["sftp", "path-suggest", hostId, dir],
    queryFn: () => ipc.sftpListDir(hostId, dir),
    enabled: !!hostId && open && !!dir,
    staleTime: 15_000,
  })

  const suggestions = useMemo(() => {
    const entries = listing.data ?? []
    const q = fragment.toLowerCase()
    const filtered = q
      ? entries.filter((e) => e.name.toLowerCase().startsWith(q))
      : entries
    return filtered.slice(0, 40)
  }, [listing.data, fragment])

  useEffect(() => {
    setActive(0)
  }, [suggestions])

  function updateBox() {
    const el = inputRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setBox({ left: r.left, top: r.bottom + 4, width: r.width })
  }

  function pick(entry: SftpEntryDto) {
    const next = joinRemote(dir, entry.name)
    if (entry.isDir) {
      onChange(`${next}/`)
      setOpen(true)
      inputRef.current?.focus()
    } else {
      onChange(next)
      setOpen(false)
      onCommit?.(next)
    }
  }

  return (
    <div className={cn("relative", className)}>
      <input
        ref={inputRef}
        className="border-input bg-background w-full rounded-md border px-2 py-1 font-mono text-xs outline-none"
        placeholder={placeholder}
        value={value}
        autoComplete="off"
        spellCheck={false}
        onFocus={() => {
          updateBox()
          setOpen(true)
        }}
        onBlur={() => {
          // delay so click on suggestion registers
          setTimeout(() => setOpen(false), 150)
        }}
        onChange={(e) => {
          onChange(normalizeRemotePath(e.target.value))
          updateBox()
          setOpen(true)
        }}
        onKeyDown={(e) => {
          if (!open || suggestions.length === 0) {
            if (e.key === "Enter") {
              onCommit?.(value)
              setOpen(false)
            }
            return
          }
          if (e.key === "ArrowDown") {
            e.preventDefault()
            setActive((i) => Math.min(i + 1, suggestions.length - 1))
          } else if (e.key === "ArrowUp") {
            e.preventDefault()
            setActive((i) => Math.max(i - 1, 0))
          } else if (e.key === "Enter" || e.key === "Tab") {
            e.preventDefault()
            const hit = suggestions[active]
            if (hit) pick(hit)
          } else if (e.key === "Escape") {
            setOpen(false)
          }
        }}
      />

      {open && suggestions.length > 0 &&
        createPortal(
          <ul
            className="border-border bg-popover text-popover-foreground fixed z-[220] max-h-64 overflow-y-auto rounded-md border py-1 shadow-lg"
            style={{ left: box.left, top: box.top, width: Math.max(box.width, 280) }}
            role="listbox"
          >
            {suggestions.map((e, i) => (
              <li key={e.path}>
                <button
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  className={cn(
                    "hover:bg-muted flex w-full items-center gap-2 px-2.5 py-1.5 text-left font-mono text-xs",
                    i === active && "bg-muted",
                  )}
                  onMouseDown={(ev) => {
                    ev.preventDefault()
                    pick(e)
                  }}
                  onMouseEnter={() => setActive(i)}
                >
                  {e.isDir ? (
                    <Folder className="size-3.5 shrink-0 text-amber-500" />
                  ) : (
                    <File className="text-muted-foreground size-3.5 shrink-0" />
                  )}
                  <span className="min-w-0 flex-1 truncate">{e.name}</span>
                  {e.isDir && <span className="text-muted-foreground text-[10px]">/</span>}
                </button>
              </li>
            ))}
            {listing.isFetching && (
              <li className="text-muted-foreground px-2.5 py-1 text-[10px]">Searching…</li>
            )}
          </ul>,
          document.body,
        )}
    </div>
  )
}
