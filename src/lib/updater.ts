import { check } from "@tauri-apps/plugin-updater"

export type UpdaterProgress = {
  phase: "idle" | "checking" | "downloading" | "installing" | "done" | "error"
  downloadedBytes?: number
  totalBytes?: number
  message?: string
}

export async function checkNativeUpdate(): Promise<{
  available: boolean
  version?: string
  body?: string
  date?: string
  install?: () => Promise<void>
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
    install: async () => {
      await update.downloadAndInstall()
    },
  }
}

export function isUpdaterSupported(): boolean {
  return import.meta.env.PROD
}
