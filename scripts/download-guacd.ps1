# Downloads or prepares guacd for bundled in-app RDP (Guacamole backend).
# Run: powershell -ExecutionPolicy Bypass -File scripts/download-guacd.ps1

param(
    [switch]$Force,
    [switch]$UseDocker,
    [switch]$InstallDocker,
    [string]$SourceDir = ""
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path $PSScriptRoot -Parent
$destDir = Join-Path $repoRoot "src-tauri\binaries\guacd"
$localApp = Join-Path $env:LOCALAPPDATA "sshbool\guacd"
$GuacdImage = "guacamole/guacd:1.6.0"
$ContainerName = "sshbool-guacd"

New-Item -ItemType Directory -Force -Path $destDir | Out-Null
New-Item -ItemType Directory -Force -Path $localApp | Out-Null

function Test-GuacdPort {
    try {
        $r = Test-NetConnection 127.0.0.1 -Port 4822 -WarningAction SilentlyContinue
        return [bool]$r.TcpTestSucceeded
    } catch {
        return $false
    }
}

function Find-ContainerCli {
    $names = @("docker", "podman")
    foreach ($name in $names) {
        try {
            $cmd = Get-Command $name -ErrorAction Stop
            return $cmd.Source
        } catch {}
    }

    $candidates = @(
        "${env:ProgramFiles}\Docker\Docker\resources\bin\docker.exe",
        "${env:ProgramFiles}\Docker\Docker\resources\docker.exe",
        "$env:LOCALAPPDATA\Programs\Rancher Desktop\resources\resources\win32\docker.exe"
    )
    foreach ($path in $candidates) {
        if (Test-Path $path) { return $path }
    }
    return $null
}

function Test-GuacdInPath {
    foreach ($name in @("guacd", "guacd.exe")) {
        try {
            $null = Get-Command $name -ErrorAction Stop
            Write-Host "Found guacd on PATH: $name"
            return $true
        } catch {}
    }
    return $false
}

function Test-GuacdBundled {
    $candidates = @(
        (Join-Path $destDir "guacd.exe"),
        (Join-Path $destDir "guacd"),
        (Join-Path $localApp "guacd.exe")
    )
    foreach ($p in $candidates) {
        if (Test-Path $p) {
            Write-Host "Bundled guacd found: $p"
            return $true
        }
    }
    return $false
}

function Copy-GuacdTree($sourceRoot) {
    if (-not (Test-Path $sourceRoot)) {
        throw "Source directory not found: $sourceRoot"
    }

    $guacdExe = Get-ChildItem -Path $sourceRoot -Recurse -Filter "guacd.exe" -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if (-not $guacdExe) {
        throw "No guacd.exe found under $sourceRoot"
    }

    $root = $guacdExe.Directory.FullName
    Write-Host "Copying guacd tree from $root"

    Get-ChildItem -Path $root -File | ForEach-Object {
        Copy-Item -Force $_.FullName (Join-Path $destDir $_.Name)
        Copy-Item -Force $_.FullName (Join-Path $localApp $_.Name)
    }

    Write-Host "guacd installed to:"
    Write-Host "  $destDir"
    Write-Host "  $localApp"
}

function Start-GuacdContainer {
    param([string]$CliPath)

    Write-Host "Starting guacd container via $CliPath ..."
    & $CliPath rm -f $ContainerName 2>$null | Out-Null
    & $CliPath run -d --name $ContainerName -p 4822:4822 $GuacdImage | Out-Null

    for ($i = 0; $i -lt 30; $i++) {
        if (Test-GuacdPort) {
            Write-Host "guacd is listening on 127.0.0.1:4822"
            return
        }
        Start-Sleep -Milliseconds 500
    }

    throw "guacd container started but port 4822 is not reachable yet. Restart Docker Desktop and retry."
}

function Install-DockerDesktop {
    Write-Host "Installing Docker Desktop via winget (this may take several minutes)..."
    winget install -e --id Docker.DockerDesktop `
        --accept-package-agreements `
        --accept-source-agreements
    Write-Host @"

Docker Desktop installed. Please:
  1. Start Docker Desktop from the Start menu
  2. Wait until Docker is running
  3. Run: npm run download-guacd -- -UseDocker
     or click 'Set up guacd' again in SSHBool

"@
}

if ($SourceDir) {
    Copy-GuacdTree $SourceDir
    exit 0
}

if ($InstallDocker) {
    Install-DockerDesktop
    exit 0
}

if (-not $Force -and (Test-GuacdPort -or Test-GuacdBundled -or Test-GuacdInPath)) {
    Write-Host "guacd already available. Use -Force to re-check."
    exit 0
}

if ($UseDocker -or $Force) {
    $cli = Find-ContainerCli
    if ($cli) {
        Start-GuacdContainer -CliPath $cli
        exit 0
    }
}

Write-Host @"

guacd is required for in-app RDP (Guacamole backend).

Windows options:
  A) Docker (recommended):
     npm run download-guacd -- -UseDocker
     If Docker is not installed:
     npm run download-guacd -- -InstallDocker

  B) Community Cygwin build — copy guacd.exe + DLLs to:
     $destDir
     Or: powershell -File scripts/download-guacd.ps1 -SourceDir C:\path\to\guacd-build

  C) Manual Docker:
     docker run -d --name sshbool-guacd -p 4822:4822 guacamole/guacd:1.6.0

After installing, verify:
  Test-NetConnection 127.0.0.1 -Port 4822

See: https://github.com/zorjen122/guacamole-server-windows

"@

exit 1
