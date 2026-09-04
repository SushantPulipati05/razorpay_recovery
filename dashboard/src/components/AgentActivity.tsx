'use client';

import React, { useMemo, useState } from 'react';
import {
  Activity,
  ShieldCheck,
  ShieldAlert,
  Bot,
  MessageSquare,
  MessageCircle,
  CheckCircle,
  Clock,
  GitCompare,
  FlaskConical,
  Wallet,
  Moon,
  HelpCircle,
  Ban,
  Layers,
  List,
  AlarmClock,
  ArrowRight
} from 'lucide-react';
import { AuditLogItem } from '@/types/dashboard';

interface AgentActivityProps {
  logs: AuditLogItem[];
  loading: boolean;
}

/* ------------------------------------------------------------------ */
/* Step taxonomy — every audit step the pipeline can emit, in plain    */
/* English. `meaning` is what a first-time reader needs to understand  */
/* why this line exists; `label` is the human title for the enum.      */
/* ------------------------------------------------------------------ */

type Tone =
  | 'diagnosis'
  | 'disagree'
  | 'guardrail'
  | 'defer'
  | 'halt'
  | 'holdout'
  | 'dispatch'
  | 'promise'
  | 'recovered'
  | 'neutral';

interface StepMeta {
  label: string;
  meaning: string;
  icon: React.ElementType;
  tone: Tone;
  group: string;
}

const TONE_STYLES: Record<Tone, { bg: string; text: string; border: string; dot: string }> = {
  diagnosis: { bg: 'bg-amber-500/10', text: 'text-amber-300', border: 'border-amber-500/25', dot: 'bg-amber-400' },
  disagree: { bg: 'bg-purple-500/10', text: 'text-purple-300', border: 'border-purple-500/25', dot: 'bg-purple-400' },
  guardrail: { bg: 'bg-sky-500/10', text: 'text-sky-300', border: 'border-sky-500/25', dot: 'bg-sky-400' },
  defer: { bg: 'bg-cyan-500/10', text: 'text-cyan-300', border: 'border-cyan-500/25', dot: 'bg-cyan-400' },
  halt: { bg: 'bg-rose-500/10', text: 'text-rose-300', border: 'border-rose-500/25', dot: 'bg-rose-400' },
  holdout: { bg: 'bg-slate-500/10', text: 'text-slate-300', border: 'border-slate-500/25', dot: 'bg-slate-400' },
  dispatch: { bg: 'bg-teal-500/10', text: 'text-teal-300', border: 'border-teal-500/25', dot: 'bg-teal-400' },
  promise: { bg: 'bg-violet-500/10', text: 'text-violet-300', border: 'border-violet-500/25', dot: 'bg-violet-400' },
  recovered: { bg: 'bg-emerald-500/10', text: 'text-emerald-300', border: 'border-emerald-500/25', dot: 'bg-emerald-400' },
  neutral: { bg: 'bg-zinc-500/10', text: 'text-zinc-300', border: 'border-zinc-500/25', dot: 'bg-zinc-400' }
};

