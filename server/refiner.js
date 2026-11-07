import { chatCompletion, getCompletionText } from './usage.js';

/**
 * High-grade Heuristic Text Cleaner (Offline fallback)
 */
export function heuristicCleanNarration(rawText) {
  if (!rawText) return '';

  const lines = rawText.split('\n');
  const cleanedLines = [];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    if (!line) continue;

    // Filter out obvious running page numbers (e.g. "42", "- 42 -", "Page 12")
    if (/^(?:page\s*)?[—\-–]?\s*\d+\s*[—\-–]?$/i.test(line)) {
      continue;
    }

    // Filter out footnote markers / footnote blocks at the bottom
    if (/^(?:footnote\s*\d*|\*+|\d+\.?\s*(?:see|cf\.|ibid|op\.\s*cit|http|isbn|copyright|all rights reserved))/i.test(line)) {
      continue;
    }

    // Filter out copyright / publishing metadata
    if (/(?:isbn\s*[\d\-]+|published by|all rights reserved|printed in)/i.test(line)) {
      continue;
    }

    // Filter out inline citation markers like [1], [2-4], etc.
    line = line.replace(/\[\d+(?:[–\-]\d+)?\]/g, '');

    // Normalize multiple spaces
    line = line.replace(/[ \t]+/g, ' ');

    cleanedLines.push(line);
  }

  // Join lines into cohesive paragraphs
  return cleanedLines.join('\n\n');
}

/**
 * Default system prompt for narration refinement.
 * Overridable from the UI (Settings -> Refiner System Prompt).
 */
export const DEFAULT_REFINER_PROMPT = `You are an expert audiobook narration script editor.
Your task is to convert raw OCR/PDF text into natural, spoken-word prose suitable for an audiobook narrator.

CRITICAL RULES:
1. Strip all document noise: headers, running footers, page numbers, publisher copyright, ISBN, and footnote citations (like [1], [2]).
2. Preserve all genuine literary content, dialogue, Arabic verses/hadith, and Bengali narrative text verbatim in meaning.
3. Fix hyphenated line breaks (e.g. "en- / lighten" -> "enlighten").
4. Format into clean, readable paragraphs.
5. Return ONLY the clean narration text. Do NOT add meta commentary, explanations, or code fences.`;

/**
 * Build the effective system prompt from settings:
 * stored prompt (fallback: default) + optional extra user instructions
 * + free-form narration delivery notes.
 */
export function buildRefinerSystemPrompt(settings = {}) {
  const base = (settings.refiner_system_prompt || '').trim() || DEFAULT_REFINER_PROMPT;
  const extra = (settings.refiner_extra_instructions || '').trim();
  const styleNotes = (settings.tts_style_notes || '').trim();

  let prompt = base;
  if (extra) {
    prompt = `${prompt}\n\nADDITIONAL USER INSTRUCTIONS (highest priority):\n${extra}`;
  }
  if (styleNotes) {
    // The TTS model itself cannot follow free-form style text, so delivery
    // direction is applied here, at the script layer: sentence shape, pauses and
    // emphasis change how the narrator actually speaks the page.
    prompt = `${prompt}\n\nNARRATION DELIVERY DIRECTION (apply to the script, never quote it):\n${styleNotes}`;
  }
  return prompt;
}

/**
 * LLM-powered Narration Cleaner & Normalizer
 */
export async function refineNarrationText(rawText, settings, context = {}) {
  if (!rawText || !rawText.trim()) {
    return '';
  }

  const apiKey = settings.refiner_key;
  const baseUrl = (settings.refiner_url || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const model = settings.refiner_model || 'gpt-4o-mini';

  // If no API key is provided, use the smart offline cleaner
  if (!apiKey) {
    return heuristicCleanNarration(rawText);
  }

  const systemPrompt = buildRefinerSystemPrompt(settings);

  const userPrompt = `Here is the raw page text to clean and format for audiobook narration:\n\n${rawText}`;

  const payload = {
    model: model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    temperature: 0.2,
    max_tokens: 3000
  };

  try {
    const result = await chatCompletion({
      url: baseUrl,
      apiKey,
      model,
      payload,
      stage: 'refiner',
      projectId: context.projectId ?? null,
      pageNumber: context.pageNumber ?? null,
      // '1' (default) = local proxy usage is free; only charge full API rates when '0'
      billableLocal: settings.usage_free_local === '0',
      throwOnError: false
    });

    if (!result.ok) {
      console.warn(`[Refiner] LLM refinement failed (${result.status}): ${result.error}. Falling back to heuristic cleaner.`);
      return heuristicCleanNarration(rawText);
    }

    const refined = getCompletionText(result.json);
    return refined || heuristicCleanNarration(rawText);
  } catch (err) {
    console.warn(`[Refiner] LLM Refinement error: ${err.message}. Falling back to heuristic cleaner.`);
    return heuristicCleanNarration(rawText);
  }
}
