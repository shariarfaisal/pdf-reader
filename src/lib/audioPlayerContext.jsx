import React, {
  createContext,
  useContext,
  useRef,
  useState,
  useEffect,
  useMemo,
  useCallback
} from 'react';
import { readVolume, writeVolume, VOLUME_EVENT } from './playbackPrefs';

export const SPEED_OPTIONS = [0.75, 0.85, 1.0, 1.25, 1.5, 1.75, 2.0];

const RATE_STORAGE_KEY = 'pdf-reader-playback-rate';
const FLOATING_POS_KEY = 'pdf-reader-floating-pos';
const POSITION_PREFIX = 'pdf-reader-listen-pos:';
const BOOKMARK_PREFIX = 'pdf-reader-listen-page:';

/** Ignore resume offsets closer than this to the start of a page. */
const MIN_RESUME_OFFSET = 1;

/**
 * Persisted listening position for one project: `{ page, time }` where `time` is
 * the offset in seconds inside that page. Returns null when nothing was heard yet.
 * Reads the legacy page-only bookmark (older builds) as a `time: 0` position.
 */
export function readListeningPosition(projectId) {
  if (!projectId) return null;
  try {
    const raw = localStorage.getItem(`${POSITION_PREFIX}${projectId}`);
    if (raw !== null) {
      const parsed = JSON.parse(raw);
      const page = parseInt(parsed?.page, 10);
      const time = Number(parsed?.time);
      if (Number.isFinite(page) && page >= 0) {
        return {
          page,
          time: Number.isFinite(time) && time > 0 ? time : 0,
          updatedAt: Number.isFinite(parsed?.updatedAt) ? parsed.updatedAt : 0
        };
      }
    }
    const legacy = localStorage.getItem(`${BOOKMARK_PREFIX}${projectId}`);
    if (legacy !== null) {
      const page = parseInt(legacy, 10);
      if (Number.isFinite(page) && page >= 0) return { page, time: 0, updatedAt: 0 };
    }
  } catch {}
  return null;
}

/** Page of the last listening position (kept for page-only consumers). */
export function readListeningBookmark(projectId) {
  const pos = readListeningPosition(projectId);
  return pos ? pos.page : null;
}

export function writeListeningPosition(projectId, pageNumber, time = 0) {
  if (!projectId || typeof pageNumber !== 'number' || pageNumber < 0) return;
  try {
    localStorage.setItem(
      `${POSITION_PREFIX}${projectId}`,
      JSON.stringify({
        page: pageNumber,
        time: Math.max(0, Number(time) || 0),
        updatedAt: Date.now()
      })
    );
    localStorage.removeItem(`${BOOKMARK_PREFIX}${projectId}`);
  } catch {}
}

/**
 * Resolve where a cold playback start should begin for a project.
 * `hasAudio(page)` filters out saved pages that no longer have narration.
 */
export function resolveResumePosition(projectId, hasAudio = () => true) {
  const saved = readListeningPosition(projectId);
  if (!saved || !hasAudio(saved.page)) return null;
  return saved;
}

export { MIN_RESUME_OFFSET };

function readSavedRate() {
  try {
    const val = parseFloat(localStorage.getItem(RATE_STORAGE_KEY));
    if (SPEED_OPTIONS.includes(val)) return val;
  } catch {}
  return 1.0;
}

function readFloatingPos() {
  try {
    const pos = localStorage.getItem(FLOATING_POS_KEY);
    if (pos === 'corner' || pos === 'center') return pos;
  } catch {}
  return 'center';
}

export function hasPageAudio(page) {
  return Boolean(page && (page.audio_path || page.status === 'ready'));
}

export function buildAudioUrl(projectId, page) {
  if (!projectId || !page || !hasPageAudio(page)) return null;
  return `/api/projects/${projectId}/pages/${page.page_number}/audio?inline=1&v=${page.updated_at || 0}`;
}

export function findPlayableInPages(orderedPages = [], fromPageNumber, direction = 1) {
  const startIndex = orderedPages.findIndex((p) => p.page_number === fromPageNumber);
  if (startIndex === -1) {
    if (direction >= 0) {
      const first = orderedPages.find((p) => hasPageAudio(p));
      return first ? first.page_number : null;
    }
    return null;
  }
  for (let i = startIndex + direction; i >= 0 && i < orderedPages.length; i += direction) {
    if (hasPageAudio(orderedPages[i])) return orderedPages[i].page_number;
  }
  return null;
}

export function computeBookTimeline(orderedPages = []) {
  const entries = [];
  let acc = 0;
  let complete = orderedPages.length > 0;
  for (const page of orderedPages) {
    const pageDuration = Number(page.audio_duration) || 0;
    if (!hasPageAudio(page) || !(pageDuration > 0)) complete = false;
    entries.push({ pageNumber: page.page_number, start: acc, duration: pageDuration });
    acc += pageDuration;
  }
  return { entries, total: acc, complete };
}

