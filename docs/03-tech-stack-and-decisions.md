# 03 — Tech Stack & Architecture Decision Records (ADRs)

## 1. Locked stack

### Desktop shell
- **Tauri v2** (Rust host + webview). Auto‑updater, single‑instance, deep‑link, tray plugins.

### Rust core
- **Tokio** (async runtime), **Rayon** (CPU parallelism).
- **russh** + **russh-keys** / **russh-sftp** — SSH2 transport, auth, SFTP.
- **SQLx** (compile‑checked queries) + **SQLite** with **SQLCipher** (at‑rest encryption).
- **ring** / **RustCrypto** (`aes-gcm`, `chacha20poly1305`, `argon2`, `ed25519-dalek`, `x25519-dalek`) — crypto.
- **keyring** — OS secret service (Windows Credential Manager / macOS Keychain / libsecret).
- **serde** / **serde_json** / **serde_yaml** — (de)serialization for DTOs, import/export.
- **thiserror** / **anyhow** — errors (thiserror in libs, anyhow only at the very edge/bin).
- **tracing** + **tracing-subscriber** — structured logging (redacting secrets).
- **bollard** — Docker Engine API client (over forwarded socket).
- **kube** — Kubernetes client (optional, gated behind feature flag).
- DB drivers: **sqlx** (MySQL/MariaDB/Postgres/SQLite), **redis**, **mongodb**.
- **zeroize** / **secrecy** — secure memory for secrets.
- **wasmtime** — plugin sandbox (logic plugins).

### Frontend
- **React 19** + **TypeScript 5** (`strict`).
- **Vite** (see ADR‑002) as the dev server & bundler.
- **TailwindCSS v4** + **shadcn/ui** (already scaffolded, style `base-nova`).
- **Zustand** — client/UI state; **@tanstack/react-query** — IPC/server cache.
- **xterm.js** (+ addons: fit, webgl/canvas, search, weblinks, unicode11, serialize) — terminal.
- **@monaco-editor/react** — remote editor & diff viewer.
- **@tanstack/react-virtual** — virtualized lists (file lists, process lists, logs).
- **dnd-kit** — drag & drop (SFTP, layout).
- **framer-motion** — motion (respecting reduced‑motion).
- **lucide-react** — icons (already present).
- **zod** — runtime validation of IPC payloads at the boundary.
- **i18next** — localization (RTL‑ready; the shadcn config exposes `rtl`).

### Tooling / quality
- **Storybook** (component workshop), **Vitest** + **Testing Library** (unit/component),
  **Playwright** (E2E via `tauri-driver`/WebDriver), **cargo nextest** + **cargo test** (Rust),
  **clippy** + **rustfmt**, **ESLint** + **Prettier**, **GitHub Actions** CI.

---

## 2. ADR‑002 — Frontend framework: **migrate Next.js → Vite** (IMPORTANT DECISION)

**Context.** The brief lists **Vite**. The current repo was scaffolded with **Next.js 16** (RSC,
app router, `next dev`). `AGENTS.md` warns Next.js has breaking changes vs training data.

**Problem with keeping Next.js for a Tauri desktop app.**
- Tauri serves a **static frontend**; it does not run a Node server. Next.js would need
  `output: 'export'`, which **disables** RSC/server actions/route handlers/ISR — i.e., most of what
  Next.js 16 is for. You keep the complexity and lose the value.
- The Next.js runtime, router, and RSC hydration add cold‑start cost and bundle weight that hurt
  the "performance first" pillar.
- The brief explicitly specifies Vite.

**Decision.** **Use Vite + React SPA.** Migrate the existing scaffold:
1. Add `vite`, `@vitejs/plugin-react`, keep React 19 + TS + Tailwind v4 + shadcn.
2. Replace `app/layout.tsx` + `app/page.tsx` (Next app router) with `index.html` + `src/main.tsx` + `src/App.tsx` and a client router (**@tanstack/react-router** or **react-router**).
3. Move `app/globals.css` → `src/styles/globals.css`; keep `components/ui` and `lib/utils` (shadcn works with Vite; update `components.json` `rsc: false`, `tailwind.css` path).
4. Update `tauri.conf.json`: `beforeDevCommand: "bun run dev"` (Vite on 1420), `devUrl: http://localhost:1420`, `frontendDist: "../dist"` (Vite default) instead of `../out`.
5. Update `package.json` scripts: `dev: "vite"`, `build: "tsc && vite build"`, `preview: "vite preview"`.

