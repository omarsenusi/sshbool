import { useQuery } from "@tanstack/react-query"

import { UpdateAvailableDialog } from "@/features/productivity/components/update-available-dialog"
import { useAutoUpdateInstall } from "@/hooks/use-auto-update-install"
import { useSetting } from "@/hooks/use-setting"
import { useStartupUpdateCheck } from "@/hooks/use-startup-update-check"
import { useUpdateCloseGuard } from "@/hooks/use-update-close-guard"
import {
  useUpdateInstall,
  useUpdateTaskbarProgress,
} from "@/hooks/use-update-install"
import { ipc } from "@/lib/ipc/commands"
import { SETTINGS } from "@/lib/settings-defaults"
import { getInstallCompleteMessage } from "@/lib/update-engine"
import { toast } from "@/stores/toast.store"

export function StartupUpdatePrompt({
  unlocked = true,
}: {
  unlocked?: boolean
}) {
  const appInfo = useQuery({
    queryKey: ["app-info"],
    queryFn: () => ipc.appInfo(),
    staleTime: Infinity,
    enabled: unlocked,
  })

  const updateInstall = useUpdateInstall(appInfo.data)
  const autoUpdate = useSetting(SETTINGS.updates.autoUpdate)

  const { open, update, isForced, dismiss, install, interruptedSession } =
    useStartupUpdateCheck(
      unlocked && Boolean(appInfo.data?.version),
      updateInstall
    )

  useAutoUpdateInstall({
    enabled: open && Boolean(update),
    update,
    autoUpdateEnabled: autoUpdate.value,
    isForced,
    canInstall: update ? updateInstall.canInstall(update) : false,
    installing: updateInstall.installing,
    install,
    onComplete: (mode) => {
      if (mode === "github") {
        toast.info("Opened GitHub releases for manual download.")
        if (!isForced) {
          void dismiss()
        }
        return
      }
      toast.success(getInstallCompleteMessage(mode, appInfo.data))
    },
    onError: (error) => {
      toast.error(error.message || "Failed to install update")
    },
  })

  useUpdateCloseGuard(updateInstall.isActive, isForced)
  useUpdateTaskbarProgress(updateInstall.progress, updateInstall.isActive)

  if (!update) {
    return null
  }

  const interruptedNote =
    interruptedSession &&
    interruptedSession.version ===
      (update.latest_version ?? update.current_version)
      ? `Previous install to ${interruptedSession.version} was interrupted.`
      : null

  return (
    <UpdateAvailableDialog
      open={open}
      currentVersion={update.current_version}
      latestVersion={update.latest_version ?? update.current_version}
      platform={update.platform}
      installDir={appInfo.data?.installDir}
      platformSummary={updateInstall.platformSummary(update)}
      notes={interruptedNote ?? update.notes}
      changelog={update.changelog}
      isForced={isForced}
      isCritical={update.is_critical}
      installing={updateInstall.installing}
      canInstall={updateInstall.canInstall(update)}
      installLabel={updateInstall.buttonLabel(update)}
      isGithubFallback={updateInstall.isGithubFallback(update)}
      progress={updateInstall.progress}
      onLater={
        isForced
          ? undefined
          : () => {
              void dismiss()
            }
      }
      onInstall={() => {
        void install(update)
          .then((mode) => {
            if (mode === "github") {
              toast.info("Opened GitHub releases for manual download.")
              return
            }
            toast.success(getInstallCompleteMessage(mode, appInfo.data))
          })
          .catch((error: Error) => {
            toast.error(error.message || "Failed to install update")
          })
      }}
    />
  )
}
