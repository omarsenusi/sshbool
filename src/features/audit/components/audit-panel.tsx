import { useQuery } from "@tanstack/react-query"

import { Button } from "@/components/ui/button"
import { ipc } from "@/lib/ipc/commands"

export function AuditPanel() {
  const list = useQuery({ queryKey: ["audit"], queryFn: () => ipc.auditList(200) })

  return (
    <div className="flex h-full flex-col gap-3 p-4 text-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Audit log</h2>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            void ipc.auditExport().then((json) => {
              const blob = new Blob([json], { type: "application/json" })
              const url = URL.createObjectURL(blob)
              const a = document.createElement("a")
              a.href = url
              a.download = "sshbool-audit.json"
              a.click()
              URL.revokeObjectURL(url)
            })
          }
        >
          Export JSON
        </Button>
      </div>
      <div className="flex-1 overflow-auto font-mono text-xs">
        {(list.data ?? []).map((e) => (
          <div key={String(e.id)} className="border-border border-b py-1">
            <span className="text-muted-foreground">
              {new Date(Number(e.at)).toLocaleString()}
            </span>{" "}
            <strong>{String(e.action)}</strong> {String(e.target ?? "")} → {String(e.result ?? "")}
          </div>
        ))}
      </div>
    </div>
  )
}
