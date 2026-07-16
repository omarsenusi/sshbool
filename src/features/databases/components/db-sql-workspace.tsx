import { AlertCircle, Loader2, Play } from "lucide-react"
import { useState } from "react"
import { useMutation } from "@tanstack/react-query"

import { DbResultGrid } from "@/features/databases/components/db-result-grid"
import { Button } from "@/components/ui/button"
import { ipc } from "@/lib/ipc/commands"
import type { DbQueryResultDto } from "@/lib/ipc/types"

type Props = {
  connectionId: string
  initialSql?: string
}

export function DbSqlWorkspace({ connectionId, initialSql = "SELECT 1;" }: Props) {
  const [sql, setSql] = useState(initialSql)
  const [result, setResult] = useState<DbQueryResultDto | null>(null)

  const run = useMutation({
    mutationFn: () => ipc.dbQuery(connectionId, sql),
    onSuccess: setResult,
  })

  const hasGrid = result?.columns && result.columns.length > 0

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-4 py-2 border-b border-border bg-muted/10 flex items-center justify-between shrink-0">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          SQL Editor
        </span>
        <Button size="sm" disabled={run.isPending} onClick={() => run.mutate()} className="gap-1.5">
          {run.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
          Run Query
        </Button>
      </div>

      <div className="shrink-0 p-3 border-b border-border">
        <textarea
          className="w-full h-28 border border-border bg-muted/10 rounded-md p-3 font-mono text-[11px] resize-none outline-none focus:ring-1 focus:ring-primary"
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          placeholder="SELECT * FROM users LIMIT 10;"
        />
      </div>

      <div className="flex-1 flex flex-col min-h-0 p-3 gap-2">
        {run.isError && (
          <p className="text-xs text-destructive flex items-center gap-2">
            <AlertCircle className="size-3.5 shrink-0" />
            {(run.error as Error).message}
          </p>
        )}

        {result && (
          <div className="text-[10px] text-muted-foreground shrink-0">
            {result.durationMs}ms
            {result.rowCount != null ? ` · ${result.rowCount} rows` : ""}
          </div>
        )}

        {hasGrid ? (
          <DbResultGrid className="flex-1 min-h-0" columns={result!.columns!} rows={result!.rows ?? []} />
        ) : result?.output ? (
          <pre className="flex-1 overflow-auto rounded-md border border-border bg-neutral-950 text-neutral-200 p-3 font-mono text-[11px] whitespace-pre-wrap">
            {result.output}
          </pre>
        ) : (
          !run.isPending &&
          !run.isError && (
            <div className="text-xs text-muted-foreground italic">Run a query to see results.</div>
          )
        )}
      </div>
    </div>
  )
}
