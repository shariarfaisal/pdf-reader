import React, { useState, useEffect, useRef, useMemo } from 'react';
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
  Boxes
} from 'lucide-react';
import { Button } from './ui/Button';
import { Badge, Tag } from './ui/Badge';
import { Card } from './ui/Card';
import { DropdownMenu } from './ui/DropdownMenu';
import { ConfirmModal } from './ui/ConfirmModal';
import { PipelineInspector } from './PipelineInspector';
import { AudioPlayerBar } from './AudioPlayerBar';
import { PageManagerModal } from './PageManagerModal';
import { KeyboardShortcutsModal } from './KeyboardShortcutsModal';
import { TextRulesModal } from './TextRulesModal';
import {
  ReaderCustomizer,
  CanvasZoomToolbar,
  FontSizeStepper,
  useReaderSettings
} from './ReaderCustomizer';

export function ProjectWorkspace({
  project,
  pages,
  activePageNumber,
  logs,
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
  pipelineStages,
  activeRuns
}) {
  const [viewMode, setViewMode] = useState('refined'); // 'refined' | 'raw'
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [isPageManagerOpen, setIsPageManagerOpen] = useState(false);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  const [isRulesOpen, setIsRulesOpen] = useState(false);
  const [playbackTime, setPlaybackTime] = useState(0);
  const [playbackDuration, setPlaybackDuration] = useState(0);

  // Canvas zoom state
  const [canvasZoom, setCanvasZoom] = useState(100);
  const [canvasFitMode, setCanvasFitMode] = useState('width'); // 'width' | 'page' | 'custom'

  // Text editing state for Raw OCR and Refined Narration
  const [isEditingText, setIsEditingText] = useState(false);
  const [editText, setEditText] = useState('');
  const [isSavingText, setIsSavingText] = useState(false);
  const [saveNotice, setSaveNotice] = useState(null);
  const editTextareaRef = useRef(null);

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
  const { settings: readerSettings, updateSetting: updateReaderSetting, resetSettings: resetReaderSettings } =
    useReaderSettings();

  const readingContainerRef = useRef(null);
  const activeParagraphRef = useRef(null);

  const activePage = pages.find((p) => p.page_number === activePageNumber) || {
    page_number: activePageNumber,
    status: 'pending',
    page_type: 'pdf',
    raw_text: '',
    refined_text: ''
  };

  const isCustomPage = activePage.page_type === 'custom';
  const totalPages = project?.page_count || pages.length || 1;

  // Reset edit state when page or viewMode changes
  useEffect(() => {
    setIsEditingText(false);
    setSaveNotice(null);
  }, [activePageNumber, viewMode]);

  // Compute active paragraph highlight based on relative playback progress
  const paragraphs = useMemo(() => {
    const raw = viewMode === 'raw' ? activePage.raw_text : activePage.refined_text;
    return (raw || '').split('\n\n').filter(Boolean);
  }, [viewMode, activePage.raw_text, activePage.refined_text]);

  const activeParagraphIndex = useMemo(() => {
    if (playbackDuration > 0 && paragraphs.length > 0) {
      const fraction = playbackTime / playbackDuration;
      return Math.min(paragraphs.length - 1, Math.floor(fraction * paragraphs.length));
    }
    return -1;
  }, [playbackTime, playbackDuration, paragraphs.length]);

  // Auto-scroll to active paragraph if enabled
  useEffect(() => {
    if (readerSettings.autoScroll && activeParagraphRef.current) {
      activeParagraphRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest'
      });
    }
  }, [activeParagraphIndex, readerSettings.autoScroll]);

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
        const themes = ['obsidian', 'midnight', 'sepia', 'oled'];
        const currentIdx = themes.indexOf(readerSettings.theme);
        const nextTheme = themes[(currentIdx + 1) % themes.length];
        updateReaderSetting('theme', nextTheme);
      } else if (e.key.toLowerCase() === 'v') {
        e.preventDefault();
        setViewMode((prev) => (prev === 'refined' ? 'raw' : 'refined'));
      } else if (e.key.toLowerCase() === 'i') {
        e.preventDefault();
        setInspectorOpen((prev) => !prev);
      } else if (e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setIsPageManagerOpen(true);
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

  // Rendered image URL for active page
  const pageImageUrl = isCustomPage
    ? null
    : `/api/projects/${project.id}/pages/${activePage.page_number}/image?v=${activePage.updated_at || 0}`;

  // Font family resolution
  const hasBengali = /[\u0980-\u09FF]/.test(activePage.refined_text || activePage.raw_text || '');
  const hasArabic = /[\u0600-\u06FF]/.test(activePage.refined_text || activePage.raw_text || '');

  let readingFontClass = 'font-sans';
  if (readerSettings.fontFamily === 'auto') {
    if (hasBengali) readingFontClass = 'font-bengali-reading';
    else if (hasArabic) readingFontClass = 'font-arabic-reading';
  } else if (readerSettings.fontFamily === 'serif') {
    readingFontClass = 'font-serif-reading';
  } else if (readerSettings.fontFamily === 'bengali') {
    readingFontClass = 'font-bengali-reading';
  } else if (readerSettings.fontFamily === 'arabic') {
    readingFontClass = 'font-arabic-reading';
  } else if (readerSettings.fontFamily === 'mono') {
    readingFontClass = 'font-mono';
  }

  const lineHeightVal =
    readerSettings.lineHeight === 'compact'
      ? 1.5
      : readerSettings.lineHeight === 'relaxed'
      ? 2.2
      : 1.85;

  const contentWidthClass =
    readerSettings.contentWidth === 'compact'
      ? 'max-w-xl mx-auto'
      : readerSettings.contentWidth === 'reading'
      ? 'max-w-3xl mx-auto'
      : 'w-full';

  const highlightClass =
    readerSettings.highlightStyle === 'warm'
      ? 'reader-highlight-warm'
      : readerSettings.highlightStyle === 'subtle'
      ? 'reader-highlight-subtle'
      : 'reader-highlight-glow';

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

  const startEditing = () => {
    const current = viewMode === 'raw' ? (activePage.raw_text || '') : (activePage.refined_text || '');
    setEditText(current);
    setIsEditingText(true);
    setSaveNotice(null);
    setTimeout(() => {
      if (editTextareaRef.current) {
        editTextareaRef.current.focus();
      }
    }, 50);
  };

  const cancelEditing = () => {
    setIsEditingText(false);
    setSaveNotice(null);
  };

  const saveText = async ({ andSynthesize = false, andRefine = false } = {}) => {
    if (!onUpdatePageText) return;
    setIsSavingText(true);
    setSaveNotice(null);
    try {
      if (viewMode === 'raw') {
        await onUpdatePageText(activePageNumber, {
          rawText: editText,
          clearRefined: andRefine,
          clearAudio: andRefine
        });
        setSaveNotice({ type: 'success', message: 'Raw text saved.' });
        setIsEditingText(false);
        if (andRefine) {
          await onStepPipeline(project.id, activePageNumber, 'refine');
        }
      } else {
        await onUpdatePageText(activePageNumber, {
          refinedText: editText,
          clearAudio: andSynthesize
        });
        setSaveNotice({ type: 'success', message: 'Narration script saved.' });
        setIsEditingText(false);
        if (andSynthesize) {
          await onStepPipeline(project.id, activePageNumber, 'audio');
        }
      }
    } catch (err) {
      setSaveNotice({ type: 'error', message: err.message || 'Save failed' });
    } finally {
      setIsSavingText(false);
    }
  };

  const handleSynthesizeCurrentPage = async () => {
    try {
      await onRegeneratePage(project.id, activePageNumber, 'audio');
    } catch (err) {
      console.error('Synthesize page failed:', err);
    }
  };

  const handleRefineCurrentPage = async () => {
    try {
      await onRegeneratePage(project.id, activePageNumber, 'narration');
    } catch (err) {
      console.error('Refine page failed:', err);
    }
  };

  const handleOcrCurrentPage = async () => {
    try {
      await onRegeneratePage(project.id, activePageNumber, 'ocr');
    } catch (err) {
      console.error('OCR page failed:', err);
    }
  };

  const insertTag = (tag) => {
    if (!editTextareaRef.current) {
      setEditText((prev) => `${prev} ${tag}`);
      return;
    }
    const el = editTextareaRef.current;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const text = el.value;
    const before = text.substring(0, start);
    const after = text.substring(end);
    const spacerBefore = before.length && !before.endsWith(' ') ? ' ' : '';
    const spacerAfter = after.length && !after.startsWith(' ') ? ' ' : '';
    const next = `${before}${spacerBefore}${tag}${spacerAfter}${after}`;
    setEditText(next);
    setTimeout(() => {
      const pos = start + spacerBefore.length + tag.length + spacerAfter.length;
      el.focus();
      el.setSelectionRange(pos, pos);
    }, 10);
  };

  return (
    <div className="flex flex-col h-screen bg-obsidian-950 text-slate-100 overflow-hidden select-none">
      {/* Top Navbar: Clean, spacious, uncrowded */}
      <header className="h-14 border-b border-obsidian-800 bg-obsidian-900/90 backdrop-blur px-4 flex items-center justify-between flex-shrink-0 z-30 gap-4">
        {/* Left Side: Navigation & Project Identity */}
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <Button
            variant="ghost"
            size="sm"
            icon={ArrowLeft}
            onClick={onBack}
            className="flex-shrink-0 whitespace-nowrap"
          >
            Library
          </Button>
          <div className="h-4 w-px bg-obsidian-700 flex-shrink-0" />
          <h2
            className="font-semibold text-slate-100 text-sm truncate max-w-sm lg:max-w-md xl:max-w-lg"
            title={project.name}
          >
            {project.name}
          </h2>
          <Badge status={activePage.status} size="xs" className="flex-shrink-0" />
        </div>

        {/* Right Side: Global Tools & Navigation */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {/* Appearance & Layout Popover */}
          <ReaderCustomizer
            settings={readerSettings}
            updateSetting={updateReaderSetting}
            onReset={resetReaderSettings}
          />

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
                description: 'Keeps OCR & script; re-synthesizes voice audio.',
                icon: Volume2,
                onSelect: () => requestRegenerate('page', 'audio')
              },
              {
                label: `Page ${activePageNumber + 1} — Narration + Audio`,
                description: 'Keeps OCR text; re-refines narration and re-synthesizes audio.',
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

          {/* Pages Manager */}
          <Button
            variant="ghost"
            size="sm"
            icon={ListOrdered}
            title="Manage pages & insert custom text (P)"
            onClick={() => setIsPageManagerOpen(true)}
          >
            Pages
          </Button>

          {/* Find / replace rules (project-wide or this page) */}
          <Button
            variant="ghost"
            size="sm"
            icon={Replace}
            title="Find & replace text in the narration — project-wide or this page"
            onClick={() => setIsRulesOpen(true)}
          >
            Replace
          </Button>

          {/* Models Navigation */}
          {onOpenModels && (
            <Button
              variant="ghost"
              size="sm"
              icon={Boxes}
              title="Local AI Model Hub"
              onClick={onOpenModels}
            >
              Models
            </Button>
          )}

          {/* Voices Navigation */}
          {onOpenVoices && (
            <Button
              variant="ghost"
              size="sm"
              icon={Mic}
              title="Voice cloning studio & voice library"
              onClick={onOpenVoices}
            >
              Voices
            </Button>
          )}

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
          >
            Download
          </Button>

          <div className="h-4 w-px bg-obsidian-700/80 mx-1 flex-shrink-0" />

          {/* Inspector Panel Toggle */}
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
        {/* Left Column: Visual PDF Canvas (Controlled by layoutMode) */}
        {readerSettings.layoutMode !== 'text-focused' && (
          <div
            className={`flex flex-col border-r border-obsidian-800/80 bg-obsidian-950 overflow-hidden transition-all duration-200 ${
              readerSettings.layoutMode === 'canvas-focused' ? 'flex-[2]' : 'flex-1'
            }`}
          >
            {project.status === 'idle' && pages.some((p) => p.status !== 'ready') && (
              <div className="px-4 py-1.5 text-[11px] text-amber-300/90 bg-amber-500/5 border-b border-amber-500/20 flex items-center gap-1.5 flex-shrink-0">
                <Info className="w-3.5 h-3.5 flex-shrink-0" />
                <span>
                  Idle — opening a project never starts processing. Press{' '}
                  <strong>Start</strong> in the Inspector when ready.
                </span>
              </div>
            )}

            {/* Canvas Sub-Header: Clean Zoom Controls & Page Stepper */}
            <div className="px-4 py-2 bg-obsidian-900/70 border-b border-obsidian-800/60 flex items-center justify-between text-xs text-slate-400 flex-shrink-0 gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-medium flex items-center gap-1.5 text-slate-300">
                  {isCustomPage ? (
                    <Type className="w-3.5 h-3.5 text-purple-400 flex-shrink-0" />
                  ) : (
                    <FileText className="w-3.5 h-3.5 text-brand-400 flex-shrink-0" />
                  )}
                  <span className="whitespace-nowrap">
                    {isCustomPage ? 'Custom Page' : 'PDF Canvas'}
                  </span>
                </span>
                {activePage.ocr_source && activePage.ocr_source !== 'none' && (
                  <Tag tone="slate" size="xs" className="font-mono uppercase hidden sm:inline-flex">
                    {activePage.ocr_source}
                  </Tag>
                )}
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                {/* Canvas Zoom Toolbar */}
                {!isCustomPage && (
                  <CanvasZoomToolbar
                    zoom={canvasZoom}
                    setZoom={setCanvasZoom}
                    fitMode={canvasFitMode}
                    setFitMode={setCanvasFitMode}
                    onReset={() => {
                      setCanvasZoom(100);
                      setCanvasFitMode('width');
                    }}
                  />
                )}

                {/* Page Navigation Stepper */}
                <div className="flex items-center bg-obsidian-950/80 border border-obsidian-800 rounded-lg p-0.5">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Previous page (Left Arrow)"
                    title="Previous page (Left Arrow)"
                    disabled={activePageNumber === 0}
                    onClick={() => onSelectPage(activePageNumber - 1)}
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </Button>
                  <span className="font-mono text-slate-300 text-xs px-2 tabular-nums">
                    {activePageNumber + 1} / {totalPages}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Next page (Right Arrow)"
                    title="Next page (Right Arrow)"
                    disabled={activePageNumber + 1 >= totalPages}
                    onClick={() => onSelectPage(activePageNumber + 1)}
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            </div>

            {/* Visual Canvas Display */}
            <div className="flex-1 overflow-auto p-4 flex items-center justify-center bg-obsidian-950/80">
              {isCustomPage ? (
                <div className="max-w-xl w-full bg-obsidian-900 border border-purple-500/25 rounded-xl p-6 self-start shadow-xl">
                  <div className="flex items-center justify-between mb-3 pb-3 border-b border-obsidian-700/70">
                    <span className="text-[10px] uppercase tracking-wide font-semibold text-purple-300 flex items-center gap-1.5">
                      <Type className="w-3.5 h-3.5" />
                      Custom text page — narrated directly, no OCR
                    </span>
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => setIsPageManagerOpen(true)}
                    >
                      Edit Text
                    </Button>
                  </div>
                  <p
                    className="text-slate-200 whitespace-pre-wrap leading-relaxed select-text"
                    style={{ fontSize: `${readerSettings.fontSize}px` }}
                  >
                    {activePage.raw_text ||
                      'This custom page is empty. Open Pages → Edit to paste its text.'}
                  </p>
                </div>
              ) : (
                <div
                  className="rounded-lg overflow-hidden border border-obsidian-800 bg-black flex items-center justify-center shadow-2xl transition-all duration-150"
                  style={{
                    width:
                      canvasFitMode === 'width'
                        ? '100%'
                        : canvasFitMode === 'page'
                        ? 'auto'
                        : `${canvasZoom}%`,
                    maxHeight: canvasFitMode === 'page' ? '100%' : 'none'
                  }}
                >
                  <img
                    src={pageImageUrl}
                    alt={`Page ${activePageNumber + 1}`}
                    className="w-full h-auto object-contain block select-none"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                      const fallback = e.currentTarget.parentElement?.querySelector(
                        '.fallback-placeholder'
                      );
                      if (fallback) fallback.style.display = 'flex';
                    }}
                  />
                  <div className="fallback-placeholder hidden flex-col items-center justify-center p-8 text-center text-slate-500 min-h-[360px]">
                    <FileText className="w-12 h-12 mb-3 text-slate-600" />
                    <p className="text-sm font-medium text-slate-400">
                      Page image not yet rendered
                    </p>
                    <p className="text-xs text-slate-500 mt-1 max-w-xs">
                      Press <strong>Start</strong> or <strong>Step 1</strong> in the pipeline inspector to rasterize and extract this page.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Center/Right Column: Reading Canvas (Controlled by layoutMode & theme) */}
        {readerSettings.layoutMode !== 'canvas-focused' && (
          <div
            className={`flex flex-col overflow-hidden pb-24 transition-colors duration-200 reader-theme-${readerSettings.theme} ${
              readerSettings.layoutMode === 'text-focused' ? 'flex-1' : 'flex-1'
            }`}
          >
            {/* Reading View Header: View Toggle Pills, Action Buttons & Quick Font Sizer */}
            <div className="px-6 py-2 bg-obsidian-900/60 border-b border-obsidian-800/80 flex items-center justify-between text-xs text-slate-400 flex-shrink-0 gap-3 flex-wrap">
              {/* Left Side: View Mode or Editing Badge */}
              <div className="flex items-center gap-2">
                {isEditingText ? (
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-brand-300 flex items-center gap-1.5 text-xs bg-brand-500/10 border border-brand-500/25 px-2.5 py-1 rounded-md">
                      <Edit3 className="w-3.5 h-3.5 text-brand-400" />
                      Editing {viewMode === 'raw' ? 'Raw OCR Text' : 'Narration Script'}
                    </span>
                    {viewMode === 'refined' && (
                      <div className="hidden lg:flex items-center gap-1 text-[11px] text-slate-400">
                        <span className="text-slate-500 mr-0.5">Tags:</span>
                        {['[sigh]', '[laughter]', '[confirmation-en]', '[question-en]', '[surprise-ah]'].map((tag) => (
                          <button
                            key={tag}
                            type="button"
                            onClick={() => insertTag(tag)}
                            className="font-mono text-[10.5px] px-1.5 py-0.5 rounded bg-obsidian-800 border border-obsidian-700 hover:border-brand-500/40 hover:text-brand-300 text-slate-300 transition"
                            title={`Insert ${tag} into script`}
                          >
                            {tag}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    {/* Text View Switcher */}
                    <div className="flex bg-obsidian-950/80 p-0.5 rounded-lg border border-obsidian-800 text-xs">
                      <button
                        type="button"
                        onClick={() => setViewMode('refined')}
                        className={`h-6 px-2.5 rounded font-medium transition ${
                          viewMode === 'refined'
                            ? 'bg-obsidian-800 text-brand-300 shadow-sm'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        Refined Narration
                      </button>
                      <button
                        type="button"
                        onClick={() => setViewMode('raw')}
                        className={`h-6 px-2.5 rounded font-medium transition ${
                          viewMode === 'raw'
                            ? 'bg-obsidian-800 text-brand-300 shadow-sm'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        Raw OCR
                      </button>
                    </div>

                    {activePage.ocr_source === 'manual_edit' && (
                      <Tag tone="amber" size="xs">
                        edited
                      </Tag>
                    )}
                  </div>
                )}
              </div>

              {/* Right Side: Actions & Sizer */}
              <div className="flex items-center gap-2 sm:gap-3 ml-auto">
                {isEditingText ? (
                  <>
                    <span className="text-slate-500 text-[11px] hidden md:inline font-mono">
                      {editText.trim().split(/\s+/).filter(Boolean).length} words • {editText.length} chars
                    </span>
                    <Button
                      variant="ghost"
                      size="xs"
                      icon={X}
                      onClick={cancelEditing}
                      disabled={isSavingText}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="secondary"
                      size="xs"
                      icon={Check}
                      onClick={() => saveText()}
                      loading={isSavingText}
                      title="Save text changes to database"
                    >
                      Save
                    </Button>
                    {viewMode === 'refined' ? (
                      <Button
                        variant="primary"
                        size="xs"
                        icon={Volume2}
                        onClick={() => saveText({ andSynthesize: true })}
                        loading={isSavingText}
                        title="Save script and immediately synthesize voice audio"
                      >
                        Save &amp; Synthesize Audio
                      </Button>
                    ) : (
                      <Button
                        variant="primary"
                        size="xs"
                        icon={Sparkles}
                        onClick={() => saveText({ andRefine: true })}
                        loading={isSavingText}
                        title="Save raw text and immediately refine narration script with LLM"
                      >
                        Save &amp; Refine Script
                      </Button>
                    )}
                  </>
                ) : (
                  <>
                    <Button
                      variant="secondary"
                      size="xs"
                      icon={Edit3}
                      onClick={startEditing}
                      title={`Edit ${viewMode === 'raw' ? 'raw OCR text' : 'refined narration script'}`}
                    >
                      Edit {viewMode === 'raw' ? 'Raw' : 'Script'}
                    </Button>

                    {viewMode === 'refined' && activePage.refined_text && (
                      <Button
                        variant="ghost"
                        size="xs"
                        icon={Volume2}
                        onClick={handleSynthesizeCurrentPage}
                        title="Synthesize audio narration from this script"
                      >
                        Synthesize Audio
                      </Button>
                    )}

                    {viewMode === 'raw' && activePage.raw_text && (
                      <Button
                        variant="ghost"
                        size="xs"
                        icon={Sparkles}
                        onClick={handleRefineCurrentPage}
                        title="Refine narration script from this raw text"
                      >
                        Refine Script
                      </Button>
                    )}

                    <div className="h-3.5 w-px bg-obsidian-750 hidden sm:block" />

                    <FontSizeStepper
                      settings={readerSettings}
                      updateSetting={updateReaderSetting}
                    />
                    <span className="text-slate-500 text-[11px] hidden sm:inline">
                      {paragraphs.length} paragraphs •{' '}
                      {(activePage.refined_text || activePage.raw_text || '').length} chars
                    </span>
                  </>
                )}
              </div>
            </div>

            {/* Reading Text Container or Editor */}
            {isEditingText ? (
              <div className="flex-1 flex flex-col p-6 sm:p-8 max-w-4xl mx-auto w-full overflow-y-auto">
                {saveNotice && (
                  <div
                    className={`mb-3 p-2.5 rounded-lg text-xs flex items-center justify-between ${
                      saveNotice.type === 'error'
                        ? 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                        : 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                    }`}
                  >
                    <span>{saveNotice.message}</span>
                    <button
                      type="button"
                      onClick={() => setSaveNotice(null)}
                      className="text-slate-400 hover:text-white ml-2"
                    >
                      ×
                    </button>
                  </div>
                )}
                <div className="flex items-center justify-between text-[11.5px] text-slate-400 mb-2">
                  <span className="font-medium text-slate-300">
                    {viewMode === 'raw'
                      ? 'Raw OCR Text (extracted from PDF)'
                      : 'Narration Script (spoken by voice model)'}
                  </span>
                  {viewMode === 'refined' && (
                    <span className="text-slate-500 text-[11px]">
                      Tip: You can use non-verbal tags like <code className="text-brand-300 font-mono">[sigh]</code> or <code className="text-brand-300 font-mono">[laughter]</code>
                    </span>
                  )}
                </div>
                <textarea
                  ref={editTextareaRef}
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  className={`w-full flex-1 min-h-[380px] p-4 bg-obsidian-900 border border-obsidian-750 focus:border-brand-500/50 rounded-xl text-slate-100 focus:outline-none focus:ring-1 focus:ring-brand-500/30 font-sans leading-relaxed resize-y ${readingFontClass}`}
                  style={{
                    fontSize: `${readerSettings.fontSize}px`,
                    lineHeight: lineHeightVal
                  }}
                  placeholder={
                    viewMode === 'raw'
                      ? 'Enter raw text for this page...'
                      : 'Enter refined narration script for this page...'
                  }
                />
              </div>
            ) : (
              <div
                ref={readingContainerRef}
                className="flex-1 overflow-y-auto px-6 sm:px-10 py-8 select-text"
              >
                <div className={`${contentWidthClass} space-y-4`}>
                  {paragraphs.length === 0 ? (
                    <div className="text-center py-24 text-slate-500">
                      <div className="w-12 h-12 rounded-2xl bg-obsidian-800 border border-obsidian-700 flex items-center justify-center mx-auto mb-3">
                        <Sparkles className="w-6 h-6 text-slate-400" />
                      </div>
                      <p className="text-sm font-medium text-slate-300">
                        {viewMode === 'raw'
                          ? 'Raw OCR text not extracted yet'
                          : 'Narration script not refined yet'}
                      </p>
                      <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1.5 leading-relaxed">
                        {viewMode === 'raw' ? (
                          <>
                            Click{' '}
                            <button
                              type="button"
                              onClick={handleOcrCurrentPage}
                              className="text-brand-300 underline font-medium"
                            >
                              Extract OCR
                            </button>{' '}
                            or{' '}
                            <button
                              type="button"
                              onClick={startEditing}
                              className="text-brand-300 underline font-medium"
                            >
                              type text manually
                            </button>
                            .
                          </>
                        ) : (
                          <>
                            Click{' '}
                            <button
                              type="button"
                              onClick={handleRefineCurrentPage}
                              className="text-brand-300 underline font-medium"
                            >
                              Refine Script
                            </button>{' '}
                            or{' '}
                            <button
                              type="button"
                              onClick={startEditing}
                              className="text-brand-300 underline font-medium"
                            >
                              write script manually
                            </button>
                            .
                          </>
                        )}
                      </p>
                    </div>
                  ) : (
                    paragraphs.map((para, pIdx) => {
                      const isHighlight = pIdx === activeParagraphIndex;
                      return (
                        <p
                          key={pIdx}
                          ref={isHighlight ? activeParagraphRef : null}
                          className={`transition-all duration-200 ${readingFontClass} ${
                            isHighlight
                              ? `${highlightClass} font-medium text-white shadow-sm`
                              : 'opacity-90 hover:opacity-100'
                          }`}
                          style={{
                            fontSize: `${readerSettings.fontSize}px`,
                            lineHeight: lineHeightVal
                          }}
                        >
                          {para}
                        </p>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Right Column: Pipeline Inspector Drawer */}
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
          />
        )}
      </div>

      {/* Floating Audio Player (Continuous book narration) */}
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

      {/* Page Manager Modal */}
      <PageManagerModal
        isOpen={isPageManagerOpen}
        onClose={() => setIsPageManagerOpen(false)}
        project={project}
        pages={pages}
        activePageNumber={activePageNumber}
        onAddPage={onAddPage}
        onUpdatePageText={onUpdatePageText}
        onDeletePage={onDeletePage}
        onDeletePages={onDeletePages}
        onSelectPage={onSelectPage}
      />

      {/* Find & Replace rules */}
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

      {/* Custom Confirmation Modal */}
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
