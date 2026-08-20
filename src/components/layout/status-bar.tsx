import { useLayoutStore } from '@/stores/layout.store';
import { useVaultStore } from '@/stores/vault.store';
import { useMcpState } from '@/features/mcp/hooks/use-mcp-state';
import { Plug } from 'lucide-react';
import { cn } from '@/lib/utils';

export function StatusBar() {
  const status = useVaultStore((s) => s.status);
  const { serverState, clients } = useMcpState();
  const openMcpPanel = useLayoutStore((s) => s.setActivity);

  const degraded = serverState.degradedVaultLocked;

  return (
    <footer className="bg-sidebar border-border text-muted-foreground flex h-[var(--statusbar-h)] shrink-0 items-center justify-between border-t px-3 text-[11px]">
      <div className="flex items-center gap-3">
        <span>
          Vault:{' '}
          {!status
            ? '…'
            : !status.initialized
              ? 'not set up'
              : status.locked
                ? 'locked'
                : 'unlocked'}
        </span>

        <span className="text-border">|</span>

        <button
          type="button"
          className="flex items-center gap-1.5 font-mono hover:text-foreground"
          title={
            serverState.enabled
              ? `MCP server on 127.0.0.1:${serverState.port} · ${clients.length} clients`
              : 'MCP server stopped'
          }
          onClick={() => openMcpPanel('mcp')}
        >
          <Plug
            className={cn(
              'h-3 w-3',
              serverState.enabled ? 'text-emerald-500' : 'text-muted-foreground',
              serverState.enabled && !degraded && 'animate-pulse',
              degraded && 'text-amber-500',
            )}
          />
          <span>
            MCP:{' '}
            {serverState.enabled
              ? `127.0.0.1:${serverState.port} (${clients.length})`
              : 'stopped'}
            {degraded ? ' · degraded' : ''}
          </span>
        </button>
      </div>
      <div>SSHBool 0.1.7</div>
    </footer>
  );
}
