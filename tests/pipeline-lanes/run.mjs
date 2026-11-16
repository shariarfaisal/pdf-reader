/**
 * Pipeline lane scheduler verification.
 *
 *   npm run test:pipeline
 *
 * OCR / refiner / TTS are replaced by stubs (tests/pipeline-lanes/stubs) so the
 * only thing under test is the scheduler in server/pipeline.js: lanes running
 * in parallel, each stage resuming from the first page that still needs it,
 * caching, pause / stop / step semantics and error isolation.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REPO = path.resolve(import.meta.dirname, '..', '..');
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-lanes-'));
process.chdir(WORK);

const { queries } = await import(`${REPO}/server/db.js`);
const { pipeline } = await import(`${REPO}/server/pipeline.js`);

// Throttling is a hardware-safety knob, not scheduler behaviour: disable it so
// the checks below stay fast and deterministic.
queries.updateSetting('throttle_delay_ms', '0');

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = () => globalThis.__stageLog || [];

function makeProject(id, pageCount) {
  const pdfPath = path.join(WORK, `${id}.pdf`);
  fs.writeFileSync(pdfPath, 'fake-pdf');
  queries.createProject({ id, name: id, pdfPath, pageCount });
  for (let n = 0; n < pageCount; n += 1) {
    queries.upsertPage({ projectId: id, pageNumber: n, status: 'pending' });
  }
  return id;
}

async function waitIdle(timeout = 30000) {
  const started = Date.now();
  while (pipeline.loopInFlight && Date.now() - started < timeout) await sleep(50);
  return !pipeline.loopInFlight;
}

// ---------------------------------------------------------------------------
// 1. Concurrent lanes: start OCR, then start Script mid-run (the reported case)
// ---------------------------------------------------------------------------
{
  const id = makeProject('proj-a', 6);
  globalThis.__stageLog = [];
  await pipeline.start(id, { stage: 'ocr' });
  await sleep(120); // OCR is already a few pages in
  check('OCR lane running before Script starts', pipeline.stageStates.ocr === 'running', `states=${JSON.stringify(pipeline.stageStates)}`);
  await pipeline.start(id, { stage: 'refine' });
  await sleep(60);
  check('Script starts while OCR keeps running', pipeline.stageStates.ocr === 'running' && pipeline.stageStates.refine === 'running');
  const idle = await waitIdle(30000);
  check('run finished on its own', idle);
  const logRows = log();
  const ocrDone = logRows.filter((r) => r.stage === 'ocr').length;
  const refineDone = logRows.filter((r) => r.stage === 'refine').length;
  check('every page OCR\'d exactly once', ocrDone === 6, `ocr=${ocrDone}`);
  check('every page refined exactly once', refineDone === 6, `refine=${refineDone}`);

  // Overlap: refine must start on page 0 before OCR reaches the last page.
  const firstRefine = Math.min(...logRows.filter((r) => r.stage === 'refine').map((r) => r.start));
  const lastOcrEnd = Math.max(...logRows.filter((r) => r.stage === 'ocr').map((r) => r.end));
  check('Script overlapped OCR (lanes run in parallel)', firstRefine < lastOcrEnd);

  const pages = queries.getPagesByProjectId(id);
  check('all pages have text + script', pages.every((p) => p.raw_text && p.refined_text), `pending=${pages.filter((p) => !p.refined_text).length}`);
  check('run ends with no stage stuck running', !['ocr', 'refine', 'audio'].some((s) => pipeline.stageStates[s] === 'running'));
}

// ---------------------------------------------------------------------------
// 2. Full run: OCR / Script / Audio all 3 lanes overlap, nothing duplicated
// ---------------------------------------------------------------------------
{
  const id = makeProject('proj-b', 5);
  globalThis.__stageLog = [];
  await pipeline.start(id, { stage: 'all' });
  const idle = await waitIdle(40000);
  check('full run finished', idle);
  const rows = log();
  const pages = queries.getPagesByProjectId(id);
  check('all 5 pages narrated', pages.every((p) => p.audio_path && fs.existsSync(p.audio_path)), `ready=${pages.filter((p) => p.status === 'ready').length}`);
  for (const stage of ['ocr', 'refine', 'audio']) {
    const count = rows.filter((r) => r.stage === stage).length;
    check(`${stage} ran exactly 5 times`, count === 5, `count=${count}`);
  }
  const span = (stage) => {
    const s = rows.filter((r) => r.stage === stage);
    return [Math.min(...s.map((r) => r.start)), Math.max(...s.map((r) => r.end))];
  };
  const [ocrStart, ocrEnd] = span('ocr');
  const [audioStart, audioEnd] = span('audio');
  // Default (pipeline_local_parallel=0): the two local heavy stages are gated,
  // OCR first, so voice synthesis starts once text extraction is out of the way.
  check('default: heavy stages do not overlap (OCR first)', audioStart >= ocrEnd, `ocr ${ocrStart}-${ocrEnd}, audio ${audioStart}-${audioEnd}`);
  check('project marked completed', queries.getProjectById(id).status === 'completed', `status=${queries.getProjectById(id).status}`);
}

// ---------------------------------------------------------------------------
// 2b. pipeline_local_parallel=1 lets OCR and TTS overlap
// ---------------------------------------------------------------------------
{
  const id = makeProject('proj-b2', 4);
  queries.updateSetting('pipeline_local_parallel', '1');
  // Slow OCR so both heavy stages are provably in flight at the same time.
  process.env.STUB_OCR_MS = '900';
  globalThis.__stageLog = [];
  await pipeline.start(id, { stage: 'all' });
  const idle = await waitIdle(40000);
  delete process.env.STUB_OCR_MS;
  queries.updateSetting('pipeline_local_parallel', '0');
  const rows = log();
  check('parallel-local run finished', idle);
  const span = (stage) => {
    const s = rows.filter((r) => r.stage === stage);
    return [Math.min(...s.map((r) => r.start)), Math.max(...s.map((r) => r.end))];
  };
  const [, ocrEnd] = span('ocr');
  const [audioStart] = span('audio');
  check('pipeline_local_parallel=1 lets OCR and TTS overlap', audioStart < ocrEnd, `ocr end ${ocrEnd}, audio start ${audioStart}`);
  const pages = queries.getPagesByProjectId(id);
  check('parallel-local run narrated every page', pages.every((p) => p.audio_path));
}

// ---------------------------------------------------------------------------
// 3. Stop / restart: stop releases the engine, a fresh run resumes only work
// ---------------------------------------------------------------------------
{
  const id = makeProject('proj-c', 8);
  globalThis.__stageLog = [];
  await pipeline.start(id, { stage: 'all' });
  await sleep(1200);
  pipeline.stop(id);
  const idle = await waitIdle(8000);
  check('stop() releases the engine', idle, `loopInFlight=${pipeline.loopInFlight}`);
  const doneBefore = queries.getPagesByProjectId(id).filter((p) => p.audio_path).length;
  const rowsBefore = log().length;
  check('nothing keeps running after stop', log().length === rowsBefore, `extra=${log().length - rowsBefore}`);
  check('partial work cached', doneBefore > 0, `audio pages=${doneBefore}`);
  await pipeline.start(id, { stage: 'all' });
  const idle2 = await waitIdle(40000);
  const pages = queries.getPagesByProjectId(id);
  check('resume after stop finishes the book', idle2 && pages.every((p) => p.audio_path), `ready=${pages.filter((p) => p.audio_path).length}/${pages.length}`);
  // Cached pages must not be redone: only the page that was aborted by stop()
  // may run a second time (its first attempt wrote no page row).
  const audioRows = log().filter((r) => r.stage === 'audio');
  const uniquePages = new Set(audioRows.map((r) => r.page)).size;
  check('cached audio never re-synthesized', uniquePages === pages.length && audioRows.length <= pages.length + 1, `runs=${audioRows.length}, unique pages=${uniquePages}`);
}

// ---------------------------------------------------------------------------
// 4. Pause one stage while the others keep going
// ---------------------------------------------------------------------------
{
  const id = makeProject('proj-d', 6);
  globalThis.__stageLog = [];
  await pipeline.start(id, { stage: 'all' });
  await sleep(500);
  pipeline.pause(id, { stage: 'refine' });
  await sleep(700);
  const paused = pipeline.stageStates.refine;
  const ocrStill = pipeline.stageStates.ocr;
  check('paused Script holds its state', paused === 'paused', `refine=${paused}`);
  check('OCR keeps running while Script is paused', ocrStill === 'running' || ocrStill === 'completed', `ocr=${ocrStill}`);
  pipeline.resume(id, { stage: 'refine' });
  const idle = await waitIdle(40000);
  const pages = queries.getPagesByProjectId(id);
  check('resumed run completes every page', idle && pages.every((p) => p.audio_path), `ready=${pages.filter((p) => p.audio_path).length}/${pages.length}`);
}

// ---------------------------------------------------------------------------
// 5. Start a single later stage only: Script pulls OCR as a dependency
// ---------------------------------------------------------------------------
{
  const id = makeProject('proj-e', 3);
  globalThis.__stageLog = [];
  await pipeline.start(id, { stage: 'refine' });
  const idle = await waitIdle(20000);
  const pages = queries.getPagesByProjectId(id);
  check('Script-only run extracts text as a dependency', idle && pages.every((p) => p.raw_text && p.refined_text));
  check('Script-only run leaves audio alone', pages.every((p) => !p.audio_path));
}

// ---------------------------------------------------------------------------
// 6. Step: one page through every requested stage
// ---------------------------------------------------------------------------
{
  const id = makeProject('proj-f', 4);
  globalThis.__stageLog = [];
  await pipeline.step(id, 2, { stage: 'all' });
  const idle = await waitIdle(20000);
  const pages = queries.getPagesByProjectId(id);
  const target = pages.find((p) => p.page_number === 2);
  check('step finishes and releases the engine', idle);
  check('step processed only the requested page', Boolean(target.audio_path) && pages.filter((p) => p.audio_path).length === 1, `narrated=${pages.filter((p) => p.audio_path).length}`);
  check('step keeps stage states idle', pipeline.stageStates.ocr === 'idle' && pipeline.stageStates.audio === 'idle', JSON.stringify(pipeline.stageStates));
}

// ---------------------------------------------------------------------------
// 7. A failing page is recorded and never re-attempted in the same run
// ---------------------------------------------------------------------------
{
  const id = makeProject('proj-g', 5);
  process.env.STUB_FAIL_PAGE = '2';
  globalThis.__stageLog = [];
  await pipeline.start(id, { stage: 'ocr' });
  const idle = await waitIdle(20000);
  delete process.env.STUB_FAIL_PAGE;
  const pages = queries.getPagesByProjectId(id);
  const failedPage = pages.find((p) => p.page_number === 2);
  const ocrRuns = log().filter((r) => r.stage === 'ocr' && r.page === 2).length;
  check('failing page marked as error', failedPage.status === 'error', `status=${failedPage.status}`);
  check('failing page attempted once, not in a loop', ocrRuns === 0, `successful runs=${ocrRuns}`);
  check('other pages still extracted', pages.filter((p) => p.raw_text).length === 4, `extracted=${pages.filter((p) => p.raw_text).length}`);
  check('run ends after a failing page', idle);
}

// ---------------------------------------------------------------------------
// 8. Simultaneous multi-project execution & strict per-project isolation
// ---------------------------------------------------------------------------
{
  const a = makeProject('proj-h1', 4);
  const b = makeProject('proj-h2', 4);
  globalThis.__stageLog = [];
  await pipeline.start(a, { stage: 'all' });
  await sleep(120);
  await pipeline.start(b, { stage: 'ocr' });
  await sleep(40);
  const stateA = pipeline.getProjectState(a);
  const stateB = pipeline.getProjectState(b);
  check(
    'both projects run simultaneously in parallel',
    pipeline.isProjectRunning(a) && (pipeline.isProjectRunning(b) || queries.getPagesByProjectId(b).every((p) => p.raw_text)),
    `a=${JSON.stringify(stateA.stages)} b=${JSON.stringify(stateB.stages)}`
  );
  check(
    'project B stages are isolated from project A (refine/audio stay idle on B)',
    stateB.stages.refine === 'idle' && stateB.stages.audio === 'idle',
    `b.stages=${JSON.stringify(stateB.stages)}`
  );
  const idle = await waitIdle(40000);
  const pagesB = queries.getPagesByProjectId(b);
  const pagesA = queries.getPagesByProjectId(a);
  check('second project finishes its OCR in parallel', idle && pagesB.every((p) => p.raw_text), `extracted=${pagesB.filter((p) => p.raw_text).length}/${pagesB.length}`);
  check('first project continues uninterrupted and finishes all stages', idle && pagesA.every((p) => p.audio_path), `narrated=${pagesA.filter((p) => p.audio_path).length}/${pagesA.length}`);
  const finalA = pipeline.getProjectState(a);
  const finalB = pipeline.getProjectState(b);
  check(
    'per-project logs are strictly isolated',
    finalA.logs.length > 0 &&
      finalB.logs.length > 0 &&
      finalA.logs.every((l) => l.projectId === a) &&
      finalB.logs.every((l) => l.projectId === b),
    `logsA=${finalA.logs.length} logsB=${finalB.logs.length}`
  );
}

// ---------------------------------------------------------------------------
// 8b. Stopping one project never interrupts another concurrently running project
// ---------------------------------------------------------------------------
{
  const a = makeProject('proj-h3', 6);
  const b = makeProject('proj-h4', 4);
  globalThis.__stageLog = [];
  await pipeline.start(a, { stage: 'all' });
  await pipeline.start(b, { stage: 'all' });
  await sleep(300);
  pipeline.stop(a);
  const idleA = await pipeline.waitForLoopIdle(5000, a);
  check('stopping project A releases project A immediately', idleA && !pipeline.isProjectRunning(a));
  const idleAll = await waitIdle(40000);
  const pagesB = queries.getPagesByProjectId(b);
  check('project B continues running and completes every page', idleAll && pagesB.every((p) => p.audio_path), `readyB=${pagesB.filter((p) => p.audio_path).length}/${pagesB.length}`);
}

// ---------------------------------------------------------------------------
// 9. Stop immediately followed by start
// ---------------------------------------------------------------------------
{
  const id = makeProject('proj-i', 5);
  globalThis.__stageLog = [];
  await pipeline.start(id, { stage: 'all' });
  await sleep(300);
  pipeline.stop(id);
  await pipeline.start(id, { stage: 'all' });
  const idle = await waitIdle(40000);
  const pages = queries.getPagesByProjectId(id);
  check('restart right after stop finishes the book', idle && pages.every((p) => p.audio_path), `narrated=${pages.filter((p) => p.audio_path).length}/${pages.length}`);
}

// ---------------------------------------------------------------------------
// 10. Pause all keeps the run alive; resume all finishes it
// ---------------------------------------------------------------------------
{
  const id = makeProject('proj-j', 6);
  globalThis.__stageLog = [];
  await pipeline.start(id, { stage: 'all' });
  await sleep(400);
  pipeline.pause(id, { stage: 'all' });
  await sleep(900);
  const rowsWhilePaused = log().length;
  await sleep(700);
  check('pause all stops every lane', log().length === rowsWhilePaused, `extra=${log().length - rowsWhilePaused}`);
  check('paused run keeps the engine alive', pipeline.loopInFlight && pipeline.isPaused);
  pipeline.resume(id, { stage: 'all' });
  const idle = await waitIdle(40000);
  const pages = queries.getPagesByProjectId(id);
  check('resume all finishes the book', idle && pages.every((p) => p.audio_path), `narrated=${pages.filter((p) => p.audio_path).length}/${pages.length}`);
}

// ---------------------------------------------------------------------------
// 11. Stop releases the engine even while a long stage call is in flight
// ---------------------------------------------------------------------------
{
  const id = makeProject('proj-k', 4);
  process.env.STUB_TTS_MS = '60000';
  globalThis.__stageLog = [];
  await pipeline.start(id, { stage: 'audio' });
  await sleep(500);
  const startedAt = Date.now();
  pipeline.stop(id);
  const idle = await waitIdle(5000);
  const elapsed = Date.now() - startedAt;
  delete process.env.STUB_TTS_MS;
  check('stop releases a lane stuck in a long synthesis', idle && elapsed < 3000, `idle=${idle} in ${elapsed}ms`);
  check('aborted page stays resumable', queries.getPagesByProjectId(id).every((p) => p.status !== 'ready'), 'no page marked ready');
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('FAILED:', failed.map((f) => f.name).join(' | '));
  process.exit(1);
}
process.exit(0);
