Place `wfreerdp-x86_64-pc-windows-msvc.exe` here for bundled Windows RDP auto-login.

The sidecar may be `sdl3-freerdp.exe` or `wfreerdp.exe` copied under this name. Auto-login
requires a build with working `/from-stdin` (FreeRDP 3.27+; see FreeRDP PR #12821).

Run from repo root:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/download-freerdp.ps1
powershell -ExecutionPolicy Bypass -File scripts/download-freerdp.ps1 -Force
```

For production bundles, after the sidecar exists, add to `tauri.conf.json`:

```json
"externalBin": ["binaries/wfreerdp"]
```

Password is never passed on the command line — only via a stdin pipe to FreeRDP.
