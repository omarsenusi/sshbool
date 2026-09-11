import { X } from "lucide-react"
import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

export function WindowTabStrip({
  children,
  trailing,
  className,
}: {
  children?: ReactNode
  trailing?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex h-[var(--tab-h)] shrink-0 items-center gap-1 overflow-hidden border-b border-border bg-sidebar/60 px-2",
        className
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {children}
      </div>
      {trailing ? (
        <div className="flex shrink-0 items-center gap-1">{trailing}</div>
      ) : null}
    </div>
  )
}

export function WindowTab({
  title,
  active,
  dirty,
  onSelect,
  onClose,
  leading,
}: {
  title: string
  active?: boolean
  dirty?: boolean
  onSelect?: () => void
  onClose?: () => void
  leading?: ReactNode
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex max-w-[200px] items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs transition-colors",
        active
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:bg-muted/50"
      )}
      onClick={onSelect}
    >
      {leading}
      <span className="min-w-0 flex-1 truncate">{title}</span>
      {dirty ? (
        <span className="size-1.5 shrink-0 rounded-full bg-primary" />
      ) : null}
      {onClose ? (
        <X
          className="size-3 shrink-0 opacity-60 hover:text-foreground hover:opacity-100"
          onClick={(e) => {
            e.stopPropagation()
            onClose()
          }}
        />
      ) : null}
    </button>
  )
}
