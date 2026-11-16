import React from 'react';
import { ChevronDown } from 'lucide-react';

/**
 * Form primitives shared across settings and modals.
 * Standard control height (h-9: 36px / h-10: 40px), rounded-lg (8px),
 * theme-adaptive borders and focus rings.
 */

const CONTROL_BASE =
  'w-full rounded-lg border bg-obsidian-900 text-slate-100 placeholder:text-slate-500 transition-colors ' +
  'focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 dark:focus:border-indigo-400 ' +
  'disabled:opacity-40 disabled:cursor-not-allowed';

const CONTROL_IDLE = 'border-obsidian-700 hover:border-obsidian-600';

/** Label + control + helper text, stacked with consistent spacing. */
export function Field({ label, hint, htmlFor, children, action, className = '' }) {
  return (
    <div className={`min-w-0 ${className}`}>
      {(label || action) && (
        <div className="flex items-center justify-between gap-2 mb-1.5">
          {label ? (
            <label htmlFor={htmlFor} className="text-xs font-medium text-slate-300">
              {label}
            </label>
          ) : (
            <span />
          )}
          {action}
        </div>
      )}
      {children}
      {hint && <p className="mt-1.5 text-[12px] leading-relaxed text-slate-500">{hint}</p>}
    </div>
  );
}

export const TextInput = React.forwardRef(function TextInput(
  { className = '', mono = false, ...props },
  ref
) {
  return (
    <input
      ref={ref}
      className={`${CONTROL_BASE} ${CONTROL_IDLE} px-3 h-9.5 ${mono ? 'font-mono text-xs' : 'text-sm'} ${className}`}
      {...props}
    />
  );
});

export const TextArea = React.forwardRef(function TextArea(
  { className = '', mono = false, rows = 3, ...props },
  ref
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      className={`${CONTROL_BASE} ${CONTROL_IDLE} px-3 py-2 leading-relaxed resize-y ${
        mono ? 'font-mono text-xs' : 'text-sm'
      } ${className}`}
      {...props}
    />
  );
});

/** `<select>` with a custom chevron so the dark/light theme stays consistent. */
export const SelectInput = React.forwardRef(function SelectInput(
  { className = '', children, ...props },
  ref
) {
  return (
    <div className="relative">
      <select
        ref={ref}
        className={`${CONTROL_BASE} ${CONTROL_IDLE} appearance-none pl-3 pr-9 h-9.5 text-sm cursor-pointer ${className}`}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
    </div>
  );
});
