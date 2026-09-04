'use client';

import React, { useState } from 'react';
import {
  Search,
  Send,
  CheckCircle2,
  AlertOctagon,
  Moon,
  Clock,
  ExternalLink,
  Filter,
  Bot,
  MessageCircle
} from 'lucide-react';
import { TransactionRecord } from '@/types/dashboard';

interface TransactionsTableProps {
  transactions: TransactionRecord[];
  loading: boolean;
  onRefresh: () => void;
}

export default function TransactionsTable({
  transactions,
  loading,
  onRefresh
}: TransactionsTableProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [resendingId, setResendingId] = useState<string | null>(null);

  const filtered = transactions.filter((tx) => {
    const matchesSearch =
      tx.razorpay_order_id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      tx.customer_phone.toLowerCase().includes(searchTerm.toLowerCase()) ||
      tx.razorpay_pay_id.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesStatus = statusFilter === 'ALL' || tx.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const handleResendNudge = async (txId: string) => {
    try {
      setResendingId(txId);
      const res = await fetch('/api/resend-nudge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionId: txId })
      });
      const data = await res.json();
      if (data.success) {
        onRefresh();
      } else {
        alert(`Resend error: ${data.error}`);
      }
    } catch (err: any) {
      alert(`Error resending nudge: ${err.message}`);
    } finally {
      setResendingId(null);
    }
  };

  return (
    <div className="p-6 rounded-xl bg-zinc-900 border border-zinc-800 shadow-lg space-y-4">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-base font-bold text-zinc-100">Transaction Failures & Recoveries</h3>
          <p className="text-xs text-zinc-400">Real-time payment telemetry and nudge interventions</p>
        </div>

        <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
          {/* Search Bar */}
          <div className="relative flex-1 sm:flex-initial">
            <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Search Order or Phone..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full sm:w-56 pl-9 pr-3 py-1.5 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-emerald-500/50"
            />
          </div>

          {/* Status Filter Dropdown */}
          <div className="flex items-center gap-1.5 bg-zinc-950 border border-zinc-800 rounded-lg p-1 text-xs">
            <Filter className="w-3.5 h-3.5 text-zinc-400 ml-1.5" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-transparent text-zinc-300 pr-2 focus:outline-none cursor-pointer text-xs font-medium"
            >
              <option value="ALL" className="bg-zinc-900 text-zinc-200">All Statuses</option>
              <option value="RECOVERED" className="bg-zinc-900 text-zinc-200">Recovered</option>
              <option value="INTERVENING" className="bg-zinc-900 text-zinc-200">Intervening</option>
              <option value="DEFERRED" className="bg-zinc-900 text-zinc-200">Deferred (quiet hours / NSF)</option>
              <option value="PROMISE_TO_PAY" className="bg-zinc-900 text-zinc-200">Promise to pay</option>
              <option value="HOLDOUT" className="bg-zinc-900 text-zinc-200">Holdout control</option>
              <option value="HALTED_EXHAUSTED" className="bg-zinc-900 text-zinc-200">Halted (max attempts / fraud)</option>
              <option value="PENDING" className="bg-zinc-900 text-zinc-200">Pending</option>
            </select>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto border border-zinc-800 rounded-lg">
        <table className="w-full text-left text-xs text-zinc-300">
          <thead className="bg-zinc-950/80 text-zinc-400 font-semibold border-b border-zinc-800 uppercase tracking-wider text-[11px]">
            <tr>
              <th className="px-4 py-3">Order ID</th>
              <th className="px-4 py-3">Customer Contact</th>
              <th className="px-4 py-3">Failure Reason</th>
              <th className="px-4 py-3">Original</th>
              <th className="px-4 py-3">Discount / Recovered</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/60 font-medium">
            {loading ? (
              <tr>
                <td colSpan={7} className="text-center py-8 text-zinc-500">
                  Loading transactions...
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-8 text-zinc-500">
                  No transaction failure records match your criteria.
                </td>
              </tr>
            ) : (
              filtered.map((tx) => {
                const isRecovered = tx.status === 'RECOVERED';
                const isHoldout = tx.status === 'HOLDOUT' || tx.is_holdout;
                const isFraud = tx.diagnosed_strategy === 'FRAUD_DECLINE_NO_RETRY';
                const nudgeLocked = isRecovered || isHoldout || isFraud || tx.status === 'HALTED_EXHAUSTED';

                return (
                  <tr key={tx.id} className="hover:bg-zinc-800/40 transition-colors">
                    {/* Order ID */}
                    <td className="px-4 py-3 font-semibold text-zinc-100 flex items-center gap-1.5">
                      <span>#{tx.razorpay_order_id}</span>
                      <span className="text-[10px] text-zinc-500 font-normal">
                        ({tx.razorpay_pay_id.slice(-6)})
                      </span>
                    </td>

                    {/* Customer Contact */}
                    <td className="px-4 py-3 text-zinc-300">
                      <div>{tx.customer_phone}</div>
                      {tx.customer_email && (
                        <div className="text-[11px] text-zinc-500 truncate max-w-[140px]">
                          {tx.customer_email}
                        </div>
                      )}
                    </td>

                    {/* Failure Reason */}
                    <td className="px-4 py-3 text-zinc-400">
                      <div className="capitalize">
                        {tx.failure_reason.replace(/_/g, ' ')}
                      </div>
                      <div className="text-[10px] text-zinc-500 font-mono">
                        Source: {tx.failure_source}
                      </div>
                    </td>

                    {/* Original Amount */}
                    <td className="px-4 py-3 font-semibold text-zinc-100">
                      ₹{Number(tx.original_amount).toLocaleString('en-IN')}
                    </td>

                    {/* Discount / Recovered Amount */}
                    <td className="px-4 py-3">
                      {isRecovered ? (
                        <span className="font-bold text-emerald-400">
                          ₹{Number(tx.recovered_amount).toLocaleString('en-IN')}
                        </span>
                      ) : Number(tx.total_discount_given) > 0 ? (
                        <span className="text-amber-400 text-[11px]">
                          -₹{Number(tx.total_discount_given)} discount
                        </span>
                      ) : (
                        <span className="text-zinc-500">—</span>
                      )}
                    </td>

                    {/* Status Badge */}
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1 items-start">
                        <StatusBadge status={tx.status} attempts={tx.attempts_count} />
                        {tx.status === 'PROMISE_TO_PAY' && tx.promise_at && (
                          <span className="text-[10px] text-violet-400 font-mono">
                            wakes {new Date(tx.promise_at).toLocaleString('en-IN', {
                              day: '2-digit',
                              month: 'short',
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </span>
                        )}
                        {tx.diagnosis_disagreed && (
                          <span
                            title={`Rules said ${tx.rule_strategy}. Groq said ${tx.groq_strategy}. Conservative pick won.`}
                            className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-400"
                          >
                            <Bot className="w-3 h-3" />
                            Groq overruled
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => handleResendNudge(tx.id)}
                        disabled={resendingId === tx.id || nudgeLocked}
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold transition-all ${
                          nudgeLocked
                            ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                            : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                        }`}
                      >
                        <Send className="w-3 h-3" />
                        {resendingId === tx.id ? 'Sending...' : 'Nudge'}
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatusBadge({ status, attempts }: { status: string; attempts: number }) {
  switch (status) {
    case 'RECOVERED':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
          <CheckCircle2 className="w-3 h-3" />
          Recovered
        </span>
      );
    case 'INTERVENING':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/30">
          <Send className="w-3 h-3" />
          Nudge Sent ({attempts}/3)
        </span>
      );
    case 'DEFERRED':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/30">
          <Moon className="w-3 h-3" />
          Deferred
        </span>
      );
    case 'HOLDOUT':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-zinc-800 text-zinc-300 border border-zinc-600">
          Holdout
        </span>
      );
    case 'PROMISE_TO_PAY':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-violet-500/10 text-violet-400 border border-violet-500/30">
          <MessageCircle className="w-3 h-3" />
          Promised
        </span>
      );
    case 'HALTED_POLICY':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/30">
          <Moon className="w-3 h-3" />
          TRAI Quiet Hours
        </span>
      );
    case 'HALTED_EXHAUSTED':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/30">
          <AlertOctagon className="w-3 h-3" />
          Halted (Max Attempts/Fraud)
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-zinc-800 text-zinc-400">
          <Clock className="w-3 h-3" />
          Pending
        </span>
      );
  }
}
