import React, { useState, useEffect, useRef } from 'react';
import {
  Type,
  Palette,
  Columns,
  Sliders,
  ZoomIn,
  ZoomOut,
  Maximize2,
  RotateCcw,
  AlignLeft,
  Settings2,
  Check,
  ChevronDown
} from 'lucide-react';
import { Button } from './ui/Button';

export const DEFAULT_READER_SETTINGS = {
  fontSize: 18,
  fontFamily: 'auto', // 'auto' | 'sans' | 'serif' | 'bengali' | 'arabic' | 'mono'
  lineHeight: 'comfortable', // 'compact' | 'comfortable' | 'relaxed'
  theme: 'paper', // 'paper' | 'obsidian' | 'midnight' | 'sepia' | 'oled'
  highlightStyle: 'glow', // 'glow' | 'subtle' | 'warm'
  autoScroll: true,
  contentWidth: 'reading' // 'compact' | 'reading' | 'full'
};

export const THEMES = [
  { id: 'paper', label: 'Paper White', color: '#ffffff', border: '#cbd5e1' },
  { id: 'obsidian', label: 'Obsidian', color: '#070a0f', border: '#1e293b' },
  { id: 'midnight', label: 'Midnight', color: '#0a1120', border: '#1e293b' },
  { id: 'sepia', label: 'Warm Sepia', color: '#fbf7ee', border: '#e2d8c3' },
  { id: 'oled', label: 'High Contrast', color: '#000000', border: '#334155' }
];

export const FONT_OPTIONS = [
  { id: 'auto', label: 'Auto (Script-aware)' },
  { id: 'sans', label: 'Inter (Modern Sans)' },
  { id: 'serif', label: 'Merriweather (Book Serif)' },
  { id: 'bengali', label: 'Hind Siliguri (Bengali)' },
  { id: 'arabic', label: 'Amiri (Traditional Arabic)' },
  { id: 'mono', label: 'JetBrains Mono' }
];

export const LINE_HEIGHTS = [
  { id: 'compact', label: 'Compact (1.5)', value: 1.5 },
  { id: 'comfortable', label: 'Comfortable (1.85)', value: 1.85 },
  { id: 'relaxed', label: 'Relaxed (2.2)', value: 2.2 }
];

export const HIGHLIGHT_STYLES = [
  { id: 'glow', label: 'Glow Cyan (Default)' },
  { id: 'subtle', label: 'Subtle Blue' },
  { id: 'warm', label: 'Warm Amber' }
];

export const CONTENT_WIDTHS = [
  { id: 'compact', label: 'Narrow (54ch)' },
  { id: 'reading', label: 'Optimal (68ch)' },
  { id: 'full', label: 'Full width' }
];

const READER_SETTINGS_KEY = 'pdf_reader_display_settings';

/** Fired on every change so the Settings page and an open reader stay in sync. */
export const READER_SETTINGS_EVENT = 'pdf-reader:display-settings';

function readStoredReaderSettings() {
  try {
    const saved = localStorage.getItem(READER_SETTINGS_KEY);
    return saved ? { ...DEFAULT_READER_SETTINGS, ...JSON.parse(saved) } : DEFAULT_READER_SETTINGS;
  } catch {
    return DEFAULT_READER_SETTINGS;
  }
}

export function useReaderSettings() {
  const [settings, setSettings] = useState(readStoredReaderSettings);
  // Kept in a ref so consecutive updates in one handler never read stale state.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // A change made in Settings must repaint the reader that is already open.
  useEffect(() => {
    const sync = (event) => {
      const next = event.detail || readStoredReaderSettings();
      settingsRef.current = next;
      setSettings(next);
    };
    window.addEventListener(READER_SETTINGS_EVENT, sync);
    return () => window.removeEventListener(READER_SETTINGS_EVENT, sync);
  }, []);

  const commit = (next) => {
    settingsRef.current = next;
    setSettings(next);
    try {
      localStorage.setItem(READER_SETTINGS_KEY, JSON.stringify(next));
    } catch {}
    window.dispatchEvent(new CustomEvent(READER_SETTINGS_EVENT, { detail: next }));
  };
  const updateSetting = (key, value) => commit({ ...settingsRef.current, [key]: value });
  const resetSettings = () => commit({ ...DEFAULT_READER_SETTINGS });

  return { settings, updateSetting, resetSettings };
}

/**
 * Compact font size stepper for placing inside the Reading Canvas column header.
 */
