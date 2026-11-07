import React, { useEffect, useState } from 'react';
import { Type, FileText, Loader2 } from 'lucide-react';

/**
 * Page preview used wherever the user must recognise a page before acting on it
 * (page manager rows, delete confirmation).
 *
 * PDF pages are rendered on demand at a small scale by the server (JPEG, cached
 * in `data/projects/:id/previews`), custom text pages show their text instead.
 */
export function PageThumbnail({ projectId, page, size = 'sm', onClick, className = '' }) {
  const [state, setState] = useState('loading'); // loading | ok | error

  const isLarge = size === 'lg';
  const isCustom = page?.page_type === 'custom';
  const src = !isCustom && page
    ? `/api/projects/${projectId}/pages/${page.page_number}/preview?v=${page.updated_at || 0}`
    : null;

  useEffect(() => {
    setState('loading');
  }, [src]);

  if (isCustom) {
    if (isLarge) {
      return (
        <div
          className={`rounded-xl border border-purple-500/25 bg-obsidian-950 p-4 max-h-[46vh] overflow-y-auto ${className}`}
        >
          <pre className="whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-slate-200 select-text">
            {page.raw_text || 'Empty custom page — add text before narrating it.'}
          </pre>
        </div>
      );
    }
    return (
      <button
        type="button"
        onClick={onClick}
        title={`Custom text page ${page.page_number + 1}`}
        className={`w-11 h-16 flex-shrink-0 rounded-md border border-purple-500/30 bg-purple-500/5 flex items-center justify-center hover:border-purple-400 transition ${className}`}
      >
        <Type className="w-4 h-4 text-purple-300" />
      </button>
    );
  }

  const body = state === 'error' ? (
    <div className="flex flex-col items-center justify-center w-full h-full gap-1 text-slate-600">
      <FileText className={isLarge ? 'w-8 h-8' : 'w-4 h-4'} />
      {isLarge && <p className="text-xs">Preview unavailable</p>}
    </div>
  ) : (
    <>
      {state !== 'ok' && (
        <Loader2
          className={`absolute animate-spin text-slate-600 ${isLarge ? 'w-6 h-6' : 'w-3.5 h-3.5'}`}
        />
      )}
      <img
        src={src}
        alt={`Page ${page.page_number + 1}`}
        loading={isLarge ? 'eager' : 'lazy'}
        onLoad={() => setState('ok')}
        onError={() => setState('error')}
        className={`${
          isLarge ? 'max-h-[46vh] w-auto object-contain' : 'w-full h-full object-cover'
        } ${state === 'ok' ? '' : 'opacity-0'}`}
      />
    </>
  );

  if (isLarge) {
    return (
      <div
        className={`relative flex items-center justify-center min-h-[220px] rounded-xl border border-obsidian-700 bg-black/40 overflow-hidden ${className}`}
      >
        {body}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      title={`Preview page ${page.page_number + 1}`}
      className={`relative w-11 h-16 flex-shrink-0 rounded-md border border-obsidian-700 bg-obsidian-950 overflow-hidden flex items-center justify-center hover:border-brand-400 transition ${className}`}
    >
      {body}
    </button>
  );
}
