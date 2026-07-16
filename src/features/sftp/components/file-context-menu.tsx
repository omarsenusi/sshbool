import { useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"

import { cn } from "@/lib/utils"

export type MenuItem =
  | { type: "item"; label: string; danger?: boolean; disabled?: boolean; onClick: () => void }
  | { type: "sep" }

export function FileContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const pad = 8
    let left = x
    let top = y

    // Prefer opening upward when near the bottom of the window
    if (y + rect.height > window.innerHeight - pad) {
      top = Math.max(pad, y - rect.height)
    }
    if (top + rect.height > window.innerHeight - pad) {
      top = Math.max(pad, window.innerHeight - rect.height - pad)
    }
    if (left + rect.width > window.innerWidth - pad) {
      left = Math.max(pad, window.innerWidth - rect.width - pad)
    }
    if (left < pad) left = pad

    setPos({ left, top })
  }, [x, y, items.length])

  return createPortal(
    <>
      <button
        type="button"
        className="fixed inset-0 z-[200] cursor-default"
        aria-label="Close menu"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault()
          onClose()
        }}
      />
      <div
        ref={ref}
        className="border-border bg-popover text-popover-foreground fixed z-[210] max-h-[min(420px,calc(100vh-16px))] min-w-[200px] overflow-y-auto rounded-md border py-1 shadow-lg"
        style={{ left: pos.left, top: pos.top }}
        role="menu"
      >
        {items.map((item, i) =>
          item.type === "sep" ? (
            <div key={`sep-${i}`} className="border-border my-1 border-t" />
          ) : (
            <button
              key={`${item.label}-${i}`}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              className={cn(
                "hover:bg-muted flex w-full px-3 py-1.5 text-left text-sm disabled:opacity-40",
                item.danger && "text-destructive",
              )}
              onClick={() => {
                item.onClick()
                onClose()
              }}
            >
              {item.label}
            </button>
          ),
        )}
      </div>
    </>,
    document.body,
  )
}
