# Downloads FreeRDP client (+ DLLs) for bundled/local RDP auto-login.
# Prefers recent Jenkins builds (sdl3-freerdp / wfreerdp with working /from-stdin).
# Run from repo root: powershell -ExecutionPolicy Bypass -File scripts/download-freerdp.ps1
# Force re-download:  ... -Force

param([switch]$Force)

$ErrorActionPreference = "Stop"
$destDir = Join-Path $PSScriptRoot "..\src-tauri\binaries"
$sidecarExe = Join-Path $destDir "wfreerdp-x86_64-pc-windows-msvc.exe"
$localApp = Join-Path $env:LOCALAPPDATA "sshbool\rdp"
$clientNames = @("sdl-freerdp.exe", "sdl3-freerdp.exe", "wfreerdp.exe")
$zipUrls = @(
    "https://ci.freerdp.com/job/freerdp-nightly-windows/arch=win64,label=vs2022/lastSuccessfulBuild/artifact/build/Release/*zip*/Release.zip",
    "https://ci.freerdp.com/job/freerdp-nightly-windows/arch=win64,label=vs2017/lastSuccessfulBuild/artifact/build/Release/*zip*/Release.zip",
    "https://ci.freerdp.com/job/freerdp-nightly-windows/arch=win64,label=vs2013/lastSuccessfulBuild/artifact/build/Release/*zip*/Release.zip"
)

New-Item -ItemType Directory -Force -Path $destDir | Out-Null
New-Item -ItemType Directory -Force -Path $localApp | Out-Null

function Find-ClientExe($root) {
    foreach ($name in $clientNames) {
        $direct = Join-Path $root $name
        if (Test-Path $direct) { return $direct }
    }
    Get-ChildItem -Path $root -Recurse -Include $clientNames -ErrorAction SilentlyContinue |
        Select-Object -First 1 -ExpandProperty FullName
}

function Get-FreeRdpMajorVersion($exePath) {
    try {
        $out = & $exePath /version 2>&1 | Out-String
        if ($out -match "version\s+(\d+)\.") { return [int]$Matches[1] }
    } catch {}
    return 0
}

function Test-FromStdin($exePath) {
    if (-not (Test-Path $exePath)) { return $false }
    if ((Get-FreeRdpMajorVersion $exePath) -lt 3) {
        Write-Host "Skipping legacy FreeRDP (<3.x): $exePath"
        return $false
    }
    $wd = Split-Path $exePath -Parent
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $exePath
    $psi.Arguments = "/v:127.0.0.1:1 /u:probe /from-stdin:force /cert:ignore /timeout:1500"
    $psi.WorkingDirectory = $wd
    $psi.UseShellExecute = $false
    $psi.RedirectStandardInput = $true
    $psi.RedirectStandardError = $true
    $psi.RedirectStandardOutput = $true
    $psi.CreateNoWindow = $true
    try {
        $p = [Diagnostics.Process]::Start($psi)
        $p.StandardInput.WriteLine("probe")
        $p.StandardInput.Close()
        Start-Sleep -Milliseconds 900
        if (-not $p.HasExited) {
            $p.Kill()
            return $true
        }
        $err = $p.StandardError.ReadToEnd()
        return -not ($err -match "Usage:" -or $p.ExitCode -eq 1 -and $err.Length -lt 32)
    } catch {
        return $false
    }
}

function Install-ReleaseTree($releaseDir) {
    Get-ChildItem -Path $releaseDir -File | ForEach-Object {
        Copy-Item -Force $_.FullName (Join-Path $localApp $_.Name)
        Copy-Item -Force $_.FullName (Join-Path $destDir $_.Name)
    }
    $client = Find-ClientExe $localApp
    if (-not $client) {
        throw "No FreeRDP client (sdl3-freerdp/wfreerdp) in release tree"
    }
    Copy-Item -Force $client $sidecarExe
    Write-Host "Installed client: $client"
    Write-Host "Sidecar: $sidecarExe"
    return $client
}

