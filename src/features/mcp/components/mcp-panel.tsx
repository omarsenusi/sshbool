import { useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ServerTab } from './server-tab';
import { ClientsTab } from './clients-tab';
import { ActivityTab } from './activity-tab';
import { PolicyTab } from './policy-tab';
import { PairingDialog } from './pairing-dialog';
import { useMcpState } from '../hooks/use-mcp-state';
import { Server, Laptop, Activity, Plug, Shield } from 'lucide-react';

export function McpPanel() {
  const [activeTab, setActiveTab] = useState('server');
  const [pairingOpen, setPairingOpen] = useState(false);
  const [pairClientName, setPairClientName] = useState('Cursor');

  const {
    serverState,
    clients,
    calls,
    activePairing,
    activePairingCode,
    tokenPairingLoading,
    codePairingLoading,
    loading,
    error,
    startServer,
    stopServer,
    pairClient,
    createPairingCode,
    clearPairing,
    setClientMode,
    setClientEnabled,
    deleteClient,
    grantHost,
    revokeHost,
  } = useMcpState();

  const handlePairClick = () => {
    clearPairing();
    setPairClientName('Cursor');
    setPairingOpen(true);
  };

  const handleCreateToken = async () => {
    try {
      await pairClient(pairClientName);
    } catch {
      // error surfaced via hook state
    }
  };

  const handleCreateCode = async () => {
    try {
      await createPairingCode();
    } catch {
      // error surfaced via hook state
    }
  };

  return (
    <div className="flex h-full flex-col gap-3 p-4 text-sm">
      <div className="flex items-center gap-2 border-b border-border/70 pb-3">
        <Plug className="h-3.5 w-3.5 text-muted-foreground" />
        <div>
          <h2 className="text-sm font-semibold">MCP Server</h2>
          <p className="text-xs text-muted-foreground">
            Policy-gated AI assistant integration over your SSH infrastructure.
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
          {error}
        </div>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex min-h-0 flex-1 flex-col">
        <TabsList className="w-fit">
          <TabsTrigger value="server" className="gap-1.5 text-xs">
            <Server className="h-3.5 w-3.5" />
            Server
          </TabsTrigger>
          <TabsTrigger value="clients" className="gap-1.5 text-xs">
            <Laptop className="h-3.5 w-3.5" />
            Clients ({clients.length})
          </TabsTrigger>
          <TabsTrigger value="policy" className="gap-1.5 text-xs">
            <Shield className="h-3.5 w-3.5" />
            Policy
          </TabsTrigger>
          <TabsTrigger value="activity" className="gap-1.5 text-xs">
            <Activity className="h-3.5 w-3.5" />
            Activity
          </TabsTrigger>
        </TabsList>

        <TabsContent value="server" className="mt-3 min-h-0 flex-1">
          <ServerTab
            serverState={serverState}
            loading={loading}
            onStart={() => startServer()}
            onStop={() => stopServer()}
            onPairClick={handlePairClick}
          />
        </TabsContent>

        <TabsContent value="clients" className="mt-3 min-h-0 flex-1">
          <ClientsTab
            clients={clients}
            onSetMode={setClientMode}
            onSetEnabled={setClientEnabled}
            onDelete={deleteClient}
            onGrantHost={grantHost}
            onRevokeHost={revokeHost}
          />
        </TabsContent>

        <TabsContent value="policy" className="mt-3 min-h-0 flex-1">
          <PolicyTab clients={clients} />
        </TabsContent>

        <TabsContent value="activity" className="mt-3 min-h-0 flex-1">
          <ActivityTab calls={calls} />
        </TabsContent>
      </Tabs>

      <PairingDialog
        open={pairingOpen}
        onOpenChange={(open) => {
          setPairingOpen(open);
          if (!open) clearPairing();
        }}
        port={serverState.port}
        pairing={activePairing}
        pairingCode={activePairingCode}
        tokenLoading={tokenPairingLoading}
        codeLoading={codePairingLoading}
        clientName={pairClientName}
        onClientNameChange={setPairClientName}
        onCreateToken={() => void handleCreateToken()}
        onCreateCode={() => void handleCreateCode()}
      />
    </div>
  );
}
