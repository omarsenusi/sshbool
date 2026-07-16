المر# 26 — Development Roadmap

Four phased roadmaps as requested: Dev (internal build-out), MVP (first external release),
Enterprise (team/compliance features), SaaS (hosted/subscription layer). Each phase lists its
gate — the criteria that must hold before moving to the next.

## 1. Phase 0 — Foundation (Dev roadmap, weeks 1–2)

Goal: a working skeleton with the architecture in place, before any "real" feature.

1. **Vite migration** (ADR‑002, doc 03 §2): replace Next.js scaffold with Vite SPA; update
   `tauri.conf.json`, `components.json`, `package.json` scripts.
2. **Cargo workspace split** (ADR‑006): create `domain`/`application`/`infrastructure` crates per
   doc 02 §3; wire the `app` crate's composition root (`container.rs`) with empty/stub adapters.
3. **Database bootstrap**: SQLCipher-encrypted SQLx pool, migration runner, first migration
   (`0001_init.sql` through vault, doc 04 §6).
4. **Vault MVP**: `vault_init`/`vault_unlock`/`vault_lock`, Argon2id + AEAD envelope (doc 22 §3),
   basic `UnlockScreen`.
5. **CI skeleton** (doc 24 §7): lint + test jobs green on an empty-but-real project before feature
   work begins, so every subsequent PR is held to the quality bar from day one.
6. **Design tokens & shell**: `globals.css` tokens (doc 08 §2), `AppShell`/`ActivityBar`/`TitleBar`/
   `StatusBar` (doc 06 §1) with no real content yet — validates the native window chrome + theming
   pipeline early.

**Gate**: app launches, vault can be created/unlocked, empty shell renders in dark/light, CI is green.

## 2. Phase 1 — MVP (target: first usable release, weeks 3–10)

The minimum feature set that already beats a plain terminal + FileZilla combo and is genuinely
useful daily. Ordered by dependency, not just priority.

1. **SSH connections core** (doc `features/10-ssh-connections.md`): password/key/agent auth,
   host tree/groups/tags/favorites, known-hosts trust flow, `ssh_config` import.
2. **Terminal** (doc `features/12-terminal.md`): tabs, splits, ANSI/Unicode, search, copy/paste,
   command history — no recording yet (fast-follow within MVP if time allows).
3. **SSH Key Manager** (doc `features/18-key-manager.md`): generate/import/export Ed25519/RSA/ECDSA,
   fingerprint, passphrase — hardware keys can land slightly after (still MVP, just sequenced later).
4. **SFTP file manager** (doc `features/11-sftp.md`): dual-pane, upload/download/rename/delete/
   permissions, transfer queue with resume — folder sync/compare can follow shortly after.
5. **Remote editor** (doc `features/13-remote-editor.md`): Monaco, autosave, upload-on-save — diff
   viewer and git integration can land as the second MVP iteration.
6. **Settings + Command Palette + basic productivity** (docs `features/21-productivity.md`, 09 §11):
   snippets, notes, global search, keyboard shortcuts — the connective tissue that makes the rest
   feel like one product rather than four bolted-together tools.
7. **Packaging & auto-update** (doc 25): signed builds for all three OSes, updater wired to a
   stable channel — MVP must be *installable and self-updating*, not just runnable from source.

**Gate**: a real user can install the app, create a vault, add and organize hosts, open a terminal,
transfer files, edit a remote config, and receive an auto-update — end to end, on all three OSes.

## 3. Phase 2 — Post-MVP hardening & differentiation (weeks 11–18)

Fills in the remaining brief features that make SSHBool distinctly *more* than a terminal+SFTP app:

