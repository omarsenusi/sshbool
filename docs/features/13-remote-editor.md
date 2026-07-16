# Feature 13 — Remote File Editor

Backend: `application/transfers` (read/write via SFTP) + `infrastructure/ssh/sftp.rs`; UI `features/editor`.

## 1. Scope checklist

Monaco Editor · Syntax highlighting · Auto save · Compare changes · Upload on save · Diff viewer ·
Git integration · Search · Replace · Multi cursor.

## 2. Core model

- Opening a remote file (`useRemoteFile(hostId, path)`) reads it via `sftp_stat` + a streamed read,
  loads it into a Monaco model with language inferred from extension/shebang, and keeps an
  in-memory "last-saved" snapshot for diffing and dirty-state tracking.
- Editing is entirely local (in the webview); nothing is written remotely until save — avoiding
  partial/corrupt remote writes and enabling instant, network-independent typing.
- Large files (> configurable threshold, default 5MB) open in a lightweight/read-only mode with a
  warning, to protect editor responsiveness (ties into doc 23 performance budget).

## 3. Syntax highlighting & languages

- Monaco's built-in language services cover common ops languages out of the box: shell, YAML,
  JSON, TOML, INI, Dockerfile, nginx/Apache config (custom Monarch grammars added for these two,
  since Monaco lacks first-class support), PHP, Python, Go, Rust, JS/TS, SQL, Markdown, systemd unit files.
- Language is auto-detected by extension/filename (`Dockerfile`, `nginx.conf`, `*.service`) with a
  manual override in the status bar (`EditorStatusBar` language picker).

## 4. Autosave & upload-on-save

- **Autosave** (local buffer only, debounced) prevents in-app data loss on crash/reload; does not
  by itself write to the remote host.
- **Upload on save** (explicit `Ctrl/Cmd+S` or autosave-to-remote setting) streams the buffer via
  `sftp` write to a **temp file alongside the target**, then atomically renames over the original
  (`rename` is atomic on POSIX filesystems) — avoiding truncated files if the transfer is interrupted.
- Before overwriting, the editor re-checks the remote file's mtime/size against what was loaded;
  if it changed externally, an `UnsavedChangesDialog`-style conflict prompt offers reload/diff/force-save.
- `SaveIndicator` shows: clean / local-dirty / uploading / uploaded / conflict.

## 5. Diff viewer & compare changes

- `DiffViewer` (Monaco's built-in diff editor) compares: current buffer vs. last-saved-remote
  snapshot, or two arbitrary revisions (e.g. via git, or two downloaded snapshots).
- Used for: pre-save review ("what will I upload?"), git working-tree diffs, and comparing a local
  file against its remote counterpart in the SFTP preview flow (doc `features/11-sftp.md` §6).

## 6. Git integration

- If the remote file's directory is inside a git repo (`session_run_command` probes `git rev-parse`),
  the editor shows: current branch, dirty/staged indicators in the gutter (added/modified/removed
  lines via `git diff` parsing), and file status in `EditorStatusBar`.
- Lightweight actions available from the editor: stage/unstage this file, view file history log,
  open diff against `HEAD`. Full repository management (branches, commits, log) lives in the
  dedicated Git panel (doc `features/17-dev-tools.md`), which this editor integration links to.

## 7. Search, replace, multi-cursor

- Monaco's native find/replace (`FindReplacePanel`) with regex, case, whole-word, replace-all,
  and find-in-selection.
- Multi-cursor editing (Alt+Click, Ctrl/Cmd+D select-next-occurrence, column selection) — all
  native Monaco capabilities, exposed with the same keybindings developers already know from VS Code,
  customizable via the Keyboard settings page (doc 09 §11).

## 8. Tabs & workflow

- `EditorTabs` — multiple remote files open per session, each tracking its own host/path/dirty state.
- Closing a dirty tab prompts `UnsavedChangesDialog` (Save & Upload / Discard / Cancel).
- Editor tabs coexist with terminal/SFTP tabs in the same `WorkspaceArea` pane grid (doc 09 §1), so a
  config file can be edited side-by-side with the terminal tailing its reload log.

## 9. Commands & data

Reuses SFTP commands for I/O: `sftp_stat`, streamed read/write (extension of `sftp_*`, doc 07 §4.4).
No new tables — edits are ephemeral client state until saved; git status via `session_run_command`.

## 10. Acceptance criteria

- Open, edit, and upload-on-save a config file on a real host; verify atomic replace (no truncation
  even if the connection is killed mid-write and retried).
- External change detection triggers the conflict dialog and resolves via reload/diff/force.
- Git gutter indicators and branch name are correct for a real dirty working tree.
- Multi-cursor edit + find/replace across a large file behaves identically to VS Code's Monaco.
- Nginx/Apache/systemd files get sensible syntax highlighting despite lacking Monaco defaults.
