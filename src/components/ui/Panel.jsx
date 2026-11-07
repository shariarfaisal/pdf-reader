import React from 'react';

/**
 * Grouped settings/config block: icon + title, optional description, then fields.
 * Keeps every section of a long form visually identical.
 */

const ACCENTS = {
  brand: 'text-brand-300 bg-brand-500/10 border-brand-500/25',
  sky: 'text-sky-300 bg-sky-500/10 border-sky-500/25',
  violet: 'text-violet-300 bg-violet-500/10 border-violet-500/25',
  amber: 'text-amber-300 bg-amber-500/10 border-amber-500/25',
  emerald: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/25',
  rose: 'text-rose-300 bg-rose-500/10 border-rose-500/25'
};

export function Panel({
  icon: Icon,
  title,
  description,
  accent = 'brand',
  action,
  children,
  className = ''
}) {
  return (
    <section
      className={`rounded-xl border border-obsidian-700/70 bg-obsidian-900/50 overflow-hidden ${className}`}
    >
      <header className="flex items-start gap-3 px-4 py-3 border-b border-obsidian-800/80">
        {Icon && (
          <span
            className={`mt-0.5 p-1.5 rounded-lg border flex-shrink-0 ${ACCENTS[accent] || ACCENTS.brand}`}
          >
            <Icon className="w-4 h-4" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h3 className="text-[13.5px] font-semibold text-slate-100 leading-tight">{title}</h3>
          {description && (
            <p className="text-[11.5px] text-slate-500 mt-0.5 leading-relaxed">{description}</p>
          )}
        </div>
        {action && <div className="flex-shrink-0">{action}</div>}
      </header>
      <div className="p-4 space-y-4">{children}</div>
    </section>
  );
}
