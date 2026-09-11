import { useEffect, useRef, useState } from "react"
import { ShieldAlert, Clock, Copy, Check } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { toast } from "@/stores/toast.store"
import {
  selectCurrentApproval,
  useMcpApprovalStore,
  type ApprovalDecision,
  type McpApprovalRequest,
} from "@/stores/mcp.store"

function renderCommandBytes(text: string): string {
  let out = ""
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i)
    if (code === 9) out += "\\t"
    else if (code === 10) out += "\\n"
    else if (code === 13) out += "\\r"
    else if (code < 32 || code === 127)
      out += `\\x${code.toString(16).padStart(2, "0")}`
    else out += text[i]
  }
  return out
}

function RiskBadge({ tier }: { tier: McpApprovalRequest["riskTier"] }) {
  if (tier === "dangerous") {
    return (
      <Badge
        variant="outline"
        className="border-destructive/50 text-destructive"
      >
        DANGEROUS
      </Badge>
    )
  }
  if (tier === "write") {
    return (
      <Badge
        variant="outline"
        className="border-amber-500/50 text-amber-600 dark:text-amber-400"
      >
        WRITE
      </Badge>
    )
  }
  return (
    <Badge
      variant="outline"
      className="border-emerald-500/50 text-emerald-600 dark:text-emerald-400"
    >
      SAFE
    </Badge>
  )
}