const STEP_META: Record<string, StepMeta> = {
  AI_DIAGNOSIS: {
    label: 'Failure diagnosed',
    meaning:
      'The agent read the gateway error and classified why this payment failed, then picked a matching recovery strategy.',
    icon: Bot,
    tone: 'diagnosis',
    group: 'Diagnosis'
  },
  DIAGNOSIS_DISAGREE: {
    label: 'Groq overruled by rules',
    meaning:
      'The LLM and the deterministic rules disagreed. The stricter action always wins — a discount can never be increased by the model.',
    icon: GitCompare,
    tone: 'disagree',
    group: 'Diagnosis'
  },
  POLICY_EVALUATION: {
    label: 'Guardrails passed',
    meaning:
      'Attempt cap, quiet hours and the discount ceiling were all checked before anything was sent.',
    icon: ShieldCheck,
    tone: 'guardrail',
    group: 'Guardrails'
  },
  POLICY_GUARDRAIL_HALT: {
    label: 'Blocked by guardrail',
    meaning: 'A policy rule stopped this intervention before any message or link was created.',
    icon: ShieldAlert,
    tone: 'halt',
    group: 'Guardrails'
  },
  DEFERRED_QUIET_HOURS: {
    label: 'Deferred — TRAI quiet hours',
    meaning:
      'Commercial nudges are banned 9pm–9am IST. The nudge is deferred to 9am rather than discarded, so the revenue opportunity survives.',
    icon: Moon,
    tone: 'defer',
    group: 'Guardrails'
  },
  RETRY_DEFERRED_QUIET_HOURS: {
    label: 'Retry deferred — TRAI quiet hours',
    meaning:
      'A scheduled follow-up came due inside the 9pm–9am IST window and was pushed to 9am instead of being dropped.',
    icon: Moon,
    tone: 'defer',
    group: 'Guardrails'
  },
  DEFERRED_INSUFFICIENT_FUNDS: {
    label: 'Deferred — insufficient funds',
    meaning:
      'A discount cannot fix an empty account. No incentive is offered and no immediate nudge is sent; the retry is scheduled for later.',
    icon: Wallet,
    tone: 'defer',
    group: 'Guardrails'
  },
  FRAUD_DECLINE_HALTED: {
    label: 'Halted — fraud flag',
    meaning:
      'The issuer flagged this as suspicious. The agent goes silent: no WhatsApp, no payment link, no dashboard resend.',
    icon: Ban,
    tone: 'halt',
    group: 'Guardrails'
  },
  HOLDOUT_CONTROL: {
    label: 'Held back as control',
    meaning:
      'Assigned to the 30% holdout. Deliberately given no intervention, so recovery lift can be measured against it instead of assumed.',
    icon: FlaskConical,
    tone: 'holdout',
    group: 'Measurement'
  },
  RECOVERY_NUDGE_DISPATCHED: {
    label: 'Recovery nudge sent',
    meaning: 'A payment link was created and the recovery message went out over WhatsApp.',
    icon: MessageSquare,
    tone: 'dispatch',
    group: 'Intervention'
  },
  PROMISE_TO_PAY_RECORDED: {
    label: 'Promise-to-pay recorded',
    meaning:
      'The customer replied with a pay-by date (Hinglish or English). The transaction is paused — no further nudges until the promised time.',
    icon: MessageCircle,
    tone: 'promise',
    group: 'Customer reply'
  },
  PROMISE_DEADLINE_REACHED: {
    label: 'Promise deadline passed',
    meaning:
      'The promised pay-by time came and went without payment, so the standard retry flow resumes automatically.',
    icon: AlarmClock,
    tone: 'promise',
    group: 'Customer reply'
  },
  INBOUND_REPLY_UNRECOGNIZED: {
    label: 'Reply not understood',
    meaning:
      'The parser refused to guess a date from an ambiguous reply. Status is left untouched rather than inventing a commitment.',
    icon: HelpCircle,
    tone: 'neutral',
    group: 'Customer reply'
  },
  PAYMENT_RECOVERED: {
    label: 'Payment recovered',
    meaning:
      'The payment completed and was attributed back to this recovery attempt, even though Razorpay minted a new order id.',
    icon: CheckCircle,
    tone: 'recovered',
    group: 'Outcome'
  }
};

function resolveStep(step: string): StepMeta {
  const known = STEP_META[step];
  if (known) return known;

  const retry = step.match(/^RETRY_NUDGE_ATTEMPT_(\d+)$/);
  if (retry) {
    return {
      label: `Follow-up nudge · attempt ${retry[1]}`,
      meaning:
        'An earlier nudge went unanswered, so the scheduler sent the next attempt. Capped at 3 attempts per transaction.',
      icon: MessageSquare,
      tone: 'dispatch',
      group: 'Intervention'
    };
  }

  const manual = step.match(/^MANUAL_NUDGE_ATTEMPT_(\d+)$/);
  if (manual) {
    return {
      label: `Manual nudge · attempt ${manual[1]}`,
      meaning: 'An operator triggered this nudge by hand from the dashboard.',
      icon: MessageSquare,
      tone: 'dispatch',
      group: 'Intervention'
    };
  }

  return {
    label: step.replace(/_/g, ' ').toLowerCase(),
    meaning: 'Pipeline step.',
    icon: Activity,
    tone: 'neutral',
    group: 'Other'
  };
}

/* ------------------------------------------------------------------ */
/* Reasoning parser — several steps log machine-readable key=value     */
/* strings. Raw, those are unreadable; split into prose + labelled     */
/* fields so a human can actually scan them.                           */
/* ------------------------------------------------------------------ */

