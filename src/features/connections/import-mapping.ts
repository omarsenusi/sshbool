import type { ImportedHost, NewHostDto } from "@/lib/ipc/types"

/**
 * Map a host discovered by an importer onto the app's create-host input.
 *
 * A host only gets password auth when the importer was confident enough to
 * attach a password; anything ambiguous arrives with `password: null` and
 * falls back to key auth, so an unclear credential is never silently applied.
 */
export function toNewHost(host: ImportedHost): NewHostDto {
  return {
    label: host.label,
    hostname: host.hostname,
    port: host.port,
    username: host.username ?? null,
    authMethod: host.password ? "password" : "key",
    groupId: null,
    identityId: null,
    notes: host.notes ?? null,
    color: null,
    icon: null,
    password: host.password ?? null,
    // Only bind the vault's latest key when there is no password to use.
    sshKeyId: host.password ? null : "auto",
  }
}

/** Stable identity for a host row — hostname:port is unique within a preview. */
export function hostKey(host: ImportedHost): string {
  return `${host.hostname}:${host.port}`
}
