import { useEffect, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { Shield, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { McpClient } from "../types"

type BudgetDto = {
  clientId: string
  callsPerMin: number
  execsPerMin: number
  maxPendingApprovals: number
}

interface PolicyTabProps {
  clients: McpClient[]
}

export function PolicyTab({ clients }: PolicyTabProps) {
  const [selectedClientId, setSelectedClientId] = useState<string>("")
  const [budget, setBudget] = useState<BudgetDto | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!selectedClientId && clients.length > 0) {
      setSelectedClientId(clients[0].id)
    }
  }, [clients, selectedClientId])

  const loadBudget = async (clientId: string) => {
    if (!clientId) return
    setLoading(true)
    setError(null)
    try {
      const res = await invoke<BudgetDto>("mcp_budgets_get", { clientId })
      setBudget(res)
    } catch (e: unknown) {
      const err = e as Error
      setError(
        typeof e === "string" ? e : err?.message || "Failed to load budget"
      )
      setBudget(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (selectedClientId) void loadBudget(selectedClientId)
  }, [selectedClientId])

  const saveBudget = async () => {
    if (!budget) return
    setLoading(true)
    setError(null)
    try {
      await invoke("mcp_budgets_set", {
        clientId: budget.clientId,
        callsPerMin: budget.callsPerMin,
        execsPerMin: budget.execsPerMin,
        maxPendingApprovals: budget.maxPendingApprovals,
      })
      await loadBudget(budget.clientId)
    } catch (e: unknown) {
      const err = e as Error
      setError(
        typeof e === "string" ? e : err?.message || "Failed to save budget"
      )
    } finally {
      setLoading(false)
    }
  }

  const activateKillSwitch = async () => {
    if (
      !window.confirm(
        "Activate MCP kill switch? All paired clients will be revoked."
      )
    )
      return
    setLoading(true)
    try {
      await invoke("mcp_kill_switch")
    } catch (e: unknown) {
      const err = e as Error
      setError(typeof e === "string" ? e : err?.message || "Kill switch failed")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Shield className="h-4 w-4 text-muted-foreground" />
        <div>
          <h3 className="text-sm font-semibold">Policy & Budgets</h3>
          <p className="text-xs text-muted-foreground">
            Per-client rate limits and emergency controls.
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
          {error}
        </div>
      )}

      <div className="space-y-4 rounded-xl border border-border/70 bg-card p-4">
        <div className="space-y-2">
          <Label className="text-xs">Client</Label>
          <Select
            value={selectedClientId}
            onValueChange={(val) => val && setSelectedClientId(val)}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Select client" />
            </SelectTrigger>
            <SelectContent>
              {clients.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {budget && (
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label className="text-xs">Calls / min</Label>
              <Input
                type="number"
                className="h-8 text-xs"
                value={budget.callsPerMin}
                onChange={(e) =>
                  setBudget({
                    ...budget,
                    callsPerMin: Number(e.target.value) || 0,
                  })
                }
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Execs / min</Label>
              <Input
                type="number"
                className="h-8 text-xs"
                value={budget.execsPerMin}
                onChange={(e) =>
                  setBudget({
                    ...budget,
                    execsPerMin: Number(e.target.value) || 0,
                  })
                }
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Max pending approvals</Label>
              <Input
                type="number"
                className="h-8 text-xs"
                value={budget.maxPendingApprovals}
                onChange={(e) =>
                  setBudget({
                    ...budget,
                    maxPendingApprovals: Number(e.target.value) || 0,
                  })
                }
              />
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={loading || !budget}
            onClick={() => saveBudget()}
          >
            Save budget
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={loading || !selectedClientId}
            onClick={() => loadBudget(selectedClientId)}
          >
            <RefreshCw className="mr-1 h-3.5 w-3.5" />
            Refresh
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={loading}
            onClick={() => activateKillSwitch()}
          >
            Kill switch
          </Button>
        </div>
      </div>
    </div>
  )
}
