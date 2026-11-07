import React, { useEffect, useRef } from 'react';
import { AlertTriangle, AlertCircle, HelpCircle, X } from 'lucide-react';
import { Button } from './Button';

const VARIANT_ICONS = {
  danger: AlertCircle,
  warning: AlertTriangle,
  default: HelpCircle
};

const VARIANT_STYLES = {
  danger: {
    iconWrapper: 'bg-rose-500/10 text-rose-400 border-rose-500/30',
    confirmVariant: 'danger'
  },
  warning: {
    iconWrapper: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
    confirmVariant: 'primary'
  },
  default: {
    iconWrapper: 'bg-brand-500/10 text-brand-400 border-brand-500/30',
    confirmVariant: 'primary'
  }
};

export function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'default',
  isLoading = false,
  icon: CustomIcon
}) {
  const confirmBtnRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && !isLoading) {
        onClose?.();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    // Focus confirm button when opened
    const timer = setTimeout(() => {
      confirmBtnRef.current?.focus();
    }, 50);

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = prevOverflow;
      clearTimeout(timer);
    };
  }, [isOpen, onClose, isLoading]);

  if (!isOpen) return null;

  const styleConfig = VARIANT_STYLES[variant] || VARIANT_STYLES.default;
  const Icon = CustomIcon || VARIANT_ICONS[variant] || VARIANT_ICONS.default;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !isLoading) onClose?.();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        aria-describedby="confirm-modal-description"
        className="w-full max-w-md bg-obsidian-850 border border-obsidian-700/90 rounded-2xl shadow-2xl shadow-black/80 overflow-hidden animate-modal-in"
      >
        <div className="p-6">
          <div className="flex items-start gap-4">
            <div
              className={`p-2.5 rounded-xl border flex-shrink-0 ${styleConfig.iconWrapper}`}
            >
              <Icon className="w-5 h-5" aria-hidden="true" />
            </div>

            <div className="min-w-0 flex-1">
              <h3
                id="confirm-modal-title"
                className="text-base font-semibold text-slate-100 leading-snug"
              >
                {title}
              </h3>
              <p
                id="confirm-modal-description"
                className="text-[13px] text-slate-400 mt-2 leading-relaxed whitespace-pre-line"
              >
                {message}
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2.5 px-6 py-3.5 border-t border-obsidian-800 bg-obsidian-900/60">
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            disabled={isLoading}
          >
            {cancelText}
          </Button>
          <Button
            ref={confirmBtnRef}
            variant={styleConfig.confirmVariant}
            size="sm"
            isLoading={isLoading}
            onClick={onConfirm}
          >
            {confirmText}
          </Button>
        </div>
      </div>
    </div>
  );
}
