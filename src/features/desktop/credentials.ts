/** Matches the placeholder returned by `hosts_get` when a password exists in vault. */
export const PASSWORD_PLACEHOLDER = "••••••••"

/** Prefer vault password; never treat the UI placeholder as a real password. */
export function resolveVaultPassword(
  uiPassword: string,
  vaultPassword?: string | null
): string {
  if (vaultPassword) {
    return vaultPassword
  }
  if (uiPassword && uiPassword !== PASSWORD_PLACEHOLDER) {
    return uiPassword
  }
  return ""
}
