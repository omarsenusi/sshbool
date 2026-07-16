# 02 — Complete Folder Structure

This is the target layout **after** the Vite migration (ADR‑002) and the crate split (ADR‑006).
Files that already exist in the scaffold are marked ✅; everything else is to be created.

## 1. Repository root

```
sshbool/
├─ docs/                         # ← this planning set (source of truth)
├─ src/                          # React (Vite) frontend
├─ src-tauri/                    # Tauri app + Rust workspace
├─ e2e/                          # Playwright end-to-end tests
├─ .storybook/                   # Storybook config
├─ .github/workflows/            # CI/CD pipelines
├─ scripts/                      # dev/release scripts (icons, signing, migrations)
├─ index.html                    # Vite entry (replaces app/ router)
├─ vite.config.ts
├─ tailwind.config.ts            # (Tailwind v4 mostly config-less; tokens in CSS)
├─ postcss.config.mjs            ✅
├─ components.json               ✅ (update rsc:false, css path)
├─ tsconfig.json                 ✅
├─ package.json                  ✅ (rework scripts/deps)
├─ eslint.config.mjs             ✅
├─ .prettierrc / .prettierignore ✅
├─ AGENTS.md                     ✅
└─ README.md                     ✅
```

> Removed during migration: `next.config.ts`, `next-env.d.ts`, `.next/`, `app/` (contents moved to `src/`).

## 2. Frontend (`src/`)

Organized **feature-first** (screaming architecture) with shared primitives underneath.

```
src/
├─ main.tsx                      # React root, providers, router mount
├─ App.tsx                       # Shell layout + routes
├─ routes/                       # Route definitions (tanstack-router)
│  ├─ index.tsx                  # Home / connect
│  ├─ workspace.$hostId.tsx      # Connected workspace (terminal/sftp/…)
│  └─ settings.$section.tsx
├─ app/                          # App-wide wiring
│  ├─ providers/                 # ThemeProvider, QueryProvider, I18nProvider, TooltipProvider
│  ├─ router.ts
│  ├─ query-client.ts
│  └─ keybindings/               # global shortcut registry
├─ features/                     # one folder per bounded context (UI side)
│  ├─ connections/               # host manager, quick connect, groups/tags
│  │  ├─ components/
│  │  ├─ hooks/                  # useHosts, useHostTree (React Query)
│  │  ├─ store.ts                # zustand slice (selection, filters)
│  │  └─ api.ts                  # typed ipc wrappers -> Rust commands
│  ├─ vault/                     # master password, unlock, key manager UI
│  ├─ terminal/                  # xterm wrapper, tabs, splits, recording
│  ├─ sftp/                      # dual-pane, transfer queue, preview
│  ├─ editor/                    # monaco, diff viewer
│  ├─ dashboard/                 # monitoring widgets
│  ├─ containers/                # docker + k8s panels
│  ├─ databases/                 # db clients
│  ├─ devtools/                  # git/package managers/runtimes
│  ├─ ai/                        # copilot panel
│  ├─ productivity/             # snippets, notes, palette
│  ├─ sync/                      # sync settings, history
│  └─ plugins/                   # marketplace, plugin host bridge
├─ components/                   # shared, non-feature UI
│  ├─ ui/                        # shadcn primitives (button.tsx ✅, …)
│  ├─ layout/                    # AppShell, Sidebar, TitleBar, StatusBar, TabBar
│  ├─ command-palette/
│  ├─ data/                      # VirtualList, DataTable, TreeView
│  └─ feedback/                  # Toast, EmptyState, ErrorBoundary
├─ hooks/                        # shared hooks (useEvent, useIpc, useHotkey) (dir exists ✅)
├─ lib/                          # utils (utils.ts ✅), ipc client, zod schemas, formatters
│  ├─ ipc/                       # generated command/event typings + invoke wrappers
│  ├─ schemas/                   # zod DTOs (mirror Rust)
│  └─ theme-provider.tsx         # (theme-provider.tsx exists ✅ under components/)
├─ stores/                       # cross-feature zustand stores (layout, session, palette)
├─ styles/
│  └─ globals.css                # tokens/vars (moved from app/globals.css ✅)
├─ i18n/                         # locale resources
└─ types/                        # global TS types, ambient decls
```

