import { useMutation, useQuery } from "@tanstack/react-query"
import { Save } from "lucide-react"
import { lazy, Suspense, useEffect, useState, type ReactNode } from "react"
import { useTheme } from "next-themes"

import { Button } from "@/components/ui/button"
import { useEditorMonacoOptions } from "@/hooks/use-editor-monaco-options"
import { IpcError, ipc } from "@/lib/ipc/commands"
import { useEditorStore } from "@/stores/editor.store"
import { runSftpActivity } from "@/stores/sftp-activity.store"

const MonacoEditor = lazy(() => import("./monaco-editor-lazy"))

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
  const { monacoOptions, autoSave } = useEditorMonacoOptions()
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
    mutationFn: () => {
      const bytesTotal = new TextEncoder().encode(value).byteLength
      return runSftpActivity(
        {
          hostId,
          kind: "save",
          label: path,
          side: "remote",
          bytesTotal,
        },
        () => ipc.sftpWrite(hostId, path, value, mtime),
      )
    },
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

  useEffect(() => {
    if (!autoSave || !dirty || save.isPending) return
    const timer = window.setTimeout(() => {
      save.mutate()
    }, 1500)
    return () => window.clearTimeout(timer)
  }, [autoSave, dirty, value, save])

  if (!path) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
        Open a remote file from SFTP to edit.
      </div>
    )
  }

  if (file.isError) {
    const message =
      file.error instanceof IpcError
        ? file.error.message
        : file.error instanceof Error
          ? file.error.message
          : "Failed to load file."
    return (
      <div className="text-destructive flex h-full flex-col items-center justify-center gap-3 p-4 text-center text-sm">
        <p>Failed to load file.</p>
        <p className="text-muted-foreground max-w-md font-mono text-xs">{message}</p>
        <Button size="xs" variant="outline" onClick={() => void file.refetch()}>
          Retry
        </Button>
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
        {file.isLoading && !file.data ? (
          <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
            Loading file…
          </div>
        ) : (
          <Suspense
            fallback={
              <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
                Loading editor…
              </div>
            }
          >
            <MonacoEditor
              height="100%"
              theme={resolvedTheme === "dark" ? "vs-dark" : "light"}
              path={path}
              value={value}
              loading={
                <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
                  Loading editor…
                </div>
              }
              onChange={(v) => {
                setValue(v ?? "")
                setLocalDirty(true)
                if (tabId) setDirty(tabId, true)
              }}
              options={monacoOptions}
            />
          </Suspense>
        )}
      </div>
    </div>
  )
}
