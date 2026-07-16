# 06 — React Frontend Architecture

Feature‑first React 19 SPA on Vite (ADR‑002). This doc enumerates the component tree, stores,
hooks, and the IPC layer. Building blocks are shadcn/ui + Tailwind v4 (design tokens in doc 08).

## 1. Application shell

```
<App>
  <Providers>                         // theme, query, i18n, tooltip, keybindings, error boundary
    <AppShell>
      <TitleBar/>                      // custom window chrome (macOS traffic lights / win controls)
      <ActivityBar/>                   // left icon rail: Connections, Terminal, SFTP, Editor,
                                        //   Dashboard, Docker, DB, DevTools, AI, Plugins, Settings
      <PrimarySidebar/>                // context panel for the active activity (e.g. host tree)
      <WorkspaceArea>                  // tabbed, splittable panes
        <TabBar/>
        <PaneGrid/>                    // dnd-kit split panes hosting feature surfaces
      </WorkspaceArea>
      <SecondarySidebar/>              // optional right panel (AI copilot, notes, transfer queue)
      <StatusBar/>                     // connection state, latency, transfers, vault lock, sync
      <CommandPalette/>                // ⌘K global
      <Toaster/>
    </AppShell>
  </Providers>
</App>
```

## 2. State management (ADR‑005)

### 2.1 Zustand stores (`src/stores/`)
- `layout.store.ts` — activity bar selection, sidebar sizes, pane grid tree, tab order.
- `session.store.ts` — open sessions, active pane, per‑pane runtime handles (xterm instances kept in a non‑reactive `Map`).
- `vault.store.ts` — lock state (mirrors backend `app://lock`).
- `palette.store.ts` — command palette open/query/results.
- `transfer.store.ts` — live transfer progress (fed by events; React Query holds the list).
- `theme.store.ts` — theme id, density, motion preference.

### 2.2 React Query (`src/app/query-client.ts`)
- All command reads (`hosts_list_tree`, `snippets_list`, `db_list`, …) are queries.
- Mutations (`hosts_create`, …) invalidate the relevant query keys and support optimistic updates.
- Query keys are centralized in `src/lib/ipc/keys.ts`.

### 2.3 Events → state
- `useEvent(topic, handler)` subscribes to Tauri events; handlers write to Zustand or push xterm bytes.
- Terminal bytes bypass React entirely (written straight to the xterm instance) for performance.

## 3. IPC layer (`src/lib/ipc/`)

- `types.ts` — **generated** from Rust (`ts-rs`).
- `schemas/` — zod schemas mirroring DTOs; validate on the boundary in dev, tree‑shaken in prod.
- `commands.ts` — typed wrappers: `export const hostsCreate = (dto: NewHostDto) => invoke<HostId>("hosts_create", { dto })`.
- `events.ts` — typed `listen`/`useEvent` helpers keyed by the topic table (doc 07 §3).
- `keys.ts` — React Query key factory.
- `errors.ts` — narrows `AppError` union → user‑facing localized message + toast/inline mapping.

## 4. Feature modules (components) — the full inventory

Each feature folder = `components/ hooks/ store.ts api.ts index.ts`.

### 4.1 `connections/`
- `HostTree` (virtualized TreeView of groups/hosts), `HostTreeNode`, `HostContextMenu`.
- `QuickConnectBar`, `HostCard` (favorites/pinned grid), `RecentHostsList`.
- `HostEditorDialog` (tabs: General, Auth, Proxy/Jump, Tunnels, Terminal, Advanced), `GroupDialog`, `TagPicker`, `ImportHostsDialog`, `ExportHostsDialog`.
- Hooks: `useHostTree`, `useHost`, `useHostMutations`, `useHostSearch`.

### 4.2 `vault/`
- `UnlockScreen` (password + biometric button), `SetupVaultDialog`, `ChangePasswordDialog`.
- `KeyManager` (list), `KeyRow`, `GenerateKeyDialog`, `ImportKeyDialog`, `KeyDetailsPanel`, `PassphraseDialog`, `HardwareKeyDialog`.
- `CredentialPicker` (inline in HostEditor).
- Hooks: `useVaultStatus`, `useKeys`, `useAutoLock`.

