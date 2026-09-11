import { useMutation, useQuery } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { ipc } from "@/lib/ipc/commands"

export function AiPanel() {
  const [message, setMessage] = useState("")
  const [reply, setReply] = useState("")
  const [convId, setConvId] = useState<string | undefined>()
  const providers = useQuery({
    queryKey: ["ai-providers"],
    queryFn: () => ipc.aiProvidersList(),
  })

  const send = useMutation({
    mutationFn: () => ipc.aiSend(message, undefined, convId),
    onSuccess: (r) => {
      setReply(r.reply)
      setConvId(r.conversationId)
    },
  })
  const explain = useMutation({
    mutationFn: () => ipc.aiExplainCommand(message),
    onSuccess: (r) => {
      setReply(r.reply)
      setConvId(r.conversationId)
    },
  })
  const generate = useMutation({
    mutationFn: () => ipc.aiGenerateCommand(message),
    onSuccess: (r) => {
      setReply(r.reply)
      setConvId(r.conversationId)
    },
  })
  const upsertOllama = useMutation({
    mutationFn: () =>
      ipc.aiProvidersUpsert({
        kind: "ollama",
        name: "Local Ollama",
        baseUrl: "http://127.0.0.1:11434",
        model: "llama3.2",
        enabled: true,
      }),
    onSuccess: () => providers.refetch(),
  })

  return (
    <div className="flex h-full flex-col gap-3 p-4 text-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">AI assistant</h2>
        <Button
          size="sm"
          variant="outline"
          onClick={() => upsertOllama.mutate()}
        >
          Use Ollama
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Providers:{" "}
        {(providers.data ?? [])
          .map((p) => String(p.name ?? p.kind))
          .join(", ") || "none — add Ollama"}
      </p>
      <textarea
        className="min-h-24 w-full rounded-md border border-input bg-background px-2 py-1 font-mono text-xs"
        placeholder="Ask a question, or paste a command to explain…"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={!message || send.isPending}
          onClick={() => send.mutate()}
        >
          Send
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!message}
          onClick={() => explain.mutate()}
        >
          Explain command
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!message}
          onClick={() => generate.mutate()}
        >
          Generate command
        </Button>
      </div>
      {(send.isError || explain.isError || generate.isError) && (
        <p className="text-xs text-destructive">
          {((send.error ?? explain.error ?? generate.error) as Error).message}
        </p>
      )}
      {reply && (
        <pre className="flex-1 overflow-auto rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap">
          {reply}
        </pre>
      )}
    </div>
  )
}
