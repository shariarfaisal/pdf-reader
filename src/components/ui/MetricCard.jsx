import React from 'react';

/**
 * Compact KPI tile used across the usage dashboard.
 */
export function MetricCard({ label, value, hint, icon: Icon, accent = 'brand', className = '' }) {
  const accents = {
    brand: 'text-brand-400 bg-brand-500/10 border-brand-500/20',
    emerald: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    amber: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
    violet: 'text-violet-400 bg-violet-500/10 border-violet-500/20',
    rose: 'text-rose-400 bg-rose-500/10 border-rose-500/20',
    slate: 'text-slate-300 bg-slate-500/10 border-slate-500/20'
  };

  return (
    <div
      className={`bg-obsidian-850/90 border border-obsidian-700/80 rounded-xl p-4 shadow-lg shadow-black/20 ${className}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-slate-500 font-medium truncate">{label}</p>
          <p className="text-xl font-semibold text-slate-100 font-mono mt-1.5 truncate">{value}</p>
          {hint && <p className="text-[11px] text-slate-500 mt-1 truncate">{hint}</p>}
        </div>
        {Icon && (
          <span className={`p-2 rounded-lg border flex-shrink-0 ${accents[accent] || accents.brand}`}>
            <Icon className="w-4 h-4" />
          </span>
        )}
      </div>
    </div>
  );
}
