import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Activity, ShieldCheck, ShieldAlert, AlertTriangle } from "lucide-react"
import type { McpCallLog } from "../types"

interface ActivityTabProps {
  calls: McpCallLog[]
}

export function ActivityTab({ calls }: ActivityTabProps) {
  const getDecisionBadge = (decision: string) => {
    switch (decision) {
      case "allow":
        return (
          <Badge
            variant="outline"
            className="flex w-fit items-center gap-1 border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
          >
            <ShieldCheck className="h-3 w-3" />
            Allowed
          </Badge>
        )
      case "deny":
      case "hard_deny":
        return (
          <Badge
            variant="outline"
            className="flex w-fit items-center gap-1 border-destructive/40 text-destructive"
          >
            <ShieldAlert className="h-3 w-3" />
            Denied
          </Badge>
        )
      default:
        return (
          <Badge variant="outline" className="flex w-fit items-center gap-1">
            <AlertTriangle className="h-3 w-3" />
            {decision}
          </Badge>
        )
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Activity className="h-4 w-4 text-muted-foreground" />
          Activity & Audit Ledger ({calls.length})
        </h3>
        <p className="text-xs text-muted-foreground">
          Immutable log of all tool calls, diagnostic probes, and security
          decisions.
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-border/70">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Timestamp</TableHead>
              <TableHead>Client Name</TableHead>
              <TableHead>Tool / Operation</TableHead>
              <TableHead>Risk Tier</TableHead>
              <TableHead>Decision</TableHead>
              <TableHead className="text-right">Duration</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {calls.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="py-8 text-center text-muted-foreground"
                >
                  No activity recorded yet. Call logs will appear here in real
                  time.
                </TableCell>
              </TableRow>
            ) : (
              calls.map((call) => (
                <TableRow key={call.id}>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {new Date(call.at).toLocaleTimeString()}
                  </TableCell>
                  <TableCell className="font-medium">
                    {call.clientName || "System / Direct"}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {call.tool}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className="font-mono text-xs uppercase"
                    >
                      {call.riskTier || "safe"}
                    </Badge>
                  </TableCell>
                  <TableCell>{getDecisionBadge(call.decision)}</TableCell>
                  <TableCell className="text-right font-mono text-xs text-muted-foreground">
                    {call.durationMs ? `${call.durationMs}ms` : "—"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
