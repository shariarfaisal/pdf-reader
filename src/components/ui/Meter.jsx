import React from 'react';

const TONES = {
  ok: 'bg-emerald-400',
  warn: 'bg-amber-400',
  critical: 'bg-rose-400'
};

export function meterTone(percent, warnAt = 65, criticalAt = 85) {
  if (percent >= criticalAt) return 'critical';
  if (percent >= warnAt) return 'warn';
  return 'ok';
}

// Compact labelled gauge: icon + label, value readout, thin threshold-coloured bar.
export function Meter({ icon: Icon, label, value, detail, percent = 0, className = '' }) {
  const clamped = Math.min(100, Math.max(0, percent));
  const tone = meterTone(clamped);

  return (
    <div className={`min-w-0 ${className}`}>
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="flex items-center gap-1.5 text-[11px] font-medium text-slate-400 min-w-0">
          {Icon && <Icon className="w-3.5 h-3.5 flex-shrink-0 text-slate-500" aria-hidden="true" />}
          <span className="truncate">{label}</span>
        </span>
        <span className="font-mono text-[11px] text-slate-200 tabular-nums whitespace-nowrap">{value}</span>
      </div>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(clamped)}
        aria-valuetext={`${value}${detail ? ` ${detail}` : ''}`}
        className="h-1.5 w-full rounded-full bg-obsidian-800 overflow-hidden"
      >
        <div
          className={`h-full rounded-full transition-[width] duration-500 ease-out motion-reduce:transition-none ${TONES[tone]}`}
          style={{ width: `${clamped}%` }}
        />
      </div>
      {detail && <div className="mt-1 text-[10px] text-slate-500 tabular-nums">{detail}</div>}
    </div>
  );
}
