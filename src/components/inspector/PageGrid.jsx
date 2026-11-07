import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, Check, LayoutGrid, Loader2 } from 'lucide-react';
import { Section } from '../ui/Section';
import {
  PAGE_STAGES,
  pageLevel,
  pageBucket,
  pageStages,
  isPageRunning,
  runningStageFor,
  describePage,
  BUCKET_BY_KEY
} from '../../lib/pageStages';

// Tone of a page cell by how far it got: nothing → text → script → audio.
const LEVEL_TONE = [
  'bg-obsidian-950 border-obsidian-800 text-slate-400 hover:border-slate-600 hover:text-slate-200',
  'bg-sky-950/30 border-sky-800/60 text-sky-200 hover:border-sky-500/70',
  'bg-violet-950/30 border-violet-800/60 text-violet-200 hover:border-violet-500/70',
  'bg-emerald-950/40 border-emerald-700/40 text-emerald-300 hover:border-emerald-500/70'
];

const ERROR_TONE = 'bg-rose-950/40 border-rose-700/50 text-rose-300 hover:border-rose-500/70';

// Border + glow of a cell while its stage actually runs.
const RUNNING_TONE = {
  ocr: 'bg-sky-900/40 border-sky-400/70 text-sky-50',
  refine: 'bg-violet-900/40 border-violet-400/70 text-violet-50',
  audio: 'bg-emerald-900/40 border-emerald-400/70 text-emerald-50'
};

const BUCKET_TONE = {
  pending: 'text-slate-200 border-slate-500/60 bg-slate-500/10',
  text: 'text-sky-300 border-sky-500/50 bg-sky-500/10',
  script: 'text-violet-300 border-violet-500/50 bg-violet-500/10',
  audio: 'text-emerald-300 border-emerald-500/50 bg-emerald-500/10',
  error: 'text-rose-300 border-rose-500/50 bg-rose-500/10'
};

/** Three micro bars: filled = cached, pulsing = running, empty = pending. */
function StageBars({ done, runningStage }) {
  return (
    <span className="flex w-[62%] items-center gap-[2px]" aria-hidden="true">
      {PAGE_STAGES.map((stage) => {
        const filled = done[stage.key];
        const running = runningStage === stage.key;
        return (
          <span
            key={stage.key}
            className={`h-[3px] flex-1 rounded-full ${
              filled
                ? stage.bar
                : running
                  ? `${stage.bar} opacity-50 animate-pulse motion-reduce:animate-none`
                  : 'bg-obsidian-700/80'
            }`}
          />
        );
      })}
    </span>
  );
}

/**
 * Page grid: every cell carries its own four-stage progress (nothing / text /
 * script / audio) and only spins while a stage is genuinely running.
 */
