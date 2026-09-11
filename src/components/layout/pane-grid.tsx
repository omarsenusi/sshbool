import type { ReactNode } from "react"

export function PaneGrid({ children }: { children?: ReactNode }) {
  return (
    <div className="relative min-h-0 flex-1 overflow-hidden bg-background">
      {children}
    </div>
  )
}
