#!/usr/bin/env python3
"""
Backfill narration sentence timings for pages that were synthesized before the
TTS engine reported them.

The page audio already exists, so nothing is re-synthesized. For each page we:
  1. re-split the narration script with the exact same chunker the synthesizer
     uses, so the chunk count matches the number of spoken chunks;
  2. split the stored WAV at its internal pauses (the 0.2 s gap the synthesizer
     inserted between chunks) when those line up with the expected boundaries;
  3. otherwise spread the known duration across chunks weighted by character
     count, snapping each boundary to the nearest detected pause.

Usage:
  python bin/backfill_timings.py            # fill missing timings
  python bin/backfill_timings.py --force    # overwrite existing timings
  python bin/backfill_timings.py --dry-run  # report only, no writes
"""

import argparse
import json
import os
import sqlite3
import sys
import wave

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tts_synthesizer import split_text_for_omnivoice  # noqa: E402

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data', 'pdf_reader.db')

SILENCE_RATIO = 0.02     # frame is "silent" below 2% of the peak amplitude
MIN_GAP_SECONDS = 0.12   # ignore micro pauses inside a word
SNAP_WINDOW = 1.2        # how far a proportional boundary may jump to a pause


def read_pcm(path):
    """Return (samples monoaural float32 in [-1,1], sample_rate) or (None, 0)."""
    import numpy as np

    try:
        with wave.open(path, 'rb') as handle:
            channels = handle.getnchannels()
            width = handle.getsampwidth()
            rate = handle.getframerate()
            raw = handle.readframes(handle.getnframes())
    except wave.Error:
        # torchaudio writes IEEE float WAV (format 3); the stdlib wave module
        # refuses it.
        try:
            import torchaudio

            tensor, rate = torchaudio.load(path)
        except Exception:
            return None, 0
        data = tensor.mean(dim=0).numpy().astype('float32')
        return data, int(rate)

    if width == 2:
        data = np.frombuffer(raw, dtype='<i2').astype(np.float32) / 32768.0
    elif width == 4:
        data = np.frombuffer(raw, dtype='<i4').astype(np.float32) / 2147483648.0
    elif width == 1:
        data = (np.frombuffer(raw, dtype='u1').astype(np.float32) - 128.0) / 128.0
    else:
        return None, 0
    if channels > 1:
        data = data.reshape(-1, channels).mean(axis=1)
    return data, rate


def find_pauses(samples, rate):
    """Silences that could be the gap the synthesizer inserts between chunks.

    Returns [(midpoint_seconds, depth)] where depth is the quietest RMS in the
    gap relative to the loudest part of the page. The inserted gap is literally
    zero samples, so it scores ~0 while a natural breath still carries noise.
    """
    import numpy as np

    if samples is None or not len(samples) or not rate:
        return []
    frame = max(1, int(rate * 0.01))
    usable = len(samples) - (len(samples) % frame)
    if not usable:
        return []
    frames = samples[:usable].reshape(-1, frame)
    rms = np.sqrt((frames ** 2).mean(axis=1))
    peak = float(rms.max())
    if peak <= 0:
        return []
    silent = rms < peak * SILENCE_RATIO
    min_frames = max(1, int(MIN_GAP_SECONDS / 0.01))

    pauses = []
    start = None
    for index, flag in enumerate(silent):
        if flag and start is None:
            start = index
        elif not flag and start is not None:
            if index - start >= min_frames and start > 0:
                mid = (start + index) / 2 * 0.01
                depth = float(rms[start:index].min()) / peak
                pauses.append((round(mid, 3), round(depth, 5)))
            start = None
    return pauses


def build_timings(chunks, duration, pauses):
    """Character-weighted boundaries, each snapped to the deepest nearby pause."""
    texts = [item['text'].strip() for item in chunks]
    weights = [max(1, len(text)) for text in texts]
    total = float(sum(weights))
    total_duration = float(duration)

    boundaries = []
    cursor = 0.0
    for weight in weights[:-1]:
        cursor += total_duration * (weight / total)
        best = cursor
        candidates = [p for p in pauses if p[0] > 0 and abs(p[0] - cursor) <= SNAP_WINDOW]
        if candidates:
            best = min(candidates, key=lambda p: (p[1], abs(p[0] - cursor)))[0]
        boundaries.append(best)

    marks = []
    previous = 0.0
    for index, text in enumerate(texts):
        end = boundaries[index] if index < len(boundaries) else total_duration
        if end - previous > 0.01:
            marks.append({'start': round(previous, 3), 'end': round(end, 3), 'text': text})
        previous = end
    return marks


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--force', action='store_true', help='overwrite existing timings')
    parser.add_argument('--dry-run', action='store_true', help='report only')
    args = parser.parse_args()

    if not os.path.exists(DB_PATH):
        print(f'No database at {DB_PATH}')
        return 1

    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    # The server owns the schema; add the column here too so the script works
    # before the server has restarted onto the new migration.
    columns = {row[1] for row in connection.execute('PRAGMA table_info(pages)')}
    if 'audio_timings' not in columns:
        connection.execute('ALTER TABLE pages ADD COLUMN audio_timings TEXT')
        connection.commit()
        print('Added pages.audio_timings')
    where = "audio_path IS NOT NULL AND audio_path != '' AND refined_text IS NOT NULL"
    if not args.force:
        where += ' AND (audio_timings IS NULL OR audio_timings = "")'
    rows = connection.execute(f'SELECT id, page_number, refined_text, audio_path, audio_duration FROM pages WHERE {where}').fetchall()
    print(f'{len(rows)} page(s) to process')

    written = 0
    skipped = 0
    for row in rows:
        audio_path = row['audio_path']
        if not audio_path or not os.path.exists(audio_path):
            skipped += 1
            continue
        chunks = split_text_for_omnivoice(row['refined_text'], max_chars=280)
        if not chunks:
            skipped += 1
            continue
        samples, rate = read_pcm(audio_path)
        if samples is None:
            skipped += 1
            continue
        duration = len(samples) / float(rate) if rate else (row['audio_duration'] or 0)
        if not duration:
            skipped += 1
            continue
        pauses = find_pauses(samples, rate)
        marks = build_timings(chunks, duration, pauses)
        if not marks:
            skipped += 1
            continue
        print(
            f'  page {row["page_number"] + 1}: {len(marks)} chunk(s), {duration:.1f}s, '
            f'{len(pauses)} pause(s) detected'
        )
        if not args.dry_run:
            connection.execute('UPDATE pages SET audio_timings = ? WHERE id = ?', (json.dumps(marks), row['id']))
        written += 1

    if not args.dry_run:
        connection.commit()
    connection.close()
    print(f'{"Would write" if args.dry_run else "Wrote"} timings for {written} page(s), skipped {skipped}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
