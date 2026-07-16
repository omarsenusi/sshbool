# 09 — Screens, Wireframes & Dialogs

ASCII wireframes for every screen, plus the full inventory of dialogs and settings pages. These are
layout blueprints, not pixel specs (visual language in doc 08).

## 1. Global shell

```
┌───────────────────────────────────────────────────────────────────────────┐
│ ● ● ●   SSHBool                          ⌘K Search…            – ▢ ✕        │  Title bar
├──┬────────────────────────┬───────────────────────────────────┬────────────┤
│A │ PRIMARY SIDEBAR        │  WORKSPACE (tabs + split panes)     │ SECONDARY  │
│c │ (context of activity)  │ ┌─Tabs──────────────────────────┐   │ SIDEBAR    │
│t │                        │ │ term ▸ sftp ▸ editor ▸ dash + │   │ (AI /      │
│i │  e.g. Host Tree        │ ├───────────────┬───────────────┤   │  Notes /   │
│v │                        │ │  pane          │  pane          │   │  Transfers)│
│i │                        │ │                │                │   │            │
│t │                        │ └───────────────┴───────────────┘   │            │
│y │                        │                                     │            │
├──┴────────────────────────┴───────────────────────────────────┴────────────┤
│ ⚡ conn: prod-web · 12ms   ▸ ⇅ 2 transfers   🔒 vault unlocked   ☁ synced    │  Status bar
└───────────────────────────────────────────────────────────────────────────┘
Activity bar (A): Connections · Terminal · SFTP · Editor · Dashboard · Docker ·
                  Databases · DevTools · AI · Plugins ······ Settings (bottom)
```

## 2. Home / Connect

```
┌ Connections ────────────────┐ ┌ WORKSPACE (Home) ─────────────────────────┐
│ 🔎 Filter hosts…             │ │  Quick Connect: user@host:port   [Connect] │
│ ▾ Production                 │ │                                            │
│   • prod-web    ★ 📌         │ │  ⭐ Favorites            📌 Pinned          │
│   • prod-db                  │ │  ┌────┐ ┌────┐ ┌────┐   ┌────┐ ┌────┐      │
│ ▾ Staging                    │ │  │web │ │db  │ │k8s │   │edge│ │ci  │      │
│   • stg-web                  │ │  └────┘ └────┘ └────┘   └────┘ └────┘      │
│ ▸ Bastions                   │ │                                            │
│ #tags: web db k8s edge       │ │  🕘 Recent                                  │
│ [+ Host] [+ Group] [Import]  │ │  prod-web · 2m ago    stg-web · 1h ago      │
└──────────────────────────────┘ └────────────────────────────────────────────┘
```

## 3. Terminal workspace

```
┌ Sessions ───────────┐ ┌ term: prod-web ─ split ─ term: prod-db ────────────┐
│ ▾ prod-web           │ │ user@prod-web:~$ tail -f /var/log/nginx/access.log │
│   • shell 1 ● rec    │ │ ...                                                │
│   • shell 2          │ ├────────────────────────────────────────────────────┤
│ ▾ prod-db            │ │ user@prod-db:~$ psql                               │
│   • shell 1          │ │ ...                                                │
│ [+ New] [Split ⬍ ⬌]  │ │ [🔎 search] [⧉ copy] [rec ●] [profile ▾]           │
└──────────────────────┘ └────────────────────────────────────────────────────┘
```

## 4. SFTP dual-pane

```
┌ Bookmarks ──────────┐ ┌ LOCAL  /home/me/proj ─────┬ REMOTE /var/www ──────────┐
│ ★ /var/www          │ │ Name        Size  Modified│ Name       Size  Perms    │
│ ★ /etc/nginx        │ │ 📁 src            2d       │ 📁 html          rwxr-xr-x│
│ ★ ~/backups         │ │ 📄 .env     1KB   1h      │ 📄 index    4KB   rw-r--r--│
│                     │ │ 📄 pkg.json 2KB   3h      │ 📄 app.php  9KB   rw-r--r--│
│ [+ Bookmark]        │ │ ▸ drag to upload ⇒        │ ⇐ drag to download        │
├─────────────────────┤ ├───────────────────────────┴───────────────────────────┤
│ Transfer Queue      │ │ ⇅ app.php  ▓▓▓▓▓▓░░ 62%  1.2MB/s   [pause][cancel]      │
└─────────────────────┘ └────────────────────────────────────────────────────────┘
Toolbar: [Upload][Download][New Folder][Rename][Delete][Chmod][Compare][Sync][Refresh]
```

