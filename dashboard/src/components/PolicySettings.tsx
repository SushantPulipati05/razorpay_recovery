'use client';

import React from 'react';
import { ShieldCheck, Clock, Percent, FlaskConical, RotateCcw } from 'lucide-react';

interface PolicyRule {
  icon: React.ElementType;
  title: string;
  value: string;
  description: string;
}

const POLICY_RULES: PolicyRule[] = [
  {
    icon: RotateCcw,
    title: 'Retry attempt cap',
    value: '3 attempts',
    description:
      'Every failed transaction gets at most 3 recovery nudges. After the 3rd unanswered attempt, the transaction is halted as exhausted rather than nudged indefinitely.'
  },
  {
    icon: Clock,
    title: 'TRAI quiet hours',
    value: '9:00 PM – 9:00 AM IST',
    description:
      'Commercial WhatsApp nudges are never dispatched during these hours, per TRAI commercial-communication rules. Any retry due in this window is automatically deferred to the next allowed slot.'
  },
  {
    icon: Percent,
    title: 'Goodwill discount cap',
    value: '5% maximum',
    description:
      'The recovery agent can offer at most a 5% goodwill discount on customer-side drop-offs (e.g. OTP failure). Bank-outage and insufficient-funds strategies never carry a discount.'
  },
  {
    icon: FlaskConical,
    title: 'Holdout allocation',
    value: '30% of traffic',
    description:
      'Roughly 30% of eligible failures are randomly withheld from any recovery nudge, so treated-vs-holdout lift and incremental revenue can be measured rather than assumed.'
  }
];

interface PolicySettingsProps {
  loading: boolean;
}

export default function PolicySettings({ loading }: PolicySettingsProps) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-6">
      <div className="flex items-center gap-2 mb-1">
        <ShieldCheck className="w-4 h-4 text-emerald-400" />
        <h3 className="text-sm font-semibold text-zinc-100">Policy Engine Guardrails</h3>
      </div>
      <p className="text-xs text-zinc-500 mb-6">
        These are the hard-coded safety guardrails enforced by the policy engine on every recovery
        decision. This view is read-only in this build — changing a guardrail means editing{' '}
        <code className="text-zinc-400">src/policy/policyEngine.ts</code> on the backend.
      </p>

      {loading ? (
        <div className="space-y-3 animate-pulse">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-16 rounded-lg bg-zinc-800/60" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {POLICY_RULES.map((rule) => {
            const Icon = rule.icon;
            return (
              <div
                key={rule.title}
                className="p-4 rounded-lg border border-zinc-800 bg-zinc-950/60 flex gap-3"
              >
                <div className="w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0">
                  <Icon className="w-4 h-4 text-emerald-400" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-zinc-200">{rule.title}</span>
                    <span className="text-xs font-semibold text-emerald-400 whitespace-nowrap">
                      {rule.value}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-500 mt-1 leading-relaxed">{rule.description}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
