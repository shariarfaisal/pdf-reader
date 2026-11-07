import React, { useEffect } from 'react';
import { X } from 'lucide-react';

/**
 * Shared modal shell: sticky header, independently scrolling body, optional
 * sticky footer. `maxWidth` stays supported so existing callers keep working.
 */
export function Modal({
  isOpen,
  onClose,
  title,
  subtitle,
  icon: Icon,
  children,
  footer,
  maxWidth = 'max-w-2xl',
  bodyClassName = 'p-6',
  className = ''
}) {
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', handleKeyDown);

    // Keep the page behind the dialog from scrolling while it is open.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        className={`w-full ${maxWidth} bg-obsidian-850 border border-obsidian-700 rounded-2xl shadow-2xl shadow-black/60 overflow-hidden flex flex-col max-h-[92vh] animate-modal-in ${className}`}
      >
        <header className="flex items-start justify-between gap-4 px-5 py-4 border-b border-obsidian-700 bg-obsidian-900/60 flex-shrink-0">
          <div className="flex items-start gap-3 min-w-0">
            {Icon && (
              <span className="mt-0.5 p-2 rounded-xl bg-brand-500/10 border border-brand-500/25 text-brand-300 flex-shrink-0">
                <Icon className="w-4 h-4" />
              </span>
            )}
            <div className="min-w-0">
              <h3 className="text-[15px] font-semibold text-slate-100 leading-snug truncate">{title}</h3>
              {subtitle && <p className="text-[12px] text-slate-500 mt-0.5">{subtitle}</p>}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close dialog"
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-obsidian-700 transition flex-shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className={`overflow-y-auto flex-1 min-h-0 ${bodyClassName}`}>{children}</div>

        {footer && (
          <footer className="flex-shrink-0 px-5 py-3 border-t border-obsidian-700 bg-obsidian-900/60">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}
