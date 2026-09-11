export {
  calcUpdatePercent,
  canInstallUpdate,
  canUseOta,
  getGithubFallbackUrl,
  getInstallButtonLabel,
  getPlatformInstallSummary,
  hasPlatformPackage,
  installUpdate,
  isUpdaterSupported,
  openGithubFallback,
  resolveInstallMode,
  runDirectInstall,
  runOtaInstall,
  usesGithubFallback,
  type InstallUpdateOptions,
  type InstallUpdateResult,
  type PersistedUpdateSession,
  type UpdateInstallMode,
  type UpdatePhase,
  type UpdaterProgress,
} from "@/lib/update-engine"

import { check } from "@tauri-apps/plugin-updater"

/** @deprecated Prefer useUpdateInstall + update-engine.installUpdate */
export async function checkNativeUpdate(): Promise<{
  available: boolean
  version?: string
  body?: string
  date?: string
}> {
  const update = await check()
  if (!update) {
    return { available: false }
  }

  return {
    available: true,
    version: update.version,
    body: update.body ?? undefined,
    date: update.date ?? undefined,
  }
}
