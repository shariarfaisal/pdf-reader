import React, { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  RotateCcw,
  RotateCw,
  Volume2,
  Volume1,
  VolumeX,
  Gauge,
  Sparkles,
  Download,
  ChevronUp
} from 'lucide-react';
import { Button } from './ui/Button';
import { Tag } from './ui/Badge';
import { readVolume, writeVolume, VOLUME_EVENT } from '../lib/playbackPrefs';

const SPEED_OPTIONS = [0.75, 0.85, 1.0, 1.25, 1.5, 1.75, 2.0];

/**
 * Continuous audiobook player.
 *
 * Plays the book seamlessly: when a page's audio finishes, it moves straight
 * to the next narrated page without interruption. Features whole-book timeline
 * scrubbing, hover preview tooltip, 10s skipping, fine volume control, and playback speeds.
 */
export function AudioPlayerBar({
  projectId,
  pages = [],
  currentAudioUrl,
  downloadUrl,
  pageNumber,
  totalPages,
  isReady,
  onSelectPage,
  onPrevPage,
  onNextPage,
  onTimeUpdate
}) {
  const audioRef = useRef(null);
  const preloadRef = useRef(null);
  const playIntentRef = useRef(false);
  const pendingSeekRef = useRef(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [volume, setVolume] = useState(readVolume);
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeedMenuOpen, setIsSpeedMenuOpen] = useState(false);
  const [isVolumeSliderOpen, setIsVolumeSliderOpen] = useState(false);

  // Hover scrub tooltip
  const [hoverPosition, setHoverPosition] = useState(null); // { percent: number, time: number } | null

  const ordered = useMemo(
    () => [...pages].sort((a, b) => a.page_number - b.page_number),
    [pages]
  );

  const hasAudio = useCallback(
    (page) => Boolean(page && page.audio_path && page.status === 'ready'),
    []
  );

  const audioUrlFor = useCallback(
    (page) =>
      `/api/projects/${projectId}/pages/${page.page_number}/audio?inline=1&v=${page.updated_at || 0}`,
    [projectId]
  );

  /** Next/previous page (in the given direction) that actually has audio. */
  const findPlayable = useCallback(
    (fromPageNumber, direction) => {
      const startIndex = ordered.findIndex((p) => p.page_number === fromPageNumber);
      if (startIndex === -1) return null;
      for (let i = startIndex + direction; i >= 0 && i < ordered.length; i += direction) {
        if (hasAudio(ordered[i])) return ordered[i].page_number;
      }
      return null;
    },
    [ordered, hasAudio]
  );

  // Book-wide timeline built from the persisted page durations.
  const timeline = useMemo(() => {
    const entries = [];
    let acc = 0;
    let complete = ordered.length > 0;
    for (const page of ordered) {
      const pageDuration = Number(page.audio_duration) || 0;
      if (!hasAudio(page) || !(pageDuration > 0)) complete = false;
      entries.push({ pageNumber: page.page_number, start: acc, duration: pageDuration });
      acc += pageDuration;
    }
    return { entries, total: complete ? acc : 0 };
  }, [ordered, hasAudio]);

  const pageOffset = useMemo(() => {
    const entry = timeline.entries.find((e) => e.pageNumber === pageNumber);
    return entry ? entry.start : 0;
  }, [timeline, pageNumber]);

  const bookPosition = pageOffset + currentTime;

  // The Settings page edits the default level while the player may be mounted.
  useEffect(() => {
    const sync = (event) => {
      setVolume(typeof event.detail === 'number' ? event.detail : readVolume());
      setIsMuted(false);
    };
    window.addEventListener(VOLUME_EVENT, sync);
    return () => window.removeEventListener(VOLUME_EVENT, sync);
  }, []);
  // Sync audio element volume
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = isMuted ? 0 : volume;
    }
  }, [volume, isMuted]);

  // Handle URL change
  useEffect(() => {
    const el = audioRef.current;
    if (!currentAudioUrl) {
      setIsPlaying(false);
      setCurrentTime(0);
      setDuration(0);
      playIntentRef.current = false;
      return;
    }
    if (!el) return;

    el.load();
    el.playbackRate = playbackRate;
    el.volume = isMuted ? 0 : volume;

    if (playIntentRef.current) {
      el.play()
        .then(() => setIsPlaying(true))
        .catch(() => {
          setIsPlaying(false);
          playIntentRef.current = false;
        });
    }
  }, [currentAudioUrl]);

  // Pre-buffer next page
  const nextPreviewUrl = useMemo(() => {
    const next = findPlayable(pageNumber, 1);
    if (next === null) return null;
    const page = ordered.find((p) => p.page_number === next);
    return page ? audioUrlFor(page) : null;
  }, [findPlayable, ordered, pageNumber, audioUrlFor]);

  const togglePlay = () => {
    if (!audioRef.current || !currentAudioUrl) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
      playIntentRef.current = false;
    } else {
      playIntentRef.current = true;
      audioRef.current
        .play()
        .then(() => setIsPlaying(true))
        .catch(() => {
          setIsPlaying(false);
          playIntentRef.current = false;
        });
    }
  };

  const handleTimeUpdate = () => {
    if (!audioRef.current) return;
    const cur = audioRef.current.currentTime;
    setCurrentTime(cur);
    if (onTimeUpdate) onTimeUpdate(cur, duration);
  };

  const handleLoadedMetadata = () => {
    const el = audioRef.current;
    if (!el) return;
    const newDuration = el.duration || 0;
    setDuration(newDuration);

    if (pendingSeekRef.current !== null) {
      const target = Math.max(0, Math.min(pendingSeekRef.current, Math.max(0, newDuration - 0.15)));
      el.currentTime = target;
      setCurrentTime(target);
      pendingSeekRef.current = null;
    }
  };

  /** Page finished → continue straight into the next page that has audio. */
  const handleEnded = () => {
    const next = findPlayable(pageNumber, 1);
    if (next !== null && onSelectPage) {
      playIntentRef.current = true;
      setIsPlaying(true);
      onSelectPage(next);
      return;
    }
    playIntentRef.current = false;
    setIsPlaying(false);
  };

  // Skip relative seconds (+10s / -10s)
  const skipSeconds = (seconds) => {
    if (!audioRef.current || !duration) return;
    const nextTime = Math.max(0, Math.min(duration, currentTime + seconds));
    audioRef.current.currentTime = nextTime;
    setCurrentTime(nextTime);
    if (onTimeUpdate) onTimeUpdate(nextTime, duration);
  };

  // Keyboard controls for audio player (Space, J, L, M)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target?.tagName) || e.target?.isContentEditable) {
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (e.key.toLowerCase() === 'm') {
        e.preventDefault();
        setIsMuted((prev) => !prev);
      } else if (e.key.toLowerCase() === 'j') {
        e.preventDefault();
        skipSeconds(-10);
      } else if (e.key.toLowerCase() === 'l') {
        e.preventDefault();
        skipSeconds(10);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPlaying, currentAudioUrl, currentTime, duration]);

  const handleSeek = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));

    // Whole-book scrub
    if (timeline.total > 0) {
      const bookTime = ratio * timeline.total;
      const entry =
        timeline.entries.find(
          (en) => bookTime >= en.start && bookTime < en.start + en.duration
        ) || timeline.entries[timeline.entries.length - 1];
      const localTime = Math.max(0, Math.min(bookTime - entry.start, entry.duration - 0.1));

      if (entry.pageNumber !== pageNumber) {
        pendingSeekRef.current = localTime;
        onSelectPage(entry.pageNumber);
      } else if (audioRef.current) {
        audioRef.current.currentTime = localTime;
        setCurrentTime(localTime);
        if (onTimeUpdate) onTimeUpdate(localTime, duration);
      }
      return;
    }

    // Page-local scrub
    if (!audioRef.current || !duration) return;
    const newTime = ratio * duration;
    audioRef.current.currentTime = newTime;
    setCurrentTime(newTime);
    if (onTimeUpdate) onTimeUpdate(newTime, duration);
  };

  const handleScrubMouseMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const targetTotal = timeline.total > 0 ? timeline.total : duration;
    setHoverPosition({
      percent: ratio * 100,
      time: ratio * targetTotal
    });
  };

  const handleScrubMouseLeave = () => {
    setHoverPosition(null);
  };

  const changeSpeed = (rate) => {
    setPlaybackRate(rate);
    setIsSpeedMenuOpen(false);
    if (audioRef.current) audioRef.current.playbackRate = rate;
  };

  const changeVolume = (newVol) => {
    setVolume(writeVolume(newVol));
    setIsMuted(false);
    if (audioRef.current) audioRef.current.volume = newVol;
  };

  const formatTime = (sec) => {
    if (!sec || isNaN(sec)) return '0:00';
    const total = Math.floor(sec);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const progressPercent =
    timeline.total > 0
      ? (bookPosition / timeline.total) * 100
      : duration > 0
      ? (currentTime / duration) * 100
      : 0;

  const hasPrev = findPlayable(pageNumber, -1) !== null;
  const hasNext = findPlayable(pageNumber, 1) !== null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 bg-obsidian-950/95 backdrop-blur-md border-t border-obsidian-700/80 px-6 py-2.5 shadow-2xl">
      <audio
        ref={audioRef}
        src={currentAudioUrl || undefined}
        preload="auto"
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleEnded}
      />
      {/* Hidden preloader for the upcoming page */}
      {nextPreviewUrl && (
        <audio ref={preloadRef} src={nextPreviewUrl} preload="auto" className="hidden" />
      )}

      <div className="max-w-7xl mx-auto flex flex-col gap-2">
        {/* Scrub Bar with Hover Time Tooltip */}
        <div
          onClick={handleSeek}
          onMouseMove={handleScrubMouseMove}
          onMouseLeave={handleScrubMouseLeave}
          className="relative w-full h-2 bg-obsidian-800 hover:h-3 rounded-full cursor-pointer transition-all duration-150 py-1 -my-1"
          title={
            timeline.total > 0 ? 'Seek across the whole book' : 'Seek within this page'
          }
        >
          <div className="w-full h-full bg-obsidian-800 rounded-full overflow-hidden relative">
            <div
              className="h-full bg-gradient-to-r from-brand-400 via-sky-400 to-indigo-400 rounded-full transition-all duration-75 relative"
              style={{ width: `${Math.max(0, Math.min(100, progressPercent))}%` }}
            />
          </div>

          {/* Hover Time Tooltip */}
          {hoverPosition && (
            <div
              className="absolute -top-7 transform -translate-x-1/2 pointer-events-none bg-obsidian-800 border border-obsidian-700 text-slate-200 text-[10px] font-mono px-1.5 py-0.5 rounded shadow-lg z-50 whitespace-nowrap"
              style={{ left: `${hoverPosition.percent}%` }}
            >
              {formatTime(hoverPosition.time)}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-4">
          {/* Left: Page & Timeline Information */}
          <div className="flex items-center gap-3 min-w-[240px]">
            <Tag tone="slate" size="sm" className="font-mono">
              Page {pageNumber + 1} of {totalPages}
            </Tag>

            {!isReady ? (
              <span className="text-xs text-amber-400 flex items-center gap-1.5 animate-pulse">
                <Sparkles className="w-3.5 h-3.5" />
                Narrating in pipeline…
              </span>
            ) : (
              <span
                className="text-xs text-slate-400 font-mono tabular-nums"
                title="Book timeline position / total duration"
              >
                {timeline.total > 0
                  ? `${formatTime(bookPosition)} / ${formatTime(timeline.total)}`
                  : `${formatTime(currentTime)} / ${formatTime(duration)}`}
              </span>
            )}
          </div>

          {/* Center: Playback Controls (Prev, -10s, Play/Pause, +10s, Next) */}
          <div className="flex items-center gap-1.5">
            {/* Previous Page with Audio */}
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={!hasPrev}
              onClick={() => {
                const prev = findPlayable(pageNumber, -1);
                if (prev !== null) onSelectPage(prev);
                else onPrevPage?.();
              }}
              title="Previous narrated page"
              aria-label="Previous narrated page"
            >
              <SkipBack className="w-4 h-4 text-slate-300" />
            </Button>

            {/* Skip Backward 10s */}
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={!currentAudioUrl}
              onClick={() => skipSeconds(-10)}
              title="Skip back 10 seconds (J)"
              aria-label="Skip back 10 seconds"
            >
              <RotateCcw className="w-3.5 h-3.5 text-slate-300" />
            </Button>

            {/* Main Play / Pause Button */}
            <Button
              variant="primary"
              size="icon"
              disabled={!currentAudioUrl}
              onClick={togglePlay}
              className="w-10 h-10 rounded-full shadow-lg shadow-brand-500/25"
              title={isPlaying ? 'Pause (Space)' : 'Play narration (Space)'}
              aria-label={isPlaying ? 'Pause narration' : 'Play narration'}
            >
              {isPlaying ? (
                <Pause className="w-5 h-5 fill-current" />
              ) : (
                <Play className="w-5 h-5 fill-current translate-x-0.5" />
              )}
            </Button>

            {/* Skip Forward 10s */}
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={!currentAudioUrl}
              onClick={() => skipSeconds(10)}
              title="Skip forward 10 seconds (L)"
              aria-label="Skip forward 10 seconds"
            >
              <RotateCw className="w-3.5 h-3.5 text-slate-300" />
            </Button>

            {/* Next Page with Audio */}
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={!hasNext}
              onClick={() => {
                const next = findPlayable(pageNumber, 1);
                if (next !== null) onSelectPage(next);
                else onNextPage?.();
              }}
              title="Next narrated page"
              aria-label="Next narrated page"
            >
              <SkipForward className="w-4 h-4 text-slate-300" />
            </Button>
          </div>

          {/* Right Tools: Speed Menu, Volume Popover, Download */}
          <div className="flex items-center gap-2.5 min-w-[240px] justify-end">
            {/* Playback Speed Selector */}
            <div className="relative">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsSpeedMenuOpen((prev) => !prev)}
                className="font-mono text-xs px-2.5 h-8 gap-1"
                title="Playback Speed"
                aria-expanded={isSpeedMenuOpen}
              >
                <Gauge className="w-3.5 h-3.5 text-brand-400" />
                <span>{playbackRate}x</span>
              </Button>

              {isSpeedMenuOpen && (
                <div
                  className="absolute bottom-full mb-2 right-0 bg-obsidian-850 border border-obsidian-700 rounded-xl shadow-2xl py-1 w-28 z-50 animate-fade-in"
                  role="menu"
                >
                  {SPEED_OPTIONS.map((rate) => (
                    <button
                      key={rate}
                      type="button"
                      role="menuitem"
                      onClick={() => changeSpeed(rate)}
                      className={`w-full text-left px-3 py-1.5 text-xs font-mono flex items-center justify-between transition ${
                        playbackRate === rate
                          ? 'bg-brand-500/10 text-brand-300 font-semibold'
                          : 'text-slate-300 hover:bg-obsidian-800 hover:text-white'
                      }`}
                    >
                      <span>{rate}x</span>
                      {rate === 1.0 && <span className="text-[10px] text-slate-500">Normal</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Volume Control with hover/popup slider */}
            <div
              className="relative flex items-center"
              onMouseEnter={() => setIsVolumeSliderOpen(true)}
              onMouseLeave={() => setIsVolumeSliderOpen(false)}
            >
              <button
                type="button"
                onClick={() => setIsMuted((prev) => !prev)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-obsidian-800 transition"
                title={isMuted ? 'Unmute (M)' : `Mute (M) — currently ${Math.round(volume * 100)}%`}
                aria-label={isMuted ? 'Unmute' : 'Mute'}
              >
                {isMuted || volume === 0 ? (
                  <VolumeX className="w-4 h-4 text-rose-400" />
                ) : volume < 0.5 ? (
                  <Volume1 className="w-4 h-4 text-slate-300" />
                ) : (
                  <Volume2 className="w-4 h-4 text-slate-300" />
                )}
              </button>

              {/* Volume Slider Dropdown / Flyout */}
              {isVolumeSliderOpen && (
                <div className="absolute bottom-full mb-2 -left-8 bg-obsidian-850/95 backdrop-blur-md border border-obsidian-700 rounded-xl shadow-2xl p-2.5 w-32 flex flex-col gap-1.5 z-50 animate-fade-in">
                  <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
                    <span>Vol</span>
                    <span className="text-slate-200">
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
                    className="w-full accent-brand-400 h-1.5 bg-obsidian-700 rounded-lg appearance-none cursor-pointer"
                    aria-label="Volume slider"
                  />
                </div>
              )}
            </div>

            {/* Download narration audio */}
            <a
              href={downloadUrl || undefined}
              download
              aria-disabled={!currentAudioUrl}
              onClick={(e) => {
                if (!currentAudioUrl) e.preventDefault();
              }}
              className={`inline-flex items-center gap-1.5 px-2.5 h-8 rounded-lg border text-xs font-medium transition ${
                currentAudioUrl
                  ? 'border-obsidian-700 bg-obsidian-800 text-slate-300 hover:text-white hover:border-slate-600'
                  : 'border-obsidian-800 text-slate-600 pointer-events-none'
              }`}
              title={currentAudioUrl ? 'Download this page narration MP3' : 'Audio not ready to download'}
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">MP3</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
