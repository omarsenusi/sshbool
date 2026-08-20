import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ShieldAlert, AlertTriangle, Clock, Check, X, ShieldCheck } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';

export interface ApprovalRequestPayload {
  id: string;
  clientName: string;
  hostLabel?: string;
  tool: string;
  commandPreview?: string;
  riskTier: 'safe' | 'write' | 'dangerous';
  riskReasons?: string[];
  expiresAt: number;
}

interface ApprovalDialogProps {
  request: ApprovalRequestPayload | null;
  onClose: () => void;
}

export const ApprovalDialog: React.FC<ApprovalDialogProps> = ({ request, onClose }) => {
  const [timeLeftSecs, setTimeLeftSecs] = useState<number>(60);

  useEffect(() => {
    if (!request) return;
    const updateTime = () => {
      const remaining = Math.max(0, Math.floor((request.expiresAt - Date.now()) / 1000));
      setTimeLeftSecs(remaining);
      if (remaining <= 0) {
        onClose();
      }
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, [request, onClose]);

  if (!request) return null;

  const handleRespond = async (decision: 'allow_once' | 'allow_session' | 'deny') => {
    try {
      await invoke('mcp_approval_respond', {
        approvalId: request.id,
        decision,
      });
    } catch (e) {
      console.error('Failed to send approval response', e);
    } finally {
      onClose();
    }
  };

  const getRiskBadge = (tier: string) => {
    switch (tier) {
      case 'dangerous':
        return (
          <Badge variant="outline" className="bg-red-950/80 border-red-700 text-red-400 flex items-center gap-1 font-bold">
            <ShieldAlert className="w-3.5 h-3.5" />
            DANGEROUS
          </Badge>
        );
      case 'write':
        return (
          <Badge variant="outline" className="bg-amber-950/80 border-amber-700 text-amber-400 flex items-center gap-1 font-bold">
            <AlertTriangle className="w-3.5 h-3.5" />
            WRITE
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="bg-emerald-950/80 border-emerald-700 text-emerald-400 flex items-center gap-1 font-bold">
            <ShieldCheck className="w-3.5 h-3.5" />
            SAFE
          </Badge>
        );
    }
  };

  return (
    <Dialog open={!!request} onOpenChange={(open) => { if (!open) handleRespond('deny'); }}>
      <DialogContent className="sm:max-w-lg bg-slate-900 border-slate-800 text-slate-100">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-2 text-lg font-bold text-slate-100">
              <ShieldAlert className="w-5 h-5 text-amber-400" />
              Approval Required
            </DialogTitle>
            {getRiskBadge(request.riskTier)}
          </div>
          <DialogDescription className="text-slate-400">
            Agent <span className="font-semibold text-slate-200">{request.clientName}</span> requests execution of tool <code className="font-mono text-emerald-400">{request.tool}</code>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 my-2">
          {request.hostLabel && (
            <div className="flex items-center justify-between text-xs p-2.5 bg-slate-950 rounded-md border border-slate-800">
              <span className="text-slate-400">Target Host:</span>
              <span className="font-mono text-slate-200 font-semibold">{request.hostLabel}</span>
            </div>
          )}

          {request.commandPreview && (
            <div className="space-y-1.5">
              <span className="text-xs font-medium text-slate-400 block">Command Preview (Redacted)</span>
              <pre className="p-3 bg-slate-950 rounded-lg border border-slate-800 text-xs font-mono text-amber-300 overflow-x-auto select-all max-h-40">
                {request.commandPreview}
              </pre>
            </div>
          )}

          {request.riskReasons && request.riskReasons.length > 0 && (
            <div className="p-3 bg-amber-950/40 border border-amber-800/60 rounded-lg text-xs space-y-1">
              <span className="font-semibold text-amber-300 block">Risk Classifier Triggers:</span>
              <ul className="list-disc list-inside text-amber-200/90 space-y-0.5">
                {request.riskReasons.map((reason, idx) => (
                  <li key={idx}>{reason}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex items-center justify-between pt-2 border-t border-slate-800 text-xs text-slate-400">
            <span className="flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-amber-400" />
              Auto-denies in:
            </span>
            <span className="font-mono font-bold text-amber-400 text-sm">{timeLeftSecs}s</span>
          </div>
        </div>

        <DialogFooter className="flex flex-col sm:flex-row gap-2 sm:justify-end pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleRespond('deny')}
            className="border-red-900/60 bg-red-950/40 text-red-300 hover:bg-red-900/50 hover:text-white flex items-center gap-1.5"
          >
            <X className="w-4 h-4" />
            Deny
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleRespond('allow_session')}
            className="border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700 flex items-center gap-1.5"
          >
            <Check className="w-4 h-4 text-emerald-400" />
            Allow for Session
          </Button>
          <Button
            size="sm"
            onClick={() => handleRespond('allow_once')}
            className="bg-emerald-600 hover:bg-emerald-500 text-white flex items-center gap-1.5"
          >
            <Check className="w-4 h-4" />
            Allow Once
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
