import { ExternalLink, Plus, Save } from "lucide-react"
import { useEffect, useMemo, useRef } from "react"

import { Button } from "@/components/ui/button"
import { WindowTab, WindowTabStrip } from "@/components/layout/window-tab"
import { RemoteEditor } from "@/features/editor/components/remote-editor"
import { RemotePathInput } from "@/features/editor/components/remote-path-input"
import { openEditorPopout } from "@/features/editor/open-editor-popout"
import { normalizeRemotePath } from "@/features/sftp/lib/remote-path"
import {
  editorTabTitle,
  useEditorStore,
} from "@/stores/editor.store"

export function EditorWorkspace({
  hostId,
  initialPath,
  showPopoutButton = true,
  /** Popout window: no tabs, readonly path, Save beside path. */
  singleFile = false,
}: {
  hostId: string
  /** Open this path once on mount if provided. */
  initialPath?: string
  showPopoutButton?: boolean
  singleFile?: boolean
}) {
  // Never filter inside the zustand selector — new arrays break getSnapshot caching.
  const allTabs = useEditorStore((s) => s.tabs)
  const activeId = useEditorStore((s) => s.activeId)
  const openTab = useEditorStore((s) => s.openTab)
  const closeTab = useEditorStore((s) => s.closeTab)
  const setActive = useEditorStore((s) => s.setActive)
  const updatePath = useEditorStore((s) => s.updatePath)
  const openedInitial = useRef<string | null>(null)

  const tabs = useMemo(
    () => allTabs.filter((t) => t.hostId === hostId),
    [allTabs, hostId],
  )

  const active =
    tabs.find((t) => t.id === activeId) ?? tabs[tabs.length - 1] ?? null

  useEffect(() => {
    if (!initialPath) return
    const key = `${hostId}::${normalizeRemotePath(initialPath)}`
    if (openedInitial.current === key) return
    openedInitial.current = key
    openTab(hostId, initialPath)
  }, [hostId, initialPath, openTab])

  if (singleFile) {
    const path = active?.path ?? (initialPath ? normalizeRemotePath(initialPath) : "")
    return (
      <div className="flex h-full min-h-0 flex-col">
        {path ? (
          <RemoteEditor
            key={active?.id ?? path}
            hostId={hostId}
            path={path}
            tabId={active?.id}
            renderToolbar={({ dirty, saving, save }) => (
              <div className="border-border flex items-center gap-2 border-b px-2 py-1">
                <input
                  readOnly
                  value={path}
                  title={path}
                  className="border-input bg-muted/40 text-muted-foreground w-full cursor-default rounded-md border px-2 py-1 font-mono text-xs outline-none"
                />
                <Button
                  size="xs"
                  className="shrink-0"
                  disabled={!dirty || saving}
                  onClick={save}
                >
                  <Save className="mr-1 size-3" />
                  Save
                </Button>
              </div>
            )}
          />
        ) : (
          <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
            No file open.
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <WindowTabStrip
        trailing={
          <div className="flex items-center gap-1">
            <Button
              size="icon-xs"
              variant="ghost"
              title="New tab"
              onClick={() => openTab(hostId, "")}
            >
              <Plus className="size-3.5" />
            </Button>
            {showPopoutButton && active?.path && (
              <Button
                size="icon-xs"
                variant="ghost"
                title="Open in new window"
                onClick={() =>
                  void openEditorPopout({
                    hostId,
                    path: active.path,
                  })
                }
              >
                <ExternalLink className="size-3.5" />
              </Button>
            )}
          </div>
        }
      >
        {tabs.map((t) => (
          <WindowTab
            key={t.id}
            title={t.path ? editorTabTitle(t.path) : "New file"}
            active={t.id === active?.id}
            dirty={t.dirty}
            onSelect={() => setActive(t.id)}
            onClose={() => closeTab(t.id)}
          />
        ))}
      </WindowTabStrip>

      <div className="border-border border-b px-2 py-1">
        <RemotePathInput
          hostId={hostId}
          value={active?.path ?? ""}
          onChange={(path) => {
            if (active) updatePath(active.id, path)
            else openTab(hostId, path)
          }}
          onCommit={(path) => {
            if (active) updatePath(active.id, path)
            else openTab(hostId, path)
          }}
          placeholder="/etc/nginx/nginx.conf"
        />
      </div>

      <div className="min-h-0 flex-1">
        {active?.path ? (
          <RemoteEditor
            key={active.id}
            hostId={hostId}
            path={active.path}
            tabId={active.id}
            compact
          />
        ) : (
          <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
            Open a remote file from SFTP, or type a path above.
          </div>
        )}
      </div>
    </div>
  )
}
