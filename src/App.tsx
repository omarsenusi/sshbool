import { useEffect, useMemo, type ReactNode } from "react"

import { CommandPalette } from "@/components/command-palette/command-palette"
import { AppShell } from "@/components/layout/app-shell"
import { AiPanel } from "@/features/ai/components/ai-panel"
import { AuditPanel } from "@/features/audit/components/audit-panel"
import { HomeOverview } from "@/features/home/home-overview"
import { DashboardPanel } from "@/features/dashboard/components/dashboard-panel"
import { DatabasesPanel } from "@/features/databases/components/databases-panel"
import { DevtoolsPanel } from "@/features/devtools/components/devtools-panel"
import { DockerPanel } from "@/features/docker/components/docker-panel"
import { EditorWorkspace } from "@/features/editor/components/editor-workspace"
import { K8sPanel } from "@/features/kubernetes/components/k8s-panel"
import { PluginsPanel } from "@/features/plugins/components/plugins-panel"
import { SettingsPanel } from "@/features/productivity/components/settings-panel"
import { SftpExplorer } from "@/features/sftp/components/sftp-explorer"
import { SyncPanel } from "@/features/sync/components/sync-panel"
import { TerminalWorkspace } from "@/features/terminal/components/terminal-workspace"
import { KeyManager } from "@/features/vault/components/key-manager"
import { UnlockScreen } from "@/features/vault/components/unlock-screen"
import { useEvent } from "@/hooks/use-event"
import { useTaskbarTransferProgress } from "@/hooks/use-taskbar-transfer-progress"
import { useTransferCloseGuard } from "@/hooks/use-transfer-close-guard"
import { useTransfersSync } from "@/hooks/use-transfers-sync"
import { ipc } from "@/lib/ipc/commands"
import { cn } from "@/lib/utils"
import { useConnectionStore } from "@/stores/connection.store"
import { useLayoutStore } from "@/stores/layout.store"
import { useVaultStore } from "@/stores/vault.store"

export function App() {
  const status = useVaultStore((s) => s.status)
  const setStatus = useVaultStore((s) => s.setStatus)
  const activity = useLayoutStore((s) => s.activity)
  const selectedHostId = useLayoutStore((s) => s.selectedHostId)
  const byHost = useConnectionStore((s) => s.byHost)
  const connected = useConnectionStore((s) =>
    selectedHostId ? s.byHost[selectedHostId]?.status === "connected" : false,
  )
  const unlocked = !!status?.initialized && !status.locked

  // One SFTP explorer per host so remote listings never mix across servers.
  const sftpHostIds = useMemo(() => {
    const ids = new Set<string>()
    if (selectedHostId) ids.add(selectedHostId)
    for (const [id, c] of Object.entries(byHost)) {
      if (c.status === "connected" || c.status === "connecting") ids.add(id)
    }
    return [...ids]
  }, [selectedHostId, byHost])

  useEffect(() => {
    void ipc
      .vaultStatus()
      .then(setStatus)
      .catch(() => {
        setStatus({ initialized: false, locked: true, biometric: false })
      })
  }, [setStatus])

  useEvent("app://lock", () => {
    void ipc.vaultStatus().then(setStatus)
  })

  useTransfersSync(unlocked)
  useTransferCloseGuard(unlocked)
  useTaskbarTransferProgress(unlocked)

  if (!status || !status.initialized || status.locked) {
    return <UnlockScreen />
  }

  return (
    <>
      <AppShell>
        {/* Keep terminal mounted so xterm buffer survives tool switches. */}
        <KeepAlive active={activity === "terminal"}>
          <TerminalWorkspace visible={activity === "terminal"} />
        </KeepAlive>

        {/* Keep one SFTP explorer per host — listings/uploads stay host-scoped. */}
        {sftpHostIds.map((id) => (
          <KeepAlive key={`sftp-${id}`} active={activity === "sftp" && selectedHostId === id}>
            <SftpExplorer hostId={id} />
          </KeepAlive>
        ))}

        {(activity === "home" || activity === "connections") && <HomeOverview />}
        {activity === "sftp" && !selectedHostId && (
          <Empty>Pick a server from the rail.</Empty>
        )}
        {activity === "editor" &&
          (selectedHostId ? (
            <NeedConnection connected={connected}>
              <EditorWorkspace hostId={selectedHostId} />
            </NeedConnection>
          ) : (
            <Empty>Pick a server from the rail.</Empty>
          ))}
        {activity === "dashboard" &&
          (selectedHostId ? (
            <NeedConnection connected={connected}>
              <DashboardPanel hostId={selectedHostId} />
            </NeedConnection>
          ) : (
            <Empty>Pick a server for the dashboard.</Empty>
          ))}
        {activity === "docker" &&
          (selectedHostId ? (
            <NeedConnection connected={connected}>
              <DockerPanel hostId={selectedHostId} />
            </NeedConnection>
          ) : (
            <Empty>Pick a server.</Empty>
          ))}
        {activity === "kubernetes" &&
          (selectedHostId ? (
            <NeedConnection connected={connected}>
              <K8sPanel hostId={selectedHostId} />
            </NeedConnection>
          ) : (
            <Empty>Pick a server.</Empty>
          ))}
        {activity === "databases" &&
          (selectedHostId ? (
            <NeedConnection connected={connected}>
              <DatabasesPanel hostId={selectedHostId} />
            </NeedConnection>
          ) : (
            <Empty>Pick a server.</Empty>
          ))}
        {activity === "devtools" &&
          (selectedHostId ? (
            <NeedConnection connected={connected}>
              <DevtoolsPanel hostId={selectedHostId} />
            </NeedConnection>
          ) : (
            <Empty>Pick a server.</Empty>
          ))}
        {activity === "ai" && <AiPanel />}
        {activity === "keys" && <KeyManager />}
        {activity === "plugins" && <PluginsPanel />}
        {activity === "audit" && <AuditPanel />}
        {activity === "sync" && <SyncPanel />}
        {activity === "settings" && <SettingsPanel />}
      </AppShell>
      <CommandPalette />
    </>
  )
}

/** Hide without unmounting — preserves terminal / heavy UI state. */
function KeepAlive({ active, children }: { active: boolean; children: ReactNode }) {
  return (
    <div
      className={cn(
        "h-full w-full",
        // Use visibility (not display:none) so xterm keeps layout size;
        // only the active panel should call pane_resize.
        !active && "pointer-events-none absolute inset-0 z-0 opacity-0",
        active && "relative z-10",
      )}
      aria-hidden={!active}
    >
      {children}
    </div>
  )
}

function NeedConnection({
  connected,
  children,
}: {
  connected: boolean
  children: ReactNode
}) {
  if (!connected) {
    return (
      <Empty>Connect to this server first — then Terminal, SFTP, and tools share the session.</Empty>
    )
  }
  return children
}

function Empty({ children }: { children: string }) {
  return (
    <div className="text-muted-foreground flex h-full items-center justify-center px-6 text-center text-sm">
      {children}
    </div>
  )
}
