# Feature 19 — Sync, Backup & Server Management

Backend: `infrastructure/sync/*` (doc 05 §3.8); domain `sync`; UI `features/sync`. This doc also
covers the brief's **Server Management** section (create/edit/clone/duplicate/import/export/JSON/
YAML/encrypted backup), since those operations are the data this feature synchronizes and backs up.

## 1. Scope checklist

Server Management: Create · Edit · Clone · Duplicate · Import · Export · JSON · YAML · Encrypted
Backup · Sync.
Sync: Cloud Sync · End-to-End Encryption · Multiple Devices · Auto Backup · Version History.

## 2. Server management (recap + backup angle)

- Create/Edit/Clone/Duplicate/Import/Export of hosts are specified in doc
  `features/10-ssh-connections.md` §4 (`hosts_create/update/clone`, `hosts_import/export` with
  JSON/YAML/`ssh_config`). This doc focuses on the **backup and multi-device** dimension: how that
  data (hosts, groups, tags, keys, credentials, snippets, notes) is protected and propagated.
- **Encrypted backup** here is the superset path already introduced in doc
  `features/18-key-manager.md` §9 (`vault_backup`/`vault_restore`) — it snapshots the *entire*
  local database (hosts, vault, keys, snippets, notes, etc.), not just keys, re-encrypted under a
  user-chosen backup password. This is the offline, no-account-required disaster-recovery path.
- **Auto Backup** is a scheduled variant: a background task periodically produces a
  `vault_backup`-equivalent snapshot to a user-chosen local/mounted path (default: app data dir
  `backups/`), retaining the last N (configurable) — entirely independent of cloud Sync, so backups
  work even for users who never enable sync.

## 3. Cloud Sync — architecture

- Sync is **optional** and off by default (offline-first, doc 01 §10). When enabled, it propagates
  encrypted changes between the user's own devices through a relay server that **cannot read the
  data** — SSHBool's server only ever stores and forwards opaque ciphertext blobs.
- **End-to-end encryption model**:
  1. A **sync root key** is generated locally on first enabling sync and never leaves the device
     unencrypted; it is itself wrapped per-device (see pairing, below).
  2. Every change to a syncable entity (host, group, tag, credential, ssh key, snippet, note,
     template) is captured as a `ChangeSet` (`sync_changes` table, doc 04 §3.10), encrypted with
     an AEAD envelope under the sync root key (`infrastructure/sync/envelope.rs`), and queued for push.
  3. The relay stores/forwards these opaque envelopes keyed by account + device; it has no ability
     to decrypt, and a compromised/malicious relay can at most cause data unavailability, not disclosure.
- **Conflict resolution**: entities carry a `VectorClock`; on pull, `sync/merge.rs` detects
  concurrent edits. Simple field-level merges resolve automatically where possible (e.g. tag added
  on both devices); true conflicts (e.g. same field edited differently) surface via
  `ConflictResolverDialog` for the user to pick a side or merge manually.

## 4. Multiple devices & pairing

- `DevicePairingDialog`: pairing a new device uses a short-lived code/QR shown on the *existing*
  unlocked device; the new device scans/enters it, the two devices perform an authenticated
  key-exchange (over the relay, but end-to-end) to securely wrap the sync root key for the new
  device — the relay never sees the unwrapped key.
- `DeviceList` shows paired devices (name, platform, last seen) with the ability to **unpair** a
  lost/stolen device (`sync_unpair`), which invalidates that device's wrapped key copy going
  forward (subsequent pulls from a rogue unpaired device fail cleanly).

## 5. Version history

- Each pushed change increments a per-entity revision (`rev` in `sync_changes`); `sync_versions`
  lets the user browse prior revisions of a given entity (e.g. "this host's config a week ago")
  and `sync_restore_version` reverts to a chosen revision — implemented as a new forward change,
  never a destructive rewrite, so history itself is never lost.
- Version history depth is bounded by a configurable retention window (default 90 days / 200
  revisions per entity, whichever is smaller) to bound relay storage growth.

## 6. What is (and isn't) synced

Synced: hosts, groups, tags, proxies, port forwards, identities, ssh keys (encrypted), credentials
(encrypted), snippets, notes, templates, terminal profiles/themes, keybindings.
**Not synced** (device-local by design): session/recording data, command/query history, metric
series, transfer jobs, docker/db live state, AI conversation history (opt-in per doc
`features/20-ai-assistant.md`) — these are either large, ephemeral, or sensitive-in-a-way that
doesn't benefit from cross-device propagation by default.

## 7. Commands & events

`sync_status`, `sync_enable`, `sync_disable`, `sync_pair_device`, `sync_unpair`, `sync_push`,
`sync_pull`, `sync_resolve_conflict`, `sync_versions`, `sync_restore_version` (doc 07 §4.10).
Event: `sync://state`.

## 8. Acceptance criteria

- Enable sync on device A, pair device B, confirm hosts/keys/snippets created on A appear
  correctly (and decrypted) on B, with the relay logs/storage containing only ciphertext.
- Edit the same host field concurrently on two offline devices, reconnect both, and verify the
  conflict dialog presents both versions correctly; resolving persists the chosen value everywhere.
- Unpair a device and confirm it can no longer push/pull.
- Restore a prior version of a host from version history without losing the version chain.
- With sync disabled, full local encrypted backup/restore still works end-to-end (independent path).
