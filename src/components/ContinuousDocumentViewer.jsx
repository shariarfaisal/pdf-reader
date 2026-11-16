import React, { useEffect, useLayoutEffect, useRef, useMemo, useCallback, useState } from 'react';
import {
  Sparkles,
  Volume2,
  Edit3,
  FileText,
  Type,
  Check,
  RotateCcw,
  Maximize2,
  ZoomIn,
  ZoomOut,
  ChevronRight,
  ScanText
} from 'lucide-react';
import { Button } from './ui/Button';
import { Tag } from './ui/Badge';
import { pageStages, isPageRunning, runningStageFor } from '../lib/pageStages';

// Vertical rhythm between sheets (was `space-y-6` before the list was windowed).
const PAGE_GAP = 24;
// Sheets rendered on each side of the active page. The reader only ever paints
// one or two sheets, so a 300 page book keeps ~9 mounted instead of 300.
const OVERSCAN = 4;
// Starting guess for a sheet that has never been laid out; refined from the
// average of every sheet measured so far.
const DEFAULT_ESTIMATE = 900;

/** Wraps the spoken sentence `span` ({ start, end } raw offsets) in `spokenClass`. */
function renderSpokenText(text, span, spokenClass, query) {
  const withSearch = (part) => (query ? renderHighlightedText(part, query) : part);
  if (!span) return withSearch(text);
  return (
    <>
      {withSearch(text.slice(0, span.start))}
      <span className={spokenClass}>{withSearch(text.slice(span.start, span.end))}</span>
      {withSearch(text.slice(span.end))}
    </>
  );
}

function renderHighlightedText(text, query) {
  const q = (query || '').trim();
  if (!q) return text;
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = String(text).split(new RegExp(`(${escaped})`, 'gi'));
  if (parts.length <= 1) return text;
  return parts.map((part, i) =>
    part.toLowerCase() === q.toLowerCase() ? (
      <mark key={i} className="bg-amber-400/35 text-current rounded px-0.5">
        {part}
      </mark>
    ) : (
      part
    )
  );
}

/**
 * One page sheet of the continuous reader.
 *
 * Memoised on purpose: without it every page change re-rendered the whole
 * mounted window, which is what made scrolling feel like it stalled.
 */
