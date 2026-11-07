import React, { useEffect, useRef, useMemo, useCallback } from 'react';
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
  Loader2
} from 'lucide-react';
import { Button } from './ui/Button';
import { Tag } from './ui/Badge';
import { pageStages } from '../lib/pageStages';

export function ContinuousDocumentViewer({
  project,
  pages = [],
  activePageNumber = 0,
  viewMode = 'refined', // 'refined' | 'canvas' | 'raw'
  onSelectPage,
  readerSettings,
  canvasZoom = 100,
  playbackTime = 0,
  activeParagraphIndex = -1,
  activeMark = null,
  onEditPageText,
  onRefinePage,
  onSynthesizePage
}) {
  const containerRef = useRef(null);
  const pageRefs = useRef({});
  const isProgrammaticScroll = useRef(false);
  const scrollTimeoutRef = useRef(null);

  // Font styling for Bengali, Arabic, Serif, or Sans
  const readingFontClass = useMemo(() => {
    switch (readerSettings?.fontFamily) {
      case 'bengali':
        return 'font-bengali-reading';
      case 'arabic':
        return 'font-arabic-reading';
      case 'serif':
        return 'font-serif-reading';
      case 'sans':
      default:
        return 'font-sans';
    }
  }, [readerSettings?.fontFamily]);

  const lineHeightVal = useMemo(() => {
    switch (readerSettings?.lineHeight) {
      case 'relaxed':
        return 1.9;
      case 'loose':
        return 2.2;
      case 'normal':
      default:
        return 1.65;
    }
  }, [readerSettings?.lineHeight]);

  const highlightClass = useMemo(() => {
    switch (readerSettings?.highlightStyle) {
      case 'subtle':
        return 'reader-highlight-subtle';
      case 'warm':
        return 'reader-highlight-warm';
      case 'glow':
      default:
        return 'reader-highlight-glow';
    }
  }, [readerSettings?.highlightStyle]);

  // Programmatic smooth scroll to active page when changed from outside (e.g. left sidebar or audio track next)
  const scrollToPage = useCallback((pageNum, behavior = 'smooth') => {
    const el = pageRefs.current[pageNum];
    if (!el || !containerRef.current) return;

    isProgrammaticScroll.current = true;
    el.scrollIntoView({ behavior, block: 'start' });

    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    scrollTimeoutRef.current = setTimeout(() => {
      isProgrammaticScroll.current = false;
    }, 600);
  }, []);

  // Listen to activePageNumber changes and scroll to it if not triggered by manual scroll
  useEffect(() => {
    if (!isProgrammaticScroll.current) {
      // If the page was selected by clicking the sidebar or audio advancing, scroll to it
      const el = pageRefs.current[activePageNumber];
      if (el && containerRef.current) {
        const container = containerRef.current;
        const rect = el.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();

        // Check if page is already visible
        const isVisible =
          rect.top >= containerRect.top - 100 &&
          rect.bottom <= containerRect.bottom + 100;

        if (!isVisible) {
          scrollToPage(activePageNumber, 'smooth');
        }
      }
    }
  }, [activePageNumber, scrollToPage]);

  // Detect which page is currently in view during natural scroll
  const handleScroll = useCallback(() => {
    if (isProgrammaticScroll.current || !containerRef.current) return;

    const container = containerRef.current;
    const containerTop = container.scrollTop;
    const containerHeight = container.clientHeight;
    const targetOffset = containerTop + containerHeight * 0.35;

    let bestPage = activePageNumber;
    let minDistance = Infinity;

    for (let i = 0; i < pages.length; i++) {
      const el = pageRefs.current[i];
      if (!el) continue;
      const elTop = el.offsetTop;
      const dist = Math.abs(elTop - targetOffset);
      if (dist < minDistance) {
        minDistance = dist;
        bestPage = i;
      }
    }

    if (bestPage !== activePageNumber) {
      onSelectPage?.(bestPage);
    }
  }, [pages.length, activePageNumber, onSelectPage]);

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className={`flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-8 md:p-12 transition-colors duration-200 ${
        readerSettings?.theme ? `reader-theme-${readerSettings.theme}` : 'bg-obsidian-950'
      }`}
      style={{
        scrollBehavior: 'smooth'
      }}
    >
      <div className="max-w-4xl mx-auto space-y-12 pb-32">
        {pages.map((page, index) => {
          const isActive = page.page_number === activePageNumber;
          const stages = pageStages(page);
          const isCustom = page.page_type === 'custom';

          // Get text based on view mode
          const text = viewMode === 'raw' ? page.raw_text : page.refined_text;
          const paragraphs = (text || '').split('\n\n').filter(Boolean);

          return (
            <section
              key={page.id || page.page_number}
              ref={(el) => {
                if (el) pageRefs.current[page.page_number] = el;
              }}
              data-page-number={page.page_number}
              className={`pdf-page-sheet rounded-2xl bg-obsidian-900 border transition-all duration-200 overflow-hidden ${
                isActive
                  ? 'border-brand-500/80 shadow-lg shadow-brand-500/10'
                  : 'border-obsidian-750/70 hover:border-obsidian-600'
              }`}
            >
              {/* Page Sheet Header */}
              <header className="px-6 py-3.5 bg-obsidian-850/90 border-b border-obsidian-750 flex items-center justify-between gap-3 text-xs flex-wrap">
                <div className="flex items-center gap-2.5">
                  <span
                    className={`font-semibold tracking-wide flex items-center gap-1.5 ${
                      isActive ? 'text-brand-400' : 'text-slate-300'
                    }`}
                  >
                    <span>Page {page.page_number + 1}</span>
                    <span className="text-slate-500 font-normal">of {pages.length}</span>
                  </span>

                  {isCustom ? (
                    <Tag tone="purple" size="xs">
                      Custom Page
                    </Tag>
                  ) : (
                    <Tag tone="slate" size="xs">
                      PDF Page
                    </Tag>
                  )}

                  {/* Stage indicator pills */}
                  <div className="hidden sm:flex items-center gap-1 ml-2">
                    {stages.ocr && (
                      <span className="inline-flex items-center gap-1 text-[10px] text-sky-400 px-1.5 py-0.5 rounded bg-sky-500/10 border border-sky-500/20">
                        OCR
                      </span>
                    )}
                    {stages.refine && (
                      <span className="inline-flex items-center gap-1 text-[10px] text-violet-400 px-1.5 py-0.5 rounded bg-violet-500/10 border border-violet-500/20">
                        Refined
                      </span>
                    )}
                    {stages.audio && (
                      <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20">
                        Audio
                      </span>
                    )}
                  </div>
                </div>

                {/* Page Quick Actions */}
                <div className="flex items-center gap-1.5">
                  {viewMode !== 'canvas' && (
                    <Button
                      variant="ghost"
                      size="xs"
                      icon={Edit3}
                      onClick={() => onEditPageText?.(page.page_number, viewMode, text)}
                      title="Edit text for this page"
                    >
                      Edit
                    </Button>
                  )}

                  {viewMode === 'raw' && !stages.refine && (
                    <Button
                      variant="secondary"
                      size="xs"
                      icon={Sparkles}
                      onClick={() => onRefinePage?.(page.page_number)}
                      title="Refine narration script for this page"
                    >
                      Refine
                    </Button>
                  )}

                  {viewMode === 'refined' && stages.refine && !stages.audio && (
                    <Button
                      variant="secondary"
                      size="xs"
                      icon={Volume2}
                      onClick={() => onSynthesizePage?.(page.page_number)}
                      title="Synthesize audio for this page"
                    >
                      Generate Audio
                    </Button>
                  )}
                </div>
              </header>

              {/* Page Sheet Content Body */}
              <div className="p-6 sm:p-10 md:p-12">
                {/* 1. Main PDF Canvas View */}
                {viewMode === 'canvas' ? (
                  <div className="flex flex-col items-center justify-center">
                    {isCustom ? (
                      <div className="w-full max-w-2xl p-8 rounded-xl border border-dashed border-purple-500/30 bg-purple-500/5 text-center space-y-3">
                        <Type className="w-8 h-8 text-purple-400 mx-auto" />
                        <h4 className="text-sm font-semibold text-slate-200">
                          Custom Text Page (No PDF Canvas)
                        </h4>
                        <p className="text-xs text-slate-400 leading-relaxed max-w-md mx-auto">
                          This is an inserted custom page. Switch to the <strong>Refined Narration</strong> tab to view or edit the text.
                        </p>
                      </div>
                    ) : (
                      <div
                        className="transition-transform duration-200 origin-top flex items-center justify-center max-w-full"
                        style={{
                          transform: `scale(${canvasZoom / 100})`
                        }}
                      >
                        <img
                          src={`/api/projects/${project.id}/pages/${page.page_number}/preview?v=${page.updated_at || 0}`}
                          alt={`Page ${page.page_number + 1}`}
                          loading="lazy"
                          className="rounded-lg shadow-md max-w-full h-auto object-contain border border-obsidian-750"
                        />
                      </div>
                    )}
                  </div>
                ) : (
                  /* 2. Refined Narration or Raw OCR View */
                  <div
                    className={`space-y-6 leading-relaxed select-text ${readingFontClass}`}
                    style={{
                      fontSize: `${readerSettings?.fontSize || 18}px`,
                      lineHeight: lineHeightVal
                    }}
                  >
                    {paragraphs.length > 0 ? (
                      paragraphs.map((para, pIdx) => {
                        const isSpeakingPara = isActive && activeParagraphIndex === pIdx;

                        return (
                          <p
                            key={pIdx}
                            className={`transition-all duration-200 rounded-lg p-2 -mx-2 ${
                              isSpeakingPara
                                ? `${highlightClass} font-medium`
                                : 'text-slate-100 hover:bg-obsidian-850/50'
                            }`}
                          >
                            {para}
                          </p>
                        );
                      })
                    ) : (
                      <div className="py-12 text-center space-y-3">
                        <FileText className="w-8 h-8 text-slate-600 mx-auto" />
                        <p className="text-sm text-slate-400">
                          {viewMode === 'raw'
                            ? 'No OCR text extracted for this page yet.'
                            : 'Narration script has not been generated for this page yet.'}
                        </p>
                        {viewMode === 'refined' && page.raw_text && (
                          <Button
                            variant="secondary"
                            size="sm"
                            icon={Sparkles}
                            onClick={() => onRefinePage?.(page.page_number)}
                          >
                            Refine Script Now
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Page Sheet Footer */}
              <footer className="px-6 py-2.5 bg-obsidian-850/50 border-t border-obsidian-750/60 flex items-center justify-between text-[11px] text-slate-500">
                <span>Page {page.page_number + 1}</span>
                {viewMode !== 'canvas' && (
                  <span>
                    {paragraphs.length} paragraphs • {(text || '').length} characters
                  </span>
                )}
              </footer>
            </section>
          );
        })}
      </div>
    </div>
  );
}