export function formatAudioTime(sec) {
  if (!sec || isNaN(sec) || sec < 0) return '0:00';
  const total = Math.floor(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

export function formatRuntimeBadge(sec) {
  const total = Math.floor(Number(sec) || 0);
  if (total <= 0) return null;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

/** Circular 10s skip arrow with the "10" label centered. */
export function SkipSecondsIcon({ direction, className = 'w-[18px] h-[18px]' }) {
  const back = direction === 'back';
  return (
    <svg
      className={`${className} fill-none stroke-current`}
      viewBox="0 0 24 24"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={back ? 'M3 12a9 9 0 1 0 3-6.7L3 8' : 'M21 12a9 9 0 1 1-3-6.7L21 8'} />
      <path d={back ? 'M3 3v5h5' : 'M21 3v5h-5'} />
      <text
        x="12"
        y="15.5"
        textAnchor="middle"
        stroke="none"
        fill="currentColor"
        fontSize="8.5"
        fontWeight="700"
        fontFamily="ui-monospace, monospace"
      >
        10
      </text>
    </svg>
  );
}

/** Animated 3-bar equalizer indicator for active playback. */
export function EqualizerBars({ isPlaying = true, className = '' }) {
  return (
    <span
      className={`inline-flex items-end gap-[2px] h-3 ${className}`}
      aria-hidden="true"
    >
      <span
        className={`w-[2.5px] rounded-full bg-current transition-all duration-200 ${
          isPlaying ? 'h-2.5 animate-[pulse_0.75s_ease-in-out_infinite]' : 'h-1'
        }`}
      />
      <span
        className={`w-[2.5px] rounded-full bg-current transition-all duration-200 ${
          isPlaying ? 'h-3 animate-[pulse_0.55s_ease-in-out_0.15s_infinite]' : 'h-2'
        }`}
      />
      <span
        className={`w-[2.5px] rounded-full bg-current transition-all duration-200 ${
          isPlaying ? 'h-2 animate-[pulse_0.85s_ease-in-out_0.3s_infinite]' : 'h-1.5'
        }`}
      />
    </span>
  );
}

/**
 * Shared scrubber strip implementing the media-scrubber contract:
 * - Fixed-height flex parent (`h-3 flex items-center`) + height-only track (`h-1.5 group-hover:h-2`)
 * - Always-visible white playhead thumb at progressPercent
 * - Pointer capture + drag preview (commit=false) vs release commit (commit=true)
 * - Keyboard slider support: Arrow ±5s (Shift ±30s), Home, End
 */
export function AudioScrubber({
  seekTotal = 0,
  currentPosition = 0,
  onApplySeek,
  label = 'Playback position',
  title = 'Seek narration',
  className = 'absolute inset-x-0 -top-1.5 h-3'
}) {
  const stripRef = useRef(null);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubRatio, setScrubRatio] = useState(null);
  const [hoverPosition, setHoverPosition] = useState(null);

  const ratioFromClientX = (clientX, targetEl) => {
    const el = targetEl || stripRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    if (!(rect.width > 0)) return 0;
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  };

  const handlePointerDown = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    stripRef.current?.focus();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const ratio = ratioFromClientX(e.clientX, e.currentTarget);
    setIsScrubbing(true);
    setScrubRatio(ratio);
    onApplySeek?.(ratio, false);
  };

  const handlePointerMove = (e) => {
    const ratio = ratioFromClientX(e.clientX, e.currentTarget);
    setHoverPosition({
      percent: ratio * 100,
      time: ratio * seekTotal
    });
    if (isScrubbing) {
      setScrubRatio(ratio);
      onApplySeek?.(ratio, false);
    }
  };

  const finishScrub = (e) => {
    if (!isScrubbing) return;
    const ratio =
      e && typeof e.clientX === 'number'
        ? ratioFromClientX(e.clientX, e.currentTarget)
        : scrubRatio ?? 0;
    setIsScrubbing(false);
    setScrubRatio(null);
    onApplySeek?.(ratio, true);
  };

  const handleKeyDown = (e) => {
    if (!(seekTotal > 0)) return;
    let targetTime = null;
    const step = e.shiftKey ? 30 : 5;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      targetTime = Math.min(seekTotal, currentPosition + step);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      targetTime = Math.max(0, currentPosition - step);
    } else if (e.key === 'Home') {
      targetTime = 0;
    } else if (e.key === 'End') {
      targetTime = seekTotal;
    }
    if (targetTime !== null) {
      e.preventDefault();
      onApplySeek?.(Math.max(0, Math.min(1, targetTime / seekTotal)), true);
    }
  };

  const progressPercent = useMemo(() => {
    if (isScrubbing && scrubRatio !== null) return scrubRatio * 100;
    if (seekTotal > 0) return Math.max(0, Math.min(100, (currentPosition / seekTotal) * 100));
    return 0;
  }, [isScrubbing, scrubRatio, seekTotal, currentPosition]);

  const nowValue = Math.round(
    isScrubbing && scrubRatio !== null
      ? scrubRatio * seekTotal
      : Math.min(currentPosition, seekTotal)
  );

  return (
    <div
      ref={stripRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishScrub}
      onPointerCancel={finishScrub}
      onPointerLeave={() => setHoverPosition(null)}
      onKeyDown={handleKeyDown}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={Math.round(seekTotal)}
      aria-valuenow={nowValue}
      className={`group flex items-center cursor-pointer touch-none select-none focus:outline-none ${className}`}
      title={title}
    >
      <div className="w-full h-1.5 group-hover:h-2 bg-obsidian-700 overflow-hidden transition-all duration-150 rounded-full">
        <div
          className="h-full bg-indigo-600 dark:bg-indigo-400 transition-all duration-75"
          style={{ width: `${Math.max(0, Math.min(100, progressPercent))}%` }}
        />
      </div>
      <div
        className={`absolute top-1/2 w-3 h-3 rounded-full bg-white shadow-sm border border-indigo-500/50 -translate-y-1/2 -translate-x-1/2 pointer-events-none transition-transform duration-100 ${
          isScrubbing ? 'scale-125' : 'group-hover:scale-110'
        }`}
        style={{ left: `${Math.max(0, Math.min(100, progressPercent))}%` }}
      />
      {hoverPosition && seekTotal > 0 && (
        <div
          className="absolute -top-6 -translate-x-1/2 pointer-events-none bg-obsidian-800 border border-obsidian-700 text-slate-100 text-[10px] font-mono px-1.5 py-0.5 rounded shadow z-50 whitespace-nowrap"
          style={{ left: `${hoverPosition.percent}%` }}
        >
          {formatAudioTime(hoverPosition.time)}
        </div>
      )}
    </div>
  );
}

