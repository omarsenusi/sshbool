import { useQuery } from "@tanstack/react-query"
import { Loader2 } from "lucide-react"

import { DbResultGrid } from "@/features/databases/components/db-result-grid"
import type { SelectedTable } from "@/features/databases/components/db-schema-tree"
import { ipc } from "@/lib/ipc/commands"

type Props = {
  connectionId: string
  selected: SelectedTable | null
}

export function DbBrowseWorkspace({ connectionId, selected }: Props) {
  const preview = useQuery({
    queryKey: ["db-preview", connectionId, selected?.schema, selected?.table.name],
    queryFn: () =>
      ipc.dbTablePreview(connectionId, selected!.table.name, selected!.schema, 100, 0),
    enabled: !!selected,
  })

  if (!selected) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-xs p-8">
        Select a table from the schema tree to browse structure and data.
      </div>
    )
  }

  const { table, schema } = selected

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <div className="px-4 py-2 border-b border-border bg-muted/10 flex items-center justify-between shrink-0">
        <div>
          <h4 className="font-semibold text-sm">
            {schema}.{table.name}
          </h4>
          <p className="text-[10px] text-muted-foreground">
            {table.columns.length} columns · {table.foreignKeys.length} foreign keys
          </p>
        </div>
      </div>

      <div className="shrink-0 max-h-[200px] overflow-auto border-b border-border">
        <table className="w-full text-[11px]">
          <thead className="bg-muted/30 sticky top-0">
            <tr className="text-left text-[10px] uppercase text-muted-foreground">
              <th className="px-3 py-1.5 font-semibold">Column</th>
              <th className="px-3 py-1.5 font-semibold">Type</th>
              <th className="px-3 py-1.5 font-semibold">Null</th>
              <th className="px-3 py-1.5 font-semibold">Key</th>
              <th className="px-3 py-1.5 font-semibold">Default</th>
            </tr>
          </thead>
          <tbody>
            {table.columns.map((col) => (
              <tr key={col.name} className="border-t border-border/50 hover:bg-muted/20">
                <td className="px-3 py-1 font-mono font-medium">{col.name}</td>
                <td className="px-3 py-1 text-muted-foreground">{col.dataType}</td>
                <td className="px-3 py-1">{col.nullable ? "YES" : "NO"}</td>
                <td className="px-3 py-1">
                  {col.isPrimaryKey ? (
                    <span className="text-amber-400 font-semibold">PK</span>
                  ) : (
                    table.foreignKeys.find((fk) => fk.column === col.name) && (
                      <span className="text-blue-400 font-semibold">FK</span>
                    )
                  )}
                </td>
                <td className="px-3 py-1 font-mono text-muted-foreground truncate max-w-[160px]">
                  {col.defaultValue ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {table.foreignKeys.length > 0 && (
        <div className="shrink-0 px-4 py-2 border-b border-border bg-muted/5 text-[10px] text-muted-foreground">
          {table.foreignKeys.map((fk) => (
            <span key={`${fk.column}-${fk.refTable}`} className="mr-3">
              <span className="font-mono text-foreground">{fk.column}</span>
              {" → "}
              <span className="font-mono text-primary">
                {fk.refTable}.{fk.refColumn}
              </span>
            </span>
          ))}
        </div>
      )}

      <div className="flex-1 flex flex-col min-h-0 p-3 gap-2">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground shrink-0">
          Data preview (first 100 rows)
        </div>
        {preview.isLoading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading rows…
          </div>
        ) : preview.isError ? (
          <div className="text-xs text-destructive">{(preview.error as Error).message}</div>
        ) : (
          <DbResultGrid
            className="flex-1 min-h-0"
            columns={preview.data?.columns ?? []}
            rows={preview.data?.rows ?? []}
          />
        )}
      </div>
    </div>
  )
}
