import { WebviewWindow } from "@tauri-apps/api/webviewWindow"

import { toast } from "@/stores/toast.store"

export async function openTerminalPopout(opts: {
  paneId: string
  hostId: string
  title: string
  onClosed?: () => void
}): Promise<boolean> {
  const label = `terminal-${opts.paneId}`
  const existing = await WebviewWindow.getByLabel(label)
  if (existing) {
    await existing.setFocus()
    toast.info("Terminal window focused", opts.title)
    return true
  }

  const params = new URLSearchParams({
    mode: "terminal-popout",
    paneId: opts.paneId,
    hostId: opts.hostId,
    title: opts.title,
  })

  // Same absolute-URL pattern as editor popout (avoids blank child webviews).
  const url = `${window.location.origin}/?${params.toString()}`

  const win = new WebviewWindow(label, {
    url,
    title: `SSHBool — ${opts.title}`,
    width: 960,
    height: 640,
    minWidth: 480,
    minHeight: 320,
    // Match main window: custom chrome (WindowChrome) instead of OS title bar.
    decorations: false,
    resizable: true,
    focus: true,
    alwaysOnTop: false,
    visible: true,
  })

  win.once("tauri://destroyed", () => {
    opts.onClosed?.()
  })

  return await new Promise((resolve) => {
    win.once("tauri://created", () => {
      void win.show().catch(() => {})
      void win.setFocus().catch(() => {})
      toast.success("Terminal popped out", opts.title)
      resolve(true)
    })
    win.once("tauri://error", (e) => {
      toast.error("Could not open terminal window", String(e.payload ?? e))
      resolve(false)
    })
  })
}

export async function closeTerminalPopout(paneId: string): Promise<void> {
  const label = `terminal-${paneId}`
  const existing = await WebviewWindow.getByLabel(label)
  if (existing) await existing.close()
}
