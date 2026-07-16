import type { HostDto, HostTreeNode } from "@/lib/ipc/types"

const HOST_PALETTE = [
  "#0d9488", // teal
  "#2563eb", // blue
  "#7c3aed", // violet
  "#db2777", // pink
  "#ea580c", // orange
  "#16a34a", // green
  "#ca8a04", // yellow
  "#0891b2", // cyan
  "#dc2626", // red
  "#4f46e5", // indigo
]

export function flattenHosts(nodes: HostTreeNode[]): HostDto[] {
  const out: HostDto[] = []
  for (const n of nodes) {
    if (n.kind === "host") out.push(n.host)
    else out.push(...flattenHosts(n.children))
  }
  return out
}

export function hostLetter(label: string): string {
  const trimmed = label.trim()
  if (!trimmed) return "#"
  const letter = [...trimmed][0] ?? "#"
  return letter.toLocaleUpperCase()
}

export function hostAccent(host: { id: string; color?: string | null }): string {
  if (host.color && /^#[0-9a-fA-F]{3,8}$/.test(host.color)) return host.color
  let hash = 0
  for (let i = 0; i < host.id.length; i++) {
    hash = (hash * 31 + host.id.charCodeAt(i)) >>> 0
  }
  return HOST_PALETTE[hash % HOST_PALETTE.length]!
}

export const HOST_COLOR_PRESETS = HOST_PALETTE
