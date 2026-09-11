export type ClientMode = "read_only" | "assisted" | "full"

export interface McpServerState {
  enabled: boolean
  port: number
  activeClientsCount: number
  degradedVaultLocked: boolean
}

export interface McpClient {
  id: string
  name: string
  clientVersion?: string
  mode: ClientMode
  enabled: boolean
  suspendedReason?: string
  pairedAt: number
  lastSeenAt?: number
  allowedHosts: string[]
}

export interface McpPairingCode {
  code: string
  expiresAt: number
  ttlSecs: number
}

export interface McpPairingResult {
  clientId: string
  accessToken: string
  mode: ClientMode
  expiresAt: number
  port: number
  cursorConfig: string
}

export interface McpCallLog {
  id: string
  at: number
  clientName?: string
  hostLabel?: string
  tool: string
  riskTier?: "safe" | "write" | "dangerous"
  decision: string
  durationMs?: number
  resultBytes?: number
  errorCode?: string
}
