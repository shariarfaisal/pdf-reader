import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  ArrowLeft,
  Settings as SettingsIcon,
  RotateCcw,
  Sparkles,
  FileText,
  Volume2,
  ChevronLeft,
  ChevronRight,
  Layers,
  RefreshCw,
  Download,
  ListOrdered,
  Info,
  Type,
  Activity,
  Keyboard,
  HelpCircle,
  AlertCircle,
  Mic,
  Edit3,
  Check,
  X,
  ScanText,
  Replace,
  Boxes,
  PanelLeftClose,
  PanelLeft,
  MoreVertical,
  BookOpen,
  Pencil,
  Trash2,
  Search,
  Share2
} from 'lucide-react';
import { Button } from './ui/Button';
import { Badge, Tag } from './ui/Badge';
import { Card } from './ui/Card';
import { DropdownMenu } from './ui/DropdownMenu';
import { ConfirmModal } from './ui/ConfirmModal';
import { EditableTitle } from './ui/EditableTitle';
import { ThemeToggle } from './ui/ThemeToggle';
import { PipelineInspector } from './PipelineInspector';
import { GpuToggleButton } from './inspector/TtsBackendPanel';
import { AudioPlayerBar } from './AudioPlayerBar';
import { PageNavigatorSidebar } from './PageNavigatorSidebar';
import { PageManagerModal } from './PageManagerModal';
import { PageTextEditModal } from './PageTextEditModal';
import { ShareProjectModal } from './ShareProjectModal';
import { KeyboardShortcutsModal } from './KeyboardShortcutsModal';
import { TextRulesModal } from './TextRulesModal';
import { ContinuousDocumentViewer } from './ContinuousDocumentViewer';
import { buildSyncMap, compactSpanToRaw, markIndexAt, parseTimings } from '../lib/audioSync';
import { triggerDownload } from '../lib/download';
import { formatBookDisplayTitle } from '../lib/format';
import { countBuckets } from '../lib/pageStages';
import {
  ReaderCustomizer,
  CanvasZoomToolbar,
  FontSizeStepper,
  useReaderSettings
} from './ReaderCustomizer';

