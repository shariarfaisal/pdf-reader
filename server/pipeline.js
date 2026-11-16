import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { queries } from './db.js';
import { extractPageText, renderPdfPage } from './ocr.js';
import { refineNarrationText } from './refiner.js';
import { synthesizeAudio, abortActiveSynthesis } from './tts.js';
import { rulesForPage, rulesStamp, applyTextRules } from './textRules.js';
import { backupPageAudio, driveBackupEnabled, enforceCacheBudget, freeAfterUploadEnabled, releaseLocalIfVerified } from './audioStore.js';

let cachedUsedMemMB = null;
let cachedUsedMemAt = 0;

function getActualUsedMemoryMB(totalMemBytes) {
  const now = Date.now();
  if (cachedUsedMemMB !== null && now - cachedUsedMemAt < 2000) {
    return cachedUsedMemMB;
  }
  if (process.platform === 'darwin') {
    try {
      const out = execSync('vm_stat', { encoding: 'utf8', timeout: 1000 });
      const pageSizeMatch = out.match(/page size of (\d+) bytes/);
      const pageSize = pageSizeMatch ? parseInt(pageSizeMatch[1], 10) : 16384;
      const getPages = (label) => {
        const m = out.match(new RegExp(`${label}:\\s+(\\d+)\\.`));
        return m ? parseInt(m[1], 10) : 0;
      };
      const active = getPages('Pages active');
      const wired = getPages('Pages wired down');
      const compressed = getPages('Pages occupied by compressor');
      const usedBytes = (active + wired + compressed) * pageSize;
      if (usedBytes > 0) {
        cachedUsedMemMB = Math.min(
          Math.round(totalMemBytes / (1024 * 1024)),
          Math.round(usedBytes / (1024 * 1024))
        );
        cachedUsedMemAt = now;
        return cachedUsedMemMB;
      }
    } catch {}
  }
  cachedUsedMemMB = Math.round((totalMemBytes - os.freemem()) / (1024 * 1024));
  cachedUsedMemAt = now;
  return cachedUsedMemMB;
}

// Reading order of the stages. Each one runs in its own lane (see runStageLane),
// so they advance in parallel instead of page-by-page; `STAGE_DEPS` only says
// which earlier artifact a stage needs, never that it has to wait for the whole
// previous stage to finish.
const STAGES = ['ocr', 'refine', 'audio'];
const STAGE_LABELS = {
  ocr: 'OCR extraction',
  refine: 'Narration script refinement',
  audio: 'Audio synthesis'
};
// A later stage cannot run without its inputs; those are picked up as
// dependencies unless the user explicitly paused them.
const STAGE_DEPS = { ocr: [], refine: ['ocr'], audio: ['ocr', 'refine'] };
// The stage whose artifact a lane consumes: lanes wait on these, not on the
// whole pipeline, which is what makes the stages independent.
const STAGE_PRODUCER = { refine: 'ocr', audio: 'refine' };
// idle | running | paused | completed
const STAGE_STATES = ['idle', 'running', 'paused', 'completed'];

const MAX_PROJECT_LOGS = 300;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Settle as soon as the run is aborted.
 *
 * A long synthesis (Colab provisioning can take minutes) must not keep the
 * engine busy after Stop: the lane is released, the abandoned call keeps
 * running in the background and its result is simply discarded.
 */
function raceAbort(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new Error('cancelled by user'));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new Error('cancelled by user'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      }
    );
  });
}

/** Setting keys whose value differs between two reads (names only, no values). */
function changedSettingKeys(previous = {}, next = {}) {
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
  const changed = [];
  for (const key of keys) {
    if (previous[key] !== next[key]) changed.push(key);
  }
  return changed.sort();
}

/**
 * Mutual exclusion between the two local heavy stages (OCR render/extract and
 * TTS synthesis) within a project. Lanes wait here instead of blocking each
 * other's whole page, and the OCR lane has priority: a voice model never
 * starves text extraction.
 */
class StageGate {
  constructor() {
    this.heldBy = null;
  }

