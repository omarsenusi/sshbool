# 21 — Plugin SDK & Marketplace

Expands the sandbox model summarized in doc 01 §9 and doc 05 §3.9 into a full SDK/marketplace spec.
Backend: `infrastructure/plugins/*`; domain `plugins`; UI `features/plugins`.

## 1. Scope checklist

Plugin SDK · Marketplace · Themes · Extensions · Widgets.

## 2. Two extension surfaces

| Surface | Runtime | Use for | Isolation |
|---|---|---|---|
| **Logic plugins** | WASM (compiled from Rust/AssemblyScript/C/etc. to `wasm32-wasi`), run in **Wasmtime** inside the Rust core | Custom parsers, generators, integrations, background automations | Wasmtime sandbox + explicit capability-gated host functions (no ambient system access) |
| **UI plugins** | React micro-frontend loaded in a sandboxed `<iframe>` (`PluginHostFrame`) | Custom panels, dashboard widgets, palette commands with a visual surface | `iframe sandbox` attribute + a strictly-typed `postMessage` bridge (`usePluginBridge`) — no direct DOM/window access to the host app |

A single plugin manifest can declare both a logic module and a UI entry, or just one.

## 3. Manifest & permissions

```json
{
  "slug": "example-nginx-helper",
  "name": "Nginx Helper",
  "version": "1.0.0",
  "sshboolApiVersion": "1",
  "logic": { "wasmEntry": "logic.wasm" },
  "ui": { "entry": "ui/index.html", "surfaces": ["dashboard-widget", "palette-command"] },
  "permissions": [
    "hosts.read",
    "sessions.exec",
    "net.connect:*.example.com",
    "ui.notify"
  ]
}
```

- Permissions are **capability strings**, checked by `plugins/capabilities.rs` (`CapabilityChecker`)
  on every host-function call and every bridged command — deny-by-default; nothing is implicitly
  granted by installation alone.
- Sensitive capabilities (`hosts.read`, `sessions.exec`, `credentials.*`, `net.connect`) require
  **explicit user grant** via `PermissionGrantDialog` at install time and are individually
  revocable later (`plugins_grant`/`plugins_revoke`) from `InstalledPluginsList`.
- There is **no** capability that grants raw filesystem or arbitrary process execution on the
  host machine — plugins can only act through the same typed, audited use cases the core app uses
  (e.g. `hosts.read` maps to read-only query use cases, `sessions.exec` maps to `session_run_command`
  scoped to hosts the user has explicitly authorized for that plugin).

## 4. Logic plugin host functions (bridge surface)

`infrastructure/plugins/bridge.rs` exposes a minimal, versioned set of host functions to WASM
guests, each gated by its matching capability:

```
hosts_list() -> read-only host summaries           [hosts.read]
run_command(hostId, cmd) -> exec result             [sessions.exec, scoped to granted hosts]
ui_notify(message, level)                           [ui.notify]
http_fetch(url) -> response                         [net.connect:<pattern>]
storage_get/set(key, value)                         [plugin-private KV, no permission needed]
```

The list is intentionally small in v1 and grows only as concrete plugin use cases justify new,
narrowly-scoped host functions (each addition reviewed for security impact, doc 22).

## 5. UI plugin bridge

`usePluginBridge` wraps `postMessage` with a typed RPC layer mirroring the same capability model:
a UI plugin cannot query anything the manifest didn't request and the user didn't grant. Widgets
register into named `WidgetSlot`s (e.g. `dashboard-widget`, `secondary-sidebar-panel`) so the host
app controls layout; plugins control only their slot's content.

## 6. Themes as a lightweight plugin category

- App and terminal themes (`themes` table, doc 04 §3.12) are the simplest plugin type: pure data
  (token JSON), no code execution, so they carry no permission model at all and can be
  installed/previewed instantly from the marketplace.

## 7. Marketplace

- `MarketplacePanel`/`plugins_search_marketplace` queries a public registry (a simple signed-index
  service, not part of this app's core — see doc 25 for hosting) for plugins/themes, showing name,
  author, description, permissions required, and install count/rating.
- Every marketplace package is **signature-verified** before install (publisher key signs the
  manifest + artifact hash); unsigned or tampered packages are rejected outright.
- `PluginCard` → `PluginDetailsSheet` (readme, permissions, changelog) → install triggers
  `PermissionGrantDialog` for any non-trivial capability before the plugin becomes active.
- Local/sideloaded plugins (`source: "local"`) skip the registry but go through the same
  permission-grant flow — sideloading is for development and trusted internal tooling.

## 8. SDK (for plugin authors)

- A small `@sshbool/plugin-sdk` TS package (typed manifest schema, `usePluginBridge` types, host
  function typings) plus a Rust `sshbool-plugin-sdk` crate (WASM guest bindings, capability
  typings) — both versioned against `sshboolApiVersion` so the host can reject incompatible plugins
  with a clear error rather than crashing.
- CLI scaffolding (`create-sshbool-plugin`) generates a starter logic+UI plugin with the manifest,
  build config (targeting `wasm32-wasi` / Vite for the UI half), and a local dev-install workflow
  (`plugins_install({ slug, source: "local" })` pointed at a local build output directory).

## 9. Commands

`plugins_list`, `plugins_search_marketplace`, `plugins_install`, `plugins_uninstall`,
`plugins_enable/disable`, `plugins_grant/revoke`, `plugins_invoke` (doc 07 §4.11).
Event: `plugin://event/{slug}`.

## 10. Acceptance criteria

- A sample logic plugin can read a granted host's info and run a scoped command, but a call for
  an ungranted capability or an unauthorized host is rejected with a clear error, not a crash.
- A sample UI plugin renders in a dashboard widget slot with zero access to the host app's DOM
  outside the sandboxed iframe/bridge.
- Installing a theme requires no permission dialog; installing a plugin with `sessions.exec`
  requires explicit grant, and revoking it immediately blocks further exec calls.
- A tampered marketplace package (modified artifact, unmatched signature) is rejected at install.
- Disabling a plugin stops all its scheduled/background activity immediately.