interface ParsedReasoning {
  prose: string;
  fields: Array<{ key: string; value: string }>;
}

const FIELD_LABELS: Record<string, string> = {
  link: 'Payment link',
  link_id: 'Link ID',
  methods: 'Methods offered',
  discount: 'Discount',
  to: 'Sent to',
  copy: 'Message written by',
  mock_wa: 'WhatsApp simulated',
  mock_link: 'Link simulated',
  loss_mode: 'Loss mode',
  strategy: 'Strategy',
  source: 'Diagnosed by',
  rules: 'Rules said',
  groq: 'Groq said',
  conservative: 'Final (stricter wins)',
  pay: 'Payment ID',
  order: 'Order',
  amount: 'Amount',
  holdout: 'Was holdout'
};

function parseReasoning(reasoning: string): ParsedReasoning {
  const fields: Array<{ key: string; value: string }> = [];
  const kvPattern = /([a-z_]+)=(\S+)/g;
  let match: RegExpExecArray | null;

  while ((match = kvPattern.exec(reasoning)) !== null) {
    fields.push({ key: match[1], value: match[2] });
  }

  const firstFieldIndex = reasoning.search(/[a-z_]+=\S+/);
  let prose = firstFieldIndex > 0 ? reasoning.slice(0, firstFieldIndex) : fields.length ? '' : reasoning;
  prose = prose.replace(/\s*\|\s*$/, '').trim();

  return { prose, fields };
}

function formatFieldValue(key: string, value: string): string {
  if (key === 'methods') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.join(', ').toUpperCase();
    } catch {
      /* fall through to raw value */
    }
  }
  if (value === 'true') return 'Yes';
  if (value === 'false') return 'No';
  if (value === 'n/a') return '—';
  return value;
}

/* ------------------------------------------------------------------ */

const GROUP_ORDER = ['Diagnosis', 'Guardrails', 'Measurement', 'Intervention', 'Customer reply', 'Outcome', 'Other'];

