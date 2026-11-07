import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { queries } from './db.js';

const execFileAsync = promisify(execFile);

const PROJECT_ROOT = process.cwd();
const BIN_DIR = path.resolve(PROJECT_ROOT, 'bin');
const TESSDATA_DIR = path.join(BIN_DIR, 'tessdata');
const DOWNLOADER_SCRIPT = path.join(BIN_DIR, 'model_downloader.py');
const DEFAULT_HF_CACHE = path.join(os.homedir(), '.cache', 'huggingface', 'hub');

export const CATALOG_MODELS = [
  // ==========================================
  // 1. Voice Cloning & TTS
  // ==========================================
  {
    id: 'omnivoice',
    name: 'OmniVoice 613M (Zero-Shot Voice Cloning)',
    task: 'tts',
    subtask: 'Zero-Shot Voice Cloning & Multilingual TTS',
    sourceType: 'huggingface',
    repoId: 'k2-fsa/OmniVoice',
    engine: 'omnivoice',
    languages: ['bn', 'ar', 'en', '600+ langs'],
    expectedBytes: 3050000000, // ~3.0 GB
    ramRequirement: '~1.6 GB MPS/CPU (2-stage split)',
    license: 'Apache-2.0 / CC-BY-NC-4.0',
    supportsCloning: true,
    recommended: true,
    description:
      'Primary zero-shot voice cloning & narration engine. Clones any 5–15s reference voice across Bengali (বাংলা), Arabic (العربية), and English with 2-stage low-memory MPS/CPU execution.',
    requiredFiles: ['model.safetensors', 'config.json', 'tokenizer.json', 'audio_tokenizer']
  },
  {
    id: 'mms-tts-ben',
    name: 'Meta MMS-TTS Bengali (বাংলা)',
    task: 'tts',
    subtask: 'Lightweight Offline TTS (Bengali)',
    sourceType: 'huggingface',
    repoId: 'facebook/mms-tts-ben',
    engine: 'mms-tts',
    languages: ['bn'],
    expectedBytes: 145000000, // ~145 MB
    ramRequirement: '~150 MB CPU',
    license: 'CC-BY-NC-4.0',
    supportsCloning: false,
    recommended: false,
    description:
      'Compact VITS neural synthesizer from Meta AI for pure offline Bengali narration with minimal RAM overhead on 8 GB systems.',
    requiredFiles: ['config.json', 'model.safetensors|pytorch_model.bin', 'tokenizer_config.json|vocab.json']
  },
  {
    id: 'mms-tts-ara',
    name: 'Meta MMS-TTS Arabic (العربية)',
    task: 'tts',
    subtask: 'Lightweight Offline TTS (Arabic)',
    sourceType: 'huggingface',
    repoId: 'facebook/mms-tts-ara',
    engine: 'mms-tts',
    languages: ['ar'],
    expectedBytes: 145000000,
    ramRequirement: '~150 MB CPU',
    license: 'CC-BY-NC-4.0',
    supportsCloning: false,
    recommended: false,
    description:
      'Compact VITS neural synthesizer from Meta AI for pure offline Arabic narration and citations.',
    requiredFiles: ['config.json', 'model.safetensors|pytorch_model.bin', 'tokenizer_config.json|vocab.json']
  },
  {
    id: 'mms-tts-eng',
    name: 'Meta MMS-TTS English',
    task: 'tts',
    subtask: 'Lightweight Offline TTS (English)',
    sourceType: 'huggingface',
    repoId: 'facebook/mms-tts-eng',
    engine: 'mms-tts',
    languages: ['en'],
    expectedBytes: 145000000,
    ramRequirement: '~150 MB CPU',
    license: 'CC-BY-NC-4.0',
    supportsCloning: false,
    recommended: false,
    description:
      'Compact VITS neural synthesizer from Meta AI for fast, low-memory offline English book narration.',
    requiredFiles: ['config.json', 'model.safetensors|pytorch_model.bin', 'tokenizer_config.json|vocab.json']
  },

  // ==========================================
  // 2. Speech-to-Text / Voice Sample ASR
  // ==========================================
  {
    id: 'faster-whisper-large-v3-turbo',
    name: 'Faster-Whisper Large v3 Turbo (CT2)',
    task: 'asr',
    subtask: 'Multilingual Reference Voice Transcription',
    sourceType: 'huggingface',
    repoId: 'deepdml/faster-whisper-large-v3-turbo-ct2',
    engine: 'faster-whisper',
    languages: ['bn', 'ar', 'en', '99 langs'],
    expectedBytes: 1620000000, // ~1.5 GB
    ramRequirement: '~900 MB CPU int8',
    license: 'MIT',
    recommended: true,
    description:
      'High-accuracy CTranslate2 Whisper Large-v3-Turbo model. Automatically transcribes uploaded Bengali, Arabic, and English voice samples in Voice Studio so OmniVoice prompts align cleanly.',
    requiredFiles: ['model.bin', 'config.json', 'tokenizer.json', 'vocabulary.json|vocabulary.txt']
  },
  {
    id: 'faster-whisper-small',
    name: 'Faster-Whisper Small (CT2)',
    task: 'asr',
    subtask: 'Compact Multilingual Voice Transcription',
    sourceType: 'huggingface',
    repoId: 'Systran/faster-whisper-small',
    engine: 'faster-whisper',
    languages: ['bn', 'ar', 'en', '99 langs'],
    expectedBytes: 484000000, // ~484 MB
    ramRequirement: '~350 MB CPU int8',
    license: 'MIT',
    recommended: false,
    description:
      'Lightweight 244M CTranslate2 Whisper model for machines with limited disk space while retaining solid multilingual transcription.',
    requiredFiles: ['model.bin', 'config.json', 'tokenizer.json', 'vocabulary.txt|vocabulary.json']
  },
  {
    id: 'sherpa-onnx-whisper-tiny',
    name: 'Sherpa-ONNX Whisper Tiny (int8)',
    task: 'asr',
    subtask: 'Ultra-Low Memory ONNX Transcription',
    sourceType: 'huggingface',
    repoId: 'csukuangfj/sherpa-onnx-whisper-tiny',
    engine: 'sherpa-onnx-whisper',
    languages: ['en', 'ar', 'bn', 'multilingual'],
    expectedBytes: 256000000, // ~245 MB
    ramRequirement: '~120 MB CPU ONNX',
    license: 'MIT',
    recommended: false,
    description:
      '39M ONNX int8 Whisper Tiny model for rapid, minimal-memory voice sample transcription on CPU.',
    requiredFiles: ['tiny-encoder.int8.onnx', 'tiny-decoder.int8.onnx', 'tiny-tokens.txt']
  },
  {
    id: 'sherpa-onnx-parakeet-0.6b',
    name: 'NVIDIA Parakeet TDT 0.6B v3 (Sherpa-ONNX int8)',
    task: 'asr',
    subtask: 'Fast CPU English & European ASR',
    sourceType: 'huggingface',
    repoId: 'csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8',
    engine: 'sherpa-onnx-transducer',
    languages: ['en', '25 EU langs'],
    expectedBytes: 671000000, // ~640 MB
    ramRequirement: '~450 MB CPU ONNX int8',
    license: 'CC-BY-4.0',
    recommended: false,
    description:
      'NVIDIA NeMo Parakeet 0.6B transducer quantized to int8 ONNX for ultra-low-latency English and European voice sample transcription.',
    requiredFiles: ['encoder.int8.onnx', 'decoder.int8.onnx', 'joiner.int8.onnx', 'tokens.txt']
  },

  // ==========================================
  // 3. Local OCR & Document Extraction
  // ==========================================
  {
    id: 'tesseract-ben',
    name: 'Tesseract Bengali OCR (ben.traineddata)',
    task: 'ocr',
    subtask: 'Local Scanned Bengali Page OCR',
    sourceType: 'tessdata',
    fileName: 'ben.traineddata',
    downloadUrl: 'https://github.com/tesseract-ocr/tessdata_fast/raw/main/ben.traineddata',
    engine: 'tesseract',
    languages: ['bn'],
    expectedBytes: 856190,
    ramRequirement: '~60 MB CPU',
    license: 'Apache-2.0',
    recommended: true,
    description:
      'LSTM traineddata weights for local offline Bengali OCR via Tesseract when PDF pages are scanned images.',
    requiredFiles: ['ben.traineddata']
  },
  {
    id: 'tesseract-ara',
    name: 'Tesseract Arabic OCR (ara.traineddata)',
    task: 'ocr',
    subtask: 'Local Scanned Arabic Page OCR',
    sourceType: 'tessdata',
    fileName: 'ara.traineddata',
    downloadUrl: 'https://github.com/tesseract-ocr/tessdata_fast/raw/main/ara.traineddata',
    engine: 'tesseract',
    languages: ['ar'],
    expectedBytes: 1441566,
    ramRequirement: '~60 MB CPU',
    license: 'Apache-2.0',
    recommended: true,
    description:
      'LSTM traineddata weights for local offline Arabic / Quran / Hadith script extraction via Tesseract.',
    requiredFiles: ['ara.traineddata']
  },
  {
    id: 'tesseract-eng',
    name: 'Tesseract English OCR (eng.traineddata)',
    task: 'ocr',
    subtask: 'Local Scanned English Page OCR',
    sourceType: 'tessdata',
    fileName: 'eng.traineddata',
    downloadUrl: 'https://github.com/tesseract-ocr/tessdata_fast/raw/main/eng.traineddata',
    engine: 'tesseract',
    languages: ['en'],
    expectedBytes: 4113088,
    ramRequirement: '~60 MB CPU',
    license: 'Apache-2.0',
    recommended: true,
    description:
      'LSTM traineddata weights for local offline English and Latin script extraction via Tesseract.',
    requiredFiles: ['eng.traineddata']
  },
  {
    id: 'apple-vision-ocr',
    name: 'Apple Vision Neural Engine OCR (macos_ocr)',
    task: 'ocr',
    subtask: 'Native macOS Hardware-Accelerated OCR',
    sourceType: 'binary',
    fileName: 'macos_ocr',
    sourceScript: 'macos_ocr.swift',
    engine: 'apple-vision',
    languages: ['en', 'ar', 'latin'],
    expectedBytes: 165000,
    ramRequirement: '~40 MB Neural Engine',
    license: 'macOS Native',
    recommended: true,
    description:
      'Compiled Swift binary invoking Apple Vision framework on the M-series Neural Engine for fast Latin & Arabic page recognition.',
    requiredFiles: ['macos_ocr']
  }
];

