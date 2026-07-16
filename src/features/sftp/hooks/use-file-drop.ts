import { getCurrentWebview } from "@tauri-apps/api/webview"
import { useEffect, useRef, useState, type RefObject } from "react"

function physicalToCss(x: number, y: number) {
  const dpr = window.devicePixelRatio || 1
  return { x: x / dpr, y: y / dpr }
}

function pointInElement(
  el: HTMLElement | null | undefined,
  physical: { x: number; y: number },
) {
  if (!el) return false
  const { x, y } = physicalToCss(physical.x, physical.y)
  const r = el.getBoundingClientRect()
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
}

/**
 * OS file drops in Tauri (especially Windows) do not expose real paths via
 * HTML5 `dataTransfer.files`. Use the webview's native drag-drop events.
 *
 * When `targetRef` is set, highlight + accept drop only inside that element
 * (e.g. the remote SFTP pane).
 */
export function useOsFileDrop(
  enabled: boolean,
  onPaths: (paths: string[]) => void,
  targetRef?: RefObject<HTMLElement | null>,
) {
  const [dragging, setDragging] = useState(false)
  const onPathsRef = useRef(onPaths)
  onPathsRef.current = onPaths

  useEffect(() => {
    if (!enabled) {
      setDragging(false)
      return
    }

    let unlisten: (() => void) | undefined
    let cancelled = false

    void getCurrentWebview()
      .onDragDropEvent((event) => {
        const { payload } = event
        switch (payload.type) {
          case "enter":
          case "over": {
            const over = pointInElement(targetRef?.current, payload.position)
            setDragging(over)
            break
          }
          case "leave":
            setDragging(false)
            break
          case "drop": {
            setDragging(false)
            const over = pointInElement(targetRef?.current, payload.position)
            if (over && payload.paths.length > 0) {
              onPathsRef.current(payload.paths)
            }
            break
          }
        }
      })
      .then((fn) => {
        if (cancelled) fn()
        else unlisten = fn
      })
      .catch(() => {
        function hasFiles(e: DragEvent) {
          return Array.from(e.dataTransfer?.types ?? []).includes("Files")
        }
        function onOver(e: DragEvent) {
          if (!hasFiles(e)) return
          e.preventDefault()
          if (e.dataTransfer) e.dataTransfer.dropEffect = "copy"
          const over = pointInElement(targetRef?.current, {
            x: e.clientX * (window.devicePixelRatio || 1),
            y: e.clientY * (window.devicePixelRatio || 1),
          })
          setDragging(over)
        }
        function onLeave() {
          setDragging(false)
        }
        function onDrop(e: DragEvent) {
          if (!hasFiles(e)) return
          e.preventDefault()
          setDragging(false)
          const over = pointInElement(targetRef?.current, {
            x: e.clientX * (window.devicePixelRatio || 1),
            y: e.clientY * (window.devicePixelRatio || 1),
          })
          if (!over) return
          const paths = Array.from(e.dataTransfer?.files ?? [])
            .map((f) => (f as File & { path?: string }).path ?? "")
            .filter(Boolean)
          if (paths.length > 0) onPathsRef.current(paths)
        }
        window.addEventListener("dragover", onOver)
        window.addEventListener("dragleave", onLeave)
        window.addEventListener("drop", onDrop)
        unlisten = () => {
          window.removeEventListener("dragover", onOver)
          window.removeEventListener("dragleave", onLeave)
          window.removeEventListener("drop", onDrop)
        }
      })

    return () => {
      cancelled = true
      unlisten?.()
      setDragging(false)
    }
  }, [enabled, targetRef])

  return { dragging }
}
