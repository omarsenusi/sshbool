# 01 — Architecture

## 1. High-level shape

SSHBool is a **Tauri v2** app: a native Rust core (the process that owns all privileged work —
sockets, crypto, DB, filesystem) and a **React** webview UI. They communicate through Tauri's
IPC: **commands** (request/response) and **events** (server→client streams).

```
┌──────────────────────────────────────────────────────────────────────┐
│                          Webview (React SPA)                           │
│  Presentation → Application (hooks/queries/stores) → IPC client        │
└───────────────▲───────────────────────────────────────┬──────────────┘
                │ events (metrics, terminal data, xfer)  │ commands (typed)
                │                                         ▼
┌───────────────┴───────────────────────────────────────────────────────┐
│                        Rust Core (Tokio runtime)                        │
│  Interface (tauri cmds)                                                 │
│      │                                                                  │
│  Application (use-cases, CQRS handlers, DI container)                   │
│      │                                                                  │
│  Domain (entities, value objects, domain services, ports/traits)       │
│      │                                                                  │
│  Infrastructure (SSH, SFTP, crypto, SQLite/SQLx, keychain, docker,      │
│                  db drivers, ai providers, sync, plugin host)           │
└─────────────────────────────────────────────────────────────────────────┘
```

## 2. Clean Architecture layers (dependency rule)

Dependencies point **inward only**. Domain knows nothing about Tauri, SQLx, or SSH crates.

| Layer | Responsibility | May depend on | Rust location |
|---|---|---|---|
| **Domain** | Entities, value objects, invariants, port traits, domain errors | nothing (std + `thiserror`) | `crates/domain` |
| **Application** | Use cases (commands/queries), orchestration, DTO mapping, transactions | Domain | `crates/application` |
| **Infrastructure** | Concrete adapters implementing domain ports (SSH, DB, crypto, OS keychain) | Domain, Application (ports only) | `crates/infrastructure` |
| **Interface** | Tauri command handlers, event emitters, DI wiring | Application, Domain | `crates/app` (`src-tauri`) |

**Ports & adapters (hexagonal):** the Domain declares traits (ports) like `HostRepository`,
`SshTransport`, `SecretStore`, `MetricsCollector`. Infrastructure provides adapters. Application
depends only on the traits. This makes every external system swappable and mockable in tests.

## 3. Domain-Driven Design — bounded contexts

Each context maps to a domain module and (usually) an application module + a UI feature.

| Bounded context | Aggregate roots | Notes |
|---|---|---|
| **Connections** | `Host`, `Group`, `Identity` | Servers, folders/groups, tags, favorites, jump hosts |
| **Vault / Secrets** | `Vault`, `Credential`, `SshKey` | Master password, encryption, key manager |
| **Sessions** | `Session`, `TerminalPane`, `Recording` | Live SSH/PTY sessions, splits, recordings |
| **Transfers** | `TransferJob`, `TransferItem` | SFTP queue, resume, sync |
| **Monitoring** | `HostSnapshot`, `MetricSeries` | Dashboard metrics |
| **Containers** | `Container`, `Image`, `Compose`, `K8sResource` | Docker/K8s |
| **DataStores** | `DbConnection`, `Query`, `ResultSet` | DB clients |
| **Knowledge** | `Snippet`, `Note`, `Template` | Productivity |
| **AI** | `AiConversation`, `AiRequest` | Copilot |
| **Sync** | `SyncState`, `DeviceKey`, `ChangeSet` | E2E sync |
| **Plugins** | `Plugin`, `PluginManifest`, `Permission` | Plugin host |

Contexts communicate through **application services**, never by reaching into each other's
repositories. Cross‑context needs are expressed as explicit use cases.

## 4. CQRS (where appropriate)

We apply CQRS **selectively**, not dogmatically:

- **Commands** = state‑changing use cases (`CreateHost`, `StartSession`, `EnqueueUpload`,
  `RotateVaultKey`). They return only IDs/acks.
- **Queries** = read models optimized for the UI (`ListHostsTree`, `GetDashboardSnapshot`).
  Queries may bypass aggregates and read denormalized projections directly for speed.
- **High‑churn read models** (metrics, transfer progress, terminal output) are **not** modeled as
  commands/queries at all — they are **event streams** pushed over Tauri events for latency.

Rationale: full event‑sourcing would add cost with little benefit for a desktop app; targeted CQRS
gives us fast reads (denormalized projections/materialized views in SQLite) and clean writes.

## 5. Dependency Injection

A single **composition root** in `crates/app` builds the DI container at startup:

- Reads config, opens the encrypted SQLite pool (SQLx), initializes the OS keychain adapter,
  the crypto service, the SSH connection manager, the plugin host, etc.
