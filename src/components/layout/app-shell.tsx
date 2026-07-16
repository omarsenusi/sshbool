import type { ReactNode } from "react"

import { ContextSidebar } from "@/components/layout/context-sidebar"
import { HostRail } from "@/components/layout/host-rail"
import { PaneGrid } from "@/components/layout/pane-grid"
import { StatusBar } from "@/components/layout/status-bar"
import { TabBar } from "@/components/layout/tab-bar"
import { TitleBar } from "@/components/layout/title-bar"

type AppShellProps = {
  tabs?: ReactNode
  children: ReactNode
}

export function AppShell({ tabs, children }: AppShellProps) {
  return (
    <div className="bg-background flex h-full w-full flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1">
        <HostRail />
        <div className="flex min-w-0 flex-1 flex-col">
          <TitleBar />
          <div className="flex min-h-0 flex-1">
            <ContextSidebar />
            <main className="flex min-w-0 flex-1 flex-col">
              {tabs ? <TabBar>{tabs}</TabBar> : null}
              <PaneGrid>{children}</PaneGrid>
            </main>
          </div>
        </div>
      </div>
      <StatusBar />
    </div>
  )
}