  async acquire(stage, { priority = 1, shouldYield = null } = {}) {
    for (;;) {
      if (!this.heldBy) {
        if (priority > 0 && shouldYield && shouldYield()) {
          await new Promise((resolve) => setTimeout(resolve, 60));
          continue;
        }
        this.heldBy = stage;
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
  }

  release(stage) {
    if (this.heldBy === stage) this.heldBy = null;
  }
}

/**
 * Bounded semaphore for cross-project native OCR processes so multiple projects
 * execute OCR in parallel across CPU cores without saturating an 8 GB M2 Mac.
 */
class ConcurrencyPool {
  constructor(limit = 4) {
    this.limit = limit;
    this.active = 0;
    this.queue = [];
  }

  async acquire() {
    if (this.active < this.limit) {
      this.active += 1;
      return;
    }
    await new Promise((resolve) => this.queue.push(resolve));
    this.active += 1;
  }

  release() {
    this.active = Math.max(0, this.active - 1);
    const next = this.queue.shift();
    if (next) next();
  }
}

/**
 * Isolated per-project pipeline runner.
 * Each project owns its own stage states, intents, active page pointers, logs,
 * and execution lanes so multiple projects can run simultaneously without
 * bleeding state or interrupting one another.
 */
class ProjectPipelineRunner {
  constructor(projectId, engine) {
    this.projectId = projectId;
    this.engine = engine;
    this.loopInFlight = false;
    this.runToken = 0;
    this.finishingRun = false;
    this.activeRun = null;
    this.stepMode = false;
    this.stageStates = { ocr: 'idle', refine: 'idle', audio: 'idle' };
    this.stageIntent = { ocr: false, refine: false, audio: false };
    this.activeRuns = { ocr: null, refine: null, audio: null };
    this.logs = [];
  }

  get isRunning() {
    return STAGES.some((stage) => this.stageStates[stage] === 'running');
  }

  get isPaused() {
    return STAGES.some((stage) => this.stageStates[stage] === 'paused');
  }

  get stageTarget() {
    const running = STAGES.filter((stage) => this.stageStates[stage] === 'running');
    if (running.length === STAGES.length) return 'all';
    return running[0] || 'all';
  }

  snapshot() {
    return {
      projectId: this.projectId,
      isRunning: this.isRunning,
      isPaused: this.isPaused,
      stageTarget: this.stageTarget,
      stages: { ...this.stageStates },
      activeRuns: { ...this.activeRuns },
      loopInFlight: this.loopInFlight
    };
  }

  log(level, message, details = null) {
    this.engine.log(level, message, details, this.projectId);
  }

  appendLog(entry) {
    this.logs.push(entry);
    if (this.logs.length > MAX_PROJECT_LOGS) {
      this.logs.splice(0, this.logs.length - MAX_PROJECT_LOGS);
    }
  }

  clearLogs() {
    this.logs = [];
  }

  setStageState(stage, state) {
    if (!STAGES.includes(stage) || !STAGE_STATES.includes(state)) return;
    this.stageStates[stage] = state;
    if (state !== 'running') {
      this.activeRuns[stage] = null;
    }
  }

  setStageIntent(stage, intent) {
    if (!STAGES.includes(stage)) return;
    this.stageIntent[stage] = Boolean(intent);
  }

  resetStages() {
    for (const stage of STAGES) {
      this.stageStates[stage] = 'idle';
      this.stageIntent[stage] = false;
      this.activeRuns[stage] = null;
    }
  }

  broadcastStages() {
    this.engine.broadcast({
      type: 'stage_status',
      projectId: this.projectId,
      stages: { ...this.stageStates },
      activeRuns: { ...this.activeRuns },
      stageTarget: this.stageTarget,
      timestamp: Date.now()
    });
  }

  syncProjectStatus() {
    const projectId = this.projectId;
    if (!projectId) return;
    let status = this.isRunning ? 'running' : this.isPaused ? 'paused' : 'idle';
    // A finished book must not be demoted to idle by the engine winding down.
    if (status === 'idle' && queries.getProjectById(projectId)?.status === 'completed') status = 'completed';
    queries.updateProjectStatus(projectId, status);
    this.engine.broadcast({
      type: 'project_status',
      projectId,
      status,
      stageTarget: this.stageTarget,
      stages: { ...this.stageStates },
      activeRuns: { ...this.activeRuns }
    });
  }

  laneActive(stage) {
    if (this.stageStates[stage] === 'paused') return false;
    if (this.stageStates[stage] === 'running') return true;
    if (this.stageIntent[stage]) return true;
    return this.stageAllowed(stage);
  }

  stageAllowed(stage) {
    const state = this.stageStates[stage];
    if (state === 'running') return true;
    if (state === 'paused') return false;
    return STAGES.some(
      (other) => other !== stage && this.stageStates[other] === 'running' && STAGE_DEPS[other].includes(stage)
    );
  }

  async waitForLoopIdle(timeoutMs = 4000) {
    const started = Date.now();
    while (this.loopInFlight && Date.now() - started < timeoutMs) await sleep(80);
    return !this.loopInFlight;
  }

  async start(options = {}) {
    const projectId = this.projectId;
    const requested = this.engine.stagesOf(options.stage || 'all');

    if (this.loopInFlight && !this.finishingRun) {
      // Same project, lanes still alive: switch the requested stages back on.
      for (const stage of requested) {
        this.setStageState(stage, 'running');
        this.setStageIntent(stage, true);
      }
      this.stepMode = false;
      queries.updateProjectStatus(projectId, 'running');
      this.broadcastStages();
      this.syncProjectStatus();
      this.log('info', `Stages started: ${requested.map((s) => STAGE_LABELS[s]).join(', ')}.`);
      return;
    }

    if (this.loopInFlight) {
      // This project's previous run is winding down; wait for it to finish cleanly.
      this.stop();
      await this.waitForLoopIdle(6000);
      if (this.loopInFlight) {
        this.log('warn', `Pipeline is still winding down — start ${projectId} again in a moment.`);
        return;
      }
    }

    this.stepMode = false;
    this.resetStages();
    for (const stage of requested) {
      this.setStageState(stage, 'running');
      this.setStageIntent(stage, true);
    }

    queries.updateProjectStatus(projectId, 'running');
    this.broadcastStages();
    this.engine.broadcast({
      type: 'project_status',
      projectId,
      status: 'running',
      stageTarget: this.stageTarget,
      stages: { ...this.stageStates },
      activeRuns: { ...this.activeRuns }
    });
    this.log('info', `Pipeline started for project ${projectId} [stages: ${requested.join(', ')}]`);

    this.runLoop(false, null).catch((err) => {
      this.log('error', `Pipeline execution error: ${err.message}`);
      queries.updateProjectStatus(projectId, 'error');
      this.resetStages();
      this.broadcastStages();
      this.engine.broadcast({
        type: 'project_status',
        projectId,
        status: 'error',
        error: err.message,
        stages: { ...this.stageStates },
        activeRuns: { ...this.activeRuns }
      });
    });
  }

  pause(options = {}) {
    const requested = this.engine.stagesOf(options.stage || 'all');
    let changed = false;
    for (const stage of requested) {
      if (this.stageStates[stage] === 'running') {
        this.setStageState(stage, 'paused');
        this.setStageIntent(stage, false);
        changed = true;
      }
    }
    if (!changed) return;
    this.broadcastStages();
    this.syncProjectStatus();
    this.log(
      'info',
      `Paused ${requested.filter((s) => this.stageStates[s] === 'paused').map((s) => STAGE_LABELS[s]).join(', ') || 'stages'}.`
    );
  }

  resume(options = {}) {
    if (!this.loopInFlight) {
      this.start({ stage: options.stage || 'all' });
      return;
    }
    const requested = this.engine.stagesOf(options.stage || 'all');
    for (const stage of requested) {
      if (this.stageStates[stage] === 'paused' || this.stageStates[stage] === 'completed') {
        this.setStageState(stage, 'running');
        this.setStageIntent(stage, true);
      }
    }
    this.broadcastStages();
    this.syncProjectStatus();
    this.log('info', `Resumed ${requested.map((s) => STAGE_LABELS[s]).join(', ')}.`);
  }

  async step(targetPageNumber = null, options = {}) {
    if (this.loopInFlight) {
      this.log('warn', `Cannot step while this project's pipeline is already active — pause or stop it first.`);
      return;
    }
    const projectId = this.projectId;
    const requested = this.engine.stagesOf(options.stage || 'all');
    this.stepMode = true;
    this.resetStages();
    for (const stage of requested) {
      this.setStageState(stage, 'running');
      this.setStageIntent(stage, true);
    }

    queries.updateProjectStatus(projectId, 'running');
    this.broadcastStages();
    this.engine.broadcast({
      type: 'project_status',
      projectId,
      status: 'running',
      stageTarget: this.stageTarget,
      stages: { ...this.stageStates },
      activeRuns: { ...this.activeRuns }
    });
    this.log('info', `Stepping page for project ${projectId} [stages: ${requested.join(', ')}]...`);

    this.runLoop(true, targetPageNumber).catch((err) => {
      this.log('error', `Step execution error: ${err.message}`);
      this.resetStages();
      this.broadcastStages();
      this.syncProjectStatus();
    });
  }

  stop() {
    const projectId = this.projectId;
    const wasActive = this.loopInFlight || this.isRunning || this.isPaused;
    this.resetStages();
    this.stepMode = false;
    this.runToken += 1;
    this.finishingRun = true;
    try {
      this.activeRun?.controller.abort();
    } catch {}
    // Only abort TTS work owned by this project (never interrupt another project's synthesis).
    abortActiveSynthesis(projectId);
    this.broadcastStages();
    queries.updateProjectStatus(projectId, 'idle');
    this.engine.broadcast({
      type: 'project_status',
      projectId,
      status: 'idle',
      stages: { ...this.stageStates },
      activeRuns: { ...this.activeRuns }
    });
    if (wasActive) {
      this.log('info', `Pipeline stopped for project ${projectId}`);
    }
  }

  pullSettings(previous, { pageNumber = null, stage = null } = {}) {
    const settings = queries.getSettings();
    if (!previous) return settings;

    const changed = changedSettingKeys(previous, settings);
    if (!changed.length) return settings;

    const shown = changed.slice(0, 6).join(', ');
    const more = changed.length > 6 ? ` +${changed.length - 6} more` : '';
    const where = stage
      ? `before ${STAGE_LABELS[stage]}`
      : pageNumber === null
        ? 'for the next page'
        : `for Page ${pageNumber + 1}`;
    this.log('info', `Settings updated (${shown}${more}) — applying ${where}.`);
    return settings;
  }

  async runLoop(singleStep = false, targetPageNumber = null) {
    if (this.loopInFlight) {
      this.log('warn', `Pipeline already busy for project ${this.projectId} — duplicate start ignored.`);
      return;
    }
    this.loopInFlight = true;
    try {
      await this._executeLoop(singleStep, targetPageNumber);
    } finally {
      this.loopInFlight = false;
      this.finishingRun = false;
      this.activeRun = null;
      this.activeRuns = { ocr: null, refine: null, audio: null };
      if (!singleStep) this.syncProjectStatus();
    }
  }

  async _executeLoop(singleStep = false, targetPageNumber = null) {
    const projectId = this.projectId;
    const project = queries.getProjectById(projectId);
    if (!project) {
      this.log('error', `Project ${projectId} not found.`);
      this.resetStages();
      this.broadcastStages();
      return;
    }

    const projectDir = path.resolve(process.cwd(), 'data', 'projects', projectId);
    const pagesDir = path.join(projectDir, 'pages');
    const audioDir = path.join(projectDir, 'audio');
    if (!fs.existsSync(pagesDir)) fs.mkdirSync(pagesDir, { recursive: true });
    if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });

    const controller = new AbortController();
    const ctx = {
      projectId,
      project,
      pagesDir,
      audioDir,
      singleStep,
      signal: controller.signal,
      epoch: ++this.runToken,
      finishing: false,
      targetPageNumber: singleStep && targetPageNumber !== null ? targetPageNumber : null,
      settings: this.pullSettings(null),
      gate: new StageGate(),
      skip: { ocr: new Set(), refine: new Set(), audio: new Set() },
      lane: {
        ocr: { alive: true, inFlight: 0, hasEligible: false, waiting: false, stalled: false },
        refine: { alive: true, inFlight: 0, hasEligible: false, waiting: false, stalled: false },
        audio: { alive: true, inFlight: 0, hasEligible: false, waiting: false, stalled: false }
      }
    };

    const active = STAGES.filter((stage) => this.laneActive(stage));
    this.finishingRun = false;
    this.activeRun = { projectId, controller };
    this.log(
      'info',
      `Pipeline lanes started for project ${projectId} [${active.map((s) => STAGE_LABELS[s]).join(' ∥ ') || 'none'}] — each stage advances independently.`
    );

    await Promise.all(STAGES.map((stage) => this.runStageLane(stage, ctx)));

    const allPages = queries.getPagesByProjectId(projectId);
    const completeStages = [];
    for (const stage of STAGES) {
      if (this.stageStates[stage] === 'running') this.setStageState(stage, 'idle');
      if (this.stageStates[stage] === 'completed') completeStages.push(stage);
      this.activeRuns[stage] = null;
    }
    if (singleStep) this.stepMode = false;
    this.broadcastStages();
    this.syncProjectStatus();

    if (completeStages.length) {
      this.log(
        'info',
        `All ${allPages.length} pages complete for ${completeStages.map((s) => STAGE_LABELS[s]).join(', ')}!`
      );
    }

    const readyCount = allPages.filter((p) => p.status === 'ready').length;
    if (!singleStep && allPages.length > 0 && readyCount === allPages.length) {
      queries.updateProjectStatus(projectId, 'completed');
      this.engine.broadcast({
        type: 'project_status',
        projectId,
        status: 'completed',
        stages: { ...this.stageStates },
        activeRuns: { ...this.activeRuns },
        progress: { total: allPages.length, ready: readyCount }
      });
    }
  }

