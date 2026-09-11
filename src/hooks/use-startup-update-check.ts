import { useCallback, useEffect, useState } from "react"

import type { UpdateCheckResult } from "@/lib/api"
import {
  checkForUpdate,
  resolveUpdatePlatform,
  UPDATE_SESSION_KEY,
} from "@/lib/api"
import { ipc } from "@/lib/ipc/commands"
import type { useUpdateInstall } from "@/hooks/use-update-install"
import {
  isInterruptedSession,
  type PersistedUpdateSession,
} from "@/lib/update-engine"

const SESSION_DISMISS_KEY = "sshbool:skippedUpdateVersion"

async function readPersistedUpdateSession(): Promise<PersistedUpdateSession | null> {
  try {
    const raw = await ipc.settingsGet(UPDATE_SESSION_KEY)
    if (!raw || typeof raw !== "string") {
      return null
    }
    const session = JSON.parse(raw) as PersistedUpdateSession
    return isInterruptedSession(session) ? session : null
  } catch {
    return null
  }
}

type UpdateInstallApi = Pick<
  ReturnType<typeof useUpdateInstall>,
  "install" | "canInstall" | "dismissInterrupted" | "interruptedSession"
>

export function useStartupUpdateCheck(
  enabled: boolean,
  updateInstall: UpdateInstallApi
) {
  const [open, setOpen] = useState(false)
  const [update, setUpdate] = useState<UpdateCheckResult | null>(null)

  useEffect(() => {
    if (!enabled) return
    if (window.location.search.includes("wsId=")) return

    let cancelled = false

    void (async () => {
      try {
        const [info, interrupted] = await Promise.all([
          ipc.appInfo(),
          readPersistedUpdateSession(),
        ])

        const platform = resolveUpdatePlatform(info)
        const result = await checkForUpdate(platform, info.version, "stable")
        if (cancelled || !result.has_update || !result.latest_version) {
          return
        }

        const isForced = result.is_force === true
        const sessionSkipped = sessionStorage.getItem(SESSION_DISMISS_KEY)
        const interruptedVersion = interrupted?.version
        const sameInterruptedVersion =
          interruptedVersion != null &&
          interruptedVersion === result.latest_version

        if (
          !isForced &&
          sessionSkipped === result.latest_version &&
          !sameInterruptedVersion
        ) {
          return
        }

        if (cancelled) return

        setUpdate(result)
        setOpen(true)
      } catch (error) {
        console.warn("Startup update check failed:", error)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [enabled])

  const dismiss = useCallback(async () => {
    if (update?.is_force) {
      return
    }
    if (update?.latest_version) {
      sessionStorage.setItem(SESSION_DISMISS_KEY, update.latest_version)
    }
    setOpen(false)
  }, [update])

  const install = useCallback(
    async (target: UpdateCheckResult) => updateInstall.install(target),
    [updateInstall]
  )

  return {
    open,
    update,
    isForced: update?.is_force === true,
    dismiss,
    install,
    interruptedSession: updateInstall.interruptedSession,
    dismissInterrupted: updateInstall.dismissInterrupted,
  }
}
