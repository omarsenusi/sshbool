import type { ReactNode } from "react"

import { WindowTabStrip } from "@/components/layout/window-tab"

/** @deprecated Prefer WindowTabStrip — kept as a thin alias for AppShell. */
export function TabBar({ children }: { children?: ReactNode }) {
  return <WindowTabStrip>{children}</WindowTabStrip>
}
