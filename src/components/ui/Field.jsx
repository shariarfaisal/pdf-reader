import React from 'react';
import { ChevronDown } from 'lucide-react';

/**
 * Form primitives shared by every settings/modal form.
 *
 * One place owns the control chrome (height, border, focus ring, fonts) so a
 * new field never re-invents a slightly different input.
 */

const CONTROL_BASE =
  'w-full rounded-lg border bg-obsidian-950/80 text-slate-100 placeholder:text-slate-600 transition-colors ' +
  'focus:outline-none focus:ring-2 focus:ring-brand-500/25 focus:border-brand-400 ' +
  'disabled:opacity-50 disabled:cursor-not-allowed';

const CONTROL_IDLE = 'border-obsidian-700 hover:border-obsidian-600';

/** Label + control + helper text, stacked with consistent spacing. */
export function Field({ label, hint, htmlFor, children, action, className = '' }) {
  return (
    <div className={`min-w-0 ${className}`}>
      {(label || action) && (
        <div className="flex items-center justify-between gap-2 mb-1.5">
          {label ? (
            <label htmlFor={htmlFor} className="text-[12.5px] font-medium text-slate-300">
              {label}
            </label>
          ) : (
            <span />
          )}
          {action}
        </div>
      )}
      {children}
      {hint && <p className="mt-1.5 text-[11.5px] leading-relaxed text-slate-500">{hint}</p>}
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
      className={`${CONTROL_BASE} ${CONTROL_IDLE} px-3 h-9 ${mono ? 'font-mono text-xs' : 'text-[13px]'} ${className}`}
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
        mono ? 'font-mono text-xs' : 'text-[13px]'
      } ${className}`}
      {...props}
    />
  );
});

/** `<select>` with a custom chevron so the dark theme stays consistent. */
export const SelectInput = React.forwardRef(function SelectInput(
  { className = '', children, ...props },
  ref
) {
  return (
    <div className="relative">
      <select
        ref={ref}
        className={`${CONTROL_BASE} ${CONTROL_IDLE} appearance-none pl-3 pr-9 h-9 text-[13px] cursor-pointer ${className}`}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
    </div>
  );
});
