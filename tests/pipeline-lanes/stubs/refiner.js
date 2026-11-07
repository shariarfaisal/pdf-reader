export const DEFAULT_REFINER_PROMPT = 'stub prompt';
const log = (row) => (globalThis.__stageLog ??= []).push(row);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

export async function refineNarrationText(rawText, settings, meta = {}) {
  const start = Date.now();
  await delay(Number(process.env.STUB_REFINE_MS || 160));
  log({ stage: 'refine', page: meta.pageNumber, start, end: Date.now() });
  return `REFINED: ${rawText}`;
}
