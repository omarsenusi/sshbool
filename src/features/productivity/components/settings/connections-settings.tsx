import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { useSetting } from "@/hooks/use-setting"
import { SETTINGS, type AuthMethodDefault } from "@/lib/settings-defaults"

const fieldClass =
  "border-input bg-background w-full max-w-xs rounded-md border px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"

export function ConnectionsSettings() {
  const defaultPort = useSetting(SETTINGS.connections.defaultPort)
  const defaultUsername = useSetting(SETTINGS.connections.defaultUsername)
  const defaultAuthMethod = useSetting(SETTINGS.connections.defaultAuthMethod)
  const autoConnect = useSetting(SETTINGS.connections.autoConnectOnSelect)
  const keepalive = useSetting(SETTINGS.connections.keepaliveSecs)

  return (
    <div className="space-y-6 max-w-lg">
      <div>
        <h2 className="font-semibold">Connections</h2>
        <p className="text-muted-foreground mt-1 text-xs">
          Defaults for new hosts and global SSH behavior.
        </p>
      </div>

      <div className="space-y-4 border-t border-border pt-4">
        <label className="block space-y-1">
          <span className="text-sm font-medium">Default port</span>
          <input
            type="number"
            min={1}
            max={65535}
            className={fieldClass}
            value={Number(defaultPort.value)}
            onChange={(e) => defaultPort.setValue(Number(e.target.value) || 22)}
          />
        </label>

        <label className="block space-y-1">
          <span className="text-sm font-medium">Default username</span>
          <input
            className={fieldClass}
            value={String(defaultUsername.value)}
            onChange={(e) => defaultUsername.setValue(e.target.value)}
          />
        </label>

        <label className="block space-y-1">
          <span className="text-sm font-medium">Default auth method</span>
          <Select
            value={String(defaultAuthMethod.value)}
            onValueChange={(v) => {
              if (v) defaultAuthMethod.setValue(v as AuthMethodDefault)
            }}
          >
            <SelectTrigger className="max-w-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="key">SSH key</SelectItem>
              <SelectItem value="password">Password</SelectItem>
              <SelectItem value="agent">Agent</SelectItem>
            </SelectContent>
          </Select>
        </label>

        <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
          <div className="space-y-0.5">
            <label className="text-sm font-medium" htmlFor="auto-connect">
              Auto-connect on host select
            </label>
            <p className="text-muted-foreground text-xs">
              Start SSH when you click a host in the rail (if not already connected).
            </p>
          </div>
          <Switch
            id="auto-connect"
            checked={!!autoConnect.value}
            onCheckedChange={(v) => autoConnect.setValue(v)}
          />
        </div>

        <label className="block space-y-1">
          <span className="text-sm font-medium">Keepalive interval (seconds)</span>
          <p className="text-muted-foreground text-xs mb-1">
            Send SSH keepalive packets to prevent idle disconnects. Set 0 to disable.
          </p>
          <input
            type="number"
            min={0}
            max={3600}
            className={fieldClass}
            value={Number(keepalive.value)}
            onChange={(e) => keepalive.setValue(Math.max(0, Number(e.target.value) || 0))}
          />
        </label>
      </div>
    </div>
  )
}
