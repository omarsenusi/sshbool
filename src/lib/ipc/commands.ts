import { invoke } from "@tauri-apps/api/core"

import type {
  AppError,
  AppInfoDto,
  CredentialMetaDto,
  GenerateKeyDto,
  GroupDto,
  HostDto,
  HostSummaryDto,
  HostTreeNode,
  KnownHostDto,
  NewHostDto,
  NoteDto,
  PaneInfoDto,
  MonitoringSnapshot,
  SearchResultDto,
  SftpEntryDto,
  SnippetDto,
  SshKeyDto,
  TemplateDto,
  TransferJobDto,
  VaultStatusDto,
  DetectedDbDto,
  DbQueryResultDto,
  DbSchemaDto,
  DbTablePreviewDto,
} from "./types"

export class IpcError extends Error {
  constructor(public readonly appError: AppError) {
    super(formatAppError(appError))
    this.name = "IpcError"
  }
}

export function formatAppError(err: AppError): string {
  switch (err.kind) {
    case "NotFound":
      return `${err.entity} not found`
    case "Validation":
      return `${err.field}: ${err.message}`
    case "Unauthorized":
      return err.reason === "bad_password" ? "Incorrect password" : `Unauthorized: ${err.reason}`
    case "HostKeyChanged":
      return `Host key changed (expected ${err.expected}, got ${err.actual})`
    case "Connection":
    case "Conflict":
    case "Io":
    case "Internal":
    case "Crypto":
      return err.message
    case "Auth":
      return `Auth (${err.method}): ${err.message}`
    case "Transfer":
      return err.message
    case "Db":
      return `${err.engine}: ${err.message}`
    case "Plugin":
      return `${err.slug}: ${err.message}`
  }
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args)
  } catch (e) {
    if (e && typeof e === "object" && "kind" in e) {
      throw new IpcError(e as AppError)
    }
    // Tauri sometimes surfaces errors as plain strings / { message }.
    const message =
      typeof e === "string"
        ? e
        : e && typeof e === "object" && "message" in e
          ? String((e as { message: unknown }).message)
          : e instanceof Error
            ? e.message
            : String(e)
    throw new IpcError({
      kind: "Internal",
      message,
    })
  }
}

