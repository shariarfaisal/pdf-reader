import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowLeft,
  Boxes,
  Check,
  CheckCircle2,
  Copy,
  Cpu,
  Download,
  ExternalLink,
  Folder,
  FolderGit2,
  Globe,
  HardDrive,
  Layers,
  Link2,
  Loader2,
  Mic,
  MoreVertical,
  Plus,
  RefreshCw,
  Scale,
  ScanText,
  Search,
  Settings as SettingsIcon,
  Sparkles,
  Terminal,
  Trash2,
  Unlink,
  Volume2,
  X,
  AlertCircle
} from 'lucide-react';
import { Button } from './ui/Button';
import { Tag } from './ui/Badge';
import { Panel } from './ui/Panel';
import { Field, TextInput, SelectInput } from './ui/Field';
import { ProgressBar } from './ui/ProgressBar';
import { DropdownMenu } from './ui/DropdownMenu';
import { ConfirmModal } from './ui/ConfirmModal';
import { formatBytes } from '../lib/format';

const TASK_TABS = [
  { id: 'all', label: 'All Models', icon: Boxes },
  { id: 'tts', label: 'Voice & TTS', icon: Volume2 },
  { id: 'asr', label: 'Speech-to-Text', icon: Mic },
  { id: 'ocr', label: 'OCR & Vision', icon: ScanText }
];

const TASK_META = {
  tts: {
    label: 'Voice Cloning & TTS',
    icon: Volume2,
    badgeColor: 'text-brand-300 bg-brand-500/10 border-brand-500/20'
  },
  asr: {
    label: 'Speech-to-Text (ASR)',
    icon: Mic,
    badgeColor: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20'
  },
  ocr: {
    label: 'Local OCR & Vision',
    icon: ScanText,
    badgeColor: 'text-amber-300 bg-amber-500/10 border-amber-500/20'
  }
};

function shortenHome(p) {
  if (!p || typeof p !== 'string') return '';
  return p.replace(/^\/Users\/[^/]+/, '~').replace(/^\/home\/[^/]+/, '~');
}

function getStatusBadge(model) {
  switch (model.status) {
    case 'installed':
      return {
        tone: 'emerald',
        label: model.origin === 'bundled' ? 'Installed · Local' : 'Installed · HF Cache',
        dot: false
      };
    case 'referenced':
      return {
        tone: 'sky',
        label: 'Linked Custom Path',
        dot: false
      };
    case 'downloading':
      return {
        tone: 'amber',
        label: `Downloading ${model.download?.percent ? `${model.download.percent}%` : '…'}`,
        dot: true
      };
    case 'incomplete':
      return {
        tone: 'amber',
        label: 'Incomplete Download',
        dot: false
      };
    default:
      return {
        tone: 'slate',
        label: 'Not Installed',
        dot: false
      };
  }
}

/**
 * Reusable Model Manager View.
 * Used both inside the full-page `/models` route (`ModelHub`) and inside
 * `SettingsModal` (`Local AI Models` tab) so every model action is available everywhere.
 */
