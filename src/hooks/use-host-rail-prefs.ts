import { useQuery } from "@tanstack/react-query"
import { useEffect, useRef } from "react"

import { ipc } from "@/lib/ipc/commands"
import {
  clampHostRailWidth,
  HOST_RAIL_SIZING,
  type HostRailMode,
  useLayoutStore,
} from "@/stores/layout.store"

/** Settings key holding the persisted host-rail preferences. */
export const HOST_RAIL_SETTING = "hostRail"

export type HostRailPrefs = {
  mode: HostRailMode
  width: Record<HostRailMode, number>
}

/** Coerce whatever is in the settings table into a usable prefs object. */
export function parseHostRailPrefs(raw: unknown): HostRailPrefs {
  const fallback: HostRailPrefs = {
    mode: "icon",
    width: {
      icon: HOST_RAIL_SIZING.icon.default,
      label: HOST_RAIL_SIZING.label.default,
    },
  }
  if (!raw || typeof raw !== "object") return fallback

  const value = raw as Record<string, unknown>
  const mode: HostRailMode = value.mode === "label" ? "label" : "icon"
  const width =
    value.width && typeof value.width === "object"
      ? (value.width as Record<string, unknown>)
      : {}

  const readWidth = (key: HostRailMode) => {
    const candidate = width[key]
    return typeof candidate === "number"
      ? clampHostRailWidth(key, candidate)
      : HOST_RAIL_SIZING[key].default
  }

  return {
    mode,
    width: { icon: readWidth("icon"), label: readWidth("label") },
  }
}

/**
 * Hydrates the layout store from persisted host-rail settings once per window.
 * Writes are pushed explicitly via {@link saveHostRailPrefs}, so a slow
 * hydration can never clobber a change the user just made.
 */
export function useHostRailPrefs() {
  const hydrated = useRef(false)
  const query = useQuery({
    queryKey: ["settings", HOST_RAIL_SETTING],
    queryFn: () => ipc.settingsGet(HOST_RAIL_SETTING),
    staleTime: Infinity,
  })

  useEffect(() => {
    if (hydrated.current || query.data === undefined) return
    hydrated.current = true
    const prefs = parseHostRailPrefs(query.data)
    useLayoutStore.setState({
      hostRailMode: prefs.mode,
      hostRailWidth: prefs.width,
    })
  }, [query.data])
}

/** Persist the current rail mode + widths. Fire-and-forget. */
export function saveHostRailPrefs() {
  const { hostRailMode, hostRailWidth } = useLayoutStore.getState()
  void ipc.settingsSet(HOST_RAIL_SETTING, {
    mode: hostRailMode,
    width: hostRailWidth,
  })
}
