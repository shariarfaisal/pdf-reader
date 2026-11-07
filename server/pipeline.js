import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { queries } from './db.js';
import { extractPageText, renderPdfPage } from './ocr.js';
import { refineNarrationText } from './refiner.js';
import { synthesizeAudio, abortActiveSynthesis } from './tts.js';
import { rulesForPage, rulesStamp, applyTextRules } from './textRules.js';

function getActualUsedMemoryMB(totalMemBytes) {
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
        return Math.min(Math.round(totalMemBytes / (1024 * 1024)), Math.round(usedBytes / (1024 * 1024)));
      }
    } catch {}
  }
  return Math.round((totalMemBytes - os.freemem()) / (1024 * 1024));
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

/** Stable signature of a settings map (used to detect live edits). */
function settingsSignature(settings = {}) {
  return Object.keys(settings)
    .sort()
    .map((key) => `${key}=${settings[key]}`)
    .join('\u0000');
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
 * TTS synthesis). Lanes wait here instead of blocking each other's whole page,
 * and the OCR lane has priority: a voice model never starves text extraction.
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

class PipelineEngine {
  constructor() {
    this.activeProjectId = null;
    this.loopInFlight = false;
    // Bumped by stop() and at the start of every run: a lane exits as soon as
    // the token it was born with is stale, so no worker survives its run.
    this.runToken = 0;
    this.finishingRun = false;
    // Controller of the run in flight, so stop() can release a lane instantly.
    this.activeRun = null;
    this.stepMode = false;
    this.stageStates = { ocr: 'idle', refine: 'idle', audio: 'idle' };
    // A stage the user started keeps following its input even after its lane
    // settled to `idle` because that input was paused at the time.
    this.stageIntent = { ocr: false, refine: false, audio: false };
    this.eventListeners = new Set();
  }

  get isRunning() {
    return STAGES.some((stage) => this.stageStates[stage] === 'running');
  }

  get isPaused() {
    return STAGES.some((stage) => this.stageStates[stage] === 'paused');
  }

  /** Legacy single-stage view: 'all' when every stage is active. */
  get stageTarget() {
    const running = STAGES.filter((stage) => this.stageStates[stage] === 'running');
    if (running.length === STAGES.length) return 'all';
    return running[0] || 'all';
  }

