import { check } from "@tauri-apps/plugin-updater"
import { listen } from "@tauri-apps/api/event"

import {
  GITHUB_LATEST_RELEASE_URL,
  type UpdateCheckResult,
} from "@/lib/api"
import { ipc } from "@/lib/ipc/commands"
import type { AppInfoDto } from "@/lib/ipc/types"

export type UpdatePhase =
  | "idle"
  | "checking"
  | "downloading"
  | "installing"
  | "done"
  | "error"

export type UpdateInstallMode = "ota" | "direct" | "github"

export type UpdaterProgress = {
  phase: UpdatePhase
  downloadedBytes?: number
  totalBytes?: number
  percent?: number | null
  message?: string
  /** How the update was applied — affects done-state messaging. */
  resultMode?: UpdateInstallMode
}

export type PersistedUpdateSession = {
  version: string
  phase: UpdatePhase
  downloadedBytes: number
  totalBytes: number
  startedAt: string
  error?: string
}

export function isUpdaterSupported(): boolean {
  return import.meta.env.PROD
}

export function calcUpdatePercent(
  downloadedBytes: number,
  totalBytes: number,
): number | null {
  if (totalBytes <= 0) {
    return null
  }
  return Math.min(100, Math.max(0, Math.round((downloadedBytes / totalBytes) * 100)))
}

export function getGithubFallbackUrl(update: UpdateCheckResult): string {
  return update.github_releases_url ?? GITHUB_LATEST_RELEASE_URL
}

export function hasPlatformPackage(update: UpdateCheckResult): boolean {
  return update.has_platform_download && Boolean(update.platform_download_url)
}

export function canUseOta(
  update: UpdateCheckResult,
  appInfo?: AppInfoDto | null,
  prod = isUpdaterSupported(),
): boolean {
  return prod && update.can_install_in_app && (appInfo?.isPackaged ?? true)
}

export function resolveInstallMode(
  update: UpdateCheckResult,
  appInfo?: AppInfoDto | null,
  prod = isUpdaterSupported(),
): UpdateInstallMode {
  if (canUseOta(update, appInfo, prod)) {
    return "ota"
  }
  if (hasPlatformPackage(update)) {
    return "direct"
  }
  return "github"
}

export function canInstallUpdate(update: UpdateCheckResult | null): boolean {
  if (!update) {
    return false
  }
  return hasPlatformPackage(update) || Boolean(getGithubFallbackUrl(update))
}

export function usesGithubFallback(update: UpdateCheckResult): boolean {
  return !hasPlatformPackage(update)
}

/** Whether the startup/settings update prompt should begin install without a click. */
export function shouldAutoInstallOnPrompt(
  autoUpdateEnabled: boolean,
  isForced = false,
): boolean {
  return autoUpdateEnabled || isForced
}

export function getPlatformInstallSummary(
  update: UpdateCheckResult,
  appInfo?: AppInfoDto | null,
): string | null {
  if (!hasPlatformPackage(update)) {
    return null
  }
  const platform = update.platform ?? appInfo?.updatePlatform
  if (!platform) {
    return null
  }
  if (!appInfo?.isPackaged) {
    return `Platform ${platform} · dev build — installer opens separately (this session stays on the current version)`
  }
  if (appInfo.installDir) {
    return `Platform ${platform} · SSHBool will update in ${appInfo.installDir}`
  }
  return `Platform ${platform}`
}

export function getInstallButtonLabel(
  update: UpdateCheckResult,
  progress?: UpdaterProgress,
  installing = false,
): string {
  if (usesGithubFallback(update)) {
    return "View on GitHub"
  }
  if (installing && progress) {
    switch (progress.phase) {
      case "checking":
        return "Checking…"
      case "downloading":
        return "Downloading…"
      case "installing":
        return "Installing…"
      case "done":
        return "Done"
      case "error":
        return "Retry install"
      default:
        break
    }
  }
  return "Install update"
}

function installerFileName(url: string, version: string): string {
  try {
    const name = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "")
    if (name) {
      return name
    }
  } catch {
    /* ignore */
  }
  return `SSHBool_${version}_setup.msi`
}

