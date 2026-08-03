/**
 * TrayPopup — rich system-tray left-click menu.
 *
 * Modes:
 *  - standalone=false  → inline overlay inside the app (TrayTrigger in window chrome)
 *  - standalone=true   → fills the dedicated tray_popup window
 *
 * Shows:
 *  • Active SSH sessions → click → opens workspace in a new window focused on that server
 *  • Workspaces          → click → opens workspace in a new window
 *  • Close button        → destroys / hides the popup
 */
import { useQuery } from "@tanstack/react-query"
import {
  Activity,
  ChevronRight,
  FolderOpen,
  Layers,
  Power,
  Server,
  Terminal,
  X,
} from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { type Workspace } from "@/components/layout/workspace-switcher"
import { ipc, type TraySession } from "@/lib/ipc/commands"
import { cn } from "@/lib/utils"

/* ── helpers ─────────────────────────────────────────────────────── */
const COLORS = ["#0EA5E9", "#10B981", "#8B5CF6", "#EC4899", "#F59E0B", "#EF4444"]
function wsColor(ws: Workspace, idx: number) {
  return ws.color ?? COLORS[idx % COLORS.length] ?? "#0EA5E9"
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-widest select-none"
      style={{ color: "rgba(255,255,255,0.35)" }}>
      {children}
    </div>
  )
}
function Divider() {
  return <div className="mx-3 my-1 h-px" style={{ background: "rgba(255,255,255,0.06)" }} />
}

/* ── props ───────────────────────────────────────────────────────── */
interface TrayPopupProps {
  onClose: () => void
  /** true = fills dedicated tray window, false = inline overlay in the app */
  standalone?: boolean
}

/* ── component ───────────────────────────────────────────────────── */
export function TrayPopup({ onClose, standalone = false }: TrayPopupProps) {
  const rootRef = useRef<HTMLDivElement>(null)

  // Escape to close (only in overlay mode — standalone handles blur in TrayWindow)
  useEffect(() => {
    if (standalone) return
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose, standalone])

  // Click outside to close (overlay mode only)
  useEffect(() => {
    if (standalone) return
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose()
    }
    window.addEventListener("mousedown", onDown)
    return () => window.removeEventListener("mousedown", onDown)
  }, [onClose, standalone])

  /* live sessions */
  const sessionsQuery = useQuery({
    queryKey: ["tray-sessions"],
    queryFn: () => ipc.trayGetData(),
    refetchInterval: 4000,
  })
  const sessions: TraySession[] = sessionsQuery.data?.sessions ?? []

  /* workspaces */
  const workspacesQuery = useQuery<Workspace[]>({
    queryKey: ["settings", "workspaces"],
    queryFn: async () => {
      const stored = await ipc.settingsGet("workspaces")
      if (Array.isArray(stored) && stored.length > 0) return stored as Workspace[]
      return [{ id: "default", name: "Infrastructure Workspace", color: "#0EA5E9" }]
    },
  })
  const workspaces: Workspace[] = workspacesQuery.data ?? [
    { id: "default", name: "Infrastructure Workspace", color: "#0EA5E9" },
  ]

  /* actions */
  async function openServer(session: TraySession) {
    const wsId = session.workspaceId || "default"
    const wsName = workspaces.find((w) => w.id === wsId)?.name ?? "Workspace"
    try {
      await ipc.workspaceWindowOpenWithHost(wsId, session.hostId, `SSHBool — ${wsName}`)
    } catch {
      window.open(`/?wsId=${wsId}&focusHost=${session.hostId}`, "_blank", "width=1200,height=800")
    }
    if (standalone) {
      void ipc.trayClose().catch(() => {})
    } else {
      onClose()
    }
  }

  async function openWorkspace(ws: Workspace) {
    try {
      await ipc.workspaceWindowOpen(ws.id, `SSHBool — ${ws.name}`)
    } catch {
      window.open(`/?wsId=${ws.id}`, "_blank", "width=1200,height=800")
    }
    if (standalone) {
      void ipc.trayClose().catch(() => {})
    } else {
      onClose()
    }
  }

  /* styles for the popup container */
  const containerStyle: React.CSSProperties = standalone
    ? {
        position: "fixed",
        inset: 0,
        width: "100%",
        height: "100%",
        borderRadius: "0px",
        overflow: "hidden",
      }
    : {
        position: "absolute",
        top: "calc(100% + 6px)",
        left: 0,
        zIndex: 9999,
        width: 280,
        borderRadius: 10,
        overflow: "hidden",
      }

  return (
    <div
      ref={rootRef}
      style={{
        ...containerStyle,
        background: "linear-gradient(160deg, #0f1117 0%, #0a0d14 100%)",
        border: "1px solid rgba(255,255,255,0.07)",
        boxShadow: "0 32px 64px rgba(0,0,0,0.7), 0 0 0 1px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.06)",
        backdropFilter: "blur(24px) saturate(160%)",
        fontFamily: "inherit",
        animation: "tray-in 0.15s cubic-bezier(0.16,1,0.3,1) both",
      }}
      role="menu"
      aria-label="SSHBool Quick Menu"
    >
      {/* ── Header ────────────────────────────────────── */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "12px 14px 10px",
        borderBottom: "1px solid rgba(255,255,255,0.05)",
        background: "rgba(255,255,255,0.02)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 30, height: 30, borderRadius: 8, flexShrink: 0,
            background: "linear-gradient(135deg, #0e7490 0%, #0369a1 100%)",
            boxShadow: "0 4px 12px rgba(14,116,144,0.4)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Terminal size={15} style={{ color: "#67e8f9" }} />
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#fff", lineHeight: 1.2 }}>SSHBool</div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.38)", marginTop: 1 }}>
              {sessions.length > 0
                ? `${sessions.length} active session${sessions.length > 1 ? "s" : ""}`
                : "No active sessions"}
            </div>
          </div>
        </div>

        {/* Close / X button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (standalone) {
              void ipc.trayClose().catch(() => {});
            } else {
              onClose();
            }
          }}
          style={{
            width: 24,
            height: 24,
            borderRadius: 6,
            border: "none",
            background: "transparent",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "rgba(255,255,255,0.35)",
            transition: "all 0.15s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(255,255,255,0.08)"
            e.currentTarget.style.color = "rgba(255,255,255,0.75)"
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent"
            e.currentTarget.style.color = "rgba(255,255,255,0.35)"
          }}
          title="Close"
          aria-label="Close menu"
        >
          <X size={14} />
        </button>
      </div>

      {/* ── Scrollable content ────────────────────────── */}
      <div style={{ overflowY: "auto", maxHeight: standalone ? "calc(100% - 56px)" : 320 }}>
        {/* Active Sessions */}
        {sessions.length > 0 && (
          <>
            <SectionLabel>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <Activity size={10} style={{ color: "#34d399" }} />
                Active Connections
              </span>
            </SectionLabel>
            <div style={{ padding: "2px 6px" }}>
              {sessions.map((s) => (
                <TrayItem
                  key={s.paneId}
                  onClick={() => void openServer(s)}
                  icon={<Server size={13} style={{ color: "#34d399", flexShrink: 0 }} />}
                  label={s.label ?? s.title}
                  sub={workspaces.find((w) => w.id === (s.workspaceId || "default"))?.name}
                  right={<ChevronRight size={12} style={{ color: "rgba(255,255,255,0.25)", flexShrink: 0 }} />}
                  dot="green"
                />
              ))}
            </div>
            <Divider />
          </>
        )}

        {/* Workspaces */}
        <SectionLabel>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Layers size={10} style={{ color: "#38bdf8" }} />
            Workspaces
          </span>
        </SectionLabel>
        <div style={{ padding: "2px 6px 6px" }}>
          {workspaces.map((ws, idx) => {
            const active = sessions.filter((s) => (s.workspaceId || "default") === ws.id).length
            return (
              <TrayItem
                key={ws.id}
                onClick={() => void openWorkspace(ws)}
                icon={
                  <span style={{
                    width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
                    background: wsColor(ws, idx),
                    boxShadow: `0 0 6px ${wsColor(ws, idx)}88`,
                  }} />
                }
                label={ws.name}
                sub={active > 0 ? `${active} connected` : undefined}
                subColor={active > 0 ? "#34d399" : undefined}
                right={<FolderOpen size={12} style={{ color: "rgba(255,255,255,0.2)", flexShrink: 0 }} />}
              />
            )
          })}
        </div>

        <Divider />

        {/* Quit */}
        <div style={{ padding: "4px 6px 6px" }}>
          <TrayItem
            onClick={() => void ipc.appQuit().catch(() => {})}
            icon={<Power size={13} style={{ color: "#f87171", flexShrink: 0 }} />}
            label="Quit SSHBool"
            labelColor="rgba(248,113,113,0.8)"
            danger
          />
        </div>
      </div>
    </div>
  )
}

