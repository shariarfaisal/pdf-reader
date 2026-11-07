import React, { useState } from 'react';
import { AlertCircle, ChevronDown, Cloud, CloudOff, Power, Zap } from 'lucide-react';
import { Button } from '../ui/Button';
import { Tag } from '../ui/Badge';
import { Section } from '../ui/Section';

// Map raw Colab/CLI/fetch failures to a plain next step; raw text stays under "Details".
function describeRemoteError(raw) {
  if (/failed to fetch|networkerror|load failed/i.test(raw)) {
    return "Can't reach the PDF Reader server. Check that it's still running.";
  }
  if (/not installed/i.test(raw)) {
    return 'Google Colab CLI is not installed. Open Settings → TTS Backend & GPU to install it in one click.';
  }
  if (/not connected|not authenticated|authorize your google/i.test(raw)) {
    return 'Google Colab account is not connected yet. Open Settings → TTS Backend & GPU to link your account.';
  }
  if (/appears to be lost|\b40[14]\b/.test(raw)) {
    return 'The Colab session expired. Start the GPU again to create a new one.';
  }
  if (/cooling down/i.test(raw)) {
    return 'The Colab worker is cooling down after a failure. Retry in a moment.';
  }
  if (/heartbeat/i.test(raw)) {
    return 'The GPU connection dropped. Restart the GPU worker.';
  }
  return 'The Colab GPU worker failed to start.';
}

/**
 * Single source of truth for how a remote TTS worker state is presented.
 * The Inspector and the Settings page both render from this, so the pill can
 * never disagree between the two screens.
 */
export function describeBackend(remoteStatus) {
  const state = remoteStatus?.state;
  const isRunning = state === 'running';
  const isStarting = state === 'starting';
  const isError = state === 'error';
  return {
    isRunning,
    isStarting,
    isError,
    tone: isRunning ? 'emerald' : isStarting ? 'amber' : isError ? 'rose' : 'slate',
    pillLabel: isRunning
      ? `Colab ${remoteStatus?.gpu || 'GPU'} live`
      : isStarting
        ? 'Colab starting…'
        : isError
          ? 'Colab error'
          : 'Local · idle'
  };
}

/**
 * Start/Stop controls for the remote GPU worker: live session detail, error
 * surface and the two buttons. Chrome-free so both the Inspector section and a
 * Settings panel can host it.
 */
export function TtsBackendControls({ remoteStatus, onRemoteStart, onRemoteStop }) {
  const [busy, setBusy] = useState(null); // 'start' | 'stop' | null
  const [actionError, setActionError] = useState(null);
  const [showDetails, setShowDetails] = useState(false);

  const { isRunning, isStarting, isError } = describeBackend(remoteStatus);
  const rawError = actionError || (!isRunning && remoteStatus?.lastError) || null;

  const run = async (kind, action) => {
    setBusy(kind);
    setActionError(null);
    try {
      await action?.();
    } catch (error) {
      setActionError(error.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-2.5">
      {isRunning && (
        <div className="rounded-lg bg-obsidian-950/70 border border-obsidian-800 px-2.5 py-1.5 text-[10px] font-mono text-slate-400 leading-relaxed break-words">
          {remoteStatus.session} · tunnel :{remoteStatus.localPort}
          {remoteStatus.modelInfo?.vram_allocated_gb ? ` · VRAM ${remoteStatus.modelInfo.vram_allocated_gb} GB` : ''}
          {remoteStatus.idleRemainingMin !== null && remoteStatus.idleRemainingMin !== undefined
            ? ` · idle stop in ${remoteStatus.idleRemainingMin}m`
            : ''}
          {remoteStatus.lastStats
            ? ` · last ${remoteStatus.lastStats.synthSeconds.toFixed(1)}s → ${remoteStatus.lastStats.audioSeconds.toFixed(1)}s audio`
            : ''}
        </div>
      )}

      {rawError && (
        <div role="alert" className="rounded-lg border border-rose-500/25 bg-rose-500/5 px-2.5 py-2">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-rose-400" aria-hidden="true" />
            <p className="flex-1 text-xs leading-snug text-rose-200">{describeRemoteError(rawError)}</p>
            <button
              type="button"
              onClick={() => setShowDetails((v) => !v)}
              aria-expanded={showDetails}
              className="flex items-center gap-0.5 text-[10px] text-rose-300/80 hover:text-rose-200 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/60"
            >
              Details
              <ChevronDown
                className={`w-3 h-3 transition-transform motion-reduce:transition-none ${showDetails ? 'rotate-180' : ''}`}
                aria-hidden="true"
              />
            </button>
          </div>
          {showDetails && (
            <pre className="mt-2 max-h-24 overflow-auto whitespace-pre-wrap break-words rounded bg-obsidian-950/80 p-2 text-[10px] leading-relaxed font-mono text-rose-200/80 select-text">
              {rawError}
            </pre>
          )}
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          icon={Zap}
          isLoading={busy === 'start'}
          disabled={busy !== null || isRunning || isStarting}
          onClick={() => run('start', onRemoteStart)}
          title="Allocate the Colab GPU runtime and warm the TTS worker"
          className={isError ? 'text-brand-300 border-brand-500/40 hover:border-brand-400' : ''}
        >
          {busy === 'start' ? 'Starting…' : isError ? 'Retry GPU' : 'Start GPU'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          icon={Power}
          isLoading={busy === 'stop'}
          disabled={busy !== null || !(isRunning || isStarting || isError)}
          onClick={() => run('stop', onRemoteStop)}
          title="Stop the Colab runtime and release the GPU"
          className="hover:text-rose-300"
        >
          Stop GPU
        </Button>
      </div>
    </div>
  );
}

/** Inspector sidebar section: status pill in the header, shared controls below. */
export function TtsBackendPanel({ remoteStatus, onRemoteStart, onRemoteStop }) {
  const { isRunning, isStarting, tone, pillLabel } = describeBackend(remoteStatus);

  return (
    <Section
      id="inspector-tts"
      icon={isRunning ? Cloud : CloudOff}
      iconClassName={isRunning ? 'text-emerald-400' : 'text-slate-500'}
      title="TTS backend"
      meta={
        <Tag tone={tone} size="xs" dot={isRunning || isStarting}>
          {pillLabel}
        </Tag>
      }
      bodyClassName="px-3 pt-1 pb-3"
    >
      <TtsBackendControls
        remoteStatus={remoteStatus}
        onRemoteStart={onRemoteStart}
        onRemoteStop={onRemoteStop}
      />
    </Section>
  );
}