## 3. Backend (`src-tauri/`)

```
src-tauri/
├─ Cargo.toml                    ✅ (becomes the workspace root manifest)
├─ tauri.conf.json               ✅ (update product name, dist, updater, capabilities)
├─ build.rs                      ✅
├─ capabilities/
│  └─ default.json               ✅ (tighten permissions; see doc 22)
├─ icons/                        ✅
├─ migrations/                   # SQLx migrations (see doc 04)
│  ├─ 0001_init.sql
│  ├─ 0002_vault.sql
│  └─ …
├─ src/                          # the `app` crate (interface layer + composition root)
│  ├─ main.rs                    ✅ (thin: calls lib run())
│  ├─ lib.rs                     ✅ (builder, DI wiring, plugin registration)
│  ├─ container.rs               # AppContainer (DI)
│  ├─ events.rs                  # typed EventBus over AppHandle
│  ├─ error.rs                   # AppError <- domain/app errors (doc 07)
│  └─ commands/                  # tauri command modules (one file per context)
│     ├─ connections.rs
│     ├─ vault.rs
│     ├─ sessions.rs
│     ├─ transfers.rs
│     ├─ monitoring.rs
│     ├─ containers.rs
│     ├─ databases.rs
│     ├─ devtools.rs
│     ├─ ai.rs
│     ├─ productivity.rs
│     ├─ sync.rs
│     ├─ plugins.rs
│     └─ mod.rs
└─ crates/                       # the workspace member crates (Clean Arch layers)
   ├─ domain/                    # pure domain (no tauri/sqlx/russh)
   │  └─ src/
   │     ├─ lib.rs
   │     ├─ shared/              # ids, value objects, DomainError, pagination
   │     ├─ connections/         # Host, Group, Identity, ports
   │     ├─ vault/               # Vault, Credential, SshKey, ports
   │     ├─ sessions/
   │     ├─ transfers/
   │     ├─ monitoring/
   │     ├─ containers/
   │     ├─ datastores/
   │     ├─ knowledge/
   │     ├─ ai/
   │     ├─ sync/
   │     └─ plugins/
   ├─ application/               # use cases (commands/queries), DTOs, port usage
   │  └─ src/
   │     ├─ lib.rs
   │     ├─ <context>/commands/  # e.g. create_host.rs
   │     ├─ <context>/queries/
   │     └─ <context>/dto.rs
   └─ infrastructure/            # adapters implementing domain ports
      └─ src/
         ├─ lib.rs
         ├─ persistence/         # SQLx repos, migrations runner, projections
         ├─ ssh/                 # russh connection manager, channels, sftp
         ├─ crypto/              # kdf, aead, keygen, secure memory
         ├─ keychain/            # OS secret service adapter
         ├─ monitoring/          # metric collectors (remote command probes)
         ├─ docker/              # bollard adapter
         ├─ kubernetes/          # kube adapter (feature-gated)
         ├─ databases/           # mysql/pg/redis/mongo/sqlite adapters
         ├─ ai/                  # provider clients (openai/anthropic/local)
         ├─ sync/                # e2e sync client + crypto envelope
         └─ plugins/             # wasmtime host, manifest, capabilities
```

## 4. Cross-cutting folders

```
.github/workflows/   ci.yml, release.yml, security.yml
.storybook/          main.ts, preview.tsx
e2e/                 *.spec.ts (Playwright + tauri-driver)
scripts/             gen-icons, sign-macos, sign-windows, gen-ipc-types, run-migrations
```

## 5. IPC type generation

To keep Rust and TS DTOs in sync we generate TS types from Rust using **`ts-rs`** (derive
`#[derive(TS)]` on DTOs). A `scripts/gen-ipc-types` step exports them into `src/lib/ipc/types.ts`,
and matching **zod** schemas live in `src/lib/schemas/`. This is enforced in CI (drift = failure).
See doc 07.