  async runStageLane(stage, ctx) {
    const lane = ctx.lane[stage];
    lane.alive = true;
    try {
      for (;;) {
        if (this.runToken !== ctx.epoch) return;
        if (!this.laneActive(stage)) {
          lane.hasEligible = false;
          if (ctx.singleStep) return;
          if (this.maybeFinishRun(ctx)) return;
          await sleep(250);
          continue;
        }

        const pages = queries.getPagesByProjectId(ctx.projectId);
        const page = this.nextPageForStage(stage, pages, ctx);
        lane.hasEligible = Boolean(page);

        if (!page) {
          const verdict = this.classifyStageLane(stage, queries.getPagesByProjectId(ctx.projectId), ctx);
          lane.waiting = verdict === 'wait';
          lane.stalled = verdict === 'blocked';
          this.settleStageLane(stage, verdict, ctx);
          if (verdict === 'wait') {
            await sleep(200);
            continue;
          }
          if (ctx.singleStep) return;
          if (this.maybeFinishRun(ctx)) return;
          await sleep(300);
          continue;
        }
        lane.waiting = false;
        lane.stalled = false;

        if (this.stageStates[stage] !== 'running') {
          this.setStageState(stage, 'running');
          this.broadcastStages();
        }

        lane.inFlight += 1;
        this.activeRuns[stage] = page.page_number;
        try {
          await this.runStageOnPage(stage, ctx, page);
        } finally {
          if (this.activeRuns[stage] === page.page_number) {
            this.activeRuns[stage] = null;
          }
          lane.inFlight = Math.max(0, lane.inFlight - 1);
        }

        if (ctx.singleStep) return;

        const throttleDelay = parseInt(queries.getSettings().throttle_delay_ms || '500', 10);
        if (throttleDelay > 0) await sleep(throttleDelay);
      }
    } finally {
      this.activeRuns[stage] = null;
      lane.alive = false;
    }
  }

