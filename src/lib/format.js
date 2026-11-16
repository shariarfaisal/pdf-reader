/**
 * Shared display formatters for usage/cost data.
 */

/** USD with enough precision to stay readable for sub-cent amounts. */
export function formatUsd(value, { precise = false } = {}) {
  const num = Number(value) || 0;
  if (num === 0) return '$0';
  if (num < 0.01) return `$${num.toFixed(precise ? 6 : 4)}`;
  if (num < 1) return `$${num.toFixed(3)}`;
  return `$${num.toFixed(2)}`;
}

/** Compact token counts: 1234 -> 1.2k, 1500000 -> 1.5M */
export function formatTokens(value) {
  const num = Number(value) || 0;
  if (num < 1000) return String(num);
  if (num < 1_000_000) return `${(num / 1000).toFixed(num < 10_000 ? 2 : 1)}k`;
  return `${(num / 1_000_000).toFixed(2)}M`;
}

export function formatDuration(ms) {
  const num = Number(ms) || 0;
  if (num < 1000) return `${Math.round(num)}ms`;
  if (num < 60_000) return `${(num / 1000).toFixed(1)}s`;
  const minutes = Math.floor(num / 60_000);
  const seconds = Math.round((num % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

/** Local `YYYY-MM-DD` for <input type="date">. */
export function toDateInput(date) {
  const d = date instanceof Date ? date : new Date(date);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function formatDateTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

export function formatDayLabel(day) {
  if (!day) return '';
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Human “last touched” label: 5m ago, 3h ago, 2d ago, then a date. */
export function formatRelativeTime(ts) {
  const value = Number(ts) || 0;
  if (!value) return 'never';

  const diff = Date.now() - value;
  if (diff < 0) return 'just now';

  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < minute) return 'just now';
  if (diff < hour) return `${Math.floor(diff / minute)}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;

  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export const STAGE_LABELS = {
  ocr: 'Vision OCR',
  refiner: 'Narration Refiner',
  tts: 'Speech Synthesis',
  other: 'Other'
};

export function stageLabel(stage) {
  return STAGE_LABELS[stage] || stage || 'Other';
}

/** Human-readable byte size: 856 KB, 145 MB, 3.05 GB. */
export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n <= 0) return '0 B';
  if (n < 1024) return `${n} B`;
  const kb = n / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb < 100 ? mb.toFixed(1) : Math.round(mb)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

/**
 * Clean display title for books imported from PDF filenames without mutating
 * the underlying database project name or source filename.
 */
export function formatBookDisplayTitle(rawName) {
  if (!rawName || typeof rawName !== 'string') return 'Untitled Book';
  const original = rawName.trim();
  if (!original) return 'Untitled Book';

  let cleaned = original
    .replace(/\.pdf$/i, '')
    .replace(/[\s_]*[\[(]?boimate\.com[\])]?/gi, '')
    .replace(/[\s_]*by_goonok\.com/gi, '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s._-]+|[\s._-]+$/g, '')
    .trim();

  return cleaned || original;
}

