import { ChevronDown, ChevronRight, Key, Loader2, Table2 } from "lucide-react"
import { useState } from "react"

import type { DbSchemaDto, DbTableDto } from "@/lib/ipc/types"
import { cn } from "@/lib/utils"

export type SelectedTable = {
  schema: string
  table: DbTableDto
}

type Props = {
  schema: DbSchemaDto | undefined
  isLoading: boolean
  error: string | null
  selected: SelectedTable | null
  onSelect: (sel: SelectedTable) => void
}

export function DbSchemaTree({ schema, isLoading, error, selected, onSelect }: Props) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const toggle = (name: string) => {
    setExpanded((prev) => ({ ...prev, [name]: !prev[name] }))
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground text-xs">
        <Loader2 className="size-4 animate-spin" />
        Loading schema…
      </div>
    )
  }

  if (error) {
    return <div className="p-3 text-xs text-destructive">{error}</div>
  }

  const groups = schema?.schemas ?? []
  if (groups.length === 0) {
    return (
      <div className="p-4 text-xs text-muted-foreground text-center">
        No tables found in this database.
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
      {groups.map((group) => {
        const open = expanded[group.name] ?? true
        return (
          <div key={group.name}>
            <button
              type="button"
              onClick={() => toggle(group.name)}
              className="w-full flex items-center gap-1 px-2 py-1.5 rounded-md hover:bg-muted/50 text-[11px] font-medium text-foreground"
            >
              {open ? <ChevronDown className="size-3.5 shrink-0" /> : <ChevronRight className="size-3.5 shrink-0" />}
              <span className="truncate">{group.name}</span>
              <span className="ml-auto text-[9px] text-muted-foreground">{group.tables.length}</span>
            </button>
            {open &&
              group.tables.map((table) => {
                const isSel =
                  selected?.schema === group.name && selected.table.name === table.name
                return (
                  <button
                    key={`${group.name}.${table.name}`}
                    type="button"
                    onClick={() => onSelect({ schema: group.name, table })}
                    className={cn(
                      "w-full flex items-center gap-2 pl-7 pr-2 py-1.5 rounded-md text-left text-[11px]",
                      isSel ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted/40 text-muted-foreground",
                    )}
                  >
                    <Table2 className="size-3.5 shrink-0" />
                    <span className="truncate">{table.name}</span>
                    {table.foreignKeys.length > 0 && (
                      <Key className="size-3 ml-auto shrink-0 opacity-60" aria-label="Has foreign keys" />
                    )}
                  </button>
                )
              })}
          </div>
        )
      })}
    </div>
  )
}
