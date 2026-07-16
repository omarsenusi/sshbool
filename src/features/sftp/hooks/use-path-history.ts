import { useCallback, useMemo, useRef, useState } from "react"

/** Browser-like back/forward history for an SFTP (or local) path bar. */
export function usePathHistory(initialPath = "") {
  const [path, setPathState] = useState(initialPath)
  const backStack = useRef<string[]>([])
  const forwardStack = useRef<string[]>([])

  /** Navigate and push current path onto the back stack. */
  const navigate = useCallback((next: string) => {
    setPathState((cur) => {
      if (!next || next === cur) return cur
      if (cur) backStack.current.push(cur)
      forwardStack.current = []
      return next
    })
  }, [])

  /** Set path without touching history (e.g. home bootstrap, `.` → absolute). */
  const replace = useCallback((next: string) => {
    setPathState((cur) => (next && next !== cur ? next : cur))
  }, [])

  const goBack = useCallback(() => {
    setPathState((cur) => {
      const prev = backStack.current.pop()
      if (prev == null) return cur
      if (cur) forwardStack.current.push(cur)
      return prev
    })
  }, [])

  const goForward = useCallback(() => {
    setPathState((cur) => {
      const next = forwardStack.current.pop()
      if (next == null) return cur
      if (cur) backStack.current.push(cur)
      return next
    })
  }, [])

  const canGoBack = useCallback(() => backStack.current.length > 0, [])
  const canGoForward = useCallback(() => forwardStack.current.length > 0, [])

  return useMemo(
    () => ({
      path,
      navigate,
      replace,
      goBack,
      goForward,
      canGoBack,
      canGoForward,
    }),
    [path, navigate, replace, goBack, goForward, canGoBack, canGoForward],
  )
}
