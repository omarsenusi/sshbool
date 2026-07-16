import { Button } from "@/components/ui/button"

type Props = {
  version: string
  onLater: () => void
  onInstall: () => void
}

export function UpdateAvailableDialog({ version, onLater, onInstall }: Props) {
  return (
    <div className="glass fixed right-4 bottom-4 z-50 w-80 space-y-3 rounded-xl p-4 shadow-lg">
      <div>
        <h3 className="text-sm font-semibold">Update available</h3>
        <p className="text-muted-foreground text-xs">SSHBool {version} is ready to install.</p>
      </div>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onLater}>
          Later
        </Button>
        <Button size="sm" onClick={onInstall}>
          Install
        </Button>
      </div>
    </div>
  )
}
