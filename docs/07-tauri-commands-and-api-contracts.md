# 07 — Tauri Commands & API Contracts

This is the **IPC contract** between the React frontend and the Rust core. It is authoritative:
every command name, its input DTO, output DTO, and error, plus every streaming event.

## 1. Conventions

- Command names: `snake_case`, namespaced by context: `hosts_create`, `sftp_list_dir`, `vault_unlock`.
- All commands are `async` and return `Result<T, AppError>`.
- DTOs are defined in Rust (`application::<ctx>::dto`) with `#[derive(Serialize, Deserialize, TS)]`
  and exported to `src/lib/ipc/types.ts` (via `ts-rs`); a matching **zod** schema validates payloads
  in the frontend at the boundary. CI fails on drift.
- Streaming uses **events** (server→client), not command return values.
- Secrets are **never** returned to the frontend in plaintext (only metadata + ephemeral handles).

## 2. `AppError` contract (discriminated union)

```ts
// src/lib/ipc/types.ts (generated)
type AppError =
  | { kind: "NotFound"; entity: string; id?: string }
  | { kind: "Validation"; field: string; message: string }
  | { kind: "Conflict"; message: string }
  | { kind: "Unauthorized"; reason: "locked" | "bad_password" | "biometric" }
  | { kind: "Auth"; method: string; message: string }        // ssh auth failed
  | { kind: "HostKeyChanged"; expected: string; actual: string }
  | { kind: "Connection"; message: string; retryable: boolean }
  | { kind: "Transfer"; jobId: string; message: string }
  | { kind: "Db"; engine: string; message: string }
  | { kind: "Crypto"; message: string }
  | { kind: "Plugin"; slug: string; message: string }
  | { kind: "Io"; message: string }
  | { kind: "Internal"; message: string };                    // never leaks secrets
```

Rust side (`app/src/error.rs`) maps `DomainError`/`ApplicationError`/infra errors into this enum
with a **redaction pass** so messages never contain secrets, key material, or full remote paths
with credentials.

## 3. Event topics (server → client streams)

| Topic | Payload | Emitter |
|---|---|---|
| `terminal://data/{paneId}` | `{ bytes: number[] }` (or base64) | pty task |
| `terminal://exit/{paneId}` | `{ code: number \| null }` | pty task |
| `transfer://progress/{jobId}` | `TransferProgress` | transfer service |
| `transfer://item/{jobId}` | `TransferItemUpdate` | transfer service |
| `metrics://snapshot/{hostId}` | `HostSnapshot` | monitoring scheduler |
| `docker://logs/{containerId}` | `{ line: string; stream: "stdout"\|"stderr" }` | docker |
| `docker://stats/{containerId}` | `ContainerStats` | docker |
| `ai://token/{requestId}` | `{ delta: string }` | ai stream |
| `ai://done/{requestId}` | `{ usage?: TokenUsage }` | ai stream |
| `connection://state/{hostId}` | `ConnectionState` | connection actor |
| `sync://state` | `SyncStatus` | sync service |
| `plugin://event/{slug}` | `PluginEvent` | plugin host |
| `app://lock` | `{}` | auto‑lock timer |

Frontend subscribes via a typed `useEvent(topic, handler)` hook (doc 06 §hooks). All topics are
throttled/coalesced server‑side (doc 23).

## 4. Command catalog

Grouped by context. Format: `command_name(Input) -> Output`.

### 4.1 Connections
```
hosts_create(NewHostDto) -> HostId
hosts_update(HostDto) -> ()
hosts_delete(HostId) -> ()
hosts_clone(HostId) -> HostId
hosts_move({ id, groupId? , sortOrder }) -> ()
hosts_toggle_favorite(HostId) -> bool
hosts_toggle_pin(HostId) -> bool
hosts_get(HostId) -> HostDto
hosts_list_tree() -> HostTreeNode[]
hosts_search(SearchHostsDto) -> HostSummaryDto[]
hosts_list_recent({ limit }) -> HostSummaryDto[]
hosts_import({ format: "json"|"yaml"|"ssh_config", content }) -> ImportPreviewDto
hosts_import_commit(ImportPreviewDto) -> { imported: number }
hosts_export({ ids?, format }) -> { content: string }
groups_create(NewGroupDto) -> GroupId
groups_rename({ id, name }) -> ()
groups_delete(GroupId) -> ()
tags_list() -> TagDto[]
tags_add({ hostId, tag }) -> ()
tags_remove({ hostId, tagId }) -> ()
proxies_list() -> ProxyDto[]
proxies_upsert(ProxyDto) -> ProxyId
port_forwards_upsert(PortForwardDto) -> PortForwardId
port_forwards_delete(PortForwardId) -> ()
known_hosts_list() -> KnownHostDto[]
known_hosts_trust({ host, port, fingerprint }) -> ()
```

