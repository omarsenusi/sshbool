# 05 — Rust Backend Architecture

Layers map to workspace crates (ADR‑006): `domain` → `application` → `infrastructure` → `app`.
This doc enumerates **every module** and its responsibility. Signatures are indicative; the
implementing pass fills bodies (no placeholders — each has an acceptance checklist).

## 1. `domain` crate (pure, no external I/O deps)

Dependencies allowed: `std`, `thiserror`, `serde`, `uuid`, `time`. **Forbidden:** `tauri`, `sqlx`, `russh`, `tokio`.

### 1.1 `shared/`
- `ids.rs` — newtype IDs: `HostId`, `GroupId`, `SessionId`, `KeyId`, … (wrap `Uuid`, `#[derive(TS)]`).
- `value_objects.rs` — `Hostname`, `Port`, `Fingerprint`, `Username`, `NonEmptyString` (validated ctors).
- `error.rs` — `DomainError` enum (`NotFound`, `Invalid`, `Conflict`, `Unauthorized`, `Crypto`, …) + `DomainResult<T>`.
- `pagination.rs` — `Page`, `PageRequest`, `Sort`.
- `clock.rs` — `Clock` trait (injectable time for tests).

### 1.2 `connections/`
- `entities.rs` — `Host`, `Group`, `Identity`, `Proxy`, `PortForward`, `Tag`, `KnownHost` aggregates + invariants (e.g., a host can't be its own jump host; port range checks).
- `ports.rs` — traits: `HostRepository`, `GroupRepository`, `IdentityRepository`, `ProxyRepository`, `KnownHostsStore`, `PortForwardRepository`.
- `services.rs` — pure domain services (e.g., `HostTreeBuilder`, cycle detection for jump hosts).

### 1.3 `vault/`
- `entities.rs` — `Vault`, `Credential`, `SshKey`, `KeyType`, `KdfParams`.
- `ports.rs` — `CredentialRepository`, `SshKeyRepository`, `SecretStore` (encrypt/decrypt envelope), `Kdf`, `Aead`, `OsKeychain`, `KeyGenerator`, `HardwareKey`.
- `policy.rs` — auto‑lock policy, password strength rules.

### 1.4 `sessions/`
- `entities.rs` — `Session`, `SessionPane`, `Recording`, `PaneKind`, `Layout`.
- `ports.rs` — `SessionRepository`, `RecordingStore`, `SshTransport`, `PtyChannel`, `CommandHistoryRepository`.

### 1.5 `transfers/`
- `entities.rs` — `TransferJob`, `TransferItem`, `TransferKind`, `TransferStatus`, `SyncPlan`, `DiffEntry`.
- `ports.rs` — `TransferRepository`, `SftpClient`, `Checksummer`, `BookmarkRepository`.
- `services.rs` — `SyncPlanner` (compute add/update/delete between local & remote trees), `ResumeCalculator`.

### 1.6 `monitoring/`
- `entities.rs` — `HostSnapshot`, `MetricPoint`, `MetricSeries`, `DiskUsage`, `ProcessInfo`.
- `ports.rs` — `MetricsCollector` (probe a host), `SnapshotRepository`, `SeriesRepository`.

### 1.7 `containers/`
- `entities.rs` — `Container`, `Image`, `Volume`, `Network`, `ComposeProject`, `K8sResource`.
- `ports.rs` — `DockerClient`, `KubernetesClient`, `ComposeRepository`.

### 1.8 `datastores/`
- `entities.rs` — `DbConnection`, `DbEngine`, `Query`, `ResultSet`, `Column`, `SavedQuery`.
- `ports.rs` — `DbConnectionRepository`, `SqlClient`, `RedisClient`, `MongoClient`, `QueryHistoryRepository`.

### 1.9 `knowledge/`
- `entities.rs` — `Snippet`, `Note`, `Template`, `TemplateKind`.
- `ports.rs` — `SnippetRepository`, `NoteRepository`, `TemplateRepository`, `SearchIndex`.

### 1.10 `ai/`
- `entities.rs` — `AiProvider`, `AiConversation`, `AiMessage`, `AiRole`, `AiTool`.
- `ports.rs` — `AiProviderClient` (stream completion), `AiConversationRepository`.

### 1.11 `sync/`
- `entities.rs` — `Device`, `SyncState`, `ChangeSet`, `VectorClock`, `Envelope`.
- `ports.rs` — `SyncTransport`, `ChangeStore`, `DeviceRepository`, `EnvelopeCrypto`.

### 1.12 `plugins/`
- `entities.rs` — `Plugin`, `PluginManifest`, `Capability`, `Permission`, `PluginKind`.
- `ports.rs` — `PluginRepository`, `PluginRuntime`, `CapabilityChecker`.

## 2. `application` crate (use cases; depends on `domain` only)

Deps: `domain`, `async-trait`, `serde`, `ts-rs`, `tracing`. **No** infra crates.

Pattern: each use case is a struct holding the port traits it needs (`Arc<dyn …>`), with an
`execute(input) -> AppResult<output>` method. Commands mutate; queries read. DTOs live in
`<context>/dto.rs` and derive `Serialize + Deserialize + TS`.

### 2.1 `connections/`
- Commands: `CreateHost`, `UpdateHost`, `DeleteHost`, `CloneHost`, `MoveHost`, `ToggleFavorite`, `TogglePin`, `CreateGroup`, `RenameGroup`, `AddTag`, `RemoveTag`, `ImportHosts` (JSON/YAML/`ssh_config`), `ExportHosts`, `CreatePortForward`, `TrustKnownHost`.
- Queries: `ListHostsTree`, `SearchHosts`, `GetHost`, `ListRecentHosts`, `ListFavorites`, `ListTags`, `PreviewSshConfigImport`.

### 2.2 `vault/`
- Commands: `InitVault`, `UnlockVault`, `LockVault`, `ChangeMasterPassword`, `EnableBiometric`, `RotateDataKey`, `CreateCredential`, `DeleteCredential`, `GenerateSshKey`, `ImportSshKey`, `ExportPublicKey`, `ExportPrivateKey` (guarded), `RenameKey`, `DeleteKey`, `AddPassphrase`, `BackupVault`, `RestoreVault`.
- Queries: `VaultStatus`, `ListCredentials` (metadata only), `ListSshKeys`, `GetKeyFingerprint`, `GetPublicKey`.

### 2.3 `sessions/`
- Commands: `OpenSession`, `CloseSession`, `OpenPane`, `ClosePane`, `ResizePane`, `WriteToPane`, `RunCommand`, `StartRecording`, `StopRecording`, `ExportSessionLog`, `SaveSessionLayout`.
- Queries: `ListSessions`, `GetSessionLayout`, `SearchCommandHistory`, `ListRecordings`.

### 2.4 `transfers/`
- Commands: `EnqueueUpload`, `EnqueueDownload`, `EnqueueSync`, `PauseTransfer`, `ResumeTransfer`, `CancelTransfer`, `RetryItem`, `Chmod`, `Chown`, `Rename`, `MoveEntry`, `CopyEntry`, `DeleteEntry`, `MakeDir`, `AddBookmark`.
- Queries: `ListDir`, `StatEntry`, `PreviewFile` (text/image/archive/video meta), `ListTransfers`, `GetTransferProgress`, `CompareFolders`, `ListBookmarks`.

### 2.5 `monitoring/`
- Commands: `StartMonitoring`, `StopMonitoring`, `KillProcess`, `ControlService` (start/stop/restart systemd unit).
- Queries: `GetSnapshot`, `GetSeries`, `ListProcesses`, `ListServices`, `ListDisks`, `GetSystemInfo` (kernel, distro, uptime), `ListUpdates`.

### 2.6 `containers/`
- Commands (Docker): `ContainerStart/Stop/Restart/Remove`, `ExecInContainer`, `PullImage`, `RemoveImage`, `PruneImages`, `ComposeUp/Down/Restart`, `CreateNetwork`, `RemoveVolume`.
- Queries (Docker): `ListContainers`, `ListImages`, `ListVolumes`, `ListNetworks`, `ContainerLogs` (stream), `ContainerStats` (stream), `InspectContainer`.
- K8s (feature‑gated): `ListPods`, `PodLogs`, `ExecInPod`, `ApplyManifest`, `DeleteResource`, `ListContexts`.

### 2.7 `datastores/`
- Commands: `CreateDbConnection`, `UpdateDbConnection`, `DeleteDbConnection`, `RunQuery`, `SaveQuery`, `DeleteSavedQuery`, `ExportResult` (csv/json).
- Queries: `ListDbConnections`, `TestDbConnection`, `IntrospectSchema` (tables/columns/indexes), `ListSavedQueries`, `GetQueryHistory`, `RedisScan`, `MongoFind`.

### 2.8 `knowledge/`
- Commands: `CreateSnippet`, `UpdateSnippet`, `DeleteSnippet`, `RunSnippet` (send to pane), `CreateNote`, `UpdateNote`, `DeleteNote`, `CreateTemplate`, `RenderTemplate`.
- Queries: `ListSnippets`, `SearchSnippets`, `ListNotes`, `SearchNotes`, `ListTemplates`, `GlobalSearch` (federated FTS).

### 2.9 `ai/`
- Commands: `CreateAiProvider`, `SendAiMessage` (streams), `ExplainCommand`, `GenerateCommand`, `AnalyzeLogs`, `ExplainError`, `OptimizeSshConfig`, `GenerateConfig` (nginx/apache/compose), `GenerateSql`, `TranslateOutput`.
- Queries: `ListAiProviders`, `ListConversations`, `GetConversation`.

### 2.10 `sync/`
- Commands: `EnableSync`, `DisableSync`, `PairDevice`, `UnpairDevice`, `PushChanges`, `PullChanges`, `ResolveConflict`, `RestoreVersion`.
- Queries: `SyncStatus`, `ListDevices`, `ListVersions`.

### 2.11 `plugins/`
- Commands: `InstallPlugin`, `UninstallPlugin`, `EnablePlugin`, `DisablePlugin`, `GrantPermission`, `RevokePermission`, `InvokePlugin`.
- Queries: `ListPlugins`, `SearchMarketplace`, `GetPluginManifest`.

### 2.12 `mod` cross-cutting
- `dto.rs` shared DTOs; `mapper.rs` domain↔DTO; `result.rs` (`AppResult`, `ApplicationError`); `bus.rs` (event publisher trait so app layer can emit progress without knowing Tauri).

## 3. `infrastructure` crate (adapters; depends on `domain`, `application` ports)

Deps: `sqlx`, `russh`, `russh-keys`, `russh-sftp`, `tokio`, `ring`/RustCrypto, `argon2`,
`keyring`, `bollard`, `kube`, `redis`, `mongodb`, `reqwest`, `wasmtime`, `zeroize`, `secrecy`, `tracing`.

### 3.1 `persistence/`
- `pool.rs` — SQLCipher‑keyed SQLx pool builder; PRAGMA setup (WAL, foreign_keys, key).
- `migrations.rs` — run embedded migrations.
- `repositories/*.rs` — one file per repository trait; row structs + mappers.
- `projections/*.rs` — denormalized read models (host tree, dashboard) for CQRS queries.
- `search.rs` — FTS5 query builder for `GlobalSearch`.

### 3.2 `ssh/`
- `connection_manager.rs` — `ConnectionManager`: `HashMap<HostId, Arc<Connection>>`, connect/reuse, ref‑count, teardown.
- `connection.rs` — the **actor** owning one russh session; `mpsc` command inbox; keep‑alive; multiplexing channels.
- `auth.rs` — password, publickey, keyboard‑interactive, agent, FIDO2/`sk-*` (+ system‑ssh fallback path).
- `pty.rs` — interactive shell channel ↔ terminal bytes; resize; bracketed paste.
- `sftp.rs` — `SftpClient` adapter (list/stat/read/write/rename/chmod/chown/mkdir/remove) with streaming + resume.
- `tunnels.rs` — local/remote/dynamic (SOCKS) forwarders.
- `jump.rs` — ProxyJump chaining (nested channels), proxy (SOCKS/HTTP) dialer.
- `known_hosts.rs` — verify/trust fingerprints against `KnownHostsStore`.
- `agent.rs` — SSH agent client (unix socket / Pageant / Windows OpenSSH agent).

### 3.3 `crypto/`
- `kdf.rs` — Argon2id wrapper (`Kdf` port).
- `aead.rs` — AES‑256‑GCM / XChaCha20‑Poly1305 (`Aead` port), envelope format (version, nonce, aad).
- `secret_store.rs` — `SecretStore` combining KDF+AEAD; encrypts credentials/keys.
- `keygen.rs` — Ed25519/RSA/ECDSA generation (`KeyGenerator` port); OpenSSH import/export parsing.
- `keychain.rs` — `keyring` adapter (`OsKeychain` port) for wrapped data key / biometric.
- `secure_mem.rs` — `Zeroizing`/`Secret<T>` helpers; guarded buffers.
- `hardware.rs` — FIDO2/YubiKey integration (`HardwareKey` port).

### 3.4 `monitoring/`
- `collector.rs` — `MetricsCollector` adapter: runs lightweight probes over an `exec` channel
  (prefer reading `/proc`, `df`, `ss`, `systemctl`, falling back per‑distro), parses to `HostSnapshot`.
- `scheduler.rs` — per‑host sampling loop (interval, backoff), pushes to `SeriesRepository` + events.
- `parsers/*.rs` — parse `/proc/stat`, `/proc/meminfo`, `df -PB1`, `ss -s`, `systemctl`, `uptime`, `os-release`.

### 3.5 `docker/` & `kubernetes/`
- `docker.rs` — `bollard` over a **forwarded** docker socket (via the SSH connection's tunnel); streams logs/stats.
- `compose.rs` — parse/apply compose files (invoke `docker compose` via exec, capture output).
- `kube.rs` — `kube` client over a forwarded API port (feature `kubernetes`).

### 3.6 `databases/`
- `sql.rs` — `SqlClient` for MySQL/MariaDB/Postgres/SQLite via SQLx; schema introspection; safe param queries; streaming large results.
- `redis.rs`, `mongo.rs` — respective clients; all can run through an SSH **local tunnel** to reach private DBs.
- `tunnel_binder.rs` — opens a `local` forward for a `db_connection` when `tunnel_json` is set.

### 3.7 `ai/`
- `providers/openai.rs`, `anthropic.rs`, `ollama.rs`, `custom.rs` — implement `AiProviderClient` (SSE streaming).
- `context.rs` — builds context (active host, last command, selected log) with **redaction** before sending.
- `prompts.rs` — system prompts per task (explain/generate/analyze/config gen).

### 3.8 `sync/`
- `transport.rs` — HTTPS client to the sync relay; auth via device key.
- `envelope.rs` — E2E encryption of change‑sets (per‑item AEAD under the sync root key; server sees only ciphertext).
- `merge.rs` — vector‑clock conflict detection + resolution strategies.

### 3.9 `plugins/`
- `host.rs` — `PluginHost`: load manifests, instantiate Wasmtime store per plugin, capability‑gate host fns.
- `capabilities.rs` — enforce `Permission` grants; deny by default.
- `bridge.rs` — host functions exposed to WASM (scoped: `hosts.read`, `net.connect`, `ui.notify`, …).

## 4. `app` crate (`src-tauri/src`, interface + composition root)

Deps: `tauri`, `application`, `infrastructure`, `domain`, `tokio`, `serde`, `tracing`.

- `main.rs` — thin entry calling `lib::run()`.
- `lib.rs` — build Tokio runtime, load config, build `AppContainer` (DI), register plugins
  (opener, updater, single‑instance, deep‑link, os, dialog, tray), set managed state, generate handler.
- `container.rs` — `AppContainer` construction (wires infra adapters into application use cases).
- `events.rs` — typed `EventBus` (`emit<T: Serialize + TS>(topic, payload)`); topics enum.
- `error.rs` — `AppError` (see doc 07) + `From` conversions from domain/application/infra errors, with redaction.
- `commands/*.rs` — one module per context; each `#[tauri::command] async fn` resolves deps from
  `State<AppContainer>`, calls the matching use case, maps errors to `AppError`. See doc 07 for the full list.

## 5. Cross-cutting concerns

- **Logging:** `tracing` with a redaction layer; log files rotate; **never** log secrets/tokens/keys.
- **Config:** typed `Config` struct loaded from `settings` table + env overrides; hot‑reloadable where safe.
- **Cancellation:** every long op takes a `CancellationToken`; UI can cancel transfers/queries.
- **Backpressure:** streaming events (terminal/metrics/logs) coalesce/throttle to protect the webview.
- **Testing:** domain = pure unit tests; application = tests with mock ports; infrastructure = integration
  tests against a Dockerized OpenSSH server + a temp SQLite DB (see doc 24).

## 6. Acceptance checklist per crate (definition of done)

- Compiles with `#![deny(warnings)]`, `cargo clippy -- -D warnings` clean, `rustfmt` clean.
- Public items documented (`#![warn(missing_docs)]` on `domain`/`application`).
- Every port has ≥1 adapter and ≥1 mock; every use case has tests.
- No `unwrap`/`expect`/`panic!` in non‑test code paths that touch remote/user input.
