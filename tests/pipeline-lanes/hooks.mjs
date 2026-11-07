import { pathToFileURL } from 'node:url';
import path from 'node:path';

// Swap the three real stage implementations for local stubs so the scheduler can
// be tested without OCR binaries, an LLM endpoint or a TTS model.
const STUBS = {
  ocr: path.join(import.meta.dirname, 'stubs', 'ocr.js'),
  refiner: path.join(import.meta.dirname, 'stubs', 'refiner.js'),
  tts: path.join(import.meta.dirname, 'stubs', 'tts.js')
};

export async function resolve(specifier, context, nextResolve) {
  const resolved = await nextResolve(specifier, context);
  for (const [name, stub] of Object.entries(STUBS)) {
    if (resolved.url.endsWith(`/server/${name}.js`)) {
      return { url: pathToFileURL(stub).href, shortCircuit: true };
    }
  }
  return resolved;
}
