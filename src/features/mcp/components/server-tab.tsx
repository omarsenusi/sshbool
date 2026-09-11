import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Server, ShieldAlert, KeyRound } from "lucide-react"
import type { McpServerState } from "../types"

interface ServerTabProps {
  serverState: McpServerState
  loading: boolean
  onStart: () => void
  onStop: () => void
  onPairClick: () => void
}

export function ServerTab({
  serverState,
  loading,
  onStart,
  onStop,
  onPairClick,
}: ServerTabProps) {
  return (
    <div className="flex flex-col gap-3">
      <Card className="rounded-xl border border-border/70 bg-card/60 p-4 shadow-2xs">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 p-0 pb-3">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <Server className="h-3.5 w-3.5" />
              Server status
            </CardTitle>
            <CardDescription className="text-xs">
              Loopback listener on 127.0.0.1:{serverState.port}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline">
              {serverState.enabled ? "Running" : "Stopped"}
            </Badge>
            <Switch
              checked={serverState.enabled}
              disabled={loading}
              onCheckedChange={(checked) => (checked ? onStart() : onStop())}
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-3 p-0">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-border/70 bg-muted/20 p-3">
              <span className="mb-1 block text-xs text-muted-foreground">
                Port
              </span>
              <span className="font-mono text-xs font-medium">
                {serverState.port}
              </span>
            </div>
            <div className="rounded-xl border border-border/70 bg-muted/20 p-3">
              <span className="mb-1 block text-xs text-muted-foreground">
                Bind address
              </span>
              <span className="text-xs font-medium">127.0.0.1 only</span>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 pt-1">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <ShieldAlert className="h-3.5 w-3.5" />
              Pair in-app (token) or generate a 6-digit code for HTTP pairing.
            </div>
            <Button
              size="sm"
              className="h-8 gap-1.5"
              disabled={!serverState.enabled}
              onClick={onPairClick}
            >
              <KeyRound className="h-3.5 w-3.5" />
              Pair client
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-xl border border-border/70 bg-card/60 p-4 shadow-2xs">
        <CardHeader className="p-0 pb-2">
          <CardTitle className="text-sm font-semibold">
            Client configuration
          </CardTitle>
          <CardDescription className="text-xs">
            Direct token or pairing code — then paste config into Cursor MCP
            settings.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <pre className="overflow-x-auto rounded-xl border border-border/70 bg-muted/20 p-3 font-mono text-xs select-all">
            {`{
  "mcpServers": {
    "sshbool": {
      "url": "http://127.0.0.1:${serverState.port}/mcp",
      "headers": {
        "Authorization": "Bearer sbmcp_<your_paired_token>"
      }
    }
  }
}`}
          </pre>
        </CardContent>
      </Card>
    </div>
  )
}
