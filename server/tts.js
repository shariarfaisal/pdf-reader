import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { queries } from './db.js';
import { remoteColab } from './remote/colab.js';
import { BUILTIN_VOICE } from './voices.js';
import { modelManager } from './models.js';

const SYNTHESIZER_BIN = path.resolve(process.cwd(), 'bin', 'tts_synthesizer.py');

const BENGALI_REGEX = /[\u0980-\u09FF]/;
const ARABIC_REGEX = /[\u0600-\u06FF]/;

// Singleton handle + FIFO queue to guarantee only 1 Python TTS process ever runs at a time on 8GB M2
let activeTtsProcess = null;
let activeTtsOwner = null;
const ttsWaitQueue = [];

/**
 * Immediately terminate any in-flight TTS synthesis process and free its RAM/MPS memory.
 * When `projectId` is given, only aborts work belonging to that project so other
 * concurrently running projects are never interrupted.
 */
export function abortActiveSynthesis(projectId = null) {
  for (let i = ttsWaitQueue.length - 1; i >= 0; i--) {
    if (!projectId || ttsWaitQueue[i].projectId === projectId) {
      const [removed] = ttsWaitQueue.splice(i, 1);
      removed.cancel();
    }
  }

  if (activeTtsProcess && (!projectId || activeTtsOwner === projectId)) {
    try {
      activeTtsProcess.kill('SIGTERM');
      const proc = activeTtsProcess;
      setTimeout(() => {
        try {
          if (!proc.killed) proc.kill('SIGKILL');
        } catch {}
      }, 800);
    } catch {}
    activeTtsProcess = null;
    activeTtsOwner = null;
  }
}

function acquireTtsSlot(projectId = null, signal = null) {
  if (signal?.aborted) {
    return Promise.reject(new Error('Synthesis cancelled by user.'));
  }
  if (!activeTtsProcess && ttsWaitQueue.length === 0) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const entry = {
      projectId,
      grant: () => {
        if (signal && onAbort) signal.removeEventListener('abort', onAbort);
        resolve();
      },
      cancel: () => {
        if (signal && onAbort) signal.removeEventListener('abort', onAbort);
        reject(new Error('Synthesis cancelled by user.'));
      }
    };
    const onAbort = () => {
      const idx = ttsWaitQueue.indexOf(entry);
      if (idx !== -1) ttsWaitQueue.splice(idx, 1);
      reject(new Error('Synthesis cancelled by user.'));
    };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    ttsWaitQueue.push(entry);
  });
}

function releaseTtsSlot() {
  if (activeTtsProcess) return;
  const next = ttsWaitQueue.shift();
  if (next) next.grant();
}

/**
 * Resolve which cloned voice narrates this text.
 *
 * Settings hold a voice id (`vo_...`) or the `builtin` sentinel. Legacy installs
 * stored a display name instead, so ids are matched first, then names, then the
 * built-in reference voice.
 */
export function resolveVoiceForText(text, settings = {}) {
  let raw;
  if (settings.tts_voice_override) {
    raw = settings.tts_voice_override;
  } else if (BENGALI_REGEX.test(text)) {
    raw = settings.tts_voice_bn;
  } else if (ARABIC_REGEX.test(text)) {
    raw = settings.tts_voice_ar;
  } else {
    raw = settings.tts_voice_en;
  }

  if (!raw || raw === BUILTIN_VOICE) {
    return { id: null, name: null, label: 'Built-in reference voice', refText: null };
  }

  const row = queries.getVoiceById(raw) || queries.getVoiceByName(raw);
  if (row) {
    return {
      id: row.id,
      name: row.name,
      label: row.name,
      refText: row.ref_text || null,
      audioPath: row.audio_path
    };
  }

  // Legacy label stored before the voice library existed.
  if (/^vo_[0-9a-z]+$/i.test(raw)) {
    // A stored default pointing at a deleted voice must not leak a phantom id
    // downstream (local Python then silently cloned the built-in sample, the
    // Colab worker rejected the request). Be explicit about the fallback.
    return { id: null, name: null, label: 'Built-in reference voice (default voice was deleted)', refText: null };
  }
  return { id: null, name: raw, label: raw, refText: null };
}

/**
 * Determine best voice based on predominant script and user settings
 * (kept for callers that only need the label).
 */
export function detectVoiceForText(text, settings = {}) {
  return resolveVoiceForText(text, settings).label;
}

/**
 * Synthesize speech to audio file using single-process low-memory synthesizer:
 * - Local k2-fsa/OmniVoice custom clone (two-stage MPS/CPU split to stay < 1.8 GB RAM)
 * - Edge-TTS Neural broadcast voices fallback
 * - Native macOS speech fallback
 */
/**
 * Synthesize speech to audio file.
 *
 * Backend selection (`tts_backend` setting):
 *   - 'local'  : OmniVoice on this Mac (MPS), fallback engines below
 *   - 'colab'  : remote Colab GPU worker only (errors surface to the pipeline)
 *   - 'auto'   : try Colab first, fall back to local synthesis on any failure
 */
