# Feature 17 — Dev Tools

Backend: thin layer over `session_run_command` + parsers; UI `features/devtools`.

## 1. Scope checklist

Git · GitHub · GitLab · Bitbucket · Composer · Node · NPM · PNPM · Bun · Rust · Go · Python · PHP ·
Laravel · Flutter · ADB · Docker · Kubernetes.

## 2. Design principle: detect, don't assume

None of these tools are bundled or required. `DevToolsPanel` runs cheap, cached **detection
probes** (`command -v <tool>` / version flags) over the active host's connection on tab-open, and
only renders cards for tools that are actually present — avoiding a wall of irrelevant UI on a
minimal server. Detected versions are cached per host/session (`useToolDetection`) and refreshed
on demand.

## 3. Git panel

- `GitPanel`: current branch, ahead/behind counts, working-tree status (staged/unstaged/untracked)
  parsed from `git status --porcelain=v2`, recent log (`git log --oneline -n 50`), stage/unstage/
  commit (with message box), and a one-click diff view (reuses the `DiffViewer` from doc
  `features/13-remote-editor.md`).
- **GitHub / GitLab / Bitbucket**: not separate embedded clients — instead, the Git panel detects
  the remote's host (from `git remote -v`) and surfaces a "open in browser" + PR/MR status via the
  provider's REST API (optional, requires a personal access token stored via the vault as a
  `credential`). This keeps v1 scope realistic (no full code-review UI) while giving immediate
  value: current PR/MR state for the checked-out branch, CI status badge.

## 4. Language/runtime & package manager cards

- `RuntimePanel` shows detected versions for Node, Bun, Rust (`rustc`/`cargo`), Go, Python, PHP —
  each card shows version + a "switch version" hint if a version manager (`nvm`, `pyenv`, `rustup`,
  `asdf`) is detected, deep-linking to a terminal command rather than reimplementing version
  management UI.
- `PackageManagerPanel` (npm/pnpm/bun/Composer): shows outdated/vulnerable dependency counts
  (`npm outdated --json`, `composer outdated --format=json`) for the project in the current
  working directory, with a "run install/update" quick action that opens a terminal pane pre-filled
  with the right command (never auto-executed without user confirmation).
- **Laravel**: when `artisan` is detected in the cwd, a Laravel-specific card exposes common
  `artisan` commands (migrate, queue:work, route:list, tinker) as one-click snippets into a
  terminal pane — this is a curated `templates`/`snippets` seed (doc `features/21-productivity.md`),
  not custom backend logic.
- **Flutter**: `flutter doctor` summary + connected device list (`flutter devices`) surfaced as a card.

## 5. ADB (Android Debug Bridge)

- `AdbPanel` lists connected devices/emulators (`adb devices -l`), with quick actions: install APK
  (via SFTP upload of a local APK, then `adb install <remote-path>`), logcat streaming into a
  virtualized log view (reusing the container-logs UI primitive from doc
  `features/15-docker-kubernetes.md`), and shell (`adb shell` opened as a terminal pane).

## 6. Docker & Kubernetes

- These have first-class dedicated panels already (doc `features/15-docker-kubernetes.md`); the
  Dev Tools activity is where a **detection card** links out to that panel when Docker/kubectl is
  present on the host, keeping one discoverable entry point ("Tools detected on this host") rather
  than duplicating UI.

## 7. Implementation notes

- All parsing (git porcelain, `npm outdated --json`, `os-release`, etc.) lives in small, independently
  unit-tested parser functions (mirroring the pattern in `infrastructure/monitoring/parsers`,
  doc 05 §3.4) so new tool integrations are cheap to add and don't risk the core SSH/session code.
- No dev-tool integration requires new database tables; results are ephemeral queries, with Laravel/
  Flutter quick commands sourced from the shared `templates`/`snippets` tables (doc 04 §3.8).

## 8. Commands

No new dedicated commands — built on `session_run_command` (doc 07 §4.3) plus `templates_render`/
`snippets_run` (doc 07 §4.8) for the quick-action snippets.

## 9. Acceptance criteria

- On a host with Node+pnpm+Rust+Docker installed, exactly those cards appear; a bare Alpine host
  with only `git` shows only the Git card.
- Git panel reflects a real dirty working tree accurately and can stage/commit/diff.
- GitHub PR status for the current branch displays when a token is configured, and the panel
  degrades gracefully (no crash, just an "connect a token" prompt) when it isn't.
- Laravel/Flutter/ADB quick actions correctly pre-fill and open a terminal pane without auto-running.
