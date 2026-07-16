# Feature 11 — SFTP File Manager

UI: `features/sftp`. Backend: `commands/transfers.rs` + `ConnectionManager` SFTP/local FS helpers.

## Shipped (this release)

### Dual-pane explorer

- **Local (left)** | **Remote (right)** panes with independent path bars, Up, Refresh, New folder, hidden-dotfile toggle.
- Columns: name, human size (`formatBytes`: B/KB/MB/GB/TB), modified time.
- Multi-select (Ctrl/Cmd, Shift), keyboard: Enter open, F2 rename, Del delete (confirm), Ctrl+C/X/V, Ctrl+A.

### Context menu (right-click)

**Remote:** Open · Open in editor · Download · Rename · Copy · Cut · Paste · Delete (confirm) · New folder · Copy path · Permissions (chmod octal) · Refresh  

**Local:** Open · Upload to remote · Reveal in explorer · Rename · Copy · Cut · Paste · Delete (confirm) · New folder · Copy path · Refresh  

Delete always shows a confirmation dialog; directories delete recursively.

### Drag & drop

- **OS → app:** drag files onto the SFTP view → drop overlay → upload into current remote folder.
- **Local → Remote / Remote → Local:** drag rows between panes (or onto a folder).
- Same-side drop onto a folder moves (rename).

### Transfers

- Binary upload/download (no UTF-8 lossy path for transfers).
- Dialog pickers for Upload / Download.
- Multi-file upload (`transfer_upload_many`).
- Transfer strip lists recent jobs for the host (size + status).

### Backend commands

| Command | Notes |
|---|---|
| `sftp_list_dir` / `sftp_stat` / `sftp_mkdir` / `sftp_rename` / `sftp_chmod` | Remote ops; `sftp_stat` uses metadata |
| `sftp_delete` | Honors `recursive` |
| `sftp_copy` | Remote copy (dirs recursive) |
| `sftp_read` / `sftp_write` | Editor UTF-8 path (5MB cap) |
| `local_home` / `local_list_dir` / `local_mkdir` / `local_rename` / `local_delete` | Local pane |
| `transfer_upload` / `transfer_upload_many` / `transfer_download` | Binary bytes |
| `transfers_list` / pause / resume / cancel | Queue metadata (pause/resume are status flags) |

## Later (not in this pass)

- Multi-GB resume with checksum, live progress events, concurrency settings
- Two-way folder sync UI / deep `folders_compare`
- Rich previews (image/video/archive/hex), thumbnails
- CHOWN, bookmarks sidebar, per-pane tabs
- Local↔local file **copy** (cut/move works; copy needs `local_copy`)
- Virtualized lists for 10k+ entries
- Drag-out from app to OS Explorer

## Acceptance (shipped)

- [x] Dual-pane Local | Remote browsing
- [x] Human-readable sizes
- [x] Right-click rename / copy / paste / delete with confirm
- [x] OS drop overlay upload
- [x] Cross-pane drag upload/download
- [x] Binary transfers for typical files
