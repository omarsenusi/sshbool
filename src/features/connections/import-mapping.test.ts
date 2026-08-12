import { describe, expect, it } from "vitest"

import { toNewHost } from "@/features/connections/import-mapping"
import type { ImportedHost } from "@/lib/ipc/types"

function host(overrides: Partial<ImportedHost> = {}): ImportedHost {
  return {
    label: "core-sw",
    hostname: "10.0.0.1",
    port: 22,
    username: "admin",
    ...overrides,
  }
}

describe("toNewHost", () => {
  it("uses password auth when a password came across", () => {
    const dto = toNewHost(host({ password: "hunter2" }))
    expect(dto.authMethod).toBe("password")
    expect(dto.password).toBe("hunter2")
    // Binding the vault's latest key would be wrong when we have a password.
    expect(dto.sshKeyId).toBeNull()
  })

  it("falls back to key auth when no password is available", () => {
    const dto = toNewHost(host())
    expect(dto.authMethod).toBe("key")
    expect(dto.password).toBeNull()
    expect(dto.sshKeyId).toBe("auto")
  })

  it("never carries an ambiguous password through to the host", () => {
    const dto = toNewHost(
      host({
        password: null,
        passwordConfidence: "ambiguous",
        passwordNote: "3 candidates",
      }),
    )
    expect(dto.password).toBeNull()
    expect(dto.authMethod).toBe("key")
  })

  it("preserves identity fields", () => {
    const dto = toNewHost(host({ port: 2222, notes: "OS: ios" }))
    expect(dto).toMatchObject({
      label: "core-sw",
      hostname: "10.0.0.1",
      port: 2222,
      username: "admin",
      notes: "OS: ios",
    })
  })

  it("tolerates a missing username", () => {
    const dto = toNewHost(host({ username: null }))
    expect(dto.username).toBeNull()
  })
})