### 4.3 `terminal/`
- `TerminalPane` (wraps xterm.js; webgl renderer, fit/search/weblinks/unicode11 addons), `TerminalTabs`, `TerminalSplit`, `TerminalSearchBar`, `TerminalToolbar` (copy/paste/clear/record).
- `SessionProfilePicker`, `RecordingIndicator`.
- Hooks: `useTerminal(paneId)` (creates xterm, wires `terminal://data`, sends keystrokes via `pane_write`), `useTerminalResize`, `useTerminalSearch`.
- Non‑reactive: xterm instances live in `session.store` `Map`, disposed on pane close.

### 4.4 `sftp/`
- `DualPaneExplorer` (left local / right remote or remote/remote), `FileList` (virtualized, sortable), `FileRow`, `Breadcrumb`, `PathBar`, `FileToolbar`.
- `TransferQueue` (in secondary sidebar), `TransferRow`, `TransferProgressBar`.
- Dialogs: `PermissionsDialog` (chmod matrix + chown), `RenameDialog`, `NewFolderDialog`, `ConfirmDeleteDialog`, `FolderCompareDialog`, `SyncSetupDialog`.
- Preview: `FilePreviewSheet` routing to `TextPreview` (Monaco read‑only), `ImagePreview`, `VideoPreview`, `ArchivePreview` (tree), `HexPreview`.
- Hooks: `useDir`, `useTransfers`, `useDragDropUpload`, `useSelection`.

### 4.5 `editor/`
- `RemoteEditor` (Monaco), `EditorTabs`, `DiffViewer`, `EditorStatusBar` (encoding/EOL/lang/git).
- `SaveIndicator` (autosave + upload‑on‑save), `FindReplacePanel`, `MinimapToggle`.
- Hooks: `useRemoteFile(hostId, path)` (load via sftp read, save via sftp write + optional diff), `useAutosave`, `useGitStatus`.

### 4.6 `dashboard/`
- `DashboardGrid` (draggable widgets), widgets: `CpuWidget`, `MemoryWidget`, `SwapWidget`, `LoadWidget`, `DiskWidget`, `FilesystemWidget`, `NetworkWidget`, `TemperatureWidget`, `UptimeWidget`, `KernelWidget`, `ProcessesWidget` (virtualized, killable), `ServicesWidget` (systemd control), `UpdatesWidget`.
- Charts: `Sparkline`, `AreaChart`, `Gauge` (lightweight SVG/canvas, no heavy chart lib).
- Hooks: `useSnapshot(hostId)` (subscribes `metrics://snapshot`), `useSeries`, `useProcesses`, `useServices`.

### 4.7 `containers/`
- `DockerPanel` with tabs: `ContainersTab`, `ImagesTab`, `VolumesTab`, `NetworksTab`, `ComposeTab`.
- `ContainerRow` (start/stop/restart/shell/logs/stats), `ContainerLogsView` (virtualized stream), `ContainerStatsView`, `ImageRow`, `ComposeProjectCard`.
- `KubernetesPanel` (feature‑gated): `PodsTab`, `PodLogsView`, `ContextPicker`.
- Hooks: `useContainers`, `useContainerLogs`, `useContainerStats`, `useCompose`.

### 4.8 `databases/`
- `DbSidebar` (connections tree → schemas → tables), `DbConnectionDialog`, `SchemaTree`.
- `QueryEditor` (Monaco SQL + autocomplete from schema), `ResultGrid` (virtualized DataTable, editable where safe), `ResultToolbar` (export csv/json), `SavedQueries`, `QueryHistoryList`.
- `RedisConsole`, `MongoQueryPanel`.
- Hooks: `useDbConnections`, `useSchema`, `useRunQuery`, `useQueryHistory`.

### 4.9 `devtools/`
- `DevToolsPanel` with detected‑tool cards: `GitPanel` (status/branches/commit/log), `PackageManagerPanel` (npm/pnpm/bun/composer), `RuntimePanel` (node/go/python/php/rust versions), `AdbPanel`, `KubectlPanel`.
- These are thin UIs over `session_run_command` with structured parsers.
- Hooks: `useGitStatus`, `useToolDetection`.

