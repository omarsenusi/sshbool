import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import { AppProviders } from "@/app/providers"
import { parseEditorPopoutParams } from "@/features/editor/parse-editor-popout"
import { parseTerminalPopoutParams } from "@/features/terminal/parse-terminal-popout"
import { parseErDiagramPopoutParams } from "@/features/databases/parse-er-diagram-popout"
import "@/styles/globals.css"

const root = document.getElementById("root") as HTMLElement
if (!root) {
  throw new Error("Root element #root not found")
}

const terminalPopout = parseTerminalPopoutParams()
const editorPopout = parseEditorPopoutParams()
const erDiagramPopout = parseErDiagramPopoutParams()

async function boot() {
  if (terminalPopout) {
    const { TerminalPopoutWindow } = await import(
      "@/features/terminal/components/terminal-popout-window"
    )
    createRoot(root).render(
      <StrictMode>
        <AppProviders>
          <TerminalPopoutWindow {...terminalPopout} />
        </AppProviders>
      </StrictMode>,
    )
    return
  }

  if (editorPopout) {
    const { EditorPopoutWindow } = await import(
      "@/features/editor/components/editor-popout-window"
    )
    createRoot(root).render(
      <StrictMode>
        <AppProviders>
          <EditorPopoutWindow {...editorPopout} />
        </AppProviders>
      </StrictMode>,
    )
    return
  }

  if (erDiagramPopout) {
    const { ErDiagramPopoutWindow } = await import(
      "@/features/databases/components/er-diagram-popout-window"
    )
    createRoot(root).render(
      <StrictMode>
        <AppProviders>
          <ErDiagramPopoutWindow {...erDiagramPopout} />
        </AppProviders>
      </StrictMode>,
    )
    return
  }

  const { App } = await import("@/App")
  createRoot(root).render(
    <StrictMode>
      <AppProviders>
        <App />
      </AppProviders>
    </StrictMode>,
  )
}

void boot().catch((err) => {
  console.error(err)
  root.innerHTML = `<pre style="color:#f88;padding:16px;font:12px monospace;white-space:pre-wrap">Failed to start: ${String(err)}</pre>`
})
