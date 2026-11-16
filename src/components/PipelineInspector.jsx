import React, { useRef, useState } from 'react';
import {
  Play,
  Pause,
  StepForward,
  Square,
  Layers,
  ScanText,
  Sparkles,
  Volume2,
  PanelRightClose,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  RefreshCw,
  Cpu,
  Mic,
  FileText
} from 'lucide-react';
import { Button } from './ui/Button';
import { Badge } from './ui/Badge';
import { SystemMeters } from './inspector/SystemMeters';
import { TtsBackendPanel } from './inspector/TtsBackendPanel';
import { NarrationVoicePanel } from './inspector/NarrationVoicePanel';
import { PageGrid } from './inspector/PageGrid';
import { LogConsole } from './inspector/LogConsole';
import { useVoiceLibrary } from '../lib/useVoiceLibrary';
import { countBuckets, pageStages } from '../lib/pageStages';

const STAGES = [
  {
    id: 'ocr',
    name: 'Extract text',
    short: 'Text',
    icon: ScanText,
    desc: 'Render page and extract text via local OCR / PDF decoder'
  },
  {
    id: 'refine',
    name: 'Prepare narration',
    short: 'Script',
    icon: Sparkles,
    desc: 'Clean headers, page numbers, and format natural script'
  },
  {
    id: 'audio',
    name: 'Generate audio',
    short: 'Audio',
    icon: Volume2,
    desc: 'Synthesize voice narration with cloned narrator'
  }
];


