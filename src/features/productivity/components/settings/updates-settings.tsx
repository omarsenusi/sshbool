import { useMutation, useQuery } from "@tanstack/react-query"
import { AlertTriangle, CheckCircle2, Download, Loader2, RefreshCw } from "lucide-react"
import { useState } from "react"

import { MarkdownContent } from "@/components/markdown-content"
import { Button } from "@/components/ui/button"
import { checkForUpdate, fetchCmsPage, getUpdatePlatform } from "@/lib/api"
import { ipc } from "@/lib/ipc/commands"
import { checkNativeUpdate, isUpdaterSupported } from "@/lib/updater"
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
  const [nativeUpdate, setNativeUpdate] = useState<Awaited<
    ReturnType<typeof checkNativeUpdate>
  > | null>(null)

  const info = useQuery({ queryKey: ["app-info"], queryFn: () => ipc.appInfo() })
  const updatesPage = useQuery({
    queryKey: ["cms-page", "updates"],
    queryFn: () => fetchCmsPage("updates"),
    staleTime: 1000 * 60 * 10,
    retry: 1,
  })

  const checkUpdates = useMutation({
    mutationFn: async () => {
      const version = info.data?.version ?? "0.1.7"
      const platform = getUpdatePlatform()
      const apiResult = await checkForUpdate(platform, version, "stable")

      let nativeResult: Awaited<ReturnType<typeof checkNativeUpdate>> | null = null
      if (isUpdaterSupported()) {
        try {
          nativeResult = await checkNativeUpdate()
          setNativeUpdate(nativeResult)
        } catch (error) {
          console.warn("Native updater check failed:", error)
        }
      }

      setLastCheckedAt(new Date())
      return { apiResult, nativeResult }
    },
  })

  const installUpdate = useMutation({
    mutationFn: async () => {
      if (!nativeUpdate?.install) {
        throw new Error("No installable update found")
      }
      await nativeUpdate.install()
    },
    onSuccess: () => {
      toast.success("Update installed. Restart SSHBool to finish.")
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to install update")
    },
  })

  const result = checkUpdates.data?.apiResult
  const hasApiUpdate = result?.has_update === true
  const hasNativeUpdate = nativeUpdate?.available === true
  const showUpdateBanner = hasApiUpdate || hasNativeUpdate

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
        {!isUpdaterSupported() && (
          <p className="text-muted-foreground mt-1 text-[11px]">
            OTA install works in production builds only. Dev mode can still check release info.
          </p>
        )}
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

      {checkUpdates.isError && (
        <div className="border-destructive/30 bg-destructive/5 flex items-start gap-2 rounded-lg border p-3">
          <AlertTriangle className="text-destructive mt-0.5 size-4 shrink-0" />
          <p className="text-destructive text-xs">Could not reach the update server.</p>
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
                <span className="text-foreground font-medium">
                  {nativeUpdate?.version ?? result.latest_version}
                </span>
                {result.is_critical && (
                  <span className="text-destructive ml-2 font-medium">Critical</span>
                )}
              </p>
            </div>
            {hasNativeUpdate && nativeUpdate?.install && (
              <Button
                size="sm"
                disabled={installUpdate.isPending}
                onClick={() => installUpdate.mutate()}
              >
                {installUpdate.isPending ? (
                  <Loader2 className="mr-2 size-3.5 animate-spin" />
                ) : (
                  <Download className="mr-2 size-3.5" />
                )}
                Install update
              </Button>
            )}
          </div>

          {(nativeUpdate?.body || result.notes) && (
            <p className="text-muted-foreground whitespace-pre-line text-xs leading-relaxed">
              {nativeUpdate?.body ?? result.notes}
            </p>
          )}

          {result.changelog.length > 0 && (
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

          {!hasNativeUpdate && result.download_url && (
            <p className="text-muted-foreground text-[11px]">
              Download manually from the{" "}
              <a
                href={result.download_url}
                target="_blank"
                rel="noreferrer"
                className="text-primary underline-offset-2 hover:underline"
              >
                release page
              </a>
              .
            </p>
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
