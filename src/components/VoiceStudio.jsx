import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  AudioLines,
  CheckCircle2,
  Cpu,
  Loader2,
  Mic,
  Pause,
  Play,
  RefreshCw,
  Sparkles,
  Trash2,
  Upload,
  Wand2,
  Zap,
  Volume2,
  Boxes
} from 'lucide-react';
import { Button } from './ui/Button';
import { Panel } from './ui/Panel';
import { Field } from './ui/Field';
import { Tag } from './ui/Badge';
import { ConfirmModal } from './ui/ConfirmModal';
import { notifyVoicesChanged } from '../lib/useVoiceLibrary';

const LANGUAGE_LABEL = { bn: 'বাংলা', en: 'English', ar: 'العربية', auto: 'Auto / mixed' };
const LANGUAGE_ORDER = ['bn', 'en', 'ar'];

/**
 * Voice cloning studio: upload a short sample, auto-transcribe it, keep the
 * library on disk + SQLite, and assign a clone to each narration language.
 *
 * Clones run on the warm Colab GPU worker when it is available and fall back to
 * the local OmniVoice pipeline otherwise — same as page narration.
 */
export function VoiceStudio({ onBack, onOpenSettings, onOpenModels }) {
  const [state, setState] = useState({
    voices: [],
    builtin: { id: 'builtin', name: 'Built-in reference voice' },
    defaults: { bn: 'builtin', en: 'builtin', ar: 'builtin' },
    remote: 'stopped'
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [notice, setNotice] = useState(null);

  // Upload form
  const [file, setFile] = useState(null);
  const [name, setName] = useState('');
  const [language, setLanguage] = useState('bn');
  const [refText, setRefText] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const fileInputRef = useRef(null);

  // Playback (sample + generated preview)
  const [playing, setPlaying] = useState(null);
  const audioRef = useRef(null);

  // Confirm delete modal state
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/voices');      const data = await response.json();
      setState({
        voices: data.voices || [],
        builtin: data.builtin || { id: 'builtin', name: 'Built-in reference voice' },
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
    };
  }, []);

  const playUrl = (url, key) => {
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

  const handleFile = (e) => {
    const picked = e.target.files?.[0];
    if (!picked) return;
    setFile(picked);
    if (!name.trim()) {
      const stem = picked.name.replace(/\.[^/.]+$/, '').replace(/[-_]+/g, ' ');
      setName(stem.charAt(0).toUpperCase() + stem.slice(1));
    }
    setUploadError(null);
  };

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!file) {
      setUploadError('Pick an audio sample first.');
      return;
    }
    if (!name.trim()) {
      setUploadError('Name the voice.');
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

      setFile(null);
      setName('');
      setRefText('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      await load();
      notifyVoicesChanged();
      setNotice({
        tone: 'emerald',
        text: `Voice "${data.voice?.name}" created. Auto-transcribed ${data.voice?.refText ? 'successfully' : 'empty'}.`
      });
    } catch (err) {
      setUploadError(err.message);
    } finally {
      setIsUploading(false);
    }
  };

  const patchVoice = async (voice, fields, successMessage) => {
    setBusyId(voice.id);
    try {
      const response = await fetch(`/api/voices/${voice.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Update failed');
      await load();
      notifyVoicesChanged();
      if (successMessage) setNotice({ tone: 'emerald', text: successMessage });
    } catch (err) {
      setNotice({ tone: 'rose', text: err.message });
    } finally {
      setBusyId(null);
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
      setNotice({ tone: 'emerald', text: `Transcribed: "${data.refText?.slice(0, 80) || ''}…"` });
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
    if (state.remote === 'running') return { tone: 'emerald', text: 'Colab GPU warm — clones render remotely' };
    if (state.remote === 'starting') return { tone: 'amber', text: 'Colab GPU starting…' };
    return { tone: 'slate', text: 'Colab GPU idle — previews run locally' };
  }, [state.remote]);

  return (
    <div className="min-h-screen flex flex-col bg-obsidian-950 text-slate-100">
      <header className="sticky top-0 z-30 border-b border-obsidian-800/80 bg-obsidian-950/85 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Button
              variant="ghost"
              size="icon-sm"
              icon={ArrowLeft}
              onClick={onBack}
              title="Back to library"
              aria-label="Back to library"
            />
            <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-400 to-brand-500 flex items-center justify-center shadow-lg shadow-violet-500/20 flex-shrink-0">
              <Mic className="w-4 h-4 text-obsidian-950" />
            </span>
            <div className="min-w-0">
              <p className="text-[13.5px] font-semibold text-white leading-tight truncate">Voice Studio</p>
              <p className="text-[11px] text-slate-400 leading-tight truncate hidden sm:block">
                Zero-shot voice cloning & sample library
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Tag tone={remoteLabel.tone} size="sm" icon={Zap} dot={state.remote === 'running'}>
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
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-7xl mx-auto px-6 py-8 space-y-6">
        {notice && (
          <div
            className={`rounded-xl border px-4 py-2.5 text-xs animate-fade-in ${
              notice.tone === 'rose'
                ? 'border-rose-500/30 bg-rose-500/10 text-rose-200'
                : notice.tone === 'emerald'
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                : 'border-obsidian-700 bg-obsidian-900/60 text-slate-300'
            }`}
          >
            {notice.text}
          </div>
        )}
        {error && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-xs text-rose-200">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] gap-6 items-start">
          {/* Upload panel */}
          <Panel
            icon={Upload}
            accent="violet"
            title="Clone a new voice"
            description="4–10s of clean speech. The sample is cut at a natural pause and transcribed with Whisper."
          >
            <form onSubmit={handleUpload} className="space-y-4">
              <label
                className={`flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-6 cursor-pointer transition-colors ${
                  file
                    ? 'border-violet-500/50 bg-violet-500/5'
                    : 'border-obsidian-700 hover:border-violet-400/50 hover:bg-obsidian-850/60'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="audio/*,.m4a,.mp3,.wav,.ogg,.flac,.aac"
                  onChange={handleFile}
                  className="hidden"
                />
                {file ? (
                  <>
                    <AudioLines className="w-7 h-7 text-violet-300" />
                    <span className="text-xs text-slate-200 font-medium text-center break-all">{file.name}</span>
                    <span className="text-[10px] text-slate-400">
                      {(file.size / 1024 / 1024).toFixed(2)} MB · click to replace
                    </span>
                  </>
                ) : (
                  <>
                    <Upload className="w-7 h-7 text-slate-500" />
                    <span className="text-xs text-slate-300 font-medium">Drop or pick an audio sample</span>
                    <span className="text-[10px] text-slate-400">m4a · mp3 · wav · ogg · flac (≤ 40 MB)</span>
                  </>
                )}
              </label>

              <Field label="Voice name">
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Rafiq Bhai — narration"
                  className="w-full bg-obsidian-950 border border-obsidian-700 rounded-lg px-3 h-8 text-xs text-slate-200 focus:outline-none focus:border-violet-400"
                />
              </Field>

              <Field label="Sample language">
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="w-full bg-obsidian-950 border border-obsidian-700 rounded-lg px-2.5 h-8 text-xs text-slate-200 focus:outline-none focus:border-violet-400"
                >
                  <option value="bn">বাংলা (Bengali)</option>
                  <option value="en">English</option>
                  <option value="ar">العربية (Arabic)</option>
                  <option value="auto">Auto / mixed</option>
                </select>
              </Field>

              <Field label="Sample transcript (optional)">
                <textarea
                  rows={2}
                  value={refText}
                  onChange={(e) => setRefText(e.target.value)}
                  placeholder="Leave empty to auto-transcribe with Whisper"
                  className="w-full bg-obsidian-950 border border-obsidian-700 rounded-lg px-3 py-2 text-xs text-slate-200 leading-relaxed focus:outline-none focus:border-violet-400 resize-y"
                />
              </Field>

              {uploadError && <p className="text-[11px] text-rose-300">{uploadError}</p>}

              <Button
                type="submit"
                variant="primary"
                size="md"
                icon={Sparkles}
                isLoading={isUploading}
                className="w-full"
              >
                {isUploading ? 'Cloning voice…' : 'Create clone'}
              </Button>
              <p className="text-[10.5px] text-slate-400 leading-relaxed">
                The reference is normalized to 24 kHz mono. Only the first 15s are kept: OmniVoice pairs a
                transcript with at most 20s of audio, and 15s is comfortably inside that limit. Encoding happens
                once per session on the GPU (or locally), never per page.
              </p>
            </form>
          </Panel>

          {/* Library */}
          <div className="space-y-4">
            <Panel
              icon={AudioLines}
              accent="brand"
              title={`Voice library (${state.voices.length})`}
              description="Assign a clone to each language. Anything unassigned uses the built-in reference."
              action={
                <Button variant="ghost" size="xs" icon={RefreshCw} onClick={load}>
                  Refresh
                </Button>
              }
            >
              {/* Defaults row */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pb-4 border-b border-obsidian-800/70">
                {LANGUAGE_ORDER.map((lang) => (
                  <Field key={lang} label={`Default · ${LANGUAGE_LABEL[lang]}`}>
                    <select
                      value={state.defaults[lang] || 'builtin'}
                      onChange={(e) => setDefault(e.target.value, lang)}
                      className="w-full bg-obsidian-950 border border-obsidian-700 rounded-lg px-2.5 h-8 text-xs text-slate-200 focus:outline-none focus:border-brand-400"
                    >
                      <option value="builtin">{state.builtin.name}</option>
                      {state.voices.map((voice) => (
                        <option key={voice.id} value={voice.id}>
                          {voice.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                ))}
              </div>

              {isLoading ? (
                <div className="flex items-center gap-2 text-xs text-slate-400 py-8 justify-center">
                  <Loader2 className="w-4 h-4 animate-spin text-brand-400" /> Loading voices…
                </div>
              ) : state.voices.length === 0 ? (
                <div className="text-center py-10">
                  <Mic className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                  <p className="text-xs text-slate-400">No cloned voices yet.</p>
                  <p className="text-[11px] text-slate-500 mt-1">Upload a sample on the left to create your first clone.</p>
                </div>
              ) : (
                <ul className="divide-y divide-obsidian-800/70">
                  {state.voices.map((voice) => {
                    const isBusy = busyId === voice.id;
                    const defaultFor = LANGUAGE_ORDER.filter((lang) => state.defaults[lang] === voice.id);
                    return (
                      <li key={voice.id} className="py-3.5 flex flex-col gap-2.5">
                        <div className="flex items-start gap-3">
                          <button
                            type="button"
                            onClick={() => playUrl(voice.audioUrl, `sample:${voice.id}`)}
                            className="w-9 h-9 rounded-lg bg-obsidian-800 hover:bg-obsidian-700 border border-obsidian-700 flex items-center justify-center flex-shrink-0 transition"
                            title="Play reference sample"
                            aria-label={`Play reference sample for ${voice.name}`}
                          >
                            {playing === `sample:${voice.id}` ? (
                              <Pause className="w-4 h-4 text-brand-300" />
                            ) : (
                              <Play className="w-4 h-4 text-slate-300 translate-x-0.5" />
                            )}
                          </button>

                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <input
                                defaultValue={voice.name}
                                onBlur={(e) => {
                                  const next = e.target.value.trim();
                                  if (next && next !== voice.name) patchVoice(voice, { name: next });
                                }}
                                className="bg-transparent border border-transparent hover:border-obsidian-700 focus:border-brand-400 focus:bg-obsidian-950 rounded px-1.5 py-0.5 text-xs font-semibold text-slate-100 focus:outline-none max-w-[220px]"
                              />
                              <Tag tone="slate" size="xs">
                                {LANGUAGE_LABEL[voice.language] || voice.language}
                              </Tag>
                              <Tag tone="slate" size="xs">
                                {voice.duration.toFixed(1)}s
                              </Tag>
                              {voice.hasPromptCache && (
                                <Tag tone="emerald" size="xs">
                                  prompt cached
                                </Tag>
                              )}
                              {defaultFor.map((lang) => (
                                <Tag key={lang} tone="brand" size="xs">
                                  default · {LANGUAGE_LABEL[lang]}
                                </Tag>
                              ))}
                            </div>

                            <div className="mt-1.5 flex items-start gap-1.5">
                              <textarea
                                defaultValue={voice.refText}
                                rows={2}
                                onBlur={(e) => {
                                  const next = e.target.value.trim();
                                  if (next !== voice.refText) {
                                    patchVoice(voice, { refText: next }, 'Transcript saved — clone prompt will rebuild.');
                                  }
                                }}
                                placeholder="Reference transcript (used to align the clone)…"
                                className="w-full bg-obsidian-950/60 border border-obsidian-800 rounded-md px-2.5 py-1.5 text-xs text-slate-300 leading-relaxed focus:outline-none focus:border-brand-400 resize-y"
                              />
                            </div>
                            {voice.transcriptWarning && (
                              <p className="mt-1 text-[10px] leading-relaxed text-amber-300/90">
                                {voice.transcriptWarning.message}
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 flex-wrap pl-12">
                          <Button
                            variant="outline"
                            size="xs"
                            icon={Wand2}
                            onClick={() => preview(voice)}
                            disabled={isBusy}
                          >
                            {isBusy ? 'Working…' : 'Preview voice'}
                          </Button>
                          <Button
                            variant="ghost"
                            size="xs"
                            icon={RefreshCw}
                            onClick={() => transcribe(voice)}
                            disabled={isBusy}
                          >
                            Re-transcribe
                          </Button>
                          {LANGUAGE_ORDER.map((lang) => (
                            <Button
                              key={lang}
                              variant={state.defaults[lang] === voice.id ? 'secondary' : 'ghost'}
                              size="xs"
                              icon={CheckCircle2}
                              onClick={() => setDefault(voice.id, lang)}
                              disabled={isBusy || state.defaults[lang] === voice.id}
                              title={`Use for ${LANGUAGE_LABEL[lang]}`}
                            >
                              {lang.toUpperCase()}
                            </Button>
                          ))}
                          <Button
                            variant="danger"
                            size="xs"
                            icon={Trash2}
                            onClick={() => setDeleteTarget(voice)}
                            disabled={isBusy}
                          >
                            Delete
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Panel>

            <div className="rounded-xl border border-obsidian-800 bg-obsidian-900/40 px-4 py-3 text-xs text-slate-400 leading-relaxed">
              <span className="text-slate-300 font-medium">How cloning runs:</span> a warm Colab GPU worker encodes the
              sample once and reuses that prompt for every page. With the GPU offline the same sample is encoded locally on
              this Mac (slower, ~1 min for the first page per session). Change the backend in Settings → TTS Backend.
            </div>
          </div>
        </div>
      </main>

      {/* Confirm Delete Voice Modal */}
      <ConfirmModal
        isOpen={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={executeDelete}
        title={`Delete "${deleteTarget?.name}"?`}
        message="The cloned audio sample and cached prompt weights will be permanently removed from disk and database."
        confirmText="Delete Voice"
        variant="danger"
        isLoading={isDeleting}
      />
    </div>
  );
}

export default VoiceStudio;
