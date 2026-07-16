import { X } from "lucide-react"

import { cn } from "@/lib/utils"
import { useToastStore } from "@/stores/toast.store"

export function Toaster() {
  const items = useToastStore((s) => s.items)
  const dismiss = useToastStore((s) => s.dismiss)

  if (items.length === 0) return null

  return (
    <div
      className="pointer-events-none fixed right-3 bottom-10 z-[100] flex w-[min(24rem,calc(100vw-1.5rem))] flex-col gap-2"
      aria-live="polite"
    >
      {items.map((t) => (
        <div
          key={t.id}
          className={cn(
            "pointer-events-auto border-border bg-popover text-popover-foreground flex items-start gap-2 rounded-lg border px-3 py-2 shadow-lg",
            t.kind === "success" && "border-emerald-500/40",
            t.kind === "error" && "border-destructive/50",
            t.kind === "info" && "border-sky-500/40",
          )}
          role="status"
        >
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">{t.title}</div>
            {t.description && (
              <div className="text-muted-foreground mt-0.5 text-xs break-words whitespace-pre-wrap">
                {t.description}
              </div>
            )}
          </div>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground shrink-0 rounded p-0.5"
            aria-label="Dismiss"
            onClick={() => dismiss(t.id)}
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  )
}