if (-not $Force) {
    $existing = Find-ClientExe $localApp
    if ($existing -and (Get-FreeRdpMajorVersion $existing) -ge 3) {
        Copy-Item -Force $existing $sidecarExe -ErrorAction SilentlyContinue
        Write-Host "FreeRDP already installed: $existing"
        exit 0
    }
    if ((Test-Path $sidecarExe) -and (Test-FromStdin $sidecarExe)) {
        Write-Host "Sidecar already present with working /from-stdin: $sidecarExe"
        exit 0
    }
}

foreach ($candidate in @(
    "C:\msys64\mingw64\bin\sdl3-freerdp.exe",
    "C:\msys64\mingw64\bin\wfreerdp.exe",
    "C:\msys64\ucrt64\bin\sdl3-freerdp.exe",
    "C:\msys64\ucrt64\bin\wfreerdp.exe",
    "${env:ProgramFiles}\FreeRDP\bin\sdl3-freerdp.exe",
    "${env:ProgramFiles}\FreeRDP\bin\wfreerdp.exe"
)) {
    if ((Test-Path $candidate) -and (Test-FromStdin $candidate)) {
        $dir = Split-Path $candidate -Parent
        Get-ChildItem -Path $dir -Filter "*.dll" -ErrorAction SilentlyContinue | ForEach-Object {
            Copy-Item -Force $_.FullName $localApp
            Copy-Item -Force $_.FullName $destDir
        }
        Copy-Item -Force $candidate $localApp
        Copy-Item -Force $candidate $sidecarExe
        Write-Host "Copied system FreeRDP: $candidate"
        exit 0
    }
}

$lastError = "no URLs succeeded"
foreach ($zipUrl in $zipUrls) {
    Write-Host "Trying $zipUrl ..."
    $zipPath = Join-Path $localApp "freerdp-release.zip"
    try {
        curl.exe -fsSL -o $zipPath $zipUrl
        if (-not (Test-Path $zipPath)) { continue }
        $extractRoot = Join-Path $localApp "extract-tmp"
        if (Test-Path $extractRoot) { Remove-Item -Recurse -Force $extractRoot }
        New-Item -ItemType Directory -Force -Path $extractRoot | Out-Null
        tar.exe -xf $zipPath -C $extractRoot
        Remove-Item -Force $zipPath
        $releaseDir = Get-ChildItem -Path $extractRoot -Recurse -Directory -Filter "Release" |
            Select-Object -First 1 -ExpandProperty FullName
        if (-not $releaseDir) { $releaseDir = $extractRoot }
        $client = Install-ReleaseTree $releaseDir
        Remove-Item -Recurse -Force $extractRoot -ErrorAction SilentlyContinue
        if (Test-FromStdin $client) {
            Write-Host "Download OK - /from-stdin probe passed"
            exit 0
        }
        Write-Host "Warning: downloaded build failed /from-stdin probe, trying next URL..."
    } catch {
        $lastError = $_.Exception.Message
        Write-Host "Failed: $lastError"
    }
}

foreach ($artifact in @(
    @{
        Url  = "https://ci.freerdp.com/job/freerdp-nightly-windows/arch=win64,label=vs2017/lastSuccessfulBuild/artifact/install/bin/sdl-freerdp.exe"
        Name = "sdl-freerdp.exe"
    }
)) {
    Write-Host "Trying artifact $($artifact.Name) ..."
    $dest = Join-Path $localApp $artifact.Name
    try {
        curl.exe -fsSL -o $dest $artifact.Url
        if ((Test-Path $dest) -and (Test-FromStdin $dest)) {
            Copy-Item -Force $dest $sidecarExe
            Copy-Item -Force $dest (Join-Path $destDir $artifact.Name)
            Write-Host "Installed artifact: $dest"
            exit 0
        }
    } catch {
        $lastError = $_.Exception.Message
    }
}

throw "Could not install a FreeRDP build with working /from-stdin. Last error: $lastError"
