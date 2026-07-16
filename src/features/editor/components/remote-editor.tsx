import { useMutation, useQuery } from "@tanstack/react-query"
import { Save } from "lucide-react"
import { lazy, Suspense, useEffect, useState, type ReactNode } from "react"
import { useTheme } from "next-themes"

import { Button } from "@/components/ui/button"
import { ipc } from "@/lib/ipc/commands"
import { useEditorStore } from "@/stores/editor.store"

const MonacoEditor = lazy(() => import("@monaco-editor/react"))

export type EditorToolbarApi = {
  dirty: boolean
  saving: boolean
  save: () => void
}

type Props = {
  hostId: string
  path: string
  tabId?: string
  /** Hide the inner path/save chrome (workspace provides tabs). */
  compact?: boolean
  /** Custom toolbar; when set, default chrome is skipped. */
  renderToolbar?: (api: EditorToolbarApi) => ReactNode
}

export function RemoteEditor({
  hostId,
  path,
  tabId,
  compact,
  renderToolbar,
}: Props) {
  const { resolvedTheme } = useTheme()
  const setDirty = useEditorStore((s) => s.setDirty)
  const [value, setValue] = useState("")
  const [mtime, setMtime] = useState<number | null>(null)
  const [dirty, setLocalDirty] = useState(false)

  const file = useQuery({
    queryKey: ["sftp-read", hostId, path],
    queryFn: () => ipc.sftpRead(hostId, path),
    enabled: !!hostId && !!path,
  })

  useEffect(() => {
    if (file.data) {
      setValue(file.data.content)
      setMtime(file.data.mtime)
      setLocalDirty(false)
      if (tabId) setDirty(tabId, false)
    }
  }, [file.data, tabId, setDirty])

  const save = useMutation({
    mutationFn: () => ipc.sftpWrite(hostId, path, value, mtime),
    onSuccess: (res) => {
      setMtime(res.mtime)
      setLocalDirty(false)
      if (tabId) setDirty(tabId, false)
    },
  })

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault()
        if (dirty) save.mutate()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [dirty, save])

  if (!path) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
        Open a remote file from SFTP to edit.
      </div>
    )
  }

  if (file.isError) {
    return (
      <div className="text-destructive flex h-full items-center justify-center p-4 text-center text-sm">
        Failed to load file.
      </div>
    )
  }

  const toolbarApi: EditorToolbarApi = {
    dirty,
    saving: save.isPending,
    save: () => save.mutate(),
  }

  return (
    <div className="flex h-full flex-col">
      {renderToolbar ? (
        renderToolbar(toolbarApi)
      ) : !compact ? (
        <div className="border-border flex items-center justify-between border-b px-2 py-1 text-xs">
          <span className="font-mono">
            {path}
            {dirty ? " •" : ""}
          </span>
          <Button
            size="xs"
            disabled={!dirty || save.isPending}
            onClick={() => save.mutate()}
          >
            <Save className="mr-1 size-3" />
            Save
          </Button>
        </div>
      ) : (
        <div className="border-border flex items-center justify-end border-b px-2 py-1">
          <Button
            size="xs"
            disabled={!dirty || save.isPending}
            onClick={() => save.mutate()}
          >
            <Save className="mr-1 size-3" />
            Save
          </Button>
        </div>
      )}
      <div className="min-h-0 flex-1">
        <Suspense
          fallback={
            <div className="text-muted-foreground flex h-full items-center justify-center text-xs">
              Loading editor…
            </div>
          }
        >
          <MonacoEditor
            height="100%"
            theme={resolvedTheme === "dark" ? "vs-dark" : "light"}
            path={path}
            value={value}
            loading="Loading…"
            onChange={(v) => {
              setValue(v ?? "")
              setLocalDirty(true)
              if (tabId) setDirty(tabId, true)
            }}
            options={{
              fontFamily: "JetBrains Mono, monospace",
              fontSize: 13,
              minimap: { enabled: false },
              automaticLayout: true,
            }}
          />
        </Suspense>
      </div>
    </div>
  )
}