export async function synthesizeAudio(text, outputPath, settings = {}, options = {}) {
  if (!text || !text.trim()) {
    return { audioPath: null, duration: 0 };
  }

  const backend = settings.tts_backend || 'auto';
  const voice = resolveVoiceForText(text, settings);

  if (backend === 'colab' || backend === 'auto') {
    try {
      return await remoteColab.synthesize(text, outputPath, settings, { voice });
    } catch (error) {
      if (backend === 'colab') {
        throw new Error(`Colab TTS backend failed: ${error.message}`);
      }
      console.warn(`[TTS] Colab backend unavailable (${error.message}) — falling back to local synthesis.`);
    }
  }

  return synthesizeAudioLocal(text, outputPath, settings, voice, options);
}

/**
 * Synthesize speech to audio file using single-process low-memory synthesizer:
 * - Local k2-fsa/OmniVoice custom clone (two-stage MPS/CPU split to stay < 1.8 GB RAM)
 * - Edge-TTS Neural broadcast voices fallback
 * - Native macOS speech fallback
 */
export async function synthesizeAudioLocal(text, outputPath, settings = {}, resolvedVoice = null, options = {}) {
  if (!text || !text.trim()) {
    return { audioPath: null, duration: 0 };
  }

  const { projectId = null, signal = null } = options;

  // Serialize local Python TTS processes across concurrent projects so we stay < 1.8 GB RAM
  // on 8GB M2 MacBook Air without killing another project's synthesis.
  await acquireTtsSlot(projectId, signal);

  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const voice = resolvedVoice || resolveVoiceForText(text, settings);

  const speed = settings.tts_speed || '1.0';
  const instruct = (settings.tts_instruct || '').trim();
  const numStep = settings.tts_num_step || '16';

  const pythonBin = modelManager.resolvePythonBin(settings);
  const activeTts = modelManager.getActiveTtsModel(settings);
  const omnivoicePath = modelManager.resolveModelPath('omnivoice', settings);
  const mmsBenPath = modelManager.resolveModelPath('mms-tts-ben', settings);
  const mmsAraPath = modelManager.resolveModelPath('mms-tts-ara', settings);
  const mmsEngPath = modelManager.resolveModelPath('mms-tts-eng', settings);

  const env = {
    ...process.env,
    HUGGINGFACE_HUB_CACHE: modelManager.resolveCacheDir(settings),
    ...(omnivoicePath ? { PDFREADER_OMNIVOICE_PATH: omnivoicePath } : {}),
    ...(activeTts?.engine ? { PDFREADER_TTS_ENGINE: activeTts.engine } : {}),
    ...(activeTts?.resolvedPath ? { PDFREADER_TTS_PATH: activeTts.resolvedPath } : {}),
    ...(mmsBenPath ? { PDFREADER_MMS_BEN_PATH: mmsBenPath } : {}),
    ...(mmsAraPath ? { PDFREADER_MMS_ARA_PATH: mmsAraPath } : {}),
    ...(mmsEngPath ? { PDFREADER_MMS_ENG_PATH: mmsEngPath } : {})
  };

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      releaseTtsSlot();
      return reject(new Error('Synthesis cancelled by user.'));
    }

    const child = spawn(
      pythonBin,
      [SYNTHESIZER_BIN, outputPath, text, voice.id || voice.name, speed, instruct, String(numStep)],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        env
      }
    );
    activeTtsProcess = child;
    activeTtsOwner = projectId;

    const onSignalAbort = () => {
      if (activeTtsProcess === child) {
        abortActiveSynthesis(projectId);
      } else {
        try { child.kill('SIGTERM'); } catch {}
      }
    };
    if (signal) signal.addEventListener('abort', onSignalAbort, { once: true });

    let stdout = '';
    let stderr = '';

    const cleanupSlot = () => {
      if (signal) signal.removeEventListener('abort', onSignalAbort);
      if (activeTtsProcess === child) {
        activeTtsProcess = null;
        activeTtsOwner = null;
      }
      releaseTtsSlot();
    };

    const timer = setTimeout(() => {
      if (activeTtsProcess === child) {
        abortActiveSynthesis(projectId);
      } else {
        try { child.kill('SIGKILL'); } catch {}
      }
      cleanupSlot();
      reject(new Error('TTS synthesis timed out after 10 minutes.'));
    }, 600000);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      cleanupSlot();
      reject(new Error(`TTS process error: ${err.message}`));
    });

    child.on('close', (code, closeSignal) => {
      clearTimeout(timer);
      cleanupSlot();

      if (signal?.aborted || closeSignal === 'SIGTERM' || closeSignal === 'SIGKILL' || code === 130) {
        return reject(new Error('Synthesis cancelled by user.'));
      }

      const lines = stdout.trim().split('\n');
      let lastJson = null;
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          lastJson = JSON.parse(lines[i]);
          if (lastJson && (lastJson.audioPath || lastJson.success || lastJson.error)) break;
        } catch {}
      }

      if (lastJson && lastJson.success) {
        return resolve({
          audioPath: lastJson.audioPath,
          duration: lastJson.duration || 0,
          voice: lastJson.voice,
          engine: lastJson.engine,
          timings: Array.isArray(lastJson.timings) ? lastJson.timings : null
        });
      }

      const errSummary = (lastJson && lastJson.error) || stderr.trim().slice(-300) || `Exited with code ${code}`;
      console.error(`[TTS] Synthesis error: ${errSummary}`);
      reject(new Error(`TTS synthesis failed: ${errSummary}`));
    });
  });
}