### 4.2 Vault & Keys
```
vault_status() -> { initialized: bool, locked: bool, biometric: bool }
vault_init({ password }) -> ()
vault_unlock({ password?, biometric?: bool }) -> ()
vault_lock() -> ()
vault_change_password({ old, new }) -> ()
vault_enable_biometric(bool) -> ()
credentials_list() -> CredentialMetaDto[]       // NO secret values
credentials_create(NewCredentialDto) -> CredentialId
credentials_delete(CredentialId) -> ()
keys_list() -> SshKeyDto[]                       // public + metadata only
keys_generate(GenerateKeyDto) -> SshKeyDto
keys_import({ content, passphrase? }) -> SshKeyDto
keys_export_public(KeyId) -> { openssh: string }
keys_export_private({ id, passphrase }) -> { pem: string }   // audited, requires unlock
keys_rename({ id, name }) -> ()
keys_delete(KeyId) -> ()
keys_add_passphrase({ id, passphrase }) -> ()
keys_copy_public(KeyId) -> { openssh: string }
vault_backup({ password }) -> { blob: string }   // encrypted export
vault_restore({ blob, password }) -> ()
```

### 4.3 Sessions & Terminal
```
session_open({ hostId }) -> SessionId
session_close(SessionId) -> ()
pane_open({ sessionId, kind, cols, rows }) -> PaneId
pane_close(PaneId) -> ()
pane_resize({ paneId, cols, rows }) -> ()
pane_write({ paneId, data }) -> ()               // keystrokes (base64/bytes)
session_run_command({ hostId, command }) -> { output, exitCode }  // one-shot exec
recording_start(PaneId) -> RecordingId
recording_stop(RecordingId) -> RecordingDto
session_export_log({ paneId, format }) -> { path }
sessions_list() -> SessionSummaryDto[]
command_history_search(SearchDto) -> CommandHistoryDto[]
layout_save({ sessionId, layout }) -> ()
layout_get(SessionId) -> LayoutDto
```

### 4.4 SFTP & Transfers
```
sftp_list_dir({ hostId, path, showHidden }) -> DirEntryDto[]
sftp_stat({ hostId, path }) -> DirEntryDto
sftp_mkdir({ hostId, path }) -> ()
sftp_rename({ hostId, from, to }) -> ()
sftp_move({ hostId, from, to }) -> ()
sftp_copy({ hostId, from, to }) -> ()
sftp_delete({ hostId, path, recursive }) -> ()
sftp_chmod({ hostId, path, mode, recursive }) -> ()
sftp_chown({ hostId, path, uid, gid, recursive }) -> ()
sftp_preview({ hostId, path, kind }) -> PreviewDto  // text head / image thumb / archive listing / media meta
transfer_upload({ hostId, sources[], destDir }) -> JobId
transfer_download({ hostId, sources[], destDir }) -> JobId
transfer_sync({ hostId, localRoot, remoteRoot, direction, deleteExtra }) -> JobId
transfer_pause(JobId) -> ()
transfer_resume(JobId) -> ()
transfer_cancel(JobId) -> ()
transfer_retry_item({ jobId, itemId }) -> ()
transfers_list() -> TransferJobDto[]
folders_compare({ hostId, localRoot, remoteRoot }) -> DiffEntryDto[]
bookmarks_list(hostId) -> BookmarkDto[]
bookmarks_add({ hostId, path, label }) -> ()
```

### 4.5 Monitoring
```
monitoring_start({ hostId, intervalMs }) -> ()
monitoring_stop(hostId) -> ()
monitoring_snapshot(hostId) -> HostSnapshotDto
monitoring_series({ hostId, metric, from, to }) -> MetricPointDto[]
processes_list({ hostId, sort }) -> ProcessDto[]
process_kill({ hostId, pid, signal }) -> ()
services_list(hostId) -> ServiceDto[]
service_control({ hostId, unit, action }) -> ()
disks_list(hostId) -> DiskUsageDto[]
system_info(hostId) -> SystemInfoDto            // kernel, distro, uptime
updates_list(hostId) -> UpdateDto[]
```

### 4.6 Containers
```
docker_list_containers(hostId) -> ContainerDto[]
docker_container_action({ hostId, id, action }) -> ()  // start|stop|restart|remove
docker_exec({ hostId, id, cmd }) -> PaneId             // opens a shell pane
docker_logs_start({ hostId, id }) -> ()                // streams docker://logs
docker_logs_stop({ hostId, id }) -> ()
docker_stats_start({ hostId, id }) -> ()
docker_list_images(hostId) -> ImageDto[]
docker_pull({ hostId, ref }) -> JobId
docker_image_remove({ hostId, id }) -> ()
docker_list_volumes(hostId) -> VolumeDto[]
docker_list_networks(hostId) -> NetworkDto[]
compose_list(hostId) -> ComposeProjectDto[]
compose_action({ hostId, path, action }) -> ()         // up|down|restart
k8s_list_pods({ hostId, namespace }) -> PodDto[]        // feature-gated
k8s_pod_logs({ hostId, namespace, pod }) -> ()
```