export const ipc = {
  vaultStatus: () => call<VaultStatusDto>("vault_status"),
  vaultInit: (password: string) => call<void>("vault_init", { password }),
  vaultUnlock: (password: string) => call<void>("vault_unlock", { password }),
  vaultLock: () => call<void>("vault_lock"),
  vaultBackup: (password: string) => call<{ blob: string }>("vault_backup", { password }),
  vaultRestore: (blob: string, password: string) =>
    call<void>("vault_restore", { blob, password }),

  hostsListTree: () => call<HostTreeNode[]>("hosts_list_tree"),
  hostsGet: (id: string) => call<HostDto>("hosts_get", { id }),
  hostsCreate: (host: NewHostDto) => call<string>("hosts_create", { host }),
  hostsUpdate: (host: HostDto) => call<void>("hosts_update", { host }),
  hostsDelete: (id: string) => call<void>("hosts_delete", { id }),
  hostsToggleFavorite: (id: string) => call<boolean>("hosts_toggle_favorite", { id }),
  hostsTogglePin: (id: string) => call<boolean>("hosts_toggle_pin", { id }),
  hostsSearch: (query: string) => call<HostSummaryDto[]>("hosts_search", { query }),
  hostsListRecent: (limit = 20) => call<HostSummaryDto[]>("hosts_list_recent", { limit }),
  hostsImport: (format: string, content: string) =>
    call<{ hosts: NewHostDto[]; count: number }>("hosts_import", { format, content }),
  hostsImportCommit: (hosts: NewHostDto[]) =>
    call<{ imported: number }>("hosts_import_commit", { hosts }),
  hostsExport: (format: string) => call<{ content: string }>("hosts_export", { format }),

  groupsCreate: (name: string, parentId?: string | null) =>
    call<string>("groups_create", { name, parentId: parentId ?? null }),
  groupsRename: (id: string, name: string) => call<void>("groups_rename", { id, name }),
  groupsDelete: (id: string) => call<void>("groups_delete", { id }),

  tagsList: () => call<{ id: string; name: string; color: string | null }[]>("tags_list"),
  tagsAdd: (hostId: string, tag: string) => call<void>("tags_add", { hostId, tag }),
  tagsRemove: (hostId: string, tagId: string) => call<void>("tags_remove", { hostId, tagId }),

  knownHostsList: () => call<KnownHostDto[]>("known_hosts_list"),
  knownHostsTrust: (host: string, port: number, fingerprint: string, keyType: string) =>
    call<void>("known_hosts_trust", { host, port, fingerprint, keyType }),

  sessionOpen: (hostId: string, keyPassphrase?: string | null) =>
    call<{ sessionId: string }>("session_open", {
      hostId,
      keyPassphrase: keyPassphrase ?? null,
    }),
  sessionClose: (sessionId: string) => call<void>("session_close", { sessionId }),

  paneOpen: (hostId: string, cols: number, rows: number) =>
    call<PaneInfoDto>("pane_open", { hostId, cols, rows }),
  paneClose: (paneId: string) => call<void>("pane_close", { paneId }),
  paneResize: (paneId: string, cols: number, rows: number) =>
    call<void>("pane_resize", { paneId, cols, rows }),
  paneWrite: (paneId: string, data: string) => call<void>("pane_write", { paneId, data }),
  paneScrollback: (paneId: string) => call<number[]>("pane_scrollback", { paneId }),
  sessionsList: () => call<PaneInfoDto[]>("sessions_list"),
  commandHistorySearch: (query: string, limit = 50) =>
    call<{ id: string; command: string; ranAt: number }[]>("command_history_search", {
      query,
      limit,
    }),

  keysList: () => call<SshKeyDto[]>("keys_list"),
  keysGenerate: (dto: GenerateKeyDto) => call<SshKeyDto>("keys_generate", { dto }),
  keysImport: (content: string, name: string, passphrase?: string) =>
    call<SshKeyDto>("keys_import", { content, name, passphrase: passphrase ?? null }),
  keysImportFile: (path: string, name?: string, passphrase?: string) =>
    call<SshKeyDto>("keys_import_file", {
      path,
      name: name ?? null,
      passphrase: passphrase ?? null,
    }),
  keysExportPublic: (id: string) => call<{ openssh: string }>("keys_export_public", { id }),
  keysExportPrivate: (id: string, passphrase: string) =>
    call<{ pem: string }>("keys_export_private", { id, passphrase }),
  keysExportPrivateFile: (id: string, passphrase: string, path: string) =>
    call<void>("keys_export_private_file", { id, passphrase, path }),
  keysRename: (id: string, name: string) => call<void>("keys_rename", { id, name }),
  keysDelete: (id: string) => call<void>("keys_delete", { id }),
  keysCopyPublic: (id: string) => call<{ openssh: string }>("keys_copy_public", { id }),

  credentialsList: () => call<CredentialMetaDto[]>("credentials_list"),
  credentialsCreate: (name: string, kind: string, secret: string) =>
    call<string>("credentials_create", { name, kind, secret }),
  credentialsDelete: (id: string) => call<void>("credentials_delete", { id }),

  sftpListDir: (hostId: string, path: string) =>
    call<SftpEntryDto[]>("sftp_list_dir", { hostId, path }),
  sftpStat: (hostId: string, path: string) => call<SftpEntryDto>("sftp_stat", { hostId, path }),
  sftpMkdir: (hostId: string, path: string) => call<void>("sftp_mkdir", { hostId, path }),
  sftpRename: (hostId: string, from: string, to: string) =>
    call<void>("sftp_rename", { hostId, from, to }),
  sftpDelete: (hostId: string, path: string, recursive: boolean) =>
    call<void>("sftp_delete", { hostId, path, recursive }),
  sftpCopy: (hostId: string, from: string, to: string) =>
    call<void>("sftp_copy", { hostId, from, to }),
  sftpChmod: (hostId: string, path: string, mode: number) =>
    call<void>("sftp_chmod", { hostId, path, mode }),
  sftpRead: (hostId: string, path: string) =>
    call<{ content: string; mtime: number }>("sftp_read", { hostId, path }),
  sftpWrite: (hostId: string, path: string, content: string, expectedMtime?: number | null) =>
    call<{ mtime: number }>("sftp_write", {
      hostId,
      path,
      content,
      expectedMtime: expectedMtime ?? null,
    }),
  localHome: () => call<string>("local_home"),
  localListDir: (path: string) => call<SftpEntryDto[]>("local_list_dir", { path }),
  localMkdir: (path: string) => call<void>("local_mkdir", { path }),
  localRename: (from: string, to: string) => call<void>("local_rename", { from, to }),
  localDelete: (path: string, recursive: boolean) =>
    call<void>("local_delete", { path, recursive }),
  transferUpload: (hostId: string, localPath: string, remotePath: string) =>
    call<string>("transfer_upload", { hostId, localPath, remotePath }),
  transferUploadMany: (hostId: string, localPaths: string[], remoteDir: string) =>
    call<string[]>("transfer_upload_many", { hostId, localPaths, remoteDir }),
  transferDownload: (hostId: string, remotePath: string, localPath: string) =>
    call<string>("transfer_download", { hostId, remotePath, localPath }),
  transfersList: () => call<TransferJobDto[]>("transfers_list"),
  transferPause: (jobId: string) => call<void>("transfer_pause", { jobId }),
  transferResume: (jobId: string) => call<void>("transfer_resume", { jobId }),
  transferCancel: (jobId: string) => call<void>("transfer_cancel", { jobId }),

  snippetsList: () => call<SnippetDto[]>("snippets_list"),
  snippetsUpsert: (snippet: Partial<SnippetDto> & { name: string; body: string }) =>
    call<string>("snippets_upsert", { snippet }),
  snippetsDelete: (id: string) => call<void>("snippets_delete", { id }),
  snippetsRun: (id: string, paneId: string) => call<void>("snippets_run", { id, paneId }),

  notesList: (hostId?: string | null) => call<NoteDto[]>("notes_list", { hostId: hostId ?? null }),
  notesUpsert: (note: Partial<NoteDto> & { title: string; bodyMd: string }) =>
    call<string>("notes_upsert", { note }),
  notesDelete: (id: string) => call<void>("notes_delete", { id }),

  templatesList: () => call<TemplateDto[]>("templates_list"),
  templatesRender: (id: string, vars: Record<string, string>) =>
    call<{ body: string }>("templates_render", { id, vars }),

  searchGlobal: (query: string) => call<SearchResultDto[]>("search_global", { query }),
  settingsGet: (key: string) => call<unknown>("settings_get", { key }),
  settingsSet: (key: string, value: unknown) => call<void>("settings_set", { key, value }),
  keybindingsList: () =>
    call<{ id: string; command: string; keys: string }[]>("keybindings_list"),
  keybindingsSet: (command: string, keys: string) =>
    call<void>("keybindings_set", { command, keys }),
  appInfo: () => call<AppInfoDto>("app_info"),

  // Phase 2
  proxiesList: () => call<Record<string, unknown>[]>("proxies_list"),
  proxiesUpsert: (proxy: Record<string, unknown>) => call<string>("proxies_upsert", { proxy }),
  portForwardsList: (hostId: string) =>
    call<Record<string, unknown>[]>("port_forwards_list", { hostId }),
  portForwardsUpsert: (forward: Record<string, unknown>) =>
    call<string>("port_forwards_upsert", { forward }),
  portForwardsDelete: (id: string) => call<void>("port_forwards_delete", { id }),
  portForwardsStart: (id: string) => call<void>("port_forwards_start", { id }),
  portForwardsStop: (id: string) => call<void>("port_forwards_stop", { id }),
  monitoringSnapshot: (hostId: string) =>
    call<MonitoringSnapshot>("monitoring_snapshot", { hostId }),
  monitoringSeries: (hostId: string, metric: string) =>
    call<{ t: number; v: number }[]>("monitoring_series", { hostId, metric }),
  monitoringStart: (hostId: string, intervalMs?: number) =>
    call<void>("monitoring_start", {
      hostId,
      intervalMs: intervalMs ?? 2000,
    }),
  monitoringStop: (hostId: string) => call<void>("monitoring_stop", { hostId }),
  processesList: (hostId: string) => call<Record<string, unknown>[]>("processes_list", { hostId }),
  processKill: (hostId: string, pid: number) => call<void>("process_kill", { hostId, pid }),
  servicesList: (hostId: string) => call<Record<string, unknown>[]>("services_list", { hostId }),
  serviceControl: (hostId: string, unit: string, action: string) =>
    call<void>("service_control", { hostId, unit, action }),
  dockerListContainers: (hostId: string) =>
    call<Record<string, unknown>[]>("docker_list_containers", { hostId }),
  dockerContainerAction: (hostId: string, containerId: string, action: string) =>
    call<void>("docker_container_action", { hostId, containerId, action }),
  dockerListImages: (hostId: string) =>
    call<Record<string, unknown>[]>("docker_list_images", { hostId }),
  dockerLogs: (hostId: string, containerId: string, tail?: number) =>
    call<string>("docker_logs", { hostId, containerId, tail: tail ?? 200 }),
  dockerComposeAction: (hostId: string, path: string, action: string) =>
    call<string>("docker_compose_action", { hostId, path, action }),
  aiProvidersList: () => call<Record<string, unknown>[]>("ai_providers_list"),
  aiProvidersUpsert: (provider: Record<string, unknown>) =>
    call<string>("ai_providers_upsert", { provider }),
  aiSend: (message: string, system?: string, conversationId?: string) =>
    call<{ conversationId: string; reply: string }>("ai_send", {
      message,
      system: system ?? null,
      conversationId: conversationId ?? null,
    }),
  aiExplainCommand: (command: string) =>
    call<{ conversationId: string; reply: string }>("ai_explain_command", { command }),
  aiGenerateCommand: (goal: string) =>
    call<{ conversationId: string; reply: string }>("ai_generate_command", { goal }),
  recordingStart: (sessionId: string, paneId?: string) =>
    call<string>("recording_start", { sessionId, paneId: paneId ?? null }),
  recordingStop: (id: string) => call<void>("recording_stop", { id }),
  foldersCompare: (hostId: string, localRoot: string, remoteRoot: string) =>
    call<Record<string, unknown>>("folders_compare", { hostId, localRoot, remoteRoot }),
  authFido2Status: () => call<{ available: boolean; message: string }>("auth_fido2_status"),
  editorGitStatus: (hostId: string, path: string) =>
    call<string>("editor_git_status", { hostId, path }),
  editorDiff: (hostId: string, path: string) => call<string>("editor_diff", { hostId, path }),

  // Phase 3
  dbConnectionsList: () => call<Record<string, unknown>[]>("db_connections_list"),
  dbConnectionsUpsert: (conn: Record<string, unknown>) =>
    call<string>("db_connections_upsert", { conn }),
  dbConnectionsDelete: (id: string) => call<void>("db_connections_delete", { id }),
  dbQuery: (connectionId: string, sql: string) =>
    call<DbQueryResultDto>("db_query", { connectionId, sql }),
  dbIntrospect: (connectionId: string) =>
    call<DbSchemaDto>("db_introspect", { connectionId }),
  dbTablePreview: (
    connectionId: string,
    table: string,
    schema?: string,
    limit?: number,
    offset?: number,
  ) =>
    call<DbTablePreviewDto>("db_table_preview", {
      connectionId,
      table,
      schema: schema ?? null,
      limit: limit ?? null,
      offset: offset ?? null,
    }),
  dbDetect: (hostId: string) => call<DetectedDbDto[]>("db_detect", { hostId }),
  savedQueriesList: (connectionId: string) =>
    call<Record<string, unknown>[]>("saved_queries_list", { connectionId }),
  savedQueriesUpsert: (query: Record<string, unknown>) =>
    call<string>("saved_queries_upsert", { query }),
  k8sContextsList: (hostId: string) =>
    call<Record<string, unknown>[]>("k8s_contexts_list", { hostId }),
  k8sGetPods: (hostId: string, namespace?: string) =>
    call<Record<string, unknown>[]>("k8s_get_pods", {
      hostId,
      namespace: namespace ?? null,
    }),
  k8sGetDeployments: (hostId: string, namespace?: string) =>
    call<Record<string, unknown>[]>("k8s_get_deployments", {
      hostId,
      namespace: namespace ?? null,
    }),
  k8sLogs: (hostId: string, namespace: string, pod: string, tail?: number) =>
    call<string>("k8s_logs", { hostId, namespace, pod, tail: tail ?? 100 }),
  k8sApply: (hostId: string, manifest: string) =>
    call<string>("k8s_apply", { hostId, manifest }),
  devtoolsProbe: (hostId: string) => call<Record<string, string>>("devtools_probe", { hostId }),
  devtoolsGitStatus: (hostId: string, path: string) =>
    call<string>("devtools_git_status", { hostId, path }),
  devtoolsRun: (hostId: string, command: string) =>
    call<string>("devtools_run", { hostId, command }),
  syncStatus: () => call<Record<string, unknown>>("sync_status"),
  syncConfigure: (enabled: boolean, endpoint?: string | null) =>
    call<void>("sync_configure", { enabled, endpoint: endpoint ?? null }),
  syncExportBundle: () => call<Record<string, unknown>>("sync_export_bundle"),
  syncPairDevice: (name: string, publicKeyB64: string) =>
    call<string>("sync_pair_device", { name, publicKeyB64 }),
  syncDevicesList: () => call<Record<string, unknown>[]>("sync_devices_list"),
  auditList: (limit?: number) => call<Record<string, unknown>[]>("audit_list", { limit: limit ?? 100 }),
  auditExport: () => call<string>("audit_export"),
  pluginsList: () => call<Record<string, unknown>[]>("plugins_list"),
  pluginsInstall: (manifest: Record<string, unknown>) =>
    call<string>("plugins_install", { manifest }),
  pluginsSetEnabled: (id: string, enabled: boolean) =>
    call<void>("plugins_set_enabled", { id, enabled }),
  pluginsUninstall: (id: string) => call<void>("plugins_uninstall", { id }),
  pluginsSearchMarketplace: (query: string) =>
    call<Record<string, unknown>[]>("plugins_search_marketplace", { query }),

  syncEnable: (endpoint: string) => call<void>("sync_enable", { endpoint }),
  syncDisable: () => call<void>("sync_disable"),
  syncPush: () => call<Record<string, unknown>>("sync_push"),
  syncPull: () => call<Record<string, unknown>>("sync_pull"),
  syncUnpair: (deviceId: string) => call<void>("sync_unpair", { deviceId }),
  syncResolveConflict: (entity: string, choice: string) =>
    call<void>("sync_resolve_conflict", { entity, choice }),

  licenseStatus: () => call<Record<string, unknown>>("license_status"),
  licenseActivate: (token: string) => call<Record<string, unknown>>("license_activate", { token }),
  licenseClear: () => call<void>("license_clear"),

  teamStatus: () => call<Record<string, unknown>>("team_status"),
  teamJoinStub: (inviteCode: string) =>
    call<Record<string, unknown>>("team_join_stub", { inviteCode }),
  teamListShared: () => call<Record<string, unknown>[]>("team_list_shared"),
  teamApplyPolicy: (teamId: string) => call<void>("team_apply_policy", { teamId }),
  retentionPrune: (days?: number) =>
    call<Record<string, unknown>>("retention_prune", { days: days ?? 30 }),
}

export type { GroupDto }
