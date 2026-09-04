'use client';

import React from 'react';
import {
  LayoutDashboard,
  ReceiptText,
  TrendingUp,
  Settings,
  ShieldCheck,
  Zap,
  HelpCircle,
  Activity
} from 'lucide-react';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

export default function Sidebar({ activeTab, setActiveTab }: SidebarProps) {
  const navItems = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'activity', label: 'Agent Activity', icon: Activity },
    { id: 'transactions', label: 'Transactions', icon: ReceiptText },
    { id: 'analytics', label: 'Analytics & ROI', icon: TrendingUp },
    { id: 'settings', label: 'Policy Settings', icon: Settings }
  ];

  return (
    <aside className="w-64 bg-zinc-900 border-r border-zinc-800 flex flex-col justify-between h-screen sticky top-0">
      <div>
        {/* Brand Header */}
        <div className="p-6 border-b border-zinc-800 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center shadow-lg shadow-emerald-500/20">
            <Zap className="w-5 h-5 text-zinc-950 stroke-[2.5]" />
          </div>
          <div>
            <h1 className="font-bold text-zinc-100 text-base tracking-tight leading-tight">
              Razorpay Recover
            </h1>
            <p className="text-xs text-zinc-400 font-medium">AI Revenue Engine</p>
          </div>
        </div>

        {/* Navigation Menu */}
        <nav className="p-4 space-y-1.5">
          <div className="px-3 py-2 text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
            Main Menu
          </div>
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-emerald-400' : 'text-zinc-400'}`} />
                {item.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Footer Info */}
      <div className="p-4 border-t border-zinc-800 space-y-3">
        <div className="p-3 rounded-lg bg-zinc-950/70 border border-zinc-800/80">
          <div className="flex items-center gap-2 mb-1">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span className="text-xs font-semibold text-zinc-200">TRAI Guardrail Active</span>
          </div>
          <p className="text-[11px] text-zinc-400 leading-relaxed">
            Quiet hours (9 PM - 9 AM IST) auto-defer commercial nudges.
          </p>
        </div>

        <div className="flex items-center justify-between text-xs text-zinc-500 px-1">
          <span>v1.0.0 • Buildathon</span>
          <a href="#" className="hover:text-zinc-300 flex items-center gap-1">
            <HelpCircle className="w-3.5 h-3.5" /> Docs
          </a>
        </div>
      </div>
    </aside>
  );
}
