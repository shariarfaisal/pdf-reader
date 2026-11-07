import React, { useCallback, useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';

/**
 * Collapsible section for the inspector sidebar and long settings forms.
 *
 * Open state is remembered per `id` in localStorage and kept in sync between
 * every mounted copy (same section id in Inspector and Settings), so a section
 * never springs back open when a panel remounts or another screen toggles it.
 */

const STORAGE_PREFIX = 'pdf-reader.section.';
const SYNC_EVENT = 'pdf-reader:section';

const memory = new Map();

function readStored(id, fallback) {
  if (memory.has(id)) return memory.get(id);
  let open = fallback;
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + id);
    if (raw === 'open') open = true;
    else if (raw === 'closed') open = false;
  } catch {
    // Private mode / storage disabled — fall back to the default.
  }
  memory.set(id, open);
  return open;
}

function writeStored(id, open) {
  memory.set(id, open);
  try {
    window.localStorage.setItem(STORAGE_PREFIX + id, open ? 'open' : 'closed');
  } catch {
    // Ignore quota/security failures: the in-memory state still works.
  }
  window.dispatchEvent(new CustomEvent(SYNC_EVENT, { detail: { id, open } }));
}

export function useSectionOpen(id, defaultOpen = true) {
  const [open, setOpen] = useState(() => readStored(id, defaultOpen));

  useEffect(() => {
    const onSync = (event) => {
      if (event.detail?.id !== id) return;
      setOpen(Boolean(event.detail.open));
    };
    window.addEventListener(SYNC_EVENT, onSync);
    return () => window.removeEventListener(SYNC_EVENT, onSync);
  }, [id]);

  const toggle = useCallback(() => {
    setOpen((prev) => {
      writeStored(id, !prev);
      return !prev;
    });
  }, [id]);

  return [open, toggle];
}

/**
 * `meta` renders inside the toggle row (counts, live values) so it reads as
 * part of the header; `action` stays outside it so buttons never toggle.
 */
export function Section({
  id,
  icon: Icon,
  iconClassName = 'text-slate-400',
  title,
  meta,
  action,
  children,
  defaultOpen = true,
  className = '',
  headerClassName = '',
  bodyClassName = 'px-4 pb-3',
  bordered = true
}) {
  const [open, toggle] = useSectionOpen(id, defaultOpen);
  const bodyId = `section-body-${id}`;

  return (
    <section
      aria-label={typeof title === 'string' ? title : undefined}
      className={[
        bordered ? 'border-b border-obsidian-800' : '',
        'flex flex-col flex-shrink-0',
        open ? className : ''
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className={`flex items-center gap-1.5 px-2.5 py-1.5 ${headerClassName}`}>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-controls={bodyId}
          className="group flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1 py-1 text-left hover:bg-obsidian-850/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/60 motion-reduce:transition-none transition-colors"
        >
          <ChevronDown
            className={`w-3.5 h-3.5 flex-shrink-0 text-slate-500 transition-transform duration-200 motion-reduce:transition-none group-hover:text-slate-300 ${
              open ? '' : '-rotate-90'
            }`}
            aria-hidden="true"
          />
          {Icon && <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${iconClassName}`} aria-hidden="true" />}
          <span className="truncate text-[11px] font-semibold uppercase tracking-wider text-slate-400 group-hover:text-slate-200">
            {title}
          </span>
          {meta && <span className="ml-auto flex-shrink-0 pl-2 text-[10px] text-slate-500">{meta}</span>}
        </button>
        {action && <div className="flex flex-shrink-0 items-center gap-1">{action}</div>}
      </div>

      {open && (
        <div id={bodyId} className={bodyClassName}>
          {children}
        </div>
      )}
    </section>
  );
}