### 4.7 Databases
```
db_list() -> DbConnectionDto[]
db_upsert(DbConnectionDto) -> DbConnectionId
db_delete(DbConnectionId) -> ()
db_test(DbConnectionDto) -> { ok: bool, message?: string }
db_introspect(DbConnectionId) -> SchemaDto
db_run_query({ connectionId, sql, params? }) -> ResultSetDto
db_saved_list(connectionId) -> SavedQueryDto[]
db_saved_upsert(SavedQueryDto) -> SavedQueryId
db_history(connectionId) -> QueryHistoryDto[]
db_export_result({ resultId, format }) -> { path }
redis_command({ connectionId, args[] }) -> RedisReplyDto
mongo_find({ connectionId, db, collection, filter, limit }) -> MongoDocDto[]
```

### 4.8 Knowledge / Productivity
```
snippets_list() -> SnippetDto[]
snippets_upsert(SnippetDto) -> SnippetId
snippets_delete(SnippetId) -> ()
snippets_run({ id, paneId }) -> ()
notes_list(hostId?) -> NoteDto[]
notes_upsert(NoteDto) -> NoteId
notes_delete(NoteId) -> ()
templates_list() -> TemplateDto[]
templates_render({ id, vars }) -> { content }
search_global({ query, scopes[] }) -> SearchResultDto[]  // federated FTS
```

### 4.9 AI
```
ai_providers_list() -> AiProviderDto[]
ai_providers_upsert(AiProviderDto) -> AiProviderId
ai_send({ conversationId?, hostId?, message, context? }) -> { requestId, conversationId } // streams ai://token
ai_explain_command({ command }) -> { requestId }
ai_generate_command({ intent, os }) -> { requestId }
ai_analyze_logs({ text }) -> { requestId }
ai_explain_error({ text }) -> { requestId }
ai_generate_config({ kind, spec }) -> { requestId }   // nginx|apache|compose
ai_generate_sql({ schema, intent }) -> { requestId }
ai_translate_output({ text, targetLang }) -> { requestId }
ai_conversations_list() -> ConversationSummaryDto[]
```

### 4.10 Sync
```
sync_status() -> SyncStatusDto
sync_configure({ enabled, endpoint? }) -> ()
sync_enable({ endpoint }) -> ()
sync_disable() -> ()
sync_export_bundle() -> { changeId, ciphertextB64, nonceB64 }
sync_push() -> { pushed, relay?, httpStatus? }
sync_pull() -> { pulled, conflicts }
sync_pair_device({ name, publicKeyB64 }) -> DeviceId
sync_unpair(DeviceId) -> ()
sync_devices_list() -> DeviceDto[]
sync_resolve_conflict({ entity, choice }) -> ()  // local|remote LWW stub
```

### 4.10b License / Team (Phase 4 client)
```
license_status() -> { tier, expiresAt?, features[], hostCount, hostLimit? }
license_activate({ token }) -> { tier, features[] }  // Ed25519 or dev:{json}
license_clear() -> ()
team_status() -> { membershipId?, teamId?, role?, policy? }
team_join_stub({ inviteCode }) -> { membershipId, teamId }
team_list_shared() -> SharedDirDto[]
team_apply_policy({ teamId }) -> ()
retention_prune({ days? }) -> { deleted }
```

### 4.11 Plugins
```
plugins_list() -> PluginDto[]
plugins_search_marketplace({ query }) -> MarketplaceItemDto[]
plugins_install({ slug, version? }) -> PluginDto
plugins_uninstall(slug) -> ()
plugins_set_enabled({ id, enabled }) -> ()
```

### 4.12 App / Settings
```
settings_get(key) -> JsonValue
settings_set({ key, value }) -> ()
themes_list() -> ThemeDto[]
themes_upsert(ThemeDto) -> ThemeId
keybindings_list() -> KeybindingDto[]
keybindings_set(KeybindingDto) -> ()
app_info() -> { version, platform, buildId }
audit_list({ from, to, action? }) -> AuditEntryDto[]
```

## 5. Capability / permission mapping (Tauri v2)

`src-tauri/capabilities/default.json` grants the webview only the plugins it needs
(opener, updater, dialog for file pickers, os, clipboard for copy). **No `fs`/`shell` scope** is
granted to the webview — all filesystem/process access goes through our typed commands in the Rust
core, which enforce their own authorization. See doc 22.

## 6. Type‑sync workflow

1. Define/adjust DTO in Rust with `#[derive(TS)]`.
2. `bun run gen:ipc` runs `ts-rs` export → `src/lib/ipc/types.ts` and regenerates zod schemas.
3. Frontend `invoke` wrappers in `src/lib/ipc/commands.ts` are typed against these.
4. CI runs the generator and fails if the working tree changes (drift detection).