const AudioPlayerContext = createContext(null);

export function GlobalAudioProvider({ children, onAutoFollowPage }) {
  const audioRef = useRef(null);
  const preloadRef = useRef(null);
  const playIntentRef = useRef(false);
  const pendingSeekRef = useRef(null);
  // Survives the double media load caused by assigning src manually (inside the
  // user gesture) and again from the React src prop — otherwise a restore seek
  // would be wiped by the second load and playback would restart at 0:00.
  const resumeSeekRef = useRef(null);

  const [session, setSession] = useState({
    projectId: null,
    project: null,
    pages: [],
    playingPageNumber: 0,
    isActive: false
  });

  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);
  const [loadingProjectId, setLoadingProjectId] = useState(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(readSavedRate);
  const [volume, setVolume] = useState(readVolume);
  const [isMuted, setIsMuted] = useState(false);
  const [floatingPosition, setFloatingPosition] = useState(readFloatingPos);

  const sessionRef = useRef(session);
  sessionRef.current = session;

  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;

  const currentTimeRef = useRef(currentTime);
  currentTimeRef.current = currentTime;

  const orderedPages = useMemo(
    () => [...(session.pages || [])].sort((a, b) => a.page_number - b.page_number),
    [session.pages]
  );

  const currentPlayingPage = useMemo(
    () => orderedPages.find((p) => p.page_number === session.playingPageNumber) || null,
    [orderedPages, session.playingPageNumber]
  );

  const currentAudioUrl = useMemo(
    () => buildAudioUrl(session.projectId, currentPlayingPage),
    [session.projectId, currentPlayingPage]
  );

  const nextPlayablePageNumber = useMemo(
    () => findPlayableInPages(orderedPages, session.playingPageNumber, 1),
    [orderedPages, session.playingPageNumber]
  );

  const prevPlayablePageNumber = useMemo(
    () => findPlayableInPages(orderedPages, session.playingPageNumber, -1),
    [orderedPages, session.playingPageNumber]
  );

  const nextPreviewUrl = useMemo(() => {
    if (nextPlayablePageNumber === null) return null;
    const nextPage = orderedPages.find((p) => p.page_number === nextPlayablePageNumber);
    return buildAudioUrl(session.projectId, nextPage);
  }, [nextPlayablePageNumber, orderedPages, session.projectId]);

  const timeline = useMemo(() => computeBookTimeline(orderedPages), [orderedPages]);

  const activeEntry = useMemo(
    () => timeline.entries.find((e) => e.pageNumber === session.playingPageNumber),
    [timeline.entries, session.playingPageNumber]
  );

  const bookPosition = (activeEntry?.start || 0) + currentTime;
  const seekTotal = timeline.total > 0 ? timeline.total : duration;

  // Keep volume in sync across components
  useEffect(() => {
    const onVolumeEvent = (e) => {
      if (typeof e.detail === 'number') {
        setVolume(e.detail);
        if (audioRef.current) audioRef.current.volume = e.detail;
      }
    };
    window.addEventListener(VOLUME_EVENT, onVolumeEvent);
    return () => window.removeEventListener(VOLUME_EVENT, onVolumeEvent);
  }, []);

  // Re-apply rate/mute/volume whenever UI state or audio src changes
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.defaultPlaybackRate = playbackRate;
    el.playbackRate = playbackRate;
    el.muted = isMuted;
    el.volume = isMuted ? 0 : volume;
  }, [playbackRate, isMuted, volume, currentAudioUrl]);

  const persistGuardRef = useRef({ key: '', at: 0 });

  const persistPosition = useCallback((projectId, pageNumber, time, force = false) => {
    if (!projectId || typeof pageNumber !== 'number' || pageNumber < 0) return;
    const key = `${projectId}:${pageNumber}`;
    const now = Date.now();
    const guard = persistGuardRef.current;
    if (!force && guard.key === key && now - guard.at < 2000) return;
    persistGuardRef.current = { key, at: now };
    writeListeningPosition(projectId, pageNumber, time);
  }, []);

  // Single writer for the audio element's src: playback paths assign it inside
  // the user gesture, this effect only fills in the remaining transitions (page
  // auto-advance, step, seek). Re-assigning an identical src would reload the
  // media element and drop a pending restore seek.
  useEffect(() => {
    const el = audioRef.current;
    if (!el || !currentAudioUrl) return;
    if (el.getAttribute('src') !== currentAudioUrl) el.setAttribute('src', currentAudioUrl);
  }, [currentAudioUrl]);

  // Flush the listening position when the tab is hidden or closed so the resume
  // point is never lost mid-page.
  useEffect(() => {
    const flush = () => {
      const cur = sessionRef.current;
      if (!cur.projectId) return;
      const time = audioRef.current ? audioRef.current.currentTime : currentTimeRef.current;
      persistPosition(cur.projectId, cur.playingPageNumber, time, true);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('beforeunload', flush);
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('beforeunload', flush);
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [persistPosition]);

  // Global "M" shortcut for mute/unmute
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key !== 'm' && e.key !== 'M') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
      setIsMuted((prev) => !prev);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  /** True when the media element is actually playing the session's current page. */
  const isCurrentTrackLoaded = (cur = sessionRef.current) => {
    const el = audioRef.current;
    if (!el || !cur.projectId) return false;
    const expected = `/projects/${cur.projectId}/pages/${cur.playingPageNumber}/audio`;
    return !el.getAttribute('src') || el.getAttribute('src').includes(expected);
  };

  const handleTimeUpdate = () => {
    if (!audioRef.current) return;
    const time = audioRef.current.currentTime;
    setCurrentTime(time);
    const resume = resumeSeekRef.current;
    if (resume && time > resume.time + 0.4) resumeSeekRef.current = null;
    const cur = sessionRef.current;
    // A freshly assigned src emits its 0:00 update before React commits the new
    // session — persisting that would clobber the previous book's bookmark.
    if (cur.projectId && isCurrentTrackLoaded(cur)) {
      persistPosition(cur.projectId, cur.playingPageNumber, time);
    }
  };

  const handleLoadedMetadata = () => {
    if (!audioRef.current) return;
    const dur = audioRef.current.duration || 0;
    setDuration(dur);
    audioRef.current.defaultPlaybackRate = playbackRate;
    audioRef.current.playbackRate = playbackRate;
    audioRef.current.muted = isMuted;
    audioRef.current.volume = isMuted ? 0 : volume;

    if (pendingSeekRef.current !== null) {
      const target = pendingSeekRef.current;
      pendingSeekRef.current = null;
      audioRef.current.currentTime = Math.max(0, Math.min(dur || target, target));
      setCurrentTime(audioRef.current.currentTime);
    }

    // Re-apply a restore seek until playback actually moves past it (a second
    // `src` assignment restarts the media element at 0).
    const resume = resumeSeekRef.current;
    const cur = sessionRef.current;
    if (resume && cur.projectId === resume.projectId && cur.playingPageNumber === resume.page) {
      const target = Math.max(0, Math.min(dur > 0 ? dur - 0.5 : resume.time, resume.time));
      if (Math.abs(audioRef.current.currentTime - target) > 0.4) {
        audioRef.current.currentTime = target;
        setCurrentTime(target);
      }
    } else if (resume) {
      resumeSeekRef.current = null;
    }

    if (playIntentRef.current) {
      audioRef.current
        .play()
        .then(() => setIsPlaying(true))
        .catch((err) => {
          console.warn('Audio playback initiation failed:', err);
          setIsPlaying(false);
        });
    }
  };

  const handleEnded = () => {
    const curSession = sessionRef.current;
    const sorted = [...(curSession.pages || [])].sort((a, b) => a.page_number - b.page_number);
    const prevPage = curSession.playingPageNumber;
    const next = findPlayableInPages(sorted, prevPage, 1);

    if (next !== null) {
      playIntentRef.current = true;
      setCurrentTime(0);
      persistPosition(curSession.projectId, next, 0, true);
      setSession((prev) => ({
        ...prev,
        playingPageNumber: next,
        isActive: true
      }));
      onAutoFollowPage?.(curSession.projectId, prevPage, next);
    } else {
      setIsPlaying(false);
      playIntentRef.current = false;
      setCurrentTime(0);
      // Finished book: keep the final page so a replay starts there, not at page 1.
      persistPosition(curSession.projectId, curSession.playingPageNumber, 0, true);
    }
  };

  /**
   * Synchronize workspace project/pages when the user is viewing a project.
   * Never interrupts an already-active audio session for another book or page!
   */
  const syncWorkspaceProject = useCallback((project, pages, viewingPageNumber = 0) => {
    if (!project?.id) return;
    setSession((prev) => {
      // If another book is actively loaded/playing, keep that session untouched!
      if (prev.isActive && prev.projectId && prev.projectId !== project.id) {
        return prev;
      }

      // If this same book is already loaded: update its pages & metadata,
      // and only follow viewingPageNumber if playback hasn't started yet.
      if (prev.projectId === project.id) {
        const canFollowViewPage =
          !isPlayingRef.current &&
          currentTimeRef.current === 0 &&
          !prev.isActive;
        const nextPageNum = canFollowViewPage ? viewingPageNumber : prev.playingPageNumber;
        return {
          ...prev,
          project,
          pages: pages || prev.pages,
          playingPageNumber: nextPageNum
        };
      }

      // Otherwise initialize idle session to this project
      return {
        projectId: project.id,
        project,
        pages: pages || [],
        playingPageNumber: viewingPageNumber,
        isActive: false
      };
    });
  }, []);

  /**
   * Keep pages of the currently loaded project updated when background SSE events arrive.
   */
  const updateProjectPagesIfMatch = useCallback((projectId, project, pages) => {
    setSession((prev) => {
      if (prev.projectId !== projectId) return prev;
      return {
        ...prev,
        project: project || prev.project,
        pages: pages || prev.pages
      };
    });
  }, []);

  /**
   * Start playing a specific page of a given project (with pages already in memory).
   *
   * `initialSeek` starts inside the page at an exact offset. When it is null and
   * `options.resume` is not disabled, the persisted per-project listening position
   * is restored — same page → same timestamp, different page → page start.
   */
  const playProjectPage = useCallback((project, pages, pageNumber, initialSeek = null, options = {}) => {
    if (!project?.id) return;
    const { resume = true } = options;
    const sorted = [...(pages || [])].sort((a, b) => a.page_number - b.page_number);
    let targetPage = pageNumber;
    const requestedObj = sorted.find((p) => p.page_number === pageNumber);
    if (!hasPageAudio(requestedObj)) {
      const fallback =
        findPlayableInPages(sorted, pageNumber, 1) ??
        findPlayableInPages(sorted, pageNumber, -1) ??
        sorted.find((p) => hasPageAudio(p))?.page_number ??
        pageNumber;
      targetPage = fallback;
    }

    const targetObj = sorted.find((p) => p.page_number === targetPage);

    // Where to start inside the target page.
    let startSeek = initialSeek;
    if (startSeek === null && resume) {
      const saved = readListeningPosition(project.id);
      if (saved && saved.page === targetPage && saved.time > MIN_RESUME_OFFSET) {
        const pageDuration = Number(targetObj?.audio_duration) || 0;
        const nearEnd = pageDuration > 0 && saved.time >= pageDuration - 2;
        if (!nearEnd) startSeek = saved.time;
      }
    }

    playIntentRef.current = true;

    setSession({
      projectId: project.id,
      project,
      pages: sorted,
      playingPageNumber: targetPage,
      isActive: true
    });

    const el = audioRef.current;
    const expectedUrl = buildAudioUrl(project.id, targetObj);
    const sameSrcLoaded = Boolean(
      el && expectedUrl && el.src && el.src.includes(`/projects/${project.id}/pages/${targetPage}/audio`)
    );

    persistPosition(project.id, targetPage, startSeek ?? (sameSrcLoaded ? el.currentTime : 0), true);

    if (!el) return;

    if (sameSrcLoaded) {
      // Same track already buffered: revive from its current position, only
      // jumping when a restore offset (or explicit seek) asks for another spot.
      pendingSeekRef.current = null;
      resumeSeekRef.current = null;
      if (startSeek !== null && Math.abs(el.currentTime - startSeek) > 1.5) {
        el.currentTime = startSeek;
        setCurrentTime(startSeek);
      }
    } else if (expectedUrl) {
      // Set src immediately inside the user gesture so browser autoplay never blocks
      pendingSeekRef.current = null;
      resumeSeekRef.current =
        startSeek !== null
          ? { projectId: project.id, page: targetPage, time: startSeek }
          : null;
      setCurrentTime(startSeek ?? 0);
      el.setAttribute('src', expectedUrl);
    } else {
      pendingSeekRef.current = null;
      resumeSeekRef.current = null;
    }

    el.play()
      .then(() => setIsPlaying(true))
      .catch(() => {
        // handleLoadedMetadata will retry when metadata finishes loading
      });
  }, [persistPosition]);

  /**
   * Toggle play/pause for the current session or start a fallback project/page.
   */
  const togglePlay = useCallback(
    (fallbackProject = null, fallbackPages = null, fallbackPageNumber = null) => {
      const cur = sessionRef.current;

      // If caller passed a specific project and it's not the currently loaded project,
      // switch to that project and play!
      if (
        fallbackProject?.id &&
        fallbackPages &&
        (cur.projectId !== fallbackProject.id || !cur.isActive)
      ) {
        const startPage =
          fallbackPageNumber !== null && fallbackPageNumber !== undefined
            ? fallbackPageNumber
            : cur.projectId === fallbackProject.id
            ? cur.playingPageNumber
            : fallbackProject.active_page || 0;
        playProjectPage(fallbackProject, fallbackPages, startPage);
        return;
      }

      if (!audioRef.current) return;

      if (isPlayingRef.current) {
        playIntentRef.current = false;
        audioRef.current.pause();
        setIsPlaying(false);
      } else {
        playIntentRef.current = true;
        setSession((prev) => ({ ...prev, isActive: true }));
        audioRef.current
          .play()
          .then(() => setIsPlaying(true))
          .catch((err) => {
            console.warn('Playback resume failed:', err);
            setIsPlaying(false);
          });
      }
    },
    [playProjectPage]
  );

  /**
   * Play or pause a project directly from the Library card (fetches pages if needed).
   */
  const playProjectFromLibrary = useCallback(
    async (projectSummary, requestedPageNumber = null) => {
      if (!projectSummary?.id) return;
      const cur = sessionRef.current;

      // If this book is already the active session and no specific new page was requested,
      // simply toggle play/pause!
      if (
        cur.projectId === projectSummary.id &&
        cur.isActive &&
        cur.pages.length > 0 &&
        (requestedPageNumber === null || requestedPageNumber === cur.playingPageNumber)
      ) {
        togglePlay();
        return;
      }

      // If we already have this book's pages in memory and a specific page was requested:
      if (cur.projectId === projectSummary.id && cur.pages.length > 0 && requestedPageNumber !== null) {
        playProjectPage(cur.project || projectSummary, cur.pages, requestedPageNumber);
        return;
      }

      // Otherwise fetch project details & pages from API
      setIsLoadingAudio(true);
      setLoadingProjectId(projectSummary.id);
      try {
        const res = await fetch(`/api/projects/${projectSummary.id}`);
        if (!res.ok) throw new Error('Failed to load book audio playlist');
        const data = await res.json();
        const fullProject = data.project || projectSummary;
        const pages = data.pages || [];
        const sorted = [...pages].sort((a, b) => a.page_number - b.page_number);

        let targetPage = requestedPageNumber;
        if (targetPage === null || targetPage === undefined) {
          const bookmarkedPage = readListeningBookmark(fullProject.id);
          const bookmarkedObj =
            bookmarkedPage !== null
              ? sorted.find((p) => p.page_number === bookmarkedPage)
              : null;
          if (hasPageAudio(bookmarkedObj)) {
            targetPage = bookmarkedPage;
          } else {
            const firstReady = sorted.find((p) => hasPageAudio(p));
            targetPage = firstReady ? firstReady.page_number : 0;
          }
        }

        playProjectPage(fullProject, sorted, targetPage);
      } catch (err) {
        console.error('Failed to play project from library:', err);
      } finally {
        setIsLoadingAudio(false);
        setLoadingProjectId(null);
      }
    },
    [playProjectPage, togglePlay]
  );

  /**
   * Cold-start a book from its persisted listening position (page + timestamp).
   * Falls back to the first narrated page when nothing was heard yet.
   */
  const resumeProject = useCallback(
    (project, pages) => {
      if (!project?.id) return;
      const sorted = [...(pages || [])].sort((a, b) => a.page_number - b.page_number);
      const saved = resolveResumePosition(project.id, (page) =>
        hasPageAudio(sorted.find((p) => p.page_number === page))
      );
      const targetPage =
        saved?.page ?? sorted.find((p) => hasPageAudio(p))?.page_number ?? 0;
      playProjectPage(project, sorted, targetPage);
    },
    [playProjectPage]
  );

  const pause = useCallback(() => {
    playIntentRef.current = false;
    if (audioRef.current) {
      const cur = sessionRef.current;
      if (isCurrentTrackLoaded(cur)) {
        persistPosition(cur.projectId, cur.playingPageNumber, audioRef.current.currentTime, true);
      }
      audioRef.current.pause();
    }
    setIsPlaying(false);
  }, [persistPosition]);

  const stopAndDismiss = useCallback(() => {
    playIntentRef.current = false;
    const cur = sessionRef.current;
    if (audioRef.current) {
      if (isCurrentTrackLoaded(cur)) {
        persistPosition(cur.projectId, cur.playingPageNumber, audioRef.current.currentTime, true);
      }
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setIsPlaying(false);
    setCurrentTime(0);
    setSession((prev) => ({
      ...prev,
      isActive: false
    }));
  }, [persistPosition]);

  const skipSeconds = useCallback((delta) => {
    if (!audioRef.current) return;
    const dur = audioRef.current.duration || duration || 0;
    const target = Math.max(0, Math.min(dur > 0 ? dur : Infinity, audioRef.current.currentTime + delta));
    audioRef.current.currentTime = target;
    setCurrentTime(target);
  }, [duration]);

  /**
   * Apply seek across book timeline or current page.
   * commit=false: drag preview (only seeks within current page if same page, never loads a new page).
   * commit=true: pointer release or keyboard seek (loads target page if cross-page).
   */
  const applySeek = useCallback(
    (ratio, commit = true, overrideProject = null, overridePages = null) => {
      const clamped = Math.max(0, Math.min(1, Number(ratio) || 0));
      const cur = sessionRef.current;

      // If seeking in a workspace whose project isn't the active session yet, bind it on commit
      const activeProj =
        overrideProject && cur.projectId !== overrideProject.id ? overrideProject : cur.project;
      const activePages =
        overridePages && cur.projectId !== overrideProject?.id
          ? [...overridePages].sort((a, b) => a.page_number - b.page_number)
          : orderedPages;

      const activeTimeline =
        activePages === orderedPages ? timeline : computeBookTimeline(activePages);
      const total = activeTimeline.total > 0 ? activeTimeline.total : duration;
      const targetBookTime = clamped * total;

      if (!commit) {
        // Drag preview: only update current page's audio time if within current page
        if (activeTimeline.total > 0) {
          const curEntry = activeTimeline.entries.find(
            (e) => e.pageNumber === cur.playingPageNumber
          );
          if (
            curEntry &&
            targetBookTime >= curEntry.start &&
            targetBookTime <= curEntry.start + curEntry.duration &&
            audioRef.current
          ) {
            const localTime = targetBookTime - curEntry.start;
            audioRef.current.currentTime = localTime;
            setCurrentTime(localTime);
          }
        } else if (audioRef.current && duration > 0) {
          audioRef.current.currentTime = targetBookTime;
          setCurrentTime(targetBookTime);
        }
        return;
      }

      // commit=true
      if (activeTimeline.total > 0) {
        let targetPage = cur.playingPageNumber;
        let targetPageTime = 0;
        for (const entry of activeTimeline.entries) {
          if (targetBookTime >= entry.start && targetBookTime <= entry.start + entry.duration) {
            targetPage = entry.pageNumber;
            targetPageTime = targetBookTime - entry.start;
            break;
          }
        }

        if (activeProj && cur.projectId !== activeProj.id) {
          playProjectPage(activeProj, activePages, targetPage, targetPageTime);
          return;
        }

        if (targetPage !== cur.playingPageNumber) {
          pendingSeekRef.current = targetPageTime;
          const prevPage = cur.playingPageNumber;
          persistPosition(cur.projectId, targetPage, targetPageTime, true);
          setSession((prev) => ({
            ...prev,
            playingPageNumber: targetPage,
            isActive: true
          }));
          onAutoFollowPage?.(cur.projectId, prevPage, targetPage);
        } else if (audioRef.current) {
          audioRef.current.currentTime = targetPageTime;
          setCurrentTime(targetPageTime);
          persistPosition(cur.projectId, targetPage, targetPageTime, true);
        }
      } else if (audioRef.current) {
        audioRef.current.currentTime = targetBookTime;
        setCurrentTime(targetBookTime);
        persistPosition(cur.projectId, cur.playingPageNumber, targetBookTime, true);
      }
    },
    [orderedPages, timeline, duration, playProjectPage, onAutoFollowPage, persistPosition]
  );

  const stepPlayablePage = useCallback(
    (direction, overrideProject = null, overridePages = null, fallbackFromPage = null) => {
      const cur = sessionRef.current;
      const useOverride =
        overrideProject?.id && (!cur.isActive || cur.projectId !== overrideProject.id);
      const pagesToUse = useOverride
        ? [...(overridePages || [])].sort((a, b) => a.page_number - b.page_number)
        : orderedPages;
      const fromPage = useOverride
        ? fallbackFromPage ?? 0
        : cur.playingPageNumber;

      const target = findPlayableInPages(pagesToUse, fromPage, direction);
      if (target === null) return null;

      if (useOverride) {
        playProjectPage(overrideProject, pagesToUse, target, null, { resume: false });
      } else {
        const prevPage = cur.playingPageNumber;
        setCurrentTime(0);
        persistPosition(cur.projectId, target, 0, true);
        setSession((prev) => ({
          ...prev,
          playingPageNumber: target,
          isActive: true
        }));
        onAutoFollowPage?.(cur.projectId, prevPage, target);
      }
      return target;
    },
    [orderedPages, playProjectPage, onAutoFollowPage, persistPosition]
  );

  const changeSpeed = useCallback((rate) => {
    setPlaybackRate(rate);
    try {
      localStorage.setItem(RATE_STORAGE_KEY, String(rate));
    } catch {}
    if (audioRef.current) {
      audioRef.current.defaultPlaybackRate = rate;
      audioRef.current.playbackRate = rate;
    }
  }, []);

  const changeVolume = useCallback((newVol) => {
    const saved = writeVolume(newVol);
    setVolume(saved);
    setIsMuted(false);
    if (audioRef.current) {
      audioRef.current.muted = false;
      audioRef.current.volume = saved;
    }
  }, []);

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev;
      if (audioRef.current) {
        audioRef.current.muted = next;
        audioRef.current.volume = next ? 0 : volume;
      }
      return next;
    });
  }, [volume]);

  const toggleFloatingPosition = useCallback(() => {
    setFloatingPosition((prev) => {
      const next = prev === 'corner' ? 'center' : 'corner';
      try {
        localStorage.setItem(FLOATING_POS_KEY, next);
      } catch {}
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({
      audioRef,
      session,
      orderedPages,
      currentPlayingPage,
      currentAudioUrl,
      nextPlayablePageNumber,
      prevPlayablePageNumber,
      isPlaying,
      isLoadingAudio,
      loadingProjectId,
      currentTime,
      duration,
      playbackRate,
      volume,
      isMuted,
      floatingPosition,
      timeline,
      bookPosition,
      seekTotal,
      syncWorkspaceProject,
      updateProjectPagesIfMatch,
      playProjectPage,
      playProjectFromLibrary,
      resumeProject,
      togglePlay,
      pause,
      stopAndDismiss,
      skipSeconds,
      applySeek,
      stepPlayablePage,
      changeSpeed,
      changeVolume,
      toggleMute,
      toggleFloatingPosition
    }),
    [
      session,
      orderedPages,
      currentPlayingPage,
      currentAudioUrl,
      nextPlayablePageNumber,
      prevPlayablePageNumber,
      isPlaying,
      isLoadingAudio,
      loadingProjectId,
      currentTime,
      duration,
      playbackRate,
      volume,
      isMuted,
      floatingPosition,
      timeline,
      bookPosition,
      seekTotal,
      syncWorkspaceProject,
      updateProjectPagesIfMatch,
      playProjectPage,
      playProjectFromLibrary,
      togglePlay,
      pause,
      stopAndDismiss,
      skipSeconds,
      applySeek,
      stepPlayablePage,
      changeSpeed,
      changeVolume,
      toggleMute,
      toggleFloatingPosition
    ]
  );

  return (
    <AudioPlayerContext.Provider value={value}>
      {/* Persistent root <audio> elements — never unmount across routes */}
      <audio
        ref={audioRef}
        preload="auto"
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onPause={() => {
          if (!playIntentRef.current) setIsPlaying(false);
          const cur = sessionRef.current;
          if (audioRef.current && isCurrentTrackLoaded(cur)) {
            persistPosition(cur.projectId, cur.playingPageNumber, audioRef.current.currentTime, true);
          }
        }}
        onPlay={() => setIsPlaying(true)}
        onEnded={handleEnded}
        className="hidden"
      />
      {nextPreviewUrl && (
        <audio ref={preloadRef} src={nextPreviewUrl} preload="auto" className="hidden" />
      )}
      {children}
    </AudioPlayerContext.Provider>
  );
}

export function useAudioPlayerOptional() {
  return useContext(AudioPlayerContext);
}

export function useAudioPlayer() {
  const ctx = useContext(AudioPlayerContext);
  if (!ctx) {
    throw new Error('useAudioPlayer must be used within a GlobalAudioProvider');
  }
  return ctx;
}
