const log = (row) => (globalThis.__stageLog ??= []).push(row);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
export function abortActiveSynthesis() {
  globalThis.__ttsAborted = (globalThis.__ttsAborted || 0) + 1;
}
export async function synthesizeAudio(text, outPath, settings) {
  const start = Date.now();
  // Page rows are id-named on disk, so identify the target by file name.
  const page = String(outPath).split('/').pop();
  await delay(Number(process.env.STUB_TTS_MS || 420));
  const fs = await import('node:fs');
  fs.writeFileSync(outPath, 'fake-wav');
  log({ stage: 'audio', page, start, end: Date.now() });
  return { audioPath: outPath, duration: 1.5, voice: 'stub' };
}
