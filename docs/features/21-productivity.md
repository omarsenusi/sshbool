# Feature 21 — Productivity

Backend: `application/knowledge/*` (doc 05 §2.8); domain `knowledge`; UI `features/productivity`.

## 1. Scope checklist

Quick Connect · Command Snippets · Favorite Commands · Templates · Notes · Markdown Notes ·
Color Labels · Global Search · Command Palette · Keyboard Shortcuts.

## 2. Quick Connect

- The `QuickConnectBar` on Home (doc 09 §2) accepts a raw `user@host:port` (or a saved-host name
  fuzzy match) and connects immediately without requiring a saved host profile first — for
  one-off/ad-hoc access. A successful quick connect offers a one-click "Save as host" follow-up.

## 3. Command snippets & favorite commands

- `Snippet` (doc 04 §3.8): name, body (with `{{variable}}` placeholders), language/shell,
  tags, shortcut, usage count, favorite flag.
- `SnippetLibrary` UI: browse/search/tag-filter; `SnippetEditorDialog` for authoring.
- **Run**: `snippets_run({ id, paneId })` fills variables (a small inline form if the snippet has
  placeholders) then sends the resolved text to the target terminal pane via `pane_write` — never
  auto-submits with Enter unless the user opts into "auto-run" per snippet (off by default, since
  many snippets are destructive by nature).
- **Favorite commands** are simply snippets with `is_favorite = true`, surfaced in a dedicated
  quick-pick (`SnippetQuickPick`) and pinned to the top of the command palette's snippet results —
  no separate data model needed, keeping the mental model simple.
- Frequently-run non-snippet commands (from `command_history`, doc `features/12-terminal.md` §6)
  are also promotable to a snippet with one click ("Save as snippet").

## 4. Templates

- `Template` (doc 04 §3.8): kind (`nginx`/`apache`/`compose`/`systemd`/`custom`), body with
  `{{variable}}` placeholders, and a `variables_json` schema (name, type, default, description)
  driving an auto-generated form in `TemplateRenderDialog`.
- `templates_render` fills the form values into the body and returns the result, which the user
  can open directly in the Remote Editor to review/save — the same "AI generates a draft" pattern
  from doc `features/20-ai-assistant.md` §5 applies here (human-authored templates instead of
  AI-authored ones), and in fact AI-generated configs can be **saved as a new template** for reuse.
- `TemplateGallery` ships a curated starter set (basic Nginx reverse proxy, Apache vhost, a
  three-service Compose stack, a generic systemd unit) so the feature has immediate value on day one.

## 5. Notes (including Markdown)

- `Note` (doc 04 §3.8): title, `body_md` (Markdown), optional `host_id` (host-scoped notes appear
  contextually in that host's workspace; host-less notes are general/global), color, pinned flag.
- `NotesPanel`: split editor/preview (or live-render toggle) using the same Markdown rendering
  pipeline as the AI chat's markdown messages (shared component, doc 06 §4.11) for visual consistency.
- Typical use: runbooks, incident notes, "gotchas for this server," credentials reminders (never
  actual secrets — notes are **not** encrypted vault storage, and the UI reminds users of this).

## 6. Color labels

- A single `color` concept (already present on `hosts` and `notes`, doc 04) with a shared palette
  and `ColorLabelPicker` component, used consistently across the host tree, tabs, and notes for
  at-a-glance visual grouping (e.g. red = production, blue = staging) — not a separate feature
  module, but a cross-cutting UI primitive documented here for completeness.

## 7. Global search

- `search_global({ query, scopes[] })` federates FTS5 queries (doc 04 §4) across hosts, snippets,
  notes, saved DB queries, and command history in one ranked result list, grouped by type with
  jump-to-source actions (open host, insert snippet, open note, rerun query).
- Exposed both as a dedicated `GlobalSearch` surface and as the data source for the Command Palette's
  non-command results (see below) — one federated index, two entry points.

## 8. Command palette

- `CommandPalette` (⌘K/Ctrl+K): the single most important productivity surface. Sources, merged
  and ranked:
  1. **Commands** — every registered action in `useCommandRegistry` (doc 06 §6): "New Terminal",
     "Open Settings", "Toggle Theme", panel navigation, etc.
  2. **Hosts** — fuzzy match by label/hostname/tag → connect.
  3. **Snippets** — fuzzy match by name → run in active pane.
  4. **Search results** — federated `search_global` for notes/queries/history when the query looks
     like a search rather than a command (heuristic: no exact command/host match).
- Fully keyboard-driven (arrow navigation, Enter to execute, Esc to dismiss), consistent with the
  "keyboard-first" design principle (doc 08 §1).

## 9. Keyboard shortcuts

- `keybindings` table (doc 04 §3.12) stores user overrides on top of sensible defaults (VS
  Code-familiar chords where there's no conflict with terminal passthrough — e.g. `Ctrl+Shift+P`
  for the palette rather than `Ctrl+P` alone, which must reach the shell).
- `useCommandRegistry` ties every command to both a palette entry and an optional default
  shortcut; the Keyboard settings page (doc 09 §11) provides a searchable keymap editor with
  live conflict detection (warns if a new binding shadows an existing one, including
  terminal-critical chords).

## 10. Commands

`snippets_list/upsert/delete/run`, `notes_list/upsert/delete`, `templates_list/render`,
`search_global`, plus `keybindings_list/set` and `settings_get/set` for shortcuts (doc 07 §4.8, §4.12).

## 11. Acceptance criteria

- Quick Connect to an ad-hoc host, then save it as a full host profile in one click.
- Create a snippet with two variables, run it against a live pane with correct substitution, and
  confirm it does not auto-submit unless auto-run is explicitly enabled.
- Render the built-in Nginx template, edit a variable, and open the result in the Remote Editor.
- Create a host-scoped note and a global note; confirm each appears in the right context.
- Command palette returns commands, hosts, snippets, and search results in one ranked list within
  a perceptible-instant budget (see doc 23 latency targets) on a database with thousands of rows.
- Rebind a shortcut to a chord that conflicts with an existing one and see the conflict warning.
