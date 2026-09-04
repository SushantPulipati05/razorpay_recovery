'use client';

import React from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  Legend
} from 'recharts';
import { FailureReasonCount, DailyRevenueTrend } from '@/types/dashboard';

interface RecoveryChartsProps {
  failureReasons: FailureReasonCount[];
  dailyTrend: DailyRevenueTrend[];
  loading: boolean;
}

const DONUT_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#64748b'];

export default function RecoveryCharts({
  failureReasons,
  dailyTrend,
  loading
}: RecoveryChartsProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 h-72 rounded-xl bg-zinc-900 border border-zinc-800 animate-pulse p-6"></div>
        <div className="h-72 rounded-xl bg-zinc-900 border border-zinc-800 animate-pulse p-6"></div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Area Chart: Recovered Revenue Trend */}
      <div className="lg:col-span-2 p-6 rounded-xl bg-zinc-900 border border-zinc-800 shadow-lg flex flex-col justify-between">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-base font-bold text-zinc-100">Revenue Recovery Trend</h3>
            <p className="text-xs text-zinc-400">Daily recovered vs failed revenue (Past 7 Days)</p>
          </div>
          <div className="flex items-center gap-4 text-xs font-medium">
            <span className="flex items-center gap-1.5 text-emerald-400">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
              Recovered
            </span>
            <span className="flex items-center gap-1.5 text-zinc-400">
              <span className="w-2.5 h-2.5 rounded-full bg-zinc-600"></span>
              Failed
            </span>
          </div>
        </div>

        <div className="w-full h-64">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={dailyTrend} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="recoveredGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                </linearGradient>
                <linearGradient id="failedGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#64748b" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#64748b" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" stroke="#71717a" fontSize={11} tickLine={false} />
              <YAxis stroke="#71717a" fontSize={11} tickLine={false} />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#18181b',
                  borderColor: '#27272a',
                  borderRadius: '0.5rem',
                  color: '#f4f4f5',
                  fontSize: '12px'
                }}
                formatter={(value: any) => [`₹${Number(value).toLocaleString('en-IN')}`, '']}
              />
              <Area
                type="monotone"
                dataKey="failedAmount"
                name="Failed Amount"
                stroke="#64748b"
                fillOpacity={1}
                fill="url(#failedGradient)"
              />
              <Area
                type="monotone"
                dataKey="recoveredAmount"
                name="Recovered Amount"
                stroke="#10b981"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#recoveredGradient)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Donut Chart: Failure Reasons Breakdown */}
      <div className="p-6 rounded-xl bg-zinc-900 border border-zinc-800 shadow-lg flex flex-col justify-between">
        <div>
          <h3 className="text-base font-bold text-zinc-100">Failure Reasons Breakdown</h3>
          <p className="text-xs text-zinc-400 mb-4">Distribution of root cause errors</p>
        </div>

        {failureReasons.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-xs text-zinc-500">
            No failure records found
          </div>
        ) : (
          <div className="w-full h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={failureReasons}
                  dataKey="count"
                  nameKey="reason"
                  cx="50%"
                  cy="45%"
                  innerRadius={55}
                  outerRadius={80}
                  paddingAngle={4}
                >
                  {failureReasons.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={DONUT_COLORS[index % DONUT_COLORS.length]}
                    />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#18181b',
                    borderColor: '#27272a',
                    borderRadius: '0.5rem',
                    color: '#f4f4f5',
                    fontSize: '12px'
                  }}
                  formatter={(value: any, name: any) => [`${value} failures`, name]}
                />
                <Legend
                  verticalAlign="bottom"
                  height={36}
                  iconType="circle"
                  wrapperStyle={{ fontSize: '11px', color: '#a1a1aa' }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}
