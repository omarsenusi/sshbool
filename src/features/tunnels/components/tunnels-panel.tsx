import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArrowLeftRight,
  CheckCircle2,
  Copy,
  Edit3,
  Plus,
  RefreshCw,
  ShieldAlert,
  Trash2,
} from "lucide-react"
import { useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ipc } from "@/lib/ipc/commands"
import { useConnectionStore } from "@/stores/connection.store"
import { TunnelConfig, TunnelDialog } from "./tunnel-dialog"

export function TunnelsPanel({ hostId }: { hostId: string | null }) {
  const qc = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingTunnel, setEditingTunnel] = useState<TunnelConfig | null>(null)
  const [activeTunnelIds, setActiveTunnelIds] = useState<
    Record<string, boolean>
  >({})
  const [tunnelErrors, setTunnelErrors] = useState<Record<string, string>>({})
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const isHostConnected = useConnectionStore((s) =>
    hostId ? s.byHost[hostId]?.status === "connected" : false
  )

  const queryKey = ["port_forwards", hostId]

  const {
    data: rawForwards = [],
    isLoading,
    refetch,
  } = useQuery({
    queryKey,
    queryFn: async () => {
      if (!hostId) return []
      const rows = await ipc.portForwardsList(hostId)
      return rows.map((r) => ({
        id: String(r.id),
        hostId: String(r.hostId ?? hostId),
        label: String(r.label || ""),
        kind: (r.kind as "local" | "remote" | "dynamic") || "local",
        bindAddr: String(r.bindAddr || "127.0.0.1"),
        bindPort: Number(r.bindPort || 8080),
        destAddr: String(r.destAddr || "127.0.0.1"),
        destPort: Number(r.destPort || 80),
        autoStart: Boolean(r.autoStart),
      })) as TunnelConfig[]
    },
    enabled: !!hostId,
  })

  const saveMutation = useMutation({
    mutationFn: async (config: TunnelConfig) => {
      await ipc.portForwardsUpsert(config as unknown as Record<string, unknown>)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      if (activeTunnelIds[id]) {
        try {
          await ipc.portForwardsStop(id)
        } catch {
          // Ignore error during cleanup
        }
      }
      await ipc.portForwardsDelete(id)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey })
    },
  })

  const handleToggleTunnel = async (
    tunnel: TunnelConfig,
    targetActive: boolean
  ) => {
    if (!tunnel.id) return

    setTunnelErrors((prev) => ({ ...prev, [tunnel.id!]: "" }))

    if (targetActive) {
      if (!isHostConnected) {
        setTunnelErrors((prev) => ({
          ...prev,
          [tunnel.id!]: "Host connection required to activate this tunnel.",
        }))
        return
      }

      try {
        await ipc.portForwardsStart(tunnel.id)
        setActiveTunnelIds((prev) => ({ ...prev, [tunnel.id!]: true }))
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        setTunnelErrors((prev) => ({
          ...prev,
          [tunnel.id!]: msg.includes("bind")
            ? `Failed to start: Port ${tunnel.bindPort} is currently in use or denied by system.`
            : `Tunnel error: ${msg}`,
        }))
      }
    } else {
      try {
        await ipc.portForwardsStop(tunnel.id)
      } catch {
        // Ignore stop errors
      }
      setActiveTunnelIds((prev) => ({ ...prev, [tunnel.id!]: false }))
    }
  }

  const handleCopyLink = (tunnel: TunnelConfig) => {
    const url = `http://${tunnel.bindAddr}:${tunnel.bindPort}`
    navigator.clipboard.writeText(url)
    if (tunnel.id) {
      setCopiedId(tunnel.id)
      setTimeout(() => setCopiedId(null), 2000)
    }
  }

  if (!hostId) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-6 text-center text-sm">
        <ArrowLeftRight className="mb-3 h-10 w-10 text-muted-foreground opacity-40" />
        <h3 className="text-base font-semibold">No Server Selected</h3>
        <p className="mt-1 max-w-sm text-xs text-muted-foreground">
          Select a server from the sidebar to manage and activate SSH port
          forwarding tunnels.
        </p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4 text-sm md:p-6">
      {/* Header section */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold tracking-tight">
              SSH Tunnels & Port Forwarding
            </h2>
            <Badge
              variant={isHostConnected ? "default" : "secondary"}
              className="rounded-md"
            >
              {isHostConnected ? "Connected" : "Disconnected"}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Manage local and remote SSH port forwarding rules for secure network
            tunneling.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={() => refetch()}
          >
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Refresh
          </Button>
          <Button
            size="sm"
            className="h-8 text-xs"
            onClick={() => {
              setEditingTunnel(null)
              setDialogOpen(true)
            }}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Add Tunnel
          </Button>
        </div>
      </div>

      {!isHostConnected && (
        <Card className="rounded-md border-amber-500/20 bg-amber-500/10">
          <CardContent className="flex items-center gap-3 p-3 text-xs text-amber-500">
            <ShieldAlert className="h-4 w-4 shrink-0" />
            <div>
              <strong className="font-semibold">Host Disconnected:</strong> You
              can create and configure SSH tunnels now. They can be activated
              once connected to the server.
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main content table / card view */}
      {isLoading ? (
        <div className="flex items-center justify-center p-12 text-xs text-muted-foreground">
          <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
          Loading tunnels...
        </div>
      ) : rawForwards.length === 0 ? (
        <Card className="rounded-md border-dashed">
          <CardHeader className="py-8 text-center">
            <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-md bg-muted">
              <ArrowLeftRight className="h-5 w-5 text-muted-foreground" />
            </div>
            <CardTitle className="text-base font-semibold">
              No SSH Tunnels Configured
            </CardTitle>
            <CardDescription className="text-xs">
              Click "Add Tunnel" to forward local or remote ports through your
              SSH connection.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center pb-6">
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => {
                setEditingTunnel(null)
                setDialogOpen(true)
              }}
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Add First Tunnel
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Label</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Bind Endpoint</TableHead>
                <TableHead>Destination</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rawForwards.map((tunnel) => {
                const isActive = !!activeTunnelIds[tunnel.id!]
                const errorMsg = tunnelErrors[tunnel.id!]

                return (
                  <TableRow key={tunnel.id}>
                    <TableCell className="font-medium">
                      <div className="flex flex-col">
                        <span className="text-sm font-semibold">
                          {tunnel.label || "SSH Tunnel"}
                        </span>
                        {tunnel.autoStart && (
                          <span className="text-[10px] text-muted-foreground">
                            Auto-start on connect
                          </span>
                        )}
                        {errorMsg && (
                          <span className="mt-1 flex items-center gap-1 text-xs font-normal text-destructive">
                            <ShieldAlert className="h-3 w-3 shrink-0" />
                            {errorMsg}
                          </span>
                        )}
                      </div>
                    </TableCell>

                    <TableCell>
                      <Badge
                        variant="outline"
                        className="rounded-sm font-mono text-xs uppercase"
                      >
                        {tunnel.kind === "local"
                          ? "Local (-L)"
                          : tunnel.kind === "remote"
                            ? "Remote (-R)"
                            : "Dynamic (-D)"}
                      </Badge>
                    </TableCell>

                    <TableCell className="font-mono text-xs">
                      {tunnel.bindAddr}:{tunnel.bindPort}
                    </TableCell>

                    <TableCell className="font-mono text-xs">
                      {tunnel.kind === "dynamic" ? (
                        <span className="text-muted-foreground italic">
                          SOCKS5 Proxy
                        </span>
                      ) : (
                        `${tunnel.destAddr}:${tunnel.destPort}`
                      )}
                    </TableCell>

                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={isActive}
                          disabled={!isHostConnected}
                          onCheckedChange={(val) =>
                            handleToggleTunnel(tunnel, val)
                          }
                        />
                        {isActive ? (
                          <Badge className="gap-1 rounded-sm border-emerald-500/20 bg-emerald-500/10 font-normal text-emerald-400">
                            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                            Active
                          </Badge>
                        ) : (
                          <Badge
                            variant="secondary"
                            className="rounded-sm font-normal text-muted-foreground"
                          >
                            Stopped
                          </Badge>
                        )}
                      </div>
                    </TableCell>

                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 rounded-md"
                          title="Copy local link (http://localhost:port)"
                          onClick={() => handleCopyLink(tunnel)}
                        >
                          {copiedId === tunnel.id ? (
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                          ) : (
                            <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                          )}
                        </Button>

                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 rounded-md"
                          title="Edit"
                          onClick={() => {
                            setEditingTunnel(tunnel)
                            setDialogOpen(true)
                          }}
                        >
                          <Edit3 className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>

                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 rounded-md text-destructive hover:text-destructive"
                          title="Delete"
                          onClick={() => {
                            if (tunnel.id) {
                              deleteMutation.mutate(tunnel.id)
                            }
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* Dialog for create / edit */}
      <TunnelDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        hostId={hostId}
        initialData={editingTunnel}
        existingForwards={rawForwards}
        onSave={async (config) => {
          await saveMutation.mutateAsync(config)
        }}
      />
    </div>
  )
}
