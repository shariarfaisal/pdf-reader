/**
 * Keys whose value differs from the baseline the form was loaded with.
 * Saving only these keeps a stale settings view from overwriting values
 * changed elsewhere (another tab, the modal, or a background save).
 */
export function changedSettings(next, baseline = {}) {
  const changed = {};
  for (const key of Object.keys(next)) {
    if (String(next[key] ?? '') !== String(baseline[key] ?? '')) {
      changed[key] = next[key];
    }
  }
  return changed;
}
