import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  AudioLines,
  Boxes,
  Check,
  CheckCircle2,
  Clock,
  Cpu,
  FileAudio,
  Info,
  Loader2,
  Mic,
  Pause,
  Pencil,
  Play,
  RefreshCw,
  Sparkles,
  Trash2,
  Upload,
  Volume2,
  X,
  Zap
} from 'lucide-react';
import { Button } from './ui/Button';
import { Panel } from './ui/Panel';
import { Field } from './ui/Field';
import { Tag } from './ui/Badge';
import { ConfirmModal } from './ui/ConfirmModal';
import { ThemeToggle } from './ui/ThemeToggle';
import { notifyVoicesChanged } from '../lib/useVoiceLibrary';

const LANGUAGE_LABEL = {
  bn: 'বাংলা',
  en: 'English',
  ar: 'العربية',
  auto: 'Auto / mixed'
};

const LANGUAGE_FULL_LABEL = {
  bn: 'বাংলা (Bengali)',
  en: 'English',
  ar: 'العربية (Arabic)',
  auto: 'Auto / mixed'
};

const LANGUAGE_ORDER = ['bn', 'en', 'ar'];

/**
 * Voice cloning studio:
 * - Upload short sample (5–20s clean speech)
 * - Auto-transcribe with Whisper Turbo
 * - Zero-shot voice cloning with OmniVoice
 * - Manage and assign defaults per narration language
 */
