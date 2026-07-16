# 24 — Testing & CI/CD

Operationalizes the "Code Quality" section of the brief and doc 05 §5/§6 into a concrete testing
pyramid and pipeline.

## 1. Scope checklist

Strong typing · Zero warnings · Zero lint errors · Unit tests · Integration tests · End-to-end
tests · Documentation · Storybook · CI/CD · GitHub Actions.

## 2. Testing pyramid

```
        ┌───────────────┐
        │   E2E (few)    │  Playwright + tauri-driver — critical user journeys
        ├───────────────┤
        │ Integration    │  Rust: real SQLite + Dockerized OpenSSH server
        │ (moderate)     │  Frontend: component + IPC-mocked flows
        ├───────────────┤
        │  Unit (many)   │  domain (pure), application (mocked ports), React components/hooks
        └───────────────┘
```

## 3. Rust testing

- **Domain crate**: pure unit tests, no I/O — entity invariants (e.g. jump-host cycle detection,
  port range validation), value object parsing/validation. Target near-100% coverage; it's the
  cheapest code in the system to test exhaustively.
- **Application crate**: use-case tests against **mock port implementations** (hand-written or
  `mockall`-generated) — verifies orchestration logic (e.g. "creating a host with a duplicate
  fingerprint returns Conflict") without touching real SSH/DB.
- **Infrastructure crate**: integration tests against real dependencies spun up for CI:
  - A **Dockerized OpenSSH server** fixture (password + key + FIDO2-capable via `openssh-server`
    image variants) for `infrastructure/ssh/*` tests — covers auth methods, jump hosts, tunnels,
    SFTP operations against a real, disposable target.
  - A **temp SQLCipher-encrypted SQLite DB** per test (via `sqlx::test` or a custom fixture) for
    `persistence/*` repository tests — runs real migrations, asserts real queries.
  - Testcontainers-style ephemeral MySQL/Postgres/Redis/MongoDB for `databases/*` adapter tests.
- **Test runner**: `cargo nextest` for fast, isolated parallel execution; `cargo test --doc` for
  doctests on public API documentation examples.
- **Lint gate**: `cargo clippy --workspace --all-targets -- -D warnings` and `cargo fmt --check`
  must pass; `#![deny(warnings)]` enforced at crate level in `domain`/`application`.

## 4. Frontend testing

- **Unit/component**: **Vitest** + **React Testing Library** for hooks (`useHostTree`, `useEvent`,
  `useAutosave`, …) and components in isolation, with the IPC layer mocked at the `invoke`/`listen`
  boundary (a test double implementing the same typed command surface from doc 07).
- **Visual/interaction**: **Storybook** hosts every shared UI component (doc 06 §5) and every
  feature component's key states (default/hover/loading/empty/error, doc 08 §8) as stories;
  Storybook's test runner (`@storybook/test-runner`, Vitest-based) executes interaction tests and
  accessibility checks (`axe` addon) against each story in CI.
- **Type safety**: `tsc --noEmit --strict` gate; zod schema round-trip tests against generated
  `ts-rs` types to catch drift (doc 07 §6) before it reaches runtime.
- **Lint gate**: ESLint (flat config, already present) with zero warnings allowed; Prettier check.

## 5. End-to-end testing

- **Playwright** driving the actual compiled Tauri app via **`tauri-driver`** (WebDriver protocol),
  covering critical journeys top-to-bottom against the real Rust core (not mocked):
  1. First-run onboarding → vault creation → add host → connect → run a command.
  2. SFTP upload/download/resume against a real disposable SSH server.
  3. Remote-edit-and-save round trip.
  4. Vault lock/unlock and auto-lock timeout behavior.
  5. Plugin install/permission-grant/revoke flow.
- E2E runs against the same Dockerized OpenSSH/DB fixtures used by Rust integration tests, so CI
  maintains one shared fixture definition (`docker-compose.test.yml`) rather than duplicating setup.

## 6. Documentation as a quality gate

- `#![warn(missing_docs)]` on `domain`/`application` crates — public items must be documented.
- TSDoc on exported hooks/components consumed outside their own feature folder.
- Each feature doc in `docs/features/` already carries an **acceptance criteria** section (this
  doc set) — those criteria are the source for E2E/integration test case names, keeping planning
  docs and tests traceable to each other.

## 7. CI/CD pipeline (GitHub Actions)

```
.github/workflows/
├─ ci.yml         # on PR + push to main
│   ├─ job: lint-rust        cargo fmt --check, cargo clippy -D warnings
│   ├─ job: test-rust        cargo nextest run --workspace (matrix: linux/macos/windows)
│   ├─ job: lint-frontend    eslint, prettier --check, tsc --noEmit
│   ├─ job: test-frontend    vitest run --coverage
│   ├─ job: storybook-tests  build storybook, run test-runner + axe
│   ├─ job: audit            cargo audit, npm audit / osv-scanner
│   ├─ job: ipc-drift        regenerate ts-rs types + zod schemas, fail on diff (doc 07 §6)
│   └─ job: e2e              build app, run playwright + tauri-driver against docker-compose fixtures
├─ release.yml    # on tag push
│   ├─ build signed bundles per OS (doc 25)
│   ├─ generate changelog, create GitHub release
│   └─ publish to updater feed
└─ security.yml   # scheduled (weekly) — dependency audit, secret-scanning, SAST (e.g. cargo-geiger for unsafe usage)
```

- Matrix builds across **Windows, macOS, Linux** for both `test-rust` and the final `release`
  build, since this is explicitly a cross-platform desktop product.
- Merge protection: `ci.yml` must be fully green (all jobs) before merge to `main`; no bypass for
  lint/warning gates (consistent with the brief's "zero warnings, zero lint errors" mandate).
- Coverage is tracked (not necessarily gated at v1) via `cargo llvm-cov` + Vitest coverage,
  surfaced as a PR comment/badge to make regressions visible early.

## 8. Acceptance criteria

- A PR introducing a Rust warning, a clippy lint, an ESLint error, or a TS type error fails CI.
- The full Rust + frontend test suite runs in under a target wall-clock budget (tracked, tuned as
  the suite grows) via `nextest`/Vitest parallelism.
- E2E suite passes against a freshly built app on all three OSes before a release tag is cut.
- IPC drift job fails if a Rust DTO change isn't reflected in the generated TS types/schemas.
- Storybook is deployable as a static site (for design review) and its interaction/a11y tests pass in CI.
