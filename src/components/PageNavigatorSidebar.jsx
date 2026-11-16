import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Trash2,
  CheckSquare,
  Square,
  ArrowRight,
  Headphones,
  CheckCircle2,
  Clock,
  AlertCircle,
  Play,
  Pause
} from 'lucide-react';
import { Button } from './ui/Button';
import { Tag } from './ui/Badge';
import { PageThumbnail } from './ui/PageThumbnail';
import { AddPageModal } from './AddPageModal';
import { ConfirmModal } from './ui/ConfirmModal';
import { pageStages } from '../lib/pageStages';
import { useAudioPlayerOptional, EqualizerBars, formatAudioTime } from '../lib/audioPlayerContext';

// Rows are a fixed height (80px sheet + 6px rhythm), so the list can be windowed
// without measuring: a 300 page book costs ~12 rows in the DOM instead of 300.
const ROW_HEIGHT = 86;
const ROW_HEIGHT_PX = 80;
const LIST_OVERSCAN = 6;

/**
 * One page row. Memoised because a long book mounts many of them and every page
 * change would otherwise re-render the whole list.
 */
function PageRow({
  projectId,
  page,
  isActive,
  isPlayingPage,
  isAudioPlaying,
  isSelected,
  isSelectMode,
  onToggleSelect,
  onSelect,
  onPlayPage
}) {
  const stages = pageStages(page);

  // One meaningful state per Section 5.C
  let stateLabel = 'Pending';
  let stateTone = 'text-slate-400';
  let StateIcon = Clock;
  if (isPlayingPage) {
    stateLabel = isAudioPlaying ? 'Playing' : 'Paused';
    stateTone = 'text-indigo-700 dark:text-indigo-300 font-semibold';
    StateIcon = Headphones;
  } else if (stages.audio) {
    stateLabel = 'Audio ready';
    stateTone = 'text-emerald-700 dark:text-emerald-400';
    StateIcon = CheckCircle2;
  } else if (stages.refine) {
    stateLabel = 'Narration ready';
    stateTone = 'text-indigo-700 dark:text-indigo-400';
    StateIcon = Headphones;
  } else if (stages.ocr) {
    stateLabel = 'Text extracted';
    stateTone = 'text-sky-700 dark:text-sky-400';
    StateIcon = Clock;
  } else if (page.status === 'error') {
    stateLabel = 'Needs attention';
    stateTone = 'text-rose-700 dark:text-rose-400';
    StateIcon = AlertCircle;
  }

  return (
    <div
      onClick={() => {
        if (isSelectMode) onToggleSelect(page.id);
        else onSelect(page.page_number);
      }}
      className={`group relative h-[80px] mb-1.5 rounded-lg border px-2 py-1.5 flex items-center gap-2.5 cursor-pointer transition-all duration-150 ${
        isActive
          ? 'border-indigo-500/80 bg-indigo-500/10 dark:bg-indigo-500/15'
          : isSelected
          ? 'border-indigo-400/60 bg-indigo-500/5'
          : 'border-obsidian-700/60 bg-obsidian-850 hover:border-obsidian-600 hover:bg-obsidian-750'
      }`}
    >
      {/* Subtle 2.5px active edge marker */}
      {isActive && (
        <div className="absolute left-0 top-1 bottom-1 w-[2.5px] rounded-r bg-indigo-600 dark:bg-indigo-400" />
      )}

      {/* Checkbox (in select mode) */}
      {isSelectMode && (
        <div className="flex-shrink-0">
          {isSelected ? (
            <CheckSquare className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
          ) : (
            <Square className="w-4 h-4 text-slate-400" />
          )}
        </div>
      )}

      {/* 40 × 56 px Thumbnail per Section 5.C */}
      <div className="w-[40px] h-[56px] rounded overflow-hidden bg-obsidian-900 border border-obsidian-700/70 flex-shrink-0 flex items-center justify-center relative shadow-2xs">
        <PageThumbnail
          projectId={projectId}
          page={page}
          size="sm"
          className="w-full h-full object-cover"
        />
        {stages.audio && !isSelectMode && onPlayPage && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onPlayPage(page.page_number);
            }}
            title={
              isPlayingPage && isAudioPlaying
                ? `Pause page ${page.page_number + 1}`
                : `Play page ${page.page_number + 1}`
            }
            aria-label={
              isPlayingPage && isAudioPlaying
                ? `Pause page ${page.page_number + 1}`
                : `Play page ${page.page_number + 1}`
            }
            className={`absolute inset-0 flex items-center justify-center transition-opacity cursor-pointer ${
              isPlayingPage
                ? 'bg-obsidian-950/60 opacity-100 text-indigo-300'
                : 'bg-obsidian-950/50 opacity-0 group-hover:opacity-100 text-white'
            }`}
          >
            {isPlayingPage && isAudioPlaying ? (
              <Pause className="w-3.5 h-3.5 fill-current" />
            ) : (
              <Play className="w-3.5 h-3.5 fill-current translate-x-px" />
            )}
          </button>
        )}
      </div>

      {/* Page Number & One State Label */}
      <div className="flex-1 min-w-0 pr-1">
        <div className="flex items-center justify-between gap-1">
          <span
            className={`text-xs font-semibold truncate ${
              isActive ? 'text-indigo-600 dark:text-indigo-300' : 'text-slate-100'
            }`}
          >
            <span>Page {page.page_number + 1}</span>
          </span>
          {page.page_type === 'custom' ? (
            <span className="text-[9px] font-medium px-1 rounded bg-obsidian-750 text-slate-400">
              Custom
            </span>
          ) : page.audio_duration > 0 ? (
            <span className="text-[10px] font-mono text-slate-400 tabular-nums flex-shrink-0">
              {formatAudioTime(page.audio_duration)}
            </span>
          ) : null}
        </div>

        <div className={`mt-1 flex items-center gap-1 text-[11px] font-medium ${stateTone}`}>
          {isPlayingPage ? (
            <EqualizerBars isPlaying={isAudioPlaying} />
          ) : (
            <StateIcon className="w-3 h-3 flex-shrink-0" />
          )}
          <span className="truncate">{stateLabel}</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Callbacks are re-created by the parent on every render but are semantically
 * stable, so they are deliberately not part of the comparison.
 */
