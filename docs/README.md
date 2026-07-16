# SSHBool — Infrastructure Workspace

> The most modern SSH ecosystem for developers, DevOps, sysadmins and cloud engineers.
> This is **not** just an SSH client — it is an **Infrastructure Workspace**.

This `docs/` folder is the **single source of truth** for the design and implementation of the
product. It is written so that an implementing engineer (human or AI) can build the product
end‑to‑end **without any further design decisions**. Every architectural choice is explained.

> **STATUS: IMPLEMENTATION IN PROGRESS.** Specs in this folder remain the source of truth.
> Desktop app code lives under `src/` (Vite React) and `src-tauri/` (Rust). Phase 0–3 client
> features and Phase 4 SaaS *client foundation* (license, sync relay client, team stubs) are
> in tree; production hosted SaaS remains deferred.

---

## Product one-liner

A native, blazing‑fast, secure, cross‑platform desktop app that unifies **SSH terminals, SFTP,
remote editing, server monitoring, Docker, databases, dev tooling, secrets, and an AI copilot**
into one premium workspace — built on **Tauri v2 + Rust + React**.

## Competitive target

We aim to match and exceed: **Bitvise SSH Client, Termius, MobaXterm, Royal TS, SecureCRT, VS Code Remote SSH**.

| Capability | Bitvise | Termius | MobaXterm | SecureCRT | VS Code Remote | **SHBool** |
|---|---|---|---|---|---|---|
| Native (no Electron) | ✅ | ❌ | ✅ | ✅ | ❌ | ✅ |
| Modern UI / theming | ❌ | ✅ | ❌ | ❌ | ✅ | ✅ |
| SFTP dual‑pane pro | ✅ | ⚠️ | ✅ | ⚠️ | ❌ | ✅ |
| Remote Monaco editor | ❌ | ⚠️ | ❌ | ❌ | ✅ | ✅ |
| Server monitoring dashboard | ❌ | ✅ | ⚠️ | ❌ | ❌ | ✅ |
| Docker / K8s panels | ❌ | ❌ | ❌ | ❌ | ⚠️ | ✅ |
| DB clients built‑in | ❌ | ❌ | ⚠️ | ❌ | ⚠️ | ✅ |
| AI copilot | ❌ | ✅ | ❌ | ❌ | ✅ | ✅ |
| E2E‑encrypted sync | ⚠️ | ✅ | ❌ | ⚠️ | ✅ | ✅ |
| Plugin SDK + marketplace | ❌ | ❌ | ⚠️ | ⚠️ | ✅ | ✅ |
| FIDO2 / hardware keys | ✅ | ⚠️ | ⚠️ | ✅ | ⚠️ | ✅ |

---

## Document map

