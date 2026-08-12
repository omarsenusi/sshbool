import { beforeEach, describe, expect, it } from "vitest"

import { HOST_RAIL_SIZING, useLayoutStore } from "@/stores/layout.store"

const initial = useLayoutStore.getState()

describe("host rail layout state", () => {
  beforeEach(() => {
    useLayoutStore.setState({
      hostRailMode: initial.hostRailMode,
      hostRailWidth: { ...initial.hostRailWidth },
    })
  })

  it("defaults to icon mode at the icon default width", () => {
    const s = useLayoutStore.getState()
    expect(s.hostRailMode).toBe("icon")
    expect(s.hostRailWidth.icon).toBe(HOST_RAIL_SIZING.icon.default)
  })

  it("clamps widths written through the setter", () => {
    useLayoutStore.getState().setHostRailWidth("label", 10_000)
    expect(useLayoutStore.getState().hostRailWidth.label).toBe(
      HOST_RAIL_SIZING.label.max,
    )
  })

  it("keeps each mode's width independent when switching modes", () => {
    const { setHostRailWidth, setHostRailMode } = useLayoutStore.getState()
    setHostRailWidth("label", 300)
    setHostRailWidth("icon", 64)

    setHostRailMode("label")
    expect(useLayoutStore.getState().hostRailWidth.label).toBe(300)

    // Switching back must restore the icon width, not carry the label width over.
    setHostRailMode("icon")
    const s = useLayoutStore.getState()
    expect(s.hostRailMode).toBe("icon")
    expect(s.hostRailWidth.icon).toBe(64)
    expect(s.hostRailWidth.label).toBe(300)
  })
})
