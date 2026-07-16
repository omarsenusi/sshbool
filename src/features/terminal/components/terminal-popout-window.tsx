import { getCurrentWindow } from "@tauri-apps/api/window"
import { useEffect } from "react"

import { StatusBar } from "@/components/layout/status-bar"
import { WindowChrome } from "@/components/layout/window-chrome"
import { WindowTab, WindowTabStrip } from "@/components/layout/window-tab"
import { TerminalPane } from "@/features/terminal/components/terminal-pane"
import type { TerminalPopoutParams } from "@/features/terminal/parse-terminal-popout"

export type { TerminalPopoutParams }

/**
 * Pop-out terminal uses the same frameless chrome as the main window
 * (brand, pin-per-window, theme, window controls + tab strip).
 */
export function TerminalPopoutWindow({ paneId, title }: TerminalPopoutParams) {
  useEffect(() => {
    void getCurrentWindow().setTitle(`SSHBool — ${title}`)
  }, [title])

  return (
    <div className="bg-background flex h-screen w-screen flex-col overflow-hidden">
      <WindowChrome title="SSHBool" subtitle={title} />
      <WindowTabStrip>
        <WindowTab title={title} active leading={<span aria-hidden>↗</span>} />
      </WindowTabStrip>
      <div className="min-h-0 flex-1">
        <TerminalPane paneId={paneId} fontSize={14} visible />
      </div>
      <StatusBar />
    </div>
  )
}
