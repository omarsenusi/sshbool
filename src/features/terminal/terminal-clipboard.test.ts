import { describe, expect, it } from "vitest"

import { prepareTextForTerminalPaste } from "@/features/terminal/terminal-clipboard"
import {
  DEFAULT_TERMINAL_CLIPBOARD_SETTINGS,
  isTerminalCopyShortcut,
  isTerminalPasteShortcut,
  isTerminalSettingEnabled,
  resolveTerminalClipboardSettings,
} from "@/features/terminal/terminal-clipboard-settings"

describe("isTerminalSettingEnabled", () => {
  it("defaults to enabled when unset", () => {
    expect(isTerminalSettingEnabled(null)).toBe(true)
    expect(isTerminalSettingEnabled(undefined)).toBe(true)
  })

  it("respects explicit boolean values", () => {
    expect(isTerminalSettingEnabled(true)).toBe(true)
    expect(isTerminalSettingEnabled(false)).toBe(false)
  })
})

describe("resolveTerminalClipboardSettings", () => {
  it("uses devops-friendly defaults", () => {
    expect(resolveTerminalClipboardSettings({})).toEqual(
      DEFAULT_TERMINAL_CLIPBOARD_SETTINGS
    )
  })

  it("falls back to legacy right-click paste setting for context menu", () => {
    expect(
      resolveTerminalClipboardSettings({
        contextMenu: true,
      }).contextMenu
    ).toBe(true)
  })
})

describe("prepareTextForTerminalPaste", () => {
  it("normalizes line endings for remote shells", () => {
    expect(prepareTextForTerminalPaste("line1\nline2")).toBe("line1\rline2")
  })
})

describe("terminal shortcut matching", () => {
  it("matches ctrl+v paste", () => {
    const event = {
      type: "keydown",
      key: "v",
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      repeat: false,
      defaultPrevented: false,
    } as KeyboardEvent

    expect(
      isTerminalPasteShortcut(event, DEFAULT_TERMINAL_CLIPBOARD_SETTINGS)
    ).toBe(true)
  })

  it("matches ctrl+c copy chord", () => {
    const event = {
      type: "keydown",
      key: "c",
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      repeat: false,
      defaultPrevented: false,
    } as KeyboardEvent

    expect(
      isTerminalCopyShortcut(event, DEFAULT_TERMINAL_CLIPBOARD_SETTINGS)
    ).toBe(true)
  })
})
