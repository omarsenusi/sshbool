# 22 — Security Review

Consolidates the security posture referenced throughout this doc set (01 §5/§9, 03 ADR‑004, 04,
05 §3.3, 07 §5, 21) into one review: threat model, crypto design, key hierarchy, and hardening.

## 1. Scope checklist

AES Encryption · Master Password · Biometric Unlock (Windows Hello, TouchID) · Linux Secret
Service · Encrypted Database · Secure Memory · Automatic Lock · Session Timeout · Certificate
Validation.

## 2. Threat model

| Threat | Mitigation |
|---|---|
| Stolen laptop / disk theft | Full-DB SQLCipher encryption; vault locked by default on launch; secrets unreadable without master password/biometric |
| Malware reading app memory | Secure memory (`zeroize`/`secrecy`), minimized secret lifetime in RAM, no swap-vulnerable long-lived plaintext buffers |
| Malicious/compromised plugin | Capability sandbox (doc 21) — deny-by-default, no ambient FS/process access, signature-verified marketplace |
| MITM on SSH connection | Strict host-key verification (TOFU/strict modes), fingerprint prompts, `AppError::HostKeyChanged` blocks by default |
| MITM on sync/AI network calls | TLS everywhere (`reqwest` with rustls, cert validation on), E2E encryption for sync so a MITM relay sees only ciphertext regardless |
| Credential/log leakage | `tracing` redaction layer; `AppError` messages redacted; AI context redaction (doc `features/20-ai-assistant.md` §3); no secrets in recordings/exported logs (doc `features/12-terminal.md` §7) |
| Brute-force master password | Argon2id KDF with tuned memory/time cost; rate-limited unlock attempts with backoff; optional lockout after N failures |
| Shoulder-surfing / unattended session | Auto-lock timer, session timeout, biometric re-auth for sensitive actions (private key export) |
| Supply-chain (dependencies) | `cargo audit`/`npm audit` in CI (doc 24), pinned lockfiles, minimal dependency surface for crypto (RustCrypto/ring, not hand-rolled) |
| Malicious update package | Tauri updater signature verification (doc 25) — unsigned/mismatched updates rejected |

## 3. Key hierarchy

```
Master Password ──Argon2id(salt, m,t,p)──► KEK (Key Encryption Key, in secure memory only)
                                              │
                                              ▼ unwrap
                                   Data Key (DEK, random, generated once)
                                     │                         │
                                     ▼                         ▼
                        SQLCipher DB encryption      AEAD envelopes for
                        (whole-file, PRAGMA key)      credentials/ssh_keys
                                                       (per-row nonce)

Optional OS-keychain path: DEK is *also* wrapped with a key stored in the
OS Secret Service (Windows Credential Manager / macOS Keychain / libsecret),
unlocked via biometric prompt, as an alternative to typing the master password.
```

- **AES**: AES‑256‑GCM (hardware-accelerated via `ring`/AES‑NI where available) is the default
  AEAD; XChaCha20‑Poly1305 is the fallback for platforms without AES‑NI, chosen automatically.
- The **KEK never touches disk**; only the Argon2id salt+params and a verifier (not the key
  itself) are stored, so the KEK is always re-derived in memory from the password at unlock.
- **Rotating** the master password (`vault_change_password`) re-wraps the DEK under a new KEK
  derived from the new password — the DEK (and therefore all encrypted rows) never needs
  re-encryption, keeping rotation fast regardless of vault size.

## 4. Master password & biometric unlock

- `vault_init` sets the initial password with a strength meter (entropy estimate, common-password
  check) — no arbitrary complexity rules (length + entropy, per current NIST guidance).
- `vault_unlock` accepts password **or** biometric, per platform:
  - **Windows Hello** via the `windows` crate's biometric APIs, gating release of the keychain-wrapped DEK.
  - **macOS TouchID** via `LocalAuthentication`/Keychain ACLs.
  - **Linux Secret Service** (`libsecret`/`keyring` crate) — no biometric prompt on most distros,
    but the DEK wrap still benefits from OS-level access control (session keyring), and where a
    fingerprint reader + PAM integration exists it's used opportunistically (best-effort, not guaranteed).
