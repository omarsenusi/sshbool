import { useEffect, useMemo, type ReactNode } from "react"

import { CommandPalette } from "@/components/command-palette/command-palette"
import { AppShell } from "@/components/layout/app-shell"
import { AiPanel } from "@/features/ai/components/ai-panel"
import { AuditPanel } from "@/features/audit/components/audit-panel"
import { HomeOverview } from "@/features/home/home-overview"
import { HostSettingsPanel } from "@/features/connections/components/host-settings-panel"
import { DashboardPanel } from "@/features/dashboard/components/dashboard-panel"
import { DatabasesPanel } from "@/features/databases/components/databases-panel"
import { DevtoolsPanel } from "@/features/devtools/components/devtools-panel"
import { DockerPanel } from "@/features/docker/components/docker-panel"
import { RemoteDesktopView } from "@/features/desktop/components/remote-desktop-view"
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
import { onOpenUrl, getCurrent } from "@tauri-apps/plugin-deep-link"
import { listen } from "@tauri-apps/api/event"
import { toast } from "@/stores/toast.store"
import { useState } from "react"
import { ShieldCheck, ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"

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

  // Activation & Licensing States
  const [isActivated, setIsActivated] = useState<boolean | null>(null)
  const [activationUrl, setActivationUrl] = useState<string | null>(null)
  const [appInfo, setAppInfo] = useState<{ version: string; [key: string]: unknown } | null>(null)

  // One SFTP explorer per host so remote listings never mix across servers.
  const sftpHostIds = useMemo(() => {
    const ids = new Set<string>()
    if (selectedHostId) ids.add(selectedHostId)
    for (const [id, c] of Object.entries(byHost)) {
      if (c.status === "connected" || c.status === "connecting") ids.add(id)
    }
    return [...ids]
  }, [selectedHostId, byHost])

  // Load and verify activation status on boot
  useEffect(() => {
    let active = true

    async function checkActivation() {
      try {
        const statusData = await ipc.licenseStatus()
        const appInfoData = await ipc.appInfo()
        if (active) {
          setAppInfo(appInfoData)
          setIsActivated(!!statusData.activated)
        }

        if (!statusData.activated && active) {
          const deviceId = (statusData.licenseKey as string) || (statusData.deviceId as string) || "device-uuid"
          const appVersion = appInfoData.version || "0.1.3"
          const osName = navigator.userAgent.includes("Windows") ? "Windows" : navigator.userAgent.includes("Mac") ? "macOS" : "Linux"

          const response = await fetch("https://ssh.devbool.com/api/v1/devices/authorize-link", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              device_uuid: deviceId,
              device_name: `${osName} Desktop App`,
              os_name: osName,
              os_version: "Desktop",
              app_version: appVersion,
            })
          })

          if (response.ok) {
            const resData = await response.json()
            if (active) {
              setActivationUrl(resData.url)
              // Open in browser
              const { openUrl } = await import("@tauri-apps/plugin-opener")
              await openUrl(resData.url)
            }
          }
        }
      } catch (err) {
        console.error("Failed to check license activation status:", err)
      }
    }

    checkActivation()

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    void ipc
      .vaultStatus()
      .then(async (st) => {
        const isSubWindow = window.location.search.includes("wsId=")
        const lockOnStartup = await ipc.settingsGet("lockOnStartup")
        if (st.initialized && st.locked && lockOnStartup === true && !isSubWindow) {
          try {
            await ipc.vaultLock()
          } catch {
            /* ignore */
          }
          setStatus({ ...st, locked: true })
        } else {
          setStatus(st)
        }
      })
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

  // Deep link activation listener (sshbool://activate)
  useEffect(() => {
    const handleDeepLinks = (urls: string[]) => {
      console.log("[DEBUG] handleDeepLinks received urls:", urls)
      if (!Array.isArray(urls)) {
        console.warn("[DEBUG] received urls is not an array:", urls)
        return
      }
      for (const urlStr of urls) {
        try {
          console.log("[DEBUG] Evaluating urlStr:", urlStr)
          const cleanUrl = urlStr.replace(/^["']|["']$/g, "").trim()
          console.log("[DEBUG] Cleaned urlStr:", cleanUrl)
          if (cleanUrl.startsWith("sshbool://activate")) {
            const url = new URL(cleanUrl)
            const token = url.searchParams.get("token")
            const signature = url.searchParams.get("signature")
            console.log("[DEBUG] Extracted token & signature:", token, signature)
            let combinedToken = ""
            if (token && signature) {
              combinedToken = `${token}.${signature}`
            } else if (token) {
              combinedToken = token
            }
            if (combinedToken) {
              ipc.licenseActivate(combinedToken)
                .then(() => {
                  toast.success("License Activated", "Your SSHBool license is now active on this device.")
                  setIsActivated(true)
                })
                .catch((err: Error) => {
                  const msg = err.message || (typeof err === "string" ? err : JSON.stringify(err)) || "Failed to activate license."
                  toast.error("Activation Failed", msg)
                })
            }
          }
        } catch (e) {
          console.error("Failed to parse deep link URL:", urlStr, e)
        }
      }
    }

    getCurrent()
      .then((urls) => {
        if (urls && urls.length > 0) {
          handleDeepLinks(urls)
        }
      })
      .catch(console.error)

    // tauri-plugin-deep-link official listener
    const promise = onOpenUrl((urls) => {
      console.log("[DEBUG] onOpenUrl fired:", urls)
      handleDeepLinks(urls)
    })

    // single-instance plugin forwarding (fallback)
    const unlistenSingleInstancePromise = listen<string[]>("single-instance-deep-link", (event) => {
      console.log("[DEBUG] single-instance-deep-link event:", event.payload)
      handleDeepLinks(event.payload)
    })

    // Also listen to raw deep-link event emitted by tauri-plugin-deep-link internally
    const unlistenDeepLinkNewUrl = listen<string[]>("deep-link://new-url", (event) => {
      console.log("[DEBUG] deep-link://new-url event:", event.payload)
      handleDeepLinks(event.payload)
    })

    // Catch-all: listen to any event to debug what's coming through
    const unlistenAny = listen<unknown>("tauri://deep-link", (event) => {
      console.log("[DEBUG] tauri://deep-link event:", event.payload)
      const payload = event.payload
      if (Array.isArray(payload)) handleDeepLinks(payload as string[])
      else if (typeof payload === "string") handleDeepLinks([payload])
    })

    return () => {
      promise.then((unlisten) => {
        if (typeof unlisten === "function") {
          unlisten()
        }
      }).catch(console.error)
      unlistenSingleInstancePromise.then((unlisten) => unlisten()).catch(console.error)
      unlistenDeepLinkNewUrl.then((unlisten) => unlisten()).catch(console.error)
      unlistenAny.then((unlisten) => unlisten()).catch(console.error)
    }
  }, [])

  if (isActivated === null) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background text-foreground">
        <div className="flex flex-col items-center gap-3">
          <div className="size-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-xs text-muted-foreground">Checking license status...</p>
        </div>
      </div>
    )
  }

  if (!isActivated) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center bg-background text-foreground p-6 font-sans select-none">
        <div className="max-w-md w-full space-y-6">
          
          {/* Header section */}
          <div className="space-y-2 text-center">
            <div className="mx-auto size-12 rounded-xl bg-muted/50 border border-border flex items-center justify-center shadow-sm">
              <KeyRound className="size-5 text-muted-foreground" />
            </div>
            
            <h1 className="text-xl font-semibold tracking-tight text-foreground">
              Activate SSHBool
            </h1>
            <p className="text-xs text-muted-foreground max-w-xs mx-auto leading-relaxed">
              Verify your device license to unlock all features of the SSH client workspace.
            </p>
          </div>

          {/* Main Shadcn Card */}
          <div className="rounded-xl border border-border bg-card/40 p-6 space-y-5 backdrop-blur-md">
            
            {/* Status indicators */}
            <div className="flex items-center justify-between border-b border-border/80 pb-4">
              <div className="flex items-center gap-2">
                <div className="size-2 rounded-full bg-amber-500 animate-pulse" />
                <span className="text-xs font-medium text-muted-foreground">Awaiting Activation</span>
              </div>
              <span className="text-[10px] font-mono text-muted-foreground bg-muted px-2 py-0.5 rounded border border-border">
                {appInfo?.version ? `v${appInfo.version}` : "v0.1.3"}
              </span>
            </div>

            {/* Launch Browser Button */}
            {activationUrl && (
              <Button
                variant="default"
                size="default"
                className="w-full h-10 font-medium text-xs bg-primary hover:bg-primary/90 text-primary-foreground transition-all gap-2"
                onClick={async () => {
                  const { openUrl } = await import("@tauri-apps/plugin-opener")
                  openUrl(activationUrl)
                }}
              >
                <span>Authorize in Browser</span>
                <ExternalLink className="size-3.5" />
              </Button>
            )}

            {/* Manual Activation Code Input (Commented out for clean UI)
            <div className="space-y-2 pt-1">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Manual Activation
                </label>
                <button
                  type="button"
                  className="text-[10px] text-muted-foreground/80 hover:text-foreground transition-colors"
                  onClick={() => {
                    navigator.clipboard.readText().then((txt) => {
                      if (txt) setManualInput(txt)
                    }).catch(() => {})
                  }}
                >
                  Paste from Clipboard
                </button>
              </div>
              
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Paste activation link or token"
                  value={manualInput}
                  onChange={(e) => setManualInput(e.target.value)}
                  className="flex-1 h-9 px-3 rounded-md border border-border bg-background text-foreground placeholder-muted-foreground/50 text-xs focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all font-mono"
                />
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-9 px-4 text-xs bg-secondary hover:bg-secondary/80 text-secondary-foreground font-medium border border-border"
                  onClick={handleManualActivate}
                >
                  Verify
                </Button>
              </div>
            </div>
            */}

            {/* Subdued Terminal Logs (Commented out for clean UI)
            <div className="rounded-lg bg-muted/20 border border-border/80 p-3.5 font-mono text-[10px] space-y-1.5 select-text">
              <div className="flex items-center justify-between text-muted-foreground/80 border-b border-border/60 pb-1.5 mb-1.5">
                <div className="flex items-center gap-1.5">
                  <Terminal className="size-3.5" />
                  <span>deep-link-listener.log</span>
                </div>
                <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
              </div>
              
              <div className="text-muted-foreground/60">$ listening for local deep-links...</div>
              
              {debugLogs.length > 0 ? (
                debugLogs.map((log, index) => (
                  <div key={index} className="text-emerald-500/90 break-all leading-normal">
                    <span className="text-muted-foreground/50">&gt; recv:</span> {log}
                  </div>
                ))
              ) : (
                <div className="text-muted-foreground/40 italic font-sans text-[9px] pt-1">
                  Waiting for browser activation link trigger...
                </div>
              )}
            </div>
            */}

          </div>

          {/* Secure indicator footer */}
          <div className="flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground">
            <ShieldCheck className="size-3.5" />
            <span>Secure Device Binding Enabled</span>
          </div>

        </div>
      </div>
    )
  }

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
        {activity === "desktop" &&
          (selectedHostId ? (
            <RemoteDesktopView hostId={selectedHostId} />
          ) : (
            <Empty>Pick a server.</Empty>
          ))}
        {activity === "hostSettings" &&
          (selectedHostId ? (
            <HostSettingsPanel hostId={selectedHostId} />
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