### 4.10 `ai/`
- `AiCopilotPanel` (secondary sidebar), `ChatThread`, `MessageBubble` (markdown + code blocks with copy/run), `PromptBar`, `ContextChips` (host/last command/selected log), `ProviderPicker`, `AiSettingsDialog`.
- Quick actions: `ExplainSelectionButton`, `AnalyzeLogsButton`, `GenerateCommandButton`, `GenerateConfigDialog`.
- Hooks: `useAiStream(requestId)` (consumes `ai://token`), `useAiProviders`.

### 4.11 `productivity/`
- `SnippetLibrary`, `SnippetEditorDialog`, `SnippetQuickPick` (in palette), `NotesPanel` (markdown editor + preview), `NoteCard`, `TemplateGallery`, `TemplateRenderDialog`.
- `CommandPalette` (global): fuzzy over commands, hosts, snippets, files, settings (federated `search_global`).
- Hooks: `useSnippets`, `useNotes`, `useGlobalSearch`.

### 4.12 `sync/`
- `SyncSettings`, `DevicePairingDialog` (QR/code), `DeviceList`, `SyncStatusIndicator`, `ConflictResolverDialog`, `VersionHistoryDialog`.
- Hooks: `useSyncStatus`, `useDevices`.

### 4.13 `plugins/`
- `MarketplacePanel`, `PluginCard`, `PluginDetailsSheet`, `PermissionGrantDialog`, `InstalledPluginsList`, `PluginHostFrame` (sandboxed iframe surface), `WidgetSlot`.
- Hooks: `useMarketplace`, `useInstalledPlugins`, `usePluginBridge`.

## 5. Shared components (`src/components/`)

- **layout/**: `AppShell`, `ActivityBar`, `PrimarySidebar`, `SecondarySidebar`, `TitleBar`, `StatusBar`, `TabBar`, `PaneGrid`, `Resizable`.
- **ui/** (shadcn): `button` (exists ✅), plus `dialog`, `sheet`, `dropdown-menu`, `context-menu`, `tabs`, `tooltip`, `input`, `select`, `switch`, `checkbox`, `slider`, `command`, `popover`, `scroll-area`, `table`, `toast`, `resizable`, `avatar`, `badge`, `separator`, `skeleton`, `progress`, `alert`, `card`, `form`, `label`, `accordion`, `hover-card`, `toggle`, `tree` (custom).
- **data/**: `VirtualList`, `DataTable` (TanStack Table + virtual), `TreeView`, `KeyValueGrid`.
- **feedback/**: `ErrorBoundary`, `EmptyState`, `LoadingState`, `ConfirmDialog`, `Toaster`.
- **command-palette/**: `CommandPalette`, `CommandGroup`, `CommandItem`.

## 6. Hooks (`src/hooks/`)

`useIpc` (invoke wrapper w/ error mapping), `useEvent`, `useHotkey`/`useKeymap`, `useTheme`,
`useResizeObserver`, `useVirtualizer`, `useDebouncedValue`, `useClipboard`, `useConfirm`,
`useCommandRegistry` (register palette commands + shortcuts declaratively).

## 7. Routing

- `/` → Home (host tree + quick connect + recents/favorites).
- `/workspace/:hostId` → connected workspace (tabs/panes for that host).
- `/settings/:section` → settings (see doc 09 §Settings).
- Deep links (`sshbool://connect?host=…`) route via the Tauri deep‑link plugin into the app router.

## 8. Performance rules (frontend; see doc 23)

- Virtualize every long list (files, processes, logs, results, history).
- Terminal/log streams write imperatively, never through React state.
- Memoize widget subtrees; throttle metric re‑renders to ≤ 4 Hz.
- Lazy‑load heavy modules (Monaco, xterm webgl, Docker/DB panels) via dynamic import + route splitting.
- `framer-motion` respects `prefers-reduced-motion`; animations use transform/opacity only.

## 9. Accessibility & i18n

- Full keyboard operability; focus rings; ARIA roles on tree/table/tabs.
- i18next with RTL layout support (Arabic included) — `dir` toggled at the shell root.
- Color‑contrast AA in both themes; motion and density are user settings.
