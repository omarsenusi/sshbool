import {
  Activity,
  Bot,
  Cloud,
  Database,
  Shield,
  FolderKey,
  HardDrive,
  Settings,
  TerminalSquare,
  FileCode2,
  Server,
  Wrench,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { type ActivityId, useLayoutStore } from "@/stores/layout.store"

const items: { id: ActivityId; icon: typeof Server; label: string }[] = [
  { id: "connections", icon: Server, label: "Connections" },
  { id: "terminal", icon: TerminalSquare, label: "Terminal" },
  { id: "sftp", icon: HardDrive, label: "SFTP" },
  { id: "editor", icon: FileCode2, label: "Editor" },
  { id: "dashboard", icon: Activity, label: "Dashboard" },
  // Docker / Kubernetes hidden for now — bring back when ready.
  { id: "databases", icon: Database, label: "Databases" },
  { id: "devtools", icon: Wrench, label: "Dev Tools" },
  { id: "ai", icon: Bot, label: "AI" },
  { id: "keys", icon: FolderKey, label: "Keys" },
  // Plugins hidden for now — bring back when ready.
  { id: "audit", icon: Shield, label: "Audit" },
  { id: "sync", icon: Cloud, label: "Sync" },
  { id: "settings", icon: Settings, label: "Settings" },
]

export function ActivityBar() {
  const activity = useLayoutStore((s) => s.activity)
  const setActivity = useLayoutStore((s) => s.setActivity)

  return (
    <nav
      className="bg-sidebar border-border flex w-[var(--activitybar-w)] shrink-0 flex-col items-center gap-1 overflow-y-auto border-r py-2"
      aria-label="Activity"
    >
      {items.map(({ id, icon: Icon, label }) => (
        <Button
          key={id}
          variant="ghost"
          size="icon"
          aria-label={label}
          title={label}
          aria-current={activity === id ? "page" : undefined}
          className={cn(
            "text-muted-foreground",
            activity === id && "bg-sidebar-accent text-sidebar-accent-foreground",
          )}
          onClick={() => setActivity(id)}
        >
          <Icon />
        </Button>
      ))}
    </nav>
  )
}
