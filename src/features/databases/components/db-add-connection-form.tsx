import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Database, Loader2 } from "lucide-react"
import { useState, type ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { ipc } from "@/lib/ipc/commands"
import {
  defaultPort,
  defaultUsername,
  getEngineColor,
  type DbEngineKind,
} from "@/features/databases/lib/db-engine-colors"
import { cn } from "@/lib/utils"

type Props = {
  hostId: string
  onAdded: (connectionId: string) => void
}

const inputClass =
  "w-full rounded-md border border-border bg-muted/10 px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-primary focus:border-primary"

export function DbAddConnectionForm({ hostId, onAdded }: Props) {
  const qc = useQueryClient()
  const [engine, setEngine] = useState<DbEngineKind | null>(null)
  const [name, setName] = useState("")
  const [host, setHost] = useState("127.0.0.1")
  const [port, setPort] = useState("")
  const [database, setDatabase] = useState("")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)

  const add = useMutation({
    mutationFn: async () => {
      if (!engine) throw new Error("Select PostgreSQL or MySQL")
      if (!database.trim()) throw new Error("Database name is required")
      if (!username.trim()) throw new Error("Username is required")

      const portNum = Number(port) || defaultPort(engine)
      const connName = name.trim() || `${database.trim()}@${engine}`
      const credName = `db:${connName}`

      const credentialId = await ipc.credentialsCreate(credName, "password", password)
      const id = await ipc.dbConnectionsUpsert({
        hostId,
        engine,
        name: connName,
        host: host.trim() || "127.0.0.1",
        port: portNum,
        database: database.trim(),
        username: username.trim(),
        credentialId,
      })
      return id
    },
    onSuccess: (id) => {
      setError(null)
      void qc.invalidateQueries({ queryKey: ["db-connections"] })
      onAdded(id)
    },
    onError: (err: Error) => setError(err.message),
  })

  const pickEngine = (e: DbEngineKind) => {
    setEngine(e)
    setPort(String(defaultPort(e)))
    setUsername(defaultUsername(e))
    setError(null)
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-lg mx-auto space-y-6">
        <div className="space-y-1">
          <h3 className="text-base font-semibold flex items-center gap-2">
            <Database className="size-4 text-primary" />
            Add Database Connection
          </h3>
          <p className="text-xs text-muted-foreground">
            Connect to MySQL or PostgreSQL on this server. Credentials are stored encrypted in the vault.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {(["postgres", "mysql"] as const).map((e) => {
            const colors = getEngineColor(e)
            const selected = engine === e
            return (
              <button
                key={e}
                type="button"
                onClick={() => pickEngine(e)}
                className={cn(
                  "rounded-lg border p-4 text-left transition-all",
                  selected ? `${colors.bg} ring-2 ${colors.ring}` : "border-border hover:bg-muted/30",
                )}
              >
                <span className={cn("text-xs font-bold uppercase", colors.text)}>
                  {e === "postgres" ? "PostgreSQL" : "MySQL"}
                </span>
                <p className="text-[10px] text-muted-foreground mt-1">
                  Port {defaultPort(e)} · default user {defaultUsername(e)}
                </p>
              </button>
            )
          })}
        </div>

        {engine && (
          <div className="space-y-3 rounded-lg border border-border p-4 bg-muted/10">
            <Field label="Connection name (optional)">
              <input
                className={inputClass}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={`${database || "mydb"}@${engine}`}
              />
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Host" className="col-span-2">
                <input className={inputClass} value={host} onChange={(e) => setHost(e.target.value)} />
              </Field>
              <Field label="Port">
                <input
                  className={inputClass}
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  inputMode="numeric"
                />
              </Field>
            </div>
            <Field label="Database">
              <input
                className={inputClass}
                value={database}
                onChange={(e) => setDatabase(e.target.value)}
                placeholder={engine === "postgres" ? "postgres" : "mydb"}
              />
            </Field>
            <Field label="Username">
              <input className={inputClass} value={username} onChange={(e) => setUsername(e.target.value)} />
            </Field>
            <Field label="Password">
              <input
                className={inputClass}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="off"
              />
            </Field>

            {error && (
              <p className="text-xs text-destructive">{error}</p>
            )}

            <Button
              className={cn("w-full gap-2", getEngineColor(engine).btn)}
              disabled={add.isPending}
              onClick={() => add.mutate()}
            >
              {add.isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Add
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

function Field({
  label,
  children,
  className,
}: {
  label: string
  children: ReactNode
  className?: string
}) {
  return (
    <label className={cn("block space-y-1", className)}>
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}