**Alternative (documented, not chosen).** Next.js static export (`output: 'export'`,
`images.unoptimized`). Rejected: pays Next.js overhead for none of its benefits in a static Tauri context.

**Consequences.** Simpler mental model, faster HMR and cold start, smaller bundle, matches the
brief. The migration is mechanical and low‑risk because almost no Next‑specific code exists yet
(only the default scaffold). **This migration is the first implementation task (see doc 26, Phase 0).**

> Note: `components.json` currently has `"rsc": true` and `"tailwind.css": "app/globals.css"`.
> Both change during migration (`rsc: false`, css path under `src/`). Everything else in
> `components.json` (`baseColor: "neutral"`, `cssVariables: true`, `style: "base-nova"`) stays as
> the single canonical theming config — see doc 08 §0 for the non‑negotiable "one tokens file, no
> per‑component overrides" rule this implies for every shadcn component added afterward.

---

## 3. ADR‑003 — SSH library: **russh** (pure Rust)

**Options:** (a) `russh` pure‑Rust; (b) bind `libssh2` via `ssh2` crate; (c) shell out to system `ssh`.

**Decision: `russh` + `russh-keys` + `russh-sftp`.**
- Pure Rust → easy cross‑compilation, no C toolchain/OpenSSL headaches on Windows, memory‑safe.
- Async‑native (Tokio) → fits our actor‑per‑connection model and streaming.
- Modern algorithm support (Ed25519, curve25519, chacha20‑poly1305, aes‑gcm).

**FIDO2 / hardware keys & agent.** `russh` supports agent auth; for FIDO2 `sk-*` keys and
YubiKey we integrate via the **SSH agent** (delegating the touch/PIN to the agent), and via
platform libraries where needed. Where a capability is not natively covered, we fall back to the
**system `ssh`/`ssh-agent`** for that specific auth path (documented per‑feature in doc 10).

**Consequences.** One dependency tree, no native build friction, best cross‑platform story.
Edge SSH features not covered by russh are handled by targeted fallbacks, tracked in doc 10.

---

## 4. ADR‑004 — Storage: SQLite + SQLx + SQLCipher

- **SQLite** — embedded, zero‑admin, perfect for offline‑first desktop.
- **SQLx** — async, compile‑time‑checked SQL (`sqlx::query!`), migrations via `sqlx migrate`.
- **SQLCipher** — transparent full‑DB AES‑256 encryption at rest; key derived from the master
  password (Argon2id) and/or a key wrapped in the OS keychain. Details in docs 04 & 22.

**Why not sled/redb/native JSON files?** Relational queries (host tree, tags, history, search),
mature tooling, FTS5 for global search, and battle‑tested encryption tip it decisively to SQLite.

---

## 5. ADR‑005 — Frontend state: Zustand + React Query

- **Zustand** — ephemeral/UI/client state (open tabs, layout, active pane, palette state). Small,
  fast, no boilerplate, works outside React for imperative terminal glue.
- **React Query** — everything that comes from the Rust core via commands (hosts, snippets,
  transfers list, dashboard queries): caching, invalidation, background refetch, optimistic updates.
- **Live streams** (terminal bytes, metrics ticks, transfer progress) use Tauri **event
  subscriptions** feeding Zustand/imperative handlers — not React Query.

---

## 6. ADR‑006 — Cargo workspace (multi-crate)

Enforce Clean Architecture's dependency rule **at compile time** by splitting crates:
`domain`, `application`, `infrastructure`, `app` (the Tauri bin/lib). `domain` literally cannot
import `sqlx` or `tauri` because it doesn't depend on them. See docs 02 & 05.

---

## 7. ADR summary table

| ADR | Decision | Status |
|---|---|---|
| 001 | Tauri v2 (no Electron) | Accepted (given) |
| 002 | Vite SPA (migrate off Next.js) | Accepted |
| 003 | russh (pure Rust) w/ agent + system‑ssh fallbacks | Accepted |
| 004 | SQLite + SQLx + SQLCipher | Accepted |
| 005 | Zustand + React Query + Tauri events | Accepted |
| 006 | Cargo multi‑crate workspace | Accepted |
| 007 | Wasmtime for logic plugins; sandboxed iframe for UI plugins | Accepted (see doc 21) |
| 008 | i18next + RTL support from day one | Accepted |
