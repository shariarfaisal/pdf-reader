import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'pdf-reader-theme';
const THEME_CHANGE_EVENT = 'pdf-reader-theme-changed';

export function getSystemTheme() {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

export function getStoredPreference() {
  if (typeof window === 'undefined') return 'light';
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark' || saved === 'system') return saved;
  } catch {}
  return 'light'; // Default to light per brief
}

export function resolveTheme(pref) {
  if (pref === 'system') return getSystemTheme();
  return pref === 'dark' ? 'dark' : 'light';
}

export function applyTheme(resolvedTheme) {
  if (typeof document === 'undefined') return;
  const safe = resolvedTheme === 'dark' ? 'dark' : 'light';
  const root = document.documentElement;
  root.classList.remove('light', 'dark');
  root.classList.add(safe);
  root.setAttribute('data-theme', safe);
  root.style.colorScheme = safe;
}

export function setThemePreference(pref) {
  const nextPref = pref === 'dark' || pref === 'system' ? pref : 'light';
  try {
    localStorage.setItem(STORAGE_KEY, nextPref);
  } catch {}
  const resolved = resolveTheme(nextPref);
  applyTheme(resolved);
  window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: { preference: nextPref, resolved } }));
  return nextPref;
}

export function useTheme() {
  const [preference, setPreferenceState] = useState(() => getStoredPreference());
  const [theme, setResolvedTheme] = useState(() => resolveTheme(getStoredPreference()));

  useEffect(() => {
    applyTheme(theme);

    const onThemeChange = (e) => {
      const rawPref = typeof e?.detail === 'string' ? e.detail : e?.detail?.preference;
      const rawRes = typeof e?.detail === 'string' ? resolveTheme(e.detail) : e?.detail?.resolved;
      if (rawPref || rawRes) {
        const nextPref = rawPref || rawRes;
        const nextRes = rawRes || resolveTheme(nextPref);
        setPreferenceState(nextPref);
        setResolvedTheme(nextRes);
        applyTheme(nextRes);
      }
    };

    const onMediaChange = (e) => {
      const currentPref = getStoredPreference();
      if (currentPref === 'system') {
        const nextResolved = e.matches ? 'dark' : 'light';
        setResolvedTheme(nextResolved);
        applyTheme(nextResolved);
      }
    };

    const mql = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    mql?.addEventListener('change', onMediaChange);

    const onStorage = (e) => {
      if (e.key === STORAGE_KEY) {
        const nextPref = e.newValue === 'dark' || e.newValue === 'system' ? e.newValue : 'light';
        setPreferenceState(nextPref);
        const nextRes = resolveTheme(nextPref);
        setResolvedTheme(nextRes);
        applyTheme(nextRes);
      }
    };

    window.addEventListener(THEME_CHANGE_EVENT, onThemeChange);
    window.addEventListener('storage', onStorage);
    return () => {
      mql?.removeEventListener('change', onMediaChange);
      window.removeEventListener(THEME_CHANGE_EVENT, onThemeChange);
      window.removeEventListener('storage', onStorage);
    };
  }, [theme]);

  const toggleTheme = useCallback(() => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setThemePreference(next);
    setPreferenceState(next);
    setResolvedTheme(next);
  }, [theme]);

  const setTheme = useCallback((next) => {
    setThemePreference(next);
    setPreferenceState(next);
    setResolvedTheme(resolveTheme(next));
  }, []);

  return { theme, preference, setTheme, toggleTheme, isDark: theme === 'dark' };
}
