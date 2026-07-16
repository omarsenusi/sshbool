import { describe, expect, it } from "vitest"

import {
  ArabicXtermFixer,
  prepareTextForXterm,
  reshapeArabicKeepWordOrder,
} from "@/features/terminal/arabic-xterm"

describe("reshapeArabicKeepWordOrder", () => {
  it("keeps typing word order (first word stays first)", () => {
    const logical = "خلاص اخيرا اتظبطت"
    const out = reshapeArabicKeepWordOrder(logical)
    const brokenFullReverse = [...logical].reverse().join("")
    // Must not be a full-string reverse (that flips word order).
    expect(out).not.toBe(brokenFullReverse)
    // First visual word corresponds to خلاص, not اتظبطت
    const firstWord = out.split(/\s+/)[0]!
    const lastWord = out.split(/\s+/).at(-1)!
    const khalas = reshapeArabicKeepWordOrder("خلاص")
    const atzabattet = reshapeArabicKeepWordOrder("اتظبطت")
    expect(firstWord).toBe(khalas)
    expect(lastWord).toBe(atzabattet)
  })
})

describe("prepareTextForXterm", () => {
  it("leaves ASCII alone", () => {
    expect(prepareTextForXterm("hello $ ")).toBe("hello $ ")
  })

  it("preserves ANSI around Arabic", () => {
    const out = prepareTextForXterm("\x1b[32mخلاص\x1b[0m")
    expect(out.startsWith("\x1b[32m")).toBe(true)
    expect(out.endsWith("\x1b[0m")).toBe(true)
  })
})

describe("ArabicXtermFixer", () => {
  it("types words in order: خلاص then اخيرا", () => {
    const fix = new ArabicXtermFixer()
    const enc = new TextEncoder()
    let screen = ""

    for (const ch of "خلاص") {
      screen = applyLocal(screen, fix.feed(enc.encode(ch)))
    }
    screen = applyLocal(screen, fix.feed(enc.encode(" ")))
    for (const ch of "اخيرا") {
      screen = applyLocal(screen, fix.feed(enc.encode(ch)))
    }

    const khalas = reshapeArabicKeepWordOrder("خلاص")
    expect(screen.startsWith(khalas)).toBe(true)
    expect(screen.indexOf(khalas)).toBeLessThan(screen.indexOf(reshapeArabicKeepWordOrder("اخيرا")))
  })
})

/** Apply xterm-ish backspace/space erase from fixer output onto a string screen. */
function applyLocal(screen: string, chunk: string): string {
  for (const ch of chunk) {
    if (ch === "\b") {
      screen = screen.slice(0, -1)
    } else {
      screen += ch
    }
  }
  return screen
}
