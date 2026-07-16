/** Normalize remote paths so `.file` never appears (use `./file` or absolute). */
export function normalizeRemotePath(path: string): string {
  if (!path) return path
  const p = path.replace(/\\/g, "/")
  // Broken join of "." + "name" → ".name"
  if (p.length > 1 && p.startsWith(".") && p[1] !== "/") {
    return `./${p.slice(1)}`
  }
  if (p === ".") return "."
  // Collapse duplicate slashes except leading //
  return p.replace(/\/{2,}/g, "/")
}

export function joinRemotePath(base: string, name: string): string {
  const b = normalizeRemotePath(base || ".")
  if (!b || b === ".") return normalizeRemotePath(`./${name}`)
  if (b === "/") return `/${name}`
  if (b.endsWith("/")) return normalizeRemotePath(`${b}${name}`)
  return normalizeRemotePath(`${b}/${name}`)
}

export function parentRemotePath(path: string): string {
  const p = normalizeRemotePath(path)
  if (!p || p === "." || p === "/") return p === "/" ? "/" : "."
  const trimmed = p.replace(/\/+$/, "")
  const i = trimmed.lastIndexOf("/")
  if (i <= 0) return "/"
  if (trimmed.startsWith("./") && i === 1) return "."
  return trimmed.slice(0, i) || "/"
}

export function splitRemotePath(path: string): { dir: string; fragment: string } {
  const normalized = normalizeRemotePath(path || "")
  if (!normalized) return { dir: ".", fragment: "" }
  const i = normalized.lastIndexOf("/")
  if (i < 0) return { dir: ".", fragment: normalized }
  if (i === 0) return { dir: "/", fragment: normalized.slice(1) }
  return {
    dir: normalized.slice(0, i) || "/",
    fragment: normalized.slice(i + 1),
  }
}
