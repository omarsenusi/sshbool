import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { ipc } from "@/lib/ipc/commands"

export function SnippetsPanel() {
  const qc = useQueryClient()
  const [name, setName] = useState("")
  const [body, setBody] = useState("")

  const snippets = useQuery({ queryKey: ["snippets"], queryFn: () => ipc.snippetsList() })
  const create = useMutation({
    mutationFn: () => ipc.snippetsUpsert({ name, body }),
    onSuccess: () => {
      setName("")
      setBody("")
      void qc.invalidateQueries({ queryKey: ["snippets"] })
    },
  })

  return (
    <div className="space-y-3 p-3 text-sm">
      <h3 className="font-medium">Snippets</h3>
      <input
        className="border-input bg-background w-full rounded-md border px-2 py-1"
        placeholder="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <textarea
        className="border-input bg-background min-h-20 w-full rounded-md border px-2 py-1 font-mono text-xs"
        placeholder="echo {{message}}"
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <Button size="sm" disabled={!name || !body} onClick={() => create.mutate()}>
        Save snippet
      </Button>
      <ul className="space-y-1">
        {snippets.data?.map((s) => (
          <li key={s.id} className="border-border rounded-md border px-2 py-1.5">
            <div className="font-medium">{s.name}</div>
            <pre className="text-muted-foreground mt-1 overflow-x-auto text-xs">{s.body}</pre>
          </li>
        ))}
      </ul>
    </div>
  )
}
