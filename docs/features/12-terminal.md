# Feature 12 — Terminal

Backend: `infrastructure/ssh/pty.rs` + `sessions/*` (doc 05); domain `sessions`; UI `features/terminal`.

## 1. Scope checklist

xterm.js base · Tabs · Split panes · Multiple sessions · Saved sessions · Profiles · ANSI colors ·
Unicode · Emoji · Search · Copy · Paste · Links · Mouse support · Bracketed paste · Command
history · Auto scroll · Session recording · Export terminal logs.

## 2. Rendering engine

- **xterm.js** with addons: `addon-fit`, `addon-webgl` (fallback `addon-canvas` on unsupported
  GPUs), `addon-search`, `addon-web-links`, `addon-unicode11`, `addon-serialize`.
- Full **ANSI/SGR** color support (16/256/truecolor), **Unicode 11** grapheme clustering so emoji
  and combining characters render as single cells.
- Font: JetBrains Mono / Cascadia Code with ligature toggle; configurable size/line-height per
  terminal profile (`terminal_profiles` table, doc 04 §3.12).

## 3. Panes, tabs, splits

- `TerminalPane` wraps one xterm instance bound to one `PaneId` (`session_panes` table).
- `TerminalTabs` — reorderable tabs per session; `TerminalSplit` — dnd-kit powered grid (horizontal/
  vertical splits, nested), layout persisted via `layout_save`/`layout_get` (doc 07 §4.3).
- Multiple simultaneous sessions across different hosts, each with its own tab group; the
  `ActivityBar → Terminal` primary sidebar lists all sessions/panes in a tree (mirrors dashboard 09 §3).
- **Saved sessions**: a host's default pane layout + profile is restorable on reconnect ("Reopen
  last layout" setting).

## 4. Profiles

- `TerminalProfile`: font family/size/line-height, color scheme (`themes.kind='terminal'`), cursor
  style (block/bar/underline, blink), scrollback size, bell (visual/audio/none), copy-on-select,
  right-click paste. Assignable per host or globally as default.

## 5. Input & interaction

- **Copy/Paste**: select-to-copy (optional auto-copy), Ctrl/Cmd+Shift+C/V, right-click context menu.
- **Links**: `addon-web-links` auto-detects URLs/paths; click to open (external) or reveal in SFTP.
- **Mouse support**: xterm mouse reporting modes for full-screen TUIs (vim, htop, tmux, mc).
- **Bracketed paste**: enabled by default so pasted multi-line text isn't mis-interpreted by shells/TUIs.
- **Search**: in-pane find bar (`addon-search`) with regex/case/whole-word, highlight + next/prev.
- **Auto scroll**: follows new output unless the user has scrolled up (then a "jump to bottom" affordance appears); configurable scrollback cap (default 10,000 lines, memory-bounded — see doc 23).

## 6. Command history

- Every executed command (heuristically parsed from PTY output via shell-integration markers, and
  explicitly from `session_run_command`) is recorded to `command_history` (doc 04 §3.3).
- Surfaced in: the command palette (fuzzy search across hosts), an in-pane history dropdown
  (Ctrl+R style), and as AI context (doc `features/20-ai-assistant.md`).
- Optional **shell integration** snippet (bash/zsh/fish/PowerShell) injected on connect (opt-in) to
  mark command boundaries + exit codes precisely (OSC 133-style sequences), improving history
  accuracy and enabling "jump to previous prompt" navigation.

## 7. Session recording & export

- `recording_start`/`recording_stop` capture pane I/O as **asciicast v2** (`recordings` table, doc
  04 §3.3) — replayable in-app (`RecordingIndicator` → replay viewer) or exportable for `asciinema`.
- `session_export_log` exports the visible/scrollback buffer as plain text or ANSI-preserving log
  (`.log`/`.txt`), for compliance/audit or sharing.
- Recordings and logs never capture the vault unlock/password prompts (redaction filter on known
  sensitive patterns, e.g. `sudo` password prompts, matching the redaction rules in doc 22).

## 8. Data flow & performance

- Bytes stream Rust → frontend via `terminal://data/{paneId}` events; keystrokes go frontend → Rust
  via `pane_write`. Both paths bypass React state (doc 06 §8) — written directly to/from the xterm
  buffer and the actor's channel for minimal latency.
- Output is **not** throttled at the byte level (interactivity matters), but very high-volume output
  (e.g. `yes`, build logs) is chunked and coalesced per animation frame to protect the render loop.

## 9. Commands & events

`session_open/close`, `pane_open/close/resize/write`, `session_run_command`, `recording_start/stop`,
`session_export_log`, `sessions_list`, `command_history_search`, `layout_save/get` (doc 07 §4.3).
Events: `terminal://data/{paneId}`, `terminal://exit/{paneId}`.

## 10. Acceptance criteria

- 256-color and truecolor art (e.g. `lolcat`, neofetch) renders correctly; emoji render as single
  glyphs; full-screen TUIs (vim, htop, tmux) work with mouse + resize.
- Split into 4 panes across 2 hosts, resize, close/reopen the app, layout restores.
- Search finds and highlights matches in a 10k-line scrollback without jank.
- Start/stop a recording, replay it, export a log; verify no secrets appear in either.
- Command history captures commands across a real session and is searchable in the palette.
