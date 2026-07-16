# Feature 10 — SSH & Connections

Covers every SSH capability from the brief. Backend in `infrastructure/ssh` (doc 05 §3.2);
domain in `connections` + `sessions`; UI in `features/connections` + `features/terminal`.

## 1. Scope checklist (from brief)

SSH2 · Password auth · Public key auth · OpenSSH keys · Ed25519 · RSA · ECDSA · Security keys
(FIDO2) · YubiKey · SSH Agent · SSH Config · Known Hosts · Host Fingerprints · Jump Hosts ·
ProxyJump · SOCKS Proxy · HTTP Proxy · Compression · Keep Alive · Connection Sharing · Port
Forwarding · Reverse Tunnels · Dynamic Tunnels · Remote Command Execution · Connection History ·
Favorite Servers · Groups · Folders · Tags · Search · Pinned Servers.

## 2. Transport (russh)

- One `Connection` **actor** per `HostId` owns the russh session + socket (doc 01 §7–8).
- Algorithm policy: prefer curve25519‑sha256, chacha20‑poly1305/aes‑gcm, ed25519; configurable.
- **Compression**: negotiate `zlib@openssh.com` when host `use_compression` is set.
- **Keep‑alive**: send SSH keep‑alive every `keepalive_secs`; detect dead peers, emit `connection://state`.
- **Connection sharing**: additional panes/SFTP/metrics reuse the same authenticated session
  (ControlMaster‑like) — no re‑auth, lower latency. Ref‑counted; closed when last consumer leaves.

## 3. Authentication

| Method | Implementation |
|---|---|
| Password | prompt or from vault credential; never persisted plaintext |
| Public key | key from vault (`ssh_keys`), decrypt priv in secure memory, sign; supports Ed25519/RSA/ECDSA |
| Keyboard‑interactive | prompt flow (2FA/OTP), UI dialog per challenge |
| SSH agent | `agent.rs` talks to unix agent / Windows OpenSSH agent / Pageant; delegates signing |
| FIDO2 / `sk-ed25519`, `sk-ecdsa` | via agent (touch/PIN) or system‑ssh fallback (ADR‑003) |
| YubiKey | as a FIDO2 security key or PIV via agent |

Auth order per host follows `auth_method` with graceful fallback + clear `AppError::Auth`.

## 4. SSH config & import

- Parse `~/.ssh/config` (Host, HostName, User, Port, IdentityFile, ProxyJump, ProxyCommand, ...).
- `hosts_import` preview → user selects which to import → commit to `hosts`/`identities`.
- Also import Termius/MobaXterm/JSON/YAML exports (mappers in `application/connections`).
- Export back to JSON/YAML and (best‑effort) `ssh_config`.

## 5. Known hosts & fingerprints

- On connect, compute SHA256 fingerprint; check `known_hosts` store.
- Unknown → `HostKeyPromptDialog` (show fingerprint + randomart) to trust.
- Changed → `AppError::HostKeyChanged` → prominent warning dialog; block by default (MITM protection).
- Policy configurable in Security settings (strict / TOFU / ask).

## 6. Jump hosts, ProxyJump, proxies

- `jump.rs` builds a chain: connect to bastion, open `direct-tcpip` to next hop, tunnel the next
  session through it — supports **multi‑hop** ProxyJump.
- SOCKS5 / HTTP proxy dialer for the initial TCP connection (`proxies` table).
- Cycle detection in domain (`services.rs`) prevents a host jumping through itself.

## 7. Port forwarding & tunnels

| Type | Direction | russh channel |
|---|---|---|
| Local (`-L`) | local port → remote dest | `direct-tcpip` |
| Remote / reverse (`-R`) | remote port → local dest | `tcpip-forward` + `forwarded-tcpip` |
| Dynamic (`-D`, SOCKS) | local SOCKS proxy → any | SOCKS server → `direct-tcpip` per conn |

- Defined per host (`port_forwards`), `auto_start` on connect, toggled live in a Tunnels panel.
- Status + throughput shown; errors surfaced without dropping the main session.

## 8. Remote command execution

- `session_run_command` runs a one‑shot `exec` channel, captures stdout/stderr/exit code.
- Used by dashboard probes, dev tools, docker CLI, and the AI "Run in terminal" action.

## 9. Organization: groups, tags, favorites, pinned, search, history

- Groups = nestable folders (`groups` self‑ref tree); drag‑drop reorder/move (dnd‑kit).
- Tags many‑to‑many; filter chips; color labels.
- Favorites + pinned surfaced on Home; `connect_count` / `last_connected_at` drive Recents.
- Search: instant fuzzy over label/hostname/notes (FTS5) + tag filters; also in command palette.
- History: every session logged (`sessions`), command history (`command_history`) for palette/AI.

## 10. Data & commands

Tables: `hosts, groups, identities, proxies, tags, host_tags, port_forwards, known_hosts` (doc 04).
Commands: `hosts_*`, `groups_*`, `tags_*`, `proxies_*`, `port_forwards_*`, `known_hosts_*`,
`session_open/close`, `session_run_command` (doc 07 §4.1, §4.3).

## 11. Acceptance criteria

- Connect via password, key (all 3 types), agent, and FIDO2 (via agent) to a test OpenSSH server.
- Multi‑hop ProxyJush + SOCKS proxy verified.
- Local/remote/dynamic forwards move real traffic; survive idle via keep‑alive.
- Changed host key is blocked and clearly explained. Import from real `~/.ssh/config` works.
- One authenticated session powers a terminal + SFTP + metrics simultaneously (sharing verified).
