import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, Check, ChevronDown, ChevronRight, LayoutGrid, Loader2 } from 'lucide-react';
import { useSectionOpen } from '../ui/Section';
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

// Theme-aware, high-contrast cell styles (light mode clean tints + dark mode subtle obsidian tones).
const LEVEL_STYLES = [
  // Level 0: Pending / Not started
  'bg-obsidian-850 border-obsidian-700/80 text-slate-300 hover:border-obsidian-600 hover:text-slate-100 hover:bg-obsidian-750/40',
  // Level 1: Text extracted
  'bg-sky-500/10 border-sky-500/30 text-sky-700 dark:text-sky-300 hover:bg-sky-500/15 hover:border-sky-500/40',
  // Level 2: Script refined
  'bg-violet-500/10 border-violet-500/30 text-violet-700 dark:text-violet-300 hover:bg-violet-500/15 hover:border-violet-500/40',
  // Level 3: Audio complete
  'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/15 hover:border-emerald-500/40'
];

const ERROR_STYLE =
  'bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-300 hover:bg-rose-500/15';

const RUNNING_STYLES = {
  ocr: 'bg-sky-500/15 border-sky-500 text-sky-800 dark:text-sky-200 ring-2 ring-sky-500/50 animate-pulse',
  refine: 'bg-violet-500/15 border-violet-500 text-violet-800 dark:text-violet-200 ring-2 ring-violet-500/50 animate-pulse',
  audio: 'bg-emerald-500/15 border-emerald-500 text-emerald-800 dark:text-emerald-200 ring-2 ring-emerald-500/50 animate-pulse'
};

const BUCKET_ACTIVE_STYLES = {
  all: 'bg-indigo-600 text-white dark:bg-indigo-500 dark:text-white shadow-2xs font-semibold border border-indigo-600 dark:border-indigo-500',
  pending: 'bg-slate-600 text-white dark:bg-slate-600 dark:text-white shadow-2xs font-semibold border border-slate-600',
  text: 'bg-sky-600 text-white dark:bg-sky-500 dark:text-white shadow-2xs font-semibold border border-sky-600 dark:border-sky-500',
  script: 'bg-violet-600 text-white dark:bg-violet-500 dark:text-white shadow-2xs font-semibold border border-violet-600 dark:border-violet-500',
  audio: 'bg-emerald-600 text-white dark:bg-emerald-500 dark:text-white shadow-2xs font-semibold border border-emerald-600 dark:border-emerald-500',
  error: 'bg-rose-600 text-white dark:bg-rose-500 dark:text-white shadow-2xs font-semibold border border-rose-600 dark:border-rose-500'
};

// Cells are a fixed 36px + 6px gap in a 6 column grid, so the grid can be
// windowed by rows: a 300 page book renders ~60 cells instead of 300.
const GRID_COLS = 6;
const GRID_CELL_HEIGHT = 36;
const GRID_GAP = 6;
const GRID_ROW_HEIGHT = GRID_CELL_HEIGHT + GRID_GAP;

/** Refined micro progress indicator at the bottom of a cell. */
function MicroStageBars({ done, isRunning, runningStage }) {
  return (
    <span className="flex w-[60%] items-center gap-[2px] mt-0.5" aria-hidden="true">
      {PAGE_STAGES.map((stage) => {
        const isDone = done[stage.key];
        const isCurrent = isRunning && runningStage === stage.key;

        let dotColor = 'bg-obsidian-700/80';
        if (isDone) {
          if (stage.key === 'ocr') dotColor = 'bg-sky-500 dark:bg-sky-400';
          else if (stage.key === 'refine') dotColor = 'bg-violet-500 dark:bg-violet-400';
          else if (stage.key === 'audio') dotColor = 'bg-emerald-500 dark:bg-emerald-400';
        } else if (isCurrent) {
          dotColor = 'bg-indigo-500 animate-pulse';
        }

        return <span key={stage.key} className={`h-[2px] flex-1 rounded-full ${dotColor}`} />;
      })}
    </span>
  );
}

/**
 * Modern, theme-harmonized Page grid with compact filter chips,
 * clear high-contrast states, quick page jumping, and persistent collapsible card layout.
 */
