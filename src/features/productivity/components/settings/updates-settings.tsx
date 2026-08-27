import { useMutation, useQuery } from "@tanstack/react-query"
import { AlertTriangle, CheckCircle2, Download, ExternalLink, Loader2, RefreshCw } from "lucide-react"
import { useState } from "react"

import { MarkdownContent } from "@/components/markdown-content"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { UpdateProgressPanel } from "@/features/productivity/components/update-progress-panel"
import { useAutoUpdateInstall } from "@/hooks/use-auto-update-install"
import { useSetting } from "@/hooks/use-setting"
import { useUpdateInstall, useUpdateTaskbarProgress } from "@/hooks/use-update-install"
import { checkForUpdate, fetchCmsPage, resolveUpdatePlatform } from "@/lib/api"
import { ipc } from "@/lib/ipc/commands"
import { getInstallCompleteMessage } from "@/lib/update-engine"
import { SETTINGS } from "@/lib/settings-defaults"
import { toast } from "@/stores/toast.store"
import { cn } from "@/lib/utils"

const CATEGORY_LABELS: Record<string, string> = {
  added: "Added",
  improved: "Improved",
  fixed: "Fixed",
  security: "Security",
  deprecated: "Deprecated",
  removed: "Removed",
}

export function UpdatesSettings() {
  const [lastCheckedAt, setLastCheckedAt] = useState<Date | null>(null)
  const autoUpdate = useSetting(SETTINGS.updates.autoUpdate)

  const info = useQuery({ queryKey: ["app-info"], queryFn: () => ipc.appInfo() })
  const updateInstall = useUpdateInstall(info.data)
  useUpdateTaskbarProgress(updateInstall.progress, updateInstall.isActive)

  const updatesPage = useQuery({
    queryKey: ["cms-page", "updates"],
    queryFn: () => fetchCmsPage("updates"),
    staleTime: 1000 * 60 * 10,
    retry: 1,
  })

  const checkUpdates = useMutation({
    mutationFn: async () => {
      const version = info.data?.version ?? "0.1.7"
      const platform = resolveUpdatePlatform(info.data)
      const apiResult = await checkForUpdate(platform, version, "stable")
      setLastCheckedAt(new Date())
      return apiResult
    },
  })

  const result = checkUpdates.data
  const hasApiUpdate = result?.has_update === true
  const showUpdateBanner = hasApiUpdate || updateInstall.interruptedSession != null

  const installUpdateMutation = useMutation({
    mutationFn: async () => {
      if (!result) {
        throw new Error("No update information available")
      }
      return updateInstall.install(result)
    },
    onSuccess: (mode) => {
      if (mode === "github") {
        toast.info("Opened GitHub releases for manual download.")
        return
      }
      toast.success(getInstallCompleteMessage(mode, info.data))
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to install update")
    },
  })

  useAutoUpdateInstall({
    enabled: Boolean(result?.has_update) && lastCheckedAt != null,
    update: result,
    autoUpdateEnabled: autoUpdate.value,
    isForced: result?.is_force === true,
    canInstall: result ? updateInstall.canInstall(result) : false,
    installing: updateInstall.installing || installUpdateMutation.isPending,
    install: async (target) => updateInstall.install(target),
    onComplete: (mode) => {
      if (mode === "github") {
        toast.info("Opened GitHub releases for manual download.")
        return
      }
      toast.success(getInstallCompleteMessage(mode, info.data))
    },
    onError: (error) => {
      toast.error(error.message || "Failed to install update")
    },
  })

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h2 className="font-semibold">Updates</h2>
        <p className="text-muted-foreground mt-1 text-xs">
          Current version:{" "}
          <span className="text-foreground font-medium">
            {info.data?.version ?? "0.1.7"}
          </span>
          {" · "}
          Channel: <span className="text-foreground font-medium">stable</span>
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={checkUpdates.isPending || info.isLoading}
          onClick={() => checkUpdates.mutate()}
        >
          {checkUpdates.isPending ? (
            <Loader2 className="mr-2 size-3.5 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 size-3.5" />
          )}
          Check for updates
        </Button>
        {lastCheckedAt && (
          <span className="text-muted-foreground text-[11px]">
            Last checked {lastCheckedAt.toLocaleTimeString()}
          </span>
        )}
      </div>

      <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
        <div className="space-y-0.5">
          <label className="text-sm font-medium" htmlFor="auto-update">
            Auto update
          </label>
          <p className="text-muted-foreground text-xs">
            When an update is found, install automatically on startup. If your platform
            installer is unavailable, GitHub releases opens instead.
          </p>
        </div>
        <Switch
          id="auto-update"
          checked={!!autoUpdate.value}
          onCheckedChange={(value) => autoUpdate.setValue(value)}
        />
      </div>

      {checkUpdates.isError && (
        <div className="border-destructive/30 bg-destructive/5 flex items-start gap-2 rounded-lg border p-3">
          <AlertTriangle className="text-destructive mt-0.5 size-4 shrink-0" />
          <p className="text-destructive text-xs">Could not reach the update server.</p>
        </div>
      )}

      {updateInstall.interruptedSession && !updateInstall.installing && (
        <div className="border-amber-500/30 bg-amber-500/5 space-y-2 rounded-lg border p-4">
          <p className="text-sm font-semibold">Update interrupted</p>
          <p className="text-muted-foreground text-xs">
            An update to {updateInstall.interruptedSession.version} did not finish.
          </p>
          <div className="flex gap-2">
            {result && (
              <Button
                size="sm"
                disabled={installUpdateMutation.isPending}
                onClick={() => installUpdateMutation.mutate()}
              >
                Retry update
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void updateInstall.dismissInterrupted()
              }}
            >
              Dismiss
            </Button>
          </div>
        </div>
      )}

      {result && !showUpdateBanner && (
        <div className="border-border bg-muted/30 flex items-start gap-2 rounded-lg border p-3">
          <CheckCircle2 className="text-emerald-500 mt-0.5 size-4 shrink-0" />
          <div>
            <p className="text-sm font-medium">You&apos;re up to date</p>
            <p className="text-muted-foreground text-xs">
              SSHBool {result.latest_version ?? result.current_version} is the latest stable release.
            </p>
          </div>
        </div>
      )}

      {showUpdateBanner && result && (
        <div className="border-primary/30 bg-primary/5 space-y-3 rounded-lg border p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">Update available</p>
              <p className="text-muted-foreground text-xs">
                {result.current_version} →{" "}
                <span className="text-foreground font-medium">{result.latest_version}</span>
                {result.is_critical && (
                  <span className="text-destructive ml-2 font-medium">Critical</span>
                )}
                {result.is_force && (
                  <span className="text-destructive ml-2 font-medium">Mandatory</span>
                )}
              </p>
              {!updateInstall.installing && updateInstall.platformSummary(result) && (
                <p className="text-muted-foreground mt-1 text-[11px]">
                  {updateInstall.platformSummary(result)}
                </p>
              )}
            </div>
            {updateInstall.canInstall(result) && (
              <Button
                size="sm"
                disabled={updateInstall.installing || installUpdateMutation.isPending}
                onClick={() => installUpdateMutation.mutate()}
              >
                {updateInstall.installing || installUpdateMutation.isPending ? (
                  <Loader2 className="mr-2 size-3.5 animate-spin" />
                ) : updateInstall.isGithubFallback(result) ? (
                  <ExternalLink className="mr-2 size-3.5" />
                ) : (
                  <Download className="mr-2 size-3.5" />
                )}
                {updateInstall.buttonLabel(result)}
              </Button>
            )}
          </div>

          {(updateInstall.installing || updateInstall.progress.phase === "done") && (
            <UpdateProgressPanel
              progress={updateInstall.progress}
              currentVersion={result.current_version}
              latestVersion={result.latest_version ?? result.current_version}
              platform={result.platform}
              installDir={info.data?.installDir}
            />
          )}

          {!updateInstall.installing && result.notes && (
            <p className="text-muted-foreground whitespace-pre-line text-xs leading-relaxed">
              {result.notes}
            </p>
          )}

          {!updateInstall.installing && result.changelog.length > 0 && (
            <ul className="space-y-1.5">
              {result.changelog.map((entry) => (
                <li key={entry.description} className="flex gap-2 text-xs">
                  <span
                    className={cn(
                      "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase",
                      entry.category === "security" && "bg-destructive/10 text-destructive",
                      entry.category === "added" && "bg-emerald-500/10 text-emerald-600",
                      entry.category === "fixed" && "bg-amber-500/10 text-amber-600",
                      entry.category === "improved" && "bg-blue-500/10 text-blue-600",
                      !["security", "added", "fixed", "improved"].includes(entry.category) &&
                        "bg-muted text-muted-foreground",
                    )}
                  >
                    {CATEGORY_LABELS[entry.category] ?? entry.category}
                  </span>
                  <span className="text-muted-foreground">{entry.description}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {updatesPage.data && (
        <div className="border-border space-y-2 rounded-lg border p-4">
          <MarkdownContent content={updatesPage.data.content} />
        </div>
      )}
    </div>
  )
}
