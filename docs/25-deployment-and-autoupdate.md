# 25 — Deployment & Auto-Update Strategy

## 1. Scope checklist

Packaging per OS · Code signing/notarization · Auto-update strategy · Release process · Product
naming cleanup.

## 2. Product naming cleanup (must happen before any public build)

- Current scaffold ships `productName: "tauri-native"` and `identifier: "com.abdug.sshbool"`
  ([src-tauri/tauri.conf.json](src-tauri/tauri.conf.json)) and the Cargo package/lib is named
  `tauri-native`/`tauri_native_lib` ([src-tauri/Cargo.toml](src-tauri/Cargo.toml)). Before the first
  real build:
  1. Decide the final public brand name (doc 00 §8 flags this as open; "SSHBool" is the working default).
  2. Update `tauri.conf.json` → `productName`, window `title`, and confirm `identifier` (reverse-DNS,
     used by installers/updater/keychain scoping — changing it later is disruptive, so lock it early).
  3. Rename the Cargo package/lib accordingly (`sshbool` / `sshbool_lib`) for consistency in binaries,
     crash reports, and OS "Open With"/uninstall entries.
  4. Regenerate icons (`src-tauri/icons/*`, already scaffolded) with final branding once brand/logo
     is finalized (doc 00 §8).

## 3. Packaging per OS

| OS | Format(s) | Notes |
|---|---|---|
| Windows | MSI + NSIS `.exe` | Tauri's bundler produces both; NSIS preferred for the updater-friendly installer UX |
| macOS | `.app` in `.dmg`, and a Universal Binary (arm64 + x86_64) | single download works on Apple Silicon and Intel |
| Linux | `.deb`, `.rpm`, and **AppImage** (portable, distro-agnostic) | AppImage is the primary "just works everywhere" path; `.deb`/`.rpm` for native package manager users |

- `tauri.conf.json`'s `bundle.targets: "all"` already opts into every available target per host
  OS; CI (doc 24 `release.yml`) builds on native runners per OS (Tauri bundling is not reliably
  cross-compiled end-to-end, especially for macOS notarization and Windows signing).

## 4. Code signing & notarization

- **Windows**: Authenticode signing via an EV or standard code-signing certificate (CI secret),
  applied to the MSI/EXE — avoids SmartScreen warnings and is a prerequisite for a trustworthy
  installer experience.
- **macOS**: signed with an Apple Developer ID certificate, then **notarized** via `notarytool`
  (automated in `release.yml`) and stapled — required for Gatekeeper to allow unprompted launch.
- **Linux**: AppImage/`.deb`/`.rpm` signed with a GPG key; the update feed's metadata is also signed
  (see §5) so signature verification doesn't depend on package-format-specific mechanisms alone.
- All signing secrets live in GitHub Actions encrypted secrets, scoped to the `release.yml`
  workflow only (not accessible from PR-triggered `ci.yml` runs) — standard supply-chain hygiene.

## 5. Auto-update strategy

- Uses Tauri's built-in **updater plugin**: the app periodically checks a signed update manifest
  (JSON) hosted at a static endpoint, compares semver, and if newer, downloads and verifies the
  update package's signature (Tauri's updater uses a minisign-style keypair — the private key
  never leaves CI secrets, only the public key ships in the app) before applying it.
- **Channels**: `stable` (default) and `beta` (opt-in in Settings → Updates), each with its own
  manifest endpoint — lets us ship risk-tolerant users new features earlier without destabilizing
  the default channel.
- **Update UX**: `UpdateAvailableDialog` shows release notes (rendered from the same changelog
  generated in `release.yml`), lets the user choose "Update now" (restarts after download+verify)
  or "Later" (re-prompt next launch, snooze-able); no forced silent updates — users always see and
  control when a restart happens, respecting a desktop app's expectations around uptime for active
  sessions.
- A failed signature check or corrupted download **never** partially applies — the updater
  verifies fully before swapping any binary, and falls back to the previous working version on failure.

## 6. Release process

```
1. Merge to main (all ci.yml gates green, doc 24)
2. Version bump (semver) in package.json + Cargo.toml (kept in lockstep via a small script)
3. Tag push (vX.Y.Z) triggers release.yml:
   a. Build + sign + notarize per OS (native runners)
   b. Generate changelog from conventional-commit-style history
   c. Publish signed update manifest to the update feed (per channel)
   d. Create GitHub Release with all installer artifacts attached
4. Announce (in-app "what's new" surfaces the changelog on first launch post-update)
```

- **Rollback**: if a release is found faulty post-publish, the update feed is repointed to the
  previous known-good version (manifest edit, no re-signing of old artifacts needed) while a fix
  is prepared — the feed, not the binary, is the rollback lever.

## 7. Distribution channels (beyond direct download)

- Direct download from the product website is the primary channel (full control over the update
  feed and licensing gate, doc 27).
- Platform stores (Microsoft Store, Mac App Store) are a **fast-follow**, not v1 — sandboxing
  constraints on those stores (especially around raw socket/process access needed for SSH/exec)
  require a scoped-down build variant, tracked in doc 28 rather than blocking the initial release.
- Linux package managers (e.g. a Flathub/AUR/Homebrew-formula listing) are community-friendly
  fast-follows once the AppImage/`.deb`/`.rpm` pipeline is stable.

## 8. Acceptance criteria

- A signed installer for each OS installs cleanly on a fresh VM with no security warnings beyond
  the OS's normal first-run-from-internet notice (which signing/notarization minimizes but doesn't
  eliminate on every OS).
- The updater correctly offers, downloads, verifies, and applies a newer version end-to-end on all
  three OSes, and correctly rejects a tampered/unsigned manifest or package.
- Switching to the beta channel and back is reflected correctly in subsequent update checks.
- The release pipeline is fully reproducible from a tag push with no manual signing steps.
