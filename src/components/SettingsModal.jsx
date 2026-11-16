import React, { useEffect, useMemo, useState } from 'react';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { Field, TextInput, TextArea, SelectInput } from './ui/Field';
import { Panel } from './ui/Panel';
import { Tag } from './ui/Badge';
import { TtsBackendControls, describeBackend } from './inspector/TtsBackendPanel';
import { ColabSetupCard } from './ColabSetupCard';
import { ModelManagerView } from './ModelHub';
import { VOICE_OPTIONS, normalizeVoiceValue } from '../lib/voiceChoices';
import { notifyVoicesChanged } from '../lib/useVoiceLibrary';
import {
  useReaderSettings,
  THEMES,
  FONT_OPTIONS,
  LINE_HEIGHTS,
  HIGHLIGHT_STYLES,
  CONTENT_WIDTHS
} from './ReaderCustomizer';
import { readVolume, writeVolume, VOLUME_EVENT } from '../lib/playbackPrefs';
import {
  Settings2,
  Zap,
  ScanText,
  Sparkles,
  AudioLines,
  Server,
  Shield,
  Save,
  RotateCcw,
  Activity,
  CheckCircle2,
  Mic,
  ArrowRight,
  BookOpen,
  Volume2,
  Layers,
  Boxes,
  HardDrive
} from 'lucide-react';
import { DEFAULT_REFINER_PROMPT } from '../lib/refinerPrompt';
import { changedSettings } from '../lib/settingsDiff';
import { navigate, USAGE_PATH, VOICES_PATH, MODELS_PATH } from '../lib/router';

/** Field keys owned by each section — drives the per-section "unsaved" dot. */
const SECTIONS = [
  {
    id: 'gateway',
    label: 'AI Gateway',
    icon: Zap,
    title: 'Local AI Gateway',
    description: 'Where OCR and narration calls are sent, and how their cost is counted.',
    keys: ['llm_vision_url', 'llm_vision_model', 'llm_vision_key', 'refiner_url', 'refiner_model', 'refiner_key', 'usage_free_local']
  },
  {
    id: 'ocr',
    label: 'OCR & Vision',
    icon: ScanText,
    title: 'OCR Extraction Strategy',
    description: 'Local engines run first; the vision model is the fallback for scanned or low-confidence pages.',
    keys: ['ocr_tier', 'llm_vision_url', 'llm_vision_model', 'llm_vision_key']
  },
  {
    id: 'refiner',
    label: 'Narration Refiner',
    icon: Sparkles,
    title: 'LLM Narration Refiner',
    description: 'Strips headers, footers, page numbers and footnotes, then rewrites the page as spoken prose.',
    keys: ['refiner_url', 'refiner_model', 'refiner_key', 'refiner_system_prompt', 'refiner_extra_instructions']
  },
  {
    id: 'voices',
    label: 'Narrator Voices',
    icon: Mic,
    title: 'Narrator Voices & Studio',
    description: 'Assign default voice clones per language and access the Voice Cloning Studio.',
    keys: ['tts_voice_bn', 'tts_voice_en', 'tts_voice_ar']
  },
  {
    id: 'delivery',
    label: 'Speech & Delivery',
    icon: AudioLines,
    title: 'Speech & Delivery Controls',
    description: 'Pacing, diffusion steps, voice tags and narration style notes.',
    keys: ['tts_speed', 'tts_num_step', 'tts_instruct', 'tts_style_notes']
  },
  {
    id: 'reading',
    label: 'Reading & Playback',
    icon: BookOpen,
    title: 'Reading & Playback Defaults',
    description: 'Reader typography, canvas theme and audio player level — shared by every project.',
    keys: [] // localStorage-backed; applied the moment you change them
  },
  {
    id: 'backend',
    label: 'TTS Backend & GPU',
    icon: Server,
    title: 'TTS Backend & Remote GPU',
    description: 'Synthesize locally on this Mac, or connect Google Colab in one click for remote GPU acceleration.',
    keys: ['tts_backend', 'colab_gpu', 'colab_session', 'colab_idle_stop_min', 'colab_bin', 'colab_ssh_key']
  },
  {
    id: 'models',
    label: 'Local AI Models',
    icon: Boxes,
    title: 'Local AI Models & Storage',
    description: 'Manage, download, activate, or reference local model weights for Voice Cloning, TTS, ASR, and OCR.',
    keys: ['models_cache_dir', 'python_bin', 'hf_token', 'tts_active_model', 'asr_active_model']
  },
  {
    id: 'safety',
    label: 'Performance & Safety',
    icon: Shield,
    title: 'Hardware & Thermal Safety',
    description: 'Pacing between pages keeps an 8 GB fanless MacBook from throttling mid-book.',
    keys: ['throttle_delay_ms', 'pipeline_stage_target', 'pipeline_local_parallel']
  }
];

