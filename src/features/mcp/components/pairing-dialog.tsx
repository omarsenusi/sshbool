import { useState, useEffect } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  ShieldCheck,
  Copy,
  Check,
  AlertTriangle,
  KeyRound,
  Hash,
} from "lucide-react"
import type { McpPairingCode, McpPairingResult } from "../types"

type PairingMethod = "token" | "code"

interface PairingDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  port: number
  pairing: McpPairingResult | null
  pairingCode: McpPairingCode | null
  tokenLoading?: boolean
  codeLoading?: boolean
  clientName: string
  onClientNameChange: (name: string) => void
  onCreateToken: () => void
  onCreateCode: () => void
}

function formatCountdown(expiresAt: number): string {
  const secs = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000))
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${s.toString().padStart(2, "0")}`
}

function pairCurlExample(
  port: number,
  code: string,
  clientName: string
): string {
  const payload = JSON.stringify({
    code,
    client_name: clientName.trim() || "Cursor",
    client_version: "1.0",
  })
  return `curl -s -X POST http://127.0.0.1:${port}/mcp/pair \\
  -H "Content-Type: application/json" \\
  -d '${payload}'`
}

export function PairingDialog({
  open,
  onOpenChange,
  port,
  pairing,
  pairingCode,
  tokenLoading,
  codeLoading,
  clientName,
  onClientNameChange,
  onCreateToken,
  onCreateCode,
}: PairingDialogProps) {
  const [method, setMethod] = useState<PairingMethod>("token")
  const [copiedToken, setCopiedToken] = useState(false)
  const [copiedConfig, setCopiedConfig] = useState(false)
  const [copiedCode, setCopiedCode] = useState(false)
  const [copiedCurl, setCopiedCurl] = useState(false)
  const [countdown, setCountdown] = useState("")

  useEffect(() => {
    if (!open) {
      setMethod("token")
      setCopiedToken(false)
      setCopiedConfig(false)
      setCopiedCode(false)
      setCopiedCurl(false)
    }
  }, [open])

  useEffect(() => {
    if (!pairingCode) {
      setCountdown("")
      return
    }
    const tick = () => setCountdown(formatCountdown(pairingCode.expiresAt))
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [pairingCode])

  const copyToken = () => {
    if (!pairing) return
    void navigator.clipboard.writeText(pairing.accessToken)
    setCopiedToken(true)
    window.setTimeout(() => setCopiedToken(false), 2000)
  }

  const copyConfig = () => {
    if (!pairing) return
    void navigator.clipboard.writeText(pairing.cursorConfig)
    setCopiedConfig(true)
    window.setTimeout(() => setCopiedConfig(false), 2000)
  }

  const copyCode = () => {
    if (!pairingCode) return
    void navigator.clipboard.writeText(pairingCode.code)
    setCopiedCode(true)
    window.setTimeout(() => setCopiedCode(false), 2000)
  }

  const copyCurl = () => {
    if (!pairingCode) return
    void navigator.clipboard.writeText(
      pairCurlExample(port, pairingCode.code, clientName)
    )
    setCopiedCurl(true)
    window.setTimeout(() => setCopiedCurl(false), 2000)
  }

  const expiresLabel = pairing
    ? new Date(pairing.expiresAt).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : ""

  const showTokenResult = method === "token" && pairing
  const showCodeResult = method === "code" && pairingCode

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-3 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            Pair MCP client
          </DialogTitle>
          <DialogDescription className="text-xs">
            Create a token in-app, or generate a 6-digit code for HTTP pairing
            from another tool.
          </DialogDescription>
        </DialogHeader>

        {!showTokenResult && !showCodeResult && (
          <Tabs
            value={method}
            onValueChange={(v) => setMethod(v as PairingMethod)}
            className="gap-3"
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="token" className="gap-1.5 text-xs">
                <KeyRound className="h-3.5 w-3.5" />
                Direct token
              </TabsTrigger>
              <TabsTrigger value="code" className="gap-1.5 text-xs">
                <Hash className="h-3.5 w-3.5" />
                6-digit code
              </TabsTrigger>
            </TabsList>

            <TabsContent value="token" className="mt-3 space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="mcp-client-name" className="text-xs">
                  Client name
                </Label>
                <Input
                  id="mcp-client-name"
                  className="h-8 max-w-xs text-xs"
                  value={clientName}
                  onChange={(e) => onClientNameChange(e.target.value)}
                  placeholder="Cursor"
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                Instantly mints a bearer token and Cursor config. Starts in{" "}
                <span className="font-medium">read-only</span> mode.
              </p>
            </TabsContent>

            <TabsContent value="code" className="mt-3 space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="mcp-code-client-name" className="text-xs">
                  Client name (for curl example)
                </Label>
                <Input
                  id="mcp-code-client-name"
                  className="h-8 max-w-xs text-xs"
                  value={clientName}
                  onChange={(e) => onClientNameChange(e.target.value)}
                  placeholder="Cursor"
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                Generates a one-time 6-digit code (5 min). Redeem via{" "}
                <code className="text-xs">POST /mcp/pair</code> — the response
                includes the access token.
              </p>
            </TabsContent>
          </Tabs>
        )}

        {showTokenResult && (
          <div className="space-y-3">
            <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-800 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                This token is shown <strong>once</strong>. Copy it now — SSHBool
                stores only a hash. Expires {expiresLabel}.
              </span>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Access token</Label>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={copyToken}
                >
                  {copiedToken ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  {copiedToken ? "Copied" : "Copy token"}
                </Button>
              </div>
              <pre className="w-full max-w-md rounded-xl border border-border/70 bg-muted/20 p-2 font-mono text-[10px] break-all select-all">
                {pairing.accessToken}
              </pre>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Cursor MCP config</Label>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={copyConfig}
                >
                  {copiedConfig ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  {copiedConfig ? "Copied" : "Copy config"}
                </Button>
              </div>
              <ScrollArea className="max-h-48 w-full max-w-md rounded-xl border border-border/70 bg-muted/20">
                <pre className="p-3 font-mono text-[10px] whitespace-pre select-all">
                  {pairing.cursorConfig}
                </pre>
              </ScrollArea>
              <p className="text-[11px] text-muted-foreground">
                Paste into Cursor → Settings → MCP (or{" "}
                <code className="text-xs">~/.cursor/mcp.json</code>), then
                restart Cursor.
              </p>
            </div>
          </div>
        )}

        {showCodeResult && (
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-xl border border-border/70 bg-muted/20 p-4">
              <div>
                <p className="mb-1 text-[11px] text-muted-foreground">
                  Pairing code
                </p>
                <p className="font-mono text-2xl font-semibold tracking-[0.35em]">
                  {pairingCode.code}
                </p>
              </div>
              <div className="text-right">
                <p className="mb-1 text-[11px] text-muted-foreground">
                  Expires in
                </p>
                <p className="font-mono text-sm font-medium">
                  {countdown || "—"}
                </p>
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Redeem with curl</Label>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={copyCode}
                  >
                    {copiedCode ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                    {copiedCode ? "Copied" : "Copy code"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={copyCurl}
                  >
                    {copiedCurl ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                    {copiedCurl ? "Copied" : "Copy curl"}
                  </Button>
                </div>
              </div>
              <ScrollArea className="max-h-32 rounded-xl border border-border/70 bg-muted/20">
                <pre className="p-3 font-mono text-[10px] whitespace-pre-wrap select-all">
                  {pairCurlExample(port, pairingCode.code, clientName)}
                </pre>
              </ScrollArea>
              <p className="text-[11px] text-muted-foreground">
                The JSON response includes{" "}
                <code className="text-xs">access_token</code>. Use it as{" "}
                <code className="text-xs">Authorization: Bearer …</code> in your
                MCP client config. Max 3 wrong attempts before lockout.
              </p>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => onOpenChange(false)}
          >
            {showTokenResult || showCodeResult ? "Done" : "Cancel"}
          </Button>
          {!showTokenResult && !showCodeResult && method === "token" && (
            <Button
              size="sm"
              className="h-8"
              disabled={tokenLoading || !clientName.trim()}
              onClick={onCreateToken}
            >
              {tokenLoading ? "Creating…" : "Create token"}
            </Button>
          )}
          {!showTokenResult && !showCodeResult && method === "code" && (
            <Button
              size="sm"
              className="h-8"
              disabled={codeLoading}
              onClick={onCreateCode}
            >
              {codeLoading ? "Generating…" : "Generate code"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
