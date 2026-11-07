/**
 * Audio player preferences shared by the player bar and the Settings page.
 * The player bar owns playback; Settings only edits the defaults, so both sides
 * read/write this module instead of reaching into localStorage themselves.
 */
const VOLUME_KEY = 'pdf_reader_volume';

/** Fired after writeVolume so a mounted player bar picks the new level up. */
export const VOLUME_EVENT = 'pdf-reader:volume';

export function readVolume() {
  try {
    const stored = localStorage.getItem(VOLUME_KEY);
    if (stored === null) return 1;
    const value = Number(stored);
    return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1;
  } catch {
    return 1;
  }
}

export function writeVolume(value) {
  const next = Math.min(1, Math.max(0, Number(value) || 0));
  try {
    localStorage.setItem(VOLUME_KEY, String(next));
  } catch {}
  window.dispatchEvent(new CustomEvent(VOLUME_EVENT, { detail: next }));
  return next;
}
