# 28 — Future Features (Post-v1 Backlog)

Explicitly out of scope for the roadmap in doc 26, but tracked so they're not lost and so current
architecture decisions don't accidentally foreclose them.

## 1. Remote desktop protocols

- **RDP and VNC** client panels, positioning SSHBool as a full remote-access workspace, not just
  SSH — directly relevant since MobaXterm/Royal TS both offer this. Architecturally slots in as a
  new bounded context (`remote_desktop`) parallel to `sessions`, rendering into a `PaneKind::Rdp`/
  `PaneKind::Vnc` tab like any other pane (doc 05 §1.4) — the pane-grid/tab model was designed to
  accommodate this without a shell rework.

## 2. Mobile companion app

- A Tauri v2 **mobile** target (iOS/Android) acting as a companion: view hosts, receive dashboard
  alerts, approve sync pairing requests, maybe a lightweight terminal for emergencies. Not a full
  parity port — mobile ergonomics (touch, small screen) don't suit dense SFTP/dashboard UIs well.

## 3. Team workspaces (deepening SaaS Phase 4)

- Beyond the doc 26 Phase 4 outline: shared session handoff ("hand this connected session to a
  teammate"), team-wide command approval workflows for sensitive snippets, and shared dashboards
  (a team-visible status page for a fleet of hosts).

## 4. Alerting & incident integrations

- Push dashboard threshold breaches (doc `features/14-dashboard.md` §6) to PagerDuty/Opsgenie/Slack/
  Discord webhooks; scheduled health-check reports. Currently v1 keeps alerting purely local
  (toast + status badge) — this generalizes it into a real ops alerting surface.

## 5. Infrastructure-as-code integrations

- Terraform/Ansible/Pulumi awareness: detect IaC files in a project, show plan/apply status,
  link hosts to their IaC-managed identity. A natural extension of the Dev Tools panel (doc
  `features/17-dev-tools.md`) once the core tool-detection pattern is proven out.

## 6. Advanced Redis/Mongo tooling

- Pub/Sub live view, `MONITOR` streaming, cluster topology view for Redis; aggregation pipeline
  builder UI for MongoDB (deferred from doc `features/16-databases.md` §4–5 as fast-follows).

## 7. Session sharing & collaborative terminal

- Multiple users viewing/co-driving the same terminal session in real time (think tmate/ttyd-style
  sharing, but integrated) — valuable for pairing/incident response, requires a signaling layer on
  top of the existing session actor model (doc 01 §8) plus careful permission scoping (who can
  type vs. just watch).

## 8. Platform store distribution

- Microsoft Store / Mac App Store scoped builds (deferred from doc 25 §7 due to sandboxing
  constraints around raw socket/process access) — would need a reduced-capability build variant
  or store-specific entitlement negotiation.

## 9. Expanded hardware key support

- Full PIV smart-card mode for YubiKey (beyond the FIDO2 security-key mode in v1, doc
  `features/18-key-manager.md` §8), and broader hardware token support (Nitrokey, other PKCS#11 devices).

## 10. AI beyond BYO-key

- An optional, usage-metered "SSHBool AI" proxy tier (no need for users to manage their own
  provider keys) — the SaaS-adjacent monetization angle flagged in doc 27 §2, deferred until
  demand and unit economics justify operating an inference proxy ourselves.

## 11. Windows/macOS-native dashboard parity

- Bringing the Server Dashboard's metric coverage (doc `features/14-dashboard.md` §2) to full
  parity for Windows and macOS remote targets (currently best-effort/reduced), likely via
  PowerShell/`wmic`-based and `vm_stat`/`sysctl`-based collector modules mirroring the Linux `/proc`
  parser pattern.

## 12. Why these are deferred, not designed away

Every item above was checked against the architecture in doc 01/05/06 to confirm it doesn't
require a rework — new bounded contexts, new pane kinds, new collector adapters, and new plugin
capabilities all extend the existing seams (ports/adapters, CQRS use cases, pane-grid UI) rather
than needing new ones. This is why they're safely deferred: building v1 well now doesn't cost us
later when we come back for these.
