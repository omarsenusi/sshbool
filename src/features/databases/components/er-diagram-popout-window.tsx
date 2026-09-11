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

  const schemaError = schemaQuery.isError
    ? (schemaQuery.error as Error).message
    : null

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      {/* Custom Window Title Bar */}
      <WindowChrome
        title={`ER Diagram — ${name}`}
        subtitle="Database Relation Map"
      />

      {/* Control bar */}
      <div className="flex shrink-0 items-center justify-between border-b border-border bg-muted/10 px-4 py-2">
        <div className="flex items-center gap-2">
          <Database className="size-4 text-primary" />
          <span className="text-xs font-semibold tracking-wider text-foreground uppercase">
            {name} Relation Map
          </span>
          {schemaQuery.isLoading && (
            <div className="ml-2 flex items-center gap-1 text-[10px] text-muted-foreground">
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
      <div className="flex min-h-0 flex-1 bg-neutral-950/20">
        {schemaQuery.isLoading ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="size-8 animate-spin text-primary" />
            <p className="text-xs">
              Analyzing tables, columns, and foreign keys...
            </p>
          </div>
        ) : schemaError ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-destructive">
            <Database className="size-10 opacity-35" />
            <h4 className="text-sm font-semibold">
              Failed to Introspect Database
            </h4>
            <p className="max-w-md text-xs opacity-90">{schemaError}</p>
          </div>
        ) : (
          <DbErDiagram schema={schemaQuery.data} />
        )}
      </div>
    </div>
  )
}
