/**
 * Per-page narration progress, derived from the cached artifacts themselves.
 *
 * A page row has no single "stage" column — what it has done is exactly which
 * of raw_text → refined_text → audio_path exist. Deriving the four states
 * (nothing / text / script / audio) here keeps the page grid, its filters and
 * the inspector progress bar reading from one source of truth.
 */

// Ordered narration stages. `activeStatus` is the page status the engine
// broadcasts while that stage runs, so a cell can only spin when it is true.
export const PAGE_STAGES = [
  {
    key: 'ocr',
    label: 'Text',
    hint: 'Raw OCR / text extraction',
    activeStatus: 'extracting',
    tone: 'sky',
    bar: 'bg-sky-400',
    text: 'text-sky-300',
    dot: 'bg-sky-400'
  },
  {
    key: 'refine',
    label: 'Script',
    hint: 'Refined narration script',
    activeStatus: 'refining',
    tone: 'violet',
    bar: 'bg-violet-400',
    text: 'text-violet-300',
    dot: 'bg-violet-400'
  },
  {
    key: 'audio',
    label: 'Audio',
    hint: 'Synthesized narration',
    activeStatus: 'synthesizing',
    tone: 'emerald',
    bar: 'bg-emerald-400',
    text: 'text-emerald-300',
    dot: 'bg-emerald-400'
  }
];

export const STAGE_BY_KEY = Object.fromEntries(PAGE_STAGES.map((stage) => [stage.key, stage]));

export const ACTIVE_STATUSES = PAGE_STAGES.map((stage) => stage.activeStatus);

const STAGE_BY_STATUS = Object.fromEntries(PAGE_STAGES.map((stage) => [stage.activeStatus, stage.key]));

/** Which stage a broadcast page status belongs to, or null when it is final. */
export function stageForStatus(status) {
  return STAGE_BY_STATUS[status] || null;
}

/**
 * Completed stages for one page. Later stages imply earlier ones so a stored
 * script without a cached raw text still renders as a coherent progress bar.
 */
export function pageStages(page) {
  const audio = Boolean(page?.audio_path);
  const refine = audio || Boolean(page?.refined_text && page.refined_text.trim());
  const ocr = refine || Boolean(page?.raw_text && page.raw_text.trim());
  return { ocr, refine, audio };
}

/** 0 = nothing cached, 1 = text, 2 = script, 3 = audio (fully narrated). */
export function pageLevel(page) {
  const done = pageStages(page);
  if (done.audio) return 3;
  if (done.refine) return 2;
  if (done.ocr) return 1;
  return 0;
}

// Non-overlapping buckets: each page counts exactly once.
export const FUNNEL = [
  { key: 'pending', label: 'Pending', tone: 'slate', bar: 'bg-slate-600', text: 'text-slate-300', stage: null },
  { key: 'text', label: 'Text', tone: 'sky', bar: 'bg-sky-400', text: 'text-sky-300', stage: 'ocr' },
  { key: 'script', label: 'Script', tone: 'violet', bar: 'bg-violet-400', text: 'text-violet-300', stage: 'refine' },
  { key: 'audio', label: 'Audio', tone: 'emerald', bar: 'bg-emerald-400', text: 'text-emerald-300', stage: 'audio' },
  { key: 'error', label: 'Error', tone: 'rose', bar: 'bg-rose-400', text: 'text-rose-300', stage: null }
];

export const BUCKET_BY_KEY = Object.fromEntries(FUNNEL.map((bucket) => [bucket.key, bucket]));

export function pageBucket(page) {
  if (page?.status === 'error') return 'error';
  const level = pageLevel(page);
  if (level === 3) return 'audio';
  if (level === 2) return 'script';
  if (level === 1) return 'text';
  return 'pending';
}

export function countBuckets(pages = []) {
  const counts = { pending: 0, text: 0, script: 0, audio: 0, error: 0 };
  for (const page of pages) counts[pageBucket(page)] += 1;
  return counts;
}

/**
 * A page is only "running" when the engine reported it as the page its stage is
 * working on AND that stage is still running. Stage lanes run in parallel, so
 * up to three pages (one per stage) can be live at the same time.
 *
 * `activeRuns` is a map of stage → page number, or the legacy single
 * `{ pageNumber, stage }` object.
 */
export function runningStageFor(page, activeRuns, stages) {
  if (!activeRuns || !page) return null;
  const pairs = activeRuns.stage
    ? [[activeRuns.stage, activeRuns.pageNumber]]
    : PAGE_STAGES.map((stage) => [stage.key, activeRuns[stage.key]]);
  for (const [stage, pageNumber] of pairs) {
    if (pageNumber === page.page_number && stages?.[stage] === 'running') return stage;
  }
  return null;
}

export function isPageRunning(page, activeRuns, stages) {
  return Boolean(runningStageFor(page, activeRuns, stages));
}

/** Human label for a page's state, used for a11y text and tooltips. */
export function describePage(page, activeRuns, stages) {
  if (page?.status === 'error') return 'error';
  const runningStage = runningStageFor(page, activeRuns, stages);
  if (runningStage) {
    const stage = STAGE_BY_KEY[runningStage];
    return `${stage ? stage.label : 'stage'} running`;
  }
  const level = pageLevel(page);
  if (level === 3) return 'narrated';
  if (level === 2) return 'script refined';
  if (level === 1) return 'text extracted';
  return 'not started';
}