  maybeFinishRun(ctx) {
    if (ctx.finishing) return true;
    if (STAGES.some((stage) => this.stageStates[stage] === 'running' || this.stageStates[stage] === 'paused')) {
      return false;
    }
    if (STAGES.some((stage) => ctx.lane[stage].inFlight > 0)) return false;
    ctx.finishing = true;
    this.finishingRun = true;
    this.runToken += 1;
    return true;
  }

  nextPageForStage(stage, pages, ctx) {
    const skip = ctx.skip[stage];
    for (const page of pages) {
      if (ctx.targetPageNumber !== null && page.page_number !== ctx.targetPageNumber) continue;
      if (skip.has(page.page_number)) continue;
      if (!this.engine.pendingStagesForPage(page).includes(stage)) continue;
      if (!this.engine.stageInputReady(stage, page)) continue;
      return page;
    }
    return null;
  }

  classifyStageLane(stage, pages, ctx) {
    const skip = ctx.skip[stage];
    const pending = pages.filter(
      (page) => !skip.has(page.page_number) && this.engine.pendingStagesForPage(page).includes(stage)
    );
    if (!pending.length) return 'completed';
    const waitingOnInput = pending.some((page) => !this.engine.stageInputReady(stage, page));
    if (!waitingOnInput) return 'blocked';
    const producer = STAGE_PRODUCER[stage];
    if (producer && this.laneWorking(producer, ctx)) return 'wait';
    return 'blocked';
  }