function PageArticle({
  projectId,
  page,
  totalPages,
  isActive,
  runningStage,
  viewMode,
  readerSettings,
  canvasZoom,
  activeParagraphIndex,
  activeSpan,
  defaultFontClass,
  lineHeightVal,
  highlightClass,
  spokenClass,
  sheetThemeClass,
  searchQuery,
  onEditPageText,
  onRefinePage,
  onSynthesizePage,
  onRegeneratePage,
  onOcrPage
}) {
  const stages = pageStages(page);
  const isCustom = page.page_type === 'custom';
  const isOcrRunning = runningStage === 'ocr';
  const isRefineRunning = runningStage === 'refine';
  const isAudioRunning = runningStage === 'audio';

  const text = viewMode === 'raw' ? page.raw_text : page.refined_text;
  const paragraphs = (text || '').split('\n\n').filter(Boolean);

  return (
    <article
      data-page-number={page.page_number}
      className={`pdf-page-sheet ${sheetThemeClass} rounded-xl transition-all duration-150 overflow-hidden w-full ${
        isActive ? 'border-indigo-500/80 ring-1 ring-indigo-500/30' : 'hover:border-obsidian-600'
      }`}
    >
      {/* Page Sheet Header */}
      <header className="px-5 py-2.5 bg-[var(--sheet-header-bg)] border-b border-[var(--sheet-border)] flex items-center justify-between gap-3 text-xs flex-wrap">
        <div className="flex items-center gap-2">
          <span className="font-semibold tracking-tight flex items-center gap-1.5 text-[var(--sheet-text)]">
            {isActive && (
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 flex-shrink-0" aria-hidden="true" />
            )}
            <span>Page {page.page_number + 1}</span>
            <span className="text-[var(--sheet-muted)] font-normal">of {totalPages}</span>
          </span>

          {page.audio_duration > 0 && (
            <span className="text-[11px] font-mono tabular-nums text-[var(--sheet-muted)]">
              {Math.round(page.audio_duration)}s
            </span>
          )}

          {isCustom ? (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20">
              Custom Page
            </span>
          ) : null}

          {/* Stage readiness tags */}
          <div className="hidden sm:flex items-center gap-1.5 ml-2">
            {stages.audio ? (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded status-pill-success border">
                Audio ready
              </span>
            ) : stages.refine ? (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded status-pill-info border">
                Narration ready
              </span>
            ) : stages.ocr ? (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded text-[var(--sheet-muted)] border border-[var(--sheet-border)]">
                Text extracted
              </span>
            ) : (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded text-[var(--sheet-muted)] border border-[var(--sheet-border)]">
                Pending
              </span>
            )}
          </div>
        </div>

        {/* Page Quick Actions: Edit, OCR, Narration, Audio */}
        <div className="flex items-center gap-1.5">
          {viewMode !== 'canvas' && (
            <Button
              variant="ghost"
              size="xs"
              icon={Edit3}
              onClick={() => onEditPageText?.(page.page_number, viewMode, text)}
              title="Edit text for this page"
              className="text-[var(--sheet-muted)] hover:text-[var(--sheet-text)]"
            >
              Edit
            </Button>
          )}

          {/* 1. OCR / Extract text action:
              - If OCR has NOT run on this page: prominent "Extract text" button
              - If OCR has run and user is on "raw" tab: ghost "Re-extract text" button */}
          {!stages.ocr ? (
            <Button
              variant="secondary"
              size="xs"
              isLoading={isOcrRunning}
              icon={ScanText}
              onClick={() => {
                if (onOcrPage) onOcrPage(page.page_number);
                else if (onRegeneratePage) onRegeneratePage(page.page_number, 'ocr');
              }}
              title="Run OCR to extract text for this page"
            >
              {isOcrRunning ? 'Extracting text...' : 'Extract text'}
            </Button>
          ) : (
            viewMode === 'raw' && (
              <Button
                variant="ghost"
                size="xs"
                isLoading={isOcrRunning}
                icon={ScanText}
                onClick={() => {
                  if (onRegeneratePage) onRegeneratePage(page.page_number, 'ocr');
                  else if (onOcrPage) onOcrPage(page.page_number);
                }}
                title="Re-run OCR for this page"
                className="text-[var(--sheet-muted)] hover:text-[var(--sheet-text)] hidden sm:inline-flex"
              >
                {isOcrRunning ? 'Extracting...' : 'Re-extract text'}
              </Button>
            )
          )}

          {/* 2. Prepare / Regenerate Narration:
              - If OCR done and narration not prepared yet: prominent "Prepare narration"
              - If narration already prepared: ghost "Regen narration" */}
          {stages.ocr && !stages.refine && (
            <Button
              variant="secondary"
              size="xs"
              isLoading={isRefineRunning}
              icon={Sparkles}
              onClick={() => {
                if (onRegeneratePage) onRegeneratePage(page.page_number, 'narration');
                else onRefinePage?.(page.page_number);
              }}
              title="Prepare narration for this page"
            >
              {isRefineRunning ? 'Preparing...' : 'Prepare narration'}
            </Button>
          )}

          {stages.ocr && stages.refine && (
            <Button
              variant="ghost"
              size="xs"
              isLoading={isRefineRunning}
              icon={Sparkles}
              onClick={() => {
                if (onRegeneratePage) onRegeneratePage(page.page_number, 'narration');
                else onRefinePage?.(page.page_number);
              }}
              title="Regenerate narration & audio for this page"
              className="text-[var(--sheet-muted)] hover:text-[var(--sheet-text)] hidden sm:inline-flex"
            >
              {isRefineRunning ? 'Preparing...' : 'Regen narration'}
            </Button>
          )}

          {/* 3. Generate / Regenerate Audio: always available once narration exists */}
          {stages.refine && (
            <Button
              variant={stages.audio ? 'ghost' : 'secondary'}
              size="xs"
              isLoading={isAudioRunning}
              icon={Volume2}
              onClick={() => {
                if (onRegeneratePage) onRegeneratePage(page.page_number, 'audio');
                else onSynthesizePage?.(page.page_number);
              }}
              title={stages.audio ? 'Regenerate audio for this page' : 'Generate audio for this page'}
              className={stages.audio ? 'text-[var(--sheet-muted)] hover:text-[var(--sheet-text)]' : ''}
            >
              {isAudioRunning ? 'Generating...' : stages.audio ? 'Regen audio' : 'Generate audio'}
            </Button>
          )}
        </div>
      </header>

      {/* Page Sheet Content Body: generous responsive padding without unnecessary gutters */}
      <div className="p-5 sm:p-7 md:p-9">
        {/* 1. Original PDF Canvas View */}
        {viewMode === 'canvas' ? (
          <div className="flex flex-col items-center justify-center">
            {isCustom ? (
              <div className="w-full max-w-xl p-8 rounded-xl border border-dashed border-obsidian-700 bg-obsidian-850 text-center space-y-2">
                <Type className="w-7 h-7 text-indigo-500 mx-auto mb-2" />
                <h4 className="text-sm font-semibold text-slate-100">
                  Custom Text Page (No PDF Canvas)
                </h4>
                <p className="text-xs text-slate-400 leading-relaxed max-w-sm mx-auto">
                  This is an inserted custom page. Switch to the <strong>Narration</strong> tab to view or edit the text.
                </p>
              </div>
            ) : (
              <div
                className="transition-transform duration-150 origin-top flex items-center justify-center max-w-full"
                style={{
                  transform: `scale(${canvasZoom / 100})`
                }}
              >
                <img
                  src={`/api/projects/${projectId}/pages/${page.page_number}/preview?v=${page.updated_at || 0}`}
                  alt={`Page ${page.page_number + 1}`}
                  loading="lazy"
                  className="rounded-lg shadow-sm max-w-full h-auto object-contain border border-obsidian-700/60"
                />
              </div>
            )}
          </div>
        ) : (
          /* 2. Narration or Extracted Text View */
          <div
            className={`space-y-5 leading-relaxed select-text ${defaultFontClass}`}
            style={{
              fontSize: `${readerSettings?.fontSize || 18}px`,
              lineHeight: lineHeightVal
            }}
          >
            {paragraphs.length > 0 ? (
              paragraphs.map((para, pIdx) => {
                const isSpeakingPara = isActive && activeParagraphIndex === pIdx;
                // Sentence being spoken; without sync marks the whole paragraph is highlighted.
                const spokenSpan = isSpeakingPara && activeSpan ? activeSpan : null;
                // Multilingual script detection
                const isArabic = /[\u0600-\u06FF]/.test(para);
                const isBengali = /[\u0980-\u09FF]/.test(para);

                const scriptClass = isArabic
                  ? 'font-arabic-reading text-right'
                  : isBengali
                  ? 'font-bengali-reading'
                  : defaultFontClass;

                return (
                  <p
                    key={pIdx}
                    dir={isArabic ? 'rtl' : 'ltr'}
                    className={`transition-all duration-150 rounded-md px-3 py-1.5 [overflow-wrap:anywhere] ${scriptClass} ${
                      isSpeakingPara && !spokenSpan
                        ? `${highlightClass} font-medium`
                        : 'text-[var(--sheet-text)]'
                    }`}
                  >
                    {renderSpokenText(para, spokenSpan, spokenClass, searchQuery)}
                  </p>
                );
              })
            ) : (
              <div className="py-12 text-center space-y-3">
                <FileText className="w-8 h-8 text-[var(--sheet-muted)] mx-auto" />
                <p className="text-sm text-[var(--sheet-muted)]">
                  {viewMode === 'raw'
                    ? 'No text extracted for this page yet.'
                    : 'Narration script has not been prepared for this page yet.'}
                </p>

                {/* Raw tab empty state: button to run OCR */}
                {viewMode === 'raw' && !page.raw_text && (
                  <Button
                    variant="secondary"
                    size="sm"
                    isLoading={isOcrRunning}
                    icon={ScanText}
                    onClick={() => {
                      if (onOcrPage) onOcrPage(page.page_number);
                      else if (onRegeneratePage) onRegeneratePage(page.page_number, 'ocr');
                    }}
                  >
                    {isOcrRunning ? 'Extracting text...' : 'Extract text'}
                  </Button>
                )}

                {/* Narration tab empty state: if raw text exists, prepare narration */}
                {viewMode === 'refined' && page.raw_text && (
                  <Button
                    variant="secondary"
                    size="sm"
                    isLoading={isRefineRunning}
                    icon={Sparkles}
                    onClick={() => {
                      if (onRegeneratePage) onRegeneratePage(page.page_number, 'narration');
                      else onRefinePage?.(page.page_number);
                    }}
                  >
                    {isRefineRunning ? 'Preparing narration...' : 'Prepare narration'}
                  </Button>
                )}

                {/* Narration tab empty state: if raw text does not exist yet */}
                {viewMode === 'refined' && !page.raw_text && (
                  <div className="space-y-2">
                    <p className="text-xs text-[var(--sheet-muted)]">
                      Raw text must be extracted before preparing narration.
                    </p>
                    <Button
                      variant="secondary"
                      size="sm"
                      isLoading={isOcrRunning}
                      icon={ScanText}
                      onClick={() => {
                        if (onOcrPage) onOcrPage(page.page_number);
                        else if (onRegeneratePage) onRegeneratePage(page.page_number, 'ocr');
                      }}
                    >
                      {isOcrRunning ? 'Extracting text...' : 'Extract text first'}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

/**
 * Callbacks are re-created by the parent on every render but are semantically
 * stable, so they are deliberately not part of the comparison.
 */
function areArticlePropsEqual(prev, next) {
  return (
    prev.projectId === next.projectId &&
    prev.page === next.page &&
    prev.totalPages === next.totalPages &&
    prev.isActive === next.isActive &&
    prev.runningStage === next.runningStage &&
    prev.viewMode === next.viewMode &&
    prev.readerSettings === next.readerSettings &&
    prev.canvasZoom === next.canvasZoom &&
    prev.activeParagraphIndex === next.activeParagraphIndex &&
    prev.defaultFontClass === next.defaultFontClass &&
    prev.lineHeightVal === next.lineHeightVal &&
    prev.highlightClass === next.highlightClass &&
    prev.spokenClass === next.spokenClass &&
    prev.activeSpan === next.activeSpan &&
    prev.sheetThemeClass === next.sheetThemeClass &&
    prev.searchQuery === next.searchQuery
  );
}

const MemoPageArticle = React.memo(PageArticle, areArticlePropsEqual);

/**
 * Wrapper that reports its laid-out height so the window can keep the scrollbar
 * (and therefore every jump) honest while only a few sheets exist in the DOM.
 */
function MeasuredPage({ pageNumber, onMeasure, registerEl, children }) {
  const ref = useRef(null);
  const setRef = useCallback(
    (el) => {
      ref.current = el;
      registerEl(pageNumber, el);
    },
    [registerEl, pageNumber]
  );

  // First layout: this is the moment the sheet replaced its estimated slot in a
  // spacer, so the parent may need to absorb the difference.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) onMeasure(pageNumber, el.offsetHeight, true);
  }, [pageNumber, onMeasure]);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    // Sheets change height after paint: images decode, fonts load, text edits.
    const observer = new ResizeObserver(() => onMeasure(pageNumber, el.offsetHeight, false));
    observer.observe(el);
    return () => observer.disconnect();
  }, [pageNumber, onMeasure]);

  return (
    <div ref={setRef} style={{ paddingBottom: PAGE_GAP }}>
      {children}
    </div>
  );
}

export function ContinuousDocumentViewer({
  project,
  pages = [],
  activePageNumber = 0,
  viewMode = 'refined', // 'refined' (Narration) | 'canvas' (Original PDF) | 'raw' (Extracted text)
  onSelectPage,
  readerSettings,
  canvasZoom = 100,
  searchQuery = '',
  playbackTime = 0,
  activeParagraphIndex = -1,
  activeSpan = null,
  onEditPageText,
  onRefinePage,
  onSynthesizePage,
  onRegeneratePage,
  onOcrPage,
  activeRuns = null,
  stages: pipelineStages = {}
}) {
  const containerRef = useRef(null);
  // page number -> mounted sheet element / its measured height (gap included).
  const pageEls = useRef({});
  const heightsRef = useRef(new Map());
  const estimateRef = useRef(DEFAULT_ESTIMATE);

  // Mounted slice of the book, as page numbers.
  const [range, setRange] = useState({ start: 0, end: OVERSCAN * 2 });
  // Range of the previous commit, so a mounting sheet can tell whether it just
  // replaced an estimated slot in the top spacer.
  const prevRangeRef = useRef({ start: 0, end: OVERSCAN * 2 });

  // Page we are deliberately scrolling to. While set, scroll events are not
  // user scrolling: reading them re-selected whatever page was flying past and
  // cancelled the jump, which is why long jumps stopped in the middle.
  const programmaticTargetRef = useRef(null);
  const settleTimerRef = useRef(null);
  const scrollRafRef = useRef(0);
  // A jump whose target sheet is not mounted yet; performed after it mounts.
  const pendingJumpRef = useRef(null);
  // Last scroll offset seen, used to tell a finished animation from a running one.
  const settleWatchRef = useRef(0);
  // Set when the active page changed *because* the reader scrolled, so the
  // follow-active-page effect never fights the user's own scrolling.
  const scrolledByUserRef = useRef(false);

  // Font styling for Bengali, Arabic, Serif, Mono, or Sans
  const defaultFontClass = useMemo(() => {
    switch (readerSettings?.fontFamily) {
      case 'bengali':
        return 'font-bengali-reading';
      case 'arabic':
        return 'font-arabic-reading';
      case 'serif':
        return 'font-serif-reading';
      case 'mono':
        return 'font-mono';
      case 'sans':
      default:
        return 'font-sans';
    }
  }, [readerSettings?.fontFamily]);

  const lineHeightVal = useMemo(() => {
    switch (readerSettings?.lineHeight) {
      case 'compact':
        return 1.55;
      case 'relaxed':
        return 2.15;
      case 'comfortable':
      default:
        return 1.85;
    }
  }, [readerSettings?.lineHeight]);

  const contentWidthClass = useMemo(() => {
    if (viewMode === 'canvas') return 'max-w-5xl';
    switch (readerSettings?.contentWidth) {
      case 'compact':
        return 'max-w-2xl';
      case 'full':
        return 'max-w-5xl';
      case 'reading':
      default:
        return 'max-w-3xl';
    }
  }, [viewMode, readerSettings?.contentWidth]);

  const sheetThemeClass = useMemo(() => {
    const t = readerSettings?.theme || 'paper';
    return `sheet-theme-${t}`;
  }, [readerSettings?.theme]);

  const highlightClass = useMemo(() => {
    switch (readerSettings?.highlightStyle) {
      case 'warm':
        return 'reader-highlight-warm';
      case 'glow':
        return 'reader-highlight-glow';
      case 'subtle':
      default:
        return 'reader-highlight-subtle';
    }
  }, [readerSettings?.highlightStyle]);

  const spokenClass = useMemo(() => {
    switch (readerSettings?.highlightStyle) {
      case 'warm':
        return 'reader-spoken reader-spoken-warm';
      case 'glow':
        return 'reader-spoken reader-spoken-glow';
      case 'subtle':
      default:
        return 'reader-spoken reader-spoken-subtle';
    }
  }, [readerSettings?.highlightStyle]);

  // Reader canvas theme class: avoids black gutters in light mode
  const canvasThemeClass = useMemo(() => {
    const t = readerSettings?.theme;
    if (t === 'obsidian') return 'reader-theme-obsidian';
    if (t === 'midnight') return 'reader-theme-midnight';
    if (t === 'sepia') return 'reader-theme-sepia';
    if (t === 'oled') return 'reader-theme-oled';
    return 'bg-app text-slate-100'; // Default inherits semantic app theme
  }, [readerSettings?.theme]);

  const lastPageNumber = pages.length > 0 ? pages[pages.length - 1].page_number : 0;

  const windowFor = useCallback(
    (pageNumber) => ({
      start: Math.max(0, pageNumber - OVERSCAN),
      end: Math.min(lastPageNumber, pageNumber + OVERSCAN)
    }),
    [lastPageNumber]
  );

  const registerEl = useCallback((pageNumber, el) => {
    if (el) pageEls.current[pageNumber] = el;
    else delete pageEls.current[pageNumber];
  }, []);

  const clearProgrammaticTarget = useCallback(() => {
    programmaticTargetRef.current = null;
    if (settleTimerRef.current) {
      clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
  }, []);

  // Drop the guard once the requested page sits at the top of the pane, nudging
  // it into place if a sheet above was measured after the scroll finished.
  const watchSettle = useCallback(() => {
    if (settleWatchRef.current) cancelAnimationFrame(settleWatchRef.current);
    settleWatchRef.current = 0;
    let lastTop = null;
    let stableFrames = 0;
    let frames = 0;

    const tick = () => {
      settleWatchRef.current = 0;
      const container = containerRef.current;
      const target = programmaticTargetRef.current;
      if (!container || target === null) return;

      const el = pageEls.current[target];
      if (!el) {
        clearProgrammaticTarget();
        return;
      }

      const delta = el.getBoundingClientRect().top - container.getBoundingClientRect().top;
      if (Math.abs(delta) <= 1) {
        clearProgrammaticTarget();
        return;
      }

      stableFrames = lastTop !== null && Math.abs(container.scrollTop - lastTop) < 0.5 ? stableFrames + 1 : 0;
      lastTop = container.scrollTop;

      if (stableFrames >= 2 && Math.abs(delta) <= 80) {
        container.scrollTop += delta;
        clearProgrammaticTarget();
        return;
      }

      // Give up on a target that cannot be reached (last page clamped by the end
      // of the document) instead of watching forever.
      if (++frames > 240) {
        clearProgrammaticTarget();
        return;
      }
      settleWatchRef.current = requestAnimationFrame(tick);
    };

    settleWatchRef.current = requestAnimationFrame(tick);
  }, [clearProgrammaticTarget]);

  // Scroll a mounted sheet to the top of the pane.
  const performScroll = useCallback(
    (pageNumber, behavior) => {
      const container = containerRef.current;
      const el = pageEls.current[pageNumber];
      if (!container || !el) return;

      // Exact landing, independent of any offsetParent: measure where the sheet
      // is right now and scroll by that distance.
      const delta = el.getBoundingClientRect().top - container.getBoundingClientRect().top;
      // Long jumps are instant: animating 100k px takes seconds and lands
      // nowhere useful, so only nearby pages glide.
      const mode = behavior || (Math.abs(delta) > container.clientHeight * 2 ? 'auto' : 'smooth');

      programmaticTargetRef.current = pageNumber;
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
      settleTimerRef.current = setTimeout(clearProgrammaticTarget, 2500);

      container.scrollTo({ top: Math.max(0, container.scrollTop + delta), behavior: mode });
      watchSettle();
    },
    [clearProgrammaticTarget, watchSettle]
  );

  // Show a page: mount it if needed, then park it at the top of the pane.
  const showPage = useCallback(
    (pageNumber, behavior) => {
      const container = containerRef.current;
      const el = pageEls.current[pageNumber];

      if (container && el) {
        const containerRect = container.getBoundingClientRect();
        const rect = el.getBoundingClientRect();
        // Already parked near the top: nothing to do (a partially visible sheet
        // would otherwise look like a jump that does nothing).
        const parked = rect.top >= containerRect.top - 8 && rect.top <= containerRect.top + container.clientHeight * 0.4;
        if (!parked) performScroll(pageNumber, behavior);
        return;
      }

      pendingJumpRef.current = { page: pageNumber, behavior };
      setRange(windowFor(pageNumber));
    },
    [performScroll, windowFor]
  );

  // Keep the mounted slice centred on the active page.
  useEffect(() => {
    const next = windowFor(activePageNumber);
    setRange((prev) => (prev.start === next.start && prev.end === next.end ? prev : next));
  }, [activePageNumber, windowFor]);

  // Follow the active page when it changed from outside (sidebar, prev/next,
  // audio sync). Skipped when the change came from the user scrolling.
  useEffect(() => {
    if (scrolledByUserRef.current) {
      scrolledByUserRef.current = false;
      return;
    }
    showPage(activePageNumber);
  }, [activePageNumber, pages.length, showPage]);

  // View mode and typography changes rewrite the height of every sheet at once,
  // so the browser cannot anchor: keep the active page where the reader left it.
  useLayoutEffect(() => {
    const container = containerRef.current;
    const el = pageEls.current[activePageNumber];
    if (!container || !el) return;
    const delta = el.getBoundingClientRect().top - container.getBoundingClientRect().top;
    if (Math.abs(delta) > 4) container.scrollTop += delta;
  }, [
    viewMode,
    canvasZoom,
    readerSettings?.fontSize,
    readerSettings?.fontFamily,
    readerSettings?.lineHeight
  ]);

  // Perform a jump that had to wait for its sheet to mount.
  useLayoutEffect(() => {
    const pending = pendingJumpRef.current;
    if (pending && pageEls.current[pending.page]) {
      pendingJumpRef.current = null;
      performScroll(pending.page, pending.behavior);
    }
    prevRangeRef.current = range;
  });

  // Report a laid-out sheet height. A sheet that replaces an estimated slot in
  // the top spacer (window growing upwards) must not move the content the
  // reader is looking at, so the scroll offset absorbs the difference. Plain
  // reflows are left to the browser's own scroll anchoring.
  const handleMeasure = useCallback((pageNumber, height, anchor = false) => {
    if (!height || height <= 0) return;
    const known = heightsRef.current.get(pageNumber);
    if (known !== undefined && Math.abs(known - height) < 1) return;

    const estimateBefore = estimateRef.current;
    heightsRef.current.set(pageNumber, height);

    if (known === undefined) {
      // Refine the guess used for sheets that have never been laid out.
      let sum = 0;
      let count = 0;
      for (const value of heightsRef.current.values()) {
        sum += value;
        count += 1;
      }
      if (count > 0) estimateRef.current = Math.max(200, sum / count);
    }

    if (!anchor || known !== undefined) return;
    if (programmaticTargetRef.current !== null) return; // never fight a jump
    // Only sheets that were part of the top spacer shift the viewport.
    if (pageNumber >= prevRangeRef.current.start) return;

    const container = containerRef.current;
    if (!container) return;
    const delta = height - estimateBefore;
    if (Math.abs(delta) >= 1) container.scrollTop += delta;
  }, []);

  // Spacers stand in for the sheets that are not mounted, so the scrollbar and
  // the reachable range still describe the whole book.
  const spacers = useMemo(() => {
    const heightOf = (pageNumber) => heightsRef.current.get(pageNumber) ?? estimateRef.current;
    let top = 0;
    let bottom = 0;
    for (const page of pages) {
      if (page.page_number < range.start) top += heightOf(page.page_number);
      else if (page.page_number > range.end) bottom += heightOf(page.page_number);
    }
    return { top, bottom };
  }, [pages, range.start, range.end]);

  // Structural changes (insert / delete) re-index pages, so cached heights no
  // longer describe the page they were keyed by.
  useEffect(() => {
    heightsRef.current.clear();
    estimateRef.current = DEFAULT_ESTIMATE;
  }, [pages.length]);

  // Detect which page is currently in view during scroll
  const handleScroll = useCallback(() => {
    if (scrollRafRef.current) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = 0;
      const container = containerRef.current;
      if (!container) return;

      // Our own scroll is in flight: never reinterpret it as user scrolling.
      if (programmaticTargetRef.current !== null) return;

      const containerRect = container.getBoundingClientRect();
      const probeY = containerRect.top + container.clientHeight * 0.35;

      let bestPage = activePageNumber;
      let bestDistance = Infinity;
      let firstTop = null;
      let lastBottom = null;

      for (const page of pages) {
        const el = pageEls.current[page.page_number];
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        if (firstTop === null) firstTop = rect.top;
        lastBottom = rect.bottom;
        if (rect.top <= probeY && rect.bottom >= probeY) {
          bestPage = page.page_number;
          bestDistance = 0;
          break;
        }
        const distance = Math.min(Math.abs(rect.top - probeY), Math.abs(rect.bottom - probeY));
        if (distance < bestDistance) {
          bestDistance = distance;
          bestPage = page.page_number;
        }
      }

      // Flinging faster than the window can follow: re-centre it on the page the
      // viewport has actually reached and let the next frame detect precisely.
      const stride = estimateRef.current || DEFAULT_ESTIMATE;
      if (firstTop !== null && probeY > lastBottom + stride) {
        const ahead = Math.ceil((probeY - lastBottom) / stride);
        setRange(windowFor(Math.min(lastPageNumber, range.end + ahead)));
        return;
      }
      if (firstTop !== null && probeY < firstTop - stride) {
        const behind = Math.ceil((firstTop - probeY) / stride);
        setRange(windowFor(Math.max(0, range.start - behind)));
        return;
      }

      if (bestPage !== activePageNumber) {
        scrolledByUserRef.current = true;
        onSelectPage?.(bestPage);
      }
    });
  }, [
    pages,
    activePageNumber,
    onSelectPage,
    windowFor,
    range.start,
    range.end,
    lastPageNumber
  ]);

  // Release the rAF handles and the settle timer on unmount.
  useEffect(
    () => () => {
      if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current);
      if (settleWatchRef.current) cancelAnimationFrame(settleWatchRef.current);
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    },
    []
  );

  const mountedPages = useMemo(
    () => pages.filter((page) => page.page_number >= range.start && page.page_number <= range.end),
    [pages, range.start, range.end]
  );

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className={`flex-1 overflow-y-auto overflow-x-hidden p-2 sm:p-4 md:p-6 transition-colors duration-150 [overflow-anchor:none] ${canvasThemeClass}`}
    >
      {/* Reading measure controlled by ReaderCustomizer contentWidth setting */}
      <div className={`mx-auto pb-24 w-full ${contentWidthClass}`}>
        <div style={{ height: spacers.top }} aria-hidden="true" />

        {mountedPages.map((page) => {
          const pageRunning = isPageRunning(page, activeRuns, pipelineStages);
          const runningStage = pageRunning ? runningStageFor(page, activeRuns, pipelineStages) : null;

          return (
            <MeasuredPage
              key={page.id || page.page_number}
              pageNumber={page.page_number}
              onMeasure={handleMeasure}
              registerEl={registerEl}
            >
              <MemoPageArticle
                projectId={project.id}
                page={page}
                totalPages={pages.length}
                isActive={page.page_number === activePageNumber}
                runningStage={runningStage}
                viewMode={viewMode}
                readerSettings={readerSettings}
                canvasZoom={canvasZoom}
                activeParagraphIndex={activeParagraphIndex}
                activeSpan={page.page_number === activePageNumber ? activeSpan : null}
                defaultFontClass={defaultFontClass}
                lineHeightVal={lineHeightVal}
                highlightClass={highlightClass}
                spokenClass={spokenClass}
                sheetThemeClass={sheetThemeClass}
                searchQuery={searchQuery}
                onEditPageText={onEditPageText}
                onRefinePage={onRefinePage}
                onSynthesizePage={onSynthesizePage}
                onRegeneratePage={onRegeneratePage}
                onOcrPage={onOcrPage}
              />
            </MeasuredPage>
          );
        })}

        <div style={{ height: spacers.bottom }} aria-hidden="true" />
      </div>
    </div>
  );
}
