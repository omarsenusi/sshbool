import type { ReactNode } from "react"

import { useLayoutStore } from "@/stores/layout.store"
import { cn } from "@/lib/utils"

export function PrimarySidebar({ children }: { children?: ReactNode }) {
  const open = useLayoutStore((s) => s.sidebarOpen)

  return (
    <aside
      className={cn(
        "shrink-0 overflow-hidden border-r border-border bg-sidebar transition-[width]",
        open ? "w-[var(--sidebar-w)]" : "w-0"
      )}
    >
      <div className="flex h-full w-[var(--sidebar-w)] flex-col">
        {children}
      </div>
    </aside>
  )
}