  settleStageLane(stage, verdict, ctx) {
    if (verdict === 'wait') return;
    const next = verdict === 'completed' ? 'completed' : 'idle';
    const current = this.stageStates[stage];
    if (current === next) return;
    if (current !== 'running' && current !== 'completed') return;
    this.setStageState(stage, next);
    this.broadcastStages();
    this.syncProjectStatus();
    if (next === 'completed') {
      this.log('info', `${STAGE_LABELS[stage]}: every page is done.`);
    } else {
      this.log(
        'info',
        `${STAGE_LABELS[stage]}: no more input from ${STAGE_LABELS[STAGE_PRODUCER[stage]] || 'its producer'} — paused, done or stalled.`
      );
    }
  }

  laneWorking(stage, ctx) {
    const lane = ctx.lane[stage];
    if (!lane || !lane.alive) return false;
    if (this.stageStates[stage] === 'paused') return false;
    if (lane.inFlight > 0 || lane.hasEligible) return true;
    return Boolean(lane.waiting && !lane.stalled);
  }

  async acquireHeavy(ctx, stage, { priority = 1, shouldYield = null } = {}) {
    if (ctx.settings.pipeline_local_parallel === '1') return false;
    await ctx.gate.acquire(stage, { priority, shouldYield });
    return true;
  }

  async runStageOnPage(stage, ctx, page) {
    const { projectId } = ctx;
    const pageNum = page.page_number;
    const isCustom = page.page_type === 'custom';
    const pdfPageIndex = page.source_page !== null && page.source_page !== undefined ? page.source_page : pageNum;

    try {
      ctx.settings = this.pullSettings(ctx.settings, { pageNumber: pageNum, stage });
      queries.updateProjectStatus(projectId, 'running', pageNum);
      this.engine.broadcastSystemHealth();

      if (stage === 'ocr') await this.runOcrStage(ctx, page, { isCustom, pdfPageIndex });
      if (stage === 'refine') await this.runRefineStage(ctx, page, isCustom);
      if (stage === 'audio') await this.runAudioStage(ctx, page);
    } catch (pageErr) {
      if (!this.isRunning || pageErr.message.includes('cancelled by user')) {
        this.log('info', `Page ${pageNum + 1} ${STAGE_LABELS[stage].toLowerCase()} stopped cleanly.`);
        queries.upsertPage({ projectId, pageNumber: pageNum, status: 'pending', errorMessage: null });
        this.broadcastPageStatus(pageNum, 'pending', 'Paused / Ready to resume', stage);
      } else {
        this.log('error', `Page ${pageNum + 1} ${STAGE_LABELS[stage].toLowerCase()} failed: ${pageErr.message}`);
        queries.upsertPage({ projectId, pageNumber: pageNum, status: 'error', errorMessage: pageErr.message });
        this.broadcastPageStatus(pageNum, 'error', pageErr.message, stage);
      }
    } finally {
      ctx.skip[stage].add(pageNum);
    }
  }

  async runOcrStage(ctx, page, { isCustom, pdfPageIndex }) {
    const { projectId, project, pagesDir } = ctx;
    const pageNum = page.page_number;
    const renderPath = page.render_path || path.join(pagesDir, `page_${page.id}.png`);

    if (isCustom) {
      this.log('info', `[Page ${pageNum + 1}] Custom page — render & OCR skipped (text already available).`);
      if (!page.raw_text || !page.raw_text.trim()) {
        throw new Error('Custom page has no text. Edit the page and add content, then retry.');
      }
      return;
    }

    const gated = await this.acquireHeavy(ctx, 'ocr', { priority: 0 });
    await this.engine.ocrPool.acquire();
    try {
      if (!fs.existsSync(renderPath)) {
        this.broadcastPageStatus(pageNum, 'extracting', 'Rendering page canvas...', 'ocr');
        await renderPdfPage(project.pdf_path, pdfPageIndex, renderPath);
        queries.upsertPage({ projectId, pageNumber: pageNum, renderPath });
        page.render_path = renderPath;
      }

      this.broadcastPageStatus(pageNum, 'extracting', 'Extracting text & running OCR...', 'ocr');
      this.log('info', `[Page ${pageNum + 1}] Running OCR / text extraction...`);

      const extResult = await extractPageText(project.pdf_path, pdfPageIndex, renderPath, ctx.settings, {
        projectId,
        pageNumber: pageNum
      });
      page.raw_text = extResult.text;
      page.ocr_source = extResult.source;

      queries.upsertPage({
        projectId,
        pageNumber: pageNum,
        renderPath,
        rawText: extResult.text,
        ocrSource: extResult.source,
        status: 'extracting'
      });
      this.log(
        'info',
        `[Page ${pageNum + 1}] Text extracted (${extResult.text.length} chars, source: ${extResult.source})`
      );
    } finally {
      this.engine.ocrPool.release();
      if (gated) ctx.gate.release('ocr');
    }
  }

