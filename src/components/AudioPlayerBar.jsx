import React, { useRef, useState, useEffect, useMemo } from 'react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  Volume1,
  VolumeX,
  Download,
  Headphones,
  Eye,
  FileAudio,
  Archive
} from 'lucide-react';
import { Button } from './ui/Button';
import { DropdownMenu } from './ui/DropdownMenu';
import { triggerDownload } from '../lib/download';
import {
  GlobalAudioProvider,
  useAudioPlayer,
  useAudioPlayerOptional,
  SPEED_OPTIONS,
  hasPageAudio,
  buildAudioUrl,
  findPlayableInPages,
  computeBookTimeline,
  formatAudioTime,
  SkipSecondsIcon,
  EqualizerBars,
  AudioScrubber,
  readListeningPosition
} from '../lib/audioPlayerContext';

export function AudioPlayerBar(props) {
  const existingCtx = useAudioPlayerOptional();
  if (!existingCtx) {
    return (
      <GlobalAudioProvider
        onAutoFollowPage={(_projId, _prevPage, nextPage) => {
          props.onSelectPage?.(nextPage);
        }}
      >
        <AudioPlayerBarInner {...props} />
      </GlobalAudioProvider>
    );
  }
  return <AudioPlayerBarInner {...props} />;
}

function AudioPlayerBarInner({
  project,
  projectId,
  pages = [],
  downloadUrl,
  fullAudioUrl,
  audioArchiveUrl,
  pageNumber = 0, // current viewing page number (0-based)
  totalPages = 1,
  onSelectPage,
  onPrevPage,
  onNextPage,
  onTimeUpdate
}) {
  const {
    session,
    currentAudioUrl: globalAudioUrl,
    isPlaying: globalIsPlaying,
    currentTime: globalCurrentTime,
    duration: globalDuration,
    playbackRate,
    volume,
    isMuted,
    timeline: globalTimeline,
    bookPosition: globalBookPosition,
    seekTotal: globalSeekTotal,
    syncWorkspaceProject,
    playProjectPage,
    resumeProject,
    togglePlay,
    skipSeconds,
    applySeek,
    stepPlayablePage,
    changeSpeed,
    changeVolume,
    toggleMute
  } = useAudioPlayer();

  const resolvedProject = useMemo(
    () => project || { id: projectId, name: 'Book', page_count: totalPages },
    [project, projectId, totalPages]
  );

  // Sync workspace pages & viewing page when idle or viewing the active book
  useEffect(() => {
    if (projectId) {
      syncWorkspaceProject(resolvedProject, pages, pageNumber);
    }
  }, [projectId, resolvedProject, pages, pageNumber, syncWorkspaceProject]);

  const isThisBookSession = session.projectId === projectId;
  const isPlaying = isThisBookSession ? globalIsPlaying : false;

  const orderedLocalPages = useMemo(
    () => [...pages].sort((a, b) => a.page_number - b.page_number),
    [pages]
  );

  // Saved listening position of this book: used both as the idle display and as
  // the start point of a cold playback start (resume where the user left off).
  const savedResumePage = useMemo(() => {
    const saved = readListeningPosition(projectId);
    if (!saved) return null;
    const pageObj = orderedLocalPages.find((p) => p.page_number === saved.page);
    return hasPageAudio(pageObj) ? { ...saved, pageObj } : null;
  }, [projectId, orderedLocalPages]);

  // While this book is not the live playback session, the player presents the
  // saved position instead of the viewed page (so Play resumes, not restarts).
  const isLiveSession = isThisBookSession && session.isActive;
  const idleResume = isLiveSession ? null : savedResumePage;
  const playingPageNumber = isLiveSession
    ? session.playingPageNumber
    : idleResume?.page ?? pageNumber;
  const currentTime = isLiveSession ? globalCurrentTime : idleResume?.time ?? 0;
  const duration = isLiveSession ? globalDuration : 0;

  // Report playback time and playing page number back to ProjectWorkspace for paragraph sync
  useEffect(() => {
    if (isThisBookSession) {
      onTimeUpdate?.(currentTime, duration, playingPageNumber);
    } else {
      onTimeUpdate?.(0, 0, pageNumber);
    }
  }, [isThisBookSession, currentTime, duration, playingPageNumber, pageNumber, onTimeUpdate]);

  const localTimeline = useMemo(
    () => computeBookTimeline(orderedLocalPages),
    [orderedLocalPages]
  );

  const timeline = isThisBookSession ? globalTimeline : localTimeline;
  const bookPosition = isThisBookSession
    ? globalBookPosition
    : localTimeline.entries.find((e) => e.pageNumber === playingPageNumber)?.start || 0;
  const seekTotal = isThisBookSession
    ? globalSeekTotal
    : localTimeline.total > 0
    ? localTimeline.total
    : 0;

  const viewingPageObj = useMemo(
    () => orderedLocalPages.find((p) => p.page_number === pageNumber) || null,
    [orderedLocalPages, pageNumber]
  );

  const playingPageObj = useMemo(
    () => orderedLocalPages.find((p) => p.page_number === playingPageNumber) || viewingPageObj,
    [orderedLocalPages, playingPageNumber, viewingPageObj]
  );

  const effectiveAudioUrl = isThisBookSession
    ? globalAudioUrl || buildAudioUrl(projectId, playingPageObj)
    : buildAudioUrl(projectId, playingPageObj);

  const hasAnyPlayable = useMemo(
    () => orderedLocalPages.some((p) => hasPageAudio(p)),
    [orderedLocalPages]
  );

  const canPlay = Boolean(effectiveAudioUrl || hasAnyPlayable);

  const hasPrev = useMemo(
    () => findPlayableInPages(orderedLocalPages, playingPageNumber, -1) !== null,
    [orderedLocalPages, playingPageNumber]
  );

  const hasNext = useMemo(
    () => findPlayableInPages(orderedLocalPages, playingPageNumber, 1) !== null,
    [orderedLocalPages, playingPageNumber]
  );

  const isDifferentViewingPage = pageNumber !== playingPageNumber;
  const canPlayViewingPage = isDifferentViewingPage && hasPageAudio(viewingPageObj);

  const controlsRef = useRef(null);
  const [isSpeedMenuOpen, setIsSpeedMenuOpen] = useState(false);
  const [isVolumeSliderOpen, setIsVolumeSliderOpen] = useState(false);

  // Close speed/volume popovers on outside click or Escape
  useEffect(() => {
    if (!isSpeedMenuOpen && !isVolumeSliderOpen) return;
    const close = () => {
      setIsSpeedMenuOpen(false);
      setIsVolumeSliderOpen(false);
    };
    const onPointerDown = (e) => {
      if (!controlsRef.current?.contains(e.target)) close();
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isSpeedMenuOpen, isVolumeSliderOpen]);

  // Container-width awareness
  const barRef = useRef(null);
  const [barWidth, setBarWidth] = useState(0);

  useEffect(() => {
    const el = barRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect?.width ?? 0;
      setBarWidth((prev) => (Math.abs(prev - next) > 1 ? next : prev));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const tier = barWidth === 0 || barWidth > 560 ? 'full' : barWidth > 400 ? 'compact' : 'tiny';

  const pageTotalDuration = duration > 0 ? duration : playingPageObj?.audio_duration || 0;
  const pageTimeLabel = `${formatAudioTime(currentTime)} / ${formatAudioTime(pageTotalDuration)}`;
  const bookTimeLabel =
    timeline.total > 0
      ? `${formatAudioTime(bookPosition)} / ${formatAudioTime(timeline.total)}`
      : null;

  const currentPosition = timeline.total > 0 ? bookPosition : currentTime;
  const currentTimeLabel = formatAudioTime(currentTime);

  const VolumeIcon = isMuted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  const handleTogglePlay = () => {
    if (!isLiveSession) {
      // Cold start: resume the persisted track + timestamp when available.
      if (savedResumePage) resumeProject(resolvedProject, orderedLocalPages);
      else playProjectPage(resolvedProject, orderedLocalPages, pageNumber);
    } else {
      togglePlay(resolvedProject, orderedLocalPages, playingPageNumber);
    }
  };

  return (
    <div
      role="region"
      aria-label="Audiobook Player"
      ref={barRef}
      className="relative flex-shrink-0 h-16 z-40 bg-obsidian-850 border-t border-obsidian-700/80 px-3 sm:px-4 shadow-lg"
    >
      {/* Scrub bar on top edge */}
      <AudioScrubber
        seekTotal={seekTotal}
        currentPosition={currentPosition}
        onApplySeek={(ratio, commit) => applySeek(ratio, commit, resolvedProject, orderedLocalPages)}
        label={timeline.total > 0 ? 'Book playback position' : 'Page playback position'}
        title={timeline.total > 0 ? 'Seek across book narration' : 'Seek within page audio'}
        className="absolute inset-x-0 -top-1.5 h-3"
      />

      <div className="h-full flex items-center gap-3">
        {/* Left: playing page + page time + total book duration + Follow / Play viewed page */}
        <div className="flex-1 min-w-0 flex items-center gap-2 sm:gap-2.5 overflow-hidden">
          {tier === 'full' && (
            isPlaying ? (
              <EqualizerBars isPlaying={true} className="text-indigo-500 dark:text-indigo-400 flex-shrink-0" />
            ) : (
              <Headphones className="w-4 h-4 flex-shrink-0 text-indigo-500 dark:text-indigo-400" />
            )
          )}
          <div className="min-w-0 leading-tight">
            <div className="text-xs font-semibold text-slate-100 whitespace-nowrap truncate">
              Page {playingPageNumber + 1}
              {tier === 'full' && (
                <span className="font-normal text-slate-400"> of {totalPages}</span>
              )}
            </div>
            <div className="flex items-center gap-2 text-[11px] text-slate-400 font-mono tabular-nums whitespace-nowrap">
              <span>{tier === 'full' ? pageTimeLabel : currentTimeLabel}</span>
              {tier === 'full' && bookTimeLabel && (
                <span className="hidden lg:inline text-slate-500">
                  · Book {bookTimeLabel}
                </span>
              )}
            </div>
          </div>

          {isDifferentViewingPage && tier !== 'tiny' && (
            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                type="button"
                onClick={() => onSelectPage?.(playingPageNumber)}
                title={`Viewing page ${pageNumber + 1} — jump back to playing page ${playingPageNumber + 1}`}
                aria-label="Follow the playing page"
                className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md bg-indigo-500/10 border border-indigo-500/25 text-[11px] font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-500/20 transition-colors cursor-pointer whitespace-nowrap"
              >
                <Eye className="w-3 h-3" />
                {tier === 'full' ? `Follow p. ${playingPageNumber + 1}` : null}
              </button>

              {canPlayViewingPage && tier === 'full' && (
                <button
                  type="button"
                  onClick={() => playProjectPage(resolvedProject, orderedLocalPages, pageNumber)}
                  title={`Switch playback to currently viewed page ${pageNumber + 1}`}
                  aria-label={`Play page ${pageNumber + 1}`}
                  className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md bg-obsidian-750 border border-obsidian-700 text-[11px] font-medium text-slate-200 hover:border-indigo-500/50 hover:text-indigo-300 transition-colors cursor-pointer whitespace-nowrap"
                >
                  <Play className="w-2.5 h-2.5 fill-current" />
                  <span>Play p. {pageNumber + 1}</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Center: transport */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={!hasPrev}
            onClick={() => {
              const prev = stepPlayablePage(-1, resolvedProject, orderedLocalPages, playingPageNumber);
              if (prev === null) onPrevPage?.();
            }}
            title="Previous narrated page"
            aria-label="Previous narrated page"
          >
            <SkipBack className="w-4 h-4" />
          </Button>

          <Button
            variant="ghost"
            size="icon-sm"
            disabled={!effectiveAudioUrl}
            onClick={() => skipSeconds(-10)}
            title="Back 10 seconds (J)"
            aria-label="Skip back 10 seconds"
          >
            <SkipSecondsIcon direction="back" />
          </Button>

          <Button
            variant="primary"
            size="icon-lg"
            disabled={!canPlay}
            onClick={handleTogglePlay}
            className="!rounded-full mx-1"
            title={isPlaying ? 'Pause (Space)' : 'Play narration (Space)'}
            aria-label={isPlaying ? 'Pause narration' : 'Play narration'}
          >
            {isPlaying ? (
              <Pause className="w-4 h-4 fill-current" />
            ) : (
              <Play className="w-4 h-4 fill-current translate-x-px" />
            )}
          </Button>

          <Button
            variant="ghost"
            size="icon-sm"
            disabled={!effectiveAudioUrl}
            onClick={() => skipSeconds(10)}
            title="Forward 10 seconds (L)"
            aria-label="Skip forward 10 seconds"
          >
            <SkipSecondsIcon direction="forward" />
          </Button>

          <Button
            variant="ghost"
            size="icon-sm"
            disabled={!hasNext}
            onClick={() => {
              const next = stepPlayablePage(1, resolvedProject, orderedLocalPages, playingPageNumber);
              if (next === null) onNextPage?.();
            }}
            title="Next narrated page"
            aria-label="Next narrated page"
          >
            <SkipForward className="w-4 h-4" />
          </Button>
        </div>

        {/* Right: speed, volume, download */}
        <div
          ref={controlsRef}
          className="flex-1 min-w-0 flex items-center justify-end gap-1"
        >
          <div className={`relative ${tier === 'tiny' ? 'hidden' : ''}`}>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsSpeedMenuOpen((prev) => !prev)}
              className="font-mono tabular-nums min-w-[2.75rem]"
              title="Playback speed"
              aria-label={`Playback speed ${playbackRate}x`}
              aria-expanded={isSpeedMenuOpen}
            >
              {playbackRate}x
            </Button>
            {isSpeedMenuOpen && (
              <div
                className="absolute bottom-full mb-2 right-0 bg-obsidian-850 border border-obsidian-700/80 rounded-xl shadow-lg py-1 w-28 z-50 animate-fade-in"
                role="menu"
              >
                {SPEED_OPTIONS.map((rate) => (
                  <button
                    key={rate}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      changeSpeed(rate);
                      setIsSpeedMenuOpen(false);
                    }}
                    className={`w-full text-left px-3 py-1.5 text-xs font-mono flex items-center justify-between transition cursor-pointer ${
                      playbackRate === rate
                        ? 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 font-semibold'
                        : 'text-slate-200 hover:bg-obsidian-750'
                    }`}
                  >
                    <span>{rate}x</span>
                    {rate === 1.0 && <span className="text-[10px] text-slate-400">normal</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div
            className={`relative flex items-center ${tier === 'tiny' ? 'hidden' : ''}`}
            onMouseEnter={() => setIsVolumeSliderOpen(true)}
            onMouseLeave={() => setIsVolumeSliderOpen(false)}
          >
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={toggleMute}
              title={isMuted ? 'Unmute (M)' : `Mute (M) — ${Math.round(volume * 100)}%`}
              aria-label={isMuted ? 'Unmute' : 'Mute'}
              aria-pressed={isMuted}
            >
              <VolumeIcon className={`w-4 h-4 ${isMuted || volume === 0 ? 'text-rose-500' : ''}`} />
            </Button>
            {isVolumeSliderOpen && (
              <div className="absolute bottom-full right-0 pb-2 z-50 animate-fade-in">
                <div className="bg-obsidian-850 border border-obsidian-700/80 rounded-xl shadow-lg p-2.5 w-32 flex flex-col gap-1.5">
                  <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
                    <span>Vol</span>
                    <span className="text-slate-100">
                      {isMuted ? 'Muted' : `${Math.round(volume * 100)}%`}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={isMuted ? 0 : volume}
                    onChange={(e) => changeVolume(parseFloat(e.target.value))}
                    className="w-full accent-indigo-500 h-1.5 bg-obsidian-700 rounded-lg appearance-none cursor-pointer"
                    aria-label="Volume slider"
                  />
                </div>
              </div>
            )}
          </div>

          <DropdownMenu
            icon={Download}
            variant="ghost"
            size="icon-sm"
            align="right"
            side="top"
            showChevron={false}
            title="Download audio"
            items={[
              {
                label: 'Full audiobook (.mp3)',
                description: 'All pages merged into one continuous audio file',
                icon: FileAudio,
                disabled: !pages.some((p) => p.audio_path),
                onSelect: () => {
                  triggerDownload(fullAudioUrl || `/api/projects/${projectId}/audio-full`);
                }
              },
              {
                label: `Page ${pageNumber + 1} audio (.wav)`,
                description: 'Single audio file for current viewing page',
                icon: Volume2,
                disabled: !downloadUrl,
                onSelect: () => {
                  triggerDownload(downloadUrl);
                }
              },
              { divider: true },
              {
                label: 'All pages archive (.tar.gz)',
                description: 'Archive of individual WAV files per page',
                icon: Archive,
                disabled: !pages.some((p) => p.audio_path),
                onSelect: () => {
                  triggerDownload(audioArchiveUrl || `/api/projects/${projectId}/audio-archive`);
                }
              }
            ]}
          />
        </div>
      </div>
    </div>
  );
}
