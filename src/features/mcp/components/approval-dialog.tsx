import React, { useState, useEffect } from "react"
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
import {
  ShieldAlert,
  AlertTriangle,
  Clock,
  Check,
  X,
  ShieldCheck,
} from "lucide-react"
import { invoke } from "@tauri-apps/api/core"

export interface ApprovalRequestPayload {
  id: string
  clientName: string
  hostLabel?: string
  tool: string
  commandPreview?: string
  riskTier: "safe" | "write" | "dangerous"
  riskReasons?: string[]
  expiresAt: number
}

interface ApprovalDialogProps {
  request: ApprovalRequestPayload | null
  onClose: () => void
}

export const ApprovalDialog: React.FC<ApprovalDialogProps> = ({
  request,
  onClose,
}) => {
  const [timeLeftSecs, setTimeLeftSecs] = useState<number>(60)

  useEffect(() => {
    if (!request) return
    const updateTime = () => {
      const remaining = Math.max(
        0,
        Math.floor((request.expiresAt - Date.now()) / 1000)
      )
      setTimeLeftSecs(remaining)
      if (remaining <= 0) {
        onClose()
      }
    }
    updateTime()
    const interval = setInterval(updateTime, 1000)
    return () => clearInterval(interval)
  }, [request, onClose])

  if (!request) return null

  const handleRespond = async (
    decision: "allow_once" | "allow_session" | "deny"
  ) => {
    try {
      await invoke("mcp_approval_respond", {
        approvalId: request.id,
        decision,
      })
    } catch (e) {
      console.error("Failed to send approval response", e)
    } finally {
      onClose()
    }
  }

  const getRiskBadge = (tier: string) => {
    switch (tier) {
      case "dangerous":
        return (
          <Badge
            variant="outline"
            className="flex items-center gap-1 border-red-700 bg-red-950/80 font-bold text-red-400"
          >
            <ShieldAlert className="h-3.5 w-3.5" />
            DANGEROUS
          </Badge>
        )
      case "write":
        return (
          <Badge
            variant="outline"
            className="flex items-center gap-1 border-amber-700 bg-amber-950/80 font-bold text-amber-400"
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            WRITE
          </Badge>
        )
      default:
        return (
          <Badge
            variant="outline"
            className="flex items-center gap-1 border-emerald-700 bg-emerald-950/80 font-bold text-emerald-400"
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            SAFE
          </Badge>
        )
    }
  }

  return (
    <Dialog
      open={!!request}
      onOpenChange={(open) => {
        if (!open) handleRespond("deny")
      }}
    >
      <DialogContent className="border-slate-800 bg-slate-900 text-slate-100 sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-2 text-lg font-bold text-slate-100">
              <ShieldAlert className="h-5 w-5 text-amber-400" />
              Approval Required
            </DialogTitle>
            {getRiskBadge(request.riskTier)}
          </div>
          <DialogDescription className="text-slate-400">
            Agent{" "}
            <span className="font-semibold text-slate-200">
              {request.clientName}
            </span>{" "}
            requests execution of tool{" "}
            <code className="font-mono text-emerald-400">{request.tool}</code>.
          </DialogDescription>
        </DialogHeader>

        <div className="my-2 space-y-4">
          {request.hostLabel && (
            <div className="flex items-center justify-between rounded-md border border-slate-800 bg-slate-950 p-2.5 text-xs">
              <span className="text-slate-400">Target Host:</span>
              <span className="font-mono font-semibold text-slate-200">
                {request.hostLabel}
              </span>
            </div>
          )}

          {request.commandPreview && (
            <div className="space-y-1.5">
              <span className="block text-xs font-medium text-slate-400">
                Command Preview (Redacted)
              </span>
              <pre className="max-h-40 overflow-x-auto rounded-lg border border-slate-800 bg-slate-950 p-3 font-mono text-xs text-amber-300 select-all">
                {request.commandPreview}
              </pre>
            </div>
          )}

          {request.riskReasons && request.riskReasons.length > 0 && (
            <div className="space-y-1 rounded-lg border border-amber-800/60 bg-amber-950/40 p-3 text-xs">
              <span className="block font-semibold text-amber-300">
                Risk Classifier Triggers:
              </span>
              <ul className="list-inside list-disc space-y-0.5 text-amber-200/90">
                {request.riskReasons.map((reason, idx) => (
                  <li key={idx}>{reason}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex items-center justify-between border-t border-slate-800 pt-2 text-xs text-slate-400">
            <span className="flex items-center gap-1.5">
              <Clock className="h-4 w-4 text-amber-400" />
              Auto-denies in:
            </span>
            <span className="font-mono text-sm font-bold text-amber-400">
              {timeLeftSecs}s
            </span>
          </div>
        </div>

        <DialogFooter className="flex flex-col gap-2 pt-2 sm:flex-row sm:justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleRespond("deny")}
            className="flex items-center gap-1.5 border-red-900/60 bg-red-950/40 text-red-300 hover:bg-red-900/50 hover:text-white"
          >
            <X className="h-4 w-4" />
            Deny
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleRespond("allow_session")}
            className="flex items-center gap-1.5 border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700"
          >
            <Check className="h-4 w-4 text-emerald-400" />
            Allow for Session
          </Button>
          <Button
            size="sm"
            onClick={() => handleRespond("allow_once")}
            className="flex items-center gap-1.5 bg-emerald-600 text-white hover:bg-emerald-500"
          >
            <Check className="h-4 w-4" />
            Allow Once
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
