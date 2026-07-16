# 27 — Monetization & Licensing Strategy

## 1. Pricing model

A **tiered, perpetual-fallback + subscription** model, common among premium dev-tool desktop apps
(mirrors how Termius/JetBrains-style products balance one-time buyers with recurring revenue):

| Tier | Price shape | Includes |
|---|---|---|
| **Free** | $0 | Core SSH client: connections, terminal, SFTP, key manager, local vault, up to N saved hosts (e.g. 10) — enough to be genuinely useful, not a crippled trial |
| **Pro** | Monthly/annual subscription *or* one-time perpetual license for the current major version | Unlimited hosts, Remote Editor, Dashboard, Docker panel, AI assistant (bring-your-own key), Sync (personal, e.g. 3 devices), snippets/templates/notes |
| **Team** | Per-seat monthly/annual | Everything in Pro + Team workspaces (shared hosts/snippets), centralized policy (doc 26 Phase 4), audit log aggregation, priority support |
| **Enterprise** | Custom | Team + SSO, on-prem/self-hosted sync relay option, custom SLAs, procurement-friendly invoicing |

- The **perpetual license option** for Pro (pay once, keep that major version forever, subscribe
  only if you want future major-version upgrades + ongoing sync/AI-proxy service) directly targets
  the audience this product competes for — SecureCRT/Royal TS buyers who are used to and prefer
  owning a license, while still offering subscribers a lower up-front cost and continuous updates.
- Team/Enterprise are subscription-only (seat-based), since they bundle an ongoing hosted
  service (sync relay, policy push) that has real recurring cost.

## 2. What's gated vs. always free

- **Never gated** (core promise, keeps trust and reviews strong): the SSH/SFTP/terminal/key-manager
  fundamentals, local encrypted vault, and full data ownership (export always works, even on Free).
  Users should never feel their own data is hostage to a subscription.
- **Gated by scale, not by function**, where possible (e.g. "10 hosts free, unlimited on Pro") —
  preferred over gating a *feature* outright, since scale-gating rewards growth naturally as a
  user's needs grow, and free users still get a fully functional (if smaller-scale) experience.
- **Genuinely Pro/Team-only** (function-gated because they have real marginal cost or target a
  different buyer): Cloud Sync (hosted relay infra cost), Team workspaces (shared infra + admin
  tooling), Enterprise SSO/on-prem (support/integration cost). AI is BYO-key so its marginal cost
  to us is ~zero — it's gated to Pro mainly to keep the Free tier's UI surface focused, not for cost reasons.

## 3. License enforcement

- **Offline-friendly**: license validation checks against a locally cached, cryptographically
  signed license token (public-key signature verification, mirroring the update-manifest signing
  model in doc 25 §5) with periodic (not constant) online re-validation — so a Pro user on a plane
  isn't locked out, but a leaked/shared license key can be revoked and will eventually re-check.
- **No DRM theater**: no online phone-home required to *launch* the app or to use core features —
  consistent with the offline-first pillar (doc 00 §2, §7) and avoids the trust-eroding pattern of
  competitors who require constant connectivity for a fundamentally local tool.
- Perpetual license tokens are scoped to a major version range; a subscription token has an
  expiry the client checks against the cached token, gracefully downgrading to Free-tier feature
  access (never bricking the app or destroying data) if a subscription lapses.

## 4. Open-core consideration

- Given the plugin SDK (doc 21) and the trust-sensitive nature of an SSH client, a credible path is
  **open-sourcing the core client** (connections/terminal/SFTP/key-manager/vault — the
  security-critical, trust-building parts) under a permissive-but-not-competitor-friendly license
  (e.g. a source-available license), while keeping **Sync relay, Team/Enterprise services, and the
  Marketplace backend** closed and monetized. This mirrors how security-conscious buyers evaluate
  SSH tools (they want to audit the code that touches their credentials) while still preserving a
  monetizable service layer. This is a **strategic option to decide before GA**, not a v1 blocker —
  flagged here for the business decision it requires.

## 5. Marketplace monetization

- Free themes/widgets/plugins are always allowed (encourages ecosystem growth).
- Paid plugins (doc 21 §7) go through the marketplace with a revenue share (e.g. 70/30 favoring
  the author, a common and author-friendly split) — SSHBool's cut funds marketplace infra
  (hosting, signature verification, review) rather than being a primary revenue line in early years.

## 6. Acceptance criteria (of this strategy, at launch)

- Free tier is compelling enough to drive word-of-mouth adoption (internal bar: a solo developer
  could use Free exclusively and still prefer it to a bare terminal + FileZilla).
- Pro perpetual vs. subscription pricing is clearly explained in-app (Settings → About / a
  dedicated upgrade screen) with no dark-pattern nudging.
- License checks never block core SSH/SFTP/terminal functionality, online or offline, on any tier.
- The open-core decision (§4) is explicitly made (yes/no/scope) before the first public release,
  not left ambiguous.
