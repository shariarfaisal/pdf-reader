import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

/**
 * Shared modal shell: sticky header, independently scrolling body, optional
 * sticky footer. Rounded-2xl (16px), subtle border, trap focus, manage escape.
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
  const modalRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose?.();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

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
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fade-in"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        className={`w-full ${maxWidth} bg-obsidian-850 border border-obsidian-700/80 rounded-2xl shadow-xl overflow-hidden flex flex-col max-h-[90vh] animate-modal-in ${className}`}
      >
        <header className="flex items-start justify-between gap-4 px-6 py-4.5 border-b border-obsidian-700/80 bg-obsidian-850 flex-shrink-0">
          <div className="flex items-start gap-3 min-w-0">
            {Icon && (
              <span className="p-2 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-500 dark:text-indigo-400 flex-shrink-0">
                <Icon className="w-4 h-4" />
              </span>
            )}
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-slate-100 leading-snug truncate">{title}</h3>
              {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close dialog"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-obsidian-750 transition-colors flex-shrink-0 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className={`overflow-y-auto flex-1 min-h-0 ${bodyClassName}`}>{children}</div>

        {footer && (
          <footer className="flex-shrink-0 px-6 py-3.5 border-t border-obsidian-700/80 bg-obsidian-850">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}