/* ── Row item ─────────────────────────────────────────────────────── */
function TrayItem({
  onClick,
  icon,
  label,
  sub,
  subColor,
  right,
  dot,
  labelColor,
  danger,
}: {
  onClick: () => void
  icon: React.ReactNode
  label: string
  sub?: string
  subColor?: string
  right?: React.ReactNode
  dot?: "green"
  labelColor?: string
  danger?: boolean
}) {
  const [hovered, setHovered] = useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        width: "100%",
        padding: "7px 8px",
        borderRadius: 8,
        border: "none",
        background: hovered
          ? danger ? "rgba(239,68,68,0.08)" : "rgba(255,255,255,0.06)"
          : "transparent",
        cursor: "pointer",
        textAlign: "left",
        transition: "background 0.1s",
      }}
    >
      {dot === "green" && (
        <span style={{
          width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
          background: "#10b981",
          boxShadow: "0 0 8px rgba(16,185,129,0.7)",
          animation: "pulse-dot 2s ease-in-out infinite",
        }} />
      )}
      {icon}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
        <span style={{
          fontSize: 12, fontWeight: 500,
          color: labelColor ?? "rgba(255,255,255,0.85)",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {label}
        </span>
        {sub && (
          <span style={{
            fontSize: 10,
            color: subColor ?? "rgba(255,255,255,0.3)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {sub}
          </span>
        )}
      </div>
      {right}
    </button>
  )
}

/* ── Trigger button (shown in window chrome) ──────────────────────── */
export function TrayTrigger() {
  const [open, setOpen] = useState(false)

  const sessionsQuery = useQuery({
    queryKey: ["tray-sessions"],
    queryFn: () => ipc.trayGetData(),
    refetchInterval: open ? 4000 : 15000,
  })
  const count = sessionsQuery.data?.sessions.length ?? 0

  return (
    <div className="relative flex items-center">
      <button
        onClick={() => setOpen((p) => !p)}
        className={cn(
          "relative flex h-7 w-7 items-center justify-center rounded-md border border-transparent transition-all duration-150",
          "text-foreground/60 hover:text-foreground hover:bg-muted/70",
          open && "bg-primary/15 text-primary border-primary/20",
        )}
        title="SSHBool Quick Menu"
        aria-label="Open SSHBool tray menu"
        aria-expanded={open}
      >
        <Terminal className="size-[15px]" />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-emerald-500 px-0.5 text-[8px] font-bold text-white leading-none">
            {count > 9 ? "9+" : count}
          </span>
        )}
      </button>

      {open && <TrayPopup onClose={() => setOpen(false)} />}
    </div>
  )
}
