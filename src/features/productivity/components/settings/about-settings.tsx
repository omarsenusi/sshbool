import { useQuery } from "@tanstack/react-query"

import { MarkdownContent } from "@/components/markdown-content"
import { fetchCmsPage } from "@/lib/api"
import { ipc } from "@/lib/ipc/commands"

export function AboutSettings() {
  const info = useQuery({ queryKey: ["app-info"], queryFn: () => ipc.appInfo() })
  const aboutPage = useQuery({
    queryKey: ["cms-page", "about"],
    queryFn: () => fetchCmsPage("about"),
    staleTime: 1000 * 60 * 10,
    retry: 1,
  })

  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <h2 className="font-semibold">About</h2>
        <p className="mt-1 text-sm">
          {info.data?.name ?? "SSHBool"} {info.data?.version ?? "0.1.7"}
        </p>
        <p className="text-muted-foreground text-xs">
          Tauri {info.data?.tauriVersion ?? "2"}
        </p>
      </div>

      {aboutPage.isLoading && (
        <p className="text-muted-foreground text-xs">Loading about content…</p>
      )}

      {aboutPage.isError && (
        <p className="text-muted-foreground text-xs">
          Could not load about content from the server.
        </p>
      )}

      {aboutPage.data && (
        <div className="border-border space-y-2 rounded-lg border p-4">
          <MarkdownContent content={aboutPage.data.content} />
          {aboutPage.data.updated_at && (
            <p className="text-muted-foreground pt-2 text-[11px]">
              Updated {new Date(aboutPage.data.updated_at).toLocaleDateString()}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