export function PageGrid({ pages, activePageNumber, onSelectPage, activeRuns = null, stages = {} }) {
  const [filterKey, setFilterKey] = useState('all');
  const gridRef = useRef(null);

  const buckets = [
    {
      key: 'all',
      label: 'All',
      count: pages.length,
      tone: 'text-slate-200 border-slate-500/60 bg-slate-500/10',
      match: () => true
    }
  ].concat(
    ['pending', 'text', 'script', 'audio', 'error'].map((key) => {
      const bucket = BUCKET_BY_KEY[key];
      return {
        key,
        label: bucket.label,
        count: pages.filter((page) => pageBucket(page) === key).length,
        tone: BUCKET_TONE[key],
        match: (page) => pageBucket(page) === key
      };
    })
  );

  // A filter that has emptied out (e.g. the last error was fixed) falls back to All.
  const chosen = buckets.find((bucket) => bucket.key === filterKey);
  const filter = chosen && (chosen.count > 0 || chosen.key === 'all') ? chosen : buckets[0];
  const visible = pages.filter(filter.match);
  const runningCount = pages.filter((page) => isPageRunning(page, activeRuns, stages)).length;

  // Keep the current page visible inside the grid without scrolling ancestors.
  useEffect(() => {
    const grid = gridRef.current;
    const cell = grid?.querySelector(`[data-page="${activePageNumber}"]`);
    if (!grid || !cell) return;
    const top = cell.offsetTop;
    const bottom = top + cell.offsetHeight;
    if (top < grid.scrollTop) grid.scrollTop = Math.max(0, top - 4);
    else if (bottom > grid.scrollTop + grid.clientHeight) grid.scrollTop = bottom - grid.clientHeight + 4;
  }, [activePageNumber, filter.key]);

  return (
    <Section
      id="inspector-pages"
      icon={LayoutGrid}
      iconClassName="text-slate-300"
      title="Pages"
      meta={`${pages.length} pages`}
      bodyClassName="px-3 pt-1 pb-3"
    >
      <div className="space-y-2.5">
        <div role="group" aria-label="Filter pages by completed stage" className="grid grid-cols-3 gap-1.5">
          {buckets.map((bucket) => {
            const isSelected = bucket.key === filter.key;
            const empty = bucket.count === 0;
            return (
              <button
                key={bucket.key}
                type="button"
                aria-pressed={isSelected}
                disabled={empty && bucket.key !== 'all'}
                onClick={() => setFilterKey(bucket.key)}
                className={`flex items-center justify-center gap-1.5 rounded-lg border py-1 transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/60 disabled:cursor-default disabled:opacity-40 ${
                  isSelected
                    ? bucket.tone
                    : 'border-obsidian-800 bg-obsidian-950/60 text-slate-400 hover:border-obsidian-600'
                }`}
              >
                <span className="font-mono text-[12px] font-semibold leading-none tabular-nums">{bucket.count}</span>
                <span className="text-[10px] leading-none uppercase tracking-wide">{bucket.label}</span>
              </button>
            );
          })}
        </div>

        <div
          ref={gridRef}
          className="relative grid grid-cols-6 gap-1.5 max-h-[10.5rem] overflow-y-auto pr-1 overscroll-contain"
        >
          {visible.length === 0 ? (
            <p className="col-span-6 py-6 text-center text-[11px] text-slate-500">No pages in this stage.</p>
          ) : (
            visible.map((page) => {
              const isActive = page.page_number === activePageNumber;
              const done = pageStages(page);
              const level = pageLevel(page);
              const running = isPageRunning(page, activeRuns, stages);
              const runningStage = running ? runningStageFor(page, activeRuns, stages) : null;
              const isError = page.status === 'error';
              const tone = isError
                ? ERROR_TONE
                : running
                  ? RUNNING_TONE[runningStage] || LEVEL_TONE[level]
                  : LEVEL_TONE[level];
              const stateLabel = describePage(page, activeRuns, stages);
              const tooltip = `Page ${page.page_number + 1} · ${stateLabel}${
                isError && page.error_message ? ` · ${page.error_message}` : ''
              }`;

              return (
                <button
                  key={page.page_number}
                  type="button"
                  data-page={page.page_number}
                  aria-current={isActive ? 'page' : undefined}
                  aria-label={`Page ${page.page_number + 1}, ${stateLabel}`}
                  title={tooltip}
                  onClick={() => onSelectPage(page.page_number)}
                  className={`relative flex h-10 flex-col items-center justify-center gap-1 rounded-md border px-1 text-[11px] font-mono tabular-nums transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/60 ${tone} ${
                    isActive ? 'ring-2 ring-brand-400 font-bold' : ''
                  }`}
                >
                  <span className="flex items-center gap-0.5 leading-none">
                    {page.page_number + 1}
                    {running ? (
                      <Loader2 className="w-2.5 h-2.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                    ) : isError ? (
                      <AlertCircle className="w-2.5 h-2.5 text-rose-400" aria-hidden="true" />
                    ) : done.audio ? (
                      <Check className="w-2.5 h-2.5 text-emerald-400/80" aria-hidden="true" />
                    ) : null}
                  </span>
                  <StageBars done={done} runningStage={runningStage} />
                </button>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between gap-2">
          <ul className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[9px] uppercase tracking-wide text-slate-500">
            {PAGE_STAGES.map((stage) => (
              <li key={stage.key} className="flex items-center gap-1">
                <span className={`h-[3px] w-3 rounded-full ${stage.bar}`} aria-hidden="true" />
                {stage.label}
              </li>
            ))}
          </ul>
          <span className={`text-[10px] ${runningCount > 0 ? 'text-brand-300' : 'text-slate-500'}`}>
            {runningCount > 0 ? `${runningCount} running` : 'Click to jump'}
          </span>
        </div>
      </div>
    </Section>
  );
}