function areRowPropsEqual(prev, next) {
  return (
    prev.projectId === next.projectId &&
    prev.page === next.page &&
    prev.isActive === next.isActive &&
    prev.isPlayingPage === next.isPlayingPage &&
    prev.isAudioPlaying === next.isAudioPlaying &&
    prev.isSelected === next.isSelected &&
    prev.isSelectMode === next.isSelectMode
  );
}

const MemoPageRow = React.memo(PageRow, areRowPropsEqual);

export function PageNavigatorSidebar({
  project,
  pages = [],
  activePageNumber = 0,
  isOpen = true,
  onToggle,
  onSelectPage,
  onAddPage,
  onDeletePage,
  onDeletePages,
  onRegeneratePage
}) {
  const [jumpPageInput, setJumpPageInput] = useState('');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedPageIds, setSelectedPageIds] = useState(() => new Set());
  const [deleteConfirm, setDeleteConfirm] = useState({ isOpen: false, pageNumber: null, isBulk: false });
  const audioPlayer = useAudioPlayerOptional();
  const isThisBookActiveInAudio =
    Boolean(audioPlayer?.session?.isActive && audioPlayer?.session?.projectId === project?.id);
  const playingPageNumber = isThisBookActiveInAudio ? audioPlayer.session.playingPageNumber : null;
  const isAudioPlaying = Boolean(isThisBookActiveInAudio && audioPlayer?.isPlaying);

  const handlePlaySidebarPage = useCallback(
    (pageNum) => {
      if (!audioPlayer) return;
      if (isThisBookActiveInAudio && playingPageNumber === pageNum) {
        audioPlayer.togglePlay(project, pages, pageNum);
      } else {
        audioPlayer.playProjectPage(project, pages, pageNum);
      }
    },
    [audioPlayer, isThisBookActiveInAudio, playingPageNumber, project, pages]
  );

  const listContainerRef = useRef(null);
  // Windowed list viewport: rows are fixed height, so only scrollTop + height
  // are needed to decide which rows exist in the DOM.
  const [listViewport, setListViewport] = useState({ scrollTop: 0, height: 0 });

  useEffect(() => {
    const list = listContainerRef.current;
    if (!isOpen || !list) return;

    const measure = () =>
      setListViewport((prev) => {
        const next = { scrollTop: list.scrollTop, height: list.clientHeight };
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
    list.addEventListener('scroll', onScroll, { passive: true });
    let observer = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(measure);
      observer.observe(list);
    }
    return () => {
      list.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
      if (observer) observer.disconnect();
    };
  }, [isOpen]);

  // Keep the active page row visible without scrolling anything but the list
  // itself, computed from the row index so it works while the row is unmounted.
  useEffect(() => {
    if (!isOpen) return;
    const list = listContainerRef.current;
    if (!list || pages.length === 0) return;

    const index = pages.findIndex((page) => page.page_number === activePageNumber);
    if (index < 0) return;

    const rowTop = index * ROW_HEIGHT;
    const rowBottom = rowTop + ROW_HEIGHT_PX;
    const padding = 8;
    const isVisible =
      rowTop >= list.scrollTop + padding && rowBottom <= list.scrollTop + list.clientHeight - padding;
    if (isVisible) return;

    const target = rowTop - (list.clientHeight - ROW_HEIGHT_PX) / 2;
    const distance = Math.abs(target - list.scrollTop);
    list.scrollTo({
      top: Math.max(0, target),
      behavior: distance > list.clientHeight * 2 ? 'auto' : 'smooth'
    });
  }, [activePageNumber, isOpen, pages]);

  const handleJumpSubmit = (e) => {
    e.preventDefault();
    const pageNum = parseInt(jumpPageInput.trim(), 10);
    if (isNaN(pageNum) || pages.length === 0) return;
    // Clamp instead of silently ignoring an out-of-range number.
    const clamped = Math.min(Math.max(pageNum, 1), pages.length);
    onSelectPage(clamped - 1);
    setJumpPageInput('');
  };

  const toggleSelectPage = (id) => {
    setSelectedPageIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selectedPageIds.size === pages.length) {
      setSelectedPageIds(new Set());
    } else {
      setSelectedPageIds(new Set(pages.map((p) => p.id)));
    }
  };

  const handleBulkDelete = async () => {
    if (selectedPageIds.size === 0) return;
    try {
      await onDeletePages(Array.from(selectedPageIds));
      setSelectedPageIds(new Set());
      setIsSelectMode(false);
      setDeleteConfirm({ isOpen: false, pageNumber: null, isBulk: false });
    } catch (err) {
      console.error('Failed to bulk delete pages:', err);
    }
  };

  // Windowed slice of the page list (fixed row height => no measuring needed).
  const rowsInView = Math.max(1, Math.ceil((listViewport.height || 600) / ROW_HEIGHT));
  const listStartIndex = Math.min(
    Math.max(0, Math.floor((listViewport.scrollTop - 8) / ROW_HEIGHT) - LIST_OVERSCAN),
    Math.max(0, pages.length - 1)
  );
  const listEndIndex = Math.min(pages.length, listStartIndex + rowsInView + LIST_OVERSCAN * 2);
  const visiblePages = pages.slice(listStartIndex, listEndIndex);

  if (!isOpen) {
    return (
      <div className="flex-shrink-0 flex items-start p-2 border-r border-obsidian-700/80 bg-obsidian-850 z-10">
        <Button
          variant="ghost"
          size="icon-sm"
          icon={PanelLeftOpen}
          onClick={onToggle}
          title="Open page navigator"
          aria-label="Open page navigator"
        />
      </div>
    );
  }

  return (
    <aside
      className="flex-shrink-0 w-[224px] flex flex-col h-full border-r border-obsidian-700/80 bg-obsidian-850 transition-all duration-200 select-none z-10"
      aria-label="Page Navigator"
    >
      {/* Sidebar Header */}
      <div className="px-3 py-2.5 border-b border-obsidian-700/80 flex items-center justify-between gap-1.5 flex-shrink-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-xs font-semibold text-slate-100 truncate">
            Pages
          </span>
          <span className="text-[11px] font-mono text-slate-400 bg-obsidian-750 px-1.5 py-0.5 rounded">
            {pages.length}
          </span>
        </div>

        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon-xs"
            icon={Plus}
            onClick={() => setIsAddModalOpen(true)}
            title="Add page"
            aria-label="Add page"
          />
          <Button
            variant={isSelectMode ? 'secondary' : 'ghost'}
            size="icon-xs"
            icon={isSelectMode ? CheckSquare : Square}
            onClick={() => {
              setIsSelectMode(!isSelectMode);
              setSelectedPageIds(new Set());
            }}
            title={isSelectMode ? 'Cancel selection' : 'Select multiple pages'}
            aria-label={isSelectMode ? 'Cancel selection' : 'Select multiple pages'}
          />
          <Button
            variant="ghost"
            size="icon-xs"
            icon={PanelLeftClose}
            onClick={onToggle}
            title="Collapse sidebar"
            aria-label="Collapse sidebar"
          />
        </div>
      </div>

      {/* Go to page Toolbar */}
      <div className="px-2.5 py-2 border-b border-obsidian-700/60 bg-obsidian-900/60 flex items-center gap-1.5 flex-shrink-0">
        {isSelectMode ? (
          <div className="flex items-center justify-between w-full text-xs">
            <button
              type="button"
              onClick={handleSelectAll}
              className="text-indigo-600 dark:text-indigo-400 hover:underline font-medium text-[11px] cursor-pointer"
            >
              {selectedPageIds.size === pages.length ? 'Deselect all' : 'Select all'}
            </button>
            <span className="text-[11px] text-slate-400 font-mono">
              {selectedPageIds.size} selected
            </span>
          </div>
        ) : (
          <form onSubmit={handleJumpSubmit} noValidate className="flex items-center gap-1 w-full">
            <input
              type="number"
              min="1"
              max={pages.length}
              value={jumpPageInput}
              onChange={(e) => setJumpPageInput(e.target.value)}
              placeholder="Go to page…"
              aria-label="Go to page number"
              className="flex-1 h-7.5 px-2 rounded-md bg-obsidian-850 border border-obsidian-700/80 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30"
            />
            {jumpPageInput && (
              <Button
                type="submit"
                variant="ghost"
                size="icon-xs"
                icon={ArrowRight}
                title="Go to page"
              />
            )}
          </form>
        )}
      </div>

      {/* Compact Page Row List — 76-88 px rows, windowed */}
      <div
        ref={listContainerRef}
        className="flex-1 overflow-y-auto p-2 scroll-slim [overflow-anchor:none]"
      >
        <div style={{ height: listStartIndex * ROW_HEIGHT }} aria-hidden="true" />
        {visiblePages.map((page) => (
          <MemoPageRow
            key={page.id}
            projectId={project.id}
            page={page}
            isActive={page.page_number === activePageNumber}
            isPlayingPage={playingPageNumber === page.page_number}
            isAudioPlaying={playingPageNumber === page.page_number && isAudioPlaying}
            isSelected={selectedPageIds.has(page.id)}
            isSelectMode={isSelectMode}
            onToggleSelect={toggleSelectPage}
            onSelect={onSelectPage}
            onPlayPage={handlePlaySidebarPage}
          />
        ))}
        <div
          style={{ height: Math.max(0, (pages.length - listEndIndex) * ROW_HEIGHT) }}
          aria-hidden="true"
        />
      </div>

      {/* Select Mode Bulk Delete Footer */}
      {isSelectMode && selectedPageIds.size > 0 && (
        <div className="p-2 border-t border-obsidian-700/80 bg-obsidian-900/80 flex items-center justify-between gap-2">
          <Button
            variant="danger"
            size="xs"
            icon={Trash2}
            onClick={() => setDeleteConfirm({ isOpen: true, pageNumber: null, isBulk: true })}
            className="w-full"
          >
            Delete ({selectedPageIds.size})
          </Button>
        </div>
      )}

      {/* Add Page Modal */}
      <AddPageModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        totalPages={pages.length}
        activePageNumber={activePageNumber}
        onAddPage={onAddPage}
      />

      {/* Confirm Delete Modal */}
      <ConfirmModal
        isOpen={deleteConfirm.isOpen}
        onClose={() => setDeleteConfirm({ isOpen: false, pageNumber: null, isBulk: false })}
        onConfirm={handleBulkDelete}
        title={`Delete ${selectedPageIds.size} selected pages?`}
        message={`This will permanently remove ${selectedPageIds.size} pages and all their cached OCR, narration, and audio files.`}
        confirmText="Delete Pages"
        variant="danger"
      />
    </aside>
  );
}
