import { useState } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Trash2, Laptop, KeyRound } from 'lucide-react';
import type { McpClient, ClientMode } from '../types';
import { ClientGrantsDialog } from './client-grants-dialog';

interface ClientsTabProps {
  clients: McpClient[];
  onSetMode: (clientId: string, mode: ClientMode) => void;
  onSetEnabled: (clientId: string, enabled: boolean) => void;
  onDelete: (clientId: string) => void;
  onGrantHost: (clientId: string, hostId: string) => Promise<void>;
  onRevokeHost: (clientId: string, hostId: string) => Promise<void>;
}

export function ClientsTab({
  clients,
  onSetMode,
  onSetEnabled,
  onDelete,
  onGrantHost,
  onRevokeHost,
}: ClientsTabProps) {
  const [grantsClient, setGrantsClient] = useState<McpClient | null>(null);

  const openGrants = (client: McpClient) => setGrantsClient(client);

  const handleGrantHost = async (clientId: string, hostId: string) => {
    await onGrantHost(clientId, hostId);
    setGrantsClient((prev) => {
      if (!prev || prev.id !== clientId) return prev;
      if (prev.allowedHosts.includes(hostId)) return prev;
      return { ...prev, allowedHosts: [...prev.allowedHosts, hostId] };
    });
  };

  const handleRevokeHost = async (clientId: string, hostId: string) => {
    await onRevokeHost(clientId, hostId);
    setGrantsClient((prev) => {
      if (!prev || prev.id !== clientId) return prev;
      return { ...prev, allowedHosts: prev.allowedHosts.filter((id) => id !== hostId) };
    });
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Laptop className="h-4 w-4 text-muted-foreground" />
          Paired Clients ({clients.length})
        </h3>
        <p className="text-xs text-muted-foreground">
          External agents authorized to connect over loopback.
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-border/70">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Client Name</TableHead>
              <TableHead>Mode Profile</TableHead>
              <TableHead>Host Scope</TableHead>
              <TableHead>Paired At</TableHead>
              <TableHead>Enabled</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {clients.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                  No paired clients yet. Click &quot;Pair client&quot; on the Server tab.
                </TableCell>
              </TableRow>
            ) : (
              clients.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">
                    <div className="flex flex-col">
                      <span>{c.name}</span>
                      {c.clientVersion && (
                        <span className="font-mono text-xs text-muted-foreground">v{c.clientVersion}</span>
                      )}
                      {c.suspendedReason && (
                        <Badge variant="outline" className="mt-1 w-fit border-destructive/40 text-destructive">
                          suspended: {c.suspendedReason}
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Select value={c.mode} onValueChange={(val) => val && onSetMode(c.id, val as ClientMode)}>
                      <SelectTrigger className="h-8 w-32 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="read_only">Read-Only</SelectItem>
                        <SelectItem value="assisted">Assisted</SelectItem>
                        <SelectItem value="full">Full Access</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="font-mono text-xs">
                      {c.allowedHosts.length} hosts granted
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {new Date(c.pairedAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <Switch checked={c.enabled} onCheckedChange={(val) => onSetEnabled(c.id, val)} />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2 text-xs"
                        onClick={() => openGrants(c)}
                      >
                        <KeyRound className="mr-1 h-3.5 w-3.5" />
                        Grants
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onDelete(c.id)}
                        className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <ClientGrantsDialog
        open={grantsClient !== null}
        onOpenChange={(open) => {
          if (!open) setGrantsClient(null);
        }}
        client={grantsClient ? clients.find((c) => c.id === grantsClient.id) ?? grantsClient : null}
        onGrantHost={handleGrantHost}
        onRevokeHost={handleRevokeHost}
      />
    </div>
  );
}