export function PageGrid({ pages, activePageNumber, onSelectPage, activeRuns = null, stages = {} }) {
  const [open, toggleOpen] = useSectionOpen('inspector-pages', true);
  const [filterKey, setFilterKey] = useState('all');
  const [jumpPageInput, setJumpPageInput] = useState('');
  const [gridViewport, setGridViewport] = useState({ scrollTop: 0, height: 0 });
  const gridRef = useRef(null);

  useEffect(() => {
    const grid = gridRef.current;
    if (!open || !grid) return;

    const measure = () =>
      setGridViewport((prev) => {
        const next = { scrollTop: grid.scrollTop, height: grid.clientHeight };
        return prev.scrollTop === next.scrollTop && prev.height === next.height ? prev : next;
      });

    measure();
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };
    grid.addEventListener('scroll', onScroll, { passive: true });
    let observer = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(measure);
      observer.observe(grid);
    }
    return () => {
      grid.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
      if (observer) observer.disconnect();
    };
  }, [open]);

  const buckets = [
    {
      key: 'all',
      label: 'All',
      count: pages.length,
      match: () => true
    }
  ].concat(
    ['pending', 'text', 'script', 'audio', 'error'].map((key) => {
      const bucket = BUCKET_BY_KEY[key];
      return {
        key,
        label: bucket.label,
        count: pages.filter((page) => pageBucket(page) === key).length,
        match: (page) => pageBucket(page) === key
      };
    })
  );

  // A filter that has emptied out falls back to All.
  const chosen = buckets.find((b) => b.key === filterKey);
  const filter = chosen && (chosen.count > 0 || chosen.key === 'all') ? chosen : buckets[0];
  const visible = pages.filter(filter.match);
  const runningCount = pages.filter((page) => isPageRunning(page, activeRuns, stages)).length;
  const audioCount = buckets.find((b) => b.key === 'audio')?.count || 0;
  const allComplete = pages.length > 0 && audioCount === pages.length;

  // Filter chips to display: always show 'all', plus any stages that actually have pages.
  const activeChips = buckets.filter((b) => b.key === 'all' || b.count > 0);

  // Keep the current page visible inside the grid without scrolling ancestors,
  // computed from the cell index so it works while that cell is unmounted.
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const index = visible.findIndex((page) => page.page_number === activePageNumber);
    if (index < 0) return;
    const top = Math.floor(index / GRID_COLS) * GRID_ROW_HEIGHT;
    const bottom = top + GRID_CELL_HEIGHT;
    if (top < grid.scrollTop) grid.scrollTop = Math.max(0, top - 4);
    else if (bottom > grid.scrollTop + grid.clientHeight) {
      grid.scrollTop = bottom - grid.clientHeight + 4;
    }
  }, [activePageNumber, filter.key, open, visible.length]);

  // Windowed slice of the grid.
  const totalRows = Math.ceil(visible.length / GRID_COLS);
  const totalGridHeight = totalRows > 0 ? totalRows * GRID_ROW_HEIGHT - GRID_GAP : 0;
  const rowsInView = Math.max(1, Math.ceil((gridViewport.height || 176) / GRID_ROW_HEIGHT));
  const firstRow = Math.max(
    0,
    Math.min(Math.max(0, totalRows - 1), Math.floor(gridViewport.scrollTop / GRID_ROW_HEIGHT) - 2)
  );
  const gridStartIndex = firstRow * GRID_COLS;
  const gridEndIndex = Math.min(
    visible.length,
    gridStartIndex + (rowsInView + 4) * GRID_COLS
  );
  const gridPages = visible.slice(gridStartIndex, gridEndIndex);
  const gridOffsetTop = firstRow * GRID_ROW_HEIGHT;

  const handleJumpSubmit = (e) => {
    e.preventDefault();
    const num = parseInt(jumpPageInput.trim(), 10);
    if (!Number.isNaN(num) && num >= 1 && num <= pages.length) {
      onSelectPage(num - 1);
      setJumpPageInput('');
    }
  };

  return (
    <div className="rounded-xl border border-obsidian-700/80 bg-obsidian-900/40 overflow-hidden transition-colors">
      {/* Collapsible card header matching Project Voices and Diagnostics */}
      <button
        type="button"
        onClick={toggleOpen}
        aria-expanded={open}
        aria-controls="inspector-pages-content"
        className="w-full px-3.5 py-2.5 flex items-center justify-between text-xs font-semibold text-slate-200 hover:bg-obsidian-750/50 transition-colors cursor-pointer select-none"
      >
        <span className="flex items-center gap-2 min-w-0">
          <LayoutGrid className="w-3.5 h-3.5 text-indigo-500 dark:text-indigo-400 flex-shrink-0" />
          <span className="truncate">Pages</span>
          <span className="font-mono text-[11px] font-normal text-slate-400">
            ({pages.length})
          </span>
        </span>

        <div className="flex items-center gap-2 flex-shrink-0">
          {runningCount > 0 ? (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-indigo-600 dark:text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded-full">
              <Loader2 className="w-2.5 h-2.5 animate-spin" />
              {runningCount} running
            </span>
          ) : allComplete ? (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full">
              <Check className="w-2.5 h-2.5" />
              All ready
            </span>
          ) : null}

          {open ? (
            <ChevronDown className="w-4 h-4 text-slate-400" />
          ) : (
            <ChevronRight className="w-4 h-4 text-slate-400" />
          )}
        </div>
      </button>

      {open && (
        <div id="inspector-pages-content" className="p-3 border-t border-obsidian-700/60 space-y-2.5 bg-obsidian-850">
          {/* Filter chips & quick jump */}
          <div className="flex items-center justify-between gap-1.5 flex-wrap">
            <div role="group" aria-label="Filter pages by completed stage" className="flex items-center gap-1 flex-wrap">
              {activeChips.map((bucket) => {
                const isSelected = bucket.key === filter.key;
                return (
                  <button
                    key={bucket.key}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => setFilterKey(bucket.key)}
                    className={`inline-flex items-center gap-1 px-2.5 h-7 rounded-full text-[11px] transition-all motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 cursor-pointer ${
                      isSelected
                        ? BUCKET_ACTIVE_STYLES[bucket.key] || BUCKET_ACTIVE_STYLES.all
                        : 'bg-obsidian-750/80 text-slate-400 hover:text-slate-200 hover:bg-obsidian-700 border border-obsidian-700/60'
                    }`}
                  >
                    <span>{bucket.label}</span>
                    <span className="font-mono text-[10px] opacity-80 tabular-nums">{bucket.count}</span>
                  </button>
                );
              })}
            </div>

            {/* Quick jump to page input */}
            {pages.length > 6 && (
              <form onSubmit={handleJumpSubmit} className="flex items-center gap-1 shrink-0 ml-auto">
                <label htmlFor="jump-page-input" className="text-[10px] text-slate-400 font-medium">
                  Go:
                </label>
                <input
                  id="jump-page-input"
                  type="text"
                  inputMode="numeric"
                  placeholder={`1-${pages.length}`}
                  value={jumpPageInput}
                  onChange={(e) => setJumpPageInput(e.target.value)}
                  className="w-16 h-7 px-1.5 text-center font-mono text-[11px] rounded-md border border-obsidian-700 bg-obsidian-900 text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                />
              </form>
            )}
          </div>

          {/* Page cells grid */}
          <div
            ref={gridRef}
            className="relative max-h-[16.5rem] overflow-y-auto p-0.5 pr-1 overscroll-contain scroll-slim [overflow-anchor:none]"
          >
            {visible.length === 0 ? (
              <p className="py-6 text-center text-xs text-slate-400">No pages in this stage.</p>
            ) : (
              <div className="relative w-full" style={{ height: totalGridHeight }}>
                <div
                  className="grid grid-cols-6 gap-1.5"
                  style={{ transform: `translateY(${gridOffsetTop}px)` }}
                >
                  {gridPages.map((page) => {
                    const isActive = page.page_number === activePageNumber;
                    const done = pageStages(page);
                    const level = pageLevel(page);
                    const running = isPageRunning(page, activeRuns, stages);
                    const runningStage = running ? runningStageFor(page, activeRuns, stages) : null;
                    const isError = page.status === 'error';

                    const tone = isError
                      ? ERROR_STYLE
                      : running
                      ? RUNNING_STYLES[runningStage] || LEVEL_STYLES[level]
                      : LEVEL_STYLES[level];

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
                        className={`relative flex h-9 flex-col items-center justify-center rounded-lg border px-1 text-[11px] font-mono tabular-nums transition-all motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 cursor-pointer ${tone} ${
                          isActive
                            ? 'ring-2 ring-indigo-600 dark:ring-indigo-400 ring-offset-1 ring-offset-obsidian-850 font-bold z-10 shadow-xs'
                            : ''
                        }`}
                      >
                        <span className="flex items-center gap-0.5 leading-none font-medium">
                          {page.page_number + 1}
                          {running ? (
                            <Loader2 className="w-2.5 h-2.5 animate-spin text-indigo-600 dark:text-indigo-400" aria-hidden="true" />
                          ) : isError ? (
                            <AlertCircle className="w-2.5 h-2.5 text-rose-500 dark:text-rose-400" aria-hidden="true" />
                          ) : done.audio ? (
                            <Check className="w-2.5 h-2.5 text-emerald-600 dark:text-emerald-400 stroke-[2.5]" aria-hidden="true" />
                          ) : null}
                        </span>
                        <MicroStageBars done={done} isRunning={running} runningStage={runningStage} />
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Clean Legend & Action Hint */}
          <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-obsidian-700/60 text-[10px]">
            <div className="flex items-center gap-2.5 text-slate-400">
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-sky-500 dark:bg-sky-400" aria-hidden="true" />
                Text
              </span>
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-violet-500 dark:bg-violet-400" aria-hidden="true" />
                Script
              </span>
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400" aria-hidden="true" />
                Audio
              </span>
            </div>

            <span
              className={`text-[10px] ${
                runningCount > 0 ? 'text-indigo-600 dark:text-indigo-400 font-medium' : 'text-slate-400'
              }`}
            >
              {runningCount > 0 ? `${runningCount} running` : 'Click to jump'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

