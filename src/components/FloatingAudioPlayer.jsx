import React, { useState, useRef, useEffect } from 'react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  Volume1,
  VolumeX,
  BookOpen,
  Minimize2,
  Maximize2,
  X
} from 'lucide-react';
import { Button } from './ui/Button';
import {
  useAudioPlayer,
  SPEED_OPTIONS,
  formatAudioTime,
  SkipSecondsIcon,
  EqualizerBars,
  AudioScrubber
} from '../lib/audioPlayerContext';

function MiniBookCover({ projectId, updatedAt, title, isPlaying, size = 'md' }) {
  const [failed, setFailed] = useState(false);
  const src = `/api/projects/${projectId}/pages/0/preview?v=${updatedAt || 0}`;
  const dims = size === 'sm' ? 'w-7 h-9' : 'w-8 h-10';

  return (
    <div
      className={`relative ${dims} flex-shrink-0 rounded-md overflow-hidden border border-obsidian-700 bg-obsidian-900 shadow-2xs`}
    >
      {failed ? (
        <div className="w-full h-full flex items-center justify-center bg-obsidian-750 text-indigo-400">
          <BookOpen className="w-3.5 h-3.5" />
        </div>
      ) : (
        <img
          src={src}
          alt={title || 'Book cover'}
          onError={() => setFailed(true)}
          className="w-full h-full object-cover object-top"
        />
      )}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-[2px] bg-indigo-500 opacity-85" />
      {isPlaying && (
        <div className="pointer-events-none absolute inset-0 bg-obsidian-950/55 flex items-center justify-center text-indigo-300">
          <EqualizerBars isPlaying={true} />
        </div>
      )}
    </div>
  );
}

/**
 * Compact floating audio player shown when an audio session is active outside
 * the currently playing project's dedicated reader bar (e.g. Library, Settings,
 * or while inspecting a different book).
 *
 * Supports two compact modes:
 * - 'center': floating island centered at bottom (max-w 580px)
 * - 'corner': compact mini-pill tucked into bottom-right corner (max-w 340px)
 */
