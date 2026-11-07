import { useCallback, useEffect, useState } from 'react';

/** Fired by the Voice Studio / Settings whenever the library changes. */
export const VOICES_CHANGED_EVENT = 'voices-changed';

export function notifyVoicesChanged() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(VOICES_CHANGED_EVENT));
  }
}

/**
 * Voice library + per-language defaults (`tts_voice_bn/en/ar`).
 * Refreshes on mount, on the shared change event, and when explicitly reloaded.
 */
export function useVoiceLibrary({ enabled = true } = {}) {
  const [voices, setVoices] = useState([]);
  const [defaults, setDefaults] = useState({ bn: 'builtin', en: 'builtin', ar: 'builtin' });
  const [isLoading, setIsLoading] = useState(enabled);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/voices');
      if (!res.ok) throw new Error(`Voice library unavailable (${res.status})`);
      const data = await res.json();
      setVoices(data.voices || []);
      setDefaults({
        bn: data.defaults?.bn || 'builtin',
        en: data.defaults?.en || 'builtin',
        ar: data.defaults?.ar || 'builtin'
      });
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    load();
    const handler = () => load();
    window.addEventListener(VOICES_CHANGED_EVENT, handler);
    return () => window.removeEventListener(VOICES_CHANGED_EVENT, handler);
  }, [enabled, load]);

  /** Assign the narrator for one language (persists `tts_voice_<lang>`). */
  const setDefaultVoice = useCallback(
    async (language, voiceId) => {
      const target = voiceId || 'builtin';
      const previous = defaults[language];
      setDefaults((prev) => ({ ...prev, [language]: target }));
      const res = await fetch(`/api/voices/${encodeURIComponent(target)}/default`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language })
      });
      if (!res.ok) {
        setDefaults((prev) => ({ ...prev, [language]: previous }));
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Could not save the narrator voice');
      }
      return target;
    },
    [defaults]
  );

  return { voices, defaults, isLoading, error, reload: load, setDefaultVoice };
}
