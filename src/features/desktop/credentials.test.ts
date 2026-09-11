import { describe, expect, it } from "vitest"

import { PASSWORD_PLACEHOLDER, resolveVaultPassword } from "./credentials"

describe("resolveVaultPassword", () => {
  it("prefers vault password over UI placeholder", () => {
    expect(resolveVaultPassword(PASSWORD_PLACEHOLDER, "real-secret")).toBe("real-secret")
  })

  it("uses manual UI password when not placeholder", () => {
    expect(resolveVaultPassword("typed-pass", "vault-pass")).toBe("vault-pass")
    expect(resolveVaultPassword("typed-only", undefined)).toBe("typed-only")
  })

  it("returns empty when only placeholder is present", () => {
    expect(resolveVaultPassword(PASSWORD_PLACEHOLDER, undefined)).toBe("")
  })
})
