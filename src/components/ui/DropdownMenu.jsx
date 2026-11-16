import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from './Button';

/**
 * Reusable lightweight dropdown menu.
 *
 * items: array of
 *   { label, description?, icon?, onSelect, disabled?, danger? } | { divider: true }
 */
export function DropdownMenu({
  label,
  icon: TriggerIcon,
  items = [],
  variant = 'ghost',
  size = 'sm',
  align = 'right',
  side = 'bottom',
  title,
  disabled = false,
  className = '',
  widthClass = 'w-64',
  showChevron = true
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef(null);
  const menuRef = useRef(null);

  const interactiveItems = items.filter((item) => !item.divider);

  useEffect(() => {
    if (!isOpen) {
      setActiveIndex(-1);
      return;
    }

    const onPointerDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((prev) => (prev + 1) % interactiveItems.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((prev) => (prev <= 0 ? interactiveItems.length - 1 : prev - 1));
      } else if (e.key === 'Enter' && activeIndex >= 0 && activeIndex < interactiveItems.length) {
        e.preventDefault();
        const selected = interactiveItems[activeIndex];
        if (selected && !selected.disabled) {
          setIsOpen(false);
          selected.onSelect?.();
        }
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen, activeIndex, interactiveItems]);

  const handleSelect = (item) => {
    if (item.disabled) return;
    setIsOpen(false);
    item.onSelect?.();
  };

  return (
    <div className={`relative inline-flex ${className}`} ref={rootRef}>
      <Button
        variant={variant}
        size={size}
        icon={TriggerIcon}
        title={title}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((v) => !v)}
      >
        {label}
        {showChevron && (
          <ChevronDown
            className={`w-3.5 h-3.5 ${label ? 'ml-1' : ''} transition-transform duration-150 ${
              isOpen ? 'rotate-180' : ''
            }`}
          />
        )}
      </Button>

      {isOpen && (
        <div
          ref={menuRef}
          role="menu"
          className={`absolute ${side === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5'} z-50 ${widthClass} max-h-[min(70vh,30rem)] overflow-y-auto overflow-x-hidden scroll-slim bg-obsidian-850 border border-obsidian-700/80 rounded-xl shadow-lg py-1 animate-fade-in ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {items.map((item, idx) => {
            if (item.divider) {
              return (
                <div
                  key={`divider-${idx}`}
                  className="h-px bg-obsidian-700/60 my-1"
                  role="separator"
                />
              );
            }
            const ItemIcon = item.icon;
            const itemInteractiveIdx = interactiveItems.indexOf(item);
            const isHighlighted = itemInteractiveIdx === activeIndex;

            return (
              <button
                key={item.label}
                role="menuitem"
                type="button"
                onClick={() => handleSelect(item)}
                disabled={item.disabled}
                className={`w-full text-left px-3 py-1.5 flex items-start gap-2.5 transition-colors duration-100 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer ${
                  item.danger
                    ? isHighlighted
                      ? 'bg-rose-500/20 text-rose-600 dark:text-rose-200'
                      : 'text-rose-600 dark:text-rose-300 hover:bg-rose-500/10'
                    : isHighlighted
                    ? 'bg-obsidian-750 text-indigo-600 dark:text-indigo-300'
                    : 'text-slate-100 hover:bg-obsidian-750'
                }`}
              >
                {ItemIcon && (
                  <ItemIcon
                    className={`w-4 h-4 mt-0.5 flex-shrink-0 ${
                      item.danger
                        ? 'text-rose-600 dark:text-rose-400'
                        : isHighlighted
                        ? 'text-indigo-600 dark:text-indigo-400'
                        : 'text-slate-400'
                    }`}
                  />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-medium leading-snug">{item.label}</span>
                  {item.description && (
                    <span className="block text-[11px] text-slate-500 leading-snug mt-0.5">
                      {item.description}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
