'use client';

import React from 'react';
import {
  Activity,
  ShieldCheck,
  Bot,
  MessageSquare,
  CheckCircle,
  AlertTriangle,
  Clock,
  MessageCircle,
  GitCompare
} from 'lucide-react';
import { AuditLogItem } from '@/types/dashboard';

interface AuditFeedProps {
  logs: AuditLogItem[];
  loading: boolean;
}

export default function AuditFeed({ logs, loading }: AuditFeedProps) {
  return (
    <div className="p-6 rounded-xl bg-zinc-900 border border-zinc-800 shadow-lg space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-emerald-400" />
          <h3 className="text-base font-bold text-zinc-100">Live Agent Audit Feed</h3>
        </div>
        <span className="text-xs text-zinc-500 font-medium">Top 20 Recent Events</span>
      </div>

      <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
        {loading ? (
          <div className="text-center py-8 text-xs text-zinc-500">
            Loading audit feed...
          </div>
        ) : logs.length === 0 ? (
          <div className="text-center py-8 text-xs text-zinc-500">
            No audit log entries recorded yet.
          </div>
        ) : (
          logs.map((log) => {
            const timeStr = new Date(log.timestamp).toLocaleTimeString('en-IN', {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit'
            });

            const StepIcon = getStepIcon(log.step);
            const stepColor = getStepColor(log.step);

            return (
              <div
                key={log.id}
                className="p-3 rounded-lg bg-zinc-950 border border-zinc-800/80 flex items-start gap-3 text-xs transition-all hover:border-zinc-700"
              >
                <div className={`p-1.5 rounded-md mt-0.5 ${stepColor.bg} ${stepColor.text}`}>
                  <StepIcon className="w-3.5 h-3.5" />
                </div>

                <div className="flex-1 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-zinc-200">
                      {log.step.replace(/_/g, ' ')}
                    </span>
                    <span className="text-[10px] text-zinc-500 flex items-center gap-1 font-mono">
                      <Clock className="w-3 h-3" />
                      {timeStr}
                    </span>
                  </div>

                  <p className="text-zinc-400 leading-relaxed">{log.reasoning}</p>

                  <div className="flex items-center justify-between text-[10px] text-zinc-500 pt-1">
                    <span>Order #{log.order_id || 'N/A'}</span>
                    {Number(log.cost_incurred) > 0 && (
                      <span className="text-amber-400 font-mono font-medium">
                        Cost: ₹{Number(log.cost_incurred).toFixed(2)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function getStepIcon(step: string) {
  if (step.includes('DISAGREE')) return GitCompare;
  if (step.includes('PROMISE')) return MessageCircle;
  if (step.includes('POLICY')) return ShieldCheck;
  if (step.includes('RECOVERY') || step.includes('NUDGE')) return MessageSquare;
  if (step.includes('RECOVERED') || step.includes('CAPTURED')) return CheckCircle;
  if (step.includes('HALT') || step.includes('BLOCKED')) return AlertTriangle;
  return Bot;
}

function getStepColor(step: string) {
  if (step.includes('RECOVERED') || step.includes('CAPTURED')) {
    return { bg: 'bg-emerald-500/10', text: 'text-emerald-400' };
  }
  if (step.includes('DISAGREE')) {
    return { bg: 'bg-purple-500/10', text: 'text-purple-400' };
  }
  if (step.includes('PROMISE')) {
    return { bg: 'bg-violet-500/10', text: 'text-violet-400' };
  }
  if (step.includes('POLICY_GUARDRAIL') || step.includes('TRAI') || step.includes('QUIET_HOURS')) {
    return { bg: 'bg-blue-500/10', text: 'text-blue-400' };
  }
  if (step.includes('HALT') || step.includes('EXHAUSTED')) {
    return { bg: 'bg-rose-500/10', text: 'text-rose-400' };
  }
  return { bg: 'bg-amber-500/10', text: 'text-amber-400' };
}