export function getInstallCompleteMessage(
  mode: UpdateInstallMode,
  appInfo?: AppInfoDto | null,
): string {
  if (mode === "ota") {
    return "Update installed. Restart SSHBool to finish."
  }
  if (!appInfo?.isPackaged) {
    return "Windows installer opened. This dev session stays on the current version — finish setup in the dialog, then launch SSHBool from Program Files."
  }
  return "Windows installer opened. Finish setup in the dialog, then restart SSHBool."
}

export function getDonePhaseLabel(mode: UpdateInstallMode): string {
  return mode === "ota" ? "Update installed" : "Installer opened"
}

export async function openGithubFallback(update: UpdateCheckResult): Promise<void> {
  const { openUrl } = await import("@tauri-apps/plugin-opener")
  await openUrl(getGithubFallbackUrl(update))
}

export async function runOtaInstall(
  onProgress: (progress: UpdaterProgress) => void,
): Promise<void> {
  onProgress({ phase: "checking" })

  const update = await check()
  if (!update) {
    throw new Error("No update available from the native updater")
  }

  let downloadedBytes = 0
  let totalBytes = 0

  onProgress({ phase: "downloading", downloadedBytes: 0, totalBytes: 0, percent: null })

  await update.downloadAndInstall((event) => {
    switch (event.event) {
      case "Started":
        totalBytes = event.data.contentLength ?? 0
        downloadedBytes = 0
        onProgress({
          phase: "downloading",
          downloadedBytes,
          totalBytes,
          percent: calcUpdatePercent(downloadedBytes, totalBytes),
        })
        break
      case "Progress":
        downloadedBytes += event.data.chunkLength
        onProgress({
          phase: "downloading",
          downloadedBytes,
          totalBytes,
          percent: calcUpdatePercent(downloadedBytes, totalBytes),
        })
        break
      case "Finished":
        onProgress({
          phase: "installing",
          downloadedBytes,
          totalBytes,
          percent: totalBytes > 0 ? 100 : null,
        })
        break
    }
  })

  onProgress({
    phase: "done",
    downloadedBytes,
    totalBytes,
    percent: 100,
  })
}

export async function runDirectInstall(
  update: UpdateCheckResult,
  onProgress: (progress: UpdaterProgress) => void,
): Promise<void> {
  const url = update.platform_download_url
  if (!url) {
    throw new Error("No platform installer URL available")
  }

  const version = update.latest_version ?? update.current_version
  onProgress({ phase: "downloading", downloadedBytes: 0, totalBytes: 0, percent: null })

  let lastDownloaded = 0
  let lastTotal = 0

  const unlisten = await listen<{
    phase: string
    downloadedBytes: number
    totalBytes: number
  }>("update://progress", (event) => {
    const { phase, downloadedBytes, totalBytes } = event.payload
    lastDownloaded = downloadedBytes
    lastTotal = totalBytes
    onProgress({
      phase: phase as UpdatePhase,
      downloadedBytes,
      totalBytes,
      percent: calcUpdatePercent(downloadedBytes, totalBytes),
      resultMode: "direct",
    })
  })

  try {
    await ipc.updateDownloadAndInstall(url, installerFileName(url, version))
  } finally {
    unlisten()
  }

  onProgress({
    phase: "done",
    downloadedBytes: lastDownloaded,
    totalBytes: lastTotal || lastDownloaded,
    percent: 100,
    resultMode: "direct",
  })
}

export type InstallUpdateOptions = {
  update: UpdateCheckResult
  appInfo?: AppInfoDto | null
  onProgress?: (progress: UpdaterProgress) => void
}

export type InstallUpdateResult = {
  mode: UpdateInstallMode
}

export async function installUpdate({
  update,
  appInfo,
  onProgress,
}: InstallUpdateOptions): Promise<InstallUpdateResult> {
  const mode = resolveInstallMode(update, appInfo)

  if (mode === "ota") {
    await runOtaInstall((progress) => onProgress?.(progress))
    return { mode: "ota" }
  }

  if (mode === "direct") {
    await runDirectInstall(update, (progress) => onProgress?.(progress))
    return { mode: "direct" }
  }

  await openGithubFallback(update)
  return { mode: "github" }
}

export function isActiveUpdatePhase(phase: UpdatePhase): boolean {
  return phase === "checking" || phase === "downloading" || phase === "installing"
}

export function isInterruptedSession(session: PersistedUpdateSession | null): boolean {
  if (!session) {
    return false
  }
  return isActiveUpdatePhase(session.phase)
}
