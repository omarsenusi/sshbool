# Feature 18 — SSH Key Manager

Backend: `infrastructure/crypto/keygen.rs`, `hardware.rs` (doc 05 §3.3); domain `vault`; UI `features/vault`.

## 1. Scope checklist

Generate · Import · Export · Delete · Rename · Passphrase · Fingerprint · Copy public key ·
Backup · Restore · Hardware keys.

## 2. Data model

Every key is an `ssh_keys` row (doc 04 §3.2): public key always in plaintext (it's not secret),
private key material stored as an encrypted envelope (`private_ciphertext`/`private_nonce`) under
the vault's data key, or entirely absent for hardware-backed keys (the private key never leaves
the device). `fingerprint_sha256` is computed once at generation/import and indexed for fast lookup
and duplicate detection.

## 3. Generate

- `GenerateKeyDialog`: choose type — **Ed25519** (default/recommended), **RSA** (2048/3072/4096),
  **ECDSA** (P-256/P-384/P-521) — name, optional passphrase, optional comment.
- Generation runs in `infrastructure/crypto/keygen.rs` using `ed25519-dalek` / RustCrypto RSA/ECDSA,
  on a `spawn_blocking` task (key generation, especially RSA, is CPU-bound — doc 01 §8) so the UI
  never freezes.
- Immediately after generation, the raw private key material is passed straight into the
  `SecretStore` for encryption and the plaintext copy is `zeroize`d — it is never written to disk
  or logged unencrypted at any point (doc 22 secure-memory rules).

## 4. Import

- `ImportKeyDialog` accepts pasted text or a file picker (native OS dialog via the Tauri `dialog`
  plugin — no direct filesystem scope granted to the webview, doc 07 §5), supporting OpenSSH
  (`PEM`/new `OPENSSH PRIVATE KEY` format), and PuTTY `.ppk` (auto-converted).
- If the key is passphrase-protected, the user supplies the passphrase once to decrypt-and-reencrypt
  under our own vault encryption (we never store the original passphrase); `has_passphrase` remains
  informational metadata about whether *our* copy also requires the original passphrase to use
  (configurable: re-wrap without passphrase, or keep requiring it — trade-off explained in-dialog).
- Duplicate detection by fingerprint prevents accidental duplicate imports (offers to just rename/tag
  the existing one instead).

## 5. Export

- **Public key**: always available, one click (`keys_export_public` / `KeyRow` copy icon) —
  copies OpenSSH `authorized_keys`-ready format to the clipboard.
- **Private key**: `ExportPrivateKeyDialog` — requires the vault to be **unlocked** and an explicit
  re-entry of the master password (or biometric) as a step-up confirmation, writes to the
  `audit_log` (doc 04 §3.12 / doc 22), and returns the PEM to a native "Save As" dialog rather than
  rendering it anywhere in the UI, minimizing on-screen/clipboard exposure of private key material.

## 6. Delete & rename

- Rename is metadata-only (`keys_rename`). Delete (`keys_delete`) warns if the key is currently
  referenced by any `identity`/host, listing them, since removing it would break those connections'
  auth path — the user confirms with full awareness of the blast radius.

## 7. Fingerprint & passphrase management

- Fingerprint (SHA256, base64, matching `ssh-keygen -lf` output format) is always visible in
  `KeyDetailsPanel` for quick cross-referencing against server `authorized_keys` or known_hosts.
- `keys_add_passphrase` lets a user add/change/remove the passphrase requirement on an existing
  vault-managed key without regenerating it (re-encrypts the stored envelope).

## 8. Hardware keys (FIDO2 / YubiKey)

- Hardware-backed keys (`sk-ed25519@openssh.com`, `sk-ecdsa-sha2-nistp256@openssh.com`) have
  `hardware_backed = true` and **no** stored private material — the row is effectively a pointer +
  public key + fingerprint. Actual signing happens on the device via the SSH agent or platform
  security-key APIs (ADR‑003, doc `features/10-ssh-connections.md` §3).
- `HardwareKeyDialog` walks the user through: plug in device → touch/PIN to generate (`ssh-keygen
  -t ed25519-sk` equivalent flow) or register an existing resident key → verify presence.
- YubiKey is supported as a FIDO2 security key through this same flow (and, as a fast-follow, PIV
  smart-card mode via the agent — tracked as an incremental enhancement, not a v1 blocker).

## 9. Backup & restore

- `BackupVaultDialog`/`vault_backup` exports **all** keys + credentials as a single encrypted blob
  (re-encrypted under a backup password the user provides, independent of the live master password,
  so backups remain valid across a future password rotation).
- `RestoreVaultDialog`/`vault_restore` decrypts and merges (duplicate-by-fingerprint-safe) into the
  current vault. This is distinct from, and a superset of, per-key export — it is the "move to a
  new machine" / disaster-recovery path, complementary to the optional cloud Sync feature (doc
  `features/19-sync-backup.md`).

## 10. Commands

`keys_list`, `keys_generate`, `keys_import`, `keys_export_public`, `keys_export_private`,
`keys_rename`, `keys_delete`, `keys_add_passphrase`, `keys_copy_public`, `vault_backup`,
`vault_restore` (doc 07 §4.2).

## 11. Acceptance criteria

- Generate all three key types; verify OpenSSH-compatible fingerprints against `ssh-keygen -lf`.
- Import a passphrase-protected OpenSSH key and a PuTTY `.ppk`; both authenticate successfully
  against a real server.
- Export-private requires re-authentication and is logged to the audit log; export-public does not.
- Deleting a key in use by a host surfaces the affected hosts before confirming.
- Register a FIDO2 security key and successfully authenticate to a server with it, confirming no
  private key material exists in the database for that row.
- Full vault backup/restore round-trips correctly onto a fresh install.
