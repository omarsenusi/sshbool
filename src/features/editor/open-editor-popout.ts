import { WebviewWindow } from "@tauri-apps/api/webviewWindow"

import { toast } from "@/stores/toast.store"

export async function openEditorPopout(opts: {
  hostId: string
  path: string
}): Promise<boolean> {
  const label = `editor-${crypto.randomUUID()}`

  const params = new URLSearchParams({
    mode: "editor-popout",
    hostId: opts.hostId,
    path: opts.path,
  })

  // Absolute URL — relative `/?…` often loads a blank webview for child windows in Vite/Tauri.
  const url = `${window.location.origin}/?${params.toString()}`

  const name = opts.path.split("/").pop() || opts.path
  const win = new WebviewWindow(label, {
    url,
    title: `SSHBool — ${name}`,
    width: 1000,
    height: 720,
    minWidth: 520,
    minHeight: 360,
    decorations: false,
    resizable: true,
    focus: true,
    visible: true,
  })

  return await new Promise((resolve) => {
    win.once("tauri://created", () => {
      void win.show().catch(() => {})
      void win.setFocus().catch(() => {})
      toast.success("Editor popped out", name)
      resolve(true)
    })
    win.once("tauri://error", (e) => {
      toast.error("Could not open editor window", String(e.payload ?? e))
      resolve(false)
    })
  })
}
