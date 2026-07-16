import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useMemo, useState } from "react"
import { Database, Loader2, Plus, Trash } from "lucide-react"

import { Button } from "@/components/ui/button"
import { DbAddConnectionForm } from "@/features/databases/components/db-add-connection-form"
import { DbBrowseWorkspace } from "@/features/databases/components/db-browse-workspace"
import { DbSchemaTree, type SelectedTable } from "@/features/databases/components/db-schema-tree"
import { DbSqlWorkspace } from "@/features/databases/components/db-sql-workspace"
import { getEngineColor } from "@/features/databases/lib/db-engine-colors"
import { openErDiagramPopout } from "@/features/databases/open-er-diagram-popout"
import { ipc } from "@/lib/ipc/commands"
import type { DbConnectionDto } from "@/lib/ipc/types"
import { cn } from "@/lib/utils"

type MainTab = "browse" | "sql"

export function DatabasesPanel({ hostId }: { hostId: string }) {
  const qc = useQueryClient()
  const [connId, setConnId] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [mainTab, setMainTab] = useState<MainTab>("browse")
  const [selectedTable, setSelectedTable] = useState<SelectedTable | null>(null)

  const list = useQuery({
    queryKey: ["db-connections"],
    queryFn: () => ipc.dbConnectionsList() as Promise<DbConnectionDto[]>,
  })

  const hostConnections = useMemo(
    () => (list.data ?? []).filter((c) => c.hostId === hostId),
    [list.data, hostId],
  )

  const selectedConn = hostConnections.find((c) => c.id === connId)

  const schemaQuery = useQuery({
    queryKey: ["db-schema", connId],
    queryFn: () => ipc.dbIntrospect(connId!),
    enabled: !!connId && !showAdd,
  })

  const deleteConn = useMutation({
    mutationFn: (id: string) => ipc.dbConnectionsDelete(id),
    onSuccess: (_, id) => {
      if (connId === id) {
        setConnId(null)
        setSelectedTable(null)
        setShowAdd(false)
      }
      void qc.invalidateQueries({ queryKey: ["db-connections"] })
    },
  })

  const handleSelectConnection = (id: string) => {
    setConnId(id)
    setShowAdd(false)
    setSelectedTable(null)
    setMainTab("browse")
  }

  const handleAdded = (id: string) => {
    setConnId(id)
    setShowAdd(false)
    setSelectedTable(null)
    setMainTab("browse")
  }

  const schemaError = schemaQuery.isError ? (schemaQuery.error as Error).message : null

  return (
    <div className="flex h-full text-xs text-foreground bg-background">
      {/* Connections sidebar */}
      <div className="w-[260px] border-r border-border flex flex-col h-full bg-muted/20 shrink-0">
        <div className="p-3 border-b border-border flex items-center justify-between">
          <span className="font-semibold text-[10px] uppercase tracking-wider text-muted-foreground">
            Connections
          </span>
          <Button
            size="xs"
            variant="outline"
            className="gap-1 text-[11px]"
            onClick={() => {
              setShowAdd(true)
              setConnId(null)
              setSelectedTable(null)
            }}
          >
            <Plus className="size-3" />
            Add
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {list.isLoading ? (
            <div className="flex items-center justify-center py-6 text-muted-foreground">
              <Loader2 className="size-4 animate-spin mr-2" />
              Loading…
            </div>
          ) : hostConnections.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground px-4">
              <p className="text-[11px]">No connections for this host.</p>
              <p className="text-[10px] opacity-75 mt-1">Add MySQL or PostgreSQL manually.</p>
            </div>
          ) : (
            hostConnections.map((c) => {
              const colors = getEngineColor(c.engine)
              const active = connId === c.id && !showAdd
              return (
                <div
                  key={c.id}
                  className={cn(
                    "group relative flex items-center rounded-md transition-colors",
                    active ? "bg-muted/80 text-foreground" : "hover:bg-muted/40 text-muted-foreground",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => handleSelectConnection(c.id)}
                    className="flex-1 text-left px-3 py-2 flex items-center gap-2 overflow-hidden"
                  >
                    <Database className={cn("size-3.5 shrink-0", colors.text)} />
                    <div className="flex flex-col truncate">
                      <span className="truncate font-medium text-[11px] text-foreground">{c.name}</span>
                      <span className="text-[9px] opacity-70">
                        {c.engine} · {c.database}
                      </span>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      deleteConn.mutate(c.id)
                    }}
                    className="opacity-0 group-hover:opacity-100 hover:text-destructive p-1.5 mr-1 rounded-sm transition-opacity"
                    title="Delete connection"
                  >
                    <Trash className="size-3" />
                  </button>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* Main area */}
      <div className="flex-1 flex flex-col h-full min-w-0">
        {showAdd ? (
          <DbAddConnectionForm hostId={hostId} onAdded={handleAdded} />
        ) : !connId ? (
          hostConnections.length > 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-2 p-8">
              <Database className="size-10 opacity-30" />
              <p className="text-sm">Select a connection from the sidebar</p>
              <p className="text-xs opacity-75">or click Add to create a new one</p>
            </div>
          ) : (
            <DbAddConnectionForm hostId={hostId} onAdded={handleAdded} />
          )
        ) : (
          <>
            {/* Connection header + tabs */}
            <div className="shrink-0 border-b border-border bg-muted/10">
              <div className="px-4 py-2 flex items-center gap-2">
                <Database className="size-4 text-primary" />
                <span className="font-semibold">{selectedConn?.name}</span>
                <span className="px-1.5 py-0.5 rounded bg-muted font-mono text-[9px] text-muted-foreground uppercase">
                  {selectedConn?.engine}
                </span>
                <span className="text-[10px] text-muted-foreground font-mono truncate">
                  {selectedConn?.username}@{selectedConn?.host}:{selectedConn?.port} ({selectedConn?.database})
                </span>
              </div>
              <div className="flex gap-1 px-3 pb-2 justify-between items-center w-full">
                <div className="flex gap-1">
                  {(["browse", "sql"] as const).map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setMainTab(tab)}
                      className={cn(
                        "px-3 py-1 rounded-md text-[11px] font-medium capitalize transition-colors",
                        mainTab === tab
                          ? "bg-primary/10 text-primary"
                          : "text-muted-foreground hover:bg-muted/50",
                      )}
                    >
                      {tab}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() =>
                    openErDiagramPopout({
                      connectionId: connId!,
                      hostId,
                      name: selectedConn?.name || "Database",
                    })
                  }
                  className="px-3 py-1 rounded-md text-[11px] font-medium text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors flex items-center gap-1"
                >
                  <span>ER Diagram</span>
                  <span className="text-[10px]">↗</span>
                </button>
              </div>
            </div>

            <div className="flex-1 flex min-h-0">
              {/* Schema tree */}
              <div className="w-[240px] border-r border-border flex flex-col shrink-0 bg-muted/10">
                <div className="px-3 py-2 border-b border-border text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Schema
                </div>
                <DbSchemaTree
                  schema={schemaQuery.data}
                  isLoading={schemaQuery.isLoading}
                  error={schemaError}
                  selected={selectedTable}
                  onSelect={(sel) => {
                    setSelectedTable(sel)
                    setMainTab("browse")
                  }}
                />
              </div>

              {/* Tab content */}
              <div className="flex-1 flex flex-col min-w-0 min-h-0">
                {mainTab === "browse" && (
                  <DbBrowseWorkspace connectionId={connId} selected={selectedTable} />
                )}
                {mainTab === "sql" && <DbSqlWorkspace connectionId={connId} />}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