  async runRefineStage(ctx, page, isCustom) {
    const { projectId } = ctx;
    const pageNum = page.page_number;

    this.broadcastPageStatus(pageNum, 'refining', 'Refining narration script (stripping noise)...', 'refine');
    this.log('info', `[Page ${pageNum + 1}] Refining narration script...`);

    let script;
    if (isCustom) {
      script = page.raw_text || '';
      if (!script.trim()) {
        throw new Error('Custom page has no text. Edit the page and add content, then retry.');
      }
      this.log('info', `[Page ${pageNum + 1}] Using custom text as narration script (${script.length} chars).`);
    } else {
      script = await refineNarrationText(page.raw_text || '', ctx.settings, {
        projectId,
        pageNumber: pageNum
      });
    }

    const withRules = this.engine.applyRulesToPage(projectId, { ...page, refined_text: script }, script, { force: true });
    page.refined_text = withRules;

    queries.upsertPage({ projectId, pageNumber: pageNum, refinedText: withRules, status: 'refining' });
    this.log('info', `[Page ${pageNum + 1}] Narration refined (${withRules.length} chars)`);
  }

  async runAudioStage(ctx, page) {
    const { projectId, audioDir } = ctx;
    const pageNum = page.page_number;

    const ruledScript = this.engine.applyRulesToPage(projectId, page, page.refined_text);
    page.refined_text = ruledScript;

    queries.upsertPage({ projectId, pageNumber: pageNum, status: 'synthesizing' });
    this.log('info', `[Page ${pageNum + 1}] Synthesizing audio narration...`);

    const gated = await this.acquireHeavy(ctx, 'audio', {
      priority: 1,
      shouldYield: () => this.laneWorking('ocr', ctx)
    });

    try {
      this.broadcastPageStatus(pageNum, 'synthesizing', 'Synthesizing voice audio...', 'audio');
      const targetAudioPath = path.join(audioDir, `page_${page.id}.wav`);
      const ttsResult = await raceAbort(
        synthesizeAudio(ruledScript, targetAudioPath, ctx.settings, {
          projectId,
          signal: ctx.signal
        }),
        ctx.signal
      );

      page.audio_path = ttsResult.audioPath;
      page.audio_duration = ttsResult.duration;

      const audioTimings = Array.isArray(ttsResult.timings) && ttsResult.timings.length
        ? JSON.stringify(ttsResult.timings)
        : null;

      queries.upsertPage({
        projectId,
        pageNumber: pageNum,
        audioPath: ttsResult.audioPath,
        audioDuration: ttsResult.duration,
        audioTimings,
        status: 'ready'
      });
      this.log(
        'info',
        `[Page ${pageNum + 1}] Audio synthesized (${ttsResult.duration.toFixed(1)}s, voice: ${ttsResult.voice})`
      );
      this.broadcastPageStatus(pageNum, 'ready', 'Page complete & ready for playback', 'audio');

      // Backup failures keep the page playable from its local file; they never fail the stage.
      if (driveBackupEnabled()) {
        try {
          const driveId = await backupPageAudio({ ...page, project_id: projectId }, ttsResult.audioPath);
          this.log('info', `[Page ${pageNum + 1}] Audio backed up to Google Drive.`, null, projectId);
          if (freeAfterUploadEnabled()) {
            const freed = await releaseLocalIfVerified({ ...page, audio_drive_id: driveId }, ttsResult.audioPath);
            if (freed) this.log('info', `[Page ${pageNum + 1}] Local copy removed (verified on Drive).`, null, projectId);
          }
        } catch (err) {
          this.log('warn', `[Page ${pageNum + 1}] Google Drive backup failed, kept locally: ${err.message}`, null, projectId);
        }
      }
      enforceCacheBudget(ttsResult.audioPath);
    } finally {
      if (gated) ctx.gate.release('audio');
    }
  }

  broadcastPageStatus(pageNumber, status, stageDescription, stage = null) {
    if (stage) {
      const isWorkingStatus = status === 'extracting' || status === 'refining' || status === 'synthesizing';
      this.activeRuns[stage] = isWorkingStatus ? pageNumber : null;
    }
    this.engine.broadcast({
      type: 'page_status',
      projectId: this.projectId,
      pageNumber,
      status,
      stageDescription,
      stage: stage || null,
      activeRuns: { ...this.activeRuns },
      timestamp: Date.now()
    });
  }
}

class PipelineEngine {
  constructor() {
    this.runners = new Map();
    this.lastActiveProjectId = null;
    this.eventListeners = new Set();
    this.ocrPool = new ConcurrencyPool(4);
    this.reconcileStaleProjectsOnBoot();
  }

  /**
   * Reset any projects left in 'running' or 'paused' state from a previous
   * process crash/restart so the UI never displays phantom running badges.
   */
  reconcileStaleProjectsOnBoot() {
    try {
      const all = queries.getAllProjects();
      for (const proj of all) {
        if (proj.status === 'running' || proj.status === 'paused') {
          queries.updateProjectStatus(proj.id, 'idle');
        }
      }
    } catch {}
  }

  getRunner(projectId) {
    if (!projectId) return null;
    let runner = this.runners.get(projectId);
    if (!runner) {
      runner = new ProjectPipelineRunner(projectId, this);
      this.runners.set(projectId, runner);
    }
    return runner;
  }

