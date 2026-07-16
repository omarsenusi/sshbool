import { describe, expect, it } from "vitest"

import { formatAppError } from "@/lib/ipc/commands"

describe("formatAppError", () => {
  it("formats unauthorized bad password", () => {
    expect(formatAppError({ kind: "Unauthorized", reason: "bad_password" })).toBe(
      "Incorrect password",
    )
  })
})