  snapshot() {
    return {
      activeProjectId: this.activeProjectId,
      isRunning: this.isRunning,
      isPaused: this.isPaused,
      stageTarget: this.stageTarget,
      stages: { ...this.stageStates },
      loopInFlight: this.loopInFlight
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
        // drop failing listener
        this.eventListeners.delete(listener);
      }
    }
  }

  broadcastStages() {
    this.broadcast({
      type: 'stage_status',
      projectId: this.activeProjectId,
      stages: { ...this.stageStates },
      stageTarget: this.stageTarget,
      timestamp: Date.now()
    });
  }

  log(level, message, details = null) {
    console.log(`[Pipeline] [${level.toUpperCase()}] ${message}`);
    this.broadcast({
      type: 'log',
      level,
      message,
      details,
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

  setStageState(stage, state) {
    if (!STAGES.includes(stage) || !STAGE_STATES.includes(state)) return;
    this.stageStates[stage] = state;
  }

  setStageIntent(stage, intent) {
    if (!STAGES.includes(stage)) return;
    this.stageIntent[stage] = Boolean(intent);
  }

  resetStages() {
    for (const stage of STAGES) {
      this.stageStates[stage] = 'idle';
      this.stageIntent[stage] = false;
    }
  }

  /**
   * Should this stage's lane be looking for work?
   *
   * Running = yes. Idle/completed = only when the user asked for that stage
   * (so it can follow its input again once a paused producer resumes) or when a
   * running later stage needs it as a dependency. Paused = never.
   */
  laneActive(stage) {
    if (this.stageStates[stage] === 'paused') return false;
    if (this.stageStates[stage] === 'running') return true;
    if (this.stageIntent[stage]) return true;
    return this.stageAllowed(stage);
  }

  /**
   * Project status is derived from the stage states so the inspector badge and
   * the page toolbar agree: any running stage = running, only pauses = paused.
   */
  syncProjectStatus(projectId) {
    if (!projectId) return;
    let status = this.isRunning ? 'running' : this.isPaused ? 'paused' : 'idle';
    // A finished book must not be demoted to idle by the engine winding down.
    if (status === 'idle' && queries.getProjectById(projectId)?.status === 'completed') status = 'completed';
    queries.updateProjectStatus(projectId, status);
    this.broadcast({
      type: 'project_status',
      projectId,
      status,
      stageTarget: this.stageTarget,
      stages: { ...this.stageStates }
    });
  }

  async start(projectId, options = {}) {
    const requested = this.stagesOf(options.stage || 'all');

    if (this.loopInFlight && this.activeProjectId === projectId && !this.finishingRun) {
      // Same project, lanes still alive: just switch the requested stages back on.
      // Everything else keeps its current state — that is what lets OCR keep
      // running while the Script lane is started behind it.
      for (const stage of requested) {
        this.setStageState(stage, 'running');
        this.setStageIntent(stage, true);
      }
      this.stepMode = false;
      queries.updateProjectStatus(projectId, 'running');
      this.broadcastStages();
      this.syncProjectStatus(projectId);
      this.log('info', `Stages started: ${requested.map((s) => STAGE_LABELS[s]).join(', ')}.`);
      return;
    }

    if (this.loopInFlight) {
      // The previous run (another project, or this one already winding down) has
      // to release the engine first: an in-flight OCR page holds its lane until
      // the extraction returns, and its writes must not race the new run.
      this.stop(this.activeProjectId);
      await this.waitForLoopIdle(6000);
      if (this.loopInFlight) {
        this.log('warn', `Pipeline is still winding down — start ${projectId} again in a moment.`);
        return;
      }
    }

    this.activeProjectId = projectId;
    this.stepMode = false;
    this.resetStages();
    for (const stage of requested) {
      this.setStageState(stage, 'running');
      this.setStageIntent(stage, true);
    }

    queries.updateProjectStatus(projectId, 'running');
    this.broadcastStages();
    this.broadcast({
      type: 'project_status',
      projectId,
      status: 'running',
      stageTarget: this.stageTarget,
      stages: { ...this.stageStates }
    });
    this.log('info', `Pipeline started for project ${projectId} [stages: ${requested.join(', ')}]`);

    this.runLoop(projectId, false, null, {}).catch((err) => {
      this.log('error', `Pipeline execution error: ${err.message}`);
      queries.updateProjectStatus(projectId, 'error');
      this.resetStages();
      this.broadcastStages();
      this.broadcast({ type: 'project_status', projectId, status: 'error', error: err.message });
    });
  }

  /** Poll until no lane is in flight any more (bounded). */
  async waitForLoopIdle(timeoutMs = 4000) {
    const started = Date.now();
    while (this.loopInFlight && Date.now() - started < timeoutMs) await sleep(120);
    return !this.loopInFlight;
  }

  pause(projectId, options = {}) {
    if (this.activeProjectId !== projectId) return;
    const requested = this.stagesOf(options.stage || 'all');
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
    this.syncProjectStatus(projectId);
    this.log(
      'info',
      `Paused ${requested.filter((s) => this.stageStates[s] === 'paused').map((s) => STAGE_LABELS[s]).join(', ') || 'stages'}.`
    );
  }

  resume(projectId, options = {}) {
    if (this.activeProjectId !== projectId || !this.loopInFlight) {
      // Nothing in flight for this project (e.g. after a reload): start it.
      this.start(projectId, { stage: options.stage || 'all' });
      return;
    }
    const requested = this.stagesOf(options.stage || 'all');
    for (const stage of requested) {
      if (this.stageStates[stage] === 'paused' || this.stageStates[stage] === 'completed') {
        this.setStageState(stage, 'running');
        this.setStageIntent(stage, true);
      }
    }
    this.broadcastStages();
    this.syncProjectStatus(projectId);
    this.log('info', `Resumed ${requested.map((s) => STAGE_LABELS[s]).join(', ')}.`);
  }

  async step(projectId, targetPageNumber = null, options = {}) {
    if (this.loopInFlight) {
      this.log('warn', `Cannot step while the pipeline is already active — pause or stop it first.`);
      return;
    }
    const requested = this.stagesOf(options.stage || 'all');
    this.activeProjectId = projectId;
    this.stepMode = true;
    this.resetStages();
    for (const stage of requested) {
      this.setStageState(stage, 'running');
      this.setStageIntent(stage, true);
    }

    queries.updateProjectStatus(projectId, 'running');
    this.broadcastStages();
    this.broadcast({
      type: 'project_status',
      projectId,
      status: 'running',
      stageTarget: this.stageTarget,
      stages: { ...this.stageStates }
    });
    this.log('info', `Stepping page for project ${projectId} [stages: ${requested.join(', ')}]...`);

    this.runLoop(projectId, true, targetPageNumber, {}).catch((err) => {
      this.log('error', `Step execution error: ${err.message}`);
      this.resetStages();
      this.broadcastStages();
      this.syncProjectStatus(projectId);
    });
  }

  stop(projectId) {
    const previousProject = this.activeProjectId;
    this.resetStages();
    this.stepMode = false;
    // Stale token: every lane returns at its next check (in-flight OCR still
    // finishes and caches its page, TTS is killed outright).
    this.runToken += 1;
    this.finishingRun = true;
    // Release any lane stuck in a long stage call (Colab provisioning, a slow
    // remote LLM): the work is abandoned, not awaited.
    try {
      this.activeRun?.controller.abort();
    } catch {}
    abortActiveSynthesis();
    this.broadcastStages();
    if (previousProject) {
      queries.updateProjectStatus(previousProject, 'idle');
      this.broadcast({ type: 'project_status', projectId: previousProject, status: 'idle', stages: { ...this.stageStates } });
      this.log('info', `Pipeline stopped for project ${previousProject}`);
    }
    if (projectId && projectId !== previousProject) {
      queries.updateProjectStatus(projectId, 'idle');
      this.broadcast({ type: 'project_status', projectId, status: 'idle' });
    }
  }

  /**
   * Re-read the settings for the next unit of work.
   *
   * Settings live in SQLite as plain rows, so an edit made while the book is
   * processing (refiner model/prompt, extra instructions, TTS voice or backend,
   * OCR engine, throttle…) must reach the very next page — and the very next
   * stage of the page already in flight — instead of waiting for a restart.
   * Called before every page and every stage; logs which keys changed.
   */
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

  /** Which stages still have work to do on this page. */
  pendingStagesForPage(page) {
    const isCustom = page.page_type === 'custom';
    const missing = [];
    if (!isCustom && !(page.raw_text && page.raw_text.trim())) missing.push('ocr');
    if (!(page.refined_text && page.refined_text.trim())) missing.push('refine');
    if (!(page.audio_path && fs.existsSync(page.audio_path))) missing.push('audio');
    return missing;
  }

  /**
   * A stage may run when it is running, or when it is only needed as a
   * dependency of a running later stage. Explicitly paused stages never run.
   */
  stageAllowed(stage) {
    const state = this.stageStates[stage];
    if (state === 'running') return true;
    if (state === 'paused') return false;
    return STAGES.some(
      (other) => other !== stage && this.stageStates[other] === 'running' && STAGE_DEPS[other].includes(stage)
    );
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

    let clearedAudio = false;
    if (page.audio_path && fs.existsSync(page.audio_path)) {
      try {
        fs.unlinkSync(page.audio_path);
        clearedAudio = true;
      } catch {}
    }

    queries.updatePageText(projectId, page.page_number, { refinedText: next, clearAudio: clearedAudio });
    queries.setPageRulesStamp(projectId, page.page_number, stamp);
    const replacements = applied.reduce((sum, item) => sum + item.count, 0);
    this.log(
      'info',
      `[Page ${page.page_number + 1}] Text rules applied (${replacements} replacement${replacements === 1 ? '' : 's'})${clearedAudio ? ' — audio regenerates' : ''}.`
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
      // No `force`: pages already folded into the current rule version are
      // skipped, so pressing "Apply" twice never replaces twice.
      const after = this.applyRulesToPage(projectId, page, before);
      if (after !== before) {
        changed += 1;
        if (page.audio_path && !fs.existsSync(page.audio_path)) audioCleared += 1;
      }
    }
    return { pages: pages.length, changed, audioCleared };
  }

  // ---------------------------------------------------------------------------
  // Stage lanes (concurrent pipeline)
  //
  // The old engine walked page 1 → N and ran OCR, refine and audio for each page
  // in turn, so one slow LLM call held the whole book up and the next page could
  // not be OCR'd until the refiner answered for the previous one.
  //
  // Now every stage owns a lane. The OCR lane walks the book on its own, and the
  // Script and Audio lanes follow behind it, consuming the artifact the previous
  // lane just cached. Lanes run concurrently (they interleave on every await),
  // so starting Script while OCR is at page 40 processes script from page 1 and
  // keeps OCR going at the same time. Only the two local heavy stages (OCR and
  // TTS) are gated against each other by default (setting
  // `pipeline_local_parallel=1` removes the gate), and OCR always wins the gate
  // so text extraction is never starved by a long synthesis.
  // ---------------------------------------------------------------------------

  /** Run one lane per stage and wait until every lane settles. */
  async runLoop(projectId, singleStep = false, targetPageNumber = null) {
    if (this.loopInFlight) {
      this.log('warn', `Pipeline already busy — start requested for project ${projectId} was ignored.`);
      return;
    }
    this.loopInFlight = true;
    try {
      await this._executeLoop(projectId, singleStep, targetPageNumber);
    } finally {
      this.loopInFlight = false;
      this.finishingRun = false;
      this.activeRun = null;
      if (!singleStep) this.syncProjectStatus(projectId);
    }
  }

  async _executeLoop(projectId, singleStep = false, targetPageNumber = null) {
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
      // Aborted by stop(): lets a lane abandon a long stage call immediately.
      signal: controller.signal,
      // Every lane is born with this token and dies when it goes stale.
      epoch: ++this.runToken,
      finishing: false,
      // Step mode works on exactly one page; a normal run walks the whole book.
      targetPageNumber: singleStep && targetPageNumber !== null ? targetPageNumber : null,
      // Live settings: refreshed per page and per stage (see pullSettings).
      settings: this.pullSettings(null),
      // Gate shared by the two local heavy stages (OCR render/OCR, TTS).
      gate: new StageGate(),
      // Pages this run already attempted, per lane: a page that fails for good
      // can never make its lane spin on the same work for the rest of the run.
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

    // Every lane joined: nothing may be left "running" behind.
    const allPages = queries.getPagesByProjectId(projectId);
    const completeStages = [];
    for (const stage of STAGES) {
      if (this.stageStates[stage] === 'running') this.setStageState(stage, 'idle');
      if (this.stageStates[stage] === 'completed') completeStages.push(stage);
    }
    if (singleStep) this.stepMode = false;
    this.broadcastStages();
    this.syncProjectStatus(projectId);

    if (completeStages.length) {
      this.log(
        'info',
        `All ${allPages.length} pages complete for ${completeStages.map((s) => STAGE_LABELS[s]).join(', ')}!`
      );
    }

    // Full pipeline finished for the whole book.
    const readyCount = allPages.filter((p) => p.status === 'ready').length;
    if (!singleStep && allPages.length > 0 && readyCount === allPages.length) {
      queries.updateProjectStatus(projectId, 'completed');
      this.broadcast({
        type: 'project_status',
        projectId,
        status: 'completed',
        stages: { ...this.stageStates },
        progress: { total: allPages.length, ready: readyCount }
      });
    }
  }

  /**
   * One stage's worker loop. It never exits on its own while the run may still
   * make progress: it settles its stage (`completed` / `idle`) and keeps
   * polling, so flipping that stage back to `running` from the inspector revives
   * the lane instantly instead of needing a restart.
   */
  async runStageLane(stage, ctx) {
    const lane = ctx.lane[stage];
    lane.alive = true;
    try {
      for (;;) {
        if (this.runToken !== ctx.epoch) return;
        if (!this.laneActive(stage)) {
          lane.hasEligible = false;
          if (ctx.singleStep) return;
          // Everything idle or stopped: the run is over.
          if (this.maybeFinishRun(ctx)) return;
          await sleep(250);
          continue;
        }

        const pages = queries.getPagesByProjectId(ctx.projectId);
        const page = this.nextPageForStage(stage, pages, ctx);
        lane.hasEligible = Boolean(page);

        if (!page) {
          // Nothing to do right now: report why, then keep watching. Classify
          // against a fresh read: the lane feeding this one may have just
          // written the artifact we are waiting for.
          const verdict = this.classifyStageLane(stage, queries.getPagesByProjectId(ctx.projectId), ctx);
          lane.waiting = verdict === 'wait';
          lane.stalled = verdict === 'blocked';
          this.settleStageLane(stage, verdict, ctx);
          // A lane waiting on its producer keeps its stage running and polls.
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

        // A stage pulled in as a dependency must look busy while it works.
        if (this.stageStates[stage] !== 'running') {
          this.setStageState(stage, 'running');
          this.broadcastStages();
        }

        lane.inFlight += 1;
        try {
          await this.runStageOnPage(stage, ctx, page);
        } finally {
          lane.inFlight = Math.max(0, lane.inFlight - 1);
        }

        if (ctx.singleStep) return;

        // Gentle cooling pause to protect M2 CPU & memory. Read fresh: the
        // throttle is a live knob too.
        const throttleDelay = parseInt(queries.getSettings().throttle_delay_ms || '500', 10);
        if (throttleDelay > 0) await sleep(throttleDelay);
      }
    } finally {
      lane.alive = false;
    }
  }

  /**
   * End the run once every lane is quiet: no stage running or paused, and no
   * lane still inside a page. Lanes are long-lived on purpose (so flipping a
   * stage back to `running` revives it instantly), which is why the run has to
   * be closed explicitly instead of when a worker returns.
   */
  maybeFinishRun(ctx) {
    if (ctx.finishing) return true;
    if (STAGES.some((stage) => this.stageStates[stage] === 'running' || this.stageStates[stage] === 'paused')) {
      return false;
    }
    if (STAGES.some((stage) => ctx.lane[stage].inFlight > 0)) return false;
    ctx.finishing = true;
    this.finishingRun = true;
    // Stale token: every lane returns at its next check.
    this.runToken += 1;
    return true;
  }

  /** The next page (reading order) this lane can work on right now. */
  nextPageForStage(stage, pages, ctx) {
    const skip = ctx.skip[stage];
    for (const page of pages) {
      if (ctx.targetPageNumber !== null && page.page_number !== ctx.targetPageNumber) continue;
      if (skip.has(page.page_number)) continue;
      if (!this.pendingStagesForPage(page).includes(stage)) continue;
      if (!this.stageInputReady(stage, page)) continue;
      return page;
    }
    return null;
  }

  /**
   * Why a lane found no work: 'completed' (nothing left), 'wait' (the pages that
   * remain are waiting for the lane that feeds them) or 'blocked' (that lane is
   * paused / not running, so this stage cannot advance either).
   */
  classifyStageLane(stage, pages, ctx) {
    const skip = ctx.skip[stage];
    const pending = pages.filter(
      (page) => !skip.has(page.page_number) && this.pendingStagesForPage(page).includes(stage)
    );
    if (!pending.length) return 'completed';
    const waitingOnInput = pending.some((page) => !this.stageInputReady(stage, page));
    if (!waitingOnInput) return 'blocked';
    const producer = STAGE_PRODUCER[stage];
    if (producer && this.laneWorking(producer, ctx)) return 'wait';
    return 'blocked';
  }

  /** Record a lane's verdict, never fighting the user's own pause / stop. */
  settleStageLane(stage, verdict, ctx) {
    if (verdict === 'wait') return;
    const next = verdict === 'completed' ? 'completed' : 'idle';
    const current = this.stageStates[stage];
    if (current === next) return;
    if (current !== 'running' && current !== 'completed') return;
    this.setStageState(stage, next);
    this.broadcastStages();
    this.syncProjectStatus(ctx.projectId);
    if (next === 'completed') {
      this.log('info', `${STAGE_LABELS[stage]}: every page is done.`);
    } else {
      this.log(
        'info',
        `${STAGE_LABELS[stage]}: no more input from ${STAGE_LABELS[STAGE_PRODUCER[stage]] || 'its producer'} — paused, done or stalled.`
      );
    }
  }

  /**
   * Is this lane still able to produce work? A lane that is only waiting for
   * its own producer counts as working (the chain resolves upstream), but a
   * lane that is stalled cannot, so stalls cascade down instead of deadlocking.
   */
  laneWorking(stage, ctx) {
    const lane = ctx.lane[stage];
    if (!lane || !lane.alive) return false;
    if (this.stageStates[stage] === 'paused') return false;
    if (lane.inFlight > 0 || lane.hasEligible) return true;
    return Boolean(lane.waiting && !lane.stalled);
  }

  /** Does the page already carry the artifact this stage consumes? */
  stageInputReady(stage, page) {
    if (stage === 'ocr') return true;
    if (stage === 'refine') return Boolean((page.raw_text || '').trim());
    return Boolean((page.refined_text || '').trim());
  }

  /**
   * Take the gate shared by the local heavy stages. Returns whether the caller
   * holds it (and therefore must release it).
   */
  async acquireHeavy(ctx, stage, { priority = 1, shouldYield = null } = {}) {
    if (ctx.settings.pipeline_local_parallel === '1') return false;
    await ctx.gate.acquire(stage, { priority, shouldYield });
    return true;
  }

  /** Run one stage of one page. Errors are recorded on the page, never thrown. */
  async runStageOnPage(stage, ctx, page) {
    const { projectId } = ctx;
    const pageNum = page.page_number;
    const isCustom = page.page_type === 'custom';
    // Display position and physical PDF page are decoupled so pages can be
    // deleted or inserted anywhere without invalidating other pages' caches.
    const pdfPageIndex = page.source_page !== null && page.source_page !== undefined ? page.source_page : pageNum;

    try {
      // A page can take minutes per stage: refresh settings so an edit made
      // mid-book (e.g. new voice while OCR runs) still applies to this page.
      ctx.settings = this.pullSettings(ctx.settings, { pageNumber: pageNum, stage });
      queries.updateProjectStatus(projectId, 'running', pageNum);
      this.broadcastSystemHealth();

      if (stage === 'ocr') await this.runOcrStage(ctx, page, { isCustom, pdfPageIndex });
      if (stage === 'refine') await this.runRefineStage(ctx, page, isCustom);
      if (stage === 'audio') await this.runAudioStage(ctx, page);
    } catch (pageErr) {
      if (!this.isRunning || pageErr.message.includes('cancelled by user')) {
        this.log('info', `Page ${pageNum + 1} ${STAGE_LABELS[stage].toLowerCase()} stopped cleanly.`);
        queries.upsertPage({ projectId, pageNumber: pageNum, status: 'pending', errorMessage: null });
        this.broadcastPageStatus(projectId, pageNum, 'pending', 'Paused / Ready to resume', stage);
      } else {
        this.log('error', `Page ${pageNum + 1} ${STAGE_LABELS[stage].toLowerCase()} failed: ${pageErr.message}`);
        queries.upsertPage({ projectId, pageNumber: pageNum, status: 'error', errorMessage: pageErr.message });
        this.broadcastPageStatus(projectId, pageNum, 'error', pageErr.message, stage);
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
    try {
      if (!fs.existsSync(renderPath)) {
        this.broadcastPageStatus(projectId, pageNum, 'extracting', 'Rendering page canvas...', 'ocr');
        await renderPdfPage(project.pdf_path, pdfPageIndex, renderPath);
        queries.upsertPage({ projectId, pageNumber: pageNum, renderPath });
        page.render_path = renderPath;
      }

      this.broadcastPageStatus(projectId, pageNum, 'extracting', 'Extracting text & running OCR...', 'ocr');
      this.log('info', `[Page ${pageNum + 1}] Running OCR / text extraction...`);

      const extResult = await extractPageText(project.pdf_path, pdfPageIndex, renderPath, ctx.settings);
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
      if (gated) ctx.gate.release('ocr');
    }
  }

  async runRefineStage(ctx, page, isCustom) {
    const { projectId } = ctx;
    const pageNum = page.page_number;

    this.broadcastPageStatus(projectId, pageNum, 'refining', 'Refining narration script (stripping noise)...', 'refine');
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

    // Rules run on the freshly refined script before it is stored.
    const withRules = this.applyRulesToPage(projectId, { ...page, refined_text: script }, script, { force: true });
    page.refined_text = withRules;

    queries.upsertPage({ projectId, pageNumber: pageNum, refinedText: withRules, status: 'refining' });
    this.log('info', `[Page ${pageNum + 1}] Narration refined (${withRules.length} chars)`);
  }

  async runAudioStage(ctx, page) {
    const { projectId, audioDir } = ctx;
    const pageNum = page.page_number;

    // A cached script may predate the current rules: rewrite it before speaking,
    // so a new rule takes effect without re-running the LLM.
    const ruledScript = this.applyRulesToPage(projectId, page, page.refined_text);
    page.refined_text = ruledScript;

    queries.upsertPage({ projectId, pageNumber: pageNum, status: 'synthesizing' });
    this.log('info', `[Page ${pageNum + 1}] Synthesizing audio narration...`);

    // OCR yields nothing to the voice model: let the OCR lane finish the book
    // first so the refiner (and therefore the audio lane) never idles.
    const gated = await this.acquireHeavy(ctx, 'audio', {
      priority: 1,
      shouldYield: () => this.laneWorking('ocr', ctx)
    });

    try {
      this.broadcastPageStatus(projectId, pageNum, 'synthesizing', 'Synthesizing voice audio...', 'audio');
      const targetAudioPath = path.join(audioDir, `page_${page.id}.wav`);
      const ttsResult = await raceAbort(synthesizeAudio(ruledScript, targetAudioPath, ctx.settings), ctx.signal);

      page.audio_path = ttsResult.audioPath;
      page.audio_duration = ttsResult.duration;

      queries.upsertPage({
        projectId,
        pageNumber: pageNum,
        audioPath: ttsResult.audioPath,
        audioDuration: ttsResult.duration,
        status: 'ready'
      });
      this.log(
        'info',
        `[Page ${pageNum + 1}] Audio synthesized (${ttsResult.duration.toFixed(1)}s, voice: ${ttsResult.voice})`
      );
      this.broadcastPageStatus(projectId, pageNum, 'ready', 'Page complete & ready for playback', 'audio');
    } finally {
      if (gated) ctx.gate.release('audio');
    }
  }

  broadcastPageStatus(projectId, pageNumber, status, stageDescription, stage = null) {
    this.broadcast({
      type: 'page_status',
      projectId,
      pageNumber,
      status,
      stageDescription,
      // Lanes run concurrently: name the stage so the UI can spin more than one
      // page at a time instead of keeping a single "active run".
      stage: stage || null,
      timestamp: Date.now()
    });
  }
}

export const pipeline = new PipelineEngine();
