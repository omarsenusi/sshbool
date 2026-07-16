/** Format byte counts as human-readable sizes (1024-based). */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || Number.isNaN(bytes)) return "—"
  if (bytes < 0) return "—"
  if (bytes === 0) return "0 B"
  const units = ["B", "KB", "MB", "GB", "TB", "PB"] as const
  let n = bytes
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  const digits = i === 0 ? 0 : n < 10 ? 1 : 0
  return `${n.toFixed(digits)} ${units[i]}`
}

/** Format unix seconds or ms timestamp for file lists. */
export function formatMtime(ts: number | null | undefined): string {
  if (!ts) return "—"
  // Heuristic: seconds vs ms
  const ms = ts < 1e12 ? ts * 1000 : ts
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(ms))
  } catch {
    return "—"
  }
}
