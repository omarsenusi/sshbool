# 99 — Glossary & Conventions

## 1. Glossary

| Term | Meaning |
|---|---|
| **Host** | A saved server/connection profile (`hosts` table) — hostname, port, auth, org metadata |
| **Identity** | A reusable username + key/credential pairing, attachable to multiple hosts |
| **Vault** | The encrypted store for credentials/keys, unlocked by the master password/biometric |
| **DEK / KEK** | Data Encryption Key / Key Encryption Key — see key hierarchy, doc 22 §3 |
| **Session** | A live or historical connected instance of a host (`sessions` table) |
| **Pane** | A single terminal/SFTP/editor/dashboard surface within a session (`session_panes`) |
| **Connection actor** | The Rust task owning one host's authenticated SSH socket (doc 01 §7–8) |
| **Multiplexing / connection sharing** | Reusing one SSH connection for terminal+SFTP+metrics+docker |
| **Port** | A Domain-defined trait for an external capability (e.g. `HostRepository`) implemented by an Infrastructure adapter |
| **Bounded context** | A DDD subdomain boundary (e.g. Connections, Vault, Sessions) with its own aggregates and ubiquitous language (doc 01 §3) |
| **Use case** | An Application-layer command or query (CQRS) orchestrating domain + ports |
| **DTO** | Data Transfer Object — the serializable shape crossing the Rust↔TS IPC boundary |
| **AppError** | The discriminated-union error type returned by every Tauri command (doc 07 §2) |
| **Capability (plugin)** | A permission string gating a plugin's access to a host function (doc 21 §3) |
| **ChangeSet** | An encrypted, versioned unit of sync data (doc `features/19-sync-backup.md`) |
| **Ring buffer (metrics)** | A capped, oldest-evicted-first storage pattern used for `metric_series` |

## 2. Naming conventions

- **Rust**: `snake_case` for functions/modules/files, `PascalCase` for types/traits, crate names
  `kebab-case`. Tauri commands are `snake_case` and namespaced by context (`hosts_create`, not
  `createHost`) — see doc 07 §1.
- **TypeScript**: `camelCase` for variables/functions, `PascalCase` for components/types,
  `kebab-case` for file names except component files which match their exported component
  (`HostTree.tsx`). Generated DTOs mirror Rust field names exactly via `ts-rs`, so DTOs use
  `camelCase` (the TS convention) while the underlying Rust struct fields are `snake_case` and
  `serde(rename_all = "camelCase")` bridges the two — one direction of truth, no manual re-mapping.
- **Database**: `snake_case` tables/columns, plural table names (`hosts`, not `host`), singular
  FKs (`host_id`). IDs are UUIDv7 stored as `TEXT` (doc 04 §1).
- **Events**: `context://verb/{id}` topic format (e.g. `terminal://data/{paneId}`, doc 07 §3).
- **Files/docs**: this `docs/` folder uses `NN-kebab-title.md` for cross-cutting docs (two-digit
  ordering) and `docs/features/NN-kebab-title.md` for feature specs, so reading order matches
  filename order in a directory listing.

## 3. Coding standards summary (see doc 24 for enforcement)

- Strong typing everywhere: Rust has no `dyn Any`/stringly-typed escape hatches in domain/application;
  TS runs `strict: true` with no `any` (lint-enforced).
- Zero warnings, zero lint errors gate every merge (`cargo clippy -D warnings`, ESLint zero-warning).
- No `unwrap`/`expect`/`panic!` in non-test Rust code paths touching remote/user input — use `?`
  and typed errors (doc 05 §6).
- Every port has at least one real adapter and one mock/test double; every use case has tests.
- No secrets in logs, error messages, recordings, or AI context — enforced via redaction layers
  reviewed in doc 22.
- Comments explain **why**, not **what** — no narrating obvious code (this rule applies to the
  eventual implementation, not just these planning docs).

## 4. Document conventions used in this docs/ set

- Each feature doc (`docs/features/*.md`) follows the same skeleton: **Scope checklist** (verbatim
  items from the original brief, so nothing is silently dropped) → **backend/frontend mapping** →
  **sub-design sections** → **Commands & events** (cross-referencing doc 07) → **Acceptance
  criteria** (testable, becomes the seed for doc 24's integration/E2E test names).
- Cross-references use markdown links to the specific doc and, where useful, a `§section` pointer
  (e.g. "doc 01 §7") so a reader can jump straight to the referenced decision rather than searching.
- ASCII wireframes (doc 09) are layout blueprints, not pixel specs — visual language/tokens live in
  doc 08 and take precedence for anything the wireframes don't dictate (spacing, color, motion).

## 5. Abbreviations

`ADR` Architecture Decision Record · `DDD` Domain-Driven Design · `CQRS` Command Query
Responsibility Segregation · `DI` Dependency Injection · `KDF` Key Derivation Function · `AEAD`
Authenticated Encryption with Associated Data · `PTY` Pseudo-Terminal · `FTS` Full-Text Search ·
`E2E` (context-dependent) End-to-End (encryption) or End-to-End (testing) — doc 22 uses it for
encryption, doc 24 for testing; disambiguated by section when both appear near each other.