export function FontSizeStepper({ settings, updateSetting, className = '' }) {
  const stepFontSize = (delta) => {
    const next = Math.max(13, Math.min(32, (settings.fontSize || 18) + delta));
    updateSetting('fontSize', next);
  };

  return (
    <div className={`flex items-center bg-obsidian-950/80 rounded-lg border border-obsidian-800 p-0.5 ${className}`}>
      <button
        type="button"
        onClick={() => stepFontSize(-1)}
        title="Decrease font size ([)"
        aria-label="Decrease font size"
        disabled={settings.fontSize <= 13}
        className="h-6 px-1.5 text-xs font-semibold text-slate-400 hover:text-white disabled:opacity-30 rounded hover:bg-obsidian-800 transition"
      >
        A-
      </button>
      <span
        className="px-1.5 text-[11px] font-mono text-slate-300 tabular-nums min-w-[28px] text-center cursor-pointer hover:text-brand-300"
        title="Reset font size to 18px"
        onClick={() => updateSetting('fontSize', 18)}
      >
        {settings.fontSize}px
      </span>
      <button
        type="button"
        onClick={() => stepFontSize(1)}
        title="Increase font size (])"
        aria-label="Increase font size"
        disabled={settings.fontSize >= 32}
        className="h-6 px-1.5 text-xs font-semibold text-slate-400 hover:text-white disabled:opacity-30 rounded hover:bg-obsidian-800 transition"
      >
        A+
      </button>
    </div>
  );
}

/**
 * Clean, single-button Appearance menu for the global header.
 * Opens an organized popover containing themes, layout modes, font, and density.
 */
