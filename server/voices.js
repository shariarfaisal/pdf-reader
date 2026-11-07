import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { queries } from './db.js';
import { remoteColab } from './remote/colab.js';
import { modelManager } from './models.js';

/**
 * Voice library: disk + manifest plumbing shared by the HTTP API, the local
 * Python synthesizer and the Colab worker.
 *
 * Layout:
 *   data/voices/<id>/sample.wav    normalized 24 kHz mono reference (<= 30 s)
 *   data/voices/<id>/prompt.pt     cached local VoiceClonePrompt (built lazily)
 *   data/voices/voices.json        manifest read by bin/tts_synthesizer.py
 */

const DATA_DIR = path.resolve(process.cwd(), 'data');
export const VOICES_DIR = path.join(DATA_DIR, 'voices');
export const MANIFEST_PATH = path.join(VOICES_DIR, 'voices.json');
export const BUILTIN_VOICE = 'builtin';
// OmniVoice clones best from a 3-10 s passage that starts and ends on a pause:
// the prompt pairs the clip with its exact transcript, so a mid-word cut (or a
// clip past ~10 s) blurs the timbre the model copies. Keep the cut inside the
// recommendation, and transcribe exactly the cut passage.
export const MAX_SAMPLE_SECONDS = 10;
const MIN_SAMPLE_SECONDS = 4;
const VENV_PYTHON = path.resolve(
  process.cwd(),
  '..',
  'voicestudio',
  '.venv',
  'bin',
  'python'
);
const TRANSCRIBE_BIN = path.resolve(process.cwd(), 'bin', 'voice_transcribe.py');

export const PREVIEW_TEXT = {
  bn: 'আসসালামু আলাইকুম। এটি আমার কণ্ঠস্বরের একটি সংক্ষিপ্ত নমুনা।',
  en: 'This is a short sample of my cloned voice, reading a sentence aloud.',
  ar: 'هذه عينة قصيرة من صوتي المستنسخ.',
  auto: 'This is a short sample of my cloned voice, reading a sentence aloud.'
};

function ensureVoicesDir() {
  if (!fs.existsSync(VOICES_DIR)) {
    fs.mkdirSync(VOICES_DIR, { recursive: true });
  }
}

export function voiceDir(id) {
  return path.join(VOICES_DIR, id);
}

function ffprobeDuration(filePath) {
  return new Promise((resolve) => {
    const child = spawn('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=nk=1:nw=1',
      filePath
    ]);
    let out = '';
    child.stdout.on('data', (d) => {
      out += d.toString();
    });
    child.on('close', () => {
      const value = parseFloat(out.trim());
      resolve(Number.isFinite(value) ? value : 0);
    });
    child.on('error', () => resolve(0));
  });
}

/**
 * Convert any uploaded audio into the single format both backends expect:
 * 24 kHz mono WAV, leading silence trimmed, capped at MAX_SAMPLE_SECONDS.
 */
/** Pipe an ffmpeg run, resolving with the collected stderr (filters log there). */
function runFfmpeg(args, failMessage = 'ffmpeg failed') {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args);
    let stderr = '';
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('error', (error) => reject(new Error(`ffmpeg unavailable: ${error.message}`)));
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`${failMessage} (ffmpeg exit ${code}): ${stderr.trim().slice(-200)}`));
        return;
      }
      resolve(stderr);
    });
  });
}

/**
 * Cut point for the reference window: the start of the quietest 40 ms region
 * inside [MIN_SAMPLE_SECONDS, MAX_SAMPLE_SECONDS], i.e. a natural gap between
 * words. Cutting on a fixed timestamp slices a syllable in half, and the clone
 * prompt then ends on a fragment the transcript cannot describe.
 */
async function findPauseCut(filePath, duration) {
  const PCM_RATE = 24000;
  const FRAME = Math.round(0.02 * PCM_RATE);
  const WINDOW_FRAMES = 2;
  let pcm;
  try {
    pcm = await new Promise((resolve, reject) => {
      const child = spawn('ffmpeg', [
        '-v',
        'error',
        '-i',
        filePath,
        '-ac',
        '1',
        '-ar',
        String(PCM_RATE),
        '-f',
        's16le',
        '-'
      ]);
      const chunks = [];
      child.stdout.on('data', (chunk) => chunks.push(chunk));
      child.on('error', reject);
      child.on('close', (code) =>
        code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`ffmpeg exit ${code}`))
      );
    });
  } catch {
    return Math.min(duration, MAX_SAMPLE_SECONDS);
  }

  const samples = Math.floor(pcm.length / 2);
  const frameCount = Math.floor(samples / FRAME);
  if (frameCount < 8) return Math.min(duration, MAX_SAMPLE_SECONDS);

  const energy = new Float64Array(frameCount);
  for (let f = 0; f < frameCount; f += 1) {
    let sum = 0;
    for (let i = f * FRAME; i < (f + 1) * FRAME; i += 1) {
      const v = pcm.readInt16LE(i * 2) / 32768;
      sum += v * v;
    }
    energy[f] = sum / FRAME;
  }

  let loudest = 0;
  for (let f = 0; f < frameCount; f += 1) loudest = Math.max(loudest, energy[f]);

  const firstFrame = Math.floor((MIN_SAMPLE_SECONDS * PCM_RATE) / FRAME);
  const lastFrame = Math.min(frameCount - 1, Math.floor((MAX_SAMPLE_SECONDS * PCM_RATE) / FRAME));
  let bestFrame = lastFrame;
  let best = Infinity;
  for (let f = firstFrame; f + WINDOW_FRAMES <= lastFrame; f += 1) {
    const window = energy[f] + energy[f + 1];
    // Never treat a near-silent clip as "mostly pauses": require a real dip.
    if (window < best) {
      best = window;
      bestFrame = f;
    }
  }
  if (!(best < loudest * 0.6)) {
    // Flat, continuous speech: the window edge is as good as any other point.
    return Math.min(duration, MAX_SAMPLE_SECONDS);
  }
  return Math.min(duration, (bestFrame * FRAME) / PCM_RATE);
}

