import { useMutation, useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query"
import { listen } from "@tauri-apps/api/event"
import { open as openDialog } from "@tauri-apps/plugin-dialog"
import { revealItemInDir } from "@tauri-apps/plugin-opener"
import { Download, Upload } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { DropOverlay } from "@/features/sftp/components/drop-overlay"
import {
  FileContextMenu,
  type MenuItem,
} from "@/features/sftp/components/file-context-menu"
import { FilePane, joinPath } from "@/features/sftp/components/file-pane"
import {
  ChmodDialog,
  ConfirmDeleteDialog,
  RenameDialog,
} from "@/features/sftp/components/rename-dialog"
import { SftpActivityStrip } from "@/features/sftp/components/sftp-activity-strip"
import { useOsFileDrop } from "@/features/sftp/hooks/use-file-drop"
import { usePathHistory } from "@/features/sftp/hooks/use-path-history"
import { useSftpClipboard, type PaneSide } from "@/features/sftp/lib/clipboard"
import { openEditorPopout } from "@/features/editor/open-editor-popout"
import {
  normalizeRemotePath,
  parentRemotePath,
} from "@/features/sftp/lib/remote-path"
import { ipc } from "@/lib/ipc/commands"
import type { SftpEntryDto, TransferJobDto } from "@/lib/ipc/types"
import { useConnectionStore } from "@/stores/connection.store"
import { useLayoutStore } from "@/stores/layout.store"
import { runSftpActivity } from "@/stores/sftp-activity.store"

type MenuState = { x: number; y: number; side: PaneSide; entry: SftpEntryDto | null }

function basename(path: string) {
  const parts = path.replace(/\\/g, "/").split("/")
  return parts[parts.length - 1] || path
}

function totalSize(entries: SftpEntryDto[]) {
  return entries.reduce((sum, e) => sum + (e.size || 0), 0)
}

export function SftpExplorer({ hostId }: { hostId: string }) {
  const qc = useQueryClient()
  const connected = useConnectionStore((s) => s.byHost[hostId]?.status === "connected")
  const clipboard = useSftpClipboard((s) => s.clipboard)
  const setClipboard = useSftpClipboard((s) => s.setClipboard)
  const clearClipboard = useSftpClipboard((s) => s.clearClipboard)

  const [localSelected, setLocalSelected] = useState<string[]>([])
  const [remoteSelected, setRemoteSelected] = useState<string[]>([])
  const [showHiddenLocal, setShowHiddenLocal] = useState(false)
  const [showHiddenRemote, setShowHiddenRemote] = useState(false)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [rename, setRename] = useState<{
    side: PaneSide
    path: string
    name: string
    size?: number
  } | null>(null)
  const [mkdirSide, setMkdirSide] = useState<PaneSide | null>(null)
  const [del, setDel] = useState<{
    side: PaneSide
    entries: SftpEntryDto[]
  } | null>(null)
  const [chmodPath, setChmodPath] = useState<string | null>(null)
  const [dragPayload, setDragPayload] = useState<{
    side: PaneSide
    paths: string[]
  } | null>(null)
  const [paneDrop, setPaneDrop] = useState<"local" | "remote" | null>(null)
  const [focusedPane, setFocusedPane] = useState<PaneSide>("remote")

  const localNav = usePathHistory("")
  const remoteNav = usePathHistory(".")
  const localPath = localNav.path
  const remotePath = remoteNav.path
  const setLocalPath = localNav.navigate
  const setRemotePath = remoteNav.navigate
  const localNavRef = useRef(localNav)
  const remoteNavRef = useRef(remoteNav)
  localNavRef.current = localNav
  remoteNavRef.current = remoteNav
  const focusedPaneRef = useRef(focusedPane)
  focusedPaneRef.current = focusedPane

  const home = useQuery({
    queryKey: ["local", "home"],
    queryFn: () => ipc.localHome(),
  })

  useEffect(() => {
    if (home.data && !localPath) localNav.replace(home.data)
  }, [home.data, localPath, localNav])

  const local = useQuery({
    queryKey: ["local", "list", localPath],
    queryFn: () => ipc.localListDir(localPath),
    enabled: !!localPath,
    placeholderData: keepPreviousData,
  })

  const remote = useQuery({
    queryKey: ["sftp", hostId, remotePath],
    queryFn: () => ipc.sftpListDir(hostId, remotePath),
    enabled: !!hostId && connected,
    placeholderData: keepPreviousData,
  })

  // After listing `.`, promote path bar to absolute cwd (e.g. /home/ubuntu).
  useEffect(() => {
    if (remotePath !== "." && remotePath !== "./") return
    const sample = remote.data?.[0]?.path
    if (!sample?.startsWith("/")) return
    const cwd = parentRemotePath(sample)
    if (cwd.startsWith("/")) remoteNav.replace(cwd)
  }, [remote.data, remotePath, remoteNav])

  // Mouse side buttons: back (3) / forward (4) — like a browser.
  useEffect(() => {
    function onMouseUp(e: globalThis.MouseEvent) {
      if (e.button !== 3 && e.button !== 4) return
      e.preventDefault()
      e.stopPropagation()
      const nav =
        focusedPaneRef.current === "local"
          ? localNavRef.current
          : remoteNavRef.current
      if (e.button === 3) {
        if (nav.canGoBack()) nav.goBack()
      } else if (nav.canGoForward()) {
        nav.goForward()
      }
    }
    function onMouseDown(e: globalThis.MouseEvent) {
      if (e.button === 3 || e.button === 4) e.preventDefault()
    }
    window.addEventListener("mouseup", onMouseUp)
    window.addEventListener("mousedown", onMouseDown)
    return () => {
      window.removeEventListener("mouseup", onMouseUp)
      window.removeEventListener("mousedown", onMouseDown)
    }
  }, [])

  const transfers = useQuery({
    queryKey: ["transfers", "list"],
    queryFn: () => ipc.transfersList(),
    refetchInterval: (q) => {
      const rows = q.state.data ?? []
      const active = rows.some(
        (t) => t.status === "active" || t.status === "queued",
      )
      return active ? 500 : 4000
    },
  })

  useEffect(() => {
    let unlisten: (() => void) | undefined
    void listen<TransferJobDto>("transfer://progress", (event) => {
      const p = event.payload
      qc.setQueryData<TransferJobDto[]>(["transfers", "list"], (old) => {
        if (!old) return [p]
        const idx = old.findIndex((t) => t.id === p.id)
        if (idx >= 0) {
          const next = [...old]
          next[idx] = { ...next[idx], ...p }
          return next
        }
        return [p, ...old]
      })
    }).then((fn) => {
      unlisten = fn
    })
    return () => {
      unlisten?.()
    }
  }, [qc])

  const invalidateAll = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: ["local"] })
    await qc.invalidateQueries({ queryKey: ["sftp", hostId] })
    await qc.invalidateQueries({ queryKey: ["transfers"] })
  }, [qc, hostId])

  const uploadPaths = useMutation({
    mutationFn: async (paths: string[]) => {
      // Progress + size come from transfer jobs (active → done).
      await qc.invalidateQueries({ queryKey: ["transfers"] })
      if (paths.length === 1) {
        return [await ipc.transferUpload(hostId, paths[0]!, remotePath)]
      }
      return ipc.transferUploadMany(hostId, paths, remotePath)
    },
    onSuccess: () => void invalidateAll(),
  })

  const downloadPaths = useMutation({
    mutationFn: async (paths: string[]) => {
      await qc.invalidateQueries({ queryKey: ["transfers"] })
      const ids: string[] = []
      for (const p of paths) {
        ids.push(await ipc.transferDownload(hostId, p, localPath))
      }
      return ids
    },
    onSuccess: () => void invalidateAll(),
  })

  const remotePaneRef = useRef<HTMLDivElement>(null)

  const onOsDrop = useCallback(
    (paths: string[]) => {
      if (!connected || paths.length === 0) return
      uploadPaths.mutate(paths)
    },
    [connected, uploadPaths],
  )

  const { dragging: osDragging } = useOsFileDrop(
    connected,
    onOsDrop,
    remotePaneRef,
  )

  const localEntries = local.data ?? []
  const remoteEntries = remote.data ?? []

  function selectHandler(
    side: PaneSide,
    paths: string[],
    additive?: boolean,
    range?: boolean,
  ) {
    setFocusedPane(side)
    const setter = side === "local" ? setLocalSelected : setRemoteSelected
    if (range) {
      setter(paths)
      return
    }
    if (additive) {
      setter((prev) => {
        const next = new Set(prev)
        for (const p of paths) {
          if (next.has(p)) next.delete(p)
          else next.add(p)
        }
        return [...next]
      })
    } else {
      setter(paths)
    }
  }

  function entriesFor(side: PaneSide, paths: string[]) {
    const list = side === "local" ? localEntries : remoteEntries
    return list.filter((e) => paths.includes(e.path))
  }

  async function doPaste(side: PaneSide, destDir: string) {
    if (!clipboard?.entries.length) return
    const { side: srcSide, mode, entries } = clipboard
    const names = entries.map((e) => e.name).join(", ")

    await runSftpActivity(
      {
        hostId,
        kind: mode === "cut" ? "move" : "paste",
        label: `${names} → ${destDir}`,
        side,
        bytesTotal: totalSize(entries),
      },
      async () => {
        for (const entry of entries) {
          const dest = joinPath(destDir, entry.name, side)
          if (srcSide === "remote" && side === "remote") {
            if (mode === "copy") await ipc.sftpCopy(hostId, entry.path, dest)
            else await ipc.sftpRename(hostId, entry.path, dest)
          } else if (srcSide === "local" && side === "local") {
            if (mode === "cut") await ipc.localRename(entry.path, dest)
            // local-local copy: not supported without local_copy — skip (user can upload)
          } else if (srcSide === "local" && side === "remote") {
            await ipc.transferUpload(hostId, entry.path, destDir)
            if (mode === "cut") await ipc.localDelete(entry.path, true)
          } else {
            await ipc.transferDownload(hostId, entry.path, destDir)
            if (mode === "cut") await ipc.sftpDelete(hostId, entry.path, true)
          }
        }
        if (mode === "cut") clearClipboard()
        await invalidateAll()
      },
    )
  }

  function buildMenu(side: PaneSide, entry: SftpEntryDto | null): MenuItem[] {
    const selected =
      side === "local"
        ? entriesFor("local", localSelected)
        : entriesFor("remote", remoteSelected)
    const focus = entry ?? selected[0] ?? null
    const multi = selected.length > 1
    const targets = multi ? selected : focus ? [focus] : []
    const items: MenuItem[] = []

    if (focus?.isDir) {
      items.push({
        type: "item",
        label: "Open",
        onClick: () =>
          side === "local" ? setLocalPath(focus.path) : setRemotePath(focus.path),
      })
    } else if (focus && !focus.isDir && side === "remote") {
      items.push({
        type: "item",
        label: "Open in editor",
        onClick: () => {
          useLayoutStore.getState().openEditor(hostId, normalizeRemotePath(focus.path))
        },
      })
      items.push({
        type: "item",
        label: "Open in new window",
        onClick: () => {
          void openEditorPopout({
            hostId,
            path: normalizeRemotePath(focus.path),
          })
        },
      })
    }

    if (side === "local" && focus) {
      items.push({
        type: "item",
        label: "Upload to remote",
        onClick: () =>
          uploadPaths.mutate(targets.map((e) => e.path)),
      })
      items.push({
        type: "item",
        label: "Reveal in explorer",
        onClick: () => void revealItemInDir(focus.path),
      })
    }
    if (side === "remote" && focus) {
      items.push({
        type: "item",
        label: "Download",
        onClick: () => downloadPaths.mutate(targets.map((e) => e.path)),
      })
    }

    items.push({ type: "sep" })
    items.push({
      type: "item",
      label: "Rename",
      disabled: !focus || multi,
      onClick: () =>
        focus &&
        setRename({
          side,
          path: focus.path,
          name: focus.name,
          size: focus.size,
        }),
    })
    items.push({
      type: "item",
      label: "Copy",
      disabled: !focus,
      onClick: () => setClipboard({ side, mode: "copy", entries: targets }),
    })
    items.push({
      type: "item",
      label: "Cut",
      disabled: !focus,
      onClick: () => setClipboard({ side, mode: "cut", entries: targets }),
    })
    items.push({
      type: "item",
      label: "Paste",
      disabled: !clipboard?.entries.length,
      onClick: () =>
        void doPaste(
          side,
          focus?.isDir
            ? focus.path
            : side === "local"
              ? localPath
              : remotePath,
        ),
    })
    items.push({
      type: "item",
      label: "Delete",
      danger: true,
      disabled: targets.length === 0,
      onClick: () => setDel({ side, entries: targets }),
    })

    items.push({ type: "sep" })
    items.push({
      type: "item",
      label: "New folder",
      onClick: () => setMkdirSide(side),
    })
    if (side === "remote" && focus && !multi) {
      items.push({
        type: "item",
        label: "Permissions…",
        onClick: () => setChmodPath(focus.path),
      })
    }
    items.push({
      type: "item",
      label: "Copy path",
      disabled: !focus,
      onClick: () => {
        if (focus) void navigator.clipboard.writeText(focus.path)
      },
    })
    items.push({
      type: "item",
      label: "Refresh",
      onClick: () => void invalidateAll(),
    })
    return items
  }

  async function handleCrossDrop(targetSide: PaneSide, destDir: string) {
    if (!dragPayload) return
    const { side, paths } = dragPayload
    const ents = entriesFor(side, paths)
    const bytes = totalSize(ents)

    if (side === targetSide) {
      const label =
        paths.length === 1
          ? `${basename(paths[0]!)} → ${destDir}`
          : `${paths.length} items → ${destDir}`
      await runSftpActivity(
        {
          hostId,
          kind: "move",
          label,
          side: targetSide,
          bytesTotal: bytes || undefined,
        },
        async () => {
          for (const p of paths) {
            const name = basename(p)
            const dest = joinPath(destDir, name, targetSide)
            if (side === "remote") await ipc.sftpRename(hostId, p, dest)
            else await ipc.localRename(p, dest)
          }
        },
      )
    } else if (side === "local" && targetSide === "remote") {
      await ipc.transferUploadMany(hostId, paths, destDir)
    } else {
      for (const p of paths) await ipc.transferDownload(hostId, p, destDir)
    }
    setDragPayload(null)
    setPaneDrop(null)
    await invalidateAll()
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return

      const side: PaneSide =
        remoteSelected.length > 0 && localSelected.length === 0 ? "remote" : "local"
      const selected = side === "local" ? localSelected : remoteSelected
      const entries = entriesFor(side, selected)

      if (e.key === "F2" && entries[0]) {
        e.preventDefault()
        setRename({
          side,
          path: entries[0].path,
          name: entries[0].name,
          size: entries[0].size,
        })
      }
      if (e.key === "Delete" && entries.length) {
        e.preventDefault()
        setDel({ side, entries })
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c" && entries.length) {
        setClipboard({ side, mode: "copy", entries })
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "x" && entries.length) {
        setClipboard({ side, mode: "cut", entries })
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") {
        void doPaste(side, side === "local" ? localPath : remotePath)
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        e.preventDefault()
        const list = side === "local" ? localEntries : remoteEntries
        if (side === "local") setLocalSelected(list.map((x) => x.path))
        else setRemoteSelected(list.map((x) => x.path))
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    localSelected,
    remoteSelected,
    localEntries,
    remoteEntries,
    localPath,
    remotePath,
    clipboard,
  ])

  const recentTransfers = useMemo(
    () => (transfers.data ?? []).filter((t) => t.hostId === hostId),
    [transfers.data, hostId],
  )

  if (!connected) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
        SFTP is offline — connect this host first.
      </div>
    )
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="border-border flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <span className="text-muted-foreground text-xs">
          Connected · Local ↔ Remote
        </span>
        <div className="ml-auto flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={uploadPaths.isPending}
            onClick={async () => {
              const picked = await openDialog({
                multiple: true,
                title: "Upload files",
              })
              if (!picked) return
              const paths = Array.isArray(picked) ? picked : [picked]
              uploadPaths.mutate(paths)
            }}
          >
            <Upload className="size-3.5" />
            Upload
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!remoteSelected.length || downloadPaths.isPending}
            onClick={async () => {
              const dir = await openDialog({
                directory: true,
                title: "Download to folder",
              })
              if (!dir || Array.isArray(dir)) return
              for (const p of remoteSelected) {
                await ipc.transferDownload(hostId, p, dir)
              }
              await invalidateAll()
            }}
          >
            <Download className="size-3.5" />
            Download
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-0">
        <div
          className="flex min-h-0 min-w-0 flex-1 flex-col"
          onMouseDown={() => setFocusedPane("local")}
        >
        <FilePane
          title="Local"
          side="local"
          path={localPath || "…"}
          onPathChange={(p) => {
            setFocusedPane("local")
            setLocalPath(p)
          }}
          entries={localEntries}
          loading={local.isFetching}
          error={local.error ? String(local.error) : null}
          selected={localSelected}
          onSelect={(p, a, r) => selectHandler("local", p, a, r)}
          onOpen={(e) => {
            setFocusedPane("local")
            if (e.isDir) setLocalPath(e.path)
          }}
          onRefresh={() => void qc.invalidateQueries({ queryKey: ["local"] })}
          onMkdir={() => setMkdirSide("local")}
          onContextMenu={(e, entry) => {
            setFocusedPane("local")
            setMenu({ x: e.clientX, y: e.clientY, side: "local", entry })
          }}
          showHidden={showHiddenLocal}
          onToggleHidden={() => setShowHiddenLocal((v) => !v)}
          dropHighlight={paneDrop === "local"}
          onDragStartEntries={(ents) =>
            setDragPayload({ side: "local", paths: ents.map((x) => x.path) })
          }
          onDragOverPane={(e) => {
            if (dragPayload && dragPayload.side !== "local") {
              e.preventDefault()
              setPaneDrop("local")
            }
          }}
          onDropOnPane={() => void handleCrossDrop("local", localPath)}
          onDropOnEntry={(entry) => void handleCrossDrop("local", entry.path)}
        />
        </div>
        <div
          ref={remotePaneRef}
          className="relative flex min-h-0 min-w-0 flex-1 flex-col"
          onMouseDown={() => setFocusedPane("remote")}
        >
          <FilePane
            title="Remote"
            side="remote"
            path={remotePath}
            onPathChange={(p) => {
              setFocusedPane("remote")
              setRemotePath(p)
            }}
            entries={remoteEntries}
            loading={remote.isFetching}
            error={remote.error ? String(remote.error) : null}
            selected={remoteSelected}
            onSelect={(p, a, r) => selectHandler("remote", p, a, r)}
            onOpen={(e) => {
              setFocusedPane("remote")
              if (e.isDir) {
                setRemotePath(normalizeRemotePath(e.path))
                return
              }
              void openEditorPopout({
                hostId,
                path: normalizeRemotePath(e.path),
              })
            }}
            onRefresh={() => void qc.invalidateQueries({ queryKey: ["sftp", hostId] })}
            onMkdir={() => setMkdirSide("remote")}
            onContextMenu={(e, entry) => {
              setFocusedPane("remote")
              setMenu({ x: e.clientX, y: e.clientY, side: "remote", entry })
            }}
            showHidden={showHiddenRemote}
            onToggleHidden={() => setShowHiddenRemote((v) => !v)}
            dropHighlight={paneDrop === "remote" || osDragging}
            onDragStartEntries={(ents) =>
              setDragPayload({ side: "remote", paths: ents.map((x) => x.path) })
            }
            onDragOverPane={(e) => {
              if (dragPayload && dragPayload.side !== "remote") {
                e.preventDefault()
                setPaneDrop("remote")
              }
            }}
            onDropOnPane={() => void handleCrossDrop("remote", remotePath)}
            onDropOnEntry={(entry) => void handleCrossDrop("remote", entry.path)}
            className="h-full"
          />
          <DropOverlay visible={osDragging} />
        </div>
      </div>

      <SftpActivityStrip hostId={hostId} transfers={recentTransfers} />

      {menu && (
        <FileContextMenu
          x={menu.x}
          y={menu.y}
          items={buildMenu(menu.side, menu.entry)}
          onClose={() => setMenu(null)}
        />
      )}

      <RenameDialog
        open={!!rename}
        initial={rename?.name ?? ""}
        onClose={() => setRename(null)}
        onSubmit={async (name) => {
          if (!rename) return
          const parent =
            rename.side === "local"
              ? rename.path.replace(/[/\\][^/\\]+$/, "") || rename.path
              : rename.path.replace(/\/[^/]+$/, "") || "."
          const dest = joinPath(parent, name, rename.side)
          await runSftpActivity(
            {
              hostId,
              kind: "rename",
              label: `${rename.name} → ${name}`,
              side: rename.side,
              bytesTotal: rename.size || undefined,
            },
            async () => {
              if (rename.side === "local") await ipc.localRename(rename.path, dest)
              else await ipc.sftpRename(hostId, rename.path, dest)
            },
          )
          setRename(null)
          await invalidateAll()
        }}
      />

      <RenameDialog
        open={!!mkdirSide}
        initial="New folder"
        title="New folder"
        onClose={() => setMkdirSide(null)}
        onSubmit={async (name) => {
          if (!mkdirSide) return
          const base = mkdirSide === "local" ? localPath : remotePath
          const dest = joinPath(base, name, mkdirSide)
          await runSftpActivity(
            {
              hostId,
              kind: "mkdir",
              label: name,
              side: mkdirSide,
            },
            async () => {
              if (mkdirSide === "local") await ipc.localMkdir(dest)
              else await ipc.sftpMkdir(hostId, dest)
            },
          )
          setMkdirSide(null)
          await invalidateAll()
        }}
      />

      <ConfirmDeleteDialog
        open={!!del}
        names={(del?.entries ?? []).map((e) => e.name)}
        isDir={(del?.entries ?? []).some((e) => e.isDir)}
        onClose={() => setDel(null)}
        onConfirm={async () => {
          if (!del) return
          const names = del.entries.map((e) => e.name).join(", ")
          await runSftpActivity(
            {
              hostId,
              kind: "delete",
              label: names,
              side: del.side,
              bytesTotal: totalSize(del.entries) || undefined,
            },
            async () => {
              for (const e of del.entries) {
                if (del.side === "local") await ipc.localDelete(e.path, true)
                else await ipc.sftpDelete(hostId, e.path, true)
              }
            },
          )
          setDel(null)
          setLocalSelected([])
          setRemoteSelected([])
          await invalidateAll()
        }}
      />

      <ChmodDialog
        open={!!chmodPath}
        onClose={() => setChmodPath(null)}
        onSubmit={async (mode) => {
          if (!chmodPath) return
          await runSftpActivity(
            {
              hostId,
              kind: "chmod",
              label: `${basename(chmodPath)} → ${mode}`,
              side: "remote",
            },
            async () => {
              await ipc.sftpChmod(hostId, chmodPath, mode)
            },
          )
          setChmodPath(null)
          await invalidateAll()
        }}
      />
    </div>
  )
}
