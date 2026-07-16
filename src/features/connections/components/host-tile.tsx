import { AlertCircle } from "lucide-react"

import { hostLetter } from "@/features/connections/host-appearance"
import { cn } from "@/lib/utils"
import type { HostConnStatus } from "@/stores/connection.store"

type HostTileProps = {
  label: string
  accent: string
  selected?: boolean
  status: HostConnStatus
  title?: string
  onClick?: () => void
}

export function HostTile({
  label,
  accent,
  selected,
  status,
  title,
  onClick,
}: HostTileProps) {
  const connecting = status === "connecting"
  const connected = status === "connected"
  const errored = status === "error"
  const showWave = connecting || connected

  return (
    <button
      type="button"
      title={title ?? label}
      aria-label={label}
      aria-current={selected ? "true" : undefined}
      aria-busy={connecting || undefined}
      className={cn(
        "relative flex size-9 shrink-0 items-center justify-center rounded-md text-sm font-semibold text-white shadow-sm transition-transform",
        selected && "scale-105",
        !selected && "hover:scale-105",
      )}
      style={{
        backgroundColor: showWave ? "#15803d" : accent,
        boxShadow: selected
          ? `0 0 0 2px var(--sidebar), 0 0 0 4px ${errored ? "#dc2626" : accent}`
          : undefined,
      }}
      onClick={onClick}
    >
      {/* Clip wave inside the tile; badges sit outside on the button */}
      <span className="pointer-events-none absolute inset-0 overflow-hidden rounded-md" aria-hidden>
        {showWave && (
          <span
            className={cn(
              "host-wave absolute inset-x-0 bottom-0 from-blue-600 via-sky-500 to-cyan-400 bg-gradient-to-t",
              connecting && "host-wave--rising",
              connected && "host-wave--full",
            )}
          />
        )}
      </span>

      <span className="relative z-10 drop-shadow-sm">{hostLetter(label)}</span>

      {connected && !errored && (
        <span
          className="border-sidebar absolute -right-0.5 -bottom-0.5 z-20 size-2.5 rounded-full border-2 bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]"
          aria-hidden
        />
      )}

      {errored && (
        <span
          className="bg-background absolute -top-1 -right-1 z-20 flex size-4 items-center justify-center rounded-full text-destructive shadow"
          title="Connection failed"
        >
          <AlertCircle className="size-3.5" strokeWidth={2.5} />
        </span>
      )}
    </button>
  )
}
