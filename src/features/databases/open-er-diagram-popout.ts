import { WebviewWindow } from "@tauri-apps/api/webviewWindow"

import { toast } from "@/stores/toast.store"

export async function openErDiagramPopout(opts: {
  connectionId: string
  hostId: string
  name: string
}): Promise<boolean> {
  const label = `er-diagram-${crypto.randomUUID()}`

  const params = new URLSearchParams({
    mode: "er-popout",
    connectionId: opts.connectionId,
    hostId: opts.hostId,
    name: opts.name,
  })

  const url = `${window.location.origin}/?${params.toString()}`

  const win = new WebviewWindow(label, {
    url,
    title: `SSHBool — ER Diagram — ${opts.name}`,
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 520,
    decorations: false,
    resizable: true,
    focus: true,
    visible: true,
  })

  return await new Promise((resolve) => {
    win.once("tauri://created", () => {
      void win.show().catch(() => {})
      void win.setFocus().catch(() => {})
      toast.success("ER Diagram opened in new window", opts.name)
      resolve(true)
    })
    win.once("tauri://error", (e) => {
      toast.error("Could not open ER Diagram window", String(e.payload ?? e))
      resolve(false)
    })
  })
}
