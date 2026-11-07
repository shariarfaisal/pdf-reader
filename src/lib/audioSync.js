/**
 * Narration sync: map playback time to the paragraph and sentence being spoken.
 *
 * The TTS engine decodes one sentence chunk at a time, so it reports the exact
 * start/end of every spoken chunk (`pages.audio_timings`). Matching those marks
 * to the rendered paragraphs is plain text matching — no model, no guessing from
 * playback progress (progress says nothing: paragraphs are never equal length).
 *
 * Matching is done on a "compact" projection of the text (letters/digits/marks
 * only, lowercased, no spaces or punctuation) because the synthesizer sanitizes
 * its input — quotes, dashes and page artifacts differ between the stored script
 * and the spoken chunk. Compact offsets map straight back to raw text offsets.
 */

const WORD_CHAR = /[\p{L}\p{N}\p{M}]/u;

/** Letters/digits/combining marks only, lowercased, with a raw-index map. */
function compactIndex(text) {
  const chars = [];
  const map = [];
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (WORD_CHAR.test(ch)) {
      chars.push(ch.toLowerCase());
      map.push(i);
    }
  }
  return { text: chars.join(''), map };
}

/** Sentence marks for a page, or null when the engine reported none. */
export function parseTimings(page) {
  const raw = page?.audio_timings;
  if (!raw) return null;
  let marks = raw;
  if (typeof raw === 'string') {
    try {
      marks = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(marks)) return null;
  const clean = marks.filter(
    (mark) => mark && Number.isFinite(mark.start) && Number.isFinite(mark.end) && mark.end > mark.start
  );
  return clean.length ? clean : null;
}

/**
 * Join sentence marks to paragraph indexes.
 * Returns [{ start, end, paragraph, from, to }] with from/to as compact
 * character offsets, or null when nothing could be matched.
 */
export function buildSyncMap(paragraphs, marks) {
  if (!marks?.length || !paragraphs?.length) return null;

  const compactParas = paragraphs.map((text) => compactIndex(text || ''));
  const spans = [];
  let docCursor = 0;
  compactParas.forEach((item, index) => {
    spans.push({ index, start: docCursor, end: docCursor + item.text.length });
    docCursor += item.text.length;
  });
  const doc = compactParas.map((item) => item.text).join('');

  let searchFrom = 0;
  const entries = [];
  for (const mark of marks) {
    const needle = compactIndex(String(mark.text || '')).text;
    if (!needle) continue;
    let at = doc.indexOf(needle, searchFrom);
    if (at === -1) at = doc.indexOf(needle);
    if (at === -1) continue;
    searchFrom = at + needle.length;

    // The chunker groups sentences up to a character budget, ignoring paragraph
    // breaks, so one spoken chunk often spans several paragraphs. Split its time
    // across them by character count so the highlight advances mid-chunk.
    const chunkStart = at;
    const chunkEnd = at + needle.length;
    const chunkLength = chunkEnd - chunkStart;
    const markSpan = Math.max(0.001, mark.end - mark.start);
    for (const piece of spans) {
      if (piece.end <= chunkStart || piece.start >= chunkEnd) continue;
      const localStart = Math.max(piece.start, chunkStart);
      const localEnd = Math.min(piece.end, chunkEnd);
      const fractionStart = (localStart - chunkStart) / chunkLength;
      const fractionEnd = (localEnd - chunkStart) / chunkLength;
      entries.push({
        start: Math.round((mark.start + markSpan * fractionStart) * 1000) / 1000,
        end: Math.round((mark.start + markSpan * fractionEnd) * 1000) / 1000,
        paragraph: piece.index,
        from: localStart - piece.start,
        to: localEnd - piece.start
      });
    }
  }
  return entries.length ? entries : null;
}

/** Index of the mark covering `time` (last mark whose start <= time), or -1. */
export function markIndexAt(entries, time) {
  if (!entries?.length) return -1;
  let lo = 0;
  let hi = entries.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (entries[mid].start <= time) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/**
 * Translate a compact-offset range back to raw text offsets, so the spoken
 * sentence can be wrapped without re-rendering the paragraph from a collapsed
 * copy of itself.
 */
export function compactSpanToRaw(paragraph, from, to) {
  if (!paragraph || from == null || to == null || to <= from) return null;
  const { map } = compactIndex(paragraph);
  const startRaw = map[from];
  const endCompact = Math.min(to, map.length) - 1;
  if (startRaw == null || endCompact < from) return null;
  const endRaw = map[endCompact] + 1;
  if (endRaw <= startRaw) return null;
  return [startRaw, endRaw];
}
