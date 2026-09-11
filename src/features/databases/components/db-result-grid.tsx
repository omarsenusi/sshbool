import { useVirtualizer } from "@tanstack/react-virtual"
import { useRef } from "react"

import { cn } from "@/lib/utils"

type Props = {
  columns: string[]
  rows: string[][]
  className?: string
  emptyMessage?: string
}

export function DbResultGrid({
  columns,
  rows,
  className,
  emptyMessage = "No rows",
}: Props) {
  const parentRef = useRef<HTMLDivElement>(null)
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 28,
    overscan: 12,
  })

  if (columns.length === 0) {
    return (
      <div
        className={cn(
          "flex items-center justify-center p-6 text-xs text-muted-foreground",
          className
        )}
      >
        {emptyMessage}
      </div>
    )
  }

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col overflow-hidden rounded-md border border-border",
        className
      )}
    >
      <div className="overflow-x-auto border-b border-border bg-muted/30">
        <div className="flex min-w-max">
          {columns.map((col) => (
            <div
              key={col}
              className="max-w-[220px] min-w-[120px] truncate border-r border-border px-3 py-1.5 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase last:border-r-0"
              title={col}
            >
              {col}
            </div>
          ))}
        </div>
      </div>
      <div
        ref={parentRef}
        className="min-h-0 flex-1 overflow-auto bg-background"
      >
        {rows.length === 0 ? (
          <div className="p-4 text-xs text-muted-foreground">
            {emptyMessage}
          </div>
        ) : (
          <div
            style={{
              height: rowVirtualizer.getTotalSize(),
              position: "relative",
            }}
          >
            {rowVirtualizer.getVirtualItems().map((vRow) => {
              const row = rows[vRow.index]
              return (
                <div
                  key={vRow.key}
                  className="absolute left-0 flex min-w-max border-b border-border/50 hover:bg-muted/20"
                  style={{
                    height: vRow.size,
                    transform: `translateY(${vRow.start}px)`,
                  }}
                >
                  {columns.map((col, ci) => (
                    <div
                      key={`${vRow.index}-${col}`}
                      className="max-w-[220px] min-w-[120px] truncate border-r border-border/30 px-3 py-1 font-mono text-[11px] last:border-r-0"
                      title={row[ci] ?? ""}
                    >
                      {row[ci] ?? ""}
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        )}
      </div>
      <div className="border-t border-border bg-muted/20 px-3 py-1 text-[10px] text-muted-foreground">
        {rows.length} row{rows.length === 1 ? "" : "s"}
      </div>
    </div>
  )
}
