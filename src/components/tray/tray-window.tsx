/**
 * TrayWindow — standalone window rendered when ?mode=tray.
 * Opened by the Rust system tray left-click handler.
 * Closes itself (destroy) when focus is lost — Rust recreates it on next click.
 */
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow"
import { useEffect } from "react"
import { TrayPopup } from "@/components/tray/tray-popup"
import { ipc } from "@/lib/ipc/commands"

export function TrayWindow() {
  const win = getCurrentWebviewWindow()

  // Auto-close when window loses focus (clicks outside anywhere on OS)
  useEffect(() => {
    let unlisten: (() => void) | null = null

    // Force focus on window creation to ensure blur/focuschanged works reliably
    void win.setFocus().catch(() => {})

    // Check document focus right away
    if (!document.hasFocus()) {
      // If we somehow mounted without focus, close immediately
      void ipc.trayClose().catch(() => {})
      return
    }

    // native OS focus loss listener
    win.onFocusChanged(({ payload: focused }) => {
      if (!focused) {
        void ipc.trayClose().catch(() => {})
      }
    }).then((fn) => {
      unlisten = fn
    })

    // DOM focus loss listener fallback
    function handleBlur() {
      void ipc.trayClose().catch(() => {})
    }

    window.addEventListener("blur", handleBlur)
    return () => {
      if (unlisten) unlisten()
      window.removeEventListener("blur", handleBlur)
    }
  }, [win])

  return (
    <div className="h-screen w-screen overflow-hidden dark" style={{ background: "transparent" }}>
      <TrayPopup onClose={() => void ipc.trayClose().catch(() => {})} standalone />
    </div>
  )
}
