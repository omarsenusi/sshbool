export type AppError =
  | { kind: "NotFound"; entity: string; id?: string }
  | { kind: "Validation"; field: string; message: string }
  | { kind: "Conflict"; message: string }
  | { kind: "Unauthorized"; reason: string }
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
  icon?: string | null
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
  icon?: string | null
  password?: string | null
  /** Vault key id, or `"auto"` for latest key. */
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

export type MonitoringProcessDto = {
  user: string
  pid: number
  cpu: number
  mem: number
  command: string
}

export type MonitoringServiceDto = {
  unit: string
  load: string
  active: string
  sub: string
}

export type MonitoringDiskDto = {
  mount: string
  sizeBytes: number
  usedBytes: number
}

export type MonitoringSnapshot = {
  hostId: string
  sampledAt: number
  cpuPct: number
  memUsed: number
  memTotal: number
  swapUsed: number
  swapTotal: number
  load1: number
  load5: number
  load15: number
  uptimeSecs: number
  disks: MonitoringDiskDto[]
  os: string
  network?: { rxBps: number; txBps: number }
  processes?: MonitoringProcessDto[]
  services?: MonitoringServiceDto[]
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

export type DetectedDbDto = {
  engine: string
  host: string
  port: number
  username: string
  databases: string[]
}

export type DbColumnDto = {
  name: string
  dataType: string
  nullable: boolean
  defaultValue?: string | null
  isPrimaryKey: boolean
}

export type DbForeignKeyDto = {
  column: string
  refTable: string
  refColumn: string
}

export type DbTableDto = {
  name: string
  schema?: string
  columns: DbColumnDto[]
  foreignKeys: DbForeignKeyDto[]
}

export type DbSchemaGroupDto = {
  name: string
  tables: DbTableDto[]
}

export type DbSchemaDto = {
  schemas: DbSchemaGroupDto[]
}

export type DbQueryResultDto = {
  output?: string | null
  durationMs: number
  columns?: string[]
  rows?: string[][]
  rowCount?: number
}

export type DbTablePreviewDto = {
  columns: string[]
  rows: string[][]
  rowCount: number
  durationMs: number
}

export type DbConnectionDto = {
  id: string
  hostId?: string | null
  engine: string
  name: string
  host?: string | null
  port?: number | null
  database?: string | null
  username?: string | null
}
