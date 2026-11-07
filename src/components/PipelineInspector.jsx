import React, { useRef } from 'react';
import { Play, Pause, StepForward, Square, Layers, ScanText, Wand2, AudioLines, PanelRightClose } from 'lucide-react';
import { Button } from './ui/Button';
import { Badge } from './ui/Badge';
import { Section } from './ui/Section';
import { SegmentedProgress } from './ui/SegmentedProgress';
import { SystemMeters } from './inspector/SystemMeters';
import { TtsBackendPanel } from './inspector/TtsBackendPanel';
import { NarrationVoicePanel } from './inspector/NarrationVoicePanel';
import { PageGrid } from './inspector/PageGrid';
import { LogConsole } from './inspector/LogConsole';
import { useVoiceLibrary } from '../lib/useVoiceLibrary';
import { FUNNEL, countBuckets, pageStages } from '../lib/pageStages';

// Every stage keeps its own state, so one can run while another is paused.
const STAGE_META = [
  {
    id: 'ocr',
    label: 'OCR',
    hint: 'Render the page and extract its text',
    icon: ScanText,
    dot: 'bg-sky-400'
  },
  {
    id: 'refine',
    label: 'Script',
    hint: 'LLM narration refiner + text replacement rules',
    icon: Wand2,
    dot: 'bg-violet-400'
  },
  {
    id: 'audio',
    label: 'Audio',
    hint: 'Voice synthesis (cloned narrator)',
    icon: AudioLines,
    dot: 'bg-emerald-400'
  }
];

const STATE_STYLE = {
  idle: { label: 'idle', className: 'text-slate-400 border-obsidian-700 bg-obsidian-900/60' },
  running: {
    label: 'running',
    className: 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10 animate-pulse motion-reduce:animate-none'
  },
  paused: { label: 'paused', className: 'text-amber-300 border-amber-500/40 bg-amber-500/10' },
  completed: { label: 'done', className: 'text-brand-300 border-brand-500/40 bg-brand-500/10' }
};

function StageStatePill({ state }) {
  const style = STATE_STYLE[state] || STATE_STYLE.idle;
  return (
    <span
      className={`inline-flex items-center justify-center rounded border px-1.5 h-5 text-[10px] font-medium capitalize ${style.className}`}
    >
      {style.label}
    </span>
  );
}

