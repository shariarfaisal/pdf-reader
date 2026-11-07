import React from 'react';

// Stacked multi-segment progress bar. segments: [{ value, className, label }]
export function SegmentedProgress({ segments, total, label, height = 'h-1.5', className = '' }) {
  const safeTotal = total > 0 ? total : 1;

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={segments[0]?.value || 0}
      className={`flex w-full overflow-hidden rounded-full bg-obsidian-800 ${height} ${className}`}
    >
      {segments.map((segment) =>
        segment.value > 0 ? (
          <div
            key={segment.label}
            title={`${segment.label}: ${segment.value}`}
            className={`h-full transition-[width] duration-500 ease-out motion-reduce:transition-none ${segment.className}`}
            style={{ width: `${(segment.value / safeTotal) * 100}%` }}
          />
        ) : null
      )}
    </div>
  );
}
