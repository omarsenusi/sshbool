import { useQuery } from "@tanstack/react-query"
import { Database, Loader2, RefreshCw } from "lucide-react"
import { useState } from "react"

import { WindowChrome } from "@/components/layout/window-chrome"
import { DbErDiagram } from "@/features/databases/components/db-er-diagram"
import { ipc } from "@/lib/ipc/commands"
import { Button } from "@/components/ui/button"

type Props = {
  connectionId: string
  name: string
}

export function ErDiagramPopoutWindow({ connectionId, name }: Props) {
  const [refreshKey, setRefreshKey] = useState(0)

  const schemaQuery = useQuery({
    queryKey: ["db-schema", connectionId, refreshKey],
    queryFn: () => ipc.dbIntrospect(connectionId),
    enabled: !!connectionId,
  })

  const schemaError = schemaQuery.isError ? (schemaQuery.error as Error).message : null

  return (
    <div className="bg-background text-foreground flex h-screen w-screen flex-col overflow-hidden">
      {/* Custom Window Title Bar */}
      <WindowChrome title={`ER Diagram — ${name}`} subtitle="Database Relation Map" />

      {/* Control bar */}
      <div className="px-4 py-2 border-b border-border bg-muted/10 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Database className="size-4 text-primary" />
          <span className="font-semibold text-xs text-foreground uppercase tracking-wider">
            {name} Relation Map
          </span>
          {schemaQuery.isLoading && (
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground ml-2">
              <Loader2 className="size-3 animate-spin" />
              <span>Introspecting schema...</span>
            </div>
          )}
        </div>

        <Button
          size="xs"
          variant="outline"
          disabled={schemaQuery.isLoading}
          onClick={() => setRefreshKey((k) => k + 1)}
          className="gap-1"
        >
          <RefreshCw className="size-3" />
          Refresh
        </Button>
      </div>

      {/* Main content container */}
      <div className="flex-1 flex min-h-0 bg-neutral-950/20">
        {schemaQuery.isLoading ? (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-2">
            <Loader2 className="size-8 animate-spin text-primary" />
            <p className="text-xs">Analyzing tables, columns, and foreign keys...</p>
          </div>
        ) : schemaError ? (
          <div className="flex-1 flex flex-col items-center justify-center text-destructive gap-2 p-8 text-center">
            <Database className="size-10 opacity-35" />
            <h4 className="font-semibold text-sm">Failed to Introspect Database</h4>
            <p className="text-xs max-w-md opacity-90">{schemaError}</p>
          </div>
        ) : (
          <DbErDiagram schema={schemaQuery.data} />
        )}
      </div>
    </div>
  )
}