export function VoiceStudio({ onBack, onOpenSettings, onOpenModels, embedded = false }) {
  const [state, setState] = useState({
    voices: [],
    builtin: {
      id: 'builtin',
      name: 'Built-in reference voice',
      description: 'Bundled Sirah reference narration sample — always available.',
      language: 'bn',
      duration: 15.0,
      audioUrl: '/api/voices/builtin/audio'
    },
    defaults: { bn: 'builtin', en: 'builtin', ar: 'builtin' },
    remote: 'stopped'
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [notice, setNotice] = useState(null);

  // Upload state
  const [file, setFile] = useState(null);
  const [name, setName] = useState('');
  const [language, setLanguage] = useState('bn');
  const [refText, setRefText] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [localAudioUrl, setLocalAudioUrl] = useState(null);
  const fileInputRef = useRef(null);

  // Inline voice edit state
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [editRefText, setEditRefText] = useState('');
  const [editLanguage, setEditLanguage] = useState('bn');
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  // Playback
  const [playing, setPlaying] = useState(null);
  const audioRef = useRef(null);

  // Confirm delete modal
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/voices');
      const data = await response.json();
      setState({
        voices: data.voices || [],
        builtin: data.builtin || {
          id: 'builtin',
          name: 'Built-in reference voice',
          description: 'Bundled Sirah reference narration sample — always available.',
          language: 'bn',
          duration: 15.0,
          audioUrl: '/api/voices/builtin/audio'
        },
        defaults: data.defaults || { bn: 'builtin', en: 'builtin', ar: 'builtin' },
        remote: data.remote || 'stopped'
      });
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if (localAudioUrl) {
        URL.revokeObjectURL(localAudioUrl);
      }
    };
  }, [localAudioUrl]);

  const playUrl = (url, key) => {
    if (!url) {
      setNotice({ tone: 'rose', text: 'Audio URL not available for this sample' });
      return;
    }
    if (playing === key) {
      audioRef.current?.pause();
      setPlaying(null);
      return;
    }
    if (audioRef.current) {
      audioRef.current.pause();
    }
    const audio = new Audio(url);
    audioRef.current = audio;
    setPlaying(key);
    audio.onended = () => setPlaying(null);
    audio.onerror = () => {
      setPlaying(null);
      setNotice({ tone: 'rose', text: 'Audio playback failed' });
    };
    audio.play().catch(() => setPlaying(null));
  };

  const handleFilePicked = (picked) => {
    if (!picked) return;
    if (localAudioUrl) {
      URL.revokeObjectURL(localAudioUrl);
    }
    const blobUrl = URL.createObjectURL(picked);
    setLocalAudioUrl(blobUrl);
    setFile(picked);

    if (!name.trim()) {
      const stem = picked.name.replace(/\.[^/.]+$/, '').replace(/[-_]+/g, ' ');
      setName(stem.charAt(0).toUpperCase() + stem.slice(1));
    }
    setUploadError(null);
  };

  const clearPickedFile = () => {
    if (localAudioUrl) {
      URL.revokeObjectURL(localAudioUrl);
      setLocalAudioUrl(null);
    }
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (playing === 'local:upload') {
      audioRef.current?.pause();
      setPlaying(null);
    }
  };

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!file) {
      setUploadError('Select an audio sample first.');
      return;
    }
    if (!name.trim()) {
      setUploadError('Give the voice an identifiable name.');
      return;
    }
    setIsUploading(true);
    setUploadError(null);
    try {
      const form = new FormData();
      form.append('sample', file);
      form.append('name', name.trim());
      form.append('language', language);
      if (refText.trim()) form.append('refText', refText.trim());

      const response = await fetch('/api/voices', { method: 'POST', body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Upload failed');

      clearPickedFile();
      setName('');
      setRefText('');
      await load();
      notifyVoicesChanged();
      setNotice({
        tone: 'emerald',
        text: `Voice "${data.voice?.name || name.trim()}" created successfully.`
      });
    } catch (err) {
      setUploadError(err.message);
    } finally {
      setIsUploading(false);
    }
  };

  const startEditVoice = (voice) => {
    setEditingId(voice.id);
    setEditName(voice.name || '');
    setEditRefText(voice.refText || '');
    setEditLanguage(voice.language || 'bn');
  };

  const cancelEditVoice = () => {
    setEditingId(null);
    setEditName('');
    setEditRefText('');
  };

  const saveEditVoice = async (voiceId) => {
    if (!editName.trim()) {
      setNotice({ tone: 'rose', text: 'Voice name cannot be empty.' });
      return;
    }
    setIsSavingEdit(true);
    try {
      const response = await fetch(`/api/voices/${voiceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editName.trim(),
          language: editLanguage,
          refText: editRefText.trim()
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to update voice');
      await load();
      notifyVoicesChanged();
      setEditingId(null);
      setNotice({ tone: 'emerald', text: 'Voice details updated.' });
    } catch (err) {
      setNotice({ tone: 'rose', text: err.message });
    } finally {
      setIsSavingEdit(false);
    }
  };

  const transcribe = async (voice) => {
    setBusyId(voice.id);
    try {
      const response = await fetch(`/api/voices/${voice.id}/transcribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Transcription failed');
      await load();
      notifyVoicesChanged();
      setNotice({ tone: 'emerald', text: `Transcribed: "${data.refText?.slice(0, 60) || ''}…"` });
    } catch (err) {
      setNotice({ tone: 'rose', text: err.message });
    } finally {
      setBusyId(null);
    }
  };

  const preview = async (voice) => {
    setBusyId(voice.id);
    try {
      const response = await fetch(`/api/voices/${voice.id}/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Preview failed');
      await load();
      playUrl(data.previewUrl || data.audioUrl, `preview:${voice.id}`);
    } catch (err) {
      setNotice({ tone: 'rose', text: err.message });
    } finally {
      setBusyId(null);
    }
  };

  const setDefault = async (voiceId, lang) => {
    setBusyId(voiceId);
    try {
      const response = await fetch(`/api/voices/${voiceId}/default`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: lang })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not set default');
      setState((prev) => ({ ...prev, defaults: { ...prev.defaults, [lang]: voiceId } }));
      notifyVoicesChanged();
      setNotice({
        tone: 'emerald',
        text: `Assigned as default narrator for ${LANGUAGE_LABEL[lang]}.`
      });
    } catch (err) {
      setNotice({ tone: 'rose', text: err.message });
    } finally {
      setBusyId(null);
    }
  };

  const executeDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      const response = await fetch(`/api/voices/${deleteTarget.id}`, { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Delete failed');
      await load();
      notifyVoicesChanged();
      setNotice({ tone: 'emerald', text: `Voice "${deleteTarget.name}" deleted.` });
      setDeleteTarget(null);
    } catch (err) {
      setNotice({ tone: 'rose', text: err.message });
    } finally {
      setIsDeleting(false);
    }
  };

  const remoteLabel = useMemo(() => {
    if (state.remote === 'running') return { tone: 'success', text: 'Colab GPU Warm' };
    if (state.remote === 'starting') return { tone: 'warning', text: 'Colab GPU Starting…' };
    return { tone: 'slate', text: 'Local MPS Pipeline' };
  }, [state.remote]);

  // Main Studio content layout
  const studioContent = (
    <div className="space-y-6">
      {notice && (
        <div
          className={`rounded-xl border px-4 py-3 text-xs flex items-center justify-between gap-3 animate-fade-in ${
            notice.tone === 'rose'
              ? 'border-rose-500/30 bg-rose-500/10 text-rose-300'
              : notice.tone === 'emerald'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
              : 'border-obsidian-700 bg-obsidian-900/60 text-slate-300'
          }`}
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            <span>{notice.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="text-slate-400 hover:text-slate-200 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-300">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Clone a new voice */}
        <div className="lg:col-span-5 space-y-4">
          <Panel
            icon={Sparkles}
            accent="violet"
            title="Clone a New Voice"
            description="Upload 5–20s of clear speech. The sample is normalized, auto-transcribed with Whisper Turbo, and conditioned for OmniVoice synthesis."
          >
            <form onSubmit={handleUpload} className="space-y-4">
              {/* Dropzone */}
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  const dropped = e.dataTransfer.files?.[0];
                  if (dropped) handleFilePicked(dropped);
                }}
                className={`relative rounded-xl border-2 border-dashed p-4 transition-all ${
                  isDragging
                    ? 'border-indigo-500 bg-indigo-500/10 scale-[1.01]'
                    : file
                    ? 'border-indigo-500/40 bg-indigo-500/5'
                    : 'border-obsidian-700 hover:border-indigo-400/50 bg-obsidian-900/40 hover:bg-obsidian-900/70'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="audio/*,.m4a,.mp3,.wav,.ogg,.flac,.aac"
                  onChange={(e) => handleFilePicked(e.target.files?.[0])}
                  className="hidden"
                />

                {file ? (
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="p-2 rounded-lg bg-indigo-500/20 text-indigo-400 flex-shrink-0">
                          <FileAudio className="w-5 h-5" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-slate-100 truncate">{file.name}</p>
                          <p className="text-[11px] text-slate-400 mt-0.5">
                            {(file.size / 1024 / 1024).toFixed(2)} MB · Ready to clone
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={clearPickedFile}
                        className="p-1 rounded-md text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
                        title="Remove file"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    {/* Pre-upload local playback preview */}
                    {localAudioUrl && (
                      <div className="flex items-center gap-2 p-2 rounded-lg bg-obsidian-950/60 border border-obsidian-800">
                        <Button
                          type="button"
                          variant={playing === 'local:upload' ? 'primary' : 'secondary'}
                          size="xs"
                          icon={playing === 'local:upload' ? Pause : Play}
                          onClick={() => playUrl(localAudioUrl, 'local:upload')}
                        >
                          {playing === 'local:upload' ? 'Playing Sample' : 'Listen Sample'}
                        </Button>
                        <span className="text-[11px] text-slate-400">Preview local audio</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className="flex flex-col items-center justify-center py-6 cursor-pointer text-center group"
                  >
                    <div className="p-3 rounded-full bg-obsidian-800 text-slate-300 group-hover:text-indigo-400 group-hover:bg-indigo-500/10 transition-colors mb-3">
                      <Upload className="w-6 h-6" />
                    </div>
                    <p className="text-xs font-semibold text-slate-200">
                      Drop an audio sample here or <span className="text-indigo-400 underline">browse</span>
                    </p>
                    <p className="text-[11px] text-slate-400 mt-1">
                      M4A, MP3, WAV, FLAC, AAC · 5–20s clean speech recommended
                    </p>
                  </div>
                )}
              </div>

              {/* Voice Name */}
              <Field label="Voice Name" hint="Choose a recognizable display name for this narrator.">
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Abdullah Bangla Narrator"
                  className="w-full bg-obsidian-900 border border-obsidian-700 rounded-lg px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/40"
                />
              </Field>

              {/* Language & ASR Info */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
                <Field label="Primary Language">
                  <select
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                    className="w-full bg-obsidian-900 border border-obsidian-700 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
                  >
                    <option value="bn">বাংলা (Bengali)</option>
                    <option value="en">English</option>
                    <option value="ar">العربية (Arabic)</option>
                    <option value="auto">Auto / mixed</option>
                  </select>
                </Field>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">ASR Engine</label>
                  <div className="h-9 flex items-center px-3 rounded-lg border border-obsidian-750 bg-obsidian-900/60 text-xs text-slate-300 gap-2">
                    <Zap className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                    <span className="truncate">Faster-Whisper Turbo</span>
                  </div>
                </div>
              </div>

              {/* Reference Transcript */}
              <Field
                label="Reference Transcript (optional)"
                hint="Leave blank to auto-transcribe. Supplying exact words maximizes cloning stability."
              >
                <textarea
                  rows={3}
                  value={refText}
                  onChange={(e) => setRefText(e.target.value)}
                  placeholder="Words spoken in the audio sample (Bengali, English, or Arabic)…"
                  className="w-full bg-obsidian-900 border border-obsidian-700 rounded-lg px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/40 leading-relaxed font-sans"
                />
              </Field>

              {uploadError && (
                <div className="p-2.5 rounded-lg border border-rose-500/30 bg-rose-500/10 text-xs text-rose-300">
                  {uploadError}
                </div>
              )}

              <Button
                type="submit"
                variant="primary"
                size="md"
                icon={Sparkles}
                isLoading={isUploading}
                disabled={!file || !name.trim()}
                className="w-full shadow-sm"
              >
                Create Voice Clone
              </Button>
            </form>
          </Panel>
        </div>

        {/* Right Column: Voice Library & Installed Narrators */}
        <div className="lg:col-span-7 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <h3 className="text-sm font-semibold text-slate-100">Voice Library</h3>
              <Tag tone="slate" size="xs">
                {state.voices.length + 1} available
              </Tag>
              <Tag tone={remoteLabel.tone} size="xs" icon={Zap}>
                {remoteLabel.text}
              </Tag>
            </div>
            <Button
              variant="ghost"
              size="sm"
              icon={RefreshCw}
              onClick={load}
              isLoading={isLoading}
            >
              Refresh
            </Button>
          </div>

          <div className="space-y-3.5">
            {/* Pinned Built-in Reference Voice */}
            <div className="p-4 rounded-xl border border-obsidian-700/80 bg-obsidian-850 hover:border-obsidian-600 transition-colors space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-slate-100">
                      {state.builtin?.name || 'Built-in reference voice'}
                    </span>
                    <Tag tone="brand" size="xs">
                      System Reference
                    </Tag>
                    <Tag tone="slate" size="xs">
                      বাংলা · 15.0s
                    </Tag>
                  </div>
                  <p className="text-xs text-slate-400">
                    {state.builtin?.description || 'Bundled Sirah reference narration sample — always available offline.'}
                  </p>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  <Button
                    variant={playing === 'sample:builtin' ? 'primary' : 'secondary'}
                    size="xs"
                    icon={playing === 'sample:builtin' ? Pause : Play}
                    onClick={() => playUrl(state.builtin?.audioUrl || '/api/voices/builtin/audio', 'sample:builtin')}
                  >
                    {playing === 'sample:builtin' ? 'Playing Sample' : 'Sample Audio'}
                  </Button>
                </div>
              </div>

              {/* Default assignment for built-in voice */}
              <div className="pt-2 border-t border-obsidian-800/80 flex items-center justify-between flex-wrap gap-2 text-xs">
                <span className="text-slate-400 text-[11.5px]">Default narrator for:</span>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {LANGUAGE_ORDER.map((lang) => {
                    const isDefault = state.defaults[lang] === 'builtin';
                    return (
                      <button
                        key={lang}
                        type="button"
                        onClick={() => setDefault('builtin', lang)}
                        disabled={busyId === 'builtin' || isDefault}
                        className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all cursor-pointer flex items-center gap-1 ${
                          isDefault
                            ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 font-semibold'
                            : 'bg-obsidian-800 hover:bg-obsidian-750 text-slate-400 hover:text-slate-200 border border-obsidian-700/70'
                        }`}
                        title={`Assign as default for ${LANGUAGE_FULL_LABEL[lang]}`}
                      >
                        {isDefault && <Check className="w-3 h-3 text-indigo-400" />}
                        <span>{LANGUAGE_LABEL[lang]}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Custom Voice Clones List */}
            {state.voices.length === 0 ? (
              <div className="p-8 rounded-xl border border-dashed border-obsidian-700 bg-obsidian-900/30 text-center space-y-2">
                <Mic className="w-8 h-8 mx-auto text-slate-500" />
                <p className="text-xs font-medium text-slate-300">No custom voice clones yet</p>
                <p className="text-[11px] text-slate-500 max-w-sm mx-auto">
                  Drop a 5–20s clean speech sample in the clone panel on the left to synthesize narration in your own voice.
                </p>
              </div>
            ) : (
              state.voices.map((voice) => {
                const isBusy = busyId === voice.id;
                const isPlayingSample = playing === `sample:${voice.id}`;
                const isPlayingPreview = playing === `preview:${voice.id}`;
                const isEditing = editingId === voice.id;

                // Identify if this voice is default for any language
                const defaultForLangs = LANGUAGE_ORDER.filter(
                  (lang) => state.defaults[lang] === voice.id
                );

                return (
                  <div
                    key={voice.id}
                    className="p-4 rounded-xl border border-obsidian-700/80 bg-obsidian-850 hover:border-obsidian-600/80 transition-all space-y-3.5"
                  >
                    {/* Top Row: Title, Badges & Audio / Action Buttons */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-slate-100 truncate">
                            {voice.name}
                          </span>

                          <Tag tone="slate" size="xs">
                            {LANGUAGE_LABEL[voice.language] || voice.language}
                          </Tag>

                          {voice.duration && (
                            <span className="text-[11px] text-slate-400 font-mono">
                              {voice.duration.toFixed(1)}s
                            </span>
                          )}

                          {defaultForLangs.length > 0 && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                              <CheckCircle2 className="w-3 h-3 text-indigo-400" />
                              Default ({defaultForLangs.map((l) => LANGUAGE_LABEL[l]).join(', ')})
                            </span>
                          )}

                          {voice.hasPromptCache && (
                            <Tag tone="success" size="xs">
                              GPU Ready
                            </Tag>
                          )}
                        </div>

                        {voice.transcriptWarning && (
                          <p className="text-[11px] text-amber-400 flex items-center gap-1 mt-0.5">
                            <Info className="w-3.5 h-3.5 flex-shrink-0" />
                            <span>{voice.transcriptWarning}</span>
                          </p>
                        )}
                      </div>

                      {/* Action buttons (neatly wrapped, guaranteed never to squash name) */}
                      <div className="flex items-center gap-1.5 flex-wrap sm:flex-nowrap flex-shrink-0">
                        <Button
                          variant={isPlayingSample ? 'primary' : 'secondary'}
                          size="xs"
                          icon={isPlayingSample ? Pause : Play}
                          onClick={() => playUrl(voice.sampleUrl || voice.audioUrl, `sample:${voice.id}`)}
                          disabled={isBusy}
                        >
                          {isPlayingSample ? 'Playing' : 'Sample'}
                        </Button>

                        <Button
                          variant={isPlayingPreview ? 'primary' : 'secondary'}
                          size="xs"
                          icon={isPlayingPreview ? Pause : Sparkles}
                          onClick={() => preview(voice)}
                          isLoading={isBusy}
                          title="Generate or play preview narration with this voice"
                        >
                          {isPlayingPreview ? 'Playing' : 'Preview'}
                        </Button>

                        <div className="h-4 w-px bg-obsidian-750 mx-0.5 hidden sm:block" />

                        <Button
                          variant="ghost"
                          size="xs"
                          icon={Pencil}
                          onClick={() => isEditing ? cancelEditVoice() : startEditVoice(voice)}
                          disabled={isBusy}
                          title="Edit voice name or transcript"
                        >
                          {isEditing ? 'Cancel' : 'Edit'}
                        </Button>

                        <Button
                          variant="ghost"
                          size="xs"
                          icon={Sparkles}
                          onClick={() => transcribe(voice)}
                          disabled={isBusy}
                          title="Re-transcribe audio with Whisper"
                        >
                          Transcribe
                        </Button>

                        <Button
                          variant="danger"
                          size="xs"
                          icon={Trash2}
                          onClick={() => setDeleteTarget(voice)}
                          disabled={isBusy}
                          title="Delete voice"
                        />
                      </div>
                    </div>

                    {/* Middle Row: Transcript View or Inline Editor */}
                    {isEditing ? (
                      <div className="p-3 rounded-lg border border-indigo-500/30 bg-obsidian-900/90 space-y-3 animate-fade-in">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <Field label="Voice Name">
                            <input
                              type="text"
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              className="w-full bg-obsidian-850 border border-obsidian-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
                            />
                          </Field>
                          <Field label="Language">
                            <select
                              value={editLanguage}
                              onChange={(e) => setEditLanguage(e.target.value)}
                              className="w-full bg-obsidian-850 border border-obsidian-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
                            >
                              <option value="bn">বাংলা (Bengali)</option>
                              <option value="en">English</option>
                              <option value="ar">العربية (Arabic)</option>
                              <option value="auto">Auto / mixed</option>
                            </select>
                          </Field>
                        </div>

                        <Field
                          label="Reference Transcript"
                          hint="Edit transcript to match the spoken words exactly. Correcting Whisper errors significantly improves voice cloning clarity."
                        >
                          <textarea
                            rows={3}
                            value={editRefText}
                            onChange={(e) => setEditRefText(e.target.value)}
                            className="w-full bg-obsidian-850 border border-obsidian-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-indigo-500 leading-relaxed font-sans"
                          />
                        </Field>

                        <div className="flex items-center justify-end gap-2 pt-1">
                          <Button
                            variant="ghost"
                            size="xs"
                            onClick={cancelEditVoice}
                            disabled={isSavingEdit}
                          >
                            Cancel
                          </Button>
                          <Button
                            variant="primary"
                            size="xs"
                            icon={Check}
                            onClick={() => saveEditVoice(voice.id)}
                            isLoading={isSavingEdit}
                          >
                            Save Changes
                          </Button>
                        </div>
                      </div>
                    ) : (
                      voice.refText ? (
                        <div className="p-2.5 rounded-lg bg-obsidian-900/60 border border-obsidian-800/80 text-xs text-slate-300 leading-relaxed font-sans italic">
                          "{voice.refText}"
                        </div>
                      ) : (
                        <p className="text-[11px] text-slate-500 italic">
                          No transcript yet · Click Transcribe to auto-generate
                        </p>
                      )
                    )}

                    {/* Bottom Row: Default Narrator Assignment Pills */}
                    <div className="pt-2 border-t border-obsidian-800/80 flex items-center justify-between flex-wrap gap-2 text-xs">
                      <span className="text-slate-400 text-[11.5px]">Default narrator for:</span>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {LANGUAGE_ORDER.map((lang) => {
                          const isDefault = state.defaults[lang] === voice.id;
                          return (
                            <button
                              key={lang}
                              type="button"
                              onClick={() => setDefault(voice.id, lang)}
                              disabled={isBusy || isDefault}
                              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all cursor-pointer flex items-center gap-1 ${
                                isDefault
                                  ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 font-semibold shadow-xs'
                                  : 'bg-obsidian-800 hover:bg-obsidian-750 text-slate-400 hover:text-slate-200 border border-obsidian-700/70'
                              }`}
                              title={`Assign as default for ${LANGUAGE_FULL_LABEL[lang]}`}
                            >
                              {isDefault && <Check className="w-3 h-3 text-indigo-400" />}
                              <span>{LANGUAGE_LABEL[lang]}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      <ConfirmModal
        isOpen={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={executeDelete}
        isLoading={isDeleting}
        title={`Delete "${deleteTarget?.name}"?`}
        message="This voice will be removed from your local library and default language assignments will reset to the built-in reference narrator."
        confirmText="Delete Voice"
        variant="danger"
      />
    </div>
  );

  // If embedded in SettingsView, render the content directly without duplicate header
  if (embedded) {
    return studioContent;
  }

  // Standalone page layout
  return (
    <div className="min-h-screen flex flex-col bg-app text-slate-100">
      <header className="sticky top-0 z-30 border-b border-obsidian-700/80 bg-obsidian-850/95 backdrop-blur-md">
        <div className="max-w-[1280px] mx-auto px-4 sm:px-6 md:px-8 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Button
              variant="ghost"
              size="sm"
              icon={ArrowLeft}
              onClick={onBack}
              className="text-slate-300"
            >
              Library
            </Button>
            <span className="text-slate-500 font-normal">/</span>
            <span className="text-sm font-semibold text-slate-100 truncate">
              Narrator Voices
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Tag tone={remoteLabel.tone} size="sm" icon={Zap}>
              {remoteLabel.text}
            </Tag>
            {onOpenModels && (
              <Button variant="ghost" size="sm" icon={Boxes} onClick={onOpenModels}>
                <span className="hidden sm:inline">Models</span>
              </Button>
            )}
            {onOpenSettings && (
              <Button variant="ghost" size="sm" icon={Cpu} onClick={onOpenSettings}>
                <span className="hidden sm:inline">Settings</span>
              </Button>
            )}
            <div className="h-4 w-px bg-obsidian-700/60 mx-1" aria-hidden="true" />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-[1280px] mx-auto px-4 sm:px-6 md:px-8 py-8">
        {studioContent}
      </main>
    </div>
  );
}
