import { describe, expect, it } from "vitest"

import { parseHostRailPrefs } from "@/hooks/use-host-rail-prefs"
import { clampHostRailWidth, HOST_RAIL_SIZING } from "@/stores/layout.store"

describe("clampHostRailWidth", () => {
  it("keeps widths inside each mode's bounds", () => {
    expect(clampHostRailWidth("icon", 10)).toBe(HOST_RAIL_SIZING.icon.min)
    expect(clampHostRailWidth("icon", 9999)).toBe(HOST_RAIL_SIZING.icon.max)
    expect(clampHostRailWidth("label", 220)).toBe(220)
  })

  it("falls back to the default for non-finite input", () => {
    expect(clampHostRailWidth("label", Number.NaN)).toBe(
      HOST_RAIL_SIZING.label.default,
    )
  })
})

describe("parseHostRailPrefs", () => {
  it("defaults to icon mode when nothing is stored", () => {
    const prefs = parseHostRailPrefs(null)
    expect(prefs.mode).toBe("icon")
    expect(prefs.width.icon).toBe(HOST_RAIL_SIZING.icon.default)
    expect(prefs.width.label).toBe(HOST_RAIL_SIZING.label.default)
  })

  it("round-trips a stored value", () => {
    const prefs = parseHostRailPrefs({
      mode: "label",
      width: { icon: 60, label: 260 },
    })
    expect(prefs).toEqual({ mode: "label", width: { icon: 60, label: 260 } })
  })

  it("clamps out-of-range stored widths", () => {
    const prefs = parseHostRailPrefs({
      mode: "label",
      width: { icon: 5, label: 5000 },
    })
    expect(prefs.width.icon).toBe(HOST_RAIL_SIZING.icon.min)
    expect(prefs.width.label).toBe(HOST_RAIL_SIZING.label.max)
  })

  it("ignores malformed shapes without throwing", () => {
    expect(parseHostRailPrefs("nonsense").mode).toBe("icon")
    expect(parseHostRailPrefs({ mode: "bogus" }).mode).toBe("icon")
    expect(
      parseHostRailPrefs({ mode: "label", width: "oops" }).width.label,
    ).toBe(HOST_RAIL_SIZING.label.default)
  })
})
