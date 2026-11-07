import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'pdf-reader-theme';
const THEME_CHANGE_EVENT = 'pdf-reader-theme-changed';

export function getStoredTheme() {
  if (typeof window === 'undefined') return 'light';
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {}
  return 'light'; // Default to light per user request, while supporting dark seamlessly
}

export function applyTheme(theme) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.remove('light', 'dark');
  root.classList.add(theme);
  root.setAttribute('data-theme', theme);
  root.style.colorScheme = theme;
}

export function setThemePreference(theme) {
  const nextTheme = theme === 'dark' ? 'dark' : 'light';
  try {
    localStorage.setItem(STORAGE_KEY, nextTheme);
  } catch {}
  applyTheme(nextTheme);
  window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: nextTheme }));
  return nextTheme;
}

export function useTheme() {
  const [theme, setLocalTheme] = useState(() => getStoredTheme());

  useEffect(() => {
    applyTheme(theme);

    const onThemeChange = (e) => {
      if (e?.detail) {
        setLocalTheme(e.detail);
      }
    };

    const onStorage = (e) => {
      if (e.key === STORAGE_KEY && (e.newValue === 'light' || e.newValue === 'dark')) {
        setLocalTheme(e.newValue);
        applyTheme(e.newValue);
      }
    };

    window.addEventListener(THEME_CHANGE_EVENT, onThemeChange);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(THEME_CHANGE_EVENT, onThemeChange);
      window.removeEventListener('storage', onStorage);
    };
  }, [theme]);

  const toggleTheme = useCallback(() => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setThemePreference(next);
    setLocalTheme(next);
  }, [theme]);

  const setTheme = useCallback((next) => {
    setThemePreference(next);
    setLocalTheme(next);
  }, []);

  return { theme, setTheme, toggleTheme, isDark: theme === 'dark' };
}