1. Jump hosts/ProxyJump, SOCKS/HTTP proxy, port forwarding/tunnels (doc `features/10-ssh-connections.md` §6–7).
2. Server Dashboard (doc `features/14-dashboard.md`) — the first "workspace, not just client" moment.
3. Docker panel (doc `features/15-docker-kubernetes.md`, without K8s yet).
4. AI Assistant v1 (doc `features/20-ai-assistant.md`) — chat + explain/generate commands, config generators as fast-follow.
5. Session recording, folder sync/compare, git integration in editor, diff viewer.
6. Hardware key (FIDO2/YubiKey) support completed.

**Gate**: dashboard, docker panel, and AI assistant are usable against real hosts; feature parity
with the brief's "SSH/SFTP/Terminal/Editor" sections is complete.

## 4. Phase 3 — Enterprise roadmap (weeks 19–28)

Features that matter to teams and compliance-conscious buyers, justifying a higher-tier plan (doc 27):

1. **Database clients** (doc `features/16-databases.md`) — MySQL/Postgres/Redis/Mongo/SQLite.
2. **Kubernetes panel** (doc `features/15-docker-kubernetes.md` §7).
3. **Dev Tools panel** (doc `features/17-dev-tools.md`) — Git/GitHub/GitLab/Bitbucket status,
   language runtime detection, Laravel/Flutter/ADB integrations.
4. **Cloud Sync** (doc `features/19-sync-backup.md`) — E2E-encrypted multi-device sync, pairing,
   version history — the feature that turns "an app" into "a workspace that follows you."
5. **Audit log & security hardening** (doc 22 §9) — exportable audit trail, stricter host-key
   policies, session timeout enforcement — enterprise buyers evaluate this explicitly.
6. **Plugin SDK & Marketplace v1** (doc 21) — logic + UI plugin sandboxing, signed marketplace.

**Gate**: a team can standardize on SSHBool with shared conventions (templates/snippets/themes via
sync or exported config), pass a basic security review using doc 22 as the reference, and extend
the app via plugins without engineering support from us.

## 5. Phase 4 — SaaS roadmap (weeks 29+, ongoing)

Layers a hosted/subscription dimension on top of the (still fully functional offline) desktop app:

1. **Sync relay as a hosted service** with account management, device limits per plan (doc 27).
2. **Team workspaces**: shared host directories/snippets/templates across a team's paid seats,
   with role-based sharing (view/connect/manage) — an extension of the E2E sync model where the
   "device" pairing concept generalizes to "team member," still without the server reading plaintext
   for the *encrypted* categories, but shared metadata (which hosts exist) necessarily becomes
   team-visible by design at this tier.
3. **Centralized license/seat management** (doc 27) and usage-based AI provider proxying (optional
   convenience tier for teams who don't want to manage individual provider keys).
4. **Marketplace monetization** — paid plugins/themes revenue share (doc 27 §5).
5. **Admin/compliance dashboard** — audit log aggregation across a team's devices, policy
   enforcement (e.g. mandate hardware-key auth, minimum auto-lock timeout) pushed from a team admin.

**Gate**: a paying team can provision seats, share a host directory, enforce a basic security
policy centrally, and the business has a recurring-revenue mechanism beyond one-time license sales.

**Client foundation (shipped in-app):** offline license tokens (`license_*`), Free host soft-limit,
sync enable/push/pull against a local relay stub (`services/sync-relay`), team join/policy stubs,
marketplace catalog search, audit export. **Deferred:** production multi-tenant relay, Stripe/billing,
SSO, real admin portal.

## 6. Cross-phase, always-on tracks

- **Testing/CI** (doc 24) and **performance budget** (doc 23) are enforced from Phase 0 onward,
  not bolted on later. CI: `.github/workflows/ci.yml`; weekly/security: `.github/workflows/security.yml`.
  Retention prune: `retention_prune` command (metrics/audit/query_history).
- **Security review** (doc 22) is revisited at the end of every phase via
  [`security-review-checklist.md`](./security-review-checklist.md).
- Every phase ships with updated docs in this folder before/alongside the code (docs are the spec,
  not an afterthought — consistent with this entire planning exercise).
