import React, { useState, useEffect, useMemo } from 'react';
import {
  BookOpen,
  ArrowLeft,
  Settings as SettingsIcon,
  Zap,
  ScanText,
  Sparkles,
  Volume2,
  Mic,
  Server,
  Shield,
  Save,
  RotateCcw,
  Activity,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Boxes,
  HardDrive,
  Cpu,
  Sliders,
  Check,
  ExternalLink,
  Layers,
  AudioLines,
  Play,
  Pause
} from 'lucide-react';
import { Button } from './ui/Button';
import { Badge, Tag } from './ui/Badge';
import { Field, TextInput, TextArea, SelectInput } from './ui/Field';
import { ThemeToggle } from './ui/ThemeToggle';
import { useTheme } from '../lib/theme';
import { VoiceSelect } from './ui/VoiceSelect';
import { ColabSetupCard } from './ColabSetupCard';
import { DriveStorageCard } from './DriveStorageCard';
import { ModelManagerView } from './ModelHub';
import { VoiceStudio } from './VoiceStudio';
import { ApiUsageDashboard } from './ApiUsageDashboard';
import { TtsBackendControls, describeBackend } from './inspector/TtsBackendPanel';
import { VOICE_LANGUAGES, VOICE_LANGUAGE_LABELS, normalizeVoiceValue } from '../lib/voiceChoices';
import { useVoiceLibrary } from '../lib/useVoiceLibrary';
import {
  useReaderSettings,
  THEMES,
  FONT_OPTIONS,
  LINE_HEIGHTS,
  HIGHLIGHT_STYLES,
  CONTENT_WIDTHS
} from './ReaderCustomizer';
import { readVolume, writeVolume } from '../lib/playbackPrefs';
import { DEFAULT_REFINER_PROMPT } from '../lib/refinerPrompt';
import { changedSettings } from '../lib/settingsDiff';
import {
  navigate,
  LIBRARY_PATH,
  USAGE_PATH,
  VOICES_PATH,
  MODELS_PATH,
  SETTINGS_PATH
} from '../lib/router';

const SECTIONS = [
  { id: 'general', label: 'General', icon: Sliders, desc: 'Theme, interface, and application defaults' },
  { id: 'reading', label: 'Reading & playback', icon: BookOpen, desc: 'Typography, paper tone, and audio player defaults' },
  { id: 'processing', label: 'Processing & prompt', icon: Sparkles, desc: 'Text extraction and narration preparation' },
  { id: 'voices', label: 'Narrator voices', icon: Mic, desc: 'Voice cloning studio and language assignments' },
  { id: 'delivery', label: 'Speech & delivery', icon: Volume2, desc: 'Pacing, diffusion steps, and style notes' },
  { id: 'models', label: 'AI models', icon: Boxes, desc: 'Local model weights, cache, and runtime' },
  { id: 'usage', label: 'API usage & cost', icon: Activity, desc: 'Token usage, latency, spend, and call history' },
  { id: 'connections', label: 'AI gateway & endpoints', icon: Zap, desc: 'Provider, endpoints, authentication, and test' },
  { id: 'backend', label: 'TTS backend & GPU', icon: Server, desc: 'Local MPS vs Google Colab GPU acceleration' },
  { id: 'storage', label: 'Audio storage', icon: HardDrive, desc: 'Google Drive backup and local audio cache size' },
  { id: 'safety', label: 'Hardware safety', icon: Shield, desc: 'Pacing throttle and thermal protection' }
];

const INSTRUCT_TAGS = [
  'male',
  'female',
  'child',
  'teenager',
  'young adult',
  'middle-aged',
  'elderly',
  'very low pitch',
  'low pitch',
  'moderate pitch',
  'high pitch',
  'very high pitch',
  'whisper',
  'american accent',
  'british accent',
  'indian accent'
];