export function FloatingAudioPlayer({
  currentRouteProjectId = null,
  onOpenPlayingPage
}) {
  const {
    session,
    currentAudioUrl,
    prevPlayablePageNumber,
    nextPlayablePageNumber,
    isPlaying,
    currentTime,
    duration,
    playbackRate,
    volume,
    isMuted,
    floatingPosition,
    timeline,
    bookPosition,
    seekTotal,
    togglePlay,
    stopAndDismiss,
    skipSeconds,
    applySeek,
    stepPlayablePage,
    changeSpeed,
    changeVolume,
    toggleMute,
    toggleFloatingPosition
  } = useAudioPlayer();

  const [isSpeedMenuOpen, setIsSpeedMenuOpen] = useState(false);
  const [isVolumeOpen, setIsVolumeOpen] = useState(false);
  const popoversRef = useRef(null);

  useEffect(() => {
    if (!isSpeedMenuOpen && !isVolumeOpen) return;
    const close = () => {
      setIsSpeedMenuOpen(false);
      setIsVolumeOpen(false);
    };
    const onPointerDown = (e) => {
      if (!popoversRef.current?.contains(e.target)) close();
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
  }, [isSpeedMenuOpen, isVolumeOpen]);

  // Only show when a session is active AND we aren't already showing this same
  // book's full reader AudioPlayerBar.
  if (!session.isActive || !session.projectId) return null;
  if (currentRouteProjectId && currentRouteProjectId === session.projectId) {
    return null;
  }

  const project = session.project || {};
  const totalPages = project.page_count || session.pages?.length || 1;
  const playingPageNumber = session.playingPageNumber || 0;
  const hasPrev = prevPlayablePageNumber !== null;
  const hasNext = nextPlayablePageNumber !== null;
  const currentPosition = timeline.total > 0 ? bookPosition : currentTime;

  const VolumeIcon = isMuted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  // Lift slightly if user is inside a different book's workspace (which has its own bottom bar)
  const bottomOffsetClass = currentRouteProjectId ? 'bottom-16' : 'bottom-5';
  const isCorner = floatingPosition === 'corner';

  const handleJumpToReader = () => {
    onOpenPlayingPage?.(session.projectId, playingPageNumber);
  };

  if (isCorner) {
    return (
      <div
        role="region"
        aria-label="Floating Audiobook Mini Player"
        className={`fixed ${bottomOffsetClass} right-5 z-50 w-[min(90vw,356px)] bg-obsidian-850/95 backdrop-blur-xl border border-obsidian-700/90 rounded-2xl shadow-2xl ring-1 ring-indigo-500/20 px-3 pt-2.5 pb-2 transition-all duration-200 animate-fade-in`}
      >
        <AudioScrubber
          seekTotal={seekTotal}
          currentPosition={currentPosition}
          onApplySeek={(ratio, commit) => applySeek(ratio, commit)}
          label={timeline.total > 0 ? 'Book playback position' : 'Page playback position'}
          title="Seek audio"
          className="relative w-full h-2.5 mb-1.5"
        />

        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={handleJumpToReader}
            className="flex items-center gap-2 min-w-0 flex-1 text-left group cursor-pointer"
            title={`Open "${project.name || 'Book'}" at page ${playingPageNumber + 1}`}
          >
            <MiniBookCover
              projectId={session.projectId}
              updatedAt={project.updated_at}
              title={project.name}
              isPlaying={isPlaying}
              size="sm"
            />
            <div className="min-w-0 flex-1 leading-tight">
              <div className="text-xs font-semibold text-slate-100 group-hover:text-indigo-400 transition-colors truncate">
                {project.name || 'Audiobook'}
              </div>
              <div className="text-[11px] text-slate-400 font-mono tabular-nums truncate mt-0.5">
                p. {playingPageNumber + 1}/{totalPages} · {formatAudioTime(currentPosition)}
              </div>
            </div>
          </button>

          <div className="flex items-center gap-0.5 flex-shrink-0">
            <Button
              variant="ghost"
              size="icon-xs"
              disabled={!hasPrev}
              onClick={() => stepPlayablePage(-1)}
              title="Previous narrated page"
              aria-label="Previous narrated page"
            >
              <SkipBack className="w-3.5 h-3.5" />
            </Button>

            <Button
              variant="primary"
              size="icon-sm"
              disabled={!currentAudioUrl}
              onClick={() => togglePlay()}
              className="!rounded-full mx-0.5"
              title={isPlaying ? 'Pause narration' : 'Play narration'}
              aria-label={isPlaying ? 'Pause narration' : 'Play narration'}
            >
              {isPlaying ? (
                <Pause className="w-3.5 h-3.5 fill-current" />
              ) : (
                <Play className="w-3.5 h-3.5 fill-current translate-x-px" />
              )}
            </Button>

            <Button
              variant="ghost"
              size="icon-xs"
              disabled={!hasNext}
              onClick={() => stepPlayablePage(1)}
              title="Next narrated page"
              aria-label="Next narrated page"
            >
              <SkipForward className="w-3.5 h-3.5" />
            </Button>

            <Button
              variant="ghost"
              size="icon-xs"
              onClick={toggleFloatingPosition}
              title="Expand player to center"
              aria-label="Expand player to center"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </Button>

            <Button
              variant="ghost"
              size="icon-xs"
              onClick={stopAndDismiss}
              title="Stop and close player"
              aria-label="Stop and close player"
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      role="region"
      aria-label="Floating Audiobook Player"
      className={`fixed ${bottomOffsetClass} left-1/2 -translate-x-1/2 z-50 w-[min(94vw,600px)] bg-obsidian-850/95 backdrop-blur-xl border border-obsidian-700/90 rounded-2xl shadow-2xl ring-1 ring-indigo-500/20 px-3.5 pt-2.5 pb-2.5 transition-all duration-200 animate-fade-in`}
    >
      {/* Top interactive scrub bar */}
      <AudioScrubber
        seekTotal={seekTotal}
        currentPosition={currentPosition}
        onApplySeek={(ratio, commit) => applySeek(ratio, commit)}
        label={timeline.total > 0 ? 'Book playback position' : 'Page playback position'}
        title={timeline.total > 0 ? 'Seek across book narration' : 'Seek within page audio'}
        className="relative w-full h-2.5 mb-1.5"
      />

      <div className="flex items-center justify-between gap-2.5">
        {/* Left: Cover + Book Title + Page/Time (click to jump into reader) */}
        <button
          type="button"
          onClick={handleJumpToReader}
          className="flex items-center gap-2.5 min-w-0 flex-1 text-left group cursor-pointer"
          title={`Open "${project.name || 'Book'}" at page ${playingPageNumber + 1}`}
        >
          <MiniBookCover
            projectId={session.projectId}
            updatedAt={project.updated_at}
            title={project.name}
            isPlaying={isPlaying}
            size="md"
          />
          <div className="min-w-0 flex-1 leading-tight">
            <div className="text-xs font-semibold text-slate-100 group-hover:text-indigo-400 transition-colors truncate">
              {project.name || 'Audiobook'}
            </div>
            <div className="text-[11px] text-slate-400 font-mono tabular-nums truncate mt-0.5">
              <span>
                Page {playingPageNumber + 1} of {totalPages}
              </span>
              <span className="mx-1.5 text-slate-600">·</span>
              <span>
                {formatAudioTime(currentPosition)} / {formatAudioTime(seekTotal)}
              </span>
            </div>
          </div>
        </button>

        {/* Center: Transport controls */}
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <Button
            variant="ghost"
            size="icon-xs"
            disabled={!hasPrev}
            onClick={() => stepPlayablePage(-1)}
            title="Previous narrated page"
            aria-label="Previous narrated page"
          >
            <SkipBack className="w-3.5 h-3.5" />
          </Button>

          <Button
            variant="ghost"
            size="icon-xs"
            disabled={!currentAudioUrl}
            onClick={() => skipSeconds(-10)}
            title="Back 10 seconds"
            aria-label="Skip back 10 seconds"
            className="hidden sm:inline-flex"
          >
            <SkipSecondsIcon direction="back" className="w-4 h-4" />
          </Button>

          <Button
            variant="primary"
            size="icon"
            disabled={!currentAudioUrl}
            onClick={() => togglePlay()}
            className="!rounded-full mx-1 shadow-xs"
            title={isPlaying ? 'Pause narration' : 'Play narration'}
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
            size="icon-xs"
            disabled={!currentAudioUrl}
            onClick={() => skipSeconds(10)}
            title="Forward 10 seconds"
            aria-label="Skip forward 10 seconds"
            className="hidden sm:inline-flex"
          >
            <SkipSecondsIcon direction="forward" className="w-4 h-4" />
          </Button>

          <Button
            variant="ghost"
            size="icon-xs"
            disabled={!hasNext}
            onClick={() => stepPlayablePage(1)}
            title="Next narrated page"
            aria-label="Next narrated page"
          >
            <SkipForward className="w-3.5 h-3.5" />
          </Button>
        </div>

        {/* Right: Speed, Volume, Open Reader, Corner Toggle, Dismiss */}
        <div ref={popoversRef} className="flex items-center gap-0.5 flex-shrink-0">
          <div className="relative hidden sm:block">
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setIsSpeedMenuOpen((prev) => !prev)}
              className="font-mono tabular-nums px-1.5"
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
            className="relative hidden sm:flex items-center"
            onMouseEnter={() => setIsVolumeOpen(true)}
            onMouseLeave={() => setIsVolumeOpen(false)}
          >
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={toggleMute}
              title={isMuted ? 'Unmute (M)' : `Mute (M) — ${Math.round(volume * 100)}%`}
              aria-label={isMuted ? 'Unmute' : 'Mute'}
            >
              <VolumeIcon className={`w-3.5 h-3.5 ${isMuted || volume === 0 ? 'text-rose-500' : ''}`} />
            </Button>
            {isVolumeOpen && (
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

          <Button
            variant="ghost"
            size="icon-xs"
            onClick={handleJumpToReader}
            title={`Open page ${playingPageNumber + 1} in reader`}
            aria-label="Open playing page in reader"
          >
            <BookOpen className="w-3.5 h-3.5" />
          </Button>

          <Button
            variant="ghost"
            size="icon-xs"
            onClick={toggleFloatingPosition}
            title="Dock mini-player to corner"
            aria-label="Dock mini-player to corner"
          >
            <Minimize2 className="w-3.5 h-3.5" />
          </Button>

          <Button
            variant="ghost"
            size="icon-xs"
            onClick={stopAndDismiss}
            title="Stop and close player"
            aria-label="Stop and close player"
          >
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
