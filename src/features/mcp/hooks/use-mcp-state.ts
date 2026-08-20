import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { formatAppError, IpcError } from '@/lib/ipc/commands';
import type { AppError } from '@/lib/ipc/types';
import type { McpServerState, McpClient, McpPairingCode, McpPairingResult, McpCallLog, ClientMode } from '../types';

function ipcErrorMessage(e: unknown, fallback: string): string {
  if (e instanceof IpcError) return e.message;
  if (e && typeof e === 'object' && 'kind' in e) {
    return formatAppError(e as AppError);
  }
  if (typeof e === 'string') return e;
  if (e instanceof Error && e.message) return e.message;
  if (e && typeof e === 'object' && 'message' in e) {
    return String((e as { message: unknown }).message);
  }
  return fallback;
}

export function useMcpState() {
  const [serverState, setServerState] = useState<McpServerState>({
    enabled: false,
    port: 47821,
    activeClientsCount: 0,
    degradedVaultLocked: false,
  });
  const [clients, setClients] = useState<McpClient[]>([]);
  const [calls, setCalls] = useState<McpCallLog[]>([]);
  const [activePairing, setActivePairing] = useState<McpPairingResult | null>(null);
  const [activePairingCode, setActivePairingCode] = useState<McpPairingCode | null>(null);
  const [tokenPairingLoading, setTokenPairingLoading] = useState(false);
  const [codePairingLoading, setCodePairingLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await invoke<McpServerState>('mcp_server_status');
      setServerState(res);
    } catch (e) {
      console.error('Failed to fetch MCP status', e);
    }
  }, []);

  const fetchClients = useCallback(async () => {
    try {
      const res = await invoke<McpClient[]>('mcp_clients_list');
      setClients(res);
    } catch (e) {
      console.error('Failed to fetch MCP clients', e);
    }
  }, []);

  const fetchCalls = useCallback(async () => {
    try {
      const res = await invoke<McpCallLog[]>('mcp_calls_list', { limit: 100 });
      setCalls(res);
    } catch (e) {
      console.error('Failed to fetch MCP calls', e);
    }
  }, []);

  const startServer = async (port?: number) => {
    setLoading(true);
    setError(null);
    try {
      await invoke('mcp_server_start', { port });
      await fetchStatus();
    } catch (e: unknown) {
      setError(ipcErrorMessage(e, 'Failed to start server'));
    } finally {
      setLoading(false);
    }
  };

  const stopServer = async () => {
    setLoading(true);
    try {
      await invoke('mcp_server_stop');
      await fetchStatus();
    } catch (e: unknown) {
      setError(ipcErrorMessage(e, 'Failed to stop server'));
    } finally {
      setLoading(false);
    }
  };

  const pairClient = async (clientName: string) => {
    setTokenPairingLoading(true);
    setError(null);
    try {
      const res = await invoke<McpPairingResult>('mcp_client_pair', {
        clientName: clientName.trim() || 'Cursor',
        clientVersion: '1.0',
      });
      setActivePairing(res);
      setActivePairingCode(null);
      await fetchClients();
    } catch (e: unknown) {
      setError(ipcErrorMessage(e, 'Failed to pair client'));
      throw e;
    } finally {
      setTokenPairingLoading(false);
    }
  };

  const createPairingCode = async () => {
    setCodePairingLoading(true);
    setError(null);
    try {
      const res = await invoke<McpPairingCode>('mcp_pairing_code_create');
      setActivePairingCode(res);
      setActivePairing(null);
    } catch (e: unknown) {
      setError(ipcErrorMessage(e, 'Failed to create pairing code'));
      throw e;
    } finally {
      setCodePairingLoading(false);
    }
  };

  const setClientMode = async (clientId: string, mode: ClientMode) => {
    try {
      await invoke('mcp_client_set_mode', { clientId, mode });
      await fetchClients();
    } catch (e: unknown) {
      const err = e as Error;
      setError(typeof e === 'string' ? e : err?.message || 'Failed to update client mode');
    }
  };

  const setClientEnabled = async (clientId: string, enabled: boolean) => {
    try {
      await invoke('mcp_client_set_enabled', { clientId, enabled });
      await fetchClients();
    } catch (e: unknown) {
      const err = e as Error;
      setError(typeof e === 'string' ? e : err?.message || 'Failed to toggle client');
    }
  };

  const deleteClient = async (clientId: string) => {
    try {
      await invoke('mcp_client_delete', { clientId });
      await fetchClients();
    } catch (e: unknown) {
      const err = e as Error;
      setError(typeof e === 'string' ? e : err?.message || 'Failed to delete client');
    }
  };

  const grantHost = async (clientId: string, hostId: string) => {
    try {
      await invoke('mcp_client_grant_host', { clientId, hostId, execAllowed: true, writeAllowed: true });
      await fetchClients();
    } catch (e: unknown) {
      const err = e as Error;
      setError(typeof e === 'string' ? e : err?.message || 'Failed to grant host');
    }
  };

  const revokeHost = async (clientId: string, hostId: string) => {
    try {
      await invoke('mcp_client_revoke_host', { clientId, hostId });
      await fetchClients();
    } catch (e: unknown) {
      const err = e as Error;
      setError(typeof e === 'string' ? e : err?.message || 'Failed to revoke host');
    }
  };

  useEffect(() => {
    fetchStatus();
    fetchClients();
    fetchCalls();

    const unlistenServerState = listen<McpServerState>('mcp://server-state', (event) => {
      setServerState(event.payload);
    });

    const unlistenCalls = listen<McpCallLog>('mcp://call-recorded', (event) => {
      setCalls((prev) => [event.payload, ...prev]);
    });

    return () => {
      unlistenServerState.then((fn) => fn());
      unlistenCalls.then((fn) => fn());
    };
  }, [fetchStatus, fetchClients, fetchCalls]);

  return {
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
    clearPairing: () => {
      setActivePairing(null);
      setActivePairingCode(null);
    },
    setClientMode,
    setClientEnabled,
    deleteClient,
    grantHost,
    revokeHost,
    refreshStatus: fetchStatus,
    refreshClients: fetchClients,
    refreshCalls: fetchCalls,
  };
}