  get activeProjectId() {
    if (this.lastActiveProjectId) {
      const last = this.runners.get(this.lastActiveProjectId);
      if (last && (last.isRunning || last.isPaused || last.loopInFlight)) {
        return this.lastActiveProjectId;
      }
    }
    for (const [id, runner] of this.runners.entries()) {
      if (runner.isRunning || runner.isPaused || runner.loopInFlight) {
        return id;
      }
    }
    return this.lastActiveProjectId;
  }

  set activeProjectId(id) {
    this.lastActiveProjectId = id;
  }

  get isRunning() {
    for (const runner of this.runners.values()) {
      if (runner.isRunning) return true;
    }
    return false;
  }

  get isPaused() {
    for (const runner of this.runners.values()) {
      if (runner.isPaused) return true;
    }
    return false;
  }

  get loopInFlight() {
    for (const runner of this.runners.values()) {
      if (runner.loopInFlight) return true;
    }
    return false;
  }

  get stageStates() {
    const activeId = this.activeProjectId;
    if (activeId && this.runners.has(activeId)) {
      return this.runners.get(activeId).stageStates;
    }
    return { ocr: 'idle', refine: 'idle', audio: 'idle' };
  }

  get stageTarget() {
    const activeId = this.activeProjectId;
    if (activeId && this.runners.has(activeId)) {
      return this.runners.get(activeId).stageTarget;
    }
    return 'all';
  }

  isProjectRunning(projectId) {
    const runner = this.runners.get(projectId);
    return Boolean(runner && runner.isRunning);
  }

  isProjectInFlight(projectId) {
    const runner = this.runners.get(projectId);
    return Boolean(runner && runner.loopInFlight);
  }

  getProjectState(projectId) {
    const runner = this.getRunner(projectId);
    if (!runner) {
      return {
        projectId: null,
        isRunning: false,
        isPaused: false,
        loopInFlight: false,
        stageTarget: 'all',
        stages: { ocr: 'idle', refine: 'idle', audio: 'idle' },
        activeRuns: { ocr: null, refine: null, audio: null },
        logs: []
      };
    }
    return {
      ...runner.snapshot(),
      logs: [...runner.logs]
    };
  }

  allProjectSnapshots() {
    const map = {};
    for (const [id, runner] of this.runners.entries()) {
      map[id] = runner.snapshot();
    }
    return map;
  }

  snapshot(projectId = null) {
    if (projectId) {
      return {
        ...this.getRunner(projectId).snapshot(),
        projects: this.allProjectSnapshots()
      };
    }
    return {
      activeProjectId: this.activeProjectId,
      isRunning: this.isRunning,
      isPaused: this.isPaused,
      stageTarget: this.stageTarget,
      stages: { ...this.stageStates },
      loopInFlight: this.loopInFlight,
      projects: this.allProjectSnapshots()
    };
  }

  // SSE Subscription
  subscribe(listener) {
    this.eventListeners.add(listener);
    listener({ type: 'engine_state', ...this.snapshot() });
    return () => this.eventListeners.delete(listener);
  }

