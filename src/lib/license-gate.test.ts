import { formatAppError, IpcError } from "@/lib/ipc/commands"
import type { AppError } from "@/lib/ipc/types"
import { describe, expect, it } from "vitest"

describe("formatAppError", () => {
  it("formats unauthorized reasons", () => {
    const err: AppError = { kind: "Unauthorized", reason: "locked" }
    expect(formatAppError(err)).toContain("Unauthorized")
  })

  it("wraps IpcError", () => {
    const e = new IpcError({ kind: "Internal", message: "boom" })
    expect(e.message).toBe("boom")
  })
})

export function licenseAllowsSync(tier: string) {
  return tier === "pro" || tier === "team"
}

describe("licenseAllowsSync", () => {
  it("gates free", () => {
    expect(licenseAllowsSync("free")).toBe(false)
    expect(licenseAllowsSync("pro")).toBe(true)
  })
})
