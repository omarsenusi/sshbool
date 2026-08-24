import { useTheme } from "next-themes"
import { useMemo } from "react"

import { useKeybindingsRegistry } from "@/hooks/use-keybindings"
import { ipc } from "@/lib/ipc/commands"
import { useLayoutStore } from "@/stores/layout.store"

/** Global keyboard shortcuts registered from settings keybindings. */
export function GlobalKeybindings() {
  const setActivity = useLayoutStore((s) => s.setActivity)
  const setSelectedHostId = useLayoutStore((s) => s.setSelectedHostId)
  const { resolvedTheme, setTheme } = useTheme()

  const handlers = useMemo(
    () => ({
      "vault.lock": () => void ipc.vaultLock(),
      "activity.terminal": () => setActivity("terminal"),
      "activity.sftp": () => setActivity("sftp"),
      "activity.editor": () => setActivity("editor"),
      "activity.connections": () => {
        setSelectedHostId(null)
        setActivity("connections")
      },
      "theme.toggle": () => setTheme(resolvedTheme === "dark" ? "light" : "dark"),
    }),
    [resolvedTheme, setActivity, setSelectedHostId, setTheme],
  )

  useKeybindingsRegistry(handlers)

  return null
}