## 5. Remote editor

```
┌ Files ──────────────┐ ┌ nginx.conf ● (unsaved) ── diff ▸ ─────────────────────┐
│ /etc/nginx          │ │  1  server {                                          │
│  • nginx.conf ●     │ │  2      listen 80;                                    │
│  • sites/…          │ │  3      server_name example.com;                      │
│                     │ │  …  [multi-cursor] [find/replace] [minimap]           │
├─────────────────────┤ ├───────────────────────────────────────────────────────┤
│ Autosave: on        │ │ UTF-8 · LF · nginx · git:+3 −1   [Save & Upload ⤴]     │
└─────────────────────┘ └───────────────────────────────────────────────────────┘
```

## 6. Server dashboard

```
┌ Host: prod-web · Ubuntu 24.04 · up 32d ─────────────────────────────────────┐
│ ┌ CPU 34% ▁▂▅▇▅▂ ┐ ┌ MEM 6.2/16G ▓▓▓░ ┐ ┌ SWAP 0/2G ┐ ┌ LOAD 0.8 0.6 0.5 ┐ │
│ └────────────────┘ └──────────────────┘ └───────────┘ └──────────────────┘  │
│ ┌ DISK / 62% ─┐ ┌ NET ↓12M ↑3M ▁▃▂▇ ┐ ┌ TEMP 48°C ┐ ┌ UPDATES: 7 (2 sec) ┐  │
│ └─────────────┘ └───────────────────┘ └───────────┘ └────────────────────┘  │
│ ┌ Processes ─────────────────┐ ┌ Services (systemd) ──────────┐              │
│ │ PID  CPU  MEM  CMD    [kill]│ │ nginx    active  [restart]    │              │
│ │ 1123 22%  1.1G nginx        │ │ mysql    active  [stop]       │              │
│ └─────────────────────────────┘ └───────────────────────────────┘             │
└──────────────────────────────────────────────────────────────────────────────┘
```

## 7. Docker panel

```
┌ [Containers] Images  Volumes  Networks  Compose ─────────────────────────────┐
│ NAME        IMAGE        STATUS     PORTS       CPU  MEM     ACTIONS          │
│ web         nginx:1.27   up 2d      80→8080     3%   40MB    ▶⏹⟳ ⌨ 📄 📊      │
│ api         node:22      up 2d      3000        12%  210MB   ▶⏹⟳ ⌨ 📄 📊      │
│ db          postgres:16  up 2d      5432        5%   380MB   ▶⏹⟳ ⌨ 📄 📊      │
├──────────────────────────────────────────────────────────────────────────────┤
│ Logs: api  ────────────────────────────────────────────────────  [follow ▸]  │
│ 12:01 GET /health 200 ...                                                     │
└──────────────────────────────────────────────────────────────────────────────┘
```

## 8. Database client

```
┌ Connections ─────┐ ┌ Query ───────────────────────────────────────────────────┐
│ ▾ prod-pg        │ │ SELECT * FROM users WHERE active = true LIMIT 100;  [Run ▸]│
│   ▾ public       │ ├──────────────────────────────────────────────────────────┤
│     • users      │ │ id │ email          │ active │ created_at                 │
│     • orders     │ │ 1  │ a@b.com        │ t      │ 2026-01-02                 │
│   ▸ analytics    │ │ 2  │ c@d.com        │ t      │ 2026-01-05                 │
│ ▸ cache (redis)  │ │ … 100 rows · 8ms          [Export CSV][Export JSON]       │
│ [+ Connection]   │ └──────────────────────────────────────────────────────────┘
└──────────────────┘ Saved queries ▸   History ▸
```

## 9. AI copilot (secondary sidebar)

