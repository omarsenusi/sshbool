import { AlertCircle } from "lucide-react"

import { hostLetter } from "@/features/connections/host-appearance"
import { cn } from "@/lib/utils"
import type { HostConnStatus } from "@/stores/connection.store"

type HostRowProps = {
  label: string
  accent: string
  icon?: string | null
  selected?: boolean
  status: HostConnStatus
  title?: string
  onClick?: () => void
}

/**
 * Horizontal host entry for the rail's label mode — shows the server name
 * instead of just an icon. Status semantics match {@link HostTile}.
 */
export function HostRow({
  label,
  accent,
  icon,
  selected,
  status,
  title,
  onClick,
}: HostRowProps) {
  const connecting = status === "connecting"
  const connected = status === "connected"
  const errored = status === "error"
  const hasIcon = !!icon

  return (
    <div className="relative w-full">
      {/* -6px lines the pill up with the rail's left edge (container px-1.5). */}
      {selected && (
        <span
          className="bg-primary absolute top-1/2 -left-[6px] z-30 h-6 w-1 -translate-y-1/2 rounded-r-full shadow-sm"
          aria-hidden
        />
      )}

      <button
        type="button"
        title={title ?? label}
        aria-label={label}
        aria-current={selected ? "true" : undefined}
        aria-busy={connecting || undefined}
        className={cn(
          "hover:bg-sidebar-accent flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
          selected && "bg-sidebar-accent text-sidebar-accent-foreground",
        )}
        onClick={onClick}
      >
        <span
          className="relative flex size-5 shrink-0 items-center justify-center overflow-hidden rounded text-[10px] font-semibold text-white shadow-sm"
          style={{ backgroundColor: hasIcon ? "transparent" : accent }}
          aria-hidden
        >
          {hasIcon ? (
            <img src={icon} alt="" className="size-full object-cover" />
          ) : (
            hostLetter(label)
          )}
        </span>

        <span className="min-w-0 flex-1 truncate text-sm">{label}</span>

        {connecting && (
          <span
            className="size-1.5 shrink-0 animate-pulse rounded-full bg-sky-400"
            aria-hidden
          />
        )}
        {connected && !errored && (
          <span
            className="size-1.5 shrink-0 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(52,211,153,0.8)]"
            aria-hidden
          />
        )}
        {errored && (
          <AlertCircle
            className="text-destructive size-3.5 shrink-0"
            strokeWidth={2.5}
            aria-hidden
          />
        )}
      </button>
    </div>
  )
}
