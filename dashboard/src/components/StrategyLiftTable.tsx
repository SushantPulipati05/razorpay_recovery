'use client';

import React from 'react';
import { BarChart3 } from 'lucide-react';
import { StrategyLift } from '@/types/dashboard';

interface StrategyLiftTableProps {
  strategyLift: StrategyLift[];
  loading: boolean;
}

const STRATEGY_LABELS: Record<string, string> = {
  BANK_OUTAGE_ALTERNATIVE_RAIL: 'Bank / issuer down → UPI-only, 0% discount',
  CUSTOMER_DROP_INCENTIVE_5_PERCENT: 'Checkout drop / OTP → WhatsApp + 5% cap',
  INSUFFICIENT_FUNDS_DEFERRED: 'Insufficient funds → deferred, 0% discount',
  FRAUD_DECLINE_NO_RETRY: 'Fraud → silent halt',
  UNCLASSIFIED: 'Unclassified'
};

export default function StrategyLiftTable({ strategyLift, loading }: StrategyLiftTableProps) {
  if (loading) {
    return (
      <div className="p-6 rounded-xl bg-zinc-900 border border-zinc-800 shadow-lg h-64 animate-pulse" />
    );
  }

  const rows = (strategyLift || []).filter((s) => s.treatedCount + s.holdoutCount > 0);

  return (
    <div className="p-6 rounded-xl bg-zinc-900 border border-zinc-800 shadow-lg space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-emerald-400" />
          <h3 className="text-base font-bold text-zinc-100">Lift by strategy, not just overall</h3>
        </div>
        <span className="text-xs text-zinc-500 font-medium">Treated vs holdout, per intervention</span>
      </div>

      {rows.length === 0 ? (
        <div className="text-center py-10 text-xs text-zinc-500">
          No classified failures yet — run a batch to see per-strategy lift.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-zinc-300">
            <thead className="text-zinc-400 font-semibold uppercase tracking-wider text-[10px] border-b border-zinc-800">
              <tr>
                <th className="py-2 pr-4">Strategy</th>
                <th className="py-2 pr-4">Treated</th>
                <th className="py-2 pr-4">Holdout</th>
                <th className="py-2 pr-4">Lift</th>
                <th className="py-2 pr-4 text-right">Incremental ₹</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {rows.map((s) => {
                const liftPositive = s.liftPercentagePoints > 0;
                return (
                  <tr key={s.strategy}>
                    <td className="py-2.5 pr-4 font-medium text-zinc-200 max-w-[220px]">
                      {STRATEGY_LABELS[s.strategy] || s.strategy}
                    </td>
                    <td className="py-2.5 pr-4 font-mono text-zinc-300">
                      {s.treatedRecovered}/{s.treatedCount}
                      <span className="text-zinc-500"> ({s.treatedRatePercent}%)</span>
                    </td>
                    <td className="py-2.5 pr-4 font-mono text-zinc-400">
                      {s.holdoutRecovered}/{s.holdoutCount}
                      <span className="text-zinc-500"> ({s.holdoutRatePercent}%)</span>
                    </td>
                    <td
                      className={`py-2.5 pr-4 font-mono font-semibold ${
                        liftPositive ? 'text-emerald-400' : 'text-zinc-500'
                      }`}
                    >
                      {liftPositive ? '+' : ''}
                      {s.liftPercentagePoints} pp
                    </td>
                    <td className="py-2.5 pr-4 text-right font-mono text-zinc-200">
                      ₹{s.incrementalRevenue.toLocaleString('en-IN')}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
