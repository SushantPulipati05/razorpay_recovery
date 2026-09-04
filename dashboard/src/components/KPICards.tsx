'use client';

import React from 'react';
import {
  IndianRupee,
  Send,
  AlertTriangle,
  TrendingUp,
  ArrowUpRight
} from 'lucide-react';
import { DashboardMetrics } from '@/types/dashboard';

interface KPICardsProps {
  metrics: DashboardMetrics | null;
  loading: boolean;
}

export default function KPICards({ metrics, loading }: KPICardsProps) {
  const lift = metrics?.liftPercentagePoints ?? 0;
  const cards = [
    {
      title: 'Total Recovered Revenue',
      value: metrics ? `₹${metrics.totalRecoveredRevenue.toLocaleString('en-IN')}` : '₹0',
      subtitle: metrics ? `Net of ops cost: ₹${metrics.netRevenueSaved.toLocaleString('en-IN')}` : 'Net of ops cost: ₹0',
      icon: IndianRupee,
      trend: metrics?.incrementalRevenue != null ? `Lift ₹${metrics.incrementalRevenue.toLocaleString('en-IN')}` : 'Attributed',
      color: 'emerald',
      bgColor: 'bg-emerald-500/10',
      borderColor: 'border-emerald-500/20',
      textColor: 'text-emerald-400'
    },
    {
      title: 'Treated vs holdout lift',
      value: metrics ? `${lift > 0 ? '+' : ''}${lift} pp` : '0 pp',
      subtitle: metrics
        ? `Treated ${metrics.treatedRate ?? 0}% · holdout ${metrics.holdoutRate ?? 0}%`
        : 'No cohort data yet',
      icon: TrendingUp,
      trend: `${metrics?.holdoutCount ?? 0} in control`,
      color: 'teal',
      bgColor: 'bg-teal-500/10',
      borderColor: 'border-teal-500/20',
      textColor: 'text-teal-400'
    },
    {
      title: 'In flight',
      value: metrics
        ? String((metrics.activeNudgesSent || 0) + (metrics.deferredCount || 0) + (metrics.promiseToPayCount || 0))
        : '0',
      subtitle: metrics
        ? `${metrics.activeNudgesSent} nudges · ${metrics.deferredCount ?? 0} deferred · ${metrics.promiseToPayCount ?? 0} promised`
        : 'Nudges, TRAI/NSF waits, promises',
      icon: Send,
      trend: metrics?.diagnosisDisagreements ? `${metrics.diagnosisDisagreements} Groq overruled` : 'Bounded',
      color: 'amber',
      bgColor: 'bg-amber-500/10',
      borderColor: 'border-amber-500/20',
      textColor: 'text-amber-400'
    },
    {
      title: 'Revenue at risk',
      value: metrics ? `₹${metrics.totalFailedAmount.toLocaleString('en-IN')}` : '₹0',
      subtitle: metrics ? `${metrics.totalFailures} events · ${metrics.recoveredCount ?? 0} recovered` : '0 events',
      icon: AlertTriangle,
      trend: 'Batch view',
      color: 'rose',
      bgColor: 'bg-rose-500/10',
      borderColor: 'border-rose-500/20',
      textColor: 'text-rose-400'
    }
  ];

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-32 rounded-xl bg-zinc-900/80 border border-zinc-800 animate-pulse p-5 flex flex-col justify-between"
          >
            <div className="h-4 w-24 bg-zinc-800 rounded"></div>
            <div className="h-8 w-32 bg-zinc-800 rounded"></div>
            <div className="h-3 w-20 bg-zinc-800 rounded"></div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
      {cards.map((card, idx) => {
        const Icon = card.icon;
        return (
          <div
            key={idx}
            className={`p-5 rounded-xl bg-zinc-900 border ${card.borderColor} shadow-lg transition-all hover:border-opacity-60 relative overflow-hidden group`}
          >
            {/* Header / Title */}
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-zinc-400 tracking-wide uppercase">
                {card.title}
              </span>
              <div className={`p-2 rounded-lg ${card.bgColor} ${card.textColor}`}>
                <Icon className="w-4 h-4" />
              </div>
            </div>

            {/* Value */}
            <div className="flex items-baseline justify-between mb-2">
              <h3 className="text-2xl font-extrabold text-zinc-100 tracking-tight">
                {card.value}
              </h3>
            </div>

            {/* Subtitle & Trend badge */}
            <div className="flex items-center justify-between text-xs pt-1 border-t border-zinc-800/80">
              <span className="text-zinc-500 font-medium truncate max-w-[170px]">
                {card.subtitle}
              </span>
              <span className={`flex items-center text-[11px] font-semibold ${card.textColor}`}>
                <ArrowUpRight className="w-3 h-3 mr-0.5" />
                {card.trend}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
