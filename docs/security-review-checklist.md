# Phase-end security review checklist (doc 22)

Use at the end of every roadmap phase before calling the phase gate complete.

## Vault & secrets

- [ ] Vault unlock uses Argon2id + AEAD; secrets never stored plaintext in SQLite columns
- [ ] Export of private keys is audited
- [ ] Backup/restore requires password and does not leak DEK

## Host keys & sessions

- [ ] Known-hosts trust flow works; host-key change is surfaced (not silently accepted when expected fingerprint set)
- [ ] ProxyJump cycles are rejected
- [ ] Session idle / lock timeout settings honored when configured (team policy or local)

## IPC / capabilities

- [ ] Webview capabilities grant no broad `fs` / `shell` — filesystem goes through typed Rust commands
- [ ] Soft license gates never brick core SSH/SFTP/terminal on Free or expired Pro

## Sync / SaaS client

- [ ] Sync payloads are vault-sealed ciphertext before leaving the device
- [ ] Relay stub / future relay cannot read plaintext host secrets
- [ ] Paid plugin install requires Pro/Team

## License offline behavior

- [ ] Cached signed (or `dev:`) token works offline
- [ ] Expired subscription downgrades to Free without deleting user data