- Biometric unlock is strictly **additive convenience**, never a replacement for the master
  password existing — losing biometric capability (new machine, disabled feature) always falls
  back to the password path, since that's what the KEK derivation ultimately depends on.

## 5. Secure memory

- Private keys, passphrases, and the KEK/DEK are held in `secrecy::Secret<T>`/`zeroize::Zeroizing`
  wrappers that scrub memory on drop; they are never `Clone`d into untracked buffers, never
  `Debug`-formatted (compile-time enforced via newtypes that deliberately don't derive `Debug`),
  and never serialized to logs.
- Command handlers that momentarily need plaintext (e.g., to sign an SSH auth request) scope the
  secret to the smallest possible lifetime and drop it immediately after use.

## 6. Encrypted database

- SQLCipher (AES‑256, PBKDF2/Argon2-derived page key — see ADR‑004, doc 03) encrypts the **entire**
  SQLite file, including schema and indexes — even table/column names aren't visible to someone
  reading the raw file.
- Backups (`vault_backup`) re-wrap the same protected data under a separate backup password,
  so a leaked backup file is independently protected.

## 7. Automatic lock & session timeout

- Configurable **auto-lock** timer (idle-based, default 15 minutes) emits `app://lock`, clearing
  in-memory secrets and requiring unlock to resume — active SSH sessions remain connected (so a
  long-running transfer/tail isn't killed by locking) but the UI blurs/hides sensitive panels
  until unlock.
- Separate **session timeout** setting can be configured to actually terminate idle SSH sessions
  after N minutes of no activity, independent of vault lock — useful for compliance-conscious teams.
- Lock state is also triggerable manually (single click/shortcut) and on system sleep/lock (OS
  event hook), so the vault never stays unlocked through a suspended laptop.

## 8. Certificate validation

- All outbound TLS (sync relay, AI providers, marketplace, update checks) uses `rustls` with full
  certificate chain + hostname validation — no option to disable verification in production builds;
  a narrowly-scoped "trust this self-signed cert" override exists only for explicitly user-added
  custom AI/DB endpoints, with a clear warning, never silently.
- SSH host-key validation (doc `features/10-ssh-connections.md` §5) is the SSH-layer equivalent of
  certificate validation and follows the same "explicit trust, never silent" principle.

## 9. Audit log

- Security-relevant actions (`vault_unlock`, `keys_export_private`, `plugins_grant`,
  `known_hosts_trust`, `sync_pair_device`, failed unlock attempts) are appended to `audit_log`
  (doc 04 §3.12) with actor/action/target/result — **never** containing secret values — viewable
  in Settings → Advanced → Diagnostics, and exportable for compliance review.

## 10. Dependency & build security

- `cargo audit` + `npm audit`/`osv-scanner` run in CI (doc 24) on every PR; releases block on
  known-critical advisories.
- `cargo clippy -- -D warnings` and Rust's borrow checker are a first line of defense against
  memory-safety classes of bugs that plague C/C++ SSH implementations — reinforcing ADR‑003's
  pure-Rust choice.
- Reproducible, signed release builds (doc 25) so users can verify what they installed matches
  what was published.

## 11. Acceptance criteria

- A raw copy of the SQLite file is unreadable without the correct master password (verified: no
  plaintext table names, no plaintext secret values, via a hex/strings scan).
- Master password rotation completes in constant time regardless of vault size (DEK re-wrap only).
- Biometric unlock works on Windows/macOS; graceful password fallback verified on all three OSes.
- Auto-lock at the configured timeout blurs the UI and requires re-auth, without dropping an
  active file transfer; session timeout (if configured) independently drops idle SSH sessions.
- A modified/self-signed cert on a sync/AI endpoint is rejected unless explicitly and visibly trusted.
- `cargo audit`/`npm audit` are green in CI; no `unwrap`/secret-in-log regressions pass review (doc 24).
