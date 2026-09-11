import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useMemo, useState } from "react"
import { Database, Loader2, Plus, Trash } from "lucide-react"

import { Button } from "@/components/ui/button"
import { DbAddConnectionForm } from "@/features/databases/components/db-add-connection-form"
import { DbBrowseWorkspace } from "@/features/databases/components/db-browse-workspace"
import {
  DbSchemaTree,
  type SelectedTable,
} from "@/features/databases/components/db-schema-tree"
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
    [list.data, hostId]
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

  const schemaError = schemaQuery.isError
    ? (schemaQuery.error as Error).message
    : null

  return (
    <div className="flex h-full bg-background text-xs text-foreground">
      {/* Connections sidebar */}
      <div className="flex h-full w-[260px] shrink-0 flex-col border-r border-border bg-muted/20">
        <div className="flex items-center justify-between border-b border-border p-3">
          <span className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
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

        <div className="flex-1 space-y-1 overflow-y-auto p-2">
          {list.isLoading ? (
            <div className="flex items-center justify-center py-6 text-muted-foreground">
              <Loader2 className="mr-2 size-4 animate-spin" />
              Loading…
            </div>
          ) : hostConnections.length === 0 ? (
            <div className="px-4 py-8 text-center text-muted-foreground">
              <p className="text-[11px]">No connections for this host.</p>
              <p className="mt-1 text-[10px] opacity-75">
                Add MySQL or PostgreSQL manually.
              </p>
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
                    active
                      ? "bg-muted/80 text-foreground"
                      : "text-muted-foreground hover:bg-muted/40"
                  )}
                >
                  <button
                    type="button"
                    onClick={() => handleSelectConnection(c.id)}
                    className="flex flex-1 items-center gap-2 overflow-hidden px-3 py-2 text-left"
                  >
                    <Database
                      className={cn("size-3.5 shrink-0", colors.text)}
                    />
                    <div className="flex flex-col truncate">
                      <span className="truncate text-[11px] font-medium text-foreground">
                        {c.name}
                      </span>
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
                    className="mr-1 rounded-sm p-1.5 opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive"
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
      <div className="flex h-full min-w-0 flex-1 flex-col">
        {showAdd ? (
          <DbAddConnectionForm hostId={hostId} onAdded={handleAdded} />
        ) : !connId ? (
          hostConnections.length > 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-muted-foreground">
              <Database className="size-10 opacity-30" />
              <p className="text-sm">Select a connection from the sidebar</p>
              <p className="text-xs opacity-75">
                or click Add to create a new one
              </p>
            </div>
          ) : (
            <DbAddConnectionForm hostId={hostId} onAdded={handleAdded} />
          )
        ) : (
          <>
            {/* Connection header + tabs */}
            <div className="shrink-0 border-b border-border bg-muted/10">
              <div className="flex items-center gap-2 px-4 py-2">
                <Database className="size-4 text-primary" />
                <span className="font-semibold">{selectedConn?.name}</span>
                <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground uppercase">
                  {selectedConn?.engine}
                </span>
                <span className="truncate font-mono text-[10px] text-muted-foreground">
                  {selectedConn?.username}@{selectedConn?.host}:
                  {selectedConn?.port} ({selectedConn?.database})
                </span>
              </div>
              <div className="flex w-full items-center justify-between gap-1 px-3 pb-2">
                <div className="flex gap-1">
                  {(["browse", "sql"] as const).map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setMainTab(tab)}
                      className={cn(
                        "rounded-md px-3 py-1 text-[11px] font-medium capitalize transition-colors",
                        mainTab === tab
                          ? "bg-primary/10 text-primary"
                          : "text-muted-foreground hover:bg-muted/50"
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
                  className="flex items-center gap-1 rounded-md px-3 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                >
                  <span>ER Diagram</span>
                  <span className="text-[10px]">↗</span>
                </button>
              </div>
            </div>

            <div className="flex min-h-0 flex-1">
              {/* Schema tree */}
              <div className="flex w-[240px] shrink-0 flex-col border-r border-border bg-muted/10">
                <div className="border-b border-border px-3 py-2 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
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
              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                {mainTab === "browse" && (
                  <DbBrowseWorkspace
                    connectionId={connId}
                    selected={selectedTable}
                  />
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