export function McpApprovalDialog() {
  const init = useMcpApprovalStore((s) => s.init)
  const current = useMcpApprovalStore(selectCurrentApproval)
  const queueLen = useMcpApprovalStore((s) => s.queue.length)
  const respond = useMcpApprovalStore((s) => s.respond)
  const denyRef = useRef<HTMLButtonElement>(null)
  const [timeLeftSecs, setTimeLeftSecs] = useState(0)
  const [copied, setCopied] = useState(false)
  const [confirmProduction, setConfirmProduction] = useState(false)
  const [responding, setResponding] = useState(false)

  useEffect(() => {
    void init()
  }, [init])

  useEffect(() => {
    setConfirmProduction(false)
    if (!current) return

    const tick = () => {
      const remaining = Math.max(
        0,
        Math.floor((current.expiresAt - Date.now()) / 1000)
      )
      setTimeLeftSecs(remaining)
    }
    tick()
    const interval = setInterval(tick, 1000)
    denyRef.current?.focus()
    return () => clearInterval(interval)
  }, [current])

  if (!current) return null

  const handleRespond = async (decision: ApprovalDecision) => {
    if (responding) return
    setResponding(true)
    try {
      await respond(current.approvalId, decision)
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Failed to send approval response"
      if (
        message.includes("already resolved") ||
        message.includes("timed out")
      ) {
        toast.error(
          "Approval expired",
          "This request was denied automatically or already resolved."
        )
      } else if (message.includes("no pending approval gate")) {
        toast.error(
          "Approval unavailable",
          "The MCP request may have timed out. Try again from the agent."
        )
      } else {
        toast.error("Approval failed", message)
      }
      console.error("Failed to send approval response", e)
    } finally {
      setResponding(false)
    }
  }

  const handleAllowOnce = () => {
    if (
      current.production &&
      current.riskTier === "dangerous" &&
      !confirmProduction
    ) {
      setConfirmProduction(true)
      window.setTimeout(() => setConfirmProduction(false), 3000)
      return
    }
    void handleRespond("allow_once")
  }

  const copyCommand = () => {
    if (!current.commandText) return
    void navigator.clipboard.writeText(current.commandText)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

  const headerIcon =
    current.riskTier === "dangerous" ? (
      <ShieldAlert className="h-4 w-4 text-destructive" />
    ) : (
      <ShieldAlert className="h-4 w-4 text-amber-600 dark:text-amber-400" />
    )

  return (
    // Deliberately non-dismissible: Escape and outside clicks must not close this dialog.
    <Dialog open onOpenChange={() => undefined}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          "gap-3 sm:max-w-lg",
          current.production &&
            current.riskTier === "dangerous" &&
            "border-destructive/50"
        )}
      >
        <DialogHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
                {headerIcon}
                Approve remote action
                {queueLen > 1 && (
                  <span className="text-xs font-normal text-muted-foreground">
                    (1 of {queueLen})
                  </span>
                )}
              </DialogTitle>
              <DialogDescription className="text-xs">
                Requested by{" "}
                <span className="font-medium text-foreground">
                  {current.clientName}
                </span>
              </DialogDescription>
            </div>
            <RiskBadge tier={current.riskTier} />
          </div>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="rounded-xl border border-border/70 bg-muted/30 p-2">
            <span className="mb-0.5 block text-muted-foreground">Client</span>
            <span className="font-medium">{current.clientName}</span>
          </div>
          <div className="rounded-xl border border-border/70 bg-muted/30 p-2">
            <span className="mb-0.5 block text-muted-foreground">Host</span>
            <span className="font-mono text-xs">
              {current.hostLabel ?? "—"}
            </span>
            {current.production && (
              <Badge
                variant="outline"
                className="mt-1 border-destructive/50 text-[10px] text-destructive"
              >
                PRODUCTION
              </Badge>
            )}
          </div>
          <div className="rounded-xl border border-border/70 bg-muted/30 p-2">
            <span className="mb-0.5 block text-muted-foreground">Tool</span>
            <span className="font-mono text-xs select-all">{current.tool}</span>
          </div>
        </div>

        {current.agentReason && (
          <div className="rounded-xl border border-border/70 bg-muted/20 p-3 text-xs">
            <span className="mb-1 block font-medium">Agent reason</span>
            <p className="whitespace-pre-wrap text-muted-foreground">
              {current.agentReason}
            </p>
          </div>
        )}

        {current.commandText && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                Command (exact bytes)
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={copyCommand}
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                Copy
              </Button>
            </div>
            <ScrollArea className="max-h-40 rounded-xl border border-border/70 bg-muted/20">
              <pre className="overflow-x-auto p-3 font-mono text-xs whitespace-pre select-all">
                {renderCommandBytes(current.commandText)}
              </pre>
            </ScrollArea>
            <p className="text-[11px] text-muted-foreground">
              Non-printable characters are shown as escapes.
            </p>
          </div>
        )}

        {current.riskReasons.length > 0 && (
          <div className="space-y-1 rounded-xl border border-border/70 bg-muted/20 p-3 text-xs">
            <span className="block font-medium">Risk classifier triggers</span>
            <ul className="list-inside list-disc space-y-0.5 text-muted-foreground">
              {current.riskReasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
            <p className="pt-1 text-[11px] text-muted-foreground">
              Risk analysis is advisory. Approve only if you understand the
              command.
            </p>
          </div>
        )}

        <div className="rounded-xl border border-border/70 bg-muted/20 p-3 text-xs">
          <span className="mb-1 block font-medium">Dry-run preview</span>
          {current.previewOutput ? (
            <pre className="font-mono text-xs whitespace-pre-wrap select-all">
              {current.previewOutput}
            </pre>
          ) : (
            <span className="text-muted-foreground">Preview unavailable</span>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border/70 pt-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" />
            Denied automatically in {timeLeftSecs}s — denial is the default
            outcome.
          </span>
        </div>

        <DialogFooter className="gap-2 sm:justify-end">
          <Button
            ref={denyRef}
            autoFocus
            variant="destructive"
            size="sm"
            className="h-8"
            disabled={responding}
            onClick={() => void handleRespond("deny")}
          >
            Deny
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            disabled={responding}
            onClick={handleAllowOnce}
            title={
              current.production && current.riskTier === "dangerous"
                ? "First click arms confirmation; click again within 3 seconds to allow."
                : undefined
            }
          >
            {confirmProduction ? "Confirm on production" : "Allow once"}
          </Button>
          {current.grantable && (
            <Button
              variant="secondary"
              size="sm"
              className="h-8"
              disabled={responding}
              onClick={() => void handleRespond("allow_session")}
            >
              Allow for this session (15 min)
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
