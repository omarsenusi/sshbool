import { useEffect, useRef } from "react"

import type { UpdateCheckResult } from "@/lib/api"
import {
  shouldAutoInstallOnPrompt,
  type UpdateInstallMode,
} from "@/lib/update-engine"

type Options = {
  enabled: boolean
  update: UpdateCheckResult | null | undefined
  autoUpdateEnabled: boolean
  isForced?: boolean
  canInstall: boolean
  installing: boolean
  install: (update: UpdateCheckResult) => Promise<UpdateInstallMode>
  onComplete?: (mode: UpdateInstallMode) => void
  onError?: (error: Error) => void
  onGithubFallback?: () => void
}

/** Starts install automatically when auto-update (or a forced update) is active. */
export function useAutoUpdateInstall({
  enabled,
  update,
  autoUpdateEnabled,
  isForced = false,
  canInstall,
  installing,
  install,
  onComplete,
  onError,
  onGithubFallback,
}: Options) {
  const startedVersionRef = useRef<string | null>(null)

  useEffect(() => {
    if (!enabled || !update?.has_update || !update.latest_version) {
      return
    }
    if (!shouldAutoInstallOnPrompt(autoUpdateEnabled, isForced)) {
      return
    }
    if (!canInstall || installing) {
      return
    }

    const version = update.latest_version
    if (startedVersionRef.current === version) {
      return
    }
    startedVersionRef.current = version

    void install(update)
      .then((mode) => {
        onComplete?.(mode)
        if (mode === "github") {
          onGithubFallback?.()
        }
      })
      .catch((error: unknown) => {
        startedVersionRef.current = null
        onError?.(error instanceof Error ? error : new Error(String(error)))
      })
  }, [
    enabled,
    update,
    autoUpdateEnabled,
    isForced,
    canInstall,
    installing,
    install,
    onComplete,
    onError,
    onGithubFallback,
  ])
}
