# Import framework

Reads hosts, SSH keys and snippets out of other SSH clients. Every client is a
module implementing one trait, so the IPC layer and the UI never change when a
new one is added.

## Layout

| Path | Role |
|---|---|
| `mod.rs` | The `ImportSource` trait, normalized types, and the source registry |
| `termius.rs` | Termius importer |
| `../../../src/commands/import.rs` | IPC: `import_sources`, `import_scan`, `import_commit` |
| `../../../../src/features/connections/components/import-panel.tsx` | UI |

## Adding a source

1. Create `import/<client>.rs` and implement `ImportSource`:

   ```rust
   impl ImportSource for MyClientSource {
       fn id(&self) -> &'static str { "myclient" }
       fn probe(&self) -> SourceInfo { /* is it installed? readable? */ }
       fn scan(&self, secret: Option<&str>) -> Result<ImportPreview, ImportError> { … }
   }
   ```

2. Register it in `sources()` in `mod.rs`.

That's it — it appears in the UI automatically. `probe()` should be cheap and
must never fail: report `SourceAvailability::NotFound` instead.

## Rules

- **Read-only.** Never write to the other application's files. Users run these
  importers against a live install of software they still depend on.
- **Never guess a credential.** If a secret cannot be attributed to exactly one
  host, leave it off and set `MatchConfidence::Ambiguous` with a
  `password_note`. A password silently attached to the wrong host is worse than
  no password: it will be sent to that host on the next connect.
- **Degrade, don't abort.** One malformed record must not sink an import of
  hundreds. Collect problems into `ImportPreview::warnings`.
- **Keep the slow parts off the async runtime.** Keychain reads in particular
  are synchronous and can block for seconds; the IPC layer wraps `scan()` in
  `spawn_blocking`, and results that are expensive to fetch should be cached.

## Termius notes

Termius stores each record separately encrypted (libsodium `crypto_secretbox`,
XSalsa20-Poly1305) inside a Chromium IndexedDB LevelDB directory, keyed by a
32-byte value in the OS keychain. We scrape base64 envelopes straight out of the
`.log`/`.ldb` pages rather than implementing a LevelDB reader — the approach
comes from [termius-exporter](https://github.com/ZacharyZcR/termius-exporter).

Two deliberate divergences from that reference, both found by running it against
a real 548-host profile:

- **Hosts come from `address`/`label` records, not `connection_type` records.**
  The latter are session *history*: the reference produced 2219 "hosts" from 467
  distinct endpoints, most of them one-off connections rather than saved hosts.
- **Passwords are only attached when unambiguous.** The reference assigns a
  password to a host whenever any identity shares its username. In the same
  profile `root` had 30 distinct passwords and `admin` 12 — 390 of 467 endpoints
  would have received an arbitrary one.

Partial decryption is normal: LevelDB keeps superseded pages whose records were
written under an older key, so a scan typically opens ~87% of blocks.
