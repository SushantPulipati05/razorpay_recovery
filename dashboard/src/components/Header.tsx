'use client';

import React from 'react';
import { RefreshCw, Radio } from 'lucide-react';

interface HeaderProps {
  autoRefresh: boolean;
  setAutoRefresh: (val: boolean) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
}

export default function Header({
  autoRefresh,
  setAutoRefresh,
  onRefresh,
  isRefreshing
}: HeaderProps) {
  return (
    <header className="h-16 border-b border-zinc-800 bg-zinc-900/60 backdrop-blur-md sticky top-0 z-10 px-8 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-bold text-zinc-100">Executive Dashboard</h2>
        <div className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium">
          <Radio className="w-3 h-3 animate-pulse text-emerald-400" />
          Live Telemetry
        </div>
      </div>

      <div className="flex items-center gap-4">
        {/* Auto Refresh Toggle */}
        <label className="flex items-center gap-2 text-xs font-medium text-zinc-400 cursor-pointer select-none">
          <span>Auto-refresh (10s)</span>
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.checked)}
            className="w-4 h-4 accent-emerald-500 rounded bg-zinc-800 border-zinc-700 cursor-pointer"
          />
        </label>

        {/* Manual Refresh Button */}
        <button
          onClick={onRefresh}
          disabled={isRefreshing}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium border border-zinc-700/80 transition-all disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>
    </header>
  );
}
