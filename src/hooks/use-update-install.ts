import { getCurrentWindow, ProgressBarStatus } from "@tauri-apps/api/window"
import { useCallback, useEffect, useRef, useState } from "react"

import { UPDATE_SESSION_KEY, type UpdateCheckResult } from "@/lib/api"
import { ipc } from "@/lib/ipc/commands"
import type { AppInfoDto } from "@/lib/ipc/types"
import {
  calcUpdatePercent,
  canInstallUpdate,
  getInstallButtonLabel,
  getInstallCompleteMessage,
  getPlatformInstallSummary,
  installUpdate,
  isActiveUpdatePhase,
  isInterruptedSession,
  usesGithubFallback,
  type PersistedUpdateSession,
  type UpdaterProgress,
  type UpdateInstallMode,
  type UpdatePhase,
} from "@/lib/update-engine"

function emptyProgress(): UpdaterProgress {
  return { phase: "idle", downloadedBytes: 0, totalBytes: 0, percent: null }
}

async function readPersistedSession(): Promise<PersistedUpdateSession | null> {
  try {
    const raw = await ipc.settingsGet(UPDATE_SESSION_KEY)
    if (!raw || typeof raw !== "string") {
      return null
    }
    return JSON.parse(raw) as PersistedUpdateSession
  } catch {
    return null
  }
}

async function persistSession(
  session: PersistedUpdateSession | null
): Promise<void> {
  if (!session) {
    await ipc.settingsSet(UPDATE_SESSION_KEY, null)
    return
  }
  await ipc.settingsSet(UPDATE_SESSION_KEY, JSON.stringify(session))
}

export function useUpdateInstall(appInfo?: AppInfoDto | null) {
  const [progress, setProgress] = useState<UpdaterProgress>(emptyProgress)
  const [installing, setInstalling] = useState(false)
  const [interruptedSession, setInterruptedSession] =
    useState<PersistedUpdateSession | null>(null)

  const sessionVersionRef = useRef<string | null>(null)
  const sessionStartedAtRef = useRef<string | null>(null)

  useEffect(() => {
    void readPersistedSession().then((session) => {
      if (isInterruptedSession(session)) {
        setInterruptedSession(session)
      }
    })
  }, [])

  const updateSession = useCallback(
    async (
      next: Partial<PersistedUpdateSession> & {
        version: string
        phase: UpdatePhase
      }
    ) => {
      const payload: PersistedUpdateSession = {
        version: next.version,
        phase: next.phase,
        downloadedBytes: next.downloadedBytes ?? 0,
        totalBytes: next.totalBytes ?? 0,
        startedAt:
          next.startedAt ??
          sessionStartedAtRef.current ??
          new Date().toISOString(),
        error: next.error,
      }

      if (isActiveUpdatePhase(payload.phase)) {
        await persistSession(payload)
        return
      }

      await persistSession(null)
    },
    []
  )

  const handleProgress = useCallback(
    (version: string, next: UpdaterProgress) => {
      setProgress(next)
      if (!sessionVersionRef.current) {
        return
      }
      void updateSession({
        version,
        phase: next.phase,
        downloadedBytes: next.downloadedBytes ?? 0,
        totalBytes: next.totalBytes ?? 0,
        startedAt: sessionStartedAtRef.current ?? undefined,
        error: next.message,
      })
    },
    [updateSession]
  )

  const install = useCallback(
    async (update: UpdateCheckResult): Promise<UpdateInstallMode> => {
      const version = update.latest_version ?? update.current_version
      sessionVersionRef.current = version
      sessionStartedAtRef.current = new Date().toISOString()
      setInterruptedSession(null)
      setInstalling(true)
      setProgress({
        phase: "checking",
        downloadedBytes: 0,
        totalBytes: 0,
        percent: null,
      })

      try {
        const result = await installUpdate({
          update,
          appInfo,
          onProgress: (next) => handleProgress(version, next),
        })

        if (result.mode !== "github") {
          await persistSession(null)
          setProgress((prev) => ({
            ...prev,
            phase: "done",
            percent: 100,
            resultMode: result.mode,
            message: getInstallCompleteMessage(result.mode, appInfo),
          }))
        } else {
          setProgress(emptyProgress())
        }

        return result.mode
      } catch (error) {
        const message = error instanceof Error ? error.message : "Update failed"
        setProgress({ phase: "error", message })
        await updateSession({
          version,
          phase: "error",
          downloadedBytes: progress.downloadedBytes ?? 0,
          totalBytes: progress.totalBytes ?? 0,
          error: message,
        })
        throw error
      } finally {
        setInstalling(false)
        sessionVersionRef.current = null
      }
    },
    [
      appInfo,
      handleProgress,
      progress.downloadedBytes,
      progress.totalBytes,
      updateSession,
    ]
  )

  const dismissInterrupted = useCallback(async () => {
    setInterruptedSession(null)
    await persistSession(null)
  }, [])

  const canInstall = useCallback(
    (update: UpdateCheckResult | null) => canInstallUpdate(update),
    []
  )

  const buttonLabel = useCallback(
    (update: UpdateCheckResult) =>
      getInstallButtonLabel(update, progress, installing),
    [installing, progress]
  )

  const platformSummary = useCallback(
    (update: UpdateCheckResult) => getPlatformInstallSummary(update, appInfo),
    [appInfo]
  )

  const isGithubFallback = useCallback(
    (update: UpdateCheckResult) => usesGithubFallback(update),
    []
  )

  return {
    progress,
    installing,
    interruptedSession,
    install,
    dismissInterrupted,
    canInstall,
    buttonLabel,
    platformSummary,
    isGithubFallback,
    isActive: isActiveUpdatePhase(progress.phase),
  }
}

export function useUpdateTaskbarProgress(
  progress: UpdaterProgress,
  enabled = true
) {
  const lastKey = useRef("")

  useEffect(() => {
    const win = getCurrentWindow()

    if (!enabled) {
      if (lastKey.current !== "none") {
        lastKey.current = "none"
        void win
          .setProgressBar({ status: ProgressBarStatus.None })
          .catch(() => {})
      }
      return
    }

    const key =
      progress.phase === "downloading" && progress.percent != null
        ? `normal:${progress.percent}`
        : progress.phase === "checking" || progress.phase === "installing"
          ? "indeterminate"
          : "none"

    if (key === lastKey.current) {
      return
    }
    lastKey.current = key

    void (async () => {
      try {
        if (key === "none") {
          await win.setProgressBar({ status: ProgressBarStatus.None })
          return
        }
        if (key === "indeterminate") {
          await win.setProgressBar({ status: ProgressBarStatus.Indeterminate })
          return
        }
        await win.setProgressBar({
          status: ProgressBarStatus.Normal,
          progress:
            progress.percent ??
            calcUpdatePercent(
              progress.downloadedBytes ?? 0,
              progress.totalBytes ?? 0
            ) ??
            0,
        })
      } catch {
        /* platform / permission */
      }
    })()
  }, [enabled, progress])

  useEffect(() => {
    return () => {
      void getCurrentWindow()
        .setProgressBar({ status: ProgressBarStatus.None })
        .catch(() => {})
    }
  }, [])
}