| # | Document | Covers (from the brief) |
|---|---|---|
| 00 | [Vision & Strategy](./00-vision-and-strategy.md) | Product goal, personas, positioning |
| 01 | [Architecture](./01-architecture.md) | Full architecture, DDD, Clean Arch, CQRS, DI, Repository, plugin system |
| 02 | [Folder Structure](./02-folder-structure.md) | Complete folder structure (Rust + React) |
| 03 | [Tech Stack & Decisions](./03-tech-stack-and-decisions.md) | Stack, **Vite vs Next.js decision**, ADRs |
| 04 | [Database Schema](./04-database-schema.md) | Every table, index, migration, encryption model |
| 05 | [Rust Backend Architecture](./05-rust-backend-architecture.md) | Every Rust crate/module/service |
| 06 | [React Frontend Architecture](./06-react-frontend-architecture.md) | Every React component, store, hook |
| 07 | [Tauri Commands & API Contracts](./07-tauri-commands-and-api-contracts.md) | Every command, event, DTO |
| 08 | [Design System](./08-design-system.md) | Tokens, glassmorphism, motion, a11y |
| 09 | [Screens, Wireframes & Dialogs](./09-screens-wireframes-dialogs.md) | Every screen, dialog, settings page |
| 10 | [Feature: SSH & Connections](./features/10-ssh-connections.md) | SSH2, auth, proxy, tunnels, hosts |
| 11 | [Feature: SFTP File Manager](./features/11-sftp.md) | Dual pane, transfers, sync, preview |
| 12 | [Feature: Terminal](./features/12-terminal.md) | xterm.js, tabs, splits, recording |
| 13 | [Feature: Remote Editor](./features/13-remote-editor.md) | Monaco, diff, autosave, git |
| 14 | [Feature: Server Dashboard](./features/14-dashboard.md) | CPU/mem/disk/net/processes/services |
| 15 | [Feature: Docker & Kubernetes](./features/15-docker-kubernetes.md) | Containers, images, compose, K8s |
| 16 | [Feature: Databases](./features/16-databases.md) | MySQL/PG/Redis/Mongo/SQLite clients |
| 17 | [Feature: Dev Tools](./features/17-dev-tools.md) | Git, package managers, runtimes, ADB |
| 18 | [Feature: SSH Key Manager](./features/18-key-manager.md) | Generate/import/export/hardware keys |
| 19 | [Feature: Sync & Backup](./features/19-sync-backup.md) | E2E cloud sync, versioning |
| 20 | [Feature: AI Assistant](./features/20-ai-assistant.md) | Copilot, log/error analysis, generators |
| 21 | [Feature: Productivity](./features/21-productivity.md) | Snippets, notes, palette, shortcuts |
| 21 | [Plugin SDK & Marketplace](./21-plugin-sdk.md) | SDK, extensions, themes, widgets |
| 22 | [Security Review](./22-security.md) | Threat model, crypto, secure memory |
| — | [Security review checklist](./security-review-checklist.md) | Phase-end security gate checklist |
| 23 | [Performance & Memory](./23-performance-and-memory.md) | Perf budget, memory optimization |
| 24 | [Testing & CI/CD](./24-testing-and-cicd.md) | Unit/integration/E2E, Storybook, GH Actions |
| 25 | [Deployment & Auto-Update](./25-deployment-and-autoupdate.md) | Signing, notarization, updater |
| 26 | [Roadmap](./26-roadmap.md) | Dev / MVP / Enterprise / SaaS roadmaps |
| 27 | [Monetization & Licensing](./27-monetization-and-licensing.md) | Pricing, tiers, license enforcement |
| 28 | [Future Features](./28-future-features.md) | Backlog beyond v1 |
| 99 | [Glossary & Conventions](./99-glossary-and-conventions.md) | Terms, naming, coding standards |

---

## How to use these docs (for the implementing model)

1. Read **03 (decisions)** and **01 (architecture)** first to lock the mental model.
2. Scaffold using **02 (folder structure)**.
3. Build the backend bottom‑up: **04 (DB) → 05 (Rust modules) → 07 (commands)**.
4. Build the frontend: **08 (design system) → 06 (components) → 09 (screens)**.
5. Implement features feature‑by‑feature from `features/` following the roadmap in **26**.
6. Wire testing/CI from **24** *before* feature work, not after.
7. Never ship placeholders. Every module has an explicit acceptance checklist in its doc.

## Global engineering rules (non‑negotiable)

- **Strong typing everywhere.** Rust: `#![deny(warnings)]` in CI. TS: `strict: true`, no `any`.
- **Zero warnings, zero lint errors** gate merges.
- **Security first.** Secrets never touch disk unencrypted; never logged; zeroized in memory.
- **Offline first.** The app is fully functional with no network except for the features that inherently need it (sync, AI, marketplace).
- **Performance budget** is enforced (see doc 23). Cold start < 800 ms, idle RAM < 180 MB.
- **Every Rust command is fallible and typed** — see the `AppError` contract in doc 07.
- **No blocking I/O on the UI thread.** All SSH/SFTP/DB work runs on Tokio in the Rust core.
