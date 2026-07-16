import { getCurrentWindow } from "@tauri-apps/api/window"
import { lazy, Suspense, useEffect } from "react"

import { StatusBar } from "@/components/layout/status-bar"
import { WindowChrome } from "@/components/layout/window-chrome"
import { ErrorBoundary } from "@/features/editor/components/error-boundary"
import type { EditorPopoutParams } from "@/features/editor/parse-editor-popout"
import { editorTabTitle } from "@/stores/editor.store"

const EditorWorkspace = lazy(() =>
  import("@/features/editor/components/editor-workspace").then((m) => ({
    default: m.EditorWorkspace,
  })),
)

export function EditorPopoutWindow({ hostId, path }: EditorPopoutParams) {
  const title = editorTabTitle(path)

  useEffect(() => {
    void getCurrentWindow().setTitle(`SSHBool — ${title}`)
  }, [title])

  return (
    <div className="bg-background text-foreground flex h-screen w-screen flex-col overflow-hidden">
      <WindowChrome title="SSHBool" subtitle={title} />
      <div className="min-h-0 flex-1">
        <ErrorBoundary>
          <Suspense
            fallback={
              <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
                Loading editor…
              </div>
            }
          >
            <EditorWorkspace
              hostId={hostId}
              initialPath={path}
              showPopoutButton={false}
              singleFile
            />
          </Suspense>
        </ErrorBoundary>
      </div>
      <StatusBar />
    </div>
  )
}
