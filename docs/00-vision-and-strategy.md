# 00 — Vision & Strategy

## 1. Vision

Developers and operators live across dozens of servers. Their tools are fragmented: a terminal
here, a file transfer app there, a separate DB GUI, a monitoring tab in the browser, and a wall
of `~/.ssh/config` they hand‑edit. **SSHBool unifies the entire remote workflow into one native
workspace** that is fast, beautiful, secure, and extensible.

Guiding principle: **"Connect once, do everything."** When a connection is open, the terminal,
files, editor, metrics, containers, and databases behind it should all be one click away, sharing
the same authenticated, multiplexed transport.

## 2. Product pillars

1. **Native performance** — Rust core, no Electron, sub‑second cold start.
2. **Premium UX** — glassmorphism, smooth motion, dark/light, keyboard‑first.
3. **Security by default** — E2E encryption, hardware keys, secure memory, master password.
4. **Unified workspace** — terminal + SFTP + editor + monitoring + docker + DB + AI in one shell.
5. **Extensible** — a real plugin SDK and marketplace, not an afterthought.
6. **Offline first, cloud optional** — everything works locally; sync is opt‑in and E2E‑encrypted.

## 3. Target personas

| Persona | Primary jobs-to-be-done | Killer features for them |
|---|---|---|
| **Backend / full‑stack developer** | SSH into staging, tail logs, edit config, run migrations | Remote Monaco editor, snippets, AI log analysis |
| **DevOps / SRE** | Manage fleets, tunnels, docker, k8s, incident triage | Jump hosts, dashboard, Docker/K8s panels, session recording |
| **Sysadmin** | Maintain many servers, transfer files, patch | Dual‑pane SFTP, folder sync, updates panel, groups/tags |
| **Cloud engineer** | Bastion access, port forwards, DB access | ProxyJump, dynamic/reverse tunnels, DB clients |
| **Security‑conscious team** | Enforce key auth, audit, rotate secrets | FIDO2/YubiKey, master password, audit log, E2E sync |

## 4. Positioning vs competitors

- **vs Termius** — native (not Electron), faster, integrated DB/Docker/monitoring, local‑first with optional E2E sync (no forced cloud account).
- **vs MobaXterm** — modern cross‑platform UI (MobaXterm is Windows‑only, dated), better editor and AI.
- **vs Bitvise/SecureCRT** — modern UX, macOS/Linux support, integrated workspace beyond SSH/SFTP.
- **vs VS Code Remote SSH** — purpose‑built ops workspace with SFTP, monitoring, Docker, DB, and a real host manager, without spinning a remote server extension host.

## 5. Differentiators (the "why switch")

1. **One multiplexed connection powering every panel** (terminal, files, metrics, docker) instead of N separate SSH sessions.
2. **AI copilot that is context‑aware** of the active host, last command, and log output.
3. **Local‑first with true E2E‑encrypted sync** — you own your data; the server can never read it.
4. **Hardware‑key native** (FIDO2/YubiKey) auth and vault unlock.
5. **A plugin marketplace** allowing the community to extend panels, themes, and generators.

## 6. Success metrics (product)

- Time‑to‑first‑shell after launch: **< 3 s** (including host pick + auth).
- Cold start: **< 800 ms**; connect to saved host: **< 1.2 s** on LAN.
- Crash‑free sessions: **> 99.9%**.
- D30 retention target for paid users: **> 55%**.
- NPS target: **> 50**.

## 7. Non‑goals (v1)

- Full Windows RDP / VNC remote desktop (candidate for later; see doc 28).
- A mobile app (the Tauri v2 mobile target is a future track, not v1).
- Being a general IDE — the editor is scoped to remote files and config, not project dev.

## 8. Naming & branding

- Working name: **SSHBool** (current repo `identifier: com.abdug.sshbool`). Product display name TBD;
  the config currently ships `productName: "tauri-native"` which **must be renamed** before release
  (tracked in doc 25). Suggested display name: **SSHBool** or a chosen brand.
