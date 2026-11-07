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
  SlidersHorizontal,
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
  Sun,
  Moon
} from 'lucide-react';
import { Button } from './ui/Button';
import { Badge, Tag } from './ui/Badge';
import { Card } from './ui/Card';
import { DropdownMenu } from './ui/DropdownMenu';
import { ConfirmModal } from './ui/ConfirmModal';
import { ThemeToggle } from './ui/ThemeToggle';
import { PipelineInspector } from './PipelineInspector';
import { AudioPlayerBar } from './AudioPlayerBar';
import { PageNavigatorSidebar } from './PageNavigatorSidebar';
import { PageManagerModal } from './PageManagerModal';
import { PageTextEditModal } from './PageTextEditModal';
import { KeyboardShortcutsModal } from './KeyboardShortcutsModal';
import { TextRulesModal } from './TextRulesModal';
import { ContinuousDocumentViewer } from './ContinuousDocumentViewer';
import { buildSyncMap, compactSpanToRaw, markIndexAt, parseTimings } from '../lib/audioSync';
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
  // Tabs: 'refined' (Default narration view) | 'canvas' (Main PDF) | 'raw' (Raw OCR)
  const [viewMode, setViewMode] = useState('refined');

  // Sidebar visibility states
  const [isPageNavOpen, setIsPageNavOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [inspectorWidth, setInspectorWidth] = useState(() => {
    try {
      const saved = localStorage.getItem('pdf-reader-inspector-width');
      return saved ? Math.max(280, Math.min(680, Number(saved))) : 384;
    } catch {
      return 384;
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

  // Canvas zoom state
  const [canvasZoom, setCanvasZoom] = useState(100);
  const [canvasFitMode, setCanvasFitMode] = useState('width');

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

  const totalPages = project?.page_count || pages.length || 1;

  // Compute active paragraph highlight based on relative playback progress
  const paragraphs = useMemo(() => {
    const raw = viewMode === 'raw' ? activePage.raw_text : activePage.refined_text;
    return (raw || '').split('\n\n').filter(Boolean);
  }, [viewMode, activePage.raw_text, activePage.refined_text]);

  // Exact sentence marks reported by the TTS engine, matched to these paragraphs.
  const syncEntries = useMemo(
    () => buildSyncMap(paragraphs, parseTimings(activePage)),
    [paragraphs, activePage.audio_timings]
  );

  const activeMark = useMemo(() => {
    const index = markIndexAt(syncEntries, playbackTime);
    return index >= 0 ? syncEntries[index] : null;
  }, [syncEntries, playbackTime]);

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
        setInspectorOpen((prev) => !prev);
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
  const hasAnyAudio = pages.some((p) => p.audio_path);

  /** Run a regeneration request with polished ConfirmModal */
  const requestRegenerate = (scope, mode) => {
    let stageLabel = 'refined narration and synthesized audio';
    let confirmText = 'Regenerate';
    let variant = 'warning';

    if (mode === 'audio') {
      stageLabel = 'synthesized audio (keeping OCR and script intact)';
      confirmText = 'Re-synthesize Audio';
      variant = 'default';
    } else if (mode === 'ocr') {
      stageLabel = 'OCR text, narration script and audio (re-extracting text from PDF)';
      confirmText = 'Re-run OCR';
      variant = 'warning';
    } else if (mode === 'full') {
      stageLabel = 'OCR text, refined narration and synthesized audio';
      confirmText = 'Rebuild All';
      variant = 'danger';
    }

    const title =
      scope === 'page'
        ? `Regenerate Page ${activePageNumber + 1}?`
        : `Regenerate Entire Book (${totalPages} pages)?`;

    const message =
      scope === 'page'
        ? `This clears ${stageLabel} for Page ${activePageNumber + 1} and restarts its pipeline.`
        : `This clears ${stageLabel} for every page in "${project.name}" and restarts the pipeline from page 1. Existing cached assets for these stages will be overwritten.`;

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

  const handleEditPageText = (pageNumber, mode, currentText) => {
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
    <div className="flex flex-col h-screen bg-obsidian-950 text-slate-100 overflow-hidden select-none">
      {/* Top Header Toolbar */}
      <header className="h-14 border-b border-obsidian-750 bg-obsidian-900 px-4 flex items-center justify-between flex-shrink-0 z-30 gap-3">
        {/* Left Section: Back, Page Navigator Toggle, Title */}
        <div className="flex items-center gap-2.5 min-w-0">
          <Button
            variant="ghost"
            size="sm"
            icon={ArrowLeft}
            onClick={onBack}
            className="flex-shrink-0 whitespace-nowrap"
          >
            Library
          </Button>

          <Button
            variant={isPageNavOpen ? 'secondary' : 'ghost'}
            size="icon-sm"
            icon={isPageNavOpen ? PanelLeftClose : PanelLeft}
            onClick={() => setIsPageNavOpen(!isPageNavOpen)}
            title="Toggle Page Navigator sidebar (P)"
            aria-label="Toggle Page Navigator sidebar"
            className="flex-shrink-0"
          />

          <div className="h-4 w-px bg-obsidian-750 flex-shrink-0" />

          <h2
            className="font-semibold text-slate-100 text-sm truncate max-w-[160px] sm:max-w-xs md:max-w-sm lg:max-w-md"
            title={project.name}
          >
            {project.name}
          </h2>

          <Badge status={project.status} size="xs" className="flex-shrink-0 hidden sm:inline-flex" />
        </div>

        {/* Center Section: View Mode Tabs (Default: Refined Narration) */}
        <div className="flex items-center p-1 rounded-xl bg-obsidian-950/80 border border-obsidian-750 flex-shrink-0">
          <button
            type="button"
            onClick={() => setViewMode('refined')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-all ${
              viewMode === 'refined'
                ? 'bg-brand-500 text-obsidian-950 shadow-sm font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
            title="AI-refined readable narration (Default)"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Refined Narration</span>
          </button>

          <button
            type="button"
            onClick={() => setViewMode('canvas')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-all ${
              viewMode === 'canvas'
                ? 'bg-brand-500 text-obsidian-950 shadow-sm font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
            title="Rendered PDF pages"
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Main PDF</span>
          </button>

          <button
            type="button"
            onClick={() => setViewMode('raw')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-all ${
              viewMode === 'raw'
                ? 'bg-brand-500 text-obsidian-950 shadow-sm font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
            title="Raw extracted OCR text"
          >
            <ScanText className="w-3.5 h-3.5" />
            <span>Raw OCR</span>
          </button>
        </div>

        {/* Right Section: Content controls, Theme Toggle, Regenerate, Inspector Toggle */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {/* Zoom controls when on Main PDF Canvas */}
          {viewMode === 'canvas' && (
            <div className="flex items-center gap-1 bg-obsidian-850 border border-obsidian-750 rounded-lg p-0.5">
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => setCanvasZoom((z) => Math.max(50, z - 15))}
                title="Zoom Out"
              >
                -
              </Button>
              <span className="text-[11px] font-mono px-1 text-slate-300">
                {canvasZoom}%
              </span>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => setCanvasZoom((z) => Math.min(250, z + 15))}
                title="Zoom In"
              >
                +
              </Button>
            </div>
          )}

          {/* Font Size Stepper when in text modes */}
          {viewMode !== 'canvas' && (
            <FontSizeStepper
              settings={readerSettings}
              updateSetting={updateReaderSetting}
            />
          )}

          {/* Reader Customizer Popover (Theme, Font, Spacing) */}
          <ReaderCustomizer
            settings={readerSettings}
            updateSetting={updateReaderSetting}
            onReset={resetReaderSettings}
          />

          {/* Find & replace text rules */}
          <Button
            variant="ghost"
            size="sm"
            icon={Replace}
            title="Find & replace text rules in narration"
            onClick={() => setIsRulesOpen(true)}
            className="hidden lg:inline-flex"
          >
            Replace
          </Button>

          {/* Regenerate Dropdown */}
          <DropdownMenu
            label="Regenerate"
            icon={RefreshCw}
            variant="ghost"
            size="sm"
            title="Re-run text refinement and audio generation"
            items={[
              {
                label: `Page ${activePageNumber + 1} — Audio Only`,
                description: 'Synthesizes audio from existing narration script.',
                icon: Volume2,
                onSelect: () => requestRegenerate('page', 'audio')
              },
              {
                label: `Page ${activePageNumber + 1} — Script + Audio`,
                description: 'Keeps cached OCR text; re-refines narration and synthesizes audio.',
                icon: Sparkles,
                onSelect: () => requestRegenerate('page', 'narration')
              },
              {
                label: `Page ${activePageNumber + 1} — OCR Only`,
                description: 'Re-extracts text from PDF (stops before LLM & audio).',
                icon: ScanText,
                onSelect: () => requestRegenerate('page', 'ocr')
              },
              {
                label: `Page ${activePageNumber + 1} — Full Rebuild`,
                description: 'Re-extracts text from the PDF, then refines and synthesizes again.',
                icon: RefreshCw,
                onSelect: () => requestRegenerate('page', 'full')
              },
              { divider: true },
              {
                label: 'Whole Book — Audio Only',
                description: 'Synthesizes audio for all pages from existing scripts.',
                icon: Volume2,
                onSelect: () => requestRegenerate('project', 'audio')
              },
              {
                label: 'Whole Book — Narration + Audio',
                description: 'Keeps cached OCR; re-refines and re-synthesizes every page.',
                icon: Sparkles,
                onSelect: () => requestRegenerate('project', 'narration')
              },
              {
                label: 'Whole Book — Full (All Stages)',
                description: 'Clears every cache layer and rebuilds the book from the PDF.',
                icon: RotateCcw,
                danger: true,
                onSelect: () => requestRegenerate('project', 'full')
              }
            ]}
          />

          {/* Download all audio */}
          <Button
            variant="ghost"
            size="sm"
            icon={Download}
            disabled={!hasAnyAudio}
            title={
              hasAnyAudio
                ? 'Download all page audio as a .tar.gz archive'
                : 'No audio synthesized yet'
            }
            onClick={() => {
              window.location.href = audioArchiveUrl;
            }}
            className="hidden sm:inline-flex"
          >
            Download
          </Button>

          {/* Light / Dark Theme Toggle */}
          <ThemeToggle />

          <div className="h-4 w-px bg-obsidian-750 mx-1 flex-shrink-0" />

          {/* Inspector Panel Toggle Button */}
          <Button
            variant={inspectorOpen ? 'secondary' : 'outline'}
            size="sm"
            icon={SlidersHorizontal}
            title="Toggle Pipeline Inspector (I)"
            onClick={() => setInspectorOpen(!inspectorOpen)}
          >
            Inspector
          </Button>

          {/* API usage */}
          {onOpenUsage && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onOpenUsage}
              title="API Usage & Cost"
              aria-label="API Usage & Cost"
            >
              <Activity className="w-4 h-4 text-slate-300" />
            </Button>
          )}

          {/* Keyboard Shortcuts */}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setIsShortcutsOpen(true)}
            title="Keyboard Shortcuts (?)"
            aria-label="Keyboard Shortcuts"
          >
            <Keyboard className="w-4 h-4 text-slate-400 hover:text-brand-300" />
          </Button>

          {/* Settings */}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onOpenSettings}
            title="Engine Settings"
            aria-label="Engine Settings"
          >
            <SettingsIcon className="w-4 h-4 text-slate-300" />
          </Button>
        </div>
      </header>

      {/* Main Workspace Layout */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Left Column: Collapsible Page Navigator Sidebar */}
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

        {/* Center Column: Continuous Scroll PDF-Style Document Viewer */}
        <main className="flex-1 flex flex-col min-w-0 h-full overflow-hidden relative">
          <ContinuousDocumentViewer
            project={project}
            pages={pages}
            activePageNumber={activePageNumber}
            viewMode={viewMode}
            onSelectPage={onSelectPage}
            readerSettings={readerSettings}
            canvasZoom={canvasZoom}
            playbackTime={playbackTime}
            activeParagraphIndex={activeParagraphIndex}
            activeMark={activeMark}
            onEditPageText={handleEditPageText}
            onRefinePage={handleRefinePage}
            onSynthesizePage={handleSynthesizePage}
          />
        </main>

        {/* Right Column: Collapsible & Resizable Pipeline Inspector */}
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
            onToggle={() => setInspectorOpen(false)}
          />
        )}
      </div>

      {/* Bottom Floating Audio Player */}
      <AudioPlayerBar
        projectId={project.id}
        pages={pages}
        currentAudioUrl={audioUrl}
        downloadUrl={audioDownloadUrl}
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
        onTimeUpdate={(currentTime, duration) => {
          setPlaybackTime(currentTime);
          setPlaybackDuration(duration);
        }}
      />

      {/* Page Text Editor Modal */}
      <PageTextEditModal
        isOpen={editModalConfig.isOpen}
        onClose={() => setEditModalConfig((prev) => ({ ...prev, isOpen: false }))}
        page={editModalConfig.page}
        mode={editModalConfig.mode}
        onSave={handleSaveEditedText}
      />

      {/* Find & Replace Rules Modal */}
      <TextRulesModal
        isOpen={isRulesOpen}
        onClose={() => setIsRulesOpen(false)}
        project={project}
        pageNumber={activePageNumber}
        onApplied={() => onRefreshProject?.()}
      />

      {/* Keyboard Shortcuts Modal */}
      <KeyboardShortcutsModal
        isOpen={isShortcutsOpen}
        onClose={() => setIsShortcutsOpen(false)}
      />

      {/* Confirmation Modal */}
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