export async function normalizeSample(sourcePath, id) {
  ensureVoicesDir();
  const dir = voiceDir(id);
  fs.mkdirSync(dir, { recursive: true });
  const outputPath = path.join(dir, 'sample.wav');
  const fullPath = path.join(dir, 'sample.full.wav');

  // 1. Single decode to the format both backends expect (24 kHz mono), with
  //    the leading silence removed so the transcript starts on the first word.
  await runFfmpeg(
    [
      '-y',
      '-i',
      sourcePath,
      '-ac',
      '1',
      '-ar',
      '24000',
      '-af',
      'silenceremove=start_periods=1:start_duration=0.1:start_threshold=-45dB',
      fullPath
    ],
    'Could not decode that audio file'
  );

  try {
    const fullDuration = await ffprobeDuration(fullPath);
    if (!fullDuration) {
      throw new Error('Could not read the duration of that audio file.');
    }

    // 2. Cut the reference at a pause (never mid-word) inside the 4-10 s window.
    const cut = fullDuration <= MAX_SAMPLE_SECONDS
      ? fullDuration
      : await findPauseCut(fullPath, fullDuration);
    const fade = Math.min(0.06, cut / 4);
    await runFfmpeg(
      [
        '-y',
        '-i',
        fullPath,
        '-t',
        cut.toFixed(3),
        '-af',
        `afade=t=out:st=${(cut - fade).toFixed(3)}:d=${fade.toFixed(3)}`,
        outputPath
      ],
      'Could not trim that audio file'
    );
  } finally {
    fs.rmSync(fullPath, { force: true });
  }

  const duration = await ffprobeDuration(outputPath);
  if (!duration || duration < 3) {
    fs.rmSync(outputPath, { force: true });
    throw new Error('Audio sample is too short — upload at least 5 seconds of clear speech.');
  }
  return { audioPath: outputPath, duration };
}

// Rough narration speed per script, in characters per second of speech. Used
// only to catch a transcript that cannot belong to the reference clip.
// Measured from real samples: Bengali narration runs ~10.5 chars/s (spaces
// excluded), English audiobook delivery ~13.5.
const SPEECH_RATE = { bn: 10.5, ar: 9, en: 13.5 };

/** Estimated spoken length of a transcript (0 when unknown/empty). */
export function estimateTranscriptSeconds(text, language = 'auto') {
  const clean = (text || '').replace(/[\s\u200b-\u200d]/g, '');
  if (!clean) return 0;
  let rate = SPEECH_RATE[language];
  if (!rate) {
    if (/[\u0980-\u09FF]/.test(clean)) rate = SPEECH_RATE.bn;
    else if (/[\u0600-\u06FF]/.test(clean)) rate = SPEECH_RATE.ar;
    else rate = SPEECH_RATE.en;
  }
  return clean.length / rate;
}

/**
 * OmniVoice conditions the clone on "this transcript is what that clip says".
 * A transcript that reads much longer (or shorter) than the sample makes the
 * voice drift, so surface it instead of silently shipping a broken clone.
 */
export function transcriptMismatch(voice) {
  if (!voice) return null;
  const text = voice.ref_text ?? voice.refText ?? '';
  const audioSeconds = Number(voice.duration || 0);
  const estimated = estimateTranscriptSeconds(text, voice.language);
  if (!estimated || !audioSeconds) return null;
  const ratio = estimated / audioSeconds;
  if (ratio <= 1.35 && ratio >= 0.6) return null;
  return {
    ratio: Number(ratio.toFixed(2)),
    estimatedSeconds: Number(estimated.toFixed(1)),
    audioSeconds: Number(audioSeconds.toFixed(1)),
    message:
      ratio > 1
        ? `Transcript reads like ~${estimated.toFixed(0)}s of speech but the sample is ${audioSeconds.toFixed(1)}s. The clone will drift — keep only the words spoken in the clip (Re-transcribe).`
        : `Transcript is far shorter than the ${audioSeconds.toFixed(1)}s sample. The clone will drift — Re-transcribe it.`
  };
}

