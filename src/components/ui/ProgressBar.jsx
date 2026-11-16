import React from 'react';

export function ProgressBar({
  value = 0,
  max = 100,
  label,
  showPercent = false,
  className = '',
  height = 'h-1.5'
}) {
  const percent = max > 0 ? Math.min(100, Math.max(0, Math.round((value / max) * 100))) : 0;

  return (
    <div className={`w-full ${className}`}>
      {(label || showPercent) && (
        <div className="flex justify-between items-center text-xs text-slate-400 mb-1.5 font-medium">
          {label && <span>{label}</span>}
          {showPercent && <span className="font-mono text-slate-300">{percent}%</span>}
        </div>
      )}
      <div className={`w-full bg-obsidian-750 rounded-full overflow-hidden ${height}`}>
        <div
          className="bg-indigo-600 dark:bg-indigo-400 h-full rounded-full transition-all duration-300 ease-out"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
