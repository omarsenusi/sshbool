import { useCallback, useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { KeyRound, Plus, Trash2 } from 'lucide-react';
import { HostAutocomplete } from '@/features/connections/components/host-autocomplete';
import { HostSearchRow } from '@/features/connections/components/host-search-row';
import { flattenHosts } from '@/features/connections/host-appearance';
import { ipc } from '@/lib/ipc/commands';
import type { HostDto } from '@/lib/ipc/types';
import type { McpClient } from '../types';

type McpGrant = {
  id: string;
  clientId: string;
  sessionHandle: string;
  hostId?: string;
  tool: string;
  uses: number;
  maxUses: number;
  expiresAt: number;
};

interface ClientGrantsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  client: McpClient | null;
  onGrantHost: (clientId: string, hostId: string) => Promise<void>;
  onRevokeHost: (clientId: string, hostId: string) => Promise<void>;
}

export function ClientGrantsDialog({
  open,
  onOpenChange,
  client,
  onGrantHost,
  onRevokeHost,
}: ClientGrantsDialogProps) {
  const [hosts, setHosts] = useState<HostDto[]>([]);
  const [grants, setGrants] = useState<McpGrant[]>([]);
  const [selectedHostId, setSelectedHostId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadData = useCallback(async (clientId: string) => {
    setLoading(true);
    try {
      const [tree, grantRows] = await Promise.all([
        ipc.hostsListTree(),
        invoke<McpGrant[]>('mcp_grants_list', { clientId }),
      ]);
      setHosts(flattenHosts(tree));
      setGrants(grantRows);
    } catch {
      setHosts([]);
      setGrants([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open || !client) {
      setSelectedHostId(null);
      return;
    }
    void loadData(client.id);
  }, [open, client, loadData]);

  const hostById = useMemo(() => new Map(hosts.map((h) => [h.id, h])), [hosts]);

  const grantedHosts = useMemo(() => {
    if (!client) return [];
    return client.allowedHosts
      .map((id) => hostById.get(id))
      .filter((h): h is HostDto => !!h);
  }, [client, hostById]);

  const availableHosts = useMemo(() => {
    if (!client) return [];
    const granted = new Set(client.allowedHosts);
    return hosts.filter((h) => !granted.has(h.id));
  }, [client, hosts]);

  const handleGrant = async () => {
    if (!client || !selectedHostId) return;
    setBusy(true);
    try {
      await onGrantHost(client.id, selectedHostId);
      setSelectedHostId(null);
    } finally {
      setBusy(false);
    }
  };

  const handleRevokeHost = async (hostId: string) => {
    if (!client) return;
    setBusy(true);
    try {
      await onRevokeHost(client.id, hostId);
    } finally {
      setBusy(false);
    }
  };

  const handleRevokeGrant = async (grantId: string) => {
    if (!client) return;
    setBusy(true);
    try {
      await invoke('mcp_grant_revoke', { grantId });
      await loadData(client.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md gap-4">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
            <KeyRound className="h-4 w-4 text-muted-foreground" />
            Client grants
          </DialogTitle>
          <DialogDescription className="text-xs">
            {client ? (
              <>
                Manage host access for <span className="font-medium">{client.name}</span>. Clients
                can only reach granted hosts.
              </>
            ) : (
              'Select a client to manage grants.'
            )}
          </DialogDescription>
        </DialogHeader>

        {client && (
          <div className="space-y-4">
            <section className="space-y-2">
              <Label className="text-xs">Host access</Label>
              {loading ? (
                <p className="text-xs text-muted-foreground">Loading hosts…</p>
              ) : grantedHosts.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border/70 px-3 py-4 text-xs text-muted-foreground">
                  No hosts granted yet. Add a host below so this client can connect.
                </p>
              ) : (
                <ul className="space-y-1">
                  {grantedHosts.map((host) => (
                    <li
                      key={host.id}
                      className="flex items-center gap-1 rounded-lg border border-border/60 pr-1"
                    >
                      <div className="min-w-0 flex-1">
                        <HostSearchRow host={host} interactive={false} />
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 shrink-0 p-0 text-destructive hover:text-destructive"
                        disabled={busy}
                        onClick={() => void handleRevokeHost(host.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}

              {availableHosts.length > 0 && (
                <div className="flex items-start gap-2 pt-1">
                  <div className="min-w-0 flex-1 space-y-1">
                    <Label htmlFor="grant-host-search" className="text-[11px] text-muted-foreground">
                      Add host
                    </Label>
                    <HostAutocomplete
                      inputId="grant-host-search"
                      hosts={hosts}
                      excludeHostIds={client.allowedHosts}
                      selectedHostId={selectedHostId}
                      disabled={busy}
                      onSelect={setSelectedHostId}
                    />
                  </div>
                  <Button
                    size="sm"
                    className="mt-5 h-8 shrink-0 gap-1"
                    disabled={busy || !selectedHostId}
                    onClick={() => void handleGrant()}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Grant
                  </Button>
                </div>
              )}

              {!loading && availableHosts.length === 0 && grantedHosts.length > 0 && (
                <p className="text-[11px] text-muted-foreground">All hosts are already granted.</p>
              )}

              {!loading && hosts.length === 0 && (
                <p className="text-[11px] text-muted-foreground">
                  No SSH hosts in your vault. Add a host first from Connections.
                </p>
              )}
            </section>

            <section className="space-y-2 border-t border-border/70 pt-3">
              <Label className="text-xs">Active session grants</Label>
              {loading ? (
                <p className="text-xs text-muted-foreground">Loading…</p>
              ) : grants.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No temporary session grants. These appear when you approve repeatable tool access
                  during a session.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {grants.map((g) => (
                    <li
                      key={g.id}
                      className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2 text-xs"
                    >
                      <div>
                        <span className="font-mono">{g.tool}</span>
                        <span className="ml-2 text-muted-foreground">
                          {g.uses}/{g.maxUses} uses · expires{' '}
                          {new Date(g.expiresAt).toLocaleTimeString()}
                        </span>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        disabled={busy}
                        onClick={() => void handleRevokeGrant(g.id)}
                      >
                        Revoke
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
