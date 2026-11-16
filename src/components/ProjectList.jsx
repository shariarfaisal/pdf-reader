import React, { useMemo, useState } from 'react';
import {
  BookOpen,
  Plus,
  Trash2,
  ArrowRight,
  Activity,
  Settings as SettingsIcon,
  Search,
  Mic,
  Boxes,
  MoreVertical,
  Pencil,
  Headphones,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Loader2,
  X,
  Share2
} from 'lucide-react';
import { Button } from './ui/Button';
import { Card } from './ui/Card';
import { Badge } from './ui/Badge';
import { ProgressBar } from './ui/ProgressBar';
import { ConfirmModal } from './ui/ConfirmModal';
import { DriveSyncBadge } from './DriveSyncBadge';
import { useDriveSyncStatus } from '../lib/useDriveSyncStatus';
import { EditableTitle } from './ui/EditableTitle';
import { ThemeToggle } from './ui/ThemeToggle';
import { DropdownMenu } from './ui/DropdownMenu';
import { ShareProjectModal } from './ShareProjectModal';
import { formatRelativeTime, formatBookDisplayTitle } from '../lib/format';
import {
  useAudioPlayerOptional,
  formatAudioTime,
  formatRuntimeBadge,
  EqualizerBars,
  readListeningPosition
} from '../lib/audioPlayerContext';

/** First-page cover for a book; 64 × 88 px with natural spine crease and play overlay. */
function BookCover({
  projectId,
  updatedAt,
  title,
  hasAudio = false,
  isPlaying = false,
  isActiveBook = false,
  isLoading = false,
  onTogglePlay
}) {
  const [failed, setFailed] = useState(false);
  const src = `/api/projects/${projectId}/pages/0/preview?v=${updatedAt || 0}`;

  const content = (
    <>
      {failed ? (
        <div className="w-full h-full flex flex-col items-center justify-center bg-obsidian-750 text-slate-400 p-2 text-center">
          <BookOpen className="w-5 h-5 text-indigo-500 dark:text-indigo-400 mb-1" />
          <span className="text-[9px] font-mono leading-tight uppercase tracking-wider text-slate-500">PDF</span>
        </div>
      ) : (
        <img
          src={src}
          alt={title ? `Cover of ${title}` : 'Book cover'}
          loading="lazy"
          onError={() => setFailed(true)}
          className="w-full h-full object-cover object-top"
        />
      )}
      <div className="book-spine-overlay" aria-hidden="true" />

      {hasAudio && (
        <div
          className={`absolute inset-0 flex items-center justify-center transition-opacity duration-150 ${
            isPlaying || isActiveBook || isLoading
              ? 'bg-obsidian-950/55 opacity-100'
              : 'bg-obsidian-950/45 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
          }`}
        >
          <span className="w-8 h-8 rounded-full btn-primary-token shadow-md flex items-center justify-center transition-transform duration-150 group-hover:scale-105">
            {isLoading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : isPlaying ? (
              <Pause className="w-3.5 h-3.5 fill-current" />
            ) : (
              <Play className="w-3.5 h-3.5 fill-current translate-x-px" />
            )}
          </span>
        </div>
      )}
    </>
  );

  if (hasAudio && onTogglePlay) {
    return (
      <button
        type="button"
        onClick={onTogglePlay}
        title={isPlaying ? `Pause "${title}"` : `Play "${title}"`}
        aria-label={isPlaying ? `Pause ${title}` : `Play ${title}`}
        className={`relative w-[64px] h-[88px] flex-shrink-0 rounded-lg overflow-hidden border bg-obsidian-900 shadow-xs cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
          isActiveBook ? 'border-indigo-500/80 ring-1 ring-indigo-500/30' : 'border-obsidian-700'
        }`}
      >
        {content}
      </button>
    );
  }

  return (
    <div className="relative w-[64px] h-[88px] flex-shrink-0 rounded-lg overflow-hidden border border-obsidian-700 bg-obsidian-900 shadow-xs">
      {content}
    </div>
  );
}

const SORT_OPTIONS = [
  { id: 'recent', label: 'Recently updated' },
  { id: 'name', label: 'Name (A–Z)' },
  { id: 'progress', label: 'Most complete' }
];

const FILTER_OPTIONS = [
  { id: 'all', label: 'All' },
  { id: 'ready', label: 'With Audio' },
  { id: 'completed', label: 'Completed' },
  { id: 'idle', label: 'Not Started' }
];