export function ProjectWorkspace({
  project,
  pages = [],
  activePageNumber = 0,
  logs = [],
  systemHealth,
  onBack,
  onOpenSettings,
  onOpenUsage,
  onOpenVoices,
  onOpenModels,
  onStartPipeline,
  onPausePipeline,
  onResumePipeline,
  onStepPipeline,
  onStopPipeline,
  onSelectPage,
  onRegeneratePage,
  onRegenerateProject,
  onRenameProject,
  onDeleteProject,
  onAddPage,
  onUpdatePageText,
  onDeletePage,
  onDeletePages,
  onRefreshProject,
  onClearLogs,
  remoteStatus,
  onRemoteStart,
  onRemoteStop,
  pipelineStages = {},
  activeRuns = {}
}) {
  // Tabs: 'refined' (Narration) | 'canvas' (Original PDF) | 'raw' (Extracted text)
  const [viewMode, setViewMode] = useState('refined');

  // Sidebar visibility states — Processing / Inspector panel open by default
  const [isPageNavOpen, setIsPageNavOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);

  const toggleInspector = () => {
    setInspectorOpen((prev) => !prev);
  };

  const [inspectorWidth, setInspectorWidth] = useState(() => {
    try {
      const saved = localStorage.getItem('pdf-reader-inspector-width');
      return saved ? Math.max(280, Math.min(680, Number(saved))) : 360;
    } catch {
      return 360;
    }
  });

  const handleInspectorResize = useCallback((newWidth) => {
    setInspectorWidth(newWidth);
    try {
      localStorage.setItem('pdf-reader-inspector-width', newWidth);
    } catch {}
  }, []);

  // Modals
  const [isPageManagerOpen, setIsPageManagerOpen] = useState(false);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  const [isRulesOpen, setIsRulesOpen] = useState(false);
  const [editModalConfig, setEditModalConfig] = useState({
    isOpen: false,
    page: null,
    mode: 'refined'
  });

  // Playback state from AudioPlayerBar
  const [playbackTime, setPlaybackTime] = useState(0);
  const [playbackDuration, setPlaybackDuration] = useState(0);
  const [playingPageNumber, setPlayingPageNumber] = useState(activePageNumber);

  // Canvas zoom state & in-page search
  const [canvasZoom, setCanvasZoom] = useState(100);
  const [searchQuery, setSearchQuery] = useState('');

  // Confirm modal state
  const [confirmConfig, setConfirmConfig] = useState({
    isOpen: false,
    title: '',
    message: '',
    confirmText: 'Confirm',
    variant: 'default',
    isLoading: false,
    action: null
  });

  // Bumped to open the header title editor from the actions menu.
  const [titleEditSignal, setTitleEditSignal] = useState(0);

  // Reader customization state (persisted in localStorage)
  const {
    settings: readerSettings,
    updateSetting: updateReaderSetting,
    resetSettings: resetReaderSettings
  } = useReaderSettings();

  const activePage = useMemo(() => {
    return (
      pages.find((p) => p.page_number === activePageNumber) || {
        page_number: activePageNumber,
        status: 'pending',
        page_type: 'pdf',
        raw_text: '',
        refined_text: ''
      }
    );
  }, [pages, activePageNumber]);

  const playingPage = useMemo(() => {
    return pages.find((p) => p.page_number === playingPageNumber) || activePage;
  }, [pages, playingPageNumber, activePage]);

  const totalPages = project?.page_count || pages.length || 1;
  const audioDone = useMemo(() => countBuckets(pages).audio || 0, [pages]);

  // Compute active paragraph highlight based on relative playback progress of the playing page
  const paragraphs = useMemo(() => {
    const raw = viewMode === 'raw' ? playingPage.raw_text : playingPage.refined_text;
    return (raw || '').split('\n\n').filter(Boolean);
  }, [viewMode, playingPage.raw_text, playingPage.refined_text]);

  // Exact sentence marks reported by the TTS engine, matched to these paragraphs.
  const syncEntries = useMemo(
    () => buildSyncMap(paragraphs, parseTimings(playingPage)),
    [paragraphs, playingPage.audio_timings]
  );

  const activeMark = useMemo(() => {
    const index = markIndexAt(syncEntries, playbackTime);
    return index >= 0 ? syncEntries[index] : null;
  }, [syncEntries, playbackTime]);

  // Raw-text range of the spoken sentence inside its paragraph.
  const activeSpan = useMemo(() => {
    if (!activeMark) return null;
    const paragraph = paragraphs[activeMark.paragraph];
    const range = compactSpanToRaw(paragraph, activeMark.from, activeMark.to);
    return range ? { paragraph: activeMark.paragraph, start: range[0], end: range[1] } : null;
  }, [activeMark, paragraphs]);

  const activeParagraphIndex = useMemo(() => {
    if (syncEntries) return activeMark ? activeMark.paragraph : -1;
    if (playbackDuration > 0 && paragraphs.length > 0) {
      const fraction = playbackTime / playbackDuration;
      return Math.min(paragraphs.length - 1, Math.floor(fraction * paragraphs.length));
    }
    return -1;
  }, [syncEntries, activeMark, playbackTime, playbackDuration, paragraphs.length]);

  // Global reader keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target?.tagName) || e.target?.isContentEditable) {
        return;
      }

      if (e.key === '?') {
        e.preventDefault();
        setIsShortcutsOpen((prev) => !prev);
      } else if (e.key === '[') {
        e.preventDefault();
        updateReaderSetting('fontSize', Math.max(13, readerSettings.fontSize - 1));
      } else if (e.key === ']') {
        e.preventDefault();
        updateReaderSetting('fontSize', Math.min(32, readerSettings.fontSize + 1));
      } else if (e.key.toLowerCase() === 't') {
        e.preventDefault();
        const themes = ['paper', 'obsidian', 'midnight', 'sepia', 'oled'];
        const currentIdx = themes.indexOf(readerSettings.theme);
        const nextTheme = themes[(currentIdx + 1) % themes.length];
        updateReaderSetting('theme', nextTheme);
      } else if (e.key.toLowerCase() === 'v') {
        e.preventDefault();
        setViewMode((prev) => (prev === 'refined' ? 'canvas' : prev === 'canvas' ? 'raw' : 'refined'));
      } else if (e.key.toLowerCase() === 'i') {
        e.preventDefault();
        toggleInspector();
      } else if (e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setIsPageNavOpen((prev) => !prev);
      } else if (e.key === 'ArrowLeft' && !e.metaKey && !e.ctrlKey) {
        if (activePageNumber > 0) {
          e.preventDefault();
          onSelectPage(activePageNumber - 1);
        }
      } else if (e.key === 'ArrowRight' && !e.metaKey && !e.ctrlKey) {
        if (activePageNumber + 1 < totalPages) {
          e.preventDefault();
          onSelectPage(activePageNumber + 1);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [readerSettings, activePageNumber, totalPages, onSelectPage, updateReaderSetting]);

  // Audio streams & URLs
  const audioUrl =
    activePage.status === 'ready' && activePage.audio_path
      ? `/api/projects/${project.id}/pages/${activePage.page_number}/audio?inline=1&v=${activePage.updated_at || 0}`
      : null;

  const audioDownloadUrl = activePage.audio_path
    ? `/api/projects/${project.id}/pages/${activePage.page_number}/audio`
    : null;

  const audioArchiveUrl = `/api/projects/${project.id}/audio-archive`;
  const audioFullUrl = `/api/projects/${project.id}/audio-full`;
  const hasAnyAudio = pages.some((p) => p.audio_path);

  /** Explicit regeneration action with scoped confirmation */
  const requestRegenerate = (scope, mode) => {
    let stageLabel = 'narration script and synthesized audio';
    let confirmText = 'Regenerate';
    let variant = 'warning';

    if (mode === 'audio') {
      stageLabel = 'synthesized audio (keeping OCR and script intact)';
      confirmText = 'Re-synthesize audio';
      variant = 'default';
    } else if (mode === 'ocr') {
      stageLabel = 'OCR text, narration script, and audio (re-extracting text from PDF)';
      confirmText = 'Re-run OCR';
      variant = 'warning';
    } else if (mode === 'full') {
      stageLabel = 'OCR text, refined narration, and synthesized audio';
      confirmText = 'Rebuild all stages';
      variant = 'danger';
    }

    const title =
      scope === 'page'
        ? `Regenerate Page ${activePageNumber + 1}?`
        : `Regenerate Entire Book (${totalPages} pages)?`;

    const message =
      scope === 'page'
        ? `This clears ${stageLabel} for Page ${activePageNumber + 1} and restarts its pipeline.`
        : `This clears ${stageLabel} for every page in "${project.name}" and restarts the pipeline from page 1. Existing cached assets for these stages will be replaced.`;

    setConfirmConfig({
      isOpen: true,
      title,
      message,
      confirmText,
      variant,
      isLoading: false,
      action: async () => {
        setConfirmConfig((prev) => ({ ...prev, isLoading: true }));
        try {
          if (scope === 'page') {
            await onRegeneratePage(project.id, activePageNumber, mode);
          } else {
            await onRegenerateProject(project.id, mode);
          }
          setConfirmConfig((prev) => ({ ...prev, isOpen: false, isLoading: false }));
        } catch (err) {
          setConfirmConfig({
            isOpen: true,
            title: 'Regeneration Error',
            message: err.message || 'An error occurred during regeneration.',
            confirmText: 'Dismiss',
            variant: 'danger',
            isLoading: false,
            action: () => setConfirmConfig((prev) => ({ ...prev, isOpen: false }))
          });
        }
      }
    });
  };

  const handleEditPageText = (pageNumber, mode) => {
    const pageToEdit = pages.find((p) => p.page_number === pageNumber) || activePage;
    setEditModalConfig({
      isOpen: true,
      page: pageToEdit,
      mode
    });
  };

  const handleSaveEditedText = async ({ pageNumber, text, mode, andRefine, andSynthesize }) => {
    if (!onUpdatePageText) return;
    if (mode === 'raw') {
      await onUpdatePageText(pageNumber, {
        rawText: text,
        clearRefined: andRefine,
        clearAudio: andRefine
      });
      if (andRefine) {
        await onStepPipeline(project.id, pageNumber, 'refine');
      }
    } else {
      await onUpdatePageText(pageNumber, {
        refinedText: text,
        clearAudio: andSynthesize
      });
      if (andSynthesize) {
        await onStepPipeline(project.id, pageNumber, 'audio');
      }
    }
  };

  const handleOcrPage = async (pageNumber) => {
    try {
      if (onRegeneratePage) {
        await onRegeneratePage(project.id, pageNumber, 'ocr');
      } else if (onStepPipeline) {
        await onStepPipeline(project.id, pageNumber, 'ocr');
      }
    } catch (err) {
      console.error('OCR page failed:', err);
    }
  };

  const handleRefinePage = async (pageNumber) => {
    try {
      await onRegeneratePage(project.id, pageNumber, 'narration');
    } catch (err) {
      console.error('Refine page failed:', err);
    }
  };

  const handleSynthesizePage = async (pageNumber) => {
    try {
      await onRegeneratePage(project.id, pageNumber, 'audio');
    } catch (err) {
      console.error('Synthesize page failed:', err);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-app text-slate-100 overflow-hidden select-none">
      {/* 1. Project Header (56px book-level chrome) */}
      <header className="h-14 border-b border-obsidian-700/80 bg-obsidian-850 px-3 sm:px-6 flex items-center justify-between flex-shrink-0 z-30 gap-2 sm:gap-4">
        {/* Left: Library / Book Title */}
        <div className="flex items-center gap-2 min-w-0">
          <Button
            variant="ghost"
            size="sm"
            icon={ArrowLeft}
            onClick={onBack}
            className="flex-shrink-0 text-slate-300"
          >
            <span className="hidden xs:inline sm:inline">Library</span>
          </Button>

          <span className="text-slate-500 font-normal select-none" aria-hidden="true">
            /
          </span>

          <EditableTitle
            value={project.name}
            displayValue={formatBookDisplayTitle(project.name)}
            onRename={(name) => onRenameProject?.(project.id, name)}
            editSignal={titleEditSignal}
            wrapperClassName="max-w-[140px] sm:max-w-xs md:max-w-sm lg:max-w-md"
            inputClassName="w-[min(24rem,50vw)] text-sm font-semibold"
            className="font-semibold text-slate-100 text-sm truncate"
          />

          <Badge status={project.status} size="xs" className="flex-shrink-0 hidden md:inline-flex" />
        </div>

        {/* Right: GPU toggle, processing panel toggle, actions, theme, settings */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {/* Remote GPU worker: status + start/stop in one control */}
          <GpuToggleButton
            remoteStatus={remoteStatus}
            onRemoteStart={onRemoteStart}
            onRemoteStop={onRemoteStop}
          />

          <Button
            variant={inspectorOpen ? 'secondary' : 'outline'}
            size="sm"
            icon={Layers}
            onClick={toggleInspector}
            aria-pressed={inspectorOpen}
            title={`${inspectorOpen ? 'Hide' : 'Show'} processing panel (I)`}
            aria-label="Toggle processing panel"
          >
            <span className="hidden sm:inline">Processing</span>
            <span className="font-mono text-[11px] tabular-nums opacity-75">
              {audioDone}/{totalPages}
            </span>
          </Button>

          {/* Project Actions Menu with Explicit Scopes */}
          <DropdownMenu
            icon={MoreVertical}
            variant="ghost"
            size="icon-sm"
            showChevron={false}
            widthClass="w-60"
            title="Book options and actions"
            items={[
              {
                label: 'Rename book…',
                icon: Pencil,
                onSelect: () => setTitleEditSignal((n) => n + 1)
              },
              {
                label: 'Appearance & styling…',
                icon: Type,
                onSelect: () => {
                  // If on a screen where top bar customizer is hidden
                  const el = document.querySelector('[aria-label="Appearance settings"]');
                  el?.click();
                }
              },
              {
                label: 'Text replacement rules…',
                icon: Replace,
                onSelect: () => setIsRulesOpen(true)
              },
              { divider: true },
              {
                label: `Regenerate page ${activePageNumber + 1} audio`,
                icon: Volume2,
                onSelect: () => requestRegenerate('page', 'audio')
              },
              {
                label: `Regenerate page ${activePageNumber + 1} narration + audio`,
                icon: Sparkles,
                onSelect: () => requestRegenerate('page', 'narration')
              },
              {
                label: `Re-run page ${activePageNumber + 1} OCR`,
                icon: ScanText,
                onSelect: () => requestRegenerate('page', 'ocr')
              },
              { divider: true },
              {
                label: 'Regenerate book audio',
                icon: Volume2,
                onSelect: () => requestRegenerate('project', 'audio')
              },
              {
                label: 'Rebuild entire book from PDF',
                icon: RotateCcw,
                danger: true,
                onSelect: () => requestRegenerate('project', 'full')
              },
              { divider: true },
              {
                label: 'Download full audiobook (.mp3)',
                icon: Volume2,
                disabled: !hasAnyAudio,
                onSelect: () => {
                  triggerDownload(audioFullUrl);
                }
              },
              {
                label: 'Export book audio archive (.tar.gz)',
                icon: Download,
                disabled: !hasAnyAudio,
                onSelect: () => {
                  triggerDownload(audioArchiveUrl);
                }
              },
              {
                label: 'Share for listening…',
                description: 'Listen on iPhone over Wi-Fi',
                icon: Share2,
                disabled: !hasAnyAudio,
                onSelect: () => setIsShareOpen(true)
              },
              {
                label: 'Manage pages…',
                icon: ListOrdered,
                onSelect: () => setIsPageManagerOpen(true)
              },
              {
                label: 'Keyboard shortcuts',
                icon: Keyboard,
                onSelect: () => setIsShortcutsOpen(true)
              },
              { divider: true },
              {
                label: 'Delete book…',
                description: 'Permanently remove project and audio cache',
                icon: Trash2,
                danger: true,
                onSelect: () =>
                  setConfirmConfig({
                    isOpen: true,
                    title: `Delete "${project.name}"?`,
                    message: `This will permanently delete this book, including all ${totalPages} pages, extracted text, narration scripts, and generated voice audio.`,
                    confirmText: 'Delete Book',
                    variant: 'danger',
                    isLoading: false,
                    action: async () => {
                      setConfirmConfig((prev) => ({ ...prev, isLoading: true }));
                      try {
                        await onDeleteProject?.(project.id);
                      } catch (err) {
                        setConfirmConfig({
                          isOpen: true,
                          title: 'Delete Failed',
                          message: err.message || 'Could not delete this book.',
                          confirmText: 'Dismiss',
                          variant: 'danger',
                          isLoading: false,
                          action: () => setConfirmConfig((prev) => ({ ...prev, isOpen: false }))
                        });
                      }
                    }
                  })
              }
            ]}
          />

          <div className="h-4 w-px bg-obsidian-700/60 mx-1 flex-shrink-0" />

          <ThemeToggle />

          {onOpenSettings && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onOpenSettings}
              title="Settings"
              aria-label="Settings"
            >
              <SettingsIcon className="w-4 h-4 text-slate-300" />
            </Button>
          )}
        </div>
      </header>

      {/* 2. Main Workspace Layout: Navigator (224px) + Reader Canvas (flex-1) + Processing Drawer */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Left Column: Compact Page Navigator Sidebar */}
        <PageNavigatorSidebar
          project={project}
          pages={pages}
          activePageNumber={activePageNumber}
          isOpen={isPageNavOpen}
          onToggle={() => setIsPageNavOpen(!isPageNavOpen)}
          onSelectPage={onSelectPage}
          onAddPage={onAddPage}
          onDeletePage={onDeletePage}
          onDeletePages={onDeletePages}
          onRegeneratePage={(pageNum, mode) => onRegeneratePage?.(project.id, pageNum, mode)}
        />

        {/* Center Column: Reading Area with Content-Contained Toolbar & Player */}
        <main className="flex-1 flex flex-col min-w-0 h-full overflow-hidden relative @container">
          {/* Reader Content Toolbar */}
          <div className="h-11 border-b border-obsidian-700/70 bg-obsidian-850/90 px-3 sm:px-4 flex items-center justify-between flex-shrink-0 z-20 gap-2">
            {/* Left: Sidebar toggle + compact page stepper */}
            <div className="flex items-center gap-1 flex-shrink-0">
              <Button
                variant={isPageNavOpen ? 'secondary' : 'ghost'}
                size="icon-sm"
                icon={isPageNavOpen ? PanelLeftClose : PanelLeft}
                onClick={() => setIsPageNavOpen((prev) => !prev)}
                aria-pressed={isPageNavOpen}
                title={`${isPageNavOpen ? 'Hide' : 'Show'} page navigator (P)`}
                aria-label="Toggle page navigator"
                className="flex-shrink-0"
              />

              <div className="hidden @[640px]:flex items-center gap-0.5 pl-1 border-l border-obsidian-700/60 flex-shrink-0">
                <Button
                  variant="ghost"
                  size="icon-xs"
                  icon={ChevronLeft}
                  disabled={activePageNumber <= 0}
                  onClick={() => onSelectPage?.(Math.max(0, activePageNumber - 1))}
                  title="Previous page (Left Arrow)"
                  aria-label="Previous page"
                />
                <span className="text-xs font-mono tabular-nums text-slate-300 px-1 whitespace-nowrap">
                  <span className="hidden @[960px]:inline">Page </span>
                  {activePageNumber + 1}
                  <span className="text-slate-500"> / {totalPages}</span>
                </span>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  icon={ChevronRight}
                  disabled={activePageNumber + 1 >= totalPages}
                  onClick={() => onSelectPage?.(Math.min(totalPages - 1, activePageNumber + 1))}
                  title="Next page (Right Arrow)"
                  aria-label="Next page"
                />
              </div>
            </div>

            {/* Center: Standardized View Mode Tabs */}
            <div className="flex items-center p-0.5 rounded-lg bg-obsidian-750 border border-obsidian-700/60 flex-shrink-0">
              <button
                type="button"
                onClick={() => setViewMode('refined')}
                className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                  viewMode === 'refined'
                    ? 'btn-primary-token font-semibold shadow-2xs'
                    : 'text-slate-400 hover:text-slate-100'
                }`}
                title="Readable narration view (Default)"
              >
                <BookOpen className="w-3.5 h-3.5" />
                <span>Narration</span>
              </button>

              <button
                type="button"
                onClick={() => setViewMode('canvas')}
                className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                  viewMode === 'canvas'
                    ? 'btn-primary-token font-semibold shadow-2xs'
                    : 'text-slate-400 hover:text-slate-100'
                }`}
                title="Original PDF page view"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Original PDF</span>
              </button>

              <button
                type="button"
                onClick={() => setViewMode('raw')}
                className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                  viewMode === 'raw'
                    ? 'btn-primary-token font-semibold shadow-2xs'
                    : 'text-slate-400 hover:text-slate-100'
                }`}
                title="Raw OCR extracted text view"
              >
                <ScanText className="w-3.5 h-3.5" />
                <span>Extracted text</span>
              </button>
            </div>

            {/* Right: Contextual View Controls (Zoom on Canvas, Search/Typography/Appearance/Rules on Text) */}
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {viewMode === 'canvas' ? (
                <CanvasZoomToolbar
                  zoom={canvasZoom}
                  setZoom={setCanvasZoom}
                  fitMode="width"
                  setFitMode={() => {}}
                  onReset={() => setCanvasZoom(100)}
                />
              ) : (
                <>
                  <div className="hidden @[720px]:flex items-center relative">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2 pointer-events-none" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Find in page…"
                      aria-label="Find text in loaded pages"
                      className="h-7 w-28 @[920px]:w-40 pl-7 pr-7 rounded-lg bg-obsidian-750 border border-obsidian-700/80 text-xs text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30"
                    />
                    {searchQuery && (
                      <button
                        type="button"
                        onClick={() => setSearchQuery('')}
                        aria-label="Clear find query"
                        title="Clear find query"
                        className="absolute right-0 top-0 h-7 w-7 inline-flex items-center justify-center text-slate-400 hover:text-slate-100 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  <div className="hidden @[580px]:flex items-center">
                    <FontSizeStepper
                      settings={readerSettings}
                      updateSetting={updateReaderSetting}
                    />
                  </div>

                  <Button
                    variant="ghost"
                    size="xs"
                    icon={Replace}
                    onClick={() => setIsRulesOpen(true)}
                    title="Text replacement rules"
                    className="hidden @[820px]:inline-flex text-slate-300"
                  >
                    Rules
                  </Button>
                </>
              )}

              <ReaderCustomizer
                settings={readerSettings}
                updateSetting={updateReaderSetting}
                onReset={resetReaderSettings}
                iconOnly
              />
            </div>
          </div>

          {/* Continuous Document Viewer */}
          <ContinuousDocumentViewer
            project={project}
            pages={pages}
            activePageNumber={activePageNumber}
            playingPageNumber={playingPageNumber}
            viewMode={viewMode}
            onSelectPage={onSelectPage}
            readerSettings={readerSettings}
            canvasZoom={canvasZoom}
            searchQuery={searchQuery}
            playbackTime={playbackTime}
            activeParagraphIndex={activeParagraphIndex}
            activeSpan={activeSpan}
            onEditPageText={handleEditPageText}
            onOcrPage={handleOcrPage}
            onRefinePage={handleRefinePage}
            onSynthesizePage={handleSynthesizePage}
            onRegeneratePage={(pageNum, mode) => onRegeneratePage?.(project.id, pageNum, mode)}
            activeRuns={activeRuns}
            stages={pipelineStages}
          />

          {/* Dedicated Audio Player Bar Contained within Content Area */}
          <AudioPlayerBar
            project={project}
            projectId={project.id}
            pages={pages}
            currentAudioUrl={audioUrl}
            downloadUrl={audioDownloadUrl}
            fullAudioUrl={audioFullUrl}
            audioArchiveUrl={audioArchiveUrl}
            pageNumber={activePageNumber}
            totalPages={totalPages}
            isReady={activePage.status === 'ready'}
            onSelectPage={onSelectPage}
            onPrevPage={() => {
              if (activePageNumber > 0) onSelectPage(activePageNumber - 1);
            }}
            onNextPage={() => {
              if (activePageNumber + 1 < totalPages) onSelectPage(activePageNumber + 1);
            }}
            onTimeUpdate={(currentTime, duration, currentPlayingPageNum) => {
              setPlaybackTime(currentTime);
              setPlaybackDuration(duration);
              if (typeof currentPlayingPageNum === 'number') {
                setPlayingPageNumber(currentPlayingPageNum);
              }
            }}
          />
        </main>

        {/* Right Column: Processing Panel (Collapsible per Section 5.A & 5.E) */}
        {inspectorOpen && (
          <PipelineInspector
            project={project}
            pages={pages}
            activePageNumber={activePageNumber}
            logs={logs}
            systemHealth={systemHealth}
            stages={pipelineStages}
            activeRuns={activeRuns}
            onStart={(stage) => onStartPipeline(project.id, stage)}
            onPause={(stage) => onPausePipeline(project.id, stage)}
            onResume={(stage) => onResumePipeline(project.id, stage)}
            onStep={(stage) => onStepPipeline(project.id, activePageNumber, stage)}
            onStop={() => onStopPipeline(project.id)}
            onSelectPage={onSelectPage}
            onClearLogs={onClearLogs}
            remoteStatus={remoteStatus}
            onRemoteStart={onRemoteStart}
            onRemoteStop={onRemoteStop}
            width={inspectorWidth}
            onResize={handleInspectorResize}
            onToggle={() => toggleInspector()}
          />
        )}
      </div>

      {/* Modals */}
      <PageTextEditModal
        isOpen={editModalConfig.isOpen}
        onClose={() => setEditModalConfig((prev) => ({ ...prev, isOpen: false }))}
        page={editModalConfig.page}
        mode={editModalConfig.mode}
        onSave={handleSaveEditedText}
      />

      <ShareProjectModal
        isOpen={isShareOpen}
        onClose={() => setIsShareOpen(false)}
        projectId={project.id}
        projectName={project.name}
      />
      <PageManagerModal
        isOpen={isPageManagerOpen}
        onClose={() => setIsPageManagerOpen(false)}
        project={project}
        pages={pages}
        activePageNumber={activePageNumber}
        onSelectPage={onSelectPage}
        onDeletePages={onDeletePages}
      />

      <TextRulesModal
        isOpen={isRulesOpen}
        onClose={() => setIsRulesOpen(false)}
        project={project}
        pageNumber={activePageNumber}
        onApplied={() => onRefreshProject?.()}
      />

      <KeyboardShortcutsModal
        isOpen={isShortcutsOpen}
        onClose={() => setIsShortcutsOpen(false)}
      />

      <ConfirmModal
        isOpen={confirmConfig.isOpen}
        onClose={() => setConfirmConfig((prev) => ({ ...prev, isOpen: false }))}
        onConfirm={confirmConfig.action}
        title={confirmConfig.title}
        message={confirmConfig.message}
        confirmText={confirmConfig.confirmText}
        variant={confirmConfig.variant}
        isLoading={confirmConfig.isLoading}
      />
    </div>
  );
}
