import { useQuery } from "@tanstack/react-query"
import { ReactNode } from "react"
import { ipc } from "@/lib/ipc/commands"
export function FontProvider({ children }: { children: ReactNode }) {
  const appFont = useQuery({
    queryKey: ["settings", "appFont"],
    queryFn: () => ipc.settingsGet("appFont") as Promise<string | null>,
  })
  const terminalFont = useQuery({
    queryKey: ["settings", "terminalFont"],
    queryFn: () => ipc.settingsGet("terminalFont") as Promise<string | null>,
  })
  const appFontName = appFont.data?.trim()
  const terminalFontName = terminalFont.data?.trim()
  const fontsToLoad = new Set<string>()
  if (appFontName) fontsToLoad.add(appFontName)
  if (terminalFontName) fontsToLoad.add(terminalFontName)
  const fontImports = Array.from(fontsToLoad)
    .map(
      (f) =>
        `@import url('https://fonts.googleapis.com/css2?family=${f.replace(/ /g, "+")}:wght@400;500;600;700&display=swap');`,
    )
    .join("\n")
  return (
    <>
      {fontsToLoad.size > 0 && (
        <style dangerouslySetInnerHTML={{ __html: fontImports }} />
      )}
      {appFontName && (
        <style
          dangerouslySetInnerHTML={{
            __html: `:root { --font-sans: "${appFontName}", system-ui, sans-serif !important; }`,
          }}
        />
      )}
      {children}
    </>
  )
}