export function ProjectList({
  projects,
  onSelectProject,
  onNewProject,
  onDeleteProject,
  onRenameProject,
  onOpenUsage,
  onOpenVoices,
  onOpenModels,
  onOpenSettings
}) {
  const [query, setQuery] = useState('');
  const drive = useDriveSyncStatus();
  const [sortBy, setSortBy] = useState('recent');
  const [statusFilter, setStatusFilter] = useState('all');
  const [projectToDelete, setProjectToDelete] = useState(null);
  const [projectToShare, setProjectToShare] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);
  // { id, n } counter so a menu item can open the inline title editor.
  const [renameRequest, setRenameRequest] = useState({ id: null, n: 0 });
  const audioPlayer = useAudioPlayerOptional();

  const stats = useMemo(() => {
    const totalBooks = projects.length;
    const totalPages = projects.reduce((sum, p) => sum + (p.page_count || 0), 0);
    const readyPages = projects.reduce((sum, p) => sum + (p.readyPages || 0), 0);
    const activeRunning = projects.filter((p) => p.status === 'running').length;
    const withAudioCount = projects.filter((p) => (p.readyPages || 0) > 0).length;
    const completedCount = projects.filter(
      (p) => (p.page_count || 0) > 0 && (p.readyPages || 0) >= p.page_count
    ).length;
    const idleCount = projects.filter((p) => (p.readyPages || 0) === 0).length;

    return {
      totalBooks,
      totalPages,
      readyPages,
      activeRunning,
      filterCounts: {
        all: totalBooks,
        ready: withAudioCount,
        completed: completedCount,
        idle: idleCount
      }
    };
  }, [projects]);

  // Identify the active or most recently listened audiobook for the Continue Listening spotlight.
  const recentListening = useMemo(() => {
    const activeId = audioPlayer?.session?.isActive ? audioPlayer.session.projectId : null;
    if (activeId) {
      const match = projects.find((p) => p.id === activeId && (p.readyPages || 0) > 0);
      if (match) {
        return {
          project: match,
          savedPosition: readListeningPosition(match.id),
          isActive: true
        };
      }
    }

    let best = null;
    let bestStamp = -1;
    for (const p of projects) {
      if ((p.readyPages || 0) <= 0) continue;
      const saved = readListeningPosition(p.id);
      if (!saved) continue;
      const stamp = saved.updatedAt || p.updated_at || 0;
      if (stamp > bestStamp) {
        bestStamp = stamp;
        best = { project: p, savedPosition: saved, isActive: false };
      }
    }
    return best;
  }, [projects, audioPlayer?.session?.isActive, audioPlayer?.session?.projectId]);

  const visibleProjects = useMemo(() => {
    const term = query.trim().toLowerCase();
    const filtered = projects.filter((p) => {
      if (term) {
        const rawMatch = (p.name || '').toLowerCase().includes(term);
        const displayMatch = formatBookDisplayTitle(p.name).toLowerCase().includes(term);
        if (!rawMatch && !displayMatch) return false;
      }

      const total = p.page_count || 0;
      const ready = p.readyPages || 0;
      if (statusFilter === 'ready') return ready > 0;
      if (statusFilter === 'completed') return total > 0 && ready >= total;
      if (statusFilter === 'idle') return ready === 0;
      return true;
    });

    const sorted = [...filtered];
    if (sortBy === 'name') {
      sorted.sort((a, b) =>
        formatBookDisplayTitle(a.name).localeCompare(formatBookDisplayTitle(b.name))
      );
    } else if (sortBy === 'progress') {
      sorted.sort((a, b) => {
        const aPct = (a.page_count || 0) > 0 ? (a.readyPages || 0) / a.page_count : 0;
        const bPct = (b.page_count || 0) > 0 ? (b.readyPages || 0) / b.page_count : 0;
        return bPct - aPct;
      });
    } else {
      sorted.sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
    }
    return sorted;
  }, [projects, query, sortBy, statusFilter]);

  const handleConfirmDelete = async () => {
    if (!projectToDelete) return;
    setIsDeleting(true);
    try {
      await onDeleteProject(projectToDelete.id);
      setProjectToDelete(null);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-app text-slate-100">
      {/* Shared Application Header */}
      <header className="sticky top-0 z-30 border-b border-obsidian-700/80 bg-obsidian-850/95 backdrop-blur-md">
        <div className="max-w-[1280px] mx-auto px-4 sm:px-6 md:px-8 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <span className="w-8 h-8 rounded-lg bg-indigo-600 dark:bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center flex-shrink-0 text-white dark:text-indigo-300">
              <BookOpen className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <span className="text-sm font-semibold text-slate-100 leading-tight truncate block">
                PDF Audiobook Studio
              </span>
              <span className="text-[11px] text-slate-400 leading-tight truncate hidden sm:block">
                Bengali · Arabic · English narration
              </span>
            </div>
          </div>

          <nav className="flex items-center gap-1 sm:gap-1.5 flex-shrink-0" aria-label="Studio navigation">
            {onOpenVoices && (
              <Button
                variant="ghost"
                size="sm"
                icon={Mic}
                onClick={onOpenVoices}
                title="Narrator voices"
                aria-label="Voices"
                className="px-2 sm:px-2.5"
              >
                <span className="hidden md:inline">Voices</span>
              </Button>
            )}
            {onOpenModels && (
              <Button
                variant="ghost"
                size="sm"
                icon={Boxes}
                onClick={onOpenModels}
                title="Local AI models"
                aria-label="Models"
                className="px-2 sm:px-2.5"
              >
                <span className="hidden md:inline">Models</span>
              </Button>
            )}
            {onOpenUsage && (
              <Button
                variant="ghost"
                size="sm"
                icon={Activity}
                onClick={onOpenUsage}
                title="API & processing usage"
                aria-label="Usage"
                className="px-2 sm:px-2.5"
              >
                <span className="hidden md:inline">Usage</span>
              </Button>
            )}
            {onOpenSettings && (
              <Button
                variant="ghost"
                size="sm"
                icon={SettingsIcon}
                onClick={onOpenSettings}
                title="Application settings"
                aria-label="Settings"
                className="px-2 sm:px-2.5"
              >
                <span className="hidden md:inline">Settings</span>
              </Button>
            )}
            <div className="h-4 w-px bg-obsidian-700/60 mx-0.5 sm:mx-1" aria-hidden="true" />
            <ThemeToggle />
          </nav>
        </div>
      </header>

      {/* Main Content Area — Centered 1280px with 32/24/16 px padding */}
      <main
        className={`flex-1 w-full max-w-[1280px] mx-auto px-4 sm:px-6 md:px-8 py-8 ${
          audioPlayer?.session?.isActive ? 'pb-28' : ''
        }`}
      >
        {/* Row 1: Heading row: “Library” on the left; “Import PDF” on the right */}
        <div className="flex items-center justify-between gap-4 mb-2">
          <div>
            <h1 className="text-[28px] font-semibold tracking-tight text-slate-100 leading-tight">
              Library
            </h1>
          </div>
          <Button
            variant="primary"
            size="md"
            icon={Plus}
            onClick={onNewProject}
          >
            Import PDF
          </Button>
        </div>

        {/* Row 2: Compact summary strip */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400 mb-6">
          <span>
            {stats.totalBooks} {stats.totalBooks === 1 ? 'book' : 'books'}
          </span>
          <span className="text-slate-600 dark:text-slate-500">·</span>
          <span>
            {stats.totalPages.toLocaleString()} pages
          </span>
          <span className="text-slate-600 dark:text-slate-500">·</span>
          <span>
            {stats.readyPages.toLocaleString()} pages with audio
          </span>
          {stats.activeRunning > 0 && (
            <>
              <span className="text-slate-600 dark:text-slate-500">·</span>
              <span className="text-indigo-600 dark:text-indigo-400 font-medium">
                {stats.activeRunning} processing
              </span>
            </>
          )}
        </div>

        {/* Row 2.5: Continue Listening Spotlight Strip */}
        {recentListening && !query.trim() && statusFilter === 'all' && (() => {
          const rp = recentListening.project;
          const displayTitle = formatBookDisplayTitle(rp.name);
          const total = rp.page_count || 0;
          const runtimeBadge = formatRuntimeBadge(rp.totalAudioDuration);
          const isActiveBook = Boolean(
            audioPlayer?.session?.isActive && audioPlayer?.session?.projectId === rp.id
          );
          const isPlayingThisBook = Boolean(isActiveBook && audioPlayer?.isPlaying);
          const isLoadingThisBook = Boolean(
            audioPlayer?.isLoadingAudio && audioPlayer?.loadingProjectId === rp.id
          );
          const playingPageNum = isActiveBook
            ? audioPlayer.session.playingPageNumber ?? 0
            : recentListening.savedPosition?.page ?? 0;
          const resumeTime = recentListening.savedPosition?.time ?? 0;

          return (
            <section
              aria-label="Continue listening"
              className="rounded-xl border border-obsidian-700/80 bg-obsidian-850 p-4 sm:p-5 mb-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 group"
            >
              <div className="flex items-center gap-4 min-w-0 flex-1">
                <BookCover
                  projectId={rp.id}
                  updatedAt={rp.updated_at}
                  title={displayTitle}
                  hasAudio={true}
                  isPlaying={isPlayingThisBook}
                  isActiveBook={isActiveBook}
                  isLoading={isLoadingThisBook}
                  onTogglePlay={() => audioPlayer?.playProjectFromLibrary(rp)}
                />

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400 flex items-center gap-1.5">
                      {isPlayingThisBook ? (
                        <EqualizerBars isPlaying={true} />
                      ) : (
                        <Headphones className="w-3.5 h-3.5" aria-hidden="true" />
                      )}
                      {isPlayingThisBook ? 'Now Playing' : 'Continue Listening'}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => onSelectProject(rp.id)}
                    title={rp.name}
                    className="min-h-[28px] inline-flex items-center text-left text-base sm:text-lg font-semibold text-slate-100 hover:text-indigo-600 dark:hover:text-indigo-300 transition-colors cursor-pointer max-w-full"
                  >
                    <span className="truncate">{displayTitle}</span>
                  </button>

                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400">
                    <span>
                      Page {playingPageNum + 1} of {total}
                    </span>
                    {(isActiveBook || resumeTime > 0) && (
                      <>
                        <span className="text-slate-600 dark:text-slate-500">·</span>
                        <span className="font-mono tabular-nums">
                          {formatAudioTime(
                            isActiveBook
                              ? audioPlayer.timeline.total > 0
                                ? audioPlayer.bookPosition
                                : audioPlayer.currentTime
                              : resumeTime
                          )}
                        </span>
                      </>
                    )}
                    {runtimeBadge && (
                      <>
                        <span className="text-slate-600 dark:text-slate-500">·</span>
                        <span>{runtimeBadge} total</span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 flex-shrink-0 w-full sm:w-auto justify-end">
                <Button
                  variant="primary"
                  size="md"
                  isLoading={isLoadingThisBook}
                  icon={isPlayingThisBook ? Pause : Play}
                  onClick={() => audioPlayer?.playProjectFromLibrary(rp)}
                >
                  {isPlayingThisBook ? 'Pause' : 'Resume'}
                </Button>
                <Button
                  variant="secondary"
                  size="md"
                  iconRight={ArrowRight}
                  onClick={() => onSelectProject(rp.id)}
                >
                  Open book
                </Button>
              </div>
            </section>
          );
        })()}

        {/* Row 3: Filter tabs + Search and sort toolbar */}
        {projects.length > 0 && (
          <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3 mb-6">
            {/* Segmented filter tabs */}
            <div
              role="group"
              aria-label="Filter books"
              className="grid grid-cols-2 sm:inline-flex items-center p-1 gap-1 sm:gap-0 rounded-xl bg-obsidian-750/80 border border-obsidian-700/70 w-full sm:w-auto sm:self-start"
            >
              {FILTER_OPTIONS.map((tab) => {
                const active = statusFilter === tab.id;
                const count = stats.filterCounts[tab.id] ?? 0;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setStatusFilter(tab.id)}
                    className={`h-8 px-3 rounded-lg text-xs inline-flex items-center justify-center sm:justify-start gap-1.5 whitespace-nowrap transition-colors cursor-pointer ${
                      active
                        ? 'bg-obsidian-850 text-slate-100 border border-obsidian-700/80 font-semibold shadow-2xs'
                        : 'text-slate-400 hover:text-slate-100 border border-transparent font-medium'
                    }`}
                  >
                    <span>{tab.label}</span>
                    <span className="font-mono text-[11px] tabular-nums opacity-75">{count}</span>
                  </button>
                );
              })}
            </div>

            {/* Search & sort */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 flex-1 lg:justify-end">
              <div className="relative flex-1 sm:max-w-xs">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search books…"
                  aria-label="Search books"
                  className="w-full h-9.5 pl-9 pr-9 rounded-lg bg-obsidian-850 border border-obsidian-700/80 text-sm text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-colors"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery('')}
                    aria-label="Clear search"
                    title="Clear search"
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-md flex items-center justify-center text-slate-400 hover:text-slate-100 hover:bg-obsidian-750 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2 flex-shrink-0 w-full sm:w-auto">
                <span className="text-xs text-slate-400 hidden sm:inline">Sort:</span>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  aria-label="Sort books"
                  className="w-full sm:w-auto h-9.5 rounded-lg bg-obsidian-850 border border-obsidian-700/80 px-3 text-xs font-medium text-slate-200 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 cursor-pointer"
                >
                  {SORT_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        )}

        {/* Row 4: Book Grid or Empty States */}
        {projects.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-obsidian-700/80 bg-obsidian-850 p-12 text-center max-w-xl mx-auto my-8">
            <div className="mx-auto mb-4 w-12 h-12 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-500 dark:text-indigo-400">
              <BookOpen className="w-6 h-6" />
            </div>
            <h2 className="text-base font-semibold text-slate-100 mb-1">
              Your library is empty
            </h2>
            <p className="text-xs text-slate-400 max-w-sm mx-auto mb-5 leading-relaxed">
              Import a PDF to start reading. Every book maintains its own isolated OCR, narration text, and voice audio cache.
            </p>
            <Button variant="primary" size="md" icon={Plus} onClick={onNewProject}>
              Import PDF
            </Button>
          </div>
        ) : visibleProjects.length === 0 ? (
          <div className="rounded-xl border border-obsidian-700/70 bg-obsidian-850 p-10 text-center max-w-md mx-auto my-8">
            <Search className="w-6 h-6 text-slate-400 mx-auto mb-2" />
            <h2 className="text-sm font-semibold text-slate-100 mb-1">
              No matching books found
            </h2>
            <p className="text-xs text-slate-400 mb-4">
              {query.trim()
                ? `No books in your library match "${query}".`
                : 'No books match the selected filter.'}
            </p>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setQuery('');
                setStatusFilter('all');
              }}
            >
              Reset filters
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {visibleProjects.map((p) => {
              const displayTitle = formatBookDisplayTitle(p.name);
              const total = p.page_count || 0;
              const ready = p.readyPages || 0;
              const isDone = total > 0 && ready >= total;
              const hasAudio = ready > 0;
              const runtimeBadge = formatRuntimeBadge(p.totalAudioDuration);
              const percent = total > 0 ? Math.round((ready / total) * 100) : 0;

              const isActiveBook = Boolean(
                audioPlayer?.session?.isActive && audioPlayer?.session?.projectId === p.id
              );
              const isPlayingThisBook = Boolean(isActiveBook && audioPlayer?.isPlaying);
              const isLoadingThisBook = Boolean(
                audioPlayer?.isLoadingAudio && audioPlayer?.loadingProjectId === p.id
              );
              const savedPosition = readListeningPosition(p.id);
              const bookmarkedPage = savedPosition ? savedPosition.page : null;
              const resumeTime = savedPosition ? savedPosition.time : 0;
              const hasResume = savedPosition !== null;
              const playingPageNum = isActiveBook
                ? audioPlayer.session.playingPageNumber ?? 0
                : bookmarkedPage ?? 0;

              // De-duplicated status label (progress count lives in its own row below)
              let statusLabel = 'Not started';
              let statusStatus = 'idle';
              if (isDone) {
                statusLabel = 'Completed';
                statusStatus = 'completed';
              } else if (p.status === 'running') {
                statusLabel = 'Generating audio';
                statusStatus = 'running';
              } else if (p.status === 'paused') {
                statusLabel = 'Paused';
                statusStatus = 'paused';
              } else if (p.status === 'error') {
                statusLabel = 'Needs attention';
                statusStatus = 'error';
              } else if (ready > 0) {
                statusLabel = 'Audio available';
                statusStatus = 'ready';
              }

              return (
                <Card
                  key={p.id}
                  hover
                  className={`flex flex-col justify-between p-5 group ${
                    isActiveBook
                      ? 'border-indigo-500/70 ring-1 ring-indigo-500/25'
                      : ''
                  }`}
                >
                  {/* Top section: Thumbnail + Title + Metadata + Overflow menu */}
                  <div>
                    <div className="flex items-start justify-between gap-3 mb-4">
                      <div className="flex items-start gap-3.5 min-w-0 flex-1">
                        <BookCover
                          projectId={p.id}
                          updatedAt={p.updated_at}
                          title={displayTitle}
                          hasAudio={hasAudio}
                          isPlaying={isPlayingThisBook}
                          isActiveBook={isActiveBook}
                          isLoading={isLoadingThisBook}
                          onTogglePlay={
                            hasAudio ? () => audioPlayer?.playProjectFromLibrary(p) : undefined
                          }
                        />

                        <div className="min-w-0 flex-1">
                          <EditableTitle
                            value={p.name}
                            displayValue={displayTitle}
                            clickToEdit={false}
                            onActivate={() => onSelectProject(p.id)}
                            onRename={(name) => onRenameProject?.(p.id, name)}
                            editSignal={renameRequest.id === p.id ? renameRequest.n : 0}
                            wrapperClassName="w-full"
                            inputClassName="w-full font-semibold text-base leading-snug"
                            className="w-full font-semibold text-base text-slate-100 leading-snug"
                          />

                          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400">
                            <span>{total} pages</span>
                            {runtimeBadge && (
                              <>
                                <span className="text-slate-600 dark:text-slate-500">·</span>
                                <span>{runtimeBadge}</span>
                              </>
                            )}
                            {hasResume && (
                              <>
                                <span className="text-slate-600 dark:text-slate-500">·</span>
                                <span className="text-slate-400 flex items-center gap-1">
                                  <Headphones className="w-3 h-3 text-slate-400" />
                                  p. {playingPageNum + 1}
                                  {!isActiveBook && resumeTime > 0 && (
                                    <span className="font-mono tabular-nums text-slate-400">
                                      · {formatAudioTime(resumeTime)}
                                    </span>
                                  )}
                                </span>
                              </>
                            )}
                          </div>

                          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                            <Badge status={statusStatus} label={statusLabel} size="xs" />
                            <DriveSyncBadge sync={drive.byProject[p.id]} />
                            {isActiveBook && (
                              <span className="inline-flex items-center gap-1.5 h-5 px-2 rounded-md text-[11px] font-medium bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border border-indigo-500/30">
                                <EqualizerBars isPlaying={isPlayingThisBook} />
                                <span>
                                  {isPlayingThisBook ? 'Playing' : 'Paused'} · p. {playingPageNum + 1}
                                </span>
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Upper-right overflow menu */}
                      <DropdownMenu
                        variant="ghost"
                        size="icon-xs"
                        icon={MoreVertical}
                        showChevron={false}
                        title="Book actions"
                        className="text-slate-400 hover:text-slate-100 -mt-1 flex-shrink-0"
                        items={[
                          ...(hasAudio
                            ? [
                                {
                                  label: isPlayingThisBook ? 'Pause audio' : 'Play audio',
                                  icon: isPlayingThisBook ? Pause : Play,
                                  onSelect: () => audioPlayer?.playProjectFromLibrary(p)
                                }
                              ]
                            : []),
                          {
                            label: 'Rename book…',
                            icon: Pencil,
                            onSelect: () =>
                              setRenameRequest((prev) => ({
                                id: p.id,
                                n: (prev.id === p.id ? prev.n : 0) + 1
                              }))
                          },
                          ...(hasAudio
                            ? [
                                {
                                  label: 'Share for listening…',
                                  description: 'Listen on iPhone over Wi-Fi',
                                  icon: Share2,
                                  onSelect: () => setProjectToShare(p)
                                }
                              ]
                            : []),
                          {
                            label: 'Open book',
                            icon: BookOpen,
                            onSelect: () => onSelectProject(p.id)
                          },
                          { divider: true },
                          {
                            label: 'Delete book…',
                            description: 'Permanently remove project and audio cache',
                            icon: Trash2,
                            danger: true,
                            onSelect: () => setProjectToDelete(p)
                          }
                        ]}
                      />
                    </div>

                    {/* Progress measure & thin progress bar (only when work exists or running) */}
                    {ready > 0 || p.status === 'running' ? (
                      <div className="mt-2">
                        <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5 font-medium">
                          <span>
                            {ready} of {total} {total === 1 ? 'page' : 'pages'} narrated
                          </span>
                          {isActiveBook ? (
                            <span className="font-mono text-[11px] text-indigo-600 dark:text-indigo-400 tabular-nums">
                              {formatAudioTime(
                                audioPlayer.timeline.total > 0
                                  ? audioPlayer.bookPosition
                                  : audioPlayer.currentTime
                              )}{' '}
                              / {formatAudioTime(audioPlayer.seekTotal)}
                            </span>
                          ) : (
                            <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                              {percent}%
                            </span>
                          )}
                        </div>
                        <ProgressBar value={ready} max={total || 1} height="h-1.5" showPercent={false} />
                      </div>
                    ) : (
                      <div className="mt-2 pt-1 text-xs text-slate-400">
                        Ready to process · {total} {total === 1 ? 'page' : 'pages'}
                      </div>
                    )}
                  </div>

                  {/* Bottom footer: updated time / active page stepper on left, Play + Open book on right */}
                  <div className="mt-5 pt-3.5 border-t border-obsidian-700/60 flex items-center justify-between gap-2">
                    {isActiveBook ? (
                      <div className="flex items-center gap-1 min-w-0">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          disabled={audioPlayer.prevPlayablePageNumber === null}
                          onClick={() => audioPlayer.stepPlayablePage(-1)}
                          title="Previous narrated page"
                          aria-label="Previous narrated page"
                        >
                          <SkipBack className="w-3.5 h-3.5" />
                        </Button>
                        <span className="text-xs font-mono text-slate-300 tabular-nums px-1 truncate">
                          p. {playingPageNum + 1}/{total}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          disabled={audioPlayer.nextPlayablePageNumber === null}
                          onClick={() => audioPlayer.stepPlayablePage(1)}
                          title="Next narrated page"
                          aria-label="Next narrated page"
                        >
                          <SkipForward className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400 truncate">
                        Updated {formatRelativeTime(p.updated_at)}
                      </span>
                    )}

                    <div className="flex items-center gap-2 flex-shrink-0">
                      {hasAudio && (
                        <Button
                          variant={isPlayingThisBook || isActiveBook ? 'primary' : 'secondary'}
                          size="sm"
                          isLoading={isLoadingThisBook}
                          onClick={() => audioPlayer?.playProjectFromLibrary(p)}
                          title={
                            isPlayingThisBook
                              ? `Pause "${displayTitle}"`
                              : isActiveBook
                              ? `Resume "${displayTitle}" (page ${playingPageNum + 1})`
                              : hasResume
                              ? `Resume "${displayTitle}" at page ${playingPageNum + 1}${resumeTime > 0 ? `, ${formatAudioTime(resumeTime)}` : ''}`
                              : `Play "${displayTitle}" audio`
                          }
                          aria-label={
                            isPlayingThisBook
                              ? `Pause ${displayTitle}`
                              : isActiveBook || hasResume
                              ? `Resume ${displayTitle}`
                              : `Play ${displayTitle}`
                          }
                        >
                          {isPlayingThisBook ? (
                            <>
                              <Pause className="w-3.5 h-3.5 fill-current" />
                              <span>Pause</span>
                            </>
                          ) : (
                            <>
                              <Play className="w-3.5 h-3.5 fill-current translate-x-px" />
                              <span>{isActiveBook || hasResume ? 'Resume' : 'Play'}</span>
                            </>
                          )}
                        </Button>
                      )}

                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => onSelectProject(p.id)}
                        iconRight={ArrowRight}
                      >
                        Open book
                      </Button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </main>

      <ShareProjectModal
        isOpen={Boolean(projectToShare)}
        onClose={() => setProjectToShare(null)}
        projectId={projectToShare?.id}
        projectName={projectToShare?.name}
      />

      {/* Delete Book Confirmation Modal */}
      <ConfirmModal
        isOpen={Boolean(projectToDelete)}
        onClose={() => setProjectToDelete(null)}
        onConfirm={handleConfirmDelete}
        title={`Delete "${formatBookDisplayTitle(projectToDelete?.name)}"?`}
        message={`This will permanently delete this book, including all ${projectToDelete?.page_count || 0} pages, extracted text, narration scripts, and generated voice audio.`}
        confirmText="Delete Book"
        variant="danger"
        isLoading={isDeleting}
      />
    </div>
  );
}