export default function AgentActivity({ logs, loading }: AgentActivityProps) {
  const [view, setView] = useState<'timeline' | 'grouped'>('timeline');
  const [activeGroup, setActiveGroup] = useState<string>('All');

  const availableGroups = useMemo(() => {
    const present = new Set(logs.map((l) => resolveStep(l.step).group));
    return ['All', ...GROUP_ORDER.filter((g) => present.has(g))];
  }, [logs]);

  const filtered = useMemo(
    () => (activeGroup === 'All' ? logs : logs.filter((l) => resolveStep(l.step).group === activeGroup)),
    [logs, activeGroup]
  );

  // Group by transaction, most recently active transaction first, but steps
  // within a transaction ordered oldest → newest so the story reads top-down.
  const byTransaction = useMemo(() => {
    const map = new Map<string, AuditLogItem[]>();
    for (const log of filtered) {
      const key = log.transaction_id;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(log);
    }
    return Array.from(map.entries()).map(([txId, items]) => ({
      txId,
      orderId: items[0]?.order_id,
      items: [...items].sort((a, b) => +new Date(a.timestamp) - +new Date(b.timestamp))
    }));
  }, [filtered]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <Activity className="w-4 h-4 text-emerald-400" />
              <h2 className="text-lg font-bold text-zinc-100">Agent Activity</h2>
            </div>
            <p className="text-sm text-zinc-400 max-w-2xl leading-relaxed">
              Every decision the recovery agent made, in order, with the reasoning behind it. Each
              transaction moves through diagnosis → guardrails → intervention → outcome, and each
              step below records why the agent did what it did.
            </p>
          </div>

          {/* View toggle */}
          <div className="flex items-center gap-1 p-1 rounded-lg bg-zinc-950 border border-zinc-800 shrink-0">
            <button
              onClick={() => setView('timeline')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                view === 'timeline'
                  ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20'
                  : 'text-zinc-400 hover:text-zinc-200 border border-transparent'
              }`}
            >
              <List className="w-3.5 h-3.5" />
              Timeline
            </button>
            <button
              onClick={() => setView('grouped')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                view === 'grouped'
                  ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20'
                  : 'text-zinc-400 hover:text-zinc-200 border border-transparent'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              By transaction
            </button>
          </div>
        </div>

        {/* Stage filter */}
        <div className="flex items-center gap-2 flex-wrap mt-5 pt-5 border-t border-zinc-800">
          <span className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mr-1">
            Stage
          </span>
          {availableGroups.map((group) => (
            <button
              key={group}
              onClick={() => setActiveGroup(group)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${
                activeGroup === group
                  ? 'bg-zinc-100 text-zinc-900 border-zinc-100'
                  : 'bg-zinc-950 text-zinc-400 border-zinc-800 hover:text-zinc-200 hover:border-zinc-700'
              }`}
            >
              {group}
            </button>
          ))}
          <span className="ml-auto text-xs text-zinc-500">
            {filtered.length} event{filtered.length === 1 ? '' : 's'}
          </span>
        </div>
      </div>

      {/* Body */}
      {loading ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-12 text-center text-sm text-zinc-500">
          Loading agent activity…
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-12 text-center">
          <p className="text-sm text-zinc-400">No activity recorded yet.</p>
          <p className="text-xs text-zinc-600 mt-1">
            Run <code className="text-zinc-400">npm run test:batch</code> to generate recovery events.
          </p>
        </div>
      ) : view === 'timeline' ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-6 space-y-3">
          {filtered.map((log) => (
            <ActivityCard key={log.id} log={log} showOrder />
          ))}
        </div>
      ) : (
        <div className="space-y-5">
          {byTransaction.map((group) => (
            <div key={group.txId} className="rounded-xl border border-zinc-800 bg-zinc-900/60 overflow-hidden">
              <div className="px-6 py-3.5 border-b border-zinc-800 bg-zinc-950/50 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <ArrowRight className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span className="text-sm font-semibold text-zinc-200 truncate">
                    {group.orderId || group.txId}
                  </span>
                </div>
                <span className="text-xs text-zinc-500 shrink-0">
                  {group.items.length} step{group.items.length === 1 ? '' : 's'}
                </span>
              </div>
              <div className="p-6 space-y-3">
                {group.items.map((log) => (
                  <ActivityCard key={log.id} log={log} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ActivityCard({ log, showOrder = false }: { log: AuditLogItem; showOrder?: boolean }) {
  const meta = resolveStep(log.step);
  const tone = TONE_STYLES[meta.tone];
  const Icon = meta.icon;
  const { prose, fields } = parseReasoning(log.reasoning);

  const time = new Date(log.timestamp).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  return (
    <div className={`rounded-lg border ${tone.border} bg-zinc-950/70 p-4`}>
      <div className="flex items-start gap-3.5">
        <div className={`p-2 rounded-lg ${tone.bg} ${tone.text} shrink-0`}>
          <Icon className="w-4 h-4" />
        </div>

        <div className="min-w-0 flex-1">
          {/* Title row */}
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-sm font-semibold ${tone.text}`}>{meta.label}</span>
              <span className="text-[10px] font-mono text-zinc-600 px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800">
                {log.step}
              </span>
            </div>
            <div className="flex items-center gap-3 text-xs text-zinc-500 shrink-0">
              {Number(log.cost_incurred) > 0 && (
                <span className="font-mono text-amber-400/90">₹{Number(log.cost_incurred).toFixed(2)}</span>
              )}
              <span className="flex items-center gap-1 font-mono">
                <Clock className="w-3 h-3" />
                {time}
              </span>
            </div>
          </div>

          {/* Plain-English meaning */}
          <p className="text-[13px] text-zinc-500 mt-1.5 leading-relaxed">{meta.meaning}</p>

          {/* The agent's own reasoning text */}
          {prose && (
            <p className="text-sm text-zinc-200 mt-2.5 leading-relaxed border-l-2 border-zinc-700 pl-3">
              {prose}
            </p>
          )}

          {/* Parsed key=value detail */}
          {fields.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 mt-3">
              {fields.map((field, i) => (
                <div key={`${field.key}-${i}`} className="flex items-baseline gap-2 text-xs min-w-0">
                  <span className="text-zinc-500 shrink-0">
                    {FIELD_LABELS[field.key] || field.key.replace(/_/g, ' ')}
                  </span>
                  <span className="text-zinc-300 font-mono truncate">
                    {formatFieldValue(field.key, field.value)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {showOrder && log.order_id && (
            <div className="mt-2.5 pt-2.5 border-t border-zinc-800/80 text-xs text-zinc-600">
              {log.order_id}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