export function SettingsView({
  tab = 'general',
  initialSettings = {},
  projects = [],
  onSave,
  onBack,
  remoteStatus,
  onRemoteStart,
  onRemoteStop
}) {
  const [activeSection, setActiveSection] = useState(tab || 'general');
  const [formData, setFormData] = useState(() => ({ ...initialSettings }));
  const [saveStatus, setSaveStatus] = useState('clean'); // 'clean' | 'edited' | 'saving' | 'saved' | 'failed'
  const [hubRefreshToken, setHubRefreshToken] = useState(0);
  const [saveError, setSaveError] = useState(null);

  // Connection testing state
  const [testState, setTestState] = useState({ status: 'idle', message: '' });

  const { theme, preference, setTheme } = useTheme();
  const {
    settings: readerSettings,
    updateSetting: updateReaderSetting,
    resetSettings: resetReaderSettings
  } = useReaderSettings();
  const [volume, setVolumeState] = useState(readVolume);
  const { voices, defaults: voiceDefaults, setDefaultVoice } = useVoiceLibrary();

  const backendStatus = describeBackend(remoteStatus);
  const [playingDefaultVoice, setPlayingDefaultVoice] = useState(null);
  const defaultAudioRef = React.useRef(null);

  useEffect(() => {
    return () => {
      if (defaultAudioRef.current) {
        defaultAudioRef.current.pause();
        defaultAudioRef.current = null;
      }
    };
  }, []);

  const playVoiceSample = (lang, voiceId) => {
    const key = `${lang}:${voiceId}`;
    if (playingDefaultVoice === key) {
      defaultAudioRef.current?.pause();
      setPlayingDefaultVoice(null);
      return;
    }
    if (defaultAudioRef.current) {
      defaultAudioRef.current.pause();
    }
    let url = '/api/voices/builtin/audio';
    if (voiceId && voiceId !== 'builtin') {
      const match = voices.find((v) => v.id === voiceId);
      if (match?.audioUrl || match?.sampleUrl) {
        url = match.audioUrl || match.sampleUrl;
      }
    }
    const audio = new Audio(url);
    defaultAudioRef.current = audio;
    setPlayingDefaultVoice(key);
    audio.onended = () => setPlayingDefaultVoice(null);
    audio.onerror = () => setPlayingDefaultVoice(null);
    audio.play().catch(() => setPlayingDefaultVoice(null));
  };

  // Keep activeSection in sync with incoming tab prop
  useEffect(() => {
    if (tab && tab !== activeSection) {
      setActiveSection(tab);
    }
  }, [tab]);

  // Reset formData when initialSettings updates from server
  useEffect(() => {
    setFormData({ ...initialSettings });
    setSaveStatus('clean');
  }, [initialSettings]);

  // Track whether form has unsaved changes compared to initialSettings
  const isDirty = useMemo(() => {
    return JSON.stringify(formData) !== JSON.stringify(initialSettings);
  }, [formData, initialSettings]);

  useEffect(() => {
    if (saveStatus !== 'saving') {
      setSaveStatus(isDirty ? 'edited' : 'clean');
    }
  }, [isDirty]);

  const updateField = (key, val) => {
    setFormData((prev) => ({ ...prev, [key]: val }));
    setSaveError(null);
  };

  const handleCancel = () => {
    setFormData({ ...initialSettings });
    setSaveStatus('clean');
    setSaveError(null);
  };

  const handleSave = async () => {
    setSaveStatus('saving');
    setSaveError(null);
    try {
      await onSave?.(changedSettings(formData, initialSettings));
      setSaveStatus('saved');
      // Model hub reads cache dir / python env on its own: re-scan after a save
      // so the hub never shows stale paths or disk totals.
      setHubRefreshToken((n) => n + 1);
      setTimeout(() => {
        setSaveStatus('clean');
      }, 2500);
    } catch (err) {
      setSaveStatus('failed');
      setSaveError(err.message || 'Failed to save settings.');
    }
  };

  // Test Connection to configured Refiner Endpoint
  const handleTestConnection = async () => {
    setTestState({ status: 'testing', message: 'Testing connection to refiner endpoint…' });
    try {
      const endpoint = formData.refiner_url || 'http://localhost:8085/v1';
      const res = await fetch(`${endpoint.replace(/\/+$/, '')}/models`, {
        method: 'GET',
        headers: formData.refiner_key ? { Authorization: `Bearer ${formData.refiner_key}` } : {}
      });
      if (res.ok) {
        setTestState({ status: 'success', message: 'Connected successfully to AI Gateway endpoint.' });
      } else {
        setTestState({
          status: 'error',
          message: `Endpoint returned HTTP ${res.status}: ${res.statusText}`
        });
      }
    } catch (err) {
      setTestState({
        status: 'error',
        message: `Connection failed: ${err.message}. Is the endpoint reachable?`
      });
    }
  };

  const selectTab = (id) => {
    setActiveSection(id);
    navigate(`/settings?tab=${id}`, { replace: true });
  };

  // Sections that benefit from full-width container (Models, Voices, Usage)
  const isWideSection = ['models', 'voices', 'usage'].includes(activeSection);

  return (
    <div className="min-h-screen flex flex-col bg-app text-slate-100">
      {/* Shared Application Header — Clean, no redundant nav links */}
      <header className="sticky top-0 z-30 border-b border-obsidian-700/80 bg-obsidian-850/95 backdrop-blur-md">
        <div className="max-w-[1280px] mx-auto px-4 sm:px-6 md:px-8 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Button
              variant="ghost"
              size="sm"
              icon={ArrowLeft}
              onClick={onBack || (() => navigate(LIBRARY_PATH))}
              className="text-slate-300"
            >
              Library
            </Button>
            <span className="text-slate-500 font-normal">/</span>
            <span className="text-sm font-semibold text-slate-100 truncate">
              Settings
            </span>
          </div>

          <nav className="flex items-center gap-2">
            <ThemeToggle />
          </nav>
        </div>
      </header>

      {/* Main Settings Container */}
      <main className="flex-1 w-full max-w-[1280px] mx-auto px-4 sm:px-6 md:px-8 py-8 flex flex-col">
        {/* Page Heading & Truthful Save Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 mb-8 border-b border-obsidian-700/80">
          <div>
            <h1 className="text-2xl font-semibold text-slate-100 tracking-tight">
              Settings
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              Configure application defaults, narrator voices, AI models, usage tracking, and hardware safety.
            </p>
          </div>

          {/* Truthful Save Controls */}
          <div className="flex items-center gap-3">
            <span role="status" aria-live="polite" className="flex items-center">
              {saveStatus === 'clean' ? (
                <span className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400 font-medium">
                  <Check className="w-3.5 h-3.5" />
                  Saved
                </span>
              ) : saveStatus === 'saved' ? (
                <span className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400 font-medium">
                  <Check className="w-3.5 h-3.5" />
                  Saved successfully
                </span>
              ) : saveStatus === 'saving' ? (
                <span className="flex items-center gap-1.5 text-xs text-indigo-600 dark:text-indigo-400 font-medium">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Saving…
                </span>
              ) : saveStatus === 'failed' ? (
                <span className="flex items-center gap-1.5 text-xs text-rose-600 dark:text-rose-400 font-medium">
                  <AlertCircle className="w-3.5 h-3.5" />
                  Save failed
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400 font-medium">
                  Unsaved changes
                </span>
              )}
            </span>

            <Button
              variant="ghost"
              size="sm"
              disabled={!isDirty || saveStatus === 'saving'}
              onClick={handleCancel}
            >
              Cancel
            </Button>

            <Button
              variant="primary"
              size="sm"
              disabled={!isDirty || saveStatus === 'saving'}
              isLoading={saveStatus === 'saving'}
              onClick={handleSave}
            >
              Save settings
            </Button>
          </div>
        </div>

        {/* Two-Column Layout: Section Navigation Sidebar + Form Area */}
        <div className="flex flex-col md:flex-row items-start gap-8 flex-1">
          {/* Section Navigation Sidebar */}
          <aside className="w-full md:w-[216px] flex-shrink-0 space-y-1">
            {SECTIONS.map((sec) => {
              const Icon = sec.icon;
              const isActive = activeSection === sec.id;
              return (
                <button
                  key={sec.id}
                  type="button"
                  onClick={() => selectTab(sec.id)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-xs font-medium flex items-center gap-2.5 transition-colors cursor-pointer ${
                    isActive
                      ? 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-300 font-semibold border border-indigo-500/25'
                      : 'text-slate-400 hover:text-slate-100 hover:bg-obsidian-850'
                  }`}
                >
                  <Icon className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-indigo-500 dark:text-indigo-400' : 'text-slate-400'}`} />
                  <span className="truncate">{sec.label}</span>
                </button>
              );
            })}

            <div className="pt-6 px-3">
              <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">
                Scope
              </span>
              <p className="text-[11px] leading-relaxed text-slate-400">
                Application defaults. Changing values applies to new generation jobs. Existing recordings remain unchanged.
              </p>
            </div>
          </aside>

          {/* Form Area */}
          <div className={`flex-1 min-w-0 ${isWideSection ? 'w-full' : 'max-w-[780px]'} space-y-6`}>
            {saveError && (
              <div className="p-3.5 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-300 text-xs flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="font-semibold">Failed to save settings</p>
                  <p className="mt-0.5">{saveError}</p>
                </div>
              </div>
            )}

            {/* 1. General Section */}
            {activeSection === 'general' && (
              <section className="space-y-5">
                <div>
                  <h2 className="text-base font-semibold text-slate-100">General Preferences</h2>
                  <p className="text-xs text-slate-400 mt-0.5">Application theme and interface behavior.</p>
                </div>
                <div className="p-5 rounded-xl border border-obsidian-700/80 bg-obsidian-850 space-y-4">
                  <Field label="Interface Theme" hint="Choose between Light, Dark, or follow your operating system appearance.">
                    <div className="grid grid-cols-3 gap-2 pt-1">
                      {['light', 'dark', 'system'].map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setTheme(t)}
                          className={`h-9 rounded-lg border text-xs font-medium capitalize transition-colors cursor-pointer ${
                            preference === t
                              ? 'btn-primary-token font-semibold shadow-xs'
                              : 'bg-obsidian-900 border-obsidian-700 text-slate-300 hover:border-obsidian-600'
                          }`}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </Field>
                </div>
              </section>
            )}

            {/* 2. Reading & Playback Section */}
            {activeSection === 'reading' && (
              <section className="space-y-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold text-slate-100">Reading & Playback Defaults</h2>
                    <p className="text-xs text-slate-400 mt-0.5">Reader typography, canvas paper tone, and default playback level.</p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    icon={RotateCcw}
                    onClick={resetReaderSettings}
                    className="flex-shrink-0"
                  >
                    Reset reading defaults
                  </Button>
                </div>
                <div className="p-5 rounded-xl border border-obsidian-700/80 bg-obsidian-850 space-y-5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                    <Field label="Default Font Family">
                      <SelectInput
                        value={readerSettings.fontFamily}
                        onChange={(e) => updateReaderSetting('fontFamily', e.target.value)}
                      >
                        {FONT_OPTIONS.map((opt) => (
                          <option key={opt.id} value={opt.id}>{opt.label}</option>
                        ))}
                      </SelectInput>
                    </Field>
                    <Field label="Default Font Size (px)">
                      <TextInput
                        type="number"
                        min="13"
                        max="32"
                        value={readerSettings.fontSize}
                        onChange={(e) => updateReaderSetting('fontSize', parseInt(e.target.value, 10) || 18)}
                      />
                    </Field>
                    <Field label="Line Spacing">
                      <SelectInput
                        value={readerSettings.lineHeight}
                        onChange={(e) => updateReaderSetting('lineHeight', e.target.value)}
                      >
                        {LINE_HEIGHTS.map((opt) => (
                          <option key={opt.id} value={opt.id}>{opt.label}</option>
                        ))}
                      </SelectInput>
                    </Field>
                    <Field label="Reading Canvas Tone">
                      <SelectInput
                        value={readerSettings.theme}
                        onChange={(e) => updateReaderSetting('theme', e.target.value)}
                      >
                        {THEMES.map((opt) => (
                          <option key={opt.id} value={opt.id}>{opt.label}</option>
                        ))}
                      </SelectInput>
                    </Field>
                    <Field label="Reading Column Width">
                      <SelectInput
                        value={readerSettings.contentWidth || 'normal'}
                        onChange={(e) => updateReaderSetting('contentWidth', e.target.value)}
                      >
                        {CONTENT_WIDTHS.map((opt) => (
                          <option key={opt.id} value={opt.id}>{opt.label}</option>
                        ))}
                      </SelectInput>
                    </Field>
                    <Field label="Audio Highlight Style">
                      <SelectInput
                        value={readerSettings.highlightStyle || 'box'}
                        onChange={(e) => updateReaderSetting('highlightStyle', e.target.value)}
                      >
                        {HIGHLIGHT_STYLES.map((opt) => (
                          <option key={opt.id} value={opt.id}>{opt.label}</option>
                        ))}
                      </SelectInput>
                    </Field>
                  </div>

                  <div className="flex items-center justify-between gap-3 border-t border-obsidian-750 pt-4">
                    <div>
                      <p className="text-xs font-medium text-slate-200">Auto-scroll to narration</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Keeps the currently playing paragraph smoothly in view as audio advances.
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={readerSettings.autoScroll}
                      onClick={() => updateReaderSetting('autoScroll', !readerSettings.autoScroll)}
                      className={`w-9 h-5 flex-shrink-0 flex items-center rounded-full p-0.5 transition-colors cursor-pointer ${
                        readerSettings.autoScroll ? 'bg-indigo-600' : 'bg-obsidian-700'
                      }`}
                    >
                      <span
                        className={`bg-white w-4 h-4 rounded-full shadow-xs transform transition-transform ${
                          readerSettings.autoScroll ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>

                  <Field label="Playback Volume">
                    <div className="flex items-center gap-3 pt-1">
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={volume}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          setVolumeState(writeVolume(val));
                        }}
                        className="flex-1 accent-indigo-500 h-1.5 bg-obsidian-750 rounded-lg cursor-pointer"
                      />
                      <span className="font-mono text-xs text-slate-300 w-10 text-right">
                        {Math.round(volume * 100)}%
                      </span>
                    </div>
                  </Field>
                </div>
              </section>
            )}

            {/* 3. Processing Section */}
            {activeSection === 'processing' && (
              <section className="space-y-5">
                <div>
                  <h2 className="text-base font-semibold text-slate-100">Text Extraction & Narration Preparation</h2>
                  <p className="text-xs text-slate-400 mt-0.5">Control how digital and scanned PDF pages are extracted and refined.</p>
                </div>
                <div className="p-5 rounded-xl border border-obsidian-700/80 bg-obsidian-850 space-y-5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field
                      label="OCR Extraction Strategy"
                      hint="Scanned Bengali pages need Tesseract or the vision model; Apple Vision has no Bengali support."
                    >
                      <SelectInput
                        value={formData.ocr_tier || 'mac_first'}
                        onChange={(e) => updateField('ocr_tier', e.target.value)}
                      >
                        <option value="mac_first">Multi-engine: Tesseract + Apple Vision + LLM fallback (Recommended)</option>
                        <option value="mac_only">Offline only: Tesseract &amp; macOS Vision</option>
                        <option value="llm_only">LLM Vision direct (cloud / Antigravity proxy)</option>
                      </SelectInput>
                    </Field>

                    <Field
                      label="Target Execution Stage"
                      hint="Extracting text first lets you inspect and edit OCR or scripts before voice synthesis."
                    >
                      <SelectInput
                        value={formData.pipeline_stage_target || 'all'}
                        onChange={(e) => updateField('pipeline_stage_target', e.target.value)}
                      >
                        <option value="all">Full Pipeline: OCR → LLM Narration → Audio</option>
                        <option value="ocr">OCR Only: Extract text &amp; run OCR (skip LLM &amp; Audio)</option>
                        <option value="refine">Refine Only: Polish narration scripts with LLM (skip Audio)</option>
                        <option value="audio">Audio Only: Synthesize voice tracks from existing scripts</option>
                      </SelectInput>
                    </Field>
                  </div>

                  <Field
                    label="Refiner System Prompt"
                    hint="Instructs the LLM to strip noise (headers, page numbers, footnotes) and create natural spoken prose."
                    action={
                      <button
                        type="button"
                        onClick={() => updateField('refiner_system_prompt', DEFAULT_REFINER_PROMPT)}
                        className="text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer flex items-center gap-1"
                      >
                        <RotateCcw className="w-3 h-3" />
                        Reset to default
                      </button>
                    }
                  >
                    <TextArea
                      mono
                      rows={10}
                      value={formData.refiner_system_prompt ?? DEFAULT_REFINER_PROMPT}
                      onChange={(e) => updateField('refiner_system_prompt', e.target.value)}
                    />
                  </Field>

                  <Field
                    label="Additional Refiner Instructions (Optional)"
                    hint="Appended with highest priority (e.g. pronunciation rules, translation phrasing)."
                  >
                    <TextArea
                      rows={3}
                      placeholder={'e.g. Always transliterate Quranic Arabic verses before reading Bengali translation…\nKeep Hadith citations fully pronounced.'}
                      value={formData.refiner_extra_instructions || ''}
                      onChange={(e) => updateField('refiner_extra_instructions', e.target.value)}
                    />
                  </Field>
                </div>
              </section>
            )}

            {/* 4. Voices Section — Default narrators + Full Voice Studio */}
            {activeSection === 'voices' && (
              <section className="space-y-6">
                <div>
                  <h2 className="text-base font-semibold text-slate-100">Narrator Voices & Voice Studio</h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Assign default narrators per language and clone custom voices from short 10–30s audio samples.
                  </p>
                </div>

                {/* Default Language Voice Assignments */}
                <div className="p-5 rounded-xl border border-obsidian-700/80 bg-obsidian-850 space-y-4">
                  <div className="flex items-center justify-between border-b border-obsidian-750 pb-3">
                    <div className="flex items-center gap-2.5">
                      <div className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                        <Volume2 className="w-4 h-4" />
                      </div>
                      <div>
                        <h3 className="text-xs font-semibold text-slate-100 uppercase tracking-wider">
                          Default Language Narrators
                        </h3>
                        <p className="text-[11.5px] text-slate-400 mt-0.5">
                          Voice model or custom clone used automatically when synthesizing narration for each language.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    {VOICE_LANGUAGES.map((lang) => {
                      const voiceVal = normalizeVoiceValue(formData[`tts_voice_${lang}`] || voiceDefaults[lang]);
                      const isPlaying = playingDefaultVoice === `${lang}:${voiceVal}`;
                      return (
                        <div
                          key={lang}
                          className="p-3.5 rounded-lg border border-obsidian-750 bg-obsidian-900/40 space-y-2.5"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-slate-200">
                              {VOICE_LANGUAGE_LABELS[lang]}
                            </span>
                            <span className="text-[10px] font-mono uppercase text-slate-400">
                              {lang}
                            </span>
                          </div>

                          <div className="flex items-center gap-2">
                            <VoiceSelect
                              language={lang}
                              value={voiceVal}
                              voices={voices}
                              className="flex-1 min-w-0 bg-obsidian-850 border border-obsidian-700 rounded-lg px-2.5 py-2 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
                              onChange={(val) => {
                                updateField(`tts_voice_${lang}`, val);
                                setDefaultVoice?.(lang, val);
                              }}
                            />
                            <Button
                              type="button"
                              variant={isPlaying ? 'primary' : 'secondary'}
                              size="icon-sm"
                              icon={isPlaying ? Pause : Play}
                              onClick={() => playVoiceSample(lang, voiceVal)}
                              title={isPlaying ? 'Pause audio' : 'Listen sample'}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <VoiceStudio embedded />
              </section>
            )}

            {/* 5. Speech & Delivery Section */}
            {activeSection === 'delivery' && (
              <section className="space-y-5">
                <div>
                  <h2 className="text-base font-semibold text-slate-100">Speech & Delivery Controls</h2>
                  <p className="text-xs text-slate-400 mt-0.5">Fine-tune pacing, diffusion sampling, and voice style notes.</p>
                </div>
                <div className="p-5 rounded-xl border border-obsidian-700/80 bg-obsidian-850 space-y-5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field label="Speech Pacing / Speed" hint="Multiplier applied to narration tempo (0.85 solemn · 1.0 normal · 1.15 brisk)">
                      <TextInput
                        type="number"
                        step="0.05"
                        min="0.5"
                        max="2.0"
                        value={formData.tts_speed || 1.0}
                        onChange={(e) => updateField('tts_speed', parseFloat(e.target.value) || 1.0)}
                      />
                    </Field>
                    <Field label="Diffusion Sampling Steps" hint="Higher steps improve audio clarity at the expense of synthesis time.">
                      <SelectInput
                        value={formData.tts_num_step || '24'}
                        onChange={(e) => updateField('tts_num_step', e.target.value)}
                      >
                        <option value="16">16 — fastest (lower compute)</option>
                        <option value="24">24 — balanced (recommended)</option>
                        <option value="32">32 — best quality (richer timbre)</option>
                      </SelectInput>
                    </Field>
                  </div>

                  <Field
                    label="Voice Instruct Tags"
                    hint="Fixed vocabulary supported by OmniVoice (comma-separated)."
                  >
                    <TextInput
                      mono
                      list="omnivoice-instruct-tags"
                      placeholder="e.g. male, moderate pitch, american accent"
                      value={formData.tts_instruct || ''}
                      onChange={(e) => updateField('tts_instruct', e.target.value)}
                    />
                    <datalist id="omnivoice-instruct-tags">
                      {INSTRUCT_TAGS.map((tag) => (
                        <option key={tag} value={tag} />
                      ))}
                    </datalist>
                  </Field>

                  <Field
                    label="Narration Style Notes"
                    hint="Free text consumed by the refiner to shape spoken delivery (e.g. calm, expressive, storytelling)."
                  >
                    <TextArea
                      rows={3}
                      placeholder="e.g. Reverent audiobook narration: short sentences, unhurried pacing, emphasize citations with a slight pause…"
                      value={formData.tts_style_notes || ''}
                      onChange={(e) => updateField('tts_style_notes', e.target.value)}
                    />
                  </Field>
                </div>
              </section>
            )}

            {/* 6. Models Section — Storage Configuration + Full ModelManagerView */}
            {activeSection === 'models' && (
              <section className="space-y-5">
                <div>
                  <h2 className="text-base font-semibold text-slate-100">Local AI Models & Hub</h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Manage weights and runtimes for voice cloning (OmniVoice), speech recognition (Whisper), and local OCR.
                  </p>
                </div>

                {/* Storage & Environment Config */}
                <div className="p-5 rounded-xl border border-obsidian-700/80 bg-obsidian-850 space-y-4">
                  <div className="flex items-center gap-2 border-b border-obsidian-750 pb-2">
                    <HardDrive className="w-4 h-4 text-indigo-400" />
                    <h3 className="text-xs font-semibold text-slate-200 uppercase tracking-wider">
                      Shared Cache Directory & Python Runtime
                    </h3>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field
                      label="Hugging Face Cache Directory"
                      hint="Leave empty to use default ~/.cache/huggingface/hub."
                    >
                      <TextInput
                        mono
                        placeholder="~/.cache/huggingface/hub"
                        value={formData.models_cache_dir || ''}
                        onChange={(e) => updateField('models_cache_dir', e.target.value)}
                      />
                    </Field>
                    <Field
                      label="Python Runtime Executable"
                      hint="Leave empty to auto-detect .venv or system python3."
                    >
                      <TextInput
                        mono
                        placeholder="auto-detect (.venv / python3)"
                        value={formData.python_bin || ''}
                        onChange={(e) => updateField('python_bin', e.target.value)}
                      />
                    </Field>
                    <div className="sm:col-span-2">
                      <Field
                        label="Hugging Face Access Token (optional)"
                        hint="Used only when downloading gated repositories or increasing API rate limits."
                      >
                        <TextInput
                          type="password"
                          mono
                          placeholder="hf_..."
                          value={formData.hf_token || ''}
                          onChange={(e) => updateField('hf_token', e.target.value)}
                        />
                      </Field>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-obsidian-700/80 bg-obsidian-850 p-5 space-y-4">
                  <div className="flex items-center gap-2 border-b border-obsidian-750 pb-2">
                    <Boxes className="w-4 h-4 text-indigo-500 dark:text-indigo-400" />
                    <h3 className="text-xs font-semibold text-slate-200 uppercase tracking-wider">
                      Model Library
                    </h3>
                  </div>
                  <ModelManagerView
                    refreshToken={hubRefreshToken}
                    onSettingsChanged={(next) => next && setFormData((prev) => ({ ...prev, ...next }))}
                  />
                </div>
              </section>
            )}

            {/* 7. Usage Section — Full ApiUsageDashboard Embedded! */}
            {activeSection === 'usage' && (
              <section className="space-y-4">
                <div className="rounded-xl border border-obsidian-700/80 bg-obsidian-850 p-5">
                  <ApiUsageDashboard embedded projects={projects} />
                </div>
              </section>
            )}

            {/* 8. Connections Section */}
            {activeSection === 'connections' && (
              <section className="space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold text-slate-100">AI Gateway & Model Endpoints</h2>
                    <p className="text-xs text-slate-400 mt-0.5">Configure endpoints, authentication, and verify reachability.</p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    icon={Zap}
                    onClick={() => {
                      updateField('refiner_url', 'http://127.0.0.1:8085/v1');
                      updateField('refiner_model', 'gemini-2.5-flash');
                      updateField('refiner_key', 'antigravity-zero-key');
                      updateField('llm_vision_url', 'http://127.0.0.1:8085/v1');
                      updateField('llm_vision_model', 'gemini-2.5-flash');
                      updateField('llm_vision_key', 'antigravity-zero-key');
                      updateField('usage_free_local', '1');
                    }}
                    className="border-indigo-500/40 text-indigo-400 hover:bg-indigo-500/10 flex-shrink-0"
                  >
                    Auto-configure Antigravity (:8085)
                  </Button>
                </div>

                <div className="p-5 rounded-xl border border-obsidian-700/80 bg-obsidian-850 space-y-5">
                  <div className="flex items-center gap-2 border-b border-obsidian-750 pb-2">
                    <Sparkles className="w-4 h-4 text-indigo-400" />
                    <h3 className="text-xs font-semibold text-slate-200 uppercase tracking-wider">Narration Refiner (LLM)</h3>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field label="Refiner Endpoint URL" hint="OpenAI-compatible /v1 chat completions endpoint.">
                      <TextInput
                        mono
                        value={formData.refiner_url || 'http://localhost:8085/v1'}
                        onChange={(e) => updateField('refiner_url', e.target.value)}
                      />
                    </Field>
                    <Field label="Refiner Model Identifier">
                      <TextInput
                        mono
                        value={formData.refiner_model || 'gemini-2.5-flash'}
                        onChange={(e) => updateField('refiner_model', e.target.value)}
                      />
                    </Field>
                    <div className="sm:col-span-2">
                      <Field label="Refiner API Key (Optional for local proxy)" hint="Leave blank or placeholder when using Antigravity local bridge (:8085).">
                        <TextInput
                          type="password"
                          mono
                          placeholder="sk-... or antigravity-zero-key"
                          value={formData.refiner_key || ''}
                          onChange={(e) => updateField('refiner_key', e.target.value)}
                        />
                      </Field>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 border-b border-obsidian-750 pb-2 pt-2">
                    <ScanText className="w-4 h-4 text-sky-400" />
                    <h3 className="text-xs font-semibold text-slate-200 uppercase tracking-wider">Vision LLM Fallback (OCR)</h3>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field label="Vision Endpoint URL" hint="OpenAI-compatible endpoint for image text extraction.">
                      <TextInput
                        mono
                        value={formData.llm_vision_url || 'http://127.0.0.1:8085/v1'}
                        onChange={(e) => updateField('llm_vision_url', e.target.value)}
                      />
                    </Field>
                    <Field label="Vision Model Identifier">
                      <TextInput
                        mono
                        value={formData.llm_vision_model || 'gemini-2.5-flash'}
                        onChange={(e) => updateField('llm_vision_model', e.target.value)}
                      />
                    </Field>
                    <div className="sm:col-span-2">
                      <Field label="Vision API Key (Optional for local proxy)">
                        <TextInput
                          type="password"
                          mono
                          placeholder="sk-... or antigravity-zero-key"
                          value={formData.llm_vision_key || ''}
                          onChange={(e) => updateField('llm_vision_key', e.target.value)}
                        />
                      </Field>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 border-b border-obsidian-750 pb-2 pt-2">
                    <Activity className="w-4 h-4 text-emerald-400" />
                    <h3 className="text-xs font-semibold text-slate-200 uppercase tracking-wider">Cost Accounting</h3>
                  </div>
                  <Field
                    label="Local Proxy Accounting"
                    hint="Free logs tokens and latencies while marking billed spend as $0 (list prices still tracked separately)."
                  >
                    <SelectInput
                      value={formData.usage_free_local ?? '1'}
                      onChange={(e) => updateField('usage_free_local', e.target.value)}
                    >
                      <option value="1">Free — log tokens only (zero cost for local Antigravity bridge)</option>
                      <option value="0">Billable — count calls at full provider API rates</option>
                    </SelectInput>
                  </Field>

                  {/* Connection Test Flow */}
                  <div className="pt-3 border-t border-obsidian-700/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={Zap}
                      isLoading={testState.status === 'testing'}
                      onClick={handleTestConnection}
                    >
                      Test connection
                    </Button>
                    {testState.status === 'success' ? (
                      <span className="text-xs text-emerald-700 dark:text-emerald-400 font-medium flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        {testState.message}
                      </span>
                    ) : testState.status === 'error' ? (
                      <span className="text-xs text-rose-500 font-medium flex items-center gap-1.5">
                        <AlertCircle className="w-3.5 h-3.5" />
                        {testState.message}
                      </span>
                    ) : null}
                  </div>
                </div>
              </section>
            )}

            {/* 9. Backend Section — Complete TTS & GPU Management */}
            {activeSection === 'backend' && (
              <section className="space-y-5">
                <div>
                  <h2 className="text-base font-semibold text-slate-100">TTS Backend & Remote GPU</h2>
                  <p className="text-xs text-slate-400 mt-0.5">Synthesize locally on Apple Silicon MPS or connect Google Colab GPU.</p>
                </div>

                {/* Live Worker Status & Controls */}
                <div className="p-5 rounded-xl border border-obsidian-700/80 bg-obsidian-850 space-y-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Server className="w-4 h-4 text-sky-400" />
                      <span className="text-sm font-semibold text-slate-200">Synthesis GPU Worker</span>
                    </div>
                    <Tag tone={backendStatus.tone} size="xs" dot={backendStatus.isRunning || backendStatus.isStarting}>
                      {backendStatus.pillLabel}
                    </Tag>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    {backendStatus.isRunning
                      ? 'Remote GPU is warm — voice synthesis is accelerated on NVIDIA GPU.'
                      : backendStatus.isStarting
                        ? 'Allocating Colab runtime and loading TTS weights…'
                        : 'Idle — synthesis runs locally on Apple Silicon MPS.'}
                  </p>
                  <TtsBackendControls
                    remoteStatus={remoteStatus}
                    onRemoteStart={onRemoteStart}
                    onRemoteStop={onRemoteStop}
                  />
                </div>

                {/* Configuration Options */}
                <div className="p-5 rounded-xl border border-obsidian-700/80 bg-obsidian-850 space-y-5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field label="Synthesis Backend Strategy" hint="Auto tries remote GPU first, falls back to Mac MPS.">
                      <SelectInput
                        value={formData.tts_backend || 'auto'}
                        onChange={(e) => updateField('tts_backend', e.target.value)}
                      >
                        <option value="auto">Auto — Colab GPU first, local fallback (Recommended)</option>
                        <option value="colab">Colab GPU only (errors surface if offline)</option>
                        <option value="local">Fully local (Apple Silicon MPS / CPU)</option>
                      </SelectInput>
                    </Field>

                    <Field label="Colab GPU Type" hint="T4 tested at RTF ≈1.0 for Bengali, ≈0.5 for English.">
                      <SelectInput
                        value={formData.colab_gpu || 'T4'}
                        onChange={(e) => updateField('colab_gpu', e.target.value)}
                      >
                        <option value="T4">T4 — ~1.23 compute units/hr (Recommended)</option>
                        <option value="L4">L4 — faster synthesis, higher cost</option>
                        <option value="A100">A100 — highest speed, premium compute</option>
                        <option value="H100">H100 — maximum</option>
                      </SelectInput>
                    </Field>

                    <Field label="Colab Session Name">
                      <TextInput
                        mono
                        value={formData.colab_session || 'pdfreader'}
                        onChange={(e) => updateField('colab_session', e.target.value)}
                      />
                    </Field>

                    <Field label="Idle Auto-Stop (minutes)" hint="0 keeps the GPU warm until you press Stop.">
                      <TextInput
                        type="number"
                        min="0"
                        value={formData.colab_idle_stop_min ?? '20'}
                        onChange={(e) => updateField('colab_idle_stop_min', e.target.value)}
                      />
                    </Field>

                    <Field label="Colab CLI Path Override" hint="Leave empty to auto-detect ~/.local/bin/colab.">
                      <TextInput
                        mono
                        placeholder="auto-detect (~/.local/bin/colab)"
                        value={formData.colab_bin || ''}
                        onChange={(e) => updateField('colab_bin', e.target.value)}
                      />
                    </Field>

                    <Field label="SSH Key for Tunnel Override" hint="Leave empty to auto-detect ~/.ssh/id_ed25519.">
                      <TextInput
                        mono
                        placeholder="auto-detect (~/.ssh/id_ed25519)"
                        value={formData.colab_ssh_key || ''}
                        onChange={(e) => updateField('colab_ssh_key', e.target.value)}
                      />
                    </Field>
                  </div>
                </div>

                {/* Colab Setup & One-Click PKCE Auth */}
                <ColabSetupCard />
              </section>
            )}

            {/* Audio storage: Google Drive backup + local cache cap */}
            {activeSection === 'storage' && (
              <section className="space-y-5">
                <div>
                  <h2 className="text-base font-semibold text-slate-100">Audio storage</h2>
                  <p className="text-xs text-slate-400 mt-0.5">Keep narration in Google Drive and free up local disk space.</p>
                </div>

                <div className="p-5 rounded-xl border border-obsidian-700/80 bg-obsidian-850 space-y-4">
                  <Field label="Back up new audio to Google Drive" hint="Each page is uploaded after it is synthesized. Playback fetches a page from Drive if its local copy was removed.">
                    <SelectInput
                      value={formData.drive_backup_audio || '0'}
                      onChange={(e) => updateField('drive_backup_audio', e.target.value)}
                    >
                      <option value="0">Off — keep audio on this Mac only</option>
                      <option value="1">On — back up to Google Drive</option>
                    </SelectInput>
                  </Field>

                  <Field label="After a page uploads to Drive" hint="Delete the local file once its Drive copy is confirmed (same size). Off keeps a local copy and lets you free space later per book.">
                    <SelectInput
                      value={formData.drive_free_after_upload || '0'}
                      onChange={(e) => updateField('drive_free_after_upload', e.target.value)}
                    >
                      <option value="0">Keep the local copy</option>
                      <option value="1">Delete the local copy after verified upload</option>
                    </SelectInput>
                  </Field>

                  <Field label="Local audio cache limit (MB)" hint="0 keeps every local file. Otherwise the least recently played audio that has a Drive copy is removed from this Mac once the limit is exceeded.">
                    <TextInput
                      type="number"
                      min="0"
                      step="100"
                      value={formData.drive_cache_mb || '0'}
                      onChange={(e) => updateField('drive_cache_mb', e.target.value)}
                    />
                  </Field>
                </div>

                <DriveStorageCard />
              </section>
            )}

            {/* 10. Safety Section */}
            {activeSection === 'safety' && (
              <section className="space-y-5">
                <div>
                  <h2 className="text-base font-semibold text-slate-100">Hardware & Thermal Safety</h2>
                  <p className="text-xs text-slate-400 mt-0.5">Control Apple Silicon thermal pacing and prevent memory pressure on 8 GB Macs.</p>
                </div>
                <div className="p-5 rounded-xl border border-obsidian-700/80 bg-obsidian-850 space-y-5">
                  <Field
                    label="Pacing Throttle Delay"
                    hint="A pause after each page lets fanless Apple Silicon cool down before the next OCR/TTS run."
                    action={
                      <span className="font-mono text-xs text-slate-200 bg-obsidian-900 border border-obsidian-700 rounded-md px-2 py-0.5">
                        {formData.throttle_delay_ms || 1000} ms
                      </span>
                    }
                  >
                    <div className="pt-2">
                      <input
                        type="range"
                        min="100"
                        max="3000"
                        step="100"
                        value={formData.throttle_delay_ms || 1000}
                        onChange={(e) => updateField('throttle_delay_ms', parseInt(e.target.value, 10) || 1000)}
                        className="w-full accent-indigo-500 h-1.5 bg-obsidian-750 rounded-lg cursor-pointer"
                      />
                      <div className="flex justify-between text-[11px] text-slate-500 mt-1.5 font-mono">
                        <span>100 ms (Fastest)</span>
                        <span>1000 ms (Recommended)</span>
                        <span>3000 ms (Coolest)</span>
                      </div>
                    </div>
                  </Field>

                  <div className="flex items-center justify-between gap-3 border-t border-obsidian-750 pt-4">
                    <div>
                      <p className="text-xs font-medium text-slate-200">Overlap OCR and voice synthesis</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Off (recommended on 8 GB): one heavy stage at a time. On: runs local OCR and local voice synthesis concurrently.
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={formData.pipeline_local_parallel === '1'}
                      onClick={() =>
                        updateField('pipeline_local_parallel', formData.pipeline_local_parallel === '1' ? '0' : '1')
                      }
                      className={`w-9 h-5 flex-shrink-0 flex items-center rounded-full p-0.5 transition-colors cursor-pointer ${
                        formData.pipeline_local_parallel === '1' ? 'bg-indigo-600' : 'bg-obsidian-700'
                      }`}
                    >
                      <span
                        className={`bg-white w-4 h-4 rounded-full shadow-xs transform transition-transform ${
                          formData.pipeline_local_parallel === '1' ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>
                </div>
              </section>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
