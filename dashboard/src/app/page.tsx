'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Sidebar from '@/components/Sidebar';
import Header from '@/components/Header';
import KPICards from '@/components/KPICards';
import RecoveryCharts from '@/components/RecoveryCharts';
import StrategyLiftTable from '@/components/StrategyLiftTable';
import TransactionsTable from '@/components/TransactionsTable';
import AuditFeed from '@/components/AuditFeed';
import AgentActivity from '@/components/AgentActivity';
import PolicySettings from '@/components/PolicySettings';
import {
  DashboardMetrics,
  FailureReasonCount,
  DailyRevenueTrend,
  TransactionRecord,
  AuditLogItem
} from '@/types/dashboard';

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState('overview');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [failureReasons, setFailureReasons] = useState<FailureReasonCount[]>([]);
  const [dailyTrend, setDailyTrend] = useState<DailyRevenueTrend[]>([]);
  const [transactions, setTransactions] = useState<TransactionRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      setIsRefreshing(true);
      const [mRes, aRes, tRes, logRes] = await Promise.all([
        fetch('/api/metrics'),
        fetch('/api/analytics'),
        fetch('/api/transactions'),
        fetch('/api/audit-logs')
      ]);

      if (mRes.ok) setMetrics(await mRes.json());
      if (aRes.ok) {
        const aData = await aRes.json();
        setFailureReasons(aData.failureReasons || []);
        setDailyTrend(aData.dailyTrend || []);
      }
      if (tRes.ok) {
        const tData = await tRes.json();
        setTransactions(tData.data || []);
      }
      if (logRes.ok) {
        const logData = await logRes.json();
        setAuditLogs(logData.data || []);
      }
    } catch (err) {
      console.error('Error fetching dashboard telemetry:', err);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Auto-refresh interval (10 seconds)
  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(() => {
      fetchData();
    }, 10000);
    return () => clearInterval(timer);
  }, [autoRefresh, fetchData]);

  return (
    <div className="flex min-h-screen bg-zinc-950 text-zinc-100 font-sans antialiased">
      {/* Sidebar */}
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <Header
          autoRefresh={autoRefresh}
          setAutoRefresh={setAutoRefresh}
          onRefresh={fetchData}
          isRefreshing={isRefreshing}
        />

        {/* Dashboard Body */}
        <div className="p-8 space-y-8 max-w-7xl mx-auto w-full">
          {activeTab === 'overview' && (
            <>
              {/* Top KPI Cards */}
              <KPICards metrics={metrics} loading={loading} />

              {/* Recovery Charts */}
              <RecoveryCharts
                failureReasons={failureReasons}
                dailyTrend={dailyTrend}
                loading={loading}
              />

              {/* Lift broken out by strategy — the "not just recovery rate" proof */}
              <StrategyLiftTable strategyLift={metrics?.strategyLift || []} loading={loading} />

              {/* Transactions Table & Audit Feed Layout */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2">
                  <TransactionsTable
                    transactions={transactions}
                    loading={loading}
                    onRefresh={fetchData}
                  />
                </div>
                <div>
                  <AuditFeed logs={auditLogs} loading={loading} />
                </div>
              </div>
            </>
          )}

          {activeTab === 'activity' && <AgentActivity logs={auditLogs} loading={loading} />}

          {activeTab === 'transactions' && (
            <TransactionsTable
              transactions={transactions}
              loading={loading}
              onRefresh={fetchData}
            />
          )}

          {activeTab === 'analytics' && (
            <>
              <KPICards metrics={metrics} loading={loading} />
              <RecoveryCharts
                failureReasons={failureReasons}
                dailyTrend={dailyTrend}
                loading={loading}
              />
              <StrategyLiftTable strategyLift={metrics?.strategyLift || []} loading={loading} />
            </>
          )}

          {activeTab === 'settings' && <PolicySettings loading={loading} />}
        </div>
      </main>
    </div>
  );
}
