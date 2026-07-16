export type AppError =
  | { kind: "NotFound"; entity: string; id?: string }
  | { kind: "Validation"; field: string; message: string }
  | { kind: "Conflict"; message: string }
  | { kind: "Unauthorized"; reason: "locked" | "bad_password" | "biometric" }
  | { kind: "Auth"; method: string; message: string }
  | { kind: "HostKeyChanged"; expected: string; actual: string }
  | { kind: "Connection"; message: string; retryable: boolean }
  | { kind: "Transfer"; jobId: string; message: string }
  | { kind: "Db"; engine: string; message: string }
  | { kind: "Crypto"; message: string }
  | { kind: "Plugin"; slug: string; message: string }
  | { kind: "Io"; message: string }
  | { kind: "Internal"; message: string }

export type VaultStatusDto = {
  initialized: boolean
  locked: boolean
  biometric: boolean
}

export type HostDto = {
  id: string
  groupId: string | null
  label: string
  hostname: string
  port: number
  username: string | null
  authMethod: string
  identityId: string | null
  color: string | null
  isFavorite: boolean
  isPinned: boolean
  notes: string | null
  lastConnectedAt: number | null
  connectCount: number
  jumpHostId?: string | null
  proxyId?: string | null
}

export type GroupDto = {
  id: string
  parentId: string | null
  name: string
  color: string | null
  icon: string | null
  sortOrder: number
}

export type TagDto = {
  id: string
  name: string
  color: string | null
}

export type HostTreeNode =
  | { kind: "group"; group: GroupDto; children: HostTreeNode[] }
  | { kind: "host"; host: HostDto }

export type HostSummaryDto = {
  id: string
  label: string
  hostname: string
  port: number
  username: string | null
  isFavorite: boolean
  lastConnectedAt: number | null
}

export type NewHostDto = {
  label: string
  hostname: string
  port: number
  username?: string | null
  authMethod: string
  groupId?: string | null
  identityId?: string | null
  notes?: string | null
  color?: string | null
  password?: string | null
  sshKeyId?: string | null
}

export type KnownHostDto = {
  id: string
  host: string
  port: number
  keyType: string
  fingerprintSha256: string
  firstSeenAt: number
  lastSeenAt: number
}

export type SshKeyDto = {
  id: string
  name: string
  keyType: string
  publicKey: string
  fingerprintSha256: string
  comment: string | null
  hasPassphrase: boolean
  hardwareBacked: boolean
  source: string
  createdAt: number
}

export type CredentialMetaDto = {
  id: string
  name: string
  kind: string
  createdAt: number
}

export type GenerateKeyDto = {
  name: string
  keyType: "ed25519" | "rsa" | "ecdsa"
  bits?: number
  comment?: string
  passphrase?: string
}

export type PaneInfoDto = {
  paneId: string
  sessionId: string
  hostId: string
  title: string
}

export type SftpEntryDto = {
  name: string
  path: string
  isDir: boolean
  size: number
  mode: number
  mtime: number
  uid: number
  gid: number
}

export type TransferJobDto = {
  id: string
  hostId: string
  kind: string
  sourceRoot: string
  destRoot: string
  status: string
  totalBytes: number
  transferredBytes: number
  totalItems: number
  doneItems: number
  error: string | null
}

export type SnippetDto = {
  id: string
  name: string
  body: string
  language: string | null
  tagsJson: string | null
  shortcut: string | null
  usageCount: number
  isFavorite: boolean
}

export type NoteDto = {
  id: string
  hostId: string | null
  title: string
  bodyMd: string
  color: string | null
  pinned: boolean
}

export type TemplateDto = {
  id: string
  name: string
  kind: string
  body: string
  variablesJson: string | null
}

export type SearchResultDto = {
  kind: string
  id: string
  title: string
  subtitle: string | null
}

export type ConnectionState = {
  hostId: string
  state: "disconnected" | "connecting" | "connected" | "error"
  message?: string
}

export type AppInfoDto = {
  name: string
  version: string
  tauriVersion: string
}