/** Delete every derived artifact for a voice (sample, local prompt cache). */
export function deleteVoiceFiles(id) {
  const dir = voiceDir(id);
  fs.rmSync(dir, { recursive: true, force: true });
}

/** Local prompt cache must be rebuilt after the sample or transcript changes. */
export function invalidatePrompt(id) {
  fs.rmSync(path.join(voiceDir(id), 'prompt.pt'), { force: true });
}

/**
 * Rewrite data/voices/voices.json — the manifest the local Python synthesizer
 * reads to resolve a voice id (or name) into a reference file + transcript.
 */
export function writeVoiceManifest() {
  ensureVoicesDir();
  const voices = queries.listVoices().map((voice) => ({
    id: voice.id,
    name: voice.name,
    language: voice.language,
    file: path.isAbsolute(voice.audio_path) ? voice.audio_path : path.resolve(voice.audio_path),
    prompt_pt: path.join(voiceDir(voice.id), 'prompt.pt'),
    transcript: voice.ref_text || ''
  }));

  const tmp = `${MANIFEST_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ voices }, null, 2));
  fs.renameSync(tmp, MANIFEST_PATH);
  return voices;
}

/** Public shape for the UI. */
export function toPublicVoice(voice) {
  return {
    id: voice.id,
    name: voice.name,
    language: voice.language,
    refText: voice.ref_text,
    duration: voice.duration,
    createdAt: voice.created_at,
    updatedAt: voice.updated_at,
    audioUrl: `/api/voices/${voice.id}/audio`,
    hasPromptCache: fs.existsSync(path.join(voiceDir(voice.id), 'prompt.pt')),
    transcriptWarning: transcriptMismatch(voice)
  };
}

/**
 * Transcribe a sample with the locally cached faster-whisper turbo model so the
 * clone prompt gets an accurate reference transcript. Returns '' when the local
 * ASR stack is unavailable (the UI then keeps the field editable/manual).
 */
export function transcribeSample(audioPath, language = 'auto') {
  return new Promise((resolve) => {
    const pythonBin = modelManager.resolvePythonBin();
    const asrModel = modelManager.getActiveAsrModel();
    if (!fs.existsSync(TRANSCRIBE_BIN)) {
      resolve({ text: '', warning: 'Local ASR unavailable — type the sample text manually.' });
      return;
    }
    const env = {
      ...process.env,
      HUGGINGFACE_HUB_CACHE: modelManager.resolveCacheDir(),
      ...(asrModel?.resolvedPath ? { PDFREADER_ASR_PATH: asrModel.resolvedPath } : {}),
      ...(asrModel?.engine ? { PDFREADER_ASR_ENGINE: asrModel.engine } : {})
    };
    const child = spawn(pythonBin, [TRANSCRIBE_BIN, audioPath, language], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {}
    }, 5 * 60 * 1000);

    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ text: '', warning: `ASR failed: ${error.message}` });
    });
    child.on('close', () => {
      clearTimeout(timer);
      const line = stdout.trim().split('\n').filter(Boolean).pop() || '{}';
      try {
        const parsed = JSON.parse(line);
        resolve({ text: (parsed.text || '').trim(), warning: parsed.error || null });
      } catch {
        resolve({ text: '', warning: stderr.trim().slice(0, 300) || 'ASR returned no transcript.' });
      }
    });
  });
}

export function newVoiceId() {
  return `vo_${crypto.randomBytes(5).toString('hex')}`;
}

// The Colab worker pulls the library through this callback (no import cycle).
remoteColab.setVoiceProvider(() =>
  queries.listVoices().map((voice) => ({
    id: voice.id,
    name: voice.name,
    refText: voice.ref_text || '',
    audioPath: voice.audio_path
  }))
);

/** Push the current library to a warm Colab worker (best-effort, never throws). */
export async function syncVoicesToRemote({ force = false } = {}) {
  const voices = queries.listVoices().map((voice) => ({
    id: voice.id,
    name: voice.name,
    refText: voice.ref_text || '',
    audioPath: voice.audio_path
  }));
  try {
    await remoteColab.syncVoices(voices, { force });
  } catch (error) {
    // Worker offline: the local synthesizer resolves voices from the manifest.
  }
}

/** Per-language default voice ids live in settings (tts_voice_bn/en/ar). */
export function defaultVoiceForLanguage(language) {
  const settings = queries.getSettings();
  const value = settings[`tts_voice_${language}`];
  if (!value || value === BUILTIN_VOICE) return null;
  return queries.getVoiceById(value) || queries.getVoiceByName(value) || null;
}
