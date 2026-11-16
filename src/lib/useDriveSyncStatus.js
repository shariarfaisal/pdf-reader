import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const IDLE_POLL_MS = 15000;
const ACTIVE_POLL_MS = 2000;

/**
 * Live Drive sync status for every project with narration audio.
 * Polls faster while an upload job is running so progress feels live.
 */
export function useDriveSyncStatus() {
  const [state, setState] = useState({ drive: null, projects: [], error: null, loaded: false });
  const timer = useRef(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/drive/sync-status');
      if (!res.ok) throw new Error(`Drive status request failed (${res.status})`);
      const data = await res.json();
      setState({ drive: data.drive, projects: data.projects, error: null, loaded: true });
      return data;
    } catch (err) {
      setState((prev) => ({ ...prev, error: err.message, loaded: true }));
      return null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const data = await refresh();
      if (cancelled) return;
      const busy = data?.projects?.some((project) => ['queued', 'running'].includes(project.job?.state));
      timer.current = setTimeout(tick, busy ? ACTIVE_POLL_MS : IDLE_POLL_MS);
    };
    tick();
    return () => {
      cancelled = true;
      clearTimeout(timer.current);
    };
  }, [refresh]);

  const byProject = useMemo(
    () => Object.fromEntries(state.projects.map((project) => [project.id, project])),
    [state.projects]
  );

  return { ...state, byProject, refresh };
}
