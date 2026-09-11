import { describe, expect, it } from "vitest"

import {
  findKeybindingConflicts,
  isValidKeybinding,
  matchesKeybinding,
  parseKeybinding,
} from "@/lib/keybinding-utils"

function keyEvent(init: {
  key: string
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
}): KeyboardEvent {
  return new KeyboardEvent("keydown", init)
}

describe("keybinding-utils", () => {
  it("parses Mod+K", () => {
    expect(parseKeybinding("Mod+K")).toEqual({
      mod: true,
      ctrl: false,
      alt: false,
      shift: false,
      meta: false,
      key: "K",
    })
  })

  it("matches Mod+K with ctrl", () => {
    expect(
      matchesKeybinding(keyEvent({ key: "k", ctrlKey: true }), "Mod+K")
    ).toBe(true)
  })

  it("matches single key d without modifiers", () => {
    expect(matchesKeybinding(keyEvent({ key: "d" }), "d")).toBe(true)
    expect(matchesKeybinding(keyEvent({ key: "d", ctrlKey: true }), "d")).toBe(
      false
    )
  })

  it("detects conflicts", () => {
    const conflicts = findKeybindingConflicts({
      a: "Mod+K",
      b: "Mod+K",
      c: "d",
    })
    expect(conflicts.get("Mod+K")).toEqual(["a", "b"])
    expect(conflicts.has("d")).toBe(false)
  })

  it("validates keybinding strings", () => {
    expect(isValidKeybinding("Mod+Shift+L")).toBe(true)
    expect(isValidKeybinding("Mod+")).toBe(false)
    expect(isValidKeybinding("")).toBe(false)
  })
})