export function ReaderCustomizer({ settings, updateSetting, onReset }) {
  const [isOpen, setIsOpen] = useState(false);
  const popoverRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    const handleKey = (e) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [isOpen]);

  const activeTheme = THEMES.find((t) => t.id === settings.theme) || THEMES[0];

  return (
    <div className="relative inline-flex" ref={popoverRef}>
      <Button
        variant={isOpen ? 'secondary' : 'ghost'}
        size="sm"
        icon={Sliders}
        title="Display & Reading Appearance (T)"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((prev) => !prev)}
        className="gap-1.5 flex-shrink-0"
      >
        <span>Appearance</span>
        <span
          className="w-2.5 h-2.5 rounded-full border border-slate-600 flex-shrink-0"
          style={{ backgroundColor: activeTheme.color }}
          title={`Active theme: ${activeTheme.label}`}
        />
        <ChevronDown
          className={`w-3.5 h-3.5 transition-transform duration-150 ${isOpen ? 'rotate-180' : ''}`}
        />
      </Button>

      {isOpen && (
        <div
          className="absolute right-0 top-full mt-2 w-80 bg-obsidian-850/95 backdrop-blur-md border border-obsidian-700/90 rounded-2xl shadow-2xl shadow-black/80 p-4 z-50 animate-fade-in space-y-4"
          role="dialog"
          aria-label="Reader customization options"
        >
          <div className="flex items-center justify-between pb-2 border-b border-obsidian-700/70">
            <span className="text-xs font-semibold text-slate-100 flex items-center gap-1.5">
              <Sliders className="w-3.5 h-3.5 text-brand-400" />
              Reading Display & Layout
            </span>
            <button
              type="button"
              onClick={onReset}
              className="text-[11px] text-slate-400 hover:text-brand-300 transition"
            >
              Reset
            </button>
          </div>

          {/* Reading Theme */}
          <div>
            <label className="text-xs font-medium text-slate-300 mb-1.5 block">
              Document Sheet Theme
            </label>
            <div className="grid grid-cols-5 gap-1.5">
              {THEMES.map((th) => (
                <button
                  key={th.id}
                  type="button"
                  onClick={() => updateSetting('theme', th.id)}
                  className={`flex flex-col items-center gap-1 p-1.5 rounded-xl border text-center transition ${
                    settings.theme === th.id
                      ? 'border-brand-400 bg-brand-500/10 text-brand-300 font-medium'
                      : 'border-obsidian-750 bg-obsidian-950/70 text-slate-400 hover:text-white hover:border-slate-600'
                  }`}
                >
                  <span
                    className="w-3.5 h-3.5 rounded-full border shadow-sm"
                    style={{ backgroundColor: th.color, borderColor: th.border }}
                  />
                  <span className="text-[10px] leading-tight truncate w-full">{th.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Font Family Selection */}
          <div>
            <label className="text-xs font-medium text-slate-300 mb-1.5 block">
              Typography Font
            </label>
            <select
              value={settings.fontFamily}
              onChange={(e) => updateSetting('fontFamily', e.target.value)}
              className="w-full bg-obsidian-950 border border-obsidian-700 rounded-lg px-2.5 h-8 text-xs text-slate-200 focus:outline-none focus:border-brand-400"
            >
              {FONT_OPTIONS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>

          {/* Line Spacing */}
          <div>
            <label className="text-xs font-medium text-slate-300 mb-1.5 block">
              Line Spacing
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              {LINE_HEIGHTS.map((lh) => (
                <button
                  key={lh.id}
                  type="button"
                  onClick={() => updateSetting('lineHeight', lh.id)}
                  className={`py-1 text-xs rounded-lg border transition ${
                    settings.lineHeight === lh.id
                      ? 'bg-brand-500/10 text-brand-300 border-brand-500/40 font-medium'
                      : 'border-obsidian-700 text-slate-400 hover:text-white hover:bg-obsidian-800'
                  }`}
                >
                  {lh.label.split(' ')[0]}
                </button>
              ))}
            </div>
          </div>

          {/* Column Width & Highlight Style */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-300 mb-1.5 block">
                Reading Width
              </label>
              <select
                value={settings.contentWidth}
                onChange={(e) => updateSetting('contentWidth', e.target.value)}
                className="w-full bg-obsidian-950 border border-obsidian-700 rounded-lg px-2 h-8 text-xs text-slate-200 focus:outline-none focus:border-brand-400"
              >
                {CONTENT_WIDTHS.map((cw) => (
                  <option key={cw.id} value={cw.id}>
                    {cw.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-300 mb-1.5 block">
                Audio Highlight
              </label>
              <select
                value={settings.highlightStyle}
                onChange={(e) => updateSetting('highlightStyle', e.target.value)}
                className="w-full bg-obsidian-950 border border-obsidian-700 rounded-lg px-2 h-8 text-xs text-slate-200 focus:outline-none focus:border-brand-400"
              >
                {HIGHLIGHT_STYLES.map((hl) => (
                  <option key={hl.id} value={hl.id}>
                    {hl.label.split(' ')[0]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Auto-scroll toggle */}
          <div className="pt-2 border-t border-obsidian-700/70 flex items-center justify-between">
            <div>
              <span className="text-xs font-medium text-slate-200 block">
                Auto-scroll with Audio
              </span>
              <span className="text-[11px] text-slate-500 block">
                Keep spoken paragraph centered
              </span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.autoScroll}
              onClick={() => updateSetting('autoScroll', !settings.autoScroll)}
              className={`w-9 h-5 flex items-center rounded-full p-0.5 transition-colors ${
                settings.autoScroll ? 'bg-brand-500' : 'bg-obsidian-700'
              }`}
            >
              <div
                className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${
                  settings.autoScroll ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Compact zoom toolbar for the original PDF canvas.
 */
export function CanvasZoomToolbar({
  zoom,
  setZoom,
  fitMode,
  setFitMode,
  onReset
}) {
  const stepZoom = (delta) => {
    setFitMode('custom');
    setZoom((prev) => Math.max(50, Math.min(250, prev + delta)));
  };

  return (
    <div className="flex items-center bg-obsidian-950/80 border border-obsidian-800 rounded-lg p-0.5 gap-0.5">
      <Button
        variant="ghost"
        size="icon-xs"
        icon={ZoomOut}
        title="Zoom Out (-15%)"
        aria-label="Zoom Out"
        disabled={zoom <= 50}
        onClick={() => stepZoom(-15)}
      />
      <span
        className="text-[11px] font-mono text-slate-300 min-w-[32px] text-center tabular-nums cursor-pointer hover:text-brand-300"
        title="Reset zoom to 100%"
        onClick={onReset}
      >
        {zoom}%
      </span>
      <Button
        variant="ghost"
        size="icon-xs"
        icon={ZoomIn}
        title="Zoom In (+15%)"
        aria-label="Zoom In"
        disabled={zoom >= 250}
        onClick={() => stepZoom(15)}
      />
      <div className="w-px h-3 bg-obsidian-800 mx-0.5" />
      <button
        type="button"
        onClick={() => {
          setFitMode('width');
          setZoom(100);
        }}
        className={`px-1.5 h-6 text-[10.5px] font-medium rounded transition ${
          fitMode === 'width' ? 'bg-obsidian-800 text-brand-300' : 'text-slate-400 hover:text-white'
        }`}
        title="Fit Image to Width"
      >
        Fit
      </button>
      <button
        type="button"
        onClick={onReset}
        className="px-1.5 h-6 text-[10.5px] font-medium rounded text-slate-400 hover:text-white transition"
        title="Reset Zoom to 100%"
      >
        1:1
      </button>
    </div>
  );
}