  broadcast(event) {
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch {
        this.eventListeners.delete(listener);
      }
    }
  }

  log(level, message, details = null, projectId = null) {
    const prefix = projectId ? `[Pipeline:${projectId}]` : '[Pipeline]';
    console.log(`${prefix} [${level.toUpperCase()}] ${message}`);
    const entry = {
      type: 'log',
      projectId: projectId || null,
      level,
      message,
      details,
      timestamp: Date.now()
    };
    if (projectId) {
      this.getRunner(projectId)?.appendLog(entry);
    }
    this.broadcast(entry);
  }

  clearProjectLogs(projectId) {
    if (!projectId) return;
    const runner = this.runners.get(projectId);
    if (runner) runner.clearLogs();
    this.broadcast({
      type: 'logs_cleared',
      projectId,
      timestamp: Date.now()
    });
  }

  broadcastSystemHealth() {
    const totalMem = os.totalmem();
    const totalMemMB = Math.round(totalMem / (1024 * 1024));
    const usedMemMB = getActualUsedMemoryMB(totalMem);
    const freeMemMB = Math.max(0, totalMemMB - usedMemMB);
    const loadAvg = os.loadavg();
    const cpuCount = os.cpus().length;

    this.broadcast({
      type: 'system_health',
      cpuCount,
      load1m: loadAvg[0].toFixed(2),
      load5m: loadAvg[1].toFixed(2),
      totalMemMB,
      freeMemMB,
      usedMemMB,
      memPercent: Math.round((usedMemMB / totalMemMB) * 100)
    });
  }

  /** 'all' | 'ocr' | 'refine' | 'audio' -> array of stage names. */
  stagesOf(stage) {
    if (!stage || stage === 'all') return [...STAGES];
    return STAGES.includes(stage) ? [stage] : [...STAGES];
  }

  async start(projectId, options = {}) {
    if (!projectId) return;
    this.lastActiveProjectId = projectId;
    const runner = this.getRunner(projectId);
    await runner.start(options);
  }

  pause(projectId, options = {}) {
    if (!projectId) return;
    const runner = this.runners.get(projectId);
    if (!runner) return;
    runner.pause(options);
  }

  resume(projectId, options = {}) {
    if (!projectId) return;
    this.lastActiveProjectId = projectId;
    const runner = this.getRunner(projectId);
    runner.resume(options);
  }

  async step(projectId, targetPageNumber = null, options = {}) {
    if (!projectId) return;
    this.lastActiveProjectId = projectId;
    const runner = this.getRunner(projectId);
    await runner.step(targetPageNumber, options);
  }

  stop(projectId = null) {
    if (projectId) {
      const runner = this.runners.get(projectId);
      if (runner) {
        runner.stop();
      } else {
        queries.updateProjectStatus(projectId, 'idle');
        this.broadcast({
          type: 'project_status',
          projectId,
          status: 'idle',
          stages: { ocr: 'idle', refine: 'idle', audio: 'idle' },
          activeRuns: { ocr: null, refine: null, audio: null }
        });
      }
      return;
    }

    // Global stop fallback when no projectId is given
    for (const runner of this.runners.values()) {
      if (runner.loopInFlight || runner.isRunning || runner.isPaused) {
        runner.stop();
      }
    }
  }

  /**
   * Poll until the specified project (or all projects when projectId is omitted)
   * has no lane in flight.
   */
  async waitForLoopIdle(timeoutMs = 4000, projectId = null) {
    if (projectId) {
      const runner = this.runners.get(projectId);
      if (!runner) return true;
      return runner.waitForLoopIdle(timeoutMs);
    }
    const started = Date.now();
    while (this.loopInFlight && Date.now() - started < timeoutMs) await sleep(80);
    return !this.loopInFlight;
  }

  /** Which stages still have work to do on this page. */
  pendingStagesForPage(page) {
    const isCustom = page.page_type === 'custom';
    const missing = [];
    if (!isCustom && !(page.raw_text && page.raw_text.trim())) missing.push('ocr');
    if (!(page.refined_text && page.refined_text.trim())) missing.push('refine');
    const hasLocalAudio = Boolean(page.audio_path && fs.existsSync(page.audio_path));
    const hasDriveAudio = Boolean(page.audio_path && page.audio_drive_id);
    if (!hasLocalAudio && !hasDriveAudio) missing.push('audio');
    return missing;
  }

  /** Does the page already carry the artifact this stage consumes? */
  stageInputReady(stage, page) {
    if (stage === 'ocr') return true;
    if (stage === 'refine') return Boolean((page.raw_text || '').trim());
    return Boolean((page.refined_text || '').trim());
  }

  /**
   * Apply the project's find/replace rules to one page's narration script.
   * Rules are stamped per page, so a cached script is only rewritten once per
   * rule change. Rewritten scripts invalidate the audio that no longer matches.
   */
  applyRulesToPage(projectId, page, text, { force = false } = {}) {
    if (!text || !text.trim()) return text;
    const applicable = rulesForPage(queries.listTextRules(projectId), page.page_number);
    if (!applicable.length) return text;

    const stamp = rulesStamp(applicable);
    if (!force && Number(page.text_rules_stamp || 0) === stamp) return text;

    const { text: next, applied } = applyTextRules(text, applicable);
    if (next === text) {
      queries.setPageRulesStamp(projectId, page.page_number, stamp);
      return text;
    }

    // Audio for the old script is stale whether it lives locally, on Drive, or both.
    const clearedAudio = Boolean(page.audio_path);
    if (page.audio_path && fs.existsSync(page.audio_path)) {
      try {
        fs.unlinkSync(page.audio_path);
      } catch (err) {
        this.log('warn', `[Page ${page.page_number + 1}] Could not remove stale audio: ${err.message}`, null, projectId);
      }
    }

    queries.updatePageText(projectId, page.page_number, { refinedText: next, clearAudio: clearedAudio });
    queries.setPageRulesStamp(projectId, page.page_number, stamp);
    const replacements = applied.reduce((sum, item) => sum + item.count, 0);
    this.log(
      'info',
      `[Page ${page.page_number + 1}] Text rules applied (${replacements} replacement${replacements === 1 ? '' : 's'})${clearedAudio ? ' — audio regenerates' : ''}.`,
      null,
      projectId
    );
    return next;
  }

  /**
   * Bulk rule application for the API: rewrite every stored script that the
   * current rules affect. Returns how many pages changed and how much audio went
   * stale. Runs in one pass over the pages, no LLM / TTS calls.
   */
  applyRulesToProject(projectId, { pageNumbers = null } = {}) {
    const pages = queries.getPagesByProjectId(projectId).filter((page) => {
      if (!pageNumbers) return true;
      return pageNumbers.includes(page.page_number);
    });
    let changed = 0;
    let audioCleared = 0;
    for (const page of pages) {
      if (!page.refined_text || !page.refined_text.trim()) continue;
      const before = page.refined_text;
      const after = this.applyRulesToPage(projectId, page, before);
      if (after !== before) {
        changed += 1;
        if (page.audio_path) audioCleared += 1;
      }
    }
    return { pages: pages.length, changed, audioCleared };
  }

  broadcastPageStatus(projectId, pageNumber, status, stageDescription, stage = null) {
    const runner = projectId ? this.getRunner(projectId) : null;
    if (runner) {
      runner.broadcastPageStatus(pageNumber, status, stageDescription, stage);
      return;
    }
    this.broadcast({
      type: 'page_status',
      projectId,
      pageNumber,
      status,
      stageDescription,
      stage: stage || null,
      timestamp: Date.now()
    });
  }
}

export const pipeline = new PipelineEngine();
