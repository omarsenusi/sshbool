import { AlertCircle } from "lucide-react"

import { hostLetter } from "@/features/connections/host-appearance"
import { cn } from "@/lib/utils"
import type { HostConnStatus } from "@/stores/connection.store"

type HostTileProps = {
  label: string
  accent: string
  icon?: string | null
  selected?: boolean
  status: HostConnStatus
  title?: string
  onClick?: () => void
}

export function HostTile({
  label,
  accent,
  icon,
  selected,
  status,
  title,
  onClick,
}: HostTileProps) {
  const connecting = status === "connecting"
  const connected = status === "connected"
  const errored = status === "error"
  const showWave = connecting
  const hasIcon = !!icon

  return (
    <div className="relative flex size-8 shrink-0 items-center justify-center">
      {/* Left active indicator pill */}
      {selected && (
        <span
          className="absolute -left-[10px] top-1/2 h-7 w-1 -translate-y-1/2 rounded-r-full bg-primary shadow-sm z-30"
        />
      )}

 <button
        type="button"
        title={title ?? label}
        aria-label={label}
        aria-current={selected ? "true" : undefined}
        aria-busy={connecting || undefined}
        className="relative flex size-8 shrink-0 items-center justify-center rounded-md text-xs font-semibold text-white shadow-sm transition-transform hover:scale-105"
        style={{
          backgroundColor: hasIcon ? "transparent" : accent,
        }}
        onClick={onClick}
      >
        {/* Clip wave / icon inside the tile; badges sit outside on the button */}
        <span className="pointer-events-none absolute inset-0 overflow-hidden rounded-md" aria-hidden>
          {hasIcon && (
            <img src={icon} alt="" className="absolute inset-0 size-full object-cover z-0" />
          )}
          {/* Pure Glass SVG Ocean Waves */}
          {showWave && (
            <div
              className={cn(
                "absolute inset-x-0 bottom-0 z-20 overflow-hidden pointer-events-none backdrop-blur-[3px]",
                connecting && "host-svg-wave--rising"
              )}
            >
              <svg
                className="absolute bottom-0 left-0 w-[200%] h-full animate-wave-slide"
                viewBox="0 0 1200 120"
                preserveAspectRatio="none"
              >
                <path
                  d="M0,10 C150,85 350,-35 500,45 C650,110 900,-25 1200,25 L1200,120 L0,120 Z"
                  fill="rgba(255, 255, 255, 0.22)"
                  stroke="rgba(255, 255, 255, 0.85)"
                  strokeWidth="3"
                />
              </svg>
              <svg
                className="absolute bottom-0 left-0 w-[200%] h-full animate-wave-slide-slow"
                viewBox="0 0 1200 120"
                preserveAspectRatio="none"
              >
                <path
                  d="M0,30 C200,-20 400,75 600,20 C800,-35 1000,65 1200,15 L1200,120 L0,120 Z"
                  fill="rgba(56, 189, 248, 0.18)"
                  stroke="rgba(255, 255, 255, 0.6)"
                  strokeWidth="2"
                />
              </svg>
            </div>
          )}
        </span>

        {!hasIcon && (
          <span className="relative z-10 drop-shadow-sm text-xs">{hostLetter(label)}</span>
        )}
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
    </div>
  )
}
