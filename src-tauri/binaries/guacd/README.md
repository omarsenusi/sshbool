# guacd binaries

Place `guacd.exe` and required Cygwin/OpenSSL DLLs here for bundled in-app RDP.
Tauri bundles everything under this folder into the app package.

## Dev setup

Docker (recommended):

```powershell
npm run download-guacd -- -UseDocker
# or
powershell -File scripts/download-guacd.ps1 -UseDocker
```

Community Windows build:

```powershell
powershell -File scripts/download-guacd.ps1 -SourceDir C:\path\to\guacd-build
```

Verify guacd is listening:

```powershell
Test-NetConnection 127.0.0.1 -Port 4822
```
