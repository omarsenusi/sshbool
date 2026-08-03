import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Check, ChevronDown, ExternalLink, FolderPlus, Plus, Sparkles, Trash2 } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ipc } from "@/lib/ipc/commands"
import { cn } from "@/lib/utils"
export type Workspace = {
  id: string
  name: string
  color?: string
}
const DEFAULT_WORKSPACES: Workspace[] = [
  { id: "default", name: "Infrastructure Workspace", color: "#0EA5E9" },
]
export function WorkspaceSwitcher() {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [newWorkspaceName, setNewWorkspaceName] = useState("")
  const menuRef = useRef<HTMLDivElement>(null)

  // Local window workspace override (from URL ?wsId=)
  const urlWsId = new URLSearchParams(window.location.search).get("wsId")
  const [localWsId, setLocalWsId] = useState<string | null>(urlWsId)

  async function openWorkspaceInNewWindow(ws: Workspace, e: React.MouseEvent) {
    e.stopPropagation()
    try {
      await ipc.workspaceWindowOpen(ws.id, `SSHBool - ${ws.name}`)
    } catch {
      window.open(`/?wsId=${ws.id}`, "_blank", "width=1200,height=800")
    }
    setOpen(false)
  }

  // Fetch workspaces list from settings
  const workspacesQuery = useQuery<Workspace[]>({
    queryKey: ["settings", "workspaces"],
    queryFn: async () => {
      const stored = await ipc.settingsGet("workspaces")
      if (Array.isArray(stored) && stored.length > 0) {
        return stored as Workspace[]
      }
      return DEFAULT_WORKSPACES
    },
  })

  // Fetch active workspace ID
  const activeIdQuery = useQuery<string>({
    queryKey: ["settings", "activeWorkspaceId", localWsId],
    queryFn: async () => {
      if (localWsId) return localWsId
      const stored = await ipc.settingsGet("activeWorkspaceId")
      return typeof stored === "string" ? stored : "default"
    },
  })

  const workspaces = workspacesQuery.data ?? DEFAULT_WORKSPACES
  const activeId = activeIdQuery.data ?? "default"
  const activeWorkspace = workspaces.find((w) => w.id === activeId) ?? workspaces[0]!

  // Switch workspace
  const switchWorkspace = useMutation({
    mutationFn: async (id: string) => {
      if (urlWsId) {
        setLocalWsId(id)
      } else {
        await ipc.settingsSet("activeWorkspaceId", id)
      }
    },
    onSuccess: () => {
      setOpen(false)
      void qc.invalidateQueries({ queryKey: ["settings", "activeWorkspaceId"] })
      void qc.invalidateQueries({ queryKey: ["hosts"] })
    },
  })
  // Create new workspace
  const createWorkspace = useMutation({
    mutationFn: async (name: string) => {
      const id = `ws_${Date.now()}`
      const newWs: Workspace = {
        id,
        name: name.trim(),
        color: ["#0EA5E9", "#10B981", "#8B5CF6", "#EC4899", "#F59E0B"][
          workspaces.length % 5
        ],
      }
      const updated = [...workspaces, newWs]
      await ipc.settingsSet("workspaces", updated)
      await ipc.settingsSet("activeWorkspaceId", id)
    },
    onSuccess: () => {
      setNewWorkspaceName("")
      setCreateOpen(false)
      setOpen(false)
      void qc.invalidateQueries({ queryKey: ["settings", "workspaces"] })
      void qc.invalidateQueries({ queryKey: ["settings", "activeWorkspaceId"] })
      void qc.invalidateQueries({ queryKey: ["hosts"] })
    },
  })
  // Delete workspace
  const deleteWorkspace = useMutation({
    mutationFn: async (id: string) => {
      const updated = workspaces.filter((w) => w.id !== id)
      await ipc.settingsSet("workspaces", updated)
      if (activeId === id) {
        await ipc.settingsSet("activeWorkspaceId", "default")
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["settings", "workspaces"] })
      void qc.invalidateQueries({ queryKey: ["settings", "activeWorkspaceId"] })
    },
  })
  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) {
      window.addEventListener("mousedown", handleClickOutside)
    }
    return () => window.removeEventListener("mousedown", handleClickOutside)
  }, [open])
  return (
    <div ref={menuRef} className="relative inline-flex items-center">
      {/* Workspace Trigger Button */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          "flex items-center gap-1.5 rounded-md px-2 py-0.5 text-left transition-colors hover:bg-muted/60",
          open && "bg-muted/80"
        )}
        title="Switch or create workspace"
      >
        <span
          className="size-2 rounded-full shrink-0"
          style={{ backgroundColor: activeWorkspace.color ?? "#0EA5E9" }}
        />
        <span className="text-muted-foreground hidden truncate text-[11px] font-medium sm:inline max-w-[140px]">
          {activeWorkspace.name}
        </span>
        <ChevronDown className="size-3 text-muted-foreground shrink-0 opacity-70" />
      </button>
      {/* Dropdown Menu */}
      {open && (
        <div className="absolute left-0 top-full mt-1.5 z-50 w-64 rounded-lg border border-border/80 bg-popover p-1 text-popover-foreground shadow-lg backdrop-blur-sm animate-in fade-in-50 zoom-in-95">
          <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
            Workspaces
          </div>
          <div className="space-y-0.5 max-h-56 overflow-y-auto">
            {workspaces.map((ws) => {
              const isSelected = ws.id === activeId
              return (
                <div
                  key={ws.id}
                  className={cn(
                    "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-xs transition-colors group",
                    isSelected
                      ? "bg-accent text-accent-foreground font-medium"
                      : "hover:bg-muted/60 text-foreground"
                  )}
                >
                  <button
                    type="button"
                    onClick={() => switchWorkspace.mutate(ws.id)}
                    className="flex flex-1 items-center gap-2 min-w-0 text-left cursor-pointer"
                  >
                    <span
                      className="size-2 rounded-full shrink-0"
                      style={{ backgroundColor: ws.color ?? "#0EA5E9" }}
                    />
                    <span className="truncate">{ws.name}</span>
                  </button>
                  <div className="flex items-center gap-1">
                    {/* Open in new window button */}
                    <button
                      type="button"
                      onClick={(e) => openWorkspaceInNewWindow(ws, e)}
                      className="opacity-70 hover:opacity-100 text-muted-foreground hover:text-primary p-1 transition-all rounded hover:bg-muted"
                      title={`Open ${ws.name} in a new window/tab`}
                    >
                      <ExternalLink className="size-3" />
                    </button>

                    {isSelected && <Check className="size-3.5 text-primary shrink-0 ml-0.5" />}
                    {ws.id !== "default" && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          deleteWorkspace.mutate(ws.id)
                        }}
                        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive p-1 transition-opacity"
                        title="Delete workspace"
                      >
                        <Trash2 className="size-3" />
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          <div className="my-1 h-[1px] bg-border/60" />
          {/* Create New Workspace Option */}
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              setCreateOpen(true)
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-primary hover:bg-primary/10 transition-colors font-medium"
          >
            <Plus className="size-3.5" />
            <span>Create New Workspace</span>
          </button>
        </div>
      )}
      {/* Create Workspace Modal */}
      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs animate-in fade-in">
          <div className="w-full max-w-sm rounded-xl border border-border/80 bg-card p-5 shadow-xl space-y-4">
            <div className="flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <FolderPlus className="size-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">New Workspace</h3>
                <p className="text-[11px] text-muted-foreground">Create a separate workspace for your servers.</p>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ws-name" className="text-xs">Workspace Name</Label>
              <Input
                id="ws-name"
                autoFocus
                placeholder="e.g. Client Projects or Cloud Cluster"
                className="h-8 text-xs"
                value={newWorkspaceName}
                onChange={(e) => setNewWorkspaceName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newWorkspaceName.trim()) {
                    createWorkspace.mutate(newWorkspaceName)
                  }
                }}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                size="xs"
                className="h-7 text-xs"
                onClick={() => setCreateOpen(false)}
              >
                Cancel
              </Button>
              <Button
                size="xs"
                disabled={!newWorkspaceName.trim() || createWorkspace.isPending}
                className="h-7 text-xs gap-1"
                onClick={() => createWorkspace.mutate(newWorkspaceName)}
              >
                <Sparkles className="size-3" />
                {createWorkspace.isPending ? "Creating..." : "Create Workspace"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
