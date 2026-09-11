import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useSetting } from "@/hooks/use-setting"
import { SETTINGS, type SftpOpenFileIn } from "@/lib/settings-defaults"

const fieldClass =
  "border-input bg-background w-full max-w-md rounded-md border px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"

export function SftpSettingsPanel() {
  const remoteStartPath = useSetting(SETTINGS.sftp.remoteStartPath)
  const confirmDelete = useSetting(SETTINGS.sftp.confirmDelete)
  const showHidden = useSetting(SETTINGS.sftp.showHidden)
  const openFileIn = useSetting(SETTINGS.sftp.openFileIn)

  return (
    <div className="max-w-lg space-y-6">
      <div>
        <h2 className="font-semibold">SFTP</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          File transfer explorer defaults and safety options.
        </p>
      </div>

      <div className="space-y-4 border-t border-border pt-4">
        <label className="block space-y-1">
          <span className="text-sm font-medium">Remote start path</span>
          <p className="text-xs text-muted-foreground">
            Initial remote directory when opening SFTP (e.g.{" "}
            <code className="font-mono">.</code> or{" "}
            <code className="font-mono">/var/log</code>).
          </p>
          <input
            className={fieldClass}
            value={String(remoteStartPath.value)}
            onChange={(e) => remoteStartPath.setValue(e.target.value)}
            spellCheck={false}
          />
        </label>

        <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
          <div className="space-y-0.5">
            <label className="text-sm font-medium" htmlFor="sftp-show-hidden">
              Show hidden files
            </label>
            <p className="text-xs text-muted-foreground">
              Show dotfiles in local and remote panes.
            </p>
          </div>
          <Switch
            id="sftp-show-hidden"
            checked={!!showHidden.value}
            onCheckedChange={(v) => showHidden.setValue(v)}
          />
        </div>

        <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
          <div className="space-y-0.5">
            <label
              className="text-sm font-medium"
              htmlFor="sftp-confirm-delete"
            >
              Confirm before delete
            </label>
            <p className="text-xs text-muted-foreground">
              Ask for confirmation when deleting files or folders.
            </p>
          </div>
          <Switch
            id="sftp-confirm-delete"
            checked={!!confirmDelete.value}
            onCheckedChange={(v) => confirmDelete.setValue(v)}
          />
        </div>

        <label className="block space-y-1">
          <span className="text-sm font-medium">Open files in</span>
          <Select
            value={String(openFileIn.value)}
            onValueChange={(v) => {
              if (v) openFileIn.setValue(v as SftpOpenFileIn)
            }}
          >
            <SelectTrigger className="max-w-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="popout">Pop-out window</SelectItem>
              <SelectItem value="editor">In-app editor</SelectItem>
            </SelectContent>
          </Select>
        </label>
      </div>
    </div>
  )
}