const ANTIGRAVITY_DEFAULTS = {
  llm_vision_url: 'http://127.0.0.1:8085/v1',
  llm_vision_model: 'gemini-2.5-flash',
  llm_vision_key: 'antigravity-zero-key',
  refiner_url: 'http://127.0.0.1:8085/v1',
  refiner_model: 'gemini-2.5-flash',
  refiner_key: 'antigravity-zero-key'
};

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

const SELECT_CLASS =
  'w-full bg-obsidian-950 border border-obsidian-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-brand-400';

export function SettingsModal({
  isOpen,
  onClose,
  initialSettings,
  onSave,
  remoteStatus,
  onRemoteStart,
  onRemoteStop
}) {
  const [formData, setFormData] = useState({});
  const [baseline, setBaseline] = useState({});
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [activeSection, setActiveSection] = useState(SECTIONS[0].id);
  const [defaultRefinerPrompt, setDefaultRefinerPrompt] = useState(DEFAULT_REFINER_PROMPT);
  const [clonedVoices, setClonedVoices] = useState([]);
  // Reader/playback prefs live in localStorage, not the settings table: they
  // apply instantly and are shared with the reader through their own events.
  const {
    settings: readerSettings,
    updateSetting: updateReaderSetting,
    resetSettings: resetReaderSettings
  } = useReaderSettings();
  const [volume, setVolume] = useState(readVolume);

  useEffect(() => {
    const sync = (event) => setVolume(typeof event.detail === 'number' ? event.detail : readVolume());
    window.addEventListener(VOLUME_EVENT, sync);
    return () => window.removeEventListener(VOLUME_EVENT, sync);
  }, []);

  const changeVolume = (value) => setVolume(writeVolume(value));
  const backendStatus = describeBackend(remoteStatus);

  // Re-sync on every open so a cancelled edit never leaks into the next visit.
  useEffect(() => {
    if (!isOpen) return;
    const next = initialSettings || {};
    setFormData(next);
    setBaseline(next);
    setSaveSuccess(false);
  }, [initialSettings, isOpen]);

  // Cloned voices feed the per-language voice selects, so refresh on every open.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    fetch('/api/voices')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled) setClonedVoices(data?.voices || []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isOpen]);
  // Load canonical default prompt from the server (single source of truth)
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    fetch('/api/settings/defaults')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data?.defaults?.refiner_system_prompt) {
          setDefaultRefinerPrompt(data.defaults.refiner_system_prompt);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const handleChange = (key, val) => {
    setFormData((prev) => ({ ...prev, [key]: val }));
    setSaveSuccess(false);
  };

  const applyAntigravityDefaults = () => {
    setFormData((prev) => ({ ...prev, ...ANTIGRAVITY_DEFAULTS }));
    setSaveSuccess(false);
  };

  const isDirty = (key) => String(formData[key] ?? '') !== String(baseline[key] ?? '');
  const dirtyKeys = useMemo(
    () => Object.keys({ ...formData, ...baseline }).filter(isDirty),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [formData, baseline]
  );
  const sectionDirty = (section) => section.keys.some(isDirty);

  const handleFormSubmit = async (e) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await onSave(changedSettings(formData, baseline));
      setBaseline(formData);
      setSaveSuccess(true);
      notifyVoicesChanged();
      setTimeout(() => setSaveSuccess(false), 2500);
    } finally {
      setIsSaving(false);
    }
  };

  const current = SECTIONS.find((s) => s.id === activeSection) || SECTIONS[0];

  const voiceOptions = (lang) => (
    <>
      <optgroup label="Cloned voices (library)">
        <option value="builtin">Built-in reference voice</option>
        {clonedVoices.map((voice) => (
          <option key={voice.id} value={voice.id}>
            {voice.name}
            {voice.language && voice.language !== 'auto' ? ` · ${voice.language.toUpperCase()}` : ''}
          </option>
        ))}
      </optgroup>
      <optgroup label="Neural / native engines">
        {VOICE_OPTIONS[lang]
          .filter(([value]) => value !== 'Custom Voice (OmniVoice Clone)')
          .map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
      </optgroup>
    </>
  );

  const renderVoiceSelect = (lang, label) => (
    <Field label={label}>
      <select
        value={normalizeVoiceValue(formData[`tts_voice_${lang}`])}
        onChange={(e) => handleChange(`tts_voice_${lang}`, e.target.value)}
        className={SELECT_CLASS}
      >
        {voiceOptions(lang)}
      </select>
    </Field>
  );

  const renderSection = () => {
    switch (current.id) {
      case 'gateway':
        return (
          <>
            <Panel
              icon={Zap}
              title="Antigravity local proxy (:8085)"
              description="Bridges your existing Pi OAuth session — $0 billing, no API key required."
              action={
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  icon={Zap}
                  onClick={applyAntigravityDefaults}
                  className="border-brand-500/40 text-brand-300 hover:bg-brand-500/15"
                >
                  Auto-configure
                </Button>
              }
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Vision endpoint" hint="OpenAI-compatible base URL.">
                  <TextInput
                    mono
                    placeholder="http://127.0.0.1:8085/v1"
                    value={formData.llm_vision_url || ''}
                    onChange={(e) => handleChange('llm_vision_url', e.target.value)}
                  />
                </Field>
                <Field label="Vision model">
                  <TextInput
                    mono
                    placeholder="gemini-2.5-flash"
                    value={formData.llm_vision_model || ''}
                    onChange={(e) => handleChange('llm_vision_model', e.target.value)}
                  />
                </Field>
                <Field label="Vision API key" hint="Leave as-is for the local proxy.">
                  <TextInput
                    type="password"
                    mono
                    placeholder="antigravity"
                    value={formData.llm_vision_key || ''}
                    onChange={(e) => handleChange('llm_vision_key', e.target.value)}
                  />
                </Field>
                <Field label="Refiner model">
                  <TextInput
                    mono
                    placeholder="gemini-2.5-flash"
                    value={formData.refiner_model || ''}
                    onChange={(e) => handleChange('refiner_model', e.target.value)}
                  />
                </Field>
              </div>
            </Panel>

            <Panel
              icon={Activity}
              title="Cost accounting"
              description="Every OCR and narration call is logged with tokens, latency and spend."
            >
              <Field
                label="Local proxy usage"
                hint="Free logs tokens only; the list price is still shown separately in the usage dashboard."
              >
                <SelectInput
                  value={formData.usage_free_local ?? '1'}
                  onChange={(e) => handleChange('usage_free_local', e.target.value)}
                >
                  <option value="1">Free — log tokens only (list price shown separately)</option>
                  <option value="0">Billable — count at full API rates</option>
                </SelectInput>
              </Field>
            </Panel>
          </>
        );

      case 'ocr':
        return (
          <Panel
            icon={ScanText}
            title="Extraction order"
            description="Tesseract covers Bengali; Apple Vision is fastest for Latin and Arabic. The vision model only runs when local engines fail."
          >
            <Field
              label="Primary OCR engine"
              hint="Scanned Bengali pages need Tesseract or the vision model — Apple Vision has no Bengali support."
            >
              <SelectInput
                value={formData.ocr_tier || 'mac_first'}
                onChange={(e) => handleChange('ocr_tier', e.target.value)}
              >
                <option value="mac_first">
                  Multi-engine: Tesseract (Bangla/Arabic) + Apple Vision + LLM fallback
                </option>
                <option value="mac_only">Offline only: Tesseract &amp; macOS Vision</option>
                <option value="llm_only">LLM Vision direct (cloud / Antigravity proxy)</option>
              </SelectInput>
            </Field>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Vision endpoint URL">
                <TextInput
                  mono
                  placeholder="http://127.0.0.1:8085/v1"
                  value={formData.llm_vision_url || ''}
                  onChange={(e) => handleChange('llm_vision_url', e.target.value)}
                />
              </Field>
              <Field label="Vision model name">
                <TextInput
                  mono
                  placeholder="gemini-2.5-flash"
                  value={formData.llm_vision_model || ''}
                  onChange={(e) => handleChange('llm_vision_model', e.target.value)}
                />
              </Field>
            </div>

            <Field label="Vision API key" hint="Any placeholder value works with the local proxy.">
              <TextInput
                type="password"
                mono
                placeholder="antigravity"
                value={formData.llm_vision_key || ''}
                onChange={(e) => handleChange('llm_vision_key', e.target.value)}
              />
            </Field>
          </Panel>
        );

      case 'refiner':
        return (
          <>
            <Panel
              icon={Sparkles}
              title="Refiner model"
              description="Any OpenAI-compatible chat endpoint (local proxy, OpenAI, Gemini, SGLang)."
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Endpoint URL">
                  <TextInput
                    mono
                    placeholder="http://127.0.0.1:8085/v1"
                    value={formData.refiner_url || ''}
                    onChange={(e) => handleChange('refiner_url', e.target.value)}
                  />
                </Field>
                <Field label="Model name">
                  <TextInput
                    mono
                    placeholder="gemini-2.5-flash"
                    value={formData.refiner_model || ''}
                    onChange={(e) => handleChange('refiner_model', e.target.value)}
                  />
                </Field>
              </div>
              <Field label="API key">
                <TextInput
                  type="password"
                  mono
                  placeholder="antigravity"
                  value={formData.refiner_key || ''}
                  onChange={(e) => handleChange('refiner_key', e.target.value)}
                />
              </Field>
            </Panel>

            <Panel
              icon={Sparkles}
              accent="violet"
              title="System prompt"
              description="Sent as the system message on every refinement call."
              action={
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  icon={RotateCcw}
                  onClick={() => handleChange('refiner_system_prompt', defaultRefinerPrompt)}
                  title="Restore the built-in narration cleaning prompt"
                >
                  Reset
                </Button>
              }
            >
              <TextArea
                mono
                rows={14}
                spellCheck={false}
                value={formData.refiner_system_prompt ?? defaultRefinerPrompt}
                onChange={(e) => handleChange('refiner_system_prompt', e.target.value)}
                className="max-h-[340px]"
              />
              <p className="text-[11.5px] text-slate-500 leading-relaxed">
                Applies to the next page the pipeline processes — even mid-run or after a pause.
                Already cached pages keep their stored narration. Use{' '}
                <span className="text-slate-300">Regenerate</span> in the reader to re-run a page or
                the whole book.
              </p>
            </Panel>

            <Panel
              icon={Sparkles}
              accent="violet"
              title="Additional narration instructions"
              description="Appended to the system prompt as ADDITIONAL USER INSTRUCTIONS — highest priority."
            >
              <TextArea
                rows={4}
                placeholder={
                  'e.g. "Narrate Quranic verses in Arabic then their Bengali translation."\n"Keep hadith references intact and pronounce them fully."\n"Use a calm, devotional tone; expand abbreviations."'
                }
                value={formData.refiner_extra_instructions || ''}
                onChange={(e) => handleChange('refiner_extra_instructions', e.target.value)}
              />
            </Panel>
          </>
        );

      case 'voices':
        return (
          <>
            <Panel
              icon={Mic}
              accent="violet"
              title="Voice Cloning Studio"
              description="Upload 10–30s audio samples to clone custom voices for Bengali, English, and Arabic. Zero-shot cloning runs locally or on remote GPU."
              action={
                <Button
                  variant="primary"
                  size="sm"
                  icon={Mic}
                  iconRight={ArrowRight}
                  onClick={() => {
                    onClose();
                    navigate(VOICES_PATH);
                  }}
                >
                  Open Studio
                </Button>
              }
            >
              <div className="rounded-xl border border-violet-500/30 bg-violet-500/10 p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="space-y-1">
                  <h4 className="text-xs font-semibold text-violet-200">
                    Voice Cloning & Reference Library
                  </h4>
                  <p className="text-[11.5px] text-slate-300 leading-relaxed">
                    Zero-shot voice cloning records or imports clean speech samples. Samples are auto-transcribed using Whisper and cached for narration.
                  </p>
                </div>
                <Button
                  variant="primary"
                  size="sm"
                  icon={Mic}
                  onClick={() => {
                    onClose();
                    navigate(VOICES_PATH);
                  }}
                  className="flex-shrink-0"
                >
                  Manage Voices
                </Button>
              </div>
            </Panel>

            <Panel
              icon={AudioLines}
              accent="brand"
              title="Default Language Voices"
              description="Assign the voice model or custom clone used for each language."
            >
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {renderVoiceSelect('bn', 'Bengali (বাংলা)')}
                {renderVoiceSelect('en', 'English')}
                {renderVoiceSelect('ar', 'Arabic (العربية)')}
              </div>
            </Panel>
          </>
        );

      case 'delivery':
        return (
          <Panel
            icon={AudioLines}
            accent="amber"
            title="Delivery controls"
            description="OmniVoice honours these numeric knobs and fixed tags only."
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Speed factor" hint="1.0 normal · 0.85 slower, solemn · 1.15 brisk">
                <TextInput
                  type="number"
                  min="0.5"
                  max="2.0"
                  step="0.05"
                  value={formData.tts_speed ?? '1.0'}
                  onChange={(e) => handleChange('tts_speed', e.target.value)}
                />
              </Field>
              <Field label="Diffusion steps" hint="Higher = better quality, slower synthesis.">
                <SelectInput
                  value={formData.tts_num_step || '16'}
                  onChange={(e) => handleChange('tts_num_step', e.target.value)}
                >
                  <option value="16">16 — fastest</option>
                  <option value="24">24 — balanced</option>
                  <option value="32">32 — best quality</option>
                </SelectInput>
              </Field>
            </div>

            <Field
              label="Voice instruct tags"
              hint="Comma-separated, fixed vocabulary only — the model rejects anything else."
            >
              <TextInput
                mono
                list="omnivoice-instruct-tags"
                placeholder="female, low pitch, british accent"
                value={formData.tts_instruct || ''}
                onChange={(e) => handleChange('tts_instruct', e.target.value)}
              />
              <datalist id="omnivoice-instruct-tags">
                {INSTRUCT_TAGS.map((tag) => (
                  <option key={tag} value={tag} />
                ))}
              </datalist>
            </Field>

            <Field
              label="Delivery direction (shapes the script, not the voice model)"
              hint="Free text consumed by the refiner: sentence length, pauses, emphasis. Inline tags such as [laughter] or [sigh] may be written directly into the script."
            >
              <TextArea
                rows={3}
                placeholder="e.g. Reverent audiobook narration: short sentences, unhurried pacing, emphasise Quranic verses with a slight pause before and after."
                value={formData.tts_style_notes || ''}
                onChange={(e) => handleChange('tts_style_notes', e.target.value)}
              />
            </Field>
          </Panel>
        );

      case 'reading':
        return (
          <>
            <Panel
              icon={BookOpen}
              accent="violet"
              title="Reading canvas"
              description="Typography and theme of the synced reader. Saved and applied instantly, including to a project that is already open."
              action={
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  icon={RotateCcw}
                  onClick={resetReaderSettings}
                >
                  Reset
                </Button>
              }
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Theme">
                  <SelectInput
                    value={readerSettings.theme}
                    onChange={(e) => updateReaderSetting('theme', e.target.value)}
                  >
                    {THEMES.map((theme) => (
                      <option key={theme.id} value={theme.id}>
                        {theme.label}
                      </option>
                    ))}
                  </SelectInput>
                </Field>
                <Field label="Font family">
                  <SelectInput
                    value={readerSettings.fontFamily}
                    onChange={(e) => updateReaderSetting('fontFamily', e.target.value)}
                  >
                    {FONT_OPTIONS.map((font) => (
                      <option key={font.id} value={font.id}>
                        {font.label}
                      </option>
                    ))}
                  </SelectInput>
                </Field>
                <Field label="Line height">
                  <SelectInput
                    value={readerSettings.lineHeight}
                    onChange={(e) => updateReaderSetting('lineHeight', e.target.value)}
                  >
                    {LINE_HEIGHTS.map((lh) => (
                      <option key={lh.id} value={lh.id}>
                        {lh.label}
                      </option>
                    ))}
                  </SelectInput>
                </Field>
                <Field label="Reading width">
                  <SelectInput
                    value={readerSettings.contentWidth}
                    onChange={(e) => updateReaderSetting('contentWidth', e.target.value)}
                  >
                    {CONTENT_WIDTHS.map((cw) => (
                      <option key={cw.id} value={cw.id}>
                        {cw.label}
                      </option>
                    ))}
                  </SelectInput>
                </Field>
                <Field label="Audio highlight">
                  <SelectInput
                    value={readerSettings.highlightStyle}
                    onChange={(e) => updateReaderSetting('highlightStyle', e.target.value)}
                  >
                    {HIGHLIGHT_STYLES.map((style) => (
                      <option key={style.id} value={style.id}>
                        {style.label}
                      </option>
                    ))}
                  </SelectInput>
                </Field>
                <Field
                  label="Font size"
                  action={
                    <span className="font-mono text-[11px] text-slate-300 tabular-nums">
                      {readerSettings.fontSize}px
                    </span>
                  }
                >
                  <input
                    type="range"
                    min="13"
                    max="32"
                    step="1"
                    value={readerSettings.fontSize}
                    onChange={(e) => updateReaderSetting('fontSize', Number(e.target.value))}
                    className="w-full accent-brand-500 cursor-pointer"
                    aria-label="Reading font size"
                  />
                </Field>
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-obsidian-800 pt-3">
                <div>
                  <p className="text-[12.5px] font-medium text-slate-300">Auto-scroll to narration</p>
                  <p className="text-[11.5px] text-slate-500 mt-0.5">
                    Keeps the highlighted paragraph in view while audio plays.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={readerSettings.autoScroll}
                  aria-label="Auto-scroll to narration"
                  onClick={() => updateReaderSetting('autoScroll', !readerSettings.autoScroll)}
                  className={`w-9 h-5 flex-shrink-0 flex items-center rounded-full p-0.5 transition-colors ${
                    readerSettings.autoScroll ? 'bg-brand-500' : 'bg-obsidian-700'
                  }`}
                >
                  <span
                    className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${
                      readerSettings.autoScroll ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            </Panel>
            <Panel
              icon={Volume2}
              accent="emerald"
              title="Audio playback"
              description="Default level of the narration player. Applied instantly to a player that is already running."
            >
              <Field
                label="Volume"
                action={
                  <span className="font-mono text-[11px] text-slate-300 tabular-nums">
                    {Math.round(volume * 100)}%
                  </span>
                }
              >
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={volume}
                  onChange={(e) => changeVolume(Number(e.target.value))}
                  className="w-full accent-brand-500 cursor-pointer"
                  aria-label="Playback volume"
                />
              </Field>
            </Panel>
          </>
        );
      case 'backend':
        return (
          <>
            <ColabSetupCard />
            <Panel
              icon={Server}
              accent="sky"
              title="Synthesis backend & GPU worker"
              description="The Colab worker is provisioned once per session, then kept warm while pages are synthesized."
              action={
                <Tag tone={backendStatus.tone} size="xs" dot={backendStatus.isRunning || backendStatus.isStarting}>
                  {backendStatus.pillLabel}
                </Tag>
              }
            >
              <div className="rounded-xl border border-obsidian-700/70 bg-obsidian-950/50 p-3">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="text-[12px] font-medium text-slate-300">GPU worker</span>
                  <span className="text-[11px] text-slate-500">
                    {backendStatus.isRunning ? 'Warm — synthesis runs remotely' : 'Idle — local synthesis'}
                  </span>
                </div>
                <TtsBackendControls
                  remoteStatus={remoteStatus}
                  onRemoteStart={onRemoteStart}
                  onRemoteStop={onRemoteStop}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Backend">
                  <SelectInput
                    value={formData.tts_backend || 'auto'}
                    onChange={(e) => handleChange('tts_backend', e.target.value)}
                  >
                    <option value="auto">Auto — Colab GPU first, local fallback</option>
                    <option value="colab">Colab GPU only (errors surface)</option>
                    <option value="local">Fully local (this Mac / MPS)</option>
                  </SelectInput>
                </Field>
                <Field label="Colab GPU" hint="T4 tested at RTF ≈1.0 for Bengali, ≈0.5 for English.">
                  <SelectInput
                    value={formData.colab_gpu || 'T4'}
                    onChange={(e) => handleChange('colab_gpu', e.target.value)}
                  >
                    <option value="T4">T4 — ~1.23 CU/hr</option>
                    <option value="L4">L4 — faster, higher CU/hr</option>
                    <option value="A100">A100 — fastest, highest CU/hr</option>
                    <option value="H100">H100 — maximum</option>
                  </SelectInput>
                </Field>
                <Field label="Session name">
                  <TextInput
                    mono
                    value={formData.colab_session || 'pdfreader'}
                    onChange={(e) => handleChange('colab_session', e.target.value)}
                  />
                </Field>
                <Field label="Idle auto-stop (minutes)" hint="0 keeps the GPU warm until you press Stop.">
                  <TextInput
                    type="number"
                    min="0"
                    value={formData.colab_idle_stop_min ?? '20'}
                    onChange={(e) => handleChange('colab_idle_stop_min', e.target.value)}
                  />
                </Field>
                <Field label="colab CLI path (override)" hint="Leave empty to auto-detect ~/.local/bin/colab.">
                  <TextInput
                    mono
                    placeholder="auto-detect"
                    value={formData.colab_bin || ''}
                    onChange={(e) => handleChange('colab_bin', e.target.value)}
                  />
                </Field>
                <Field label="SSH key for the tunnel (override)" hint="Leave empty to auto-detect ~/.ssh/id_ed25519.">
                  <TextInput
                    mono
                    placeholder="auto-detect"
                    value={formData.colab_ssh_key || ''}
                    onChange={(e) => handleChange('colab_ssh_key', e.target.value)}
                  />
                </Field>
              </div>
            </Panel>
          </>
        );

      case 'models':
        return (
          <>
            <Panel
              icon={HardDrive}
              accent="brand"
              title="Shared Cache Directory & Python Runtime"
              description="Point to a shared Hugging Face cache folder or Python environment (e.g. from another project) so models work plug-and-play without duplicate downloads."
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field
                  label="Hugging Face Cache Directory"
                  hint="Leave empty for ~/.cache/huggingface/hub"
                >
                  <TextInput
                    mono
                    placeholder="~/.cache/huggingface/hub"
                    value={formData.models_cache_dir || ''}
                    onChange={(e) => handleChange('models_cache_dir', e.target.value)}
                  />
                </Field>
                <Field
                  label="Python Runtime Executable"
                  hint="Leave empty to auto-detect .venv or system python3"
                >
                  <TextInput
                    mono
                    placeholder="auto-detect (.venv / python3)"
                    value={formData.python_bin || ''}
                    onChange={(e) => handleChange('python_bin', e.target.value)}
                  />
                </Field>
                <div className="sm:col-span-2">
                  <Field
                    label="Hugging Face Access Token (optional)"
                    hint="Used only when downloading gated repositories or increasing download rate limits."
                  >
                    <TextInput
                      type="password"
                      mono
                      placeholder="hf_..."
                      value={formData.hf_token || ''}
                      onChange={(e) => handleChange('hf_token', e.target.value)}
                    />
                  </Field>
                </div>
              </div>
            </Panel>

            <ModelManagerView
              compact
              onOpenFullHub={() => {
                onClose?.();
                navigate(MODELS_PATH);
              }}
              onSettingsChanged={(next) => {
                if (next) {
                  setFormData((prev) => ({ ...prev, ...next }));
                  setBaseline((prev) => ({ ...prev, ...next }));
                }
              }}
            />
          </>
        );

      case 'safety':
        return (
          <>
            <Panel
              icon={Layers}
              title="Pipeline Execution Stage"
              description="Choose which pipeline stages run when pressing Start or stepping pages. You can also quickly toggle this in the Pipeline Inspector."
            >
              <Field
                label="Target execution stage"
                hint="Extracting text first lets you inspect and edit OCR or scripts before voice synthesis."
              >
                <SelectInput
                  value={formData.pipeline_stage_target || 'all'}
                  onChange={(e) => handleChange('pipeline_stage_target', e.target.value)}
                >
                  <option value="all">Full Pipeline: OCR → LLM Narration → Audio</option>
                  <option value="ocr">OCR Only: Extract text &amp; run OCR (skip LLM &amp; Audio)</option>
                  <option value="refine">Refine Only: Polish narration scripts with LLM (skip Audio)</option>
                  <option value="audio">Audio Only: Synthesize voice tracks from existing scripts</option>
                </SelectInput>
              </Field>
            </Panel>

            <Panel
              icon={Shield}
              accent="emerald"
              title="Throttle between pages"
              description="A short pause after each page lets the fanless M2 cool down before the next OCR/TTS run."
            >
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[12.5px] font-medium text-slate-300">Delay</span>
                  <span className="font-mono text-xs text-slate-100 bg-obsidian-950 border border-obsidian-700 rounded-md px-2 py-0.5">
                    {formData.throttle_delay_ms || 500} ms
                  </span>
                </div>
                <input
                  type="range"
                  min="100"
                  max="3000"
                  step="100"
                  value={formData.throttle_delay_ms || 500}
                  onChange={(e) => handleChange('throttle_delay_ms', e.target.value)}
                  className="w-full accent-brand-500 cursor-pointer"
                />
                <div className="flex justify-between text-[10.5px] text-slate-600 mt-1 font-mono">
                  <span>100 ms</span>
                  <span>3000 ms</span>
                </div>
              </div>
            </Panel>

            <Panel
              icon={Layers}
              accent="emerald"
              title="Parallel local stages"
              description="OCR, Script and Audio always advance as independent lanes. This decides whether the two local heavy stages may also run at the same instant."
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[12.5px] font-medium text-slate-300">Overlap OCR and voice synthesis</p>
                  <p className="text-[11.5px] text-slate-500 mt-0.5">
                    Off (recommended on 8 GB): one heavy stage at a time, OCR first. On: both may run together —
                    faster, but it can push a fanless M2 into memory pressure.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={formData.pipeline_local_parallel === '1'}
                  aria-label="Overlap OCR and voice synthesis"
                  onClick={() =>
                    handleChange('pipeline_local_parallel', formData.pipeline_local_parallel === '1' ? '0' : '1')
                  }
                  className={`w-9 h-5 flex-shrink-0 flex items-center rounded-full p-0.5 transition-colors ${
                    formData.pipeline_local_parallel === '1' ? 'bg-brand-500' : 'bg-obsidian-700'
                  }`}
                >
                  <span
                    className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${
                      formData.pipeline_local_parallel === '1' ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            </Panel>
          </>
        );

      default:
        return null;
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Engine & AI Configuration"
      subtitle="OCR, narration, voice and hardware settings apply to every project"
      icon={Settings2}
      maxWidth="max-w-4xl"
      bodyClassName="p-0"
      footer={
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-[11.5px] min-w-0">
            {saveSuccess ? (
              <span className="inline-flex items-center gap-1.5 text-emerald-400 font-medium animate-fade-in">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Settings saved
              </span>
            ) : dirtyKeys.length > 0 ? (
              <span className="inline-flex items-center gap-1.5 text-amber-300/90">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                {dirtyKeys.length} unsaved {dirtyKeys.length === 1 ? 'change' : 'changes'}
              </span>
            ) : (
              <span className="text-slate-500">All changes are saved</span>
            )}
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <Button variant="ghost" size="sm" type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              type="submit"
              form="settings-form"
              isLoading={isSaving}
              icon={Save}
            >
              Save Settings
            </Button>
          </div>
        </div>
      }
    >
      <form id="settings-form" onSubmit={handleFormSubmit} className="flex h-[min(72vh,660px)]">
        {/* Section nav */}
        <nav className="w-16 sm:w-56 flex-shrink-0 border-r border-obsidian-800 bg-obsidian-900/40 overflow-y-auto scroll-slim p-2 sm:p-3 space-y-1">
          {SECTIONS.map((section) => {
            const Icon = section.icon;
            const active = section.id === activeSection;
            const dirty = sectionDirty(section);
            return (
              <button
                key={section.id}
                type="button"
                onClick={() => setActiveSection(section.id)}
                aria-current={active ? 'page' : undefined}
                className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors ${
                  active
                    ? 'bg-brand-500/12 text-brand-200 border border-brand-500/30'
                    : 'text-slate-400 border border-transparent hover:bg-obsidian-800/70 hover:text-slate-200'
                }`}
              >
                <Icon className={`w-4 h-4 flex-shrink-0 ${active ? 'text-brand-300' : 'text-slate-500'}`} />
                <span className="hidden sm:block text-[12.5px] font-medium flex-1 truncate">
                  {section.label}
                </span>
                {dirty && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />}
              </button>
            );
          })}
          <div className="hidden sm:block pt-3 mt-3 border-t border-obsidian-800 space-y-1">
            <button
              type="button"
              onClick={() => {
                onClose?.();
                navigate(MODELS_PATH);
              }}
              className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[12.5px] font-medium text-slate-400 hover:text-slate-200 hover:bg-obsidian-800/70 transition-colors"
            >
              <Boxes className="w-4 h-4 text-slate-500" />
              Model Hub
            </button>
            <button
              type="button"
              onClick={() => {
                onClose?.();
                navigate(USAGE_PATH);
              }}
              className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[12.5px] font-medium text-slate-400 hover:text-slate-200 hover:bg-obsidian-800/70 transition-colors"
            >
              <Activity className="w-4 h-4 text-slate-500" />
              API usage
            </button>
          </div>
        </nav>

        {/* Section body */}
        <div className="flex-1 min-w-0 overflow-y-auto scroll-slim p-4 sm:p-5 space-y-4">
          <div>
            <h2 className="text-[15px] font-semibold text-slate-100">{current.title}</h2>
            <p className="text-[12px] text-slate-500 mt-0.5">{current.description}</p>
          </div>
          {renderSection()}
        </div>
      </form>
    </Modal>
  );
}
