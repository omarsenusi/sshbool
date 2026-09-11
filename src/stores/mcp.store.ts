import { create } from "zustand"
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"

export type ApprovalDecision = "allow_once" | "allow_session" | "deny"

export interface McpApprovalRequest {
  approvalId: string
  clientId: string
  clientName: string
  hostId: string | null
  hostLabel: string | null
  production: boolean
  tool: string
  riskTier: "safe" | "write" | "dangerous"
  riskReasons: string[]
  commandText: string | null
  agentReason: string | null
  previewOutput: string | null
  grantable: boolean
  requestedAt: number
  expiresAt: number
}

interface McpApprovalStore {
  queue: McpApprovalRequest[]
  initialized: boolean
  init: () => Promise<void>
  enqueue: (req: McpApprovalRequest) => void
  respond: (approvalId: string, decision: ApprovalDecision) => Promise<void>
  dismissCurrent: () => void
}

function readRiskTier(
  payload: Record<string, unknown>
): McpApprovalRequest["riskTier"] {
  const raw = payload.riskTier ?? payload.risk_tier
  if (raw === "safe" || raw === "write" || raw === "dangerous") return raw
  return "write"
}

/** Normalizes approval payloads from live events (camelCase) and legacy snake_case. */
export function normalizeApproval(
  payload: Record<string, unknown>
): McpApprovalRequest {
  const hostIdRaw = payload.hostId ?? payload.host_id
  const hostLabelRaw = payload.hostLabel ?? payload.host_label
  const commandRaw =
    payload.commandText ?? payload.commandPreview ?? payload.command_preview
  const previewRaw = payload.previewOutput ?? payload.preview_output
  const agentReasonRaw = payload.agentReason ?? payload.agent_reason
  const riskReasonsRaw = payload.riskReasons ?? payload.risk_reasons
  const requestedAtRaw = payload.requestedAt ?? payload.requested_at
  const expiresAtRaw = payload.expiresAt ?? payload.expires_at

  return {
    approvalId: String(payload.approvalId ?? payload.id ?? ""),
    clientId: String(payload.clientId ?? payload.client_id ?? ""),
    clientName: String(
      payload.clientName ?? payload.client_name ?? "Unknown client"
    ),
    hostId: hostIdRaw != null && hostIdRaw !== "" ? String(hostIdRaw) : null,
    hostLabel:
      hostLabelRaw != null && hostLabelRaw !== "" ? String(hostLabelRaw) : null,
    production: Boolean(payload.production),
    tool: String(payload.tool ?? ""),
    riskTier: readRiskTier(payload),
    riskReasons: Array.isArray(riskReasonsRaw)
      ? riskReasonsRaw.map(String)
      : [],
    commandText:
      commandRaw != null && commandRaw !== "" ? String(commandRaw) : null,
    agentReason:
      agentReasonRaw != null && agentReasonRaw !== ""
        ? String(agentReasonRaw)
        : null,
    previewOutput:
      previewRaw != null && previewRaw !== "" ? String(previewRaw) : null,
    grantable: Boolean(payload.grantable),
    requestedAt: Number(requestedAtRaw ?? Date.now()),
    expiresAt: Number(expiresAtRaw ?? Date.now() + 60_000),
  }
}

let unlistenApproval: (() => void) | null = null

export const useMcpApprovalStore = create<McpApprovalStore>((set, get) => ({
  queue: [],
  initialized: false,

  init: async () => {
    if (get().initialized) return

    try {
      const pending = await invoke<McpApprovalRequest[]>(
        "mcp_approvals_pending"
      )
      set({
        queue: pending.map((row) =>
          normalizeApproval(row as unknown as Record<string, unknown>)
        ),
        initialized: true,
      })
    } catch (e) {
      console.error("Failed to load pending MCP approvals", e)
      set({ initialized: true })
    }

    if (!unlistenApproval) {
      const unlisten = await listen<Record<string, unknown>>(
        "mcp://approval-request",
        (event) => {
          const req = normalizeApproval(event.payload)
          get().enqueue(req)
        }
      )
      unlistenApproval = unlisten
    }
  },

  enqueue: (req) => {
    set((state) => {
      if (state.queue.some((item) => item.approvalId === req.approvalId)) {
        return state
      }
      return { queue: [...state.queue, req] }
    })
  },

  respond: async (approvalId, decision) => {
    await invoke("mcp_approval_respond", { approvalId, decision })
    set((state) => ({
      queue: state.queue.filter((item) => item.approvalId !== approvalId),
    }))
  },

  dismissCurrent: () => {
    set((state) => ({ queue: state.queue.slice(1) }))
  },
}))

export function selectCurrentApproval(
  state: McpApprovalStore
): McpApprovalRequest | null {
  return state.queue[0] ?? null
}
