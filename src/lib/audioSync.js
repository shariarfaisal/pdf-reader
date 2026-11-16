/**
 * Narration sync: map playback time to the sentence being spoken.
 *
 * The TTS engine decodes one sentence chunk at a time and reports the exact
 * start/end of each chunk (`pages.audio_timings`). Those chunks are matched to
 * the rendered text, giving time "anchors" at known text offsets. Every sentence
 * in between is timed by interpolating between the nearest anchors, so a chunk
 * the matcher could not find (the synthesizer expands abbreviations and
 * normalizes quotes) never leaves the highlight stuck or skipping text.
 *
 * Matching is done on a "compact" projection of the text (letters/digits/marks
 * only, lowercased, no spaces or punctuation). Compact offsets map straight back
 * to raw text offsets for rendering.
 */

const WORD_CHAR = /[\p{L}\p{N}\p{M}]/u;
// Latin, Bangla danda, Arabic question mark and full stop.
const SENTENCE_END = /[.!?।॥؟۔]/;
// Characters of a chunk's head/tail used to anchor a chunk that does not match whole.
const ANCHOR_CHARS = 16;

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

/** Sentence spans of one paragraph as compact offsets: [{ from, to }]. */
function sentenceSpans(paragraph) {
  const { text, map } = compactIndex(paragraph);
  const spans = [];
  let from = 0;
  let seen = 0; // compact characters at or before the current raw index
  for (let i = 0; i < paragraph.length; i += 1) {
    if (seen < map.length && map[seen] === i) seen += 1;
    if (SENTENCE_END.test(paragraph[i]) && seen > from) {
      spans.push({ from, to: seen });
      from = seen;
    }
  }
  if (text.length > from) spans.push({ from, to: text.length });
  return spans;
}

/**
 * Locate one chunk in the document text, searching from `from`.
 * Returns { start, end } where `end` is null when only the head was found.
 */
function locateChunk(doc, needle, from) {
  const whole = doc.indexOf(needle, from);
  if (whole !== -1) return { start: whole, end: whole + needle.length };
  if (needle.length < ANCHOR_CHARS * 2) return null;

  const start = doc.indexOf(needle.slice(0, ANCHOR_CHARS), from);
  if (start === -1) return null;
  const tail = needle.slice(-ANCHOR_CHARS);
  const tailAt = doc.indexOf(tail, start + ANCHOR_CHARS);
  const plausible = tailAt !== -1 && tailAt + ANCHOR_CHARS <= start + needle.length * 2;
  return { start, end: plausible ? tailAt + ANCHOR_CHARS : null };
}

/** Time at a document offset, interpolated between the surrounding anchors. */
function timeAt(anchors, offset) {
  // Last anchor at or before the offset. Ties resolve to the later anchor, so a
  // sentence that starts where a chunk ends picks up the pause that follows it.
  let lo = 0;
  let hi = anchors.length - 1;
  let i = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (anchors[mid].offset <= offset) {
      i = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  const a = anchors[i];
  const b = anchors[i + 1];
  if (!b || b.offset === a.offset) return a.time;
  return a.time + ((offset - a.offset) / (b.offset - a.offset)) * (b.time - a.time);
}

/**
 * Join sentence marks to paragraph sentences.
 * Returns [{ start, end, paragraph, from, to }] in playback order, with from/to
 * as compact character offsets within the paragraph, or null when there is
 * nothing to sync.
 */
export function buildSyncMap(paragraphs, marks) {
  if (!marks?.length || !paragraphs?.length) return null;

  const compactParas = paragraphs.map((text) => compactIndex(text || '').text);
  const paraStarts = [];
  let doc = '';
  for (const text of compactParas) {
    paraStarts.push(doc.length);
    doc += text;
  }

  // Anchors pin text offsets to audio times. Chunks are in reading order, so
  // each search starts where the previous match ended.
  const anchors = [{ offset: 0, time: 0 }];
  let searchFrom = 0;
  for (const mark of marks) {
    const needle = compactIndex(String(mark.text || '')).text;
    if (!needle) continue;
    const found = locateChunk(doc, needle, searchFrom);
    if (!found) continue;
    anchors.push({ offset: found.start, time: mark.start });
    if (found.end !== null) {
      anchors.push({ offset: found.end, time: mark.end });
      searchFrom = found.end;
    } else {
      searchFrom = found.start + ANCHOR_CHARS;
    }
  }
  anchors.push({ offset: doc.length, time: marks[marks.length - 1].end });

  const entries = [];
  paragraphs.forEach((text, paragraph) => {
    const base = paraStarts[paragraph];
    for (const { from, to } of sentenceSpans(text || '')) {
      const start = timeAt(anchors, base + from);
      const end = timeAt(anchors, base + to);
      if (end <= start) continue;
      entries.push({
        start: Math.round(start * 1000) / 1000,
        end: Math.round(end * 1000) / 1000,
        paragraph,
        from,
        to
      });
    }
  });
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