function expandHome(p) {
  if (!p || typeof p !== 'string') return '';
  const trimmed = p.trim();
  if (trimmed === '~') return os.homedir();
  if (trimmed.startsWith('~/')) return path.join(os.homedir(), trimmed.slice(2));
  return path.resolve(trimmed);
}

function safeJsonParse(raw, fallback) {
  try {
    const parsed = JSON.parse(raw || '');
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Compute real disk bytes inside a directory or file (follows blobs without double-counting).
 */
function computeDiskSize(targetPath) {
  try {
    if (!fs.existsSync(targetPath)) return 0;
    const st = fs.lstatSync(targetPath);
    if (st.isFile()) return st.size;
    if (st.isSymbolicLink()) {
      const real = fs.statSync(targetPath);
      return real.size;
    }
    if (!st.isDirectory()) return 0;

    // If this is a snapshot dir inside an HF repo (`.../models--X/snapshots/<sha>`),
    // measure the `blobs` directory of the parent repo if present, else sum resolved files.
    const parentDir = path.dirname(targetPath);
    if (path.basename(parentDir) === 'snapshots') {
      const blobsDir = path.join(path.dirname(parentDir), 'blobs');
      if (fs.existsSync(blobsDir)) {
        return sumDirectoryBytes(blobsDir, new Set());
      }
    }
    return sumDirectoryBytes(targetPath, new Set());
  } catch {
    return 0;
  }
}

function sumDirectoryBytes(dir, seenInodes) {
  let total = 0;
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (entry.name === '.' || entry.name === '..' || entry.name === '.DS_Store') continue;
    const full = path.join(dir, entry.name);
    try {
      const stat = fs.statSync(full); // follows symlinks
      if (stat.isDirectory()) {
        total += sumDirectoryBytes(full, seenInodes);
      } else if (stat.isFile()) {
        const key = `${stat.dev}:${stat.ino}`;
        if (!seenInodes.has(key)) {
          seenInodes.add(key);
          total += stat.size;
        }
      }
    } catch {
      // broken symlink or permission issue
    }
  }
  return total;
}

/**
 * Given an outer HF repo folder (`models--org--repo`) or direct model folder,
 * return the concrete snapshot directory containing the weights.
 */
function resolveSnapshotDir(dirPath) {
  if (!dirPath || !fs.existsSync(dirPath)) return null;
  try {
    const stat = fs.statSync(dirPath);
    if (!stat.isDirectory()) return dirPath;
  } catch {
    return null;
  }

  const snapshotsDir = path.join(dirPath, 'snapshots');
  if (fs.existsSync(snapshotsDir)) {
    const refsMain = path.join(dirPath, 'refs', 'main');
    if (fs.existsSync(refsMain)) {
      try {
        const refSha = fs.readFileSync(refsMain, 'utf8').trim();
        const refCandidate = path.join(snapshotsDir, refSha);
        if (refSha && fs.existsSync(refCandidate)) return refCandidate;
      } catch {}
    }
    try {
      const snaps = fs
        .readdirSync(snapshotsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
        .map((d) => {
          const full = path.join(snapshotsDir, d.name);
          const mtime = fs.statSync(full).mtimeMs;
          return { full, mtime };
        })
        .sort((a, b) => b.mtime - a.mtime);
      if (snaps.length > 0) return snaps[0].full;
    } catch {}
  }

  return dirPath;
}

/**
 * Verify all required files exist inside `dirOrFilePath`.
 * Supports OR patterns like `'model.safetensors|pytorch_model.bin'`.
 */
function checkRequiredFiles(dirOrFilePath, requiredFiles = []) {
  if (!dirOrFilePath || !fs.existsSync(dirOrFilePath)) {
    return { valid: false, missing: requiredFiles };
  }

  let isFile = false;
  try {
    isFile = fs.statSync(dirOrFilePath).isFile();
  } catch {
    return { valid: false, missing: requiredFiles };
  }

  if (isFile) {
    return { valid: true, missing: [] };
  }

  if (!requiredFiles || requiredFiles.length === 0) {
    try {
      const entries = fs.readdirSync(dirOrFilePath).filter((n) => !n.startsWith('.'));
      return { valid: entries.length > 0, missing: entries.length > 0 ? [] : ['<model files>'] };
    } catch {
      return { valid: false, missing: ['<model files>'] };
    }
  }

  const missing = [];
  for (const spec of requiredFiles) {
    const alternatives = spec.split('|').map((s) => s.trim()).filter(Boolean);
    const anyPresent = alternatives.some((rel) => {
      const candidate = path.join(dirOrFilePath, rel);
      try {
        // fs.statSync follows symlinks and throws if target blob is missing
        const st = fs.statSync(candidate);
        return st.isDirectory() || st.size > 0;
      } catch {
        return false;
      }
    });
    if (!anyPresent) missing.push(spec);
  }

  return { valid: missing.length === 0, missing };
}

class ModelManager {
  constructor() {
    this.activeDownloads = new Map(); // modelId -> { proc, progress, abort }
    this.listeners = new Set();
    this.cachedPythonEnv = null;
  }

  subscribe(fn) {
    if (typeof fn === 'function') this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  broadcast(event) {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {}
    }
  }

  getSettings() {
    return queries.getSettings();
  }

  resolveCacheDir(settings = this.getSettings()) {
    const custom = expandHome(settings.models_cache_dir);
    if (custom) return custom;
    if (process.env.HUGGINGFACE_HUB_CACHE) return expandHome(process.env.HUGGINGFACE_HUB_CACHE);
    if (process.env.HF_HOME) return path.join(expandHome(process.env.HF_HOME), 'hub');
    return DEFAULT_HF_CACHE;
  }

  resolvePythonBin(settings = this.getSettings()) {
    const explicit = expandHome(settings.python_bin);
    if (explicit && fs.existsSync(explicit)) return explicit;

    const candidates = [
      path.resolve(PROJECT_ROOT, '.venv', 'bin', 'python'),
      path.resolve(PROJECT_ROOT, '..', 'voicestudio', '.venv', 'bin', 'python'),
      '/opt/homebrew/bin/python3',
      '/usr/local/bin/python3',
      '/usr/bin/python3'
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate;
    }
    return 'python3';
  }

  getModelRefs(settings = this.getSettings()) {
    return safeJsonParse(settings.model_refs_json, {});
  }

  getCustomModels(settings = this.getSettings()) {
    const arr = safeJsonParse(settings.custom_models_json, []);
    return Array.isArray(arr) ? arr : [];
  }

  getAllCatalogModels(settings = this.getSettings()) {
    const custom = this.getCustomModels(settings).map((m) => ({
      ...m,
      isCustom: true,
      sourceType: m.sourceType || (m.repoId ? 'huggingface' : 'local'),
      requiredFiles: m.requiredFiles || []
    }));
    return [...CATALOG_MODELS, ...custom];
  }

  getModelDefinition(modelId, settings = this.getSettings()) {
    return this.getAllCatalogModels(settings).find((m) => m.id === modelId) || null;
  }

  /**
   * Inspect a single model's installation state, disk size, and active status.
   */
  inspectModel(model, settings = this.getSettings()) {
    const refs = this.getModelRefs(settings);
    const cacheDir = this.resolveCacheDir(settings);
    const customRef = expandHome(refs[model.id] || model.customPath || '');
    const dlState = this.activeDownloads.get(model.id) || null;

    let resolvedPath = null;
    let origin = null; // 'referenced' | 'hf_cache' | 'bundled' | null
    let status = 'not_installed'; // 'installed' | 'referenced' | 'downloading' | 'incomplete' | 'not_installed' | 'error'
    let sizeBytes = 0;
    let missingFiles = [];
    let hasIncompleteBlobs = false;

    // 1. Check custom referenced path first
    if (customRef) {
      const snap = resolveSnapshotDir(customRef);
      const check = checkRequiredFiles(snap, model.requiredFiles);
      if (snap && check.valid) {
        resolvedPath = snap;
        origin = 'referenced';
        status = 'referenced';
        sizeBytes = computeDiskSize(snap);
      } else {
        resolvedPath = customRef;
        origin = 'referenced';
        status = 'incomplete';
        missingFiles = check.missing;
      }
    }

    // 2. Otherwise inspect standard cache / local location
    if (!resolvedPath || status === 'not_installed') {
      if (model.sourceType === 'huggingface' && model.repoId) {
        const repoFolder = `models--${model.repoId.replace(/\//g, '--')}`;
        const repoRoot = path.join(cacheDir, repoFolder);
        const blobsDir = path.join(repoRoot, 'blobs');

        if (fs.existsSync(blobsDir)) {
          try {
            hasIncompleteBlobs = fs.readdirSync(blobsDir).some((n) => n.endsWith('.incomplete'));
          } catch {}
        }

        const snap = resolveSnapshotDir(repoRoot);
        if (snap && snap !== repoRoot && fs.existsSync(snap)) {
          const check = checkRequiredFiles(snap, model.requiredFiles);
          sizeBytes = computeDiskSize(repoRoot);
          if (check.valid && !hasIncompleteBlobs) {
            resolvedPath = snap;
            origin = 'hf_cache';
            status = 'installed';
          } else {
            resolvedPath = snap;
            origin = 'hf_cache';
            status = 'incomplete';
            missingFiles = check.missing;
          }
        } else if (hasIncompleteBlobs) {
          sizeBytes = computeDiskSize(repoRoot);
          origin = 'hf_cache';
          status = 'incomplete';
        }
      } else if (model.sourceType === 'tessdata') {
        const target = path.join(TESSDATA_DIR, model.fileName);
        if (fs.existsSync(target)) {
          const st = fs.statSync(target);
          sizeBytes = st.size;
          if (st.size > 10000) {
            resolvedPath = target;
            origin = 'bundled';
            status = 'installed';
          } else {
            status = 'incomplete';
          }
        }
      } else if (model.sourceType === 'binary') {
        const target = path.join(BIN_DIR, model.fileName);
        if (fs.existsSync(target)) {
          const st = fs.statSync(target);
          sizeBytes = st.size;
          resolvedPath = target;
          origin = 'bundled';
          status = 'installed';
        }
      }
    }

    // 3. Overlay live download state if downloading right now
    let download = null;
    if (dlState) {
      status = 'downloading';
      download = { ...dlState.progress };
      if (download.downloadedBytes > sizeBytes) {
        sizeBytes = download.downloadedBytes;
      }
    }

    const activeTts = settings.tts_active_model || 'omnivoice';
    const activeAsr = settings.asr_active_model || 'faster-whisper-large-v3-turbo';
    const isActive =
      (model.task === 'tts' && activeTts === model.id) ||
      (model.task === 'asr' && activeAsr === model.id) ||
      (model.task === 'ocr' && (status === 'installed' || status === 'referenced'));

    return {
      ...model,
      status,
      origin,
      isInstalled: status === 'installed' || status === 'referenced',
      isActive,
      resolvedPath,
      customRefPath: customRef || null,
      sizeBytes,
      missingFiles,
      hasIncompleteBlobs,
      download
    };
  }

  /**
   * Resolve concrete filesystem path for a model id (used by TTS, ASR, OCR).
   */
  resolveModelPath(modelId, settings = this.getSettings()) {
    const def = this.getModelDefinition(modelId, settings);
    if (!def) return null;
    const info = this.inspectModel(def, settings);
    return info.isInstalled ? info.resolvedPath : null;
  }

  /**
   * Return the active ASR model info (falling back to any installed ASR model if active isn't installed).
   */
  getActiveAsrModel(settings = this.getSettings()) {
    const wantedId = settings.asr_active_model || 'faster-whisper-large-v3-turbo';
    const allAsr = this.getAllCatalogModels(settings)
      .filter((m) => m.task === 'asr')
      .map((m) => this.inspectModel(m, settings));

    const wanted = allAsr.find((m) => m.id === wantedId && m.isInstalled);
    if (wanted) return wanted;
    return allAsr.find((m) => m.isInstalled) || allAsr[0] || null;
  }

  /**
   * Return the active TTS model info.
   */
  getActiveTtsModel(settings = this.getSettings()) {
    const wantedId = settings.tts_active_model || 'omnivoice';
    const allTts = this.getAllCatalogModels(settings)
      .filter((m) => m.task === 'tts')
      .map((m) => this.inspectModel(m, settings));

    const wanted = allTts.find((m) => m.id === wantedId && m.isInstalled);
    if (wanted) return wanted;
    return allTts.find((m) => m.isInstalled) || allTts[0] || null;
  }

  /**
   * Inspect Python runtime capabilities (cached briefly for speed).
   */
  async inspectPythonEnv(force = false) {
    const settings = this.getSettings();
    const pythonBin = this.resolvePythonBin(settings);
    if (!force && this.cachedPythonEnv && this.cachedPythonEnv.pythonBin === pythonBin) {
      return this.cachedPythonEnv;
    }

    const snippet = [
      'import json, sys',
      'out = {"version": sys.version.split()[0], "executable": sys.executable, "packages": {}}',
      'for pkg in ["torch", "omnivoice", "faster_whisper", "sherpa_onnx", "transformers", "huggingface_hub"]:',
      '    try:',
      '        m = __import__(pkg)',
      '        out["packages"][pkg] = getattr(m, "__version__", True)',
      '    except Exception:',
      '        out["packages"][pkg] = False',
      'try:',
      '    import torch',
      '    out["mps"] = bool(torch.backends.mps.is_available())',
      'except Exception:',
      '    out["mps"] = False',
      'print(json.dumps(out))'
    ].join('\n');

    try {
      const { stdout } = await execFileAsync(pythonBin, ['-c', snippet], { timeout: 15000 });
      const parsed = JSON.parse(stdout.trim());
      this.cachedPythonEnv = {
        ok: true,
        pythonBin,
        ...parsed
      };
    } catch (err) {
      this.cachedPythonEnv = {
        ok: false,
        pythonBin,
        error: err.message,
        packages: {}
      };
    }
    return this.cachedPythonEnv;
  }

  /**
   * Return full model inventory, storage stats, and active selections.
   */
  async getCatalogStatus({ refreshPython = false } = {}) {
    const settings = this.getSettings();
    const cacheDir = this.resolveCacheDir(settings);
    const models = this.getAllCatalogModels(settings).map((m) => this.inspectModel(m, settings));

    // Disk free space on cache volume
    let diskFreeBytes = null;
    let diskTotalBytes = null;
    try {
      const probeDir = fs.existsSync(cacheDir) ? cacheDir : os.homedir();
      const st = fs.statfsSync(probeDir);
      diskFreeBytes = st.bavail * st.bsize;
      diskTotalBytes = st.blocks * st.bsize;
    } catch {}

    // Deduplicate installed bytes across shared HF cache repos
    const totalInstalledBytes = models.reduce((sum, m) => sum + (m.isInstalled ? m.sizeBytes : 0), 0);
    const installedCount = models.filter((m) => m.isInstalled).length;
    const downloadingCount = models.filter((m) => m.status === 'downloading').length;

    const pythonEnv = await this.inspectPythonEnv(refreshPython);

    return {
      models,
      activeModels: {
        tts: settings.tts_active_model || 'omnivoice',
        asr: settings.asr_active_model || 'faster-whisper-large-v3-turbo',
        ocrTier: settings.ocr_tier || 'mac_first'
      },
      storage: {
        cacheDir,
        defaultCacheDir: DEFAULT_HF_CACHE,
        isCustomCacheDir: Boolean(settings.models_cache_dir && settings.models_cache_dir.trim()),
        hasHfToken: Boolean(settings.hf_token && settings.hf_token.trim()),
        totalInstalledBytes,
        diskFreeBytes,
        diskTotalBytes,
        installedCount,
        downloadingCount,
        totalCount: models.length
      },
      pythonEnv
    };
  }

  /**
   * Link / reference a local directory or file for a model (or pass empty string to clear).
   */
  setReferencePath(modelId, rawPath) {
    const settings = this.getSettings();
    const model = this.getModelDefinition(modelId, settings);
    if (!model) {
      throw new Error(`Unknown model "${modelId}"`);
    }

    const refs = this.getModelRefs(settings);
    const cleaned = (rawPath || '').trim();

    if (!cleaned) {
      delete refs[modelId];
      queries.updateSetting('model_refs_json', JSON.stringify(refs));
      return this.inspectModel(model, this.getSettings());
    }

    const expanded = expandHome(cleaned);
    if (!fs.existsSync(expanded)) {
      throw new Error(`Path does not exist on disk: ${expanded}`);
    }

    const snap = resolveSnapshotDir(expanded);
    const check = checkRequiredFiles(snap, model.requiredFiles);
    if (!check.valid) {
      throw new Error(
        `The folder "${expanded}" is missing required files for ${model.name}: ${check.missing.join(', ')}`
      );
    }

    refs[modelId] = expanded;
    queries.updateSetting('model_refs_json', JSON.stringify(refs));
    return this.inspectModel(model, this.getSettings());
  }

  /**
   * Set active model for a task ('tts' or 'asr').
   */
  setActiveModel(task, modelId) {
    const settings = this.getSettings();
    const model = this.getModelDefinition(modelId, settings);
    if (!model) throw new Error(`Unknown model "${modelId}"`);
    if (model.task !== task) {
      throw new Error(`Model "${model.name}" belongs to task "${model.task}", not "${task}".`);
    }

    if (task === 'tts') {
      queries.updateSetting('tts_active_model', modelId);
    } else if (task === 'asr') {
      queries.updateSetting('asr_active_model', modelId);
    } else {
      throw new Error(`Unsupported task "${task}"`);
    }

    return this.inspectModel(model, this.getSettings());
  }

  /**
   * Register a custom Hugging Face or local model in the catalog.
   */
  registerCustomModel({ name, task, repoId, customPath, languages, description, engine }) {
    const cleanName = (name || '').trim();
    if (!cleanName) throw new Error('Model name is required.');
    if (!['tts', 'asr', 'ocr'].includes(task)) {
      throw new Error('Task must be tts, asr, or ocr.');
    }

    const cleanRepo = (repoId || '').trim();
    const cleanPath = (customPath || '').trim();
    if (!cleanRepo && !cleanPath) {
      throw new Error('Provide either a Hugging Face repository ID (org/model) or a local path.');
    }

    if (cleanPath) {
      const expanded = expandHome(cleanPath);
      if (!fs.existsSync(expanded)) {
        throw new Error(`Local path not found: ${expanded}`);
      }
    }

    const settings = this.getSettings();
    const customList = this.getCustomModels(settings);
    const id =
      'custom_' +
      cleanName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '') +
      '_' +
      Date.now().toString(36).slice(-4);

    const defaultEngine =
      engine ||
      (task === 'tts' ? 'omnivoice' : task === 'asr' ? 'faster-whisper' : 'tesseract');

    const entry = {
      id,
      name: cleanName,
      task,
      subtask: cleanRepo ? `Custom Hugging Face (${cleanRepo})` : 'Custom Local Model',
      sourceType: cleanRepo ? 'huggingface' : 'local',
      repoId: cleanRepo || null,
      customPath: cleanPath ? expandHome(cleanPath) : null,
      engine: defaultEngine,
      languages: Array.isArray(languages)
        ? languages
        : String(languages || 'multilingual')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
      expectedBytes: 0,
      ramRequirement: 'Custom',
      license: 'Custom',
      description: (description || '').trim() || `User-registered ${task.toUpperCase()} model.`,
      requiredFiles: []
    };

    customList.push(entry);
    queries.updateSetting('custom_models_json', JSON.stringify(customList));

    if (cleanPath) {
      const refs = this.getModelRefs(this.getSettings());
      refs[id] = expandHome(cleanPath);
      queries.updateSetting('model_refs_json', JSON.stringify(refs));
    }

    return this.inspectModel(entry, this.getSettings());
  }

  /**
   * Start downloading (or building) a model in the background and emit SSE progress events.
   */
  async startDownload(modelId) {
    if (this.activeDownloads.has(modelId)) {
      return this.activeDownloads.get(modelId).progress;
    }

    const settings = this.getSettings();
    const model = this.getModelDefinition(modelId, settings);
    if (!model) {
      throw new Error(`Unknown model "${modelId}"`);
    }

    const initialProgress = {
      modelId,
      status: 'downloading',
      percent: 0,
      downloadedBytes: 0,
      totalBytes: model.expectedBytes || 0,
      speedBps: 0,
      etaSeconds: null,
      currentFile: 'Preparing download…',
      startedAt: Date.now()
    };

    const updateProgress = (patch) => {
      const entry = this.activeDownloads.get(modelId);
      if (!entry) return;
      Object.assign(entry.progress, patch);
      this.broadcast({
        type: 'model_download',
        modelId,
        download: { ...entry.progress }
      });
    };

    if (model.sourceType === 'huggingface' && model.repoId) {
      const pythonBin = this.resolvePythonBin(settings);
      const cacheDir = this.resolveCacheDir(settings);
      fs.mkdirSync(cacheDir, { recursive: true });

      const env = { ...process.env };
      if (settings.hf_token && settings.hf_token.trim()) {
        env.HF_TOKEN = settings.hf_token.trim();
      }

      const child = spawn(pythonBin, [DOWNLOADER_SCRIPT, model.repoId, cacheDir], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env
      });

      this.activeDownloads.set(modelId, {
        proc: child,
        progress: initialProgress,
        abort: () => {
          try {
            child.kill('SIGTERM');
          } catch {}
        }
      });

      this.broadcast({ type: 'model_download', modelId, download: initialProgress });

      let stdoutBuf = '';
      let stderrBuf = '';

      child.stdout.on('data', (chunk) => {
        stdoutBuf += chunk.toString();
        const lines = stdoutBuf.split('\n');
        stdoutBuf = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            if (msg.type === 'start' || msg.type === 'progress') {
              updateProgress({
                percent: msg.percent ?? 0,
                downloadedBytes: msg.downloadedBytes ?? 0,
                totalBytes: msg.totalBytes || model.expectedBytes || 0,
                speedBps: msg.speedBps ?? 0,
                etaSeconds: msg.etaSeconds ?? null,
                currentFile: msg.currentFile || 'Downloading weights…',
                fileIndex: msg.fileIndex,
                fileCount: msg.fileCount
              });
            } else if (msg.type === 'error') {
              updateProgress({ status: 'error', error: msg.error });
            }
          } catch {}
        }
      });

      child.stderr.on('data', (chunk) => {
        stderrBuf += chunk.toString();
      });

      child.on('close', (code, signal) => {
        const entry = this.activeDownloads.get(modelId);
        this.activeDownloads.delete(modelId);

        if (signal === 'SIGTERM' || signal === 'SIGINT' || code === 130) {
          this.broadcast({
            type: 'model_download',
            modelId,
            download: { status: 'cancelled', modelId }
          });
          return;
        }

        if (code !== 0) {
          const errMsg =
            entry?.progress?.error || stderrBuf.trim().slice(-300) || `Downloader exited ${code}`;
          this.broadcast({
            type: 'model_download',
            modelId,
            download: { status: 'error', modelId, error: errMsg }
          });
          return;
        }

        const inspected = this.inspectModel(model, this.getSettings());
        this.broadcast({
          type: 'model_download',
          modelId,
          download: { status: 'completed', modelId, percent: 100 },
          model: inspected
        });
      });

      return initialProgress;
    }

    if (model.sourceType === 'tessdata' && model.downloadUrl) {
      fs.mkdirSync(TESSDATA_DIR, { recursive: true });
      const controller = new AbortController();
      this.activeDownloads.set(modelId, {
        proc: null,
        progress: initialProgress,
        abort: () => controller.abort()
      });
      this.broadcast({ type: 'model_download', modelId, download: initialProgress });

      (async () => {
        const target = path.join(TESSDATA_DIR, model.fileName);
        const tempTarget = `${target}.incomplete`;
        try {
          const res = await fetch(model.downloadUrl, { signal: controller.signal });
          if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
          const totalBytes = Number(res.headers.get('content-length')) || model.expectedBytes || 0;
          const fileStream = fs.createWriteStream(tempTarget);
          let downloadedBytes = 0;
          const startTime = Date.now();

          for await (const chunk of res.body) {
            fileStream.write(chunk);
            downloadedBytes += chunk.length;
            const elapsed = Math.max(0.001, (Date.now() - startTime) / 1000);
            const speedBps = Math.round(downloadedBytes / elapsed);
            const percent = totalBytes > 0 ? Math.min(99.9, Math.round((downloadedBytes / totalBytes) * 1000) / 10) : 0;
            updateProgress({
              downloadedBytes,
              totalBytes,
              percent,
              speedBps,
              currentFile: model.fileName
            });
          }
          fileStream.end();
          await new Promise((resolve, reject) => {
            fileStream.on('finish', resolve);
            fileStream.on('error', reject);
          });
          fs.renameSync(tempTarget, target);
          this.activeDownloads.delete(modelId);
          this.broadcast({
            type: 'model_download',
            modelId,
            download: { status: 'completed', modelId, percent: 100 },
            model: this.inspectModel(model, this.getSettings())
          });
        } catch (err) {
          this.activeDownloads.delete(modelId);
          try {
            fs.rmSync(tempTarget, { force: true });
          } catch {}
          if (err.name === 'AbortError') {
            this.broadcast({
              type: 'model_download',
              modelId,
              download: { status: 'cancelled', modelId }
            });
          } else {
            this.broadcast({
              type: 'model_download',
              modelId,
              download: { status: 'error', modelId, error: err.message }
            });
          }
        }
      })();

      return initialProgress;
    }

    if (model.sourceType === 'binary' && model.sourceScript) {
      const swiftSrc = path.join(BIN_DIR, model.sourceScript);
      const outBin = path.join(BIN_DIR, model.fileName);
      if (!fs.existsSync(swiftSrc)) {
        throw new Error(`Source file not found: ${swiftSrc}`);
      }
      this.activeDownloads.set(modelId, {
        proc: null,
        progress: { ...initialProgress, currentFile: `Compiling ${model.sourceScript}…`, percent: 50 },
        abort: () => {}
      });
      this.broadcast({ type: 'model_download', modelId, download: initialProgress });

      try {
        await execFileAsync('swiftc', ['-O', swiftSrc, '-o', outBin], { timeout: 60000 });
        this.activeDownloads.delete(modelId);
        const inspected = this.inspectModel(model, this.getSettings());
        this.broadcast({
          type: 'model_download',
          modelId,
          download: { status: 'completed', modelId, percent: 100 },
          model: inspected
        });
        return { status: 'completed', modelId, percent: 100 };
      } catch (err) {
        this.activeDownloads.delete(modelId);
        this.broadcast({
          type: 'model_download',
          modelId,
          download: { status: 'error', modelId, error: err.message }
        });
        throw err;
      }
    }

    throw new Error(`Model "${model.name}" does not have an automated download source.`);
  }

  /**
   * Cancel an in-flight model download.
   */
  cancelDownload(modelId) {
    const entry = this.activeDownloads.get(modelId);
    if (!entry) return false;
    entry.abort();
    this.activeDownloads.delete(modelId);
    this.broadcast({
      type: 'model_download',
      modelId,
      download: { status: 'cancelled', modelId }
    });
    return true;
  }

  /**
   * Remove a model:
   * - If it has a custom reference path, unlink the reference (never delete external referenced files unless requested).
   * - If it is in the HF cache or tessdata, delete the cached weights on disk.
   * - If it is a user-registered custom model and `removeCustomEntry` is true, remove it from catalog.
   */
  deleteModel(modelId, { deleteFiles = true, removeCustomEntry = false } = {}) {
    if (this.activeDownloads.has(modelId)) {
      this.cancelDownload(modelId);
    }

    const settings = this.getSettings();
    const model = this.getModelDefinition(modelId, settings);
    if (!model) throw new Error(`Unknown model "${modelId}"`);

    const refs = this.getModelRefs(settings);
    const hadCustomRef = Boolean(refs[modelId]);
    if (hadCustomRef) {
      delete refs[modelId];
      queries.updateSetting('model_refs_json', JSON.stringify(refs));
    }

    if (deleteFiles && !hadCustomRef) {
      if (model.sourceType === 'huggingface' && model.repoId) {
        const cacheDir = this.resolveCacheDir(settings);
        const repoFolder = `models--${model.repoId.replace(/\//g, '--')}`;
        const repoRoot = path.join(cacheDir, repoFolder);
        if (fs.existsSync(repoRoot)) {
          fs.rmSync(repoRoot, { recursive: true, force: true });
        }
      } else if (model.sourceType === 'tessdata' && model.fileName) {
        const target = path.join(TESSDATA_DIR, model.fileName);
        if (fs.existsSync(target)) {
          fs.rmSync(target, { force: true });
        }
      }
    }

    if (model.isCustom && removeCustomEntry) {
      const customList = this.getCustomModels(this.getSettings()).filter((m) => m.id !== modelId);
      queries.updateSetting('custom_models_json', JSON.stringify(customList));
      return { removed: true, modelId };
    }

    return { removed: false, model: this.inspectModel(model, this.getSettings()) };
  }
}

export const modelManager = new ModelManager();