- Wires concrete infrastructure adapters into application services behind domain traits.
- Stored in Tauri's managed state (`tauri::State<AppContainer>`), so every command resolves its
  dependencies via the container. This is constructor injection with a manual container (no macro
  magic) for compile‑time clarity and zero runtime reflection.

```rust
// sketch — see doc 05 for the full module
pub struct AppContainer {
    pub hosts: Arc<dyn HostRepository>,
    pub vault: Arc<VaultService>,
    pub sessions: Arc<SessionManager>,
    pub transfers: Arc<TransferService>,
    pub metrics: Arc<MetricsService>,
    pub docker: Arc<DockerService>,
    pub db: Arc<DbClientService>,
    pub ai: Arc<AiService>,
    pub sync: Arc<SyncService>,
    pub plugins: Arc<PluginHost>,
    pub events: EventBus, // typed emitter over tauri AppHandle
}
```

## 6. Repository pattern

Every aggregate has a repository trait in Domain and a SQLx adapter in Infrastructure:

```rust
#[async_trait]
pub trait HostRepository: Send + Sync {
    async fn create(&self, host: NewHost) -> DomainResult<HostId>;
    async fn get(&self, id: HostId) -> DomainResult<Option<Host>>;
    async fn list_tree(&self) -> DomainResult<Vec<HostTreeNode>>;
    async fn update(&self, host: Host) -> DomainResult<()>;
    async fn delete(&self, id: HostId) -> DomainResult<()>;
}
```

Repositories return **domain types**, never raw rows. Row↔domain mapping lives in Infrastructure.

## 7. The multiplexed transport model (key architectural bet)

Each connected `Host` owns **one authenticated SSH connection** in the Rust core. That connection
is **multiplexed** to serve everything:

- Terminal panes → interactive shell channels / PTYs.
- SFTP → an SFTP subsystem channel.
- Dashboard metrics → periodic `exec` channels running lightweight collectors.
- Docker → `exec` of the docker CLI (or the docker socket forwarded over the channel).
- Port forwards / tunnels → direct‑tcpip / forwarded‑tcpip channels.

Benefits: one auth prompt, connection sharing (ControlMaster‑like), fewer handshakes, lower memory.
Implemented by a `ConnectionManager` holding `Arc<Mutex<Connection>>` keyed by `HostId`, with a
channel pool and keep‑alive. See doc 10.

## 8. Concurrency model

- The Rust core runs a **multi‑threaded Tokio runtime**.
- Each live SSH connection has a dedicated **driver task** that owns the socket and dispatches
  channel I/O; other tasks talk to it via `mpsc`/`oneshot` channels (actor pattern). This avoids
  shared‑lock contention on the socket.
- CPU‑heavy work (key generation, argon2 KDF, compression) runs on `tokio::task::spawn_blocking`
  or `rayon`, never on async worker threads.
- The UI never blocks: commands are `async`, and streaming data uses events.

## 9. Plugin system (overview; full spec in doc 21)

- Plugins are **sandboxed** and declare **capabilities/permissions** in a manifest.
- Two extension surfaces: **UI plugins** (React micro‑frontends / widgets loaded in an isolated
  iframe with a constrained bridge) and **logic plugins** (WASM modules run in a Wasmtime sandbox
  in the Rust core with capability‑gated host functions).
- The plugin host mediates all access; a plugin can only touch what its granted permissions allow.

## 10. Offline-first & data ownership

- The **encrypted SQLite database is the source of truth**, on the local device.
- Sync is an **optional** overlay that ships encrypted change‑sets to a relay the server can't read.
- No feature (except sync/AI/marketplace, which are inherently networked) requires internet.

## 11. Error handling strategy

- Domain defines rich, typed errors (`thiserror`). Application maps them to `AppError` (doc 07).
- All Tauri commands return `Result<T, AppError>`; the frontend gets a discriminated union so the
  UI can render precise, localized messages (never a raw string dump).
- Panics in tasks are caught and converted to errors; the app never crashes on a remote failure.

## 12. Key Architectural Decision Records (summary; details in doc 03)

- **ADR‑001**: Tauri v2 over Electron — performance, memory, native.
- **ADR‑002**: **Frontend framework** — migrate current Next.js scaffold to **Vite SPA** (see doc 03 §2).
- **ADR‑003**: SSH implementation — `russh` (pure‑Rust) as primary; rationale & fallback in doc 03.
- **ADR‑004**: SQLite + SQLx with SQLCipher for at‑rest encryption.
- **ADR‑005**: State management — Zustand for client state, React Query for server/IPC cache.
- **ADR‑006**: Cargo **workspace with multiple crates** to enforce the dependency rule at compile time.
