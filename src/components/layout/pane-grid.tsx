import type { ReactNode } from "react"

export function PaneGrid({ children }: { children?: ReactNode }) {
  return (
    <div className="bg-background relative min-h-0 flex-1 overflow-hidden">{children}</div>
  )
}
