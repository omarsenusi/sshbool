export type DbEngineKind = "postgres" | "mysql"

export function getEngineColor(engine: string) {
  switch (engine.toLowerCase()) {
    case "postgres":
    case "postgresql":
      return {
        bg: "bg-blue-500/10 border-blue-500/20 text-blue-400",
        gradient: "from-blue-600/30 via-indigo-600/20 to-transparent border-blue-500/30",
        accent: "text-blue-400 bg-blue-500/20 border-blue-500/30",
        btn: "bg-blue-600 hover:bg-blue-500 text-white",
        text: "text-blue-400",
        ring: "ring-blue-500/40",
      }
    case "mysql":
    case "mariadb":
      return {
        bg: "bg-amber-500/10 border-amber-500/20 text-amber-400",
        gradient: "from-amber-600/30 via-orange-600/20 to-transparent border-amber-500/30",
        accent: "text-amber-400 bg-amber-500/20 border-amber-500/30",
        btn: "bg-amber-600 hover:bg-amber-500 text-white",
        text: "text-amber-400",
        ring: "ring-amber-500/40",
      }
    default:
      return {
        bg: "bg-muted border-border text-muted-foreground",
        gradient: "from-neutral-800 to-neutral-900 border-neutral-700",
        accent: "text-neutral-400 bg-neutral-800",
        btn: "bg-neutral-700 hover:bg-neutral-600 text-white",
        text: "text-muted-foreground",
        ring: "ring-border",
      }
  }
}

export function defaultPort(engine: DbEngineKind): number {
  return engine === "mysql" ? 3306 : 5432
}

export function defaultUsername(engine: DbEngineKind): string {
  return engine === "mysql" ? "root" : "postgres"
}
