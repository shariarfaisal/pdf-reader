// Test stubs: replace the slow real stages with timeable fakes so the lane
// scheduler can be verified without OCR, an LLM or a TTS model.
const log = (row) => (globalThis.__stageLog ??= []).push(row);

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

export async function renderPdfPage(pdfPath, pageIndex, outPath) {
  const fs = await import('node:fs');
  fs.writeFileSync(outPath, 'fake-png');
}

export async function extractPageText(pdfPath, pageIndex, renderPath, settings) {
  const start = Date.now();
  if (String(process.env.STUB_FAIL_PAGE) === String(pageIndex)) {
    await delay(20);
    throw new Error('stub OCR failure');
  }
  await delay(Number(process.env.STUB_OCR_MS || 40));
  log({ stage: 'ocr', page: pageIndex, start, end: Date.now() });
  return { text: `RAW TEXT PAGE ${pageIndex}`, source: 'stub' };
}
