import { useQuery } from "@tanstack/react-query"

import { MarkdownContent } from "@/components/markdown-content"
import { fetchCmsPage } from "@/lib/api"
import { ipc } from "@/lib/ipc/commands"

export function AboutSettings() {
  const info = useQuery({
    queryKey: ["app-info"],
    queryFn: () => ipc.appInfo(),
  })
  const aboutPage = useQuery({
    queryKey: ["cms-page", "about"],
    queryFn: () => fetchCmsPage("about"),
    staleTime: 1000 * 60 * 10,
    retry: 1,
  })

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h2 className="font-semibold">About</h2>
        <p className="mt-1 text-sm">
          {info.data?.name ?? "SSHBool"} {info.data?.version ?? "0.1.7"}
        </p>
        <p className="text-xs text-muted-foreground">
          Tauri {info.data?.tauriVersion ?? "2"}
        </p>
      </div>

      {aboutPage.isLoading && (
        <p className="text-xs text-muted-foreground">Loading about content…</p>
      )}

      {aboutPage.isError && (
        <p className="text-xs text-muted-foreground">
          Could not load about content from the server.
        </p>
      )}

      {aboutPage.data && (
        <div className="space-y-2 rounded-lg border border-border p-4">
          <MarkdownContent content={aboutPage.data.content} />
          {aboutPage.data.updated_at && (
            <p className="pt-2 text-[11px] text-muted-foreground">
              Updated {new Date(aboutPage.data.updated_at).toLocaleDateString()}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