export function PipelineInspector({
  project,
  pages = [],
  activePageNumber = 0,
  logs = [],
  systemHealth,
  stages = {},
  activeRuns = null,
  onStart,
  onPause,
  onResume,
  onStep,
  onStop,
  onSelectPage,
  onClearLogs,
  remoteStatus,
  onRemoteStart,
  onRemoteStop,
  width = 360,
  onResize,
  onToggle
}) {
  const isDraggingRef = useRef(false);
  const [voicesCollapsed, setVoicesCollapsed] = useState(true);
  const [diagnosticsCollapsed, setDiagnosticsCollapsed] = useState(true);

  const handleMouseDown = (e) => {
    e.preventDefault();
    isDraggingRef.current = true;
    const startX = e.clientX;
    const startWidth = width;

    const handleMouseMove = (moveEvent) => {
      if (!isDraggingRef.current) return;
      const delta = startX - moveEvent.clientX;
      const nextWidth = Math.max(280, Math.min(680, startWidth + delta));
      onResize?.(nextWidth);
    };

    const handleMouseUp = () => {
      isDraggingRef.current = false;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const totalPages = pages.length;
  const counts = countBuckets(pages);
  const audioDone = counts.audio || 0;
  const isFullyComplete = totalPages > 0 && audioDone >= totalPages;

  const remaining = {
    ocr: pages.filter((page) => !pageStages(page).ocr).length,
    refine: pages.filter((page) => !pageStages(page).refine).length,
    audio: pages.filter((page) => !pageStages(page).audio).length
  };

  const stageState = (id) => stages?.[id] || 'idle';
  const anyRunning = STAGES.some((s) => stageState(s.id) === 'running');
  const anyPaused = STAGES.some((s) => stageState(s.id) === 'paused');
  const effectiveStatus = anyRunning
    ? 'running'
    : anyPaused
    ? 'paused'
    : isFullyComplete
    ? 'completed'
    : project?.status === 'error'
    ? 'error'
    : 'idle';

  const {
    voices,
    defaults,
    error: voiceError,
    setDefaultVoice
  } = useVoiceLibrary({ enabled: Boolean(project) });

  const [voiceSaving, setVoiceSaving] = useState(false);
  const [voiceNotice, setVoiceNotice] = useState(null);

  const handleVoiceChange = async (language, voiceId) => {
    setVoiceSaving(true);
    setVoiceNotice(null);
    try {
      await setDefaultVoice(language, voiceId);
      setVoiceNotice(`${language.toUpperCase()} voice updated.`);
    } catch (err) {
      setVoiceNotice(err.message);
    } finally {
      setVoiceSaving(false);
    }
  };

  // Single primary control for the whole job, pinned to the panel footer so it stays
  // reachable while the content column scrolls.
  const primaryControl = isFullyComplete ? (
    <div className="p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center gap-2 text-xs font-medium">
      <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
      <span>Audiobook generation complete</span>
    </div>
  ) : anyRunning ? (
    <div className="flex items-center gap-2">
      <Button variant="secondary" size="md" icon={Pause} onClick={() => onPause?.('all')} className="flex-1">
        Pause processing
      </Button>
      <Button
        variant="outline"
        size="md"
        icon={Square}
        onClick={onStop}
        title="Stop processing and clear execution queue"
        className="text-rose-600 dark:text-rose-400"
      >
        Stop
      </Button>
    </div>
  ) : anyPaused ? (
    <div className="flex items-center gap-2">
      <Button variant="primary" size="md" icon={Play} onClick={() => onResume?.('all')} className="flex-1">
        Resume processing
      </Button>
      <Button
        variant="outline"
        size="md"
        icon={Square}
        onClick={onStop}
        title="Stop processing and clear execution queue"
        className="text-rose-600 dark:text-rose-400"
      >
        Stop
      </Button>
    </div>
  ) : (
    <Button
      variant="primary"
      size="md"
      icon={Play}
      onClick={() => onStart?.('all')}
      disabled={!project || isFullyComplete}
      className="w-full"
    >
      Start processing
    </Button>
  );

  return (
    <aside
      aria-label="Processing Panel"
      className="relative flex flex-col h-full flex-shrink-0 bg-obsidian-850 border-l border-obsidian-700/80 text-sm select-none z-20"
      style={{ width: `${width}px` }}
    >
      {/* Draggable resize handle */}
      <div
        onMouseDown={handleMouseDown}
        title="Drag to resize panel"
        className="absolute left-0 top-0 bottom-0 w-1.5 -ml-1 cursor-col-resize hover:bg-indigo-500/50 active:bg-indigo-500 transition-colors z-30"
      />

      {/* Header: Renamed to 'Processing' per Section 5.E */}
      <header className="flex items-center justify-between gap-2 px-4 py-3 border-b border-obsidian-700/80 bg-obsidian-850 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Layers className="w-4 h-4 text-indigo-500 dark:text-indigo-400 flex-shrink-0" />
          <div className="min-w-0">
            <h3 className="font-semibold text-slate-100 text-sm leading-tight truncate">
              Processing
            </h3>
            <p className="text-[11px] text-slate-400 leading-tight truncate tabular-nums">
              {audioDone} of {totalPages} pages narrated
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Badge status={effectiveStatus} size="xs" />
          {onToggle && (
            <Button
              variant="ghost"
              size="icon-xs"
              icon={PanelRightClose}
              onClick={onToggle}
              title="Close Processing panel"
              aria-label="Close Processing panel"
            />
          )}
        </div>
      </header>

      {/* Main scrolling content */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-3.5 space-y-3.5 scroll-slim">
          {/* Stage lanes: all three side by side, no per-stage bars. The
              audio-ready count lives in this one header line, not its own card. */}
        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-2 px-0.5">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
              Stages
            </span>
            <span className="text-[10px] text-slate-500 tabular-nums" title="Pages with finished audio">
              {audioDone}/{totalPages} narrated
            </span>
          </div>

          <div className="grid grid-cols-3 gap-1.5">
            {STAGES.map((stage) => {
              const state = stageState(stage.id);
              const Icon = stage.icon;
              const isRunning = state === 'running';
              const isPaused = state === 'paused';
              const action = isRunning ? onPause : isPaused ? onResume : onStart;
              const left = remaining[stage.id] || 0;
              const completedCount = totalPages - left;
              const isDone = totalPages > 0 && left === 0;
              const workingPage =
                isRunning && typeof activeRuns?.[stage.id] === 'number' ? activeRuns[stage.id] : null;
              const actionLabel = isRunning
                ? `Pause ${stage.name}`
                : isPaused
                ? `Resume ${stage.name}`
                : `Start ${stage.name}`;
              const hint = isRunning
                ? workingPage !== null
                  ? `Page ${workingPage + 1}`
                  : 'Working'
                : isPaused
                ? 'Paused'
                : isDone
                ? 'Complete'
                : `${left} pending`;

              const tone = isRunning
                ? 'border-indigo-500/50 bg-indigo-500/10 text-indigo-950 dark:text-indigo-100'
                : isPaused
                ? 'border-amber-500/50 bg-amber-500/10 text-amber-950 dark:text-amber-100'
                : isDone
                ? 'border-emerald-500/35 bg-emerald-500/[0.08] text-emerald-950 dark:text-emerald-100'
                : 'border-obsidian-700 bg-obsidian-900/50 text-slate-300 hover:border-obsidian-600 hover:bg-obsidian-800/60';

              const iconTone = isRunning
                ? 'text-indigo-600 dark:text-indigo-400'
                : isPaused
                ? 'text-amber-700 dark:text-amber-400'
                : isDone
                ? 'text-emerald-700 dark:text-emerald-400'
                : 'text-slate-400';

              const barFill = isRunning
                ? 'bg-indigo-500'
                : isPaused
                ? 'bg-amber-500'
                : isDone
                ? 'bg-emerald-500'
                : 'bg-indigo-500/60';

              const stagePct = totalPages > 0 ? Math.min(100, Math.round((completedCount / totalPages) * 100)) : 0;
              const StateIcon = isRunning ? Pause : Play;

              return (
                <button
                  key={stage.id}
                  type="button"
                  disabled={!project}
                  onClick={() => action?.(stage.id)}
                  title={`${actionLabel} · ${completedCount}/${totalPages} pages${left > 0 ? ` · ${left} pending` : ''}`}
                  aria-label={actionLabel}
                  className={`group rounded-xl border px-2 py-2 text-left transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 disabled:opacity-50 disabled:pointer-events-none cursor-pointer ${tone}`}
                >
                  <span className="flex items-center gap-1.5 min-w-0">
                    <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${iconTone}`} />
                    <span className="text-[11px] font-medium truncate">{stage.short}</span>
                  </span>
                  <span className="mt-1 flex items-center justify-between gap-1">
                    <span className="font-mono text-[11px] tabular-nums opacity-80">
                      {completedCount}/{totalPages}
                    </span>
                    {isDone && !isRunning && !isPaused ? (
                      <CheckCircle2 className={`w-3.5 h-3.5 flex-shrink-0 ${iconTone}`} />
                    ) : (
                      <StateIcon
                        className={`w-3.5 h-3.5 flex-shrink-0 ${
                          isRunning
                            ? 'text-indigo-600 dark:text-indigo-400'
                            : isPaused
                            ? 'text-amber-700 dark:text-amber-400'
                            : 'opacity-70 group-hover:opacity-100'
                        }`}
                      />
                    )}
                  </span>
                  <span className="mt-1.5 block h-0.5 w-full rounded-full overflow-hidden bg-black/10 dark:bg-white/10">
                    <span
                      className={`block h-full rounded-full transition-all duration-300 ${barFill}`}
                      style={{ width: `${stagePct}%` }}
                    />
                  </span>
                  <span className="sr-only">{hint}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 5. Page map: always visible, fills the panel column instead of hiding in Diagnostics */}
        <PageGrid
          pages={pages}
          activePageNumber={activePageNumber}
          onSelectPage={onSelectPage}
          activeRuns={activeRuns}
          stages={stages}
        />


        {/* 7. Collapsible Project Voices with Clear Copy per Section 5.E & 5.F */}
        <div className="rounded-xl border border-obsidian-700/80 bg-obsidian-900/40 overflow-hidden">
          <button
            type="button"
            onClick={() => setVoicesCollapsed(!voicesCollapsed)}
            className="w-full px-3.5 py-2.5 flex items-center justify-between text-xs font-semibold text-slate-200 hover:bg-obsidian-750/50 transition-colors cursor-pointer"
          >
            <span className="flex items-center gap-2">
              <Mic className="w-3.5 h-3.5 text-indigo-500 dark:text-indigo-400" />
              <span>Project voices</span>
            </span>
            {voicesCollapsed ? (
              <ChevronRight className="w-4 h-4 text-slate-400" />
            ) : (
              <ChevronDown className="w-4 h-4 text-slate-400" />
            )}
          </button>

          {!voicesCollapsed && (
            <div className="p-3 border-t border-obsidian-700/60 space-y-3 bg-obsidian-850">
              <p className="text-[11px] leading-relaxed text-slate-400">
                New audio uses these voices. Existing recordings stay unchanged.
              </p>

              <NarrationVoicePanel
                voices={voices}
                defaults={defaults}
                onChange={handleVoiceChange}
                isBusy={voiceSaving}
                error={voiceError || voiceNotice}
              />
            </div>
          )}
        </div>

        {/* 8. Collapsible Diagnostics per Section 5.E */}
        <div className="rounded-xl border border-obsidian-700/80 bg-obsidian-900/40 overflow-hidden">
          <button
            type="button"
            onClick={() => setDiagnosticsCollapsed(!diagnosticsCollapsed)}
            className="w-full px-3.5 py-2.5 flex items-center justify-between text-xs font-semibold text-slate-200 hover:bg-obsidian-750/50 transition-colors cursor-pointer"
          >
            <span className="flex items-center gap-2">
              <Cpu className="w-3.5 h-3.5 text-slate-400" />
              <span>Diagnostics & stepping</span>
            </span>
            {diagnosticsCollapsed ? (
              <ChevronRight className="w-4 h-4 text-slate-400" />
            ) : (
              <ChevronDown className="w-4 h-4 text-slate-400" />
            )}
          </button>

          {!diagnosticsCollapsed && (
            <div className="p-3 border-t border-obsidian-700/60 space-y-4 bg-obsidian-850">
              {/* Stepping control kept inside Diagnostics per Section 5.F */}
              <div className="flex items-center justify-between gap-2 p-2.5 rounded-lg border border-obsidian-700 bg-obsidian-900/60">
                <div className="min-w-0">
                  <span className="text-xs font-medium text-slate-200 block">Step active page</span>
                  <span className="text-[10px] text-slate-500">Run one stage on page {activePageNumber + 1}</span>
                </div>
                <Button
                  variant="secondary"
                  size="xs"
                  icon={StepForward}
                  onClick={() => onStep?.('all')}
                  disabled={anyRunning}
                >
                  Step
                </Button>
              </div>

              <SystemMeters systemHealth={systemHealth} />

              <TtsBackendPanel
                remoteStatus={remoteStatus}
                onRemoteStart={onRemoteStart}
                onRemoteStop={onRemoteStop}
              />

              <LogConsole logs={logs} onClear={onClearLogs} onSelectPage={onSelectPage} />
            </div>
          )}
        </div>
      </div>

      {/* Pinned footer: primary job control stays visible regardless of scroll */}
      <div className="flex-shrink-0 border-t border-obsidian-700/80 bg-obsidian-850/95 backdrop-blur px-3.5 py-3">
        {primaryControl}
      </div>
    </aside>
  );
}