export function ModelManagerView({ compact = false, onOpenFullHub = null, onSettingsChanged = null }) {
  const [catalog, setCatalog] = useState({
    models: [],
    activeModels: { tts: 'omnivoice', asr: 'faster-whisper-large-v3-turbo', ocrTier: 'mac_first' },
    storage: null,
    pythonEnv: null
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTask, setActiveTask] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [onlyInstalled, setOnlyInstalled] = useState(false);
  const [busyModelId, setBusyModelId] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  // Reference path editor state per model
  const [editingRefId, setEditingRefId] = useState(null);
  const [refInputValue, setRefInputValue] = useState('');
  const [savingRefId, setSavingRefId] = useState(null);
  const [copiedPathId, setCopiedPathId] = useState(null);
  const [copiedCacheDir, setCopiedCacheDir] = useState(false);

  // Custom model registration form
  const [showAddCustom, setShowAddCustom] = useState(false);
  const [customForm, setCustomForm] = useState({
    name: '',
    task: 'tts',
    repoId: '',
    customPath: '',
    languages: 'bn, ar, en',
    description: ''
  });
  const [addingCustom, setAddingCustom] = useState(false);

  // Delete confirmation modal
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const loadCatalog = useCallback(async ({ refresh = false } = {}) => {
    if (refresh) setRefreshing(true);
    try {
      const res = await fetch(`/api/models${refresh ? '?refresh=1' : ''}`);
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data.models)) {
        setCatalog({
          models: data.models,
          activeModels: data.activeModels || {
            tts: 'omnivoice',
            asr: 'faster-whisper-large-v3-turbo',
            ocrTier: 'mac_first'
          },
          storage: data.storage || null,
          pythonEnv: data.pythonEnv || null
        });
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  // Subscribe to SSE for real-time model_download progress events
  useEffect(() => {
    const es = new EventSource('/api/events');
    es.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data);
        if (ev.type !== 'model_download') return;

        const { modelId, download, model: updatedModel } = ev;
        if (download?.status === 'completed' || download?.status === 'cancelled') {
          if (download.status === 'completed') {
            setNotice(`Finished downloading ${updatedModel?.name || modelId}.`);
          }
          loadCatalog();
          return;
        }
        if (download?.status === 'error') {
          setError(`Download failed for ${modelId}: ${download.error || 'Unknown error'}`);
          loadCatalog();
          return;
        }

        setCatalog((prev) => ({
          ...prev,
          models: prev.models.map((m) =>
            m.id === modelId
              ? {
                  ...m,
                  status: 'downloading',
                  download: { ...(m.download || {}), ...download }
                }
              : m
          )
        }));
      } catch {}
    };
    return () => es.close();
  }, [loadCatalog]);

  const handleDownload = async (model) => {
    setBusyModelId(model.id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/models/${encodeURIComponent(model.id)}/download`, {
        method: 'POST'
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not start download');
      await loadCatalog();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyModelId(null);
    }
  };

  const handleCancelDownload = async (modelId) => {
    setBusyModelId(modelId);
    try {
      await fetch(`/api/models/${encodeURIComponent(modelId)}/cancel`, { method: 'POST' });
      await loadCatalog();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyModelId(null);
    }
  };

  const handleActivateModel = async (model) => {
    setBusyModelId(model.id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/models/${encodeURIComponent(model.id)}/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: model.task })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not set active model');
      setCatalog((prev) => ({
        ...prev,
        models: data.models || prev.models,
        activeModels: data.activeModels || prev.activeModels
      }));
      setNotice(`Active ${model.task.toUpperCase()} model set to "${model.name}".`);
      onSettingsChanged?.(data.settings);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyModelId(null);
    }
  };

  const handleSaveReference = async (modelId, pathVal) => {
    setSavingRefId(modelId);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/models/${encodeURIComponent(modelId)}/reference`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: pathVal })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not link model path');
      setCatalog((prev) => ({
        ...prev,
        models: data.models || prev.models,
        storage: data.storage || prev.storage
      }));
      setEditingRefId(null);
      setNotice(
        pathVal.trim()
          ? `Linked local path for "${data.model?.name || modelId}".`
          : `Reset "${data.model?.name || modelId}" to default Hugging Face cache.`
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingRefId(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    setError(null);
    setNotice(null);
    try {
      const isRef = deleteTarget.origin === 'referenced';
      const qs = new URLSearchParams();
      if (isRef) qs.set('deleteFiles', '0');
      if (deleteTarget.isCustom) qs.set('removeEntry', '1');
      const res = await fetch(
        `/api/models/${encodeURIComponent(deleteTarget.id)}?${qs.toString()}`,
        { method: 'DELETE' }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to remove model');
      setCatalog((prev) => ({
        ...prev,
        models: data.models || prev.models,
        storage: data.storage || prev.storage
      }));
      setNotice(
        isRef
          ? `Unlinked custom reference for "${deleteTarget.name}". External files were kept intact.`
          : `Deleted cached weights for "${deleteTarget.name}".`
      );
      setDeleteTarget(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleRegisterCustomModel = async (e) => {
    e.preventDefault();
    setAddingCustom(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/models/custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(customForm)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not register custom model');
      setCatalog((prev) => ({
        ...prev,
        models: data.models || prev.models,
        storage: data.storage || prev.storage
      }));
      setCustomForm({
        name: '',
        task: 'tts',
        repoId: '',
        customPath: '',
        languages: 'bn, ar, en',
        description: ''
      });
      setShowAddCustom(false);
      setNotice(`Registered "${data.model?.name}" in Model Hub.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setAddingCustom(false);
    }
  };

  const copyPath = async (modelId, text) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedPathId(modelId);
      setTimeout(() => setCopiedPathId(null), 1800);
    } catch {}
  };

  const copyCacheDir = async (dir) => {
    if (!dir) return;
    try {
      await navigator.clipboard.writeText(dir);
      setCopiedCacheDir(true);
      setTimeout(() => setCopiedCacheDir(false), 1800);
    } catch {}
  };

  const counts = useMemo(() => {
    const map = { all: catalog.models.length, tts: 0, asr: 0, ocr: 0, installed: 0 };
    for (const m of catalog.models) {
      if (map[m.task] !== undefined) map[m.task] += 1;
      if (m.isInstalled) map.installed += 1;
    }
    return map;
  }, [catalog.models]);

  const filteredModels = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return catalog.models.filter((m) => {
      if (activeTask !== 'all' && m.task !== activeTask) return false;
      if (onlyInstalled && !m.isInstalled) return false;
      if (!q) return true;
      const hay = [
        m.name,
        m.repoId,
        m.fileName,
        m.subtask,
        m.description,
        ...(m.languages || [])
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [catalog.models, activeTask, onlyInstalled, searchQuery]);

  const activeTtsModel = useMemo(
    () =>
      catalog.models.find((m) => m.id === catalog.activeModels.tts) ||
      catalog.models.find((m) => m.task === 'tts' && m.isInstalled),
    [catalog.models, catalog.activeModels.tts]
  );

  const activeAsrModel = useMemo(
    () =>
      catalog.models.find((m) => m.id === catalog.activeModels.asr) ||
      catalog.models.find((m) => m.task === 'asr' && m.isInstalled),
    [catalog.models, catalog.activeModels.asr]
  );

  const ocrInstalledCount = useMemo(
    () => catalog.models.filter((m) => m.task === 'ocr' && m.isInstalled).length,
    [catalog.models]
  );

  return (
    <div className="space-y-4">
      {/* Top Active Task Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* 1. Active TTS */}
        <div className="rounded-xl border border-obsidian-800 bg-obsidian-900/70 p-4 flex flex-col justify-between gap-3 shadow-sm hover:border-obsidian-700/80 transition-colors">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-brand-500/10 border border-brand-500/20 text-brand-400 flex items-center justify-center flex-shrink-0">
                <Volume2 className="w-3.5 h-3.5" />
              </div>
              <span className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider">
                Voice Cloning &amp; TTS
              </span>
            </div>
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10.5px] font-medium border ${
                activeTtsModel?.isInstalled
                  ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
                  : 'bg-amber-500/10 text-amber-300 border-amber-500/20'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  activeTtsModel?.isInstalled ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'
                }`}
              />
              {activeTtsModel?.isInstalled ? 'Ready & Active' : 'Needs Model'}
            </span>
          </div>
          <div>
            <div className="text-[14px] font-semibold text-slate-100 truncate" title={activeTtsModel?.name}>
              {activeTtsModel?.name || 'OmniVoice 613M'}
            </div>
            <div className="text-xs text-slate-400 font-mono truncate mt-0.5 flex items-center gap-1.5">
              <span>{activeTtsModel?.repoId || 'k2-fsa/OmniVoice'}</span>
              <span className="text-slate-600">·</span>
              <span className="text-slate-300">
                {activeTtsModel?.sizeBytes
                  ? formatBytes(activeTtsModel.sizeBytes)
                  : formatBytes(activeTtsModel?.expectedBytes || 0)}
              </span>
            </div>
          </div>
        </div>

        {/* 2. Active ASR */}
        <div className="rounded-xl border border-obsidian-800 bg-obsidian-900/70 p-4 flex flex-col justify-between gap-3 shadow-sm hover:border-obsidian-700/80 transition-colors">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center flex-shrink-0">
                <Mic className="w-3.5 h-3.5" />
              </div>
              <span className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider">
                Sample Transcription
              </span>
            </div>
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10.5px] font-medium border ${
                activeAsrModel?.isInstalled
                  ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
                  : 'bg-amber-500/10 text-amber-300 border-amber-500/20'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  activeAsrModel?.isInstalled ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'
                }`}
              />
              {activeAsrModel?.isInstalled ? 'Ready & Active' : 'Needs Model'}
            </span>
          </div>
          <div>
            <div className="text-[14px] font-semibold text-slate-100 truncate" title={activeAsrModel?.name}>
              {activeAsrModel?.name || 'Faster-Whisper Large v3 Turbo'}
            </div>
            <div className="text-xs text-slate-400 font-mono truncate mt-0.5 flex items-center gap-1.5">
              <span>{activeAsrModel?.repoId || 'deepdml/faster-whisper-large-v3-turbo-ct2'}</span>
              <span className="text-slate-600">·</span>
              <span className="text-slate-300">
                {activeAsrModel?.sizeBytes
                  ? formatBytes(activeAsrModel.sizeBytes)
                  : formatBytes(activeAsrModel?.expectedBytes || 0)}
              </span>
            </div>
          </div>
        </div>

        {/* 3. Local OCR & Storage */}
        <div className="rounded-xl border border-obsidian-800 bg-obsidian-900/70 p-4 flex flex-col justify-between gap-3 shadow-sm hover:border-obsidian-700/80 transition-colors">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center flex-shrink-0">
                <HardDrive className="w-3.5 h-3.5" />
              </div>
              <span className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider">
                Storage &amp; Local OCR
              </span>
            </div>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10.5px] font-medium bg-slate-800/80 text-slate-300 border border-slate-700/60">
              {catalog.storage?.installedCount || 0} of {catalog.storage?.totalCount || 0} Installed
            </span>
          </div>
          <div>
            <div className="text-[14px] font-semibold text-slate-100 truncate">
              {formatBytes(catalog.storage?.totalInstalledBytes || 0)} on disk
            </div>
            <div className="text-xs text-slate-400 font-mono truncate mt-0.5 flex items-center gap-1.5">
              <span>
                {catalog.storage?.diskFreeBytes ? `${formatBytes(catalog.storage.diskFreeBytes)} free` : ''}
              </span>
              <span className="text-slate-600">·</span>
              <span className="text-slate-300">{ocrInstalledCount}/4 OCR ready</span>
            </div>
          </div>
        </div>
      </div>

      {/* Python Runtime & Cache Directory Info Bar */}
      {catalog.pythonEnv && (
        <div className="rounded-xl border border-obsidian-800/90 bg-obsidian-950/60 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 min-w-0">
            <div className="flex items-center gap-1.5 text-slate-300">
              <Cpu className="w-3.5 h-3.5 text-brand-400 flex-shrink-0" />
              <span className="font-medium text-slate-200">Runtime:</span>
              <code
                className="font-mono text-[11px] text-slate-300 bg-obsidian-900 border border-obsidian-800 px-2 py-0.5 rounded truncate max-w-[240px]"
                title={catalog.pythonEnv.pythonBin}
              >
                {shortenHome(catalog.pythonEnv.pythonBin)}
              </code>
            </div>

            {catalog.pythonEnv.version && (
              <span className="text-slate-400 font-mono text-[11px]">
                Python {catalog.pythonEnv.version}
              </span>
            )}

            {catalog.pythonEnv.mps && (
              <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                Apple MPS GPU
              </span>
            )}

            <div className="h-3 w-px bg-obsidian-800 hidden sm:block" />

            <div className="flex items-center gap-2 text-[11px] text-slate-400">
              {catalog.pythonEnv.packages?.omnivoice && (
                <span className="inline-flex items-center gap-1 text-slate-300">
                  <span className="w-1 h-1 rounded-full bg-brand-400" /> OmniVoice
                </span>
              )}
              {catalog.pythonEnv.packages?.faster_whisper && (
                <span className="inline-flex items-center gap-1 text-slate-300">
                  <span className="w-1 h-1 rounded-full bg-emerald-400" /> Faster-Whisper
                </span>
              )}
              {catalog.pythonEnv.packages?.sherpa_onnx && (
                <span className="inline-flex items-center gap-1 text-slate-300">
                  <span className="w-1 h-1 rounded-full bg-sky-400" /> Sherpa-ONNX
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 text-[11px] text-slate-400 font-mono flex-shrink-0">
            <Folder className="w-3.5 h-3.5 text-slate-500" />
            <span
              className="truncate max-w-[260px] cursor-pointer hover:text-slate-200"
              title={catalog.storage?.cacheDir || ''}
              onClick={() => copyCacheDir(catalog.storage?.cacheDir)}
            >
              {shortenHome(catalog.storage?.cacheDir || '~/.cache/huggingface/hub')}
            </span>
            <button
              type="button"
              onClick={() => copyCacheDir(catalog.storage?.cacheDir)}
              className="text-slate-500 hover:text-slate-200 transition-colors p-1"
              title="Copy cache directory path"
            >
              {copiedCacheDir ? (
                <Check className="w-3 h-3 text-emerald-400" />
              ) : (
                <Copy className="w-3 h-3" />
              )}
            </button>
          </div>
        </div>
      )}

      {/* Alerts / Notices */}
      {error && (
        <div className="flex items-start gap-2.5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-200">
          <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
          <span className="flex-1 leading-relaxed">{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-rose-300 hover:text-white"
            aria-label="Dismiss error"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {notice && (
        <div className="flex items-center gap-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-xs text-emerald-200">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
          <span className="flex-1">{notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="text-emerald-300 hover:text-white"
            aria-label="Dismiss notice"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Filter Tabs + Search + Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        {/* Segmented Task Tabs */}
        <div className="inline-flex items-center p-1 rounded-xl bg-obsidian-950/80 border border-obsidian-800 gap-1 overflow-x-auto max-w-full flex-shrink-0">
          {TASK_TABS.map((tab) => {
            const Icon = tab.icon;
            const active = activeTask === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTask(tab.id)}
                className={`inline-flex items-center gap-1.5 h-7 px-3 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
                  active
                    ? 'bg-obsidian-800 text-white shadow-sm border border-obsidian-700/80'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-obsidian-900/50'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
                <span
                  className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                    active ? 'bg-obsidian-700 text-brand-300' : 'bg-obsidian-900 text-slate-500'
                  }`}
                >
                  {counts[tab.id] ?? 0}
                </span>
              </button>
            );
          })}
        </div>

        {/* Search & Actions Toolbar */}
        <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap justify-start sm:justify-end flex-1 min-w-0">
          {/* Quick filter toggle: installed only */}
          <button
            type="button"
            onClick={() => setOnlyInstalled((v) => !v)}
            className={`inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-xs font-medium transition-colors border flex-shrink-0 whitespace-nowrap ${
              onlyInstalled
                ? 'bg-emerald-500/15 text-emerald-200 border-emerald-500/30'
                : 'bg-obsidian-900/70 text-slate-400 border-obsidian-800 hover:text-slate-200 hover:border-obsidian-700'
            }`}
            title="Filter to installed models only"
          >
            <Check className="w-3 h-3" />
            <span>Installed ({counts.installed})</span>
          </button>

          {/* Search Input */}
          <div className="relative flex-1 sm:w-56 min-w-[150px]">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter models, repos…"
              className="w-full h-8 bg-obsidian-950 border border-obsidian-800 rounded-lg pl-8 pr-7 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30 transition-all"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <Button
            variant="secondary"
            size="sm"
            icon={Plus}
            onClick={() => setShowAddCustom((v) => !v)}
            className="flex-shrink-0 whitespace-nowrap"
          >
            {showAddCustom ? 'Cancel' : 'Add Model'}
          </Button>

          <Button
            variant="ghost"
            size="sm"
            icon={RefreshCw}
            isLoading={refreshing}
            onClick={() => loadCatalog({ refresh: true })}
            title="Re-scan local cache & Python environment"
            className="flex-shrink-0 whitespace-nowrap"
          >
            Rescan
          </Button>

          {compact && onOpenFullHub && (
            <Button
              variant="ghost"
              size="sm"
              icon={ExternalLink}
              onClick={onOpenFullHub}
              className="flex-shrink-0 whitespace-nowrap"
            >
              Full Hub
            </Button>
          )}
        </div>
      </div>

      {/* Add / Register Custom Model Form */}
      {showAddCustom && (
        <form
          onSubmit={handleRegisterCustomModel}
          className="rounded-xl border border-brand-500/30 bg-obsidian-950/90 p-4 space-y-3.5 shadow-lg"
        >
          <div className="flex items-center justify-between border-b border-obsidian-800 pb-3">
            <div>
              <h4 className="text-sm font-semibold text-white">
                Register Custom Hugging Face or Local Model
              </h4>
              <p className="text-xs text-slate-400 mt-0.5">
                Add any compatible model repository from Hugging Face or reference an existing directory on disk.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowAddCustom(false)}
              className="text-slate-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="Display Name">
              <TextInput
                required
                placeholder="e.g. Custom Bangla Whisper"
                value={customForm.name}
                onChange={(e) => setCustomForm((p) => ({ ...p, name: e.target.value }))}
              />
            </Field>
            <Field label="Pipeline Task">
              <SelectInput
                value={customForm.task}
                onChange={(e) => setCustomForm((p) => ({ ...p, task: e.target.value }))}
              >
                <option value="tts">Voice Cloning &amp; TTS</option>
                <option value="asr">Speech-to-Text (ASR)</option>
                <option value="ocr">Local OCR</option>
              </SelectInput>
            </Field>
            <Field label="Languages">
              <TextInput
                placeholder="bn, ar, en"
                value={customForm.languages}
                onChange={(e) => setCustomForm((p) => ({ ...p, languages: e.target.value }))}
              />
            </Field>
            <Field
              label="Hugging Face Repo ID (optional)"
              hint="Format: org/model-name (allows 1-click download)"
            >
              <TextInput
                mono
                placeholder="Systran/faster-whisper-medium"
                value={customForm.repoId}
                onChange={(e) => setCustomForm((p) => ({ ...p, repoId: e.target.value }))}
              />
            </Field>
            <div className="sm:col-span-2">
              <Field
                label="Existing Local Folder Path (optional)"
                hint="Point directly to a model or snapshot directory already on your Mac"
              >
                <TextInput
                  mono
                  placeholder="/Users/.../models/my-weights"
                  value={customForm.customPath}
                  onChange={(e) => setCustomForm((p) => ({ ...p, customPath: e.target.value }))}
                />
              </Field>
            </div>
          </div>

          <Field label="Description (optional)">
            <TextInput
              placeholder="Brief summary of architecture, memory requirements, and strengths…"
              value={customForm.description}
              onChange={(e) => setCustomForm((p) => ({ ...p, description: e.target.value }))}
            />
          </Field>

          <div className="flex justify-end gap-2 pt-1 border-t border-obsidian-800">
            <Button variant="ghost" size="sm" onClick={() => setShowAddCustom(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" type="submit" isLoading={addingCustom}>
              Register Model
            </Button>
          </div>
        </form>
      )}

      {/* Model Cards List */}
      {loading ? (
        <div className="py-16 text-center text-slate-400 text-xs flex flex-col items-center justify-center gap-2">
          <Loader2 className="w-5 h-5 animate-spin text-brand-400" />
          <span>Scanning local model cache and dependencies…</span>
        </div>
      ) : filteredModels.length === 0 ? (
        <div className="py-16 text-center text-slate-400 text-xs rounded-xl border border-dashed border-obsidian-800 bg-obsidian-950/40">
          <p className="font-medium text-slate-300">No models match your current filter.</p>
          <p className="text-[11px] text-slate-500 mt-1">
            Try clearing the search query or switching to another task tab.
          </p>
          {(searchQuery || onlyInstalled) && (
            <div className="mt-3">
              <Button
                variant="secondary"
                size="xs"
                onClick={() => {
                  setSearchQuery('');
                  setOnlyInstalled(false);
                }}
              >
                Reset Filters
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filteredModels.map((model) => {
            const taskInfo = TASK_META[model.task] || TASK_META.tts;
            const TaskIcon = taskInfo.icon;
            const badge = getStatusBadge(model);
            const isEditingRef = editingRefId === model.id;
            const isDownloading = model.status === 'downloading';
            const canActivate =
              model.isInstalled &&
              !model.isActive &&
              (model.task === 'tts' || model.task === 'asr');

            // Dropdown menu items for secondary actions
            const menuItems = [
              {
                label: model.origin === 'referenced' ? 'Edit Linked Path' : 'Reference Custom Path',
                description: 'Point directly to a local weights directory on disk',
                icon: Link2,
                onSelect: () => {
                  setEditingRefId(model.id);
                  setRefInputValue(model.customRefPath || model.resolvedPath || '');
                }
              },
              ...(model.resolvedPath
                ? [
                    {
                      label: copiedPathId === model.id ? 'Path Copied!' : 'Copy Weights Path',
                      description: 'Copy filesystem path to clipboard',
                      icon: copiedPathId === model.id ? Check : Copy,
                      onSelect: () => copyPath(model.id, model.resolvedPath)
                    }
                  ]
                : []),
              ...(model.repoId
                ? [
                    {
                      label: 'View on Hugging Face',
                      description: model.repoId,
                      icon: ExternalLink,
                      onSelect: () => {
                        window.open(`https://huggingface.co/${model.repoId}`, '_blank');
                      }
                    }
                  ]
                : []),
              ...((model.isInstalled || model.status === 'incomplete' || model.isCustom) &&
              !isDownloading &&
              model.sourceType !== 'binary'
                ? [
                    { divider: true },
                    {
                      label: model.origin === 'referenced' ? 'Unlink Custom Path' : 'Delete Weights',
                      description:
                        model.origin === 'referenced'
                          ? 'Removes reference without deleting files'
                          : 'Deletes cached weights from disk',
                      icon: model.origin === 'referenced' ? Unlink : Trash2,
                      danger: true,
                      onSelect: () => setDeleteTarget(model)
                    }
                  ]
                : [])
            ];

            return (
              <div
                key={model.id}
                className={`rounded-xl border transition-all duration-150 p-4 space-y-3 ${
                  model.isActive && (model.task === 'tts' || model.task === 'asr')
                    ? 'border-brand-500/40 bg-gradient-to-b from-brand-950/15 via-obsidian-900/80 to-obsidian-900/95 shadow-sm shadow-brand-500/5'
                    : 'border-obsidian-800 bg-obsidian-900/50 hover:border-obsidian-700/80 hover:bg-obsidian-900/80'
                }`}
              >
                {/* Header Row: Task Icon + Model Info + Action Buttons */}
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    {/* Task Icon Avatar */}
                    <div
                      className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 border ${taskInfo.badgeColor}`}
                    >
                      <TaskIcon className="w-4 h-4" />
                    </div>

                    {/* Title + Status Badges + Description */}
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-[14.5px] font-semibold text-slate-100">
                          {model.name}
                        </h3>

                        {/* Status Tag */}
                        {model.isActive && (model.task === 'tts' || model.task === 'asr') ? (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10.5px] font-semibold bg-brand-500/15 text-brand-300 border border-brand-500/30">
                            <span className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-pulse" />
                            Active Engine
                          </span>
                        ) : (
                          <Tag tone={badge.tone} size="xs" dot={badge.dot}>
                            {badge.label}
                          </Tag>
                        )}

                        {/* Feature Badges (Subtle, max 2) */}
                        {model.supportsCloning && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
                            Zero-Shot Clone
                          </span>
                        )}
                        {model.recommended && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                            Recommended
                          </span>
                        )}
                      </div>

                      <p className="text-xs text-slate-400 leading-relaxed max-w-3xl">
                        {model.description}
                      </p>
                    </div>
                  </div>

                  {/* Actions Suite */}
                  <div className="flex items-center gap-1.5 self-end sm:self-start flex-shrink-0">
                    {canActivate && (
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={Sparkles}
                        isLoading={busyModelId === model.id}
                        onClick={() => handleActivateModel(model)}
                        title={`Use ${model.name} as the active ${model.task.toUpperCase()} engine`}
                      >
                        Set Active
                      </Button>
                    )}

                    {model.isActive && (model.task === 'tts' || model.task === 'asr') && (
                      <span className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg text-xs font-medium text-brand-300 bg-brand-500/10 border border-brand-500/20">
                        <Check className="w-3.5 h-3.5 text-brand-400" />
                        <span>Active</span>
                      </span>
                    )}

                    {isDownloading ? (
                      <Button
                        variant="danger"
                        size="sm"
                        icon={X}
                        isLoading={busyModelId === model.id}
                        onClick={() => handleCancelDownload(model.id)}
                      >
                        Cancel
                      </Button>
                    ) : (
                      !model.isInstalled && (
                        <Button
                          variant="primary"
                          size="sm"
                          icon={Download}
                          isLoading={busyModelId === model.id}
                          onClick={() => handleDownload(model)}
                        >
                          {model.status === 'incomplete'
                            ? 'Resume'
                            : model.sourceType === 'binary'
                              ? 'Build'
                              : 'Download'}
                        </Button>
                      )
                    )}

                    {/* Secondary Actions Dropdown */}
                    <DropdownMenu
                      icon={MoreVertical}
                      showChevron={false}
                      size="icon-sm"
                      variant="ghost"
                      title="More actions"
                      items={menuItems}
                    />
                  </div>
                </div>

                {/* Specs & Metadata Strip */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-1 text-xs text-slate-400 border-t border-obsidian-800/80">
                  {model.repoId && (
                    <a
                      href={`https://huggingface.co/${model.repoId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-slate-300 hover:text-brand-300 transition-colors font-mono text-[11px]"
                    >
                      <FolderGit2 className="w-3.5 h-3.5 text-brand-400" />
                      <span>{model.repoId}</span>
                      <ExternalLink className="w-2.5 h-2.5 opacity-60" />
                    </a>
                  )}

                  <div className="flex items-center gap-1 font-mono text-[11px]">
                    <HardDrive className="w-3.5 h-3.5 text-slate-500" />
                    <span>
                      Size:{' '}
                      <strong className="text-slate-200 font-semibold">
                        {model.sizeBytes > 0
                          ? formatBytes(model.sizeBytes)
                          : model.expectedBytes > 0
                            ? `~${formatBytes(model.expectedBytes)}`
                            : 'Custom'}
                      </strong>
                    </span>
                  </div>

                  {model.ramRequirement && (
                    <div className="flex items-center gap-1 font-mono text-[11px]">
                      <Cpu className="w-3.5 h-3.5 text-slate-500" />
                      <span>RAM: {model.ramRequirement}</span>
                    </div>
                  )}

                  {model.languages?.length > 0 && (
                    <div className="flex items-center gap-1 text-[11px]">
                      <Globe className="w-3.5 h-3.5 text-slate-500" />
                      <span>{model.languages.join(', ')}</span>
                    </div>
                  )}

                  {model.license && (
                    <div className="flex items-center gap-1 text-[11px] text-slate-500">
                      <Scale className="w-3.5 h-3.5 text-slate-500" />
                      <span>{model.license}</span>
                    </div>
                  )}
                </div>

                {/* Downloading Progress Bar */}
                {isDownloading && (
                  <div className="rounded-lg bg-obsidian-950/80 border border-obsidian-800 p-3 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-300 flex items-center gap-1.5 font-medium">
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" />
                        {model.download?.currentFile || 'Downloading model files…'}
                      </span>
                      <span className="font-mono text-amber-300 font-semibold">
                        {model.download?.percent || 0}%
                      </span>
                    </div>
                    <ProgressBar
                      value={model.download?.percent || 0}
                      color="amber"
                      size="sm"
                    />
                    <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
                      <span>
                        {model.download?.downloadedBytes
                          ? `${formatBytes(model.download.downloadedBytes)} / ${formatBytes(
                              model.download?.totalBytes || model.expectedBytes || 0
                            )}`
                          : 'Starting transfer…'}
                      </span>
                      {model.download?.speedBps > 0 && (
                        <span>{formatBytes(model.download.speedBps)}/s</span>
                      )}
                    </div>
                  </div>
                )}

                {/* Resolved Local Path Footer */}
                {model.resolvedPath && !isEditingRef && (
                  <div className="flex items-center justify-between gap-2 rounded-lg bg-obsidian-950/60 border border-obsidian-800/80 px-3 py-1.5 text-[11px] font-mono text-slate-400">
                    <div className="truncate flex items-center gap-2 min-w-0" title={model.resolvedPath}>
                      <Folder className="w-3 h-3 text-slate-500 flex-shrink-0" />
                      <span className="text-slate-500 text-[10px] uppercase font-sans font-semibold flex-shrink-0">
                        {model.origin === 'referenced' ? 'Custom Path:' : 'Local Path:'}
                      </span>
                      <span className="text-slate-300 truncate">
                        {shortenHome(model.resolvedPath)}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => copyPath(model.id, model.resolvedPath)}
                      className="inline-flex items-center gap-1 text-[10.5px] text-slate-400 hover:text-white transition-colors flex-shrink-0 px-1.5 py-0.5 rounded hover:bg-obsidian-800"
                      title="Copy full path"
                    >
                      {copiedPathId === model.id ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-400" />
                          <span className="text-emerald-400">Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          <span>Copy</span>
                        </>
                      )}
                    </button>
                  </div>
                )}

                {/* Inline Reference Path Editor Drawer */}
                {isEditingRef && (
                  <div className="rounded-lg bg-obsidian-950 border border-brand-500/30 p-3 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                        <Link2 className="w-3.5 h-3.5 text-brand-400" />
                        Link Local Weights Directory
                      </span>
                      <button
                        type="button"
                        onClick={() => setEditingRefId(null)}
                        className="text-slate-500 hover:text-white"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      Point directly to an existing snapshot directory on disk. If left blank, resets to default Hugging Face cache.
                    </p>
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                      <div className="flex-1">
                        <TextInput
                          mono
                          placeholder="/path/to/weights/snapshot"
                          value={refInputValue}
                          onChange={(e) => setRefInputValue(e.target.value)}
                        />
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Button
                          variant="primary"
                          size="sm"
                          icon={Check}
                          isLoading={savingRefId === model.id}
                          onClick={() => handleSaveReference(model.id, refInputValue)}
                        >
                          Link Path
                        </Button>
                        {model.customRefPath && (
                          <Button
                            variant="secondary"
                            size="sm"
                            isLoading={savingRefId === model.id}
                            onClick={() => handleSaveReference(model.id, '')}
                          >
                            Reset Cache
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditingRefId(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Delete / Unlink Confirmation Modal */}
      <ConfirmModal
        isOpen={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
        isLoading={isDeleting}
        title={
          deleteTarget?.origin === 'referenced'
            ? `Unlink "${deleteTarget?.name}"?`
            : `Delete "${deleteTarget?.name}" Weights?`
        }
        message={
          deleteTarget?.origin === 'referenced'
            ? `This removes the custom path reference (${shortenHome(
                deleteTarget?.customRefPath || ''
              )}) from PDF Reader without deleting the external files on disk.`
            : `This permanently deletes the downloaded weights (${formatBytes(
                deleteTarget?.sizeBytes || 0
              )}) from your local cache. You can re-download them anytime.`
        }
        confirmText={deleteTarget?.origin === 'referenced' ? 'Unlink Path' : 'Delete Weights'}
        variant="danger"
      />
    </div>
  );
}

/**
 * Full-page `/models` route wrapper.
 */
export function ModelHub({ onBack, onOpenSettings, onOpenVoices, onOpenUsage, onSettingsChanged }) {
  return (
    <div className="min-h-screen bg-obsidian-950 text-slate-100 flex flex-col">
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
            <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-400 to-indigo-500 flex items-center justify-center shadow-lg shadow-brand-500/20 flex-shrink-0">
              <Boxes className="w-4 h-4 text-obsidian-950" />
            </span>
            <div className="min-w-0">
              <p className="text-[13.5px] font-semibold text-white leading-tight truncate">
                Local AI Model Hub
              </p>
              <p className="text-[11px] text-slate-400 leading-tight truncate hidden sm:block">
                Zero-shot voice cloning, TTS, speech transcription (ASR), and local OCR
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {onOpenVoices && (
              <Button variant="ghost" size="sm" icon={Mic} onClick={onOpenVoices}>
                <span className="hidden sm:inline">Voice Studio</span>
              </Button>
            )}
            {onOpenUsage && (
              <Button variant="ghost" size="sm" icon={Activity} onClick={onOpenUsage}>
                <span className="hidden sm:inline">API Usage</span>
              </Button>
            )}
            {onOpenSettings && (
              <Button variant="secondary" size="sm" icon={SettingsIcon} onClick={onOpenSettings}>
                <span className="hidden sm:inline">Settings</span>
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-6">
        <ModelManagerView onSettingsChanged={onSettingsChanged} />
      </main>
    </div>
  );
}