```
┌ AI Copilot ──────────────────────┐
│ context: prod-web · last cmd ✓    │
│ ┌ You ────────────────────────┐   │
│ │ why is nginx returning 502? │   │
│ └─────────────────────────────┘   │
│ ┌ Assistant ──────────────────┐   │
│ │ Likely upstream is down.    │   │
│ │ Run: systemctl status php…  │   │
│ │  [Copy] [Run in terminal]   │   │
│ └─────────────────────────────┘   │
│ [Explain] [Analyze logs] [Gen]    │
│ > ask about this host…      [↵]   │
└───────────────────────────────────┘
```

## 10. Full dialog inventory

Connections: `HostEditorDialog`, `GroupDialog`, `TagManagerDialog`, `ImportHostsDialog`,
`ExportHostsDialog`, `PortForwardDialog`, `JumpHostPicker`, `ProxyDialog`, `HostKeyPromptDialog`
(new/changed fingerprint trust).

Vault/keys: `SetupVaultDialog`, `UnlockScreen`, `ChangePasswordDialog`, `GenerateKeyDialog`,
`ImportKeyDialog`, `KeyDetailsPanel`, `PassphraseDialog`, `HardwareKeyDialog`, `ExportPrivateKeyDialog` (guarded), `BackupVaultDialog`, `RestoreVaultDialog`.

SFTP: `PermissionsDialog`, `RenameDialog`, `NewFolderDialog`, `ConfirmDeleteDialog`,
`FolderCompareDialog`, `SyncSetupDialog`, `OverwriteResolveDialog`, `FilePreviewSheet`.

Terminal: `SessionProfileDialog`, `SplitLayoutMenu`, `ExportLogDialog`, `SearchBar`.

Editor: `FindReplacePanel`, `DiffViewer`, `UnsavedChangesDialog`, `EncodingPicker`.

Docker/K8s: `PullImageDialog`, `ComposeActionDialog`, `ExecShellDialog`, `ContextPicker`.

DB: `DbConnectionDialog`, `SaveQueryDialog`, `ExportResultDialog`, `ConfirmDestructiveQueryDialog`.

AI: `AiSettingsDialog`, `ProviderDialog`, `GenerateConfigDialog`.

Sync/plugins: `DevicePairingDialog`, `ConflictResolverDialog`, `VersionHistoryDialog`,
`PermissionGrantDialog`, `PluginDetailsSheet`, `UninstallConfirmDialog`.

App: `CommandPalette`, `AboutDialog`, `UpdateAvailableDialog`, `ShortcutCheatSheet`, `ConfirmDialog` (generic).

## 11. Settings pages (`/settings/:section`)

```
General        — startup, language (RTL), density, default shell, confirmations
Appearance     — theme (dark/light/system), accent, glass intensity, motion, fonts
Terminal       — profiles, color schemes, cursor, scrollback, bell, ligatures, copy-on-select
Editor         — Monaco theme, tab size, autosave, upload-on-save, format-on-save
SFTP           — default transfer concurrency, resume, overwrite policy, thumbnails
Connections    — default port/auth, keepalive, compression, connection sharing
Security       — master password, biometric unlock, auto-lock timeout, session timeout,
                 known_hosts policy, certificate validation, clear secrets on lock
Keys & Agent   — SSH agent integration, hardware key setup, default key
Sync           — enable, endpoint/account, devices, auto-backup, version history
AI             — providers, model, redaction rules, enabled tasks, cost caps
Plugins        — installed, permissions, marketplace source, auto-update
Keyboard       — keymap editor (VS Code/custom), per-command bindings, conflicts
Updates        — channel (stable/beta), auto-update, current version, release notes
Advanced       — logging level, data dir, export/reset settings, diagnostics
About          — version, licenses, credits, license key / plan
```

## 12. Onboarding flow (first run)

```
1) Welcome  → 2) Create master password (+ optional biometric)
→ 3) Import existing (~/.ssh/config, Termius/MobaXterm export) [optional]
→ 4) Add first host / Quick connect
→ 5) Optional: enable sync, pick theme, choose AI provider
→ Done → Home
```