export function PipelineInspector({
  project,
  pages,
  activePageNumber,
  logs,
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
  width = 384,
  onResize,
  onToggle
}) {
  const isDraggingRef = useRef(false);

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
  const percentReady = totalPages > 0 ? Math.round((counts.audio / totalPages) * 100) : 0;

  // Pages still missing each stage — the number a Start/Pause click will work through.
  const remaining = {
    ocr: pages.filter((page) => !pageStages(page).ocr).length,
    refine: pages.filter((page) => !pageStages(page).refine).length,
    audio: pages.filter((page) => !pageStages(page).audio).length
  };

  const stageState = (id) => stages?.[id] || 'idle';
  const anyRunning = STAGE_META.some((stage) => stageState(stage.id) === 'running');
  const anyPaused = STAGE_META.some((stage) => stageState(stage.id) === 'paused');

  const {
    voices,
    defaults,
    error: voiceError,
    setDefaultVoice
  } = useVoiceLibrary({ enabled: Boolean(project) });

  const [voiceSaving, setVoiceSaving] = React.useState(false);
  const [voiceNotice, setVoiceNotice] = React.useState(null);

  const handleVoiceChange = async (language, voiceId) => {
    setVoiceSaving(true);
    setVoiceNotice(null);
    try {
      await setDefaultVoice(language, voiceId);
      setVoiceNotice(`${language.toUpperCase()} narrator updated.`);
    } catch (err) {
      setVoiceNotice(err.message);
    } finally {
      setVoiceSaving(false);
    }
  };

  return (
    // pb-20 clears the fixed AudioPlayerBar so the log tail is never covered.
    <div
      className="relative flex flex-col h-full flex-shrink-0 bg-obsidian-900 border-l border-obsidian-750 text-sm pb-20 select-none z-20"
      style={{ width: `${width}px` }}
    >
      {/* Draggable resize handle on the left edge */}
      <div
        onMouseDown={handleMouseDown}
        title="Drag to resize Inspector"
        className="absolute left-0 top-0 bottom-0 w-2 -ml-1 cursor-col-resize hover:bg-brand-500/50 active:bg-brand-500 transition-colors z-30"
      />

      <header className="sticky top-0 z-10 flex items-center justify-between gap-2 px-4 py-3 border-b border-obsidian-750 bg-obsidian-850/95 backdrop-blur flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Layers className="w-4 h-4 text-brand-400 flex-shrink-0" aria-hidden="true" />
          <h3 className="font-semibold text-slate-100 text-sm tracking-wide truncate">
            Pipeline Inspector
          </h3>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Badge status={project?.status || 'idle'} size="xs" />
          {onToggle && (
            <Button
              variant="ghost"
              size="icon-xs"
              icon={PanelRightClose}
              onClick={onToggle}
              title="Collapse Inspector"
              aria-label="Collapse Inspector"
            />
          )}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto overflow-x-hidden scroll-slim">

      <Section
        id="inspector-stages"
        icon={Layers}
        iconClassName="text-brand-400"
        title="Pipeline stages"
        meta={
          <span className="tabular-nums">
            {counts.audio}/{totalPages} · {percentReady}%
          </span>
        }
        bodyClassName="px-3 pt-1 pb-3 space-y-2"
      >
        {/* Per-stage controls: start / pause each pipeline stage independently */}
        <div className="rounded-lg border border-obsidian-750 bg-obsidian-950/60 divide-y divide-obsidian-800/80">
          {STAGE_META.map((stage) => {
            const state = stageState(stage.id);
            const Icon = stage.icon;
            const isRunningStage = state === 'running';
            const action = isRunningStage ? onPause : state === 'paused' ? onResume : onStart;
            const ActionIcon = isRunningStage ? Pause : Play;
            const actionLabel = isRunningStage ? 'Pause' : state === 'paused' ? 'Resume' : 'Start';
            const left = remaining[stage.id] || 0;
            // Lanes advance independently: show which page this stage is on.
            const workingPage = isRunningStage && typeof activeRuns?.[stage.id] === 'number' ? activeRuns[stage.id] : null;
            return (
              <div key={stage.id} className="flex items-center gap-2 px-2 py-1.5">
                <Icon className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-semibold text-slate-200">{stage.label}</span>
                    <StageStatePill state={state} />
                  </div>
                  <p className="truncate text-[10px] text-slate-500">
                    {workingPage !== null ? `Page ${workingPage + 1} in flight` : stage.hint}
                  </p>
                </div>
                <span
                  className={`flex-shrink-0 font-mono text-[10px] tabular-nums ${
                    left > 0 ? 'text-slate-400' : 'text-slate-600'
                  }`}
                  title={left > 0 ? `${left} of ${totalPages} pages still need ${stage.label}` : `Every page already has its ${stage.label}`}
                >
                  {left > 0 ? `${left} left` : 'cached'}
                </span>
                <Button
                  variant={isRunningStage ? 'secondary' : 'ghost'}
                  size="icon-sm"
                  icon={ActionIcon}
                  disabled={!project}
                  onClick={() => action?.(stage.id)}
                  title={`${actionLabel} ${stage.label} stage`}
                  aria-label={`${actionLabel} ${stage.label} stage`}
                  className={isRunningStage ? 'text-amber-300 border-amber-500/30 hover:bg-amber-500/10' : 'text-slate-300'}
                />
              </div>
            );
          })}
        </div>

        <p className="text-[10px] leading-snug text-slate-500">
          Lanes run in parallel — OCR keeps walking the book while Script and Audio follow behind it.
        </p>

        <div className="grid grid-cols-3 gap-2">
          <Button
            variant="primary"
            size="sm"
            icon={Play}
            onClick={() => onStart?.('all')}
            disabled={!project}
            title="Run OCR → Script → Audio across all pending pages"
          >
            Start all
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon={Pause}
            onClick={() => onPause?.('all')}
            disabled={!anyRunning}
            title="Pause every running stage"
            className="enabled:text-amber-300 enabled:border-amber-500/30 enabled:hover:bg-amber-500/10"
          >
            Pause all
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon={StepForward}
            onClick={() => onStep?.('all')}
            disabled={anyRunning && !anyPaused}
            title="Process the selected page through every remaining stage once"
          >
            Step
          </Button>
        </div>

        <Button
          variant="secondary"
          size="sm"
          icon={Square}
          onClick={onStop}
          disabled={!anyRunning && !anyPaused}
          title="Stop every stage; finished pages stay cached"
          className="w-full enabled:text-rose-300 enabled:border-rose-500/30 enabled:hover:bg-rose-500/10"
        >
          Stop all
        </Button>

        <div className="pt-1">
          <SegmentedProgress
            label="Pages by completed stage"
            total={totalPages}
            segments={FUNNEL.map((bucket) => ({
              label: `${bucket.label}: ${counts[bucket.key]}`,
              value: counts[bucket.key],
              className: bucket.bar
            }))}
          />
          <ul className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[9px] uppercase tracking-wide text-slate-500">
            {FUNNEL.map((bucket) =>
              counts[bucket.key] > 0 ? (
                <li key={bucket.key} className="flex items-center gap-1">
                  <span className={`h-1.5 w-1.5 rounded-full ${bucket.bar}`} aria-hidden="true" />
                  {bucket.label}
                  <span className="font-mono tabular-nums text-slate-400">{counts[bucket.key]}</span>
                </li>
              ) : null
            )}
          </ul>
        </div>
      </Section>

      <NarrationVoicePanel
        voices={voices}
        defaults={defaults}
        onChange={handleVoiceChange}
        isBusy={voiceSaving}
        error={voiceError || voiceNotice}
      />

      <SystemMeters systemHealth={systemHealth} />

      <TtsBackendPanel
        remoteStatus={remoteStatus}
        onRemoteStart={onRemoteStart}
        onRemoteStop={onRemoteStop}
      />

      <PageGrid
        pages={pages}
        activePageNumber={activePageNumber}
        onSelectPage={onSelectPage}
        activeRuns={activeRuns}
        stages={stages}
      />

      <LogConsole logs={logs} onClear={onClearLogs} onSelectPage={onSelectPage} />
      </div>
    </div>
  );
}
