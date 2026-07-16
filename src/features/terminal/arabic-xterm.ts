/**
 * xterm.js is LTR and has no BiDi/shaping. For Arabic we:
 * 1) reshape each *word* into presentation forms
 * 2) reverse glyphs *within* each word for LTR cells
 * 3) keep word order = typing/logical order (first word stays next to the prompt)
 *
 * Never reverse an entire phrase with spaces — that flips word order
 * (خلاص اخيرا اتظبطت → اتظبطت اخيرا خلاص).
 */

import { ArabicShaper } from "arabic-persian-reshaper"

const ANSI_SPLIT = /(\x1b(?:\[[0-9;?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-Z\\-_]))/g

/** Arabic letters only (not punctuation / digits in the Arabic block). */
export function isArabicLetter(ch: string): boolean {
  const cp = ch.codePointAt(0)
  if (cp === undefined) return false
  // Main Arabic letters
  if (cp >= 0x0621 && cp <= 0x064a) return true
  // Arabic presentation forms are already shaped — treat as Arabic letters
  if (cp >= 0xfb50 && cp <= 0xfdff) return true
  if (cp >= 0xfe70 && cp <= 0xfefc) return true
  // Extended Arabic letters
  if (cp >= 0x0671 && cp <= 0x06d3) return true
  if (cp >= 0x0750 && cp <= 0x077f) return true
  if (cp >= 0x08a0 && cp <= 0x08ff) return true
  // Combining marks (harakat) — keep attached to the word
  if (cp >= 0x064b && cp <= 0x065f) return true
  if (cp === 0x0670) return true
  return false
}

function reshapeWord(logicalWord: string): string {
  if (!logicalWord) return logicalWord
  const shaped = ArabicShaper.convertArabic(logicalWord)
  return [...shaped].reverse().join("")
}

/** Reshape Arabic per word; preserve spaces and word order. */
export function reshapeArabicKeepWordOrder(text: string): string {
  let out = ""
  let i = 0
  while (i < text.length) {
    const ch = text[i]!
    if (isArabicLetter(ch)) {
      let j = i + 1
      while (j < text.length && isArabicLetter(text[j]!)) j++
      out += reshapeWord(text.slice(i, j))
      i = j
    } else {
      out += ch
      i += 1
    }
  }
  return out
}

/** Prepare static text (ANSI-safe). */
export function prepareTextForXterm(text: string): string {
  if (![...text].some(isArabicLetter)) return text
  return text
    .split(ANSI_SPLIT)
    .map((part) => {
      if (!part || part.startsWith("\x1b")) return part
      return reshapeArabicKeepWordOrder(part)
    })
    .join("")
}

/**
 * Stateful fixer for live typing: accumulate one Arabic *word* at a time,
 * rewrite its visual form as letters arrive, flush on any non-letter.
 */
export class ArabicXtermFixer {
  private decoder = new TextDecoder("utf-8")
  private pendingLogical = ""
  private pendingVisualLen = 0

  feed(bytes: Uint8Array): string {
    const chunk = this.decoder.decode(bytes, { stream: true })
    if (!chunk) return ""

    // Fast path: no Arabic → pass through untouched (critical for htop/vim CSI streams).
    if (![...chunk].some(isArabicLetter) && !this.pendingLogical) {
      return chunk
    }

    let out = ""
    for (const part of chunk.split(ANSI_SPLIT)) {
      if (!part) continue
      if (part.startsWith("\x1b")) {
        out += this.commitPending()
        out += part
        continue
      }
      for (const ch of part) {
        if (isArabicLetter(ch)) {
          out += this.appendLetter(ch)
        } else {
          out += this.commitPending()
          out += ch
        }
      }
    }
    return out
  }

  private appendLetter(ch: string): string {
    let erase = ""
    if (this.pendingVisualLen > 0) {
      erase =
        "\b".repeat(this.pendingVisualLen) +
        " ".repeat(this.pendingVisualLen) +
        "\b".repeat(this.pendingVisualLen)
    }
    this.pendingLogical += ch
    const visual = reshapeWord(this.pendingLogical)
    this.pendingVisualLen = [...visual].length
    return erase + visual
  }

  /** Finish the current word; visual already on screen. */
  private commitPending(): string {
    this.pendingLogical = ""
    this.pendingVisualLen = 0
    return ""
  }
}

export function prepareBytesForXterm(bytes: Uint8Array): string {
  return prepareTextForXterm(new TextDecoder().decode(bytes))
}
