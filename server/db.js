import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { DEFAULT_REFINER_PROMPT } from './refiner.js';
import { setUsageSink, computeCost, getModelPricing } from './usage.js';

const DATA_DIR = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'pdf_reader.db');
const db = new DatabaseSync(DB_PATH);

// Enable WAL mode for high concurrency & reliability
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
`);

// Create schema
db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    pdf_path TEXT NOT NULL,
    page_count INTEGER NOT NULL DEFAULT 0,
    active_page INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'idle',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS pages (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    page_number INTEGER NOT NULL,
    render_path TEXT,
    raw_text TEXT,
    ocr_source TEXT DEFAULT 'none',
    refined_text TEXT,
    audio_path TEXT,
    audio_duration REAL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',
    error_message TEXT,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_pages_project ON pages(project_id, page_number);

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- Voice library: every cloned voice is a row + a normalized reference sample
  -- on disk (data/voices/<id>/sample.wav). The builtin reference voice is not a
  -- row; it is the implicit fallback when a per-language setting is 'builtin'.
  CREATE TABLE IF NOT EXISTS voices (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    language TEXT NOT NULL DEFAULT 'auto',
    ref_text TEXT NOT NULL DEFAULT '',
    audio_path TEXT NOT NULL,
    duration REAL NOT NULL DEFAULT 0,
    origin TEXT NOT NULL DEFAULT 'uploaded',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  -- One row per metered LLM/API call (OCR vision, narration refiner, ...).
  CREATE TABLE IF NOT EXISTS api_calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    project_id TEXT,
    page_number INTEGER,
    stage TEXT NOT NULL DEFAULT 'other',
    provider TEXT,
    model TEXT NOT NULL DEFAULT 'unknown',
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cached_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL NOT NULL DEFAULT 0,
    list_cost_usd REAL NOT NULL DEFAULT 0,
    estimated INTEGER NOT NULL DEFAULT 0,
    latency_ms INTEGER NOT NULL DEFAULT 0,
    http_status INTEGER,
    status TEXT NOT NULL DEFAULT 'ok',
    error TEXT,
    request_chars INTEGER NOT NULL DEFAULT 0,
    response_chars INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_api_calls_ts ON api_calls(ts DESC);
  CREATE INDEX IF NOT EXISTS idx_api_calls_project ON api_calls(project_id, ts DESC);
  CREATE INDEX IF NOT EXISTS idx_api_calls_stage ON api_calls(stage, ts DESC);

  -- Find/replace rules applied to narration text. page_number NULL = project
  -- wide; otherwise the rule only applies to one page. Rules run after the LLM
  -- refiner and are stamped per page so cached text is never re-processed twice.
  CREATE TABLE IF NOT EXISTS text_rules (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    page_number INTEGER,
    find TEXT NOT NULL,
    replace TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1,
    is_regex INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_text_rules_project ON text_rules(project_id, page_number);
`);

// ==========================================
// Lightweight migrations (idempotent)
// ==========================================
// page_type: 'pdf' (rendered + OCR'd from the PDF) | 'custom' (user-pasted text)
// source_page: physical PDF page index, decoupled from the display position
// so pages can be deleted / inserted anywhere without re-processing neighbors.
const pageColumns = db.prepare(`PRAGMA table_info(pages)`).all();
const hasPageColumn = (name) => pageColumns.some((c) => c.name === name);

if (!hasPageColumn('page_type')) {
  db.exec(`ALTER TABLE pages ADD COLUMN page_type TEXT NOT NULL DEFAULT 'pdf'`);
}
if (!hasPageColumn('source_page')) {
  db.exec(`ALTER TABLE pages ADD COLUMN source_page INTEGER`);
}
// Newest text_rules.updated_at already folded into this page's refined_text.
if (!hasPageColumn('text_rules_stamp')) {
  db.exec(`ALTER TABLE pages ADD COLUMN text_rules_stamp INTEGER NOT NULL DEFAULT 0`);
}

db.exec(`
  UPDATE pages SET source_page = page_number WHERE source_page IS NULL AND page_type = 'pdf';
  CREATE UNIQUE INDEX IF NOT EXISTS idx_pages_position ON pages(project_id, page_number);
`);

// Default settings
export const DEFAULT_SETTINGS = {
  ocr_tier: 'mac_first', // 'mac_first' | 'mac_only' | 'llm_only'
  llm_vision_url: 'http://127.0.0.1:8085/v1',
  llm_vision_key: 'antigravity-zero-key',
  llm_vision_model: 'gemini-2.5-flash',
  refiner_url: 'http://127.0.0.1:8085/v1',
  refiner_key: 'antigravity-zero-key',
  refiner_model: 'gemini-2.5-flash',
  refiner_system_prompt: DEFAULT_REFINER_PROMPT,
  refiner_extra_instructions: '',
  tts_style_notes: '', // free-form delivery direction -> fed to the refiner (text layer)
  tts_instruct: '', // OmniVoice instruct tags (closed vocabulary) -> fed to the voice model
  tts_num_step: '16', // diffusion steps: 16 fast, 24/32 better quality
  throttle_delay_ms: '500',
  // Stage lanes (OCR / Script / Audio) always run concurrently. This only
  // controls whether the two local heavy stages may overlap each other:
  // '0' gates OCR and TTS (safer on an 8 GB fanless M2), '1' lets them overlap.
  pipeline_local_parallel: '0',
  tts_engine: 'omnivoice',
  tts_backend: 'auto', // 'local' | 'colab' | 'auto' (Colab GPU first, local fallback)
  colab_gpu: 'T4', // T4 | L4 | A100 | H100
  colab_session: 'pdfreader',
  colab_idle_stop_min: '30', // stop the GPU session after N idle minutes (at least 20m, 0 = never)
  colab_bin: '', // absolute path to `colab`; auto-detected when empty
  colab_ssh_key: '', // ed25519/ecdsa key used for the SSH tunnel; auto-detected when empty
  tts_voice_en: 'builtin',
  tts_voice_bn: 'builtin',
  tts_voice_ar: 'builtin',
  tts_speed: '1.0',
  tts_active_model: 'omnivoice',
  asr_active_model: 'faster-whisper-large-v3-turbo',
  models_cache_dir: '', // empty = ~/.cache/huggingface/hub
  python_bin: '', // empty = auto-detect local/sibling venv or python3
  hf_token: '', // optional Hugging Face Hub token
  model_refs_json: '{}', // per-model custom reference path overrides
  custom_models_json: '[]', // user-registered custom models
  pipeline_stage_target: 'all', // 'all' | 'ocr' | 'refine' | 'audio'
  // Treat loopback endpoints (local Antigravity proxy, self-hosted OCR) as free
  usage_free_local: '1'
};

const insertSettingStmt = db.prepare(`
  INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)
`);

for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
  insertSettingStmt.run(key, value);
}

/**
 * One-off re-pricing of historical rows.
 *
 * Earlier builds only knew gemini-2.5 and older ids, so calls to newer models
 * (e.g. `gemini-3.8-flash` from the Antigravity proxy) were stored with
 * list_cost_usd = 0 and the dashboard showed $0 for real usage. Re-price every
 * zero row once, using the current table; billed cost is only rewritten for
 * non-local providers, because loopback calls stay free by design.
 */
function repriceHistoricalCalls() {
  const stamp = db.prepare(`SELECT value FROM settings WHERE key = 'usage_repriced_at'`).get();
  if (stamp) return 0;

  const rows = db
    .prepare(
      `SELECT id, model, provider, input_tokens, output_tokens
         FROM api_calls
        WHERE list_cost_usd = 0 AND (input_tokens > 0 OR output_tokens > 0)`
    )
    .all();

  const repriced = db.prepare(`UPDATE api_calls SET list_cost_usd = ?, cost_usd = ? WHERE id = ?`);
  let fixed = 0;
  for (const row of rows) {
    const listCost = computeCost(row.model, row.input_tokens, row.output_tokens);
    if (!(listCost > 0)) continue;
    const billed = row.provider === 'local-proxy' ? 0 : listCost;
    repriced.run(listCost, billed, row.id);
    fixed += 1;
  }

  insertSettingStmt.run('usage_repriced_at', String(Date.now()));
  if (fixed) console.log(`[Usage] Re-priced ${fixed} historical API call(s) at current list prices.`);
  return fixed;
}

repriceHistoricalCalls();

/**
 * Build a shared WHERE clause for api_calls queries.
 * `prefix` lets joined queries qualify columns (e.g. 'c.').
 */
function buildUsageWhere(filters = {}, prefix = '') {
  const col = (name) => `${prefix}${name}`;
  const clauses = [];
  const params = [];

  const from = Number(filters.from);
  const to = Number(filters.to);
  if (Number.isFinite(from) && from > 0) {
    clauses.push(`${col('ts')} >= ?`);
    params.push(from);
  }
  if (Number.isFinite(to) && to > 0) {
    clauses.push(`${col('ts')} <= ?`);
    params.push(to);
  }
  for (const [key, column] of [
    ['projectId', 'project_id'],
    ['stage', 'stage'],
    ['model', 'model'],
    ['provider', 'provider'],
    ['status', 'status']
  ]) {
    const value = filters[key];
    if (value !== undefined && value !== null && value !== '') {
      clauses.push(`${col(column)} = ?`);
      params.push(String(value));
    }
  }
  const q = (filters.q || '').trim();
  if (q) {
    const like = `%${q}%`;
    clauses.push(`(${col('model')} LIKE ? OR ${col('stage')} LIKE ? OR ${col('provider')} LIKE ? OR COALESCE(${col('error')}, '') LIKE ?)`);
    params.push(like, like, like, like);
  }

  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

// Export Database Helper Queries
export const queries = {
  // Projects
  getAllProjects: () => {
    return db.prepare(`SELECT * FROM projects ORDER BY updated_at DESC`).all();
  },

  getProjectById: (id) => {
    return db.prepare(`SELECT * FROM projects WHERE id = ?`).get(id);
  },

  createProject: ({ id, name, pdfPath, pageCount }) => {
    const now = Date.now();
    db.prepare(`
      INSERT INTO projects (id, name, pdf_path, page_count, active_page, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 0, 'idle', ?, ?)
    `).run(id, name, pdfPath, pageCount, now, now);
    return queries.getProjectById(id);
  },

  updateProjectStatus: (id, status, activePage = null) => {
    const now = Date.now();
    if (activePage !== null) {
      db.prepare(`
        UPDATE projects SET status = ?, active_page = ?, updated_at = ? WHERE id = ?
      `).run(status, activePage, now, id);
    } else {
      db.prepare(`
        UPDATE projects SET status = ?, updated_at = ? WHERE id = ?
      `).run(status, now, id);
    }
  },

  deleteProject: (id) => {
    db.prepare(`DELETE FROM pages WHERE project_id = ?`).run(id);
    db.prepare(`DELETE FROM projects WHERE id = ?`).run(id);
  },

  // Pages
  getPagesByProjectId: (projectId) => {
    return db.prepare(`SELECT * FROM pages WHERE project_id = ? ORDER BY page_number ASC`).all(projectId);
  },

  getPage: (projectId, pageNumber) => {
    return db.prepare(`SELECT * FROM pages WHERE project_id = ? AND page_number = ?`).get(projectId, pageNumber);
  },

  /**
   * Insert or patch a page, keyed by (project_id, page_number) — the display position.
   * Pass status = null to leave the current status untouched.
   */
  upsertPage: ({
    projectId,
    pageNumber,
    pageType = null,
    sourcePage = null,
    renderPath = null,
    rawText = null,
    ocrSource = 'none',
    refinedText = null,
    audioPath = null,
    audioDuration = 0,
    status = null,
    errorMessage = null
  }) => {
    const now = Date.now();
    const existing = db
      .prepare(`SELECT * FROM pages WHERE project_id = ? AND page_number = ?`)
      .get(projectId, pageNumber);

    if (existing) {
      db.prepare(`
        UPDATE pages SET
          page_type = COALESCE(?, page_type),
          source_page = COALESCE(?, source_page),
          render_path = COALESCE(?, render_path),
          raw_text = COALESCE(?, raw_text),
          ocr_source = CASE WHEN ? = 'none' THEN ocr_source ELSE ? END,
          refined_text = COALESCE(?, refined_text),
          audio_path = COALESCE(?, audio_path),
          audio_duration = CASE WHEN ? = 0 THEN audio_duration ELSE ? END,
          status = COALESCE(?, status),
          error_message = ?,
          updated_at = ?
        WHERE project_id = ? AND page_number = ?
      `).run(
        pageType,
        sourcePage,
        renderPath,
        rawText,
        ocrSource,
        ocrSource,
        refinedText,
        audioPath,
        audioDuration,
        audioDuration,
        status,
        errorMessage,
        now,
        projectId,
        pageNumber
      );
    } else {
      const id = `pg_${projectId}_${pageNumber}_${Math.random().toString(36).slice(2, 8)}`;
      db.prepare(`
        INSERT INTO pages (
          id, project_id, page_number, page_type, source_page, render_path, raw_text, ocr_source,
          refined_text, audio_path, audio_duration, status, error_message, updated_at
        ) VALUES (?, ?, ?, COALESCE(?, 'pdf'), ?, ?, ?, ?, ?, ?, ?, COALESCE(?, 'pending'), ?, ?)
      `).run(
        id,
        projectId,
        pageNumber,
        pageType,
        sourcePage,
        renderPath,
        rawText,
        ocrSource,
        refinedText,
        audioPath,
        audioDuration,
        status,
        errorMessage,
        now
      );
    }
    return db
      .prepare(`SELECT * FROM pages WHERE project_id = ? AND page_number = ?`)
      .get(projectId, pageNumber);
  },

  /**
   * Regenerate a single page.
   * includeRaw=false -> keep OCR text, clear narration + audio (re-refine + re-synthesize).
   * includeRaw=true  -> clear OCR text too (full re-extraction).
   * audioOnly=true   -> clear only audio (keeps OCR and refined script).
   * ocrOnly=true     -> clear raw text, refined script, and audio for clean re-extraction.
   */
  resetPageStages: (
    projectId,
    pageNumber,
    { includeRaw = false, audioOnly = false, ocrOnly = false } = {}
  ) => {
    const now = Date.now();
    if (audioOnly) {
      db.prepare(`
        UPDATE pages SET
          audio_path = NULL,
          audio_duration = 0,
          status = CASE WHEN refined_text IS NOT NULL AND TRIM(refined_text) != '' THEN 'refining' ELSE 'pending' END,
          error_message = NULL,
          updated_at = ?
        WHERE project_id = ? AND page_number = ?
      `).run(now, projectId, pageNumber);
      return;
    }
    const rawClause = (includeRaw || ocrOnly) ? `raw_text = NULL, ocr_source = 'none',` : ``;
    db.prepare(`
      UPDATE pages SET
        ${rawClause}
        refined_text = NULL,
        audio_path = NULL,
        audio_duration = 0,
        status = 'pending',
        error_message = NULL,
        updated_at = ?
      WHERE project_id = ? AND page_number = ?
    `).run(now, projectId, pageNumber);
  },

  /** Regenerate every page of a project (same stage semantics as resetPageStages). */
  resetProjectStages: (
    projectId,
    { includeRaw = false, audioOnly = false, ocrOnly = false } = {}
  ) => {
    const now = Date.now();
    if (audioOnly) {
      db.prepare(`
        UPDATE pages SET
          audio_path = NULL,
          audio_duration = 0,
          status = CASE WHEN refined_text IS NOT NULL AND TRIM(refined_text) != '' THEN 'refining' ELSE 'pending' END,
          error_message = NULL,
          updated_at = ?
        WHERE project_id = ?
      `).run(now, projectId);
      return;
    }
    const rawClause = (includeRaw || ocrOnly) ? `raw_text = NULL, ocr_source = 'none',` : ``;
    db.prepare(`
      UPDATE pages SET
        ${rawClause}
        refined_text = NULL,
        audio_path = NULL,
        audio_duration = 0,
        status = 'pending',
        error_message = NULL,
        updated_at = ?
      WHERE project_id = ?
    `).run(now, projectId);
  },

  /**
   * Insert a user-written (custom) text page at any position.
   * position 0 = before the first page, position === pageCount = append at end.
   * Pages after the insertion point keep their artifacts; only their display
   * index shifts, so nothing needs to be re-OCR'd or re-synthesized.
   */
  insertCustomPage: ({ projectId, position, text }) => {
    const now = Date.now();
    const shifting = db
      .prepare(`SELECT page_number FROM pages WHERE project_id = ? AND page_number >= ? ORDER BY page_number DESC`)
      .all(projectId, position);
    const shiftStmt = db.prepare(
      `UPDATE pages SET page_number = ?, updated_at = ? WHERE project_id = ? AND page_number = ?`
    );
    for (const row of shifting) {
      shiftStmt.run(row.page_number + 1, now, projectId, row.page_number);
    }

    const id = `pg_custom_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    db.prepare(`
      INSERT INTO pages (
        id, project_id, page_number, page_type, source_page, render_path, raw_text, ocr_source,
        refined_text, audio_path, audio_duration, status, error_message, updated_at
      ) VALUES (?, ?, ?, 'custom', NULL, NULL, ?, 'custom', ?, NULL, 0, 'pending', NULL, ?)
    `).run(id, projectId, position, text, text, now);

    queries.updateProjectPageCount(projectId);
    return db.prepare(`SELECT * FROM pages WHERE id = ?`).get(id);
  },

  /** Remove a page and compact the remaining display positions (1-based shifts down). */
  deletePageAt: (projectId, pageNumber) => {
    const now = Date.now();
    const page = db
      .prepare(`SELECT * FROM pages WHERE project_id = ? AND page_number = ?`)
      .get(projectId, pageNumber);
    if (!page) return null;

    db.prepare(`DELETE FROM pages WHERE project_id = ? AND page_number = ?`).run(projectId, pageNumber);

    const rest = db
      .prepare(`SELECT page_number FROM pages WHERE project_id = ? AND page_number > ? ORDER BY page_number ASC`)
      .all(projectId, pageNumber);
    const shiftStmt = db.prepare(
      `UPDATE pages SET page_number = ?, updated_at = ? WHERE project_id = ? AND page_number = ?`
    );
    for (const row of rest) {
      shiftStmt.run(row.page_number - 1, now, projectId, row.page_number);
    }

    queries.updateProjectPageCount(projectId);
    return page;
  },

  /**
   * Remove several pages at once and compact the remaining display positions.
   * One transaction, so a partial failure never leaves gaps in the numbering.
   */
  deletePagesAt: (projectId, pageNumbers) => {
    const numbers = [...new Set(pageNumbers.filter((n) => Number.isInteger(n) && n >= 0))].sort((a, b) => a - b);
    if (numbers.length === 0) return [];

    const placeholders = numbers.map(() => '?').join(',');
    const removed = db
      .prepare(`SELECT * FROM pages WHERE project_id = ? AND page_number IN (${placeholders}) ORDER BY page_number ASC`)
      .all(projectId, ...numbers);
    if (removed.length === 0) return [];

    const now = Date.now();
    db.exec('BEGIN');
    try {
      db.prepare(`DELETE FROM pages WHERE project_id = ? AND page_number IN (${placeholders})`).run(projectId, ...numbers);

      const rest = db
        .prepare(`SELECT id, page_number FROM pages WHERE project_id = ? ORDER BY page_number ASC`)
        .all(projectId);
      const shiftStmt = db.prepare(`UPDATE pages SET page_number = ?, updated_at = ? WHERE id = ?`);
      rest.forEach((row, index) => {
        if (row.page_number !== index) shiftStmt.run(index, now, row.id);
      });
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    queries.updateProjectPageCount(projectId);
    return removed;
  },

  /** Replace the text of a custom page and invalidate its synthesized audio. */
  updateCustomPageText: (projectId, pageNumber, text) => {
    const now = Date.now();
    db.prepare(`
      UPDATE pages SET
        raw_text = ?,
        refined_text = ?,
        audio_path = NULL,
        audio_duration = 0,
        status = 'pending',
        error_message = NULL,
        updated_at = ?
      WHERE project_id = ? AND page_number = ?
    `).run(text, text, now, projectId, pageNumber);
    return db
      .prepare(`SELECT * FROM pages WHERE project_id = ? AND page_number = ?`)
      .get(projectId, pageNumber);
  },

  /**
   * Update page text for any page (custom or PDF).
   * Allows editing raw OCR text, refined script, or both.
   * Optionally resets audio or refined text if modified.
   */
  updatePageText: (
    projectId,
    pageNumber,
    { rawText, refinedText, ocrSource = null, clearAudio = false, clearRefined = false } = {}
  ) => {
    const now = Date.now();
    const existing = db
      .prepare(`SELECT * FROM pages WHERE project_id = ? AND page_number = ?`)
      .get(projectId, pageNumber);
    if (!existing) return null;

    const newRaw = rawText !== undefined ? rawText : existing.raw_text;
    let newRefined = refinedText !== undefined ? refinedText : existing.refined_text;
    if (clearRefined) newRefined = null;

    let newAudioPath = clearAudio ? null : existing.audio_path;
    let newAudioDuration = clearAudio ? 0 : existing.audio_duration;

    const newOcrSource =
      ocrSource !== null
        ? ocrSource
        : rawText !== undefined && rawText !== existing.raw_text
        ? 'manual_edit'
        : existing.ocr_source;

    let status = existing.status;
    if (clearAudio) {
      status = newRefined && newRefined.trim() ? 'refining' : (newRaw && newRaw.trim() ? 'extracting' : 'pending');
    }

    db.prepare(`
      UPDATE pages SET
        raw_text = ?,
        ocr_source = ?,
        refined_text = ?,
        audio_path = ?,
        audio_duration = ?,
        status = ?,
        error_message = NULL,
        updated_at = ?
      WHERE project_id = ? AND page_number = ?
    `).run(
      newRaw,
      newOcrSource,
      newRefined,
      newAudioPath,
      newAudioDuration,
      status,
      now,
      projectId,
      pageNumber
    );

    return db
      .prepare(`SELECT * FROM pages WHERE project_id = ? AND page_number = ?`)
      .get(projectId, pageNumber);
  },

  countPages: (projectId) => {
    return db.prepare(`SELECT COUNT(*) AS c FROM pages WHERE project_id = ?`).get(projectId).c;
  },

  updateProjectPageCount: (projectId) => {
    const count = queries.countPages(projectId);
    db.prepare(`UPDATE projects SET page_count = ?, updated_at = ? WHERE id = ?`).run(count, Date.now(), projectId);
    return count;
  },

  /**
   * After a restart the in-memory engine is empty, so any project left in a
   * running/paused state must fall back to idle — processing never resumes on
   * its own, the user has to press Start again.
   */
  resetInterruptedProjects: () => {
    const res = db
      .prepare(`UPDATE projects SET status = 'idle', updated_at = ? WHERE status IN ('running', 'paused')`)
      .run(Date.now());
    return Number(res.changes || 0);
  },

  // ==========================================
  // API call usage log
  // ==========================================
  logApiCall: (entry) => {
    db.prepare(`
      INSERT INTO api_calls (
        ts, project_id, page_number, stage, provider, model,
        input_tokens, output_tokens, cached_tokens, total_tokens,
        cost_usd, list_cost_usd, estimated, latency_ms, http_status,
        status, error, request_chars, response_chars
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.ts || Date.now(),
      entry.projectId ?? null,
      entry.pageNumber ?? null,
      entry.stage || 'other',
      entry.provider ?? null,
      entry.model || 'unknown',
      entry.inputTokens || 0,
      entry.outputTokens || 0,
      entry.cachedTokens || 0,
      entry.totalTokens || 0,
      entry.costUsd || 0,
      entry.listCostUsd || 0,
      entry.estimated ? 1 : 0,
      entry.latencyMs || 0,
      entry.httpStatus ?? null,
      entry.status || 'ok',
      entry.error ?? null,
      entry.requestChars || 0,
      entry.responseChars || 0
    );
  },

  queryApiCalls: (filters = {}) => {
    // Qualify columns: the join with projects makes bare `status` ambiguous.
    const { where, params } = buildUsageWhere(filters, 'c.');
    const limit = Math.min(Math.max(parseInt(filters.limit ?? '50', 10) || 50, 1), 500);
    const offset = Math.max(parseInt(filters.offset ?? '0', 10) || 0, 0);
    const rows = db.prepare(`
      SELECT c.*, p.name AS project_name
      FROM api_calls c
      LEFT JOIN projects p ON p.id = c.project_id
      ${where}
      ORDER BY c.ts DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);
    const { total } = db.prepare(`SELECT COUNT(*) AS total FROM api_calls c ${where}`).get(...params);
    return { rows, total, limit, offset };
  },

  getApiUsageSummary: (filters = {}) => {
    const { where, params } = buildUsageWhere(filters);
    const totals = db.prepare(`
      SELECT
        COUNT(*) AS calls,
        COALESCE(SUM(CASE WHEN status = 'ok' THEN 1 ELSE 0 END), 0) AS okCalls,
        COALESCE(SUM(CASE WHEN status <> 'ok' THEN 1 ELSE 0 END), 0) AS errorCalls,
        COALESCE(SUM(input_tokens), 0) AS inputTokens,
        COALESCE(SUM(output_tokens), 0) AS outputTokens,
        COALESCE(SUM(cached_tokens), 0) AS cachedTokens,
        COALESCE(SUM(total_tokens), 0) AS totalTokens,
        COALESCE(SUM(cost_usd), 0) AS costUsd,
        COALESCE(SUM(list_cost_usd), 0) AS listCostUsd,
        COALESCE(SUM(estimated), 0) AS estimatedCalls,
        COALESCE(AVG(latency_ms), 0) AS avgLatencyMs,
        COALESCE(MAX(latency_ms), 0) AS maxLatencyMs
      FROM api_calls ${where}
    `).get(...params);

    const byDay = db.prepare(`
      SELECT date(ts / 1000, 'unixepoch', 'localtime') AS day,
        COUNT(*) AS calls,
        COALESCE(SUM(input_tokens), 0) AS inputTokens,
        COALESCE(SUM(output_tokens), 0) AS outputTokens,
        COALESCE(SUM(cost_usd), 0) AS costUsd,
        COALESCE(SUM(list_cost_usd), 0) AS listCostUsd
      FROM api_calls ${where}
      GROUP BY day ORDER BY day ASC
    `).all(...params);

    const byModel = db.prepare(`
      SELECT model, provider,
        COUNT(*) AS calls,
        COALESCE(SUM(input_tokens), 0) AS inputTokens,
        COALESCE(SUM(output_tokens), 0) AS outputTokens,
        COALESCE(SUM(cost_usd), 0) AS costUsd,
        COALESCE(SUM(list_cost_usd), 0) AS listCostUsd,
        COALESCE(AVG(latency_ms), 0) AS avgLatencyMs
      FROM api_calls ${where}
      GROUP BY model, provider ORDER BY costUsd DESC, calls DESC
    `).all(...params).map((row) => ({ ...row, rate: getModelPricing(row.model) }));

    const byStage = db.prepare(`
      SELECT stage,
        COUNT(*) AS calls,
        COALESCE(SUM(input_tokens), 0) AS inputTokens,
        COALESCE(SUM(output_tokens), 0) AS outputTokens,
        COALESCE(SUM(cost_usd), 0) AS costUsd,
        COALESCE(SUM(list_cost_usd), 0) AS listCostUsd,
        COALESCE(AVG(latency_ms), 0) AS avgLatencyMs
      FROM api_calls ${where}
      GROUP BY stage ORDER BY costUsd DESC, calls DESC
    `).all(...params);

    const projectWhere = buildUsageWhere(filters, 'c.');
    const byProject = db.prepare(`
      SELECT c.project_id AS projectId, COALESCE(p.name, '(deleted project)') AS projectName,
        COUNT(*) AS calls,
        COALESCE(SUM(c.input_tokens), 0) AS inputTokens,
        COALESCE(SUM(c.output_tokens), 0) AS outputTokens,
        COALESCE(SUM(c.cost_usd), 0) AS costUsd,
        COALESCE(SUM(c.list_cost_usd), 0) AS listCostUsd
      FROM api_calls c
      LEFT JOIN projects p ON p.id = c.project_id
      ${projectWhere.where}
      GROUP BY c.project_id ORDER BY costUsd DESC, calls DESC
    `).all(...projectWhere.params);

    return { totals, byDay, byModel, byStage, byProject };
  },

  deleteApiCalls: ({ before = null, all = false } = {}) => {
    if (all) {
      db.prepare(`DELETE FROM api_calls`).run();
      return;
    }
    if (before) {
      db.prepare(`DELETE FROM api_calls WHERE ts < ?`).run(before);
    }
  },

  // ---- Text replacement rules ----
  listTextRules: (projectId) =>
    db
      .prepare(
        `SELECT * FROM text_rules WHERE project_id = ?
         ORDER BY (page_number IS NOT NULL), page_number, created_at ASC`
      )
      .all(projectId),

  getTextRule: (projectId, id) =>
    db.prepare(`SELECT * FROM text_rules WHERE project_id = ? AND id = ?`).get(projectId, id),

  createTextRule: ({ projectId, pageNumber = null, find, replace = '', enabled = true, isRegex = false }) => {
    const now = Date.now();
    const id = randomUUID();
    db.prepare(`
      INSERT INTO text_rules (id, project_id, page_number, find, replace, enabled, is_regex, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, projectId, pageNumber, find, replace, enabled ? 1 : 0, isRegex ? 1 : 0, now, now);
    return queries.getTextRule(projectId, id);
  },

  updateTextRule: (projectId, id, patch = {}) => {
    const current = queries.getTextRule(projectId, id);
    if (!current) return null;
    db.prepare(`
      UPDATE text_rules SET find = ?, replace = ?, enabled = ?, is_regex = ?, updated_at = ?
      WHERE project_id = ? AND id = ?
    `).run(
      patch.find ?? current.find,
      patch.replace ?? current.replace,
      patch.enabled === undefined ? current.enabled : patch.enabled ? 1 : 0,
      patch.isRegex === undefined ? current.is_regex : patch.isRegex ? 1 : 0,
      Date.now(),
      projectId,
      id
    );
    return queries.getTextRule(projectId, id);
  },

  deleteTextRule: (projectId, id) => {
    const res = db.prepare(`DELETE FROM text_rules WHERE project_id = ? AND id = ?`).run(projectId, id);
    return Number(res.changes || 0);
  },

  /** Stamp recording which text_rules.updated_at the page's script already has. */
  setPageRulesStamp: (projectId, pageNumber, stamp) => {
    db.prepare(
      `UPDATE pages SET text_rules_stamp = ? WHERE project_id = ? AND page_number = ?`
    ).run(stamp, projectId, pageNumber);
  },

  // Settings
  getSettings: () => {
    const rows = db.prepare(`SELECT key, value FROM settings`).all();
    const map = { ...DEFAULT_SETTINGS };
    for (const r of rows) {
      map[r.key] = r.value;
    }
    return map;
  },

  updateSetting: (key, value) => {
    db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`).run(key, String(value));
  },

  updateSettings: (obj) => {
    const stmt = db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`);
    for (const [k, v] of Object.entries(obj)) {
      stmt.run(k, String(v));
    }
  },

  // ---- Voice library ----
  listVoices: () => db.prepare(`SELECT * FROM voices ORDER BY created_at ASC`).all(),

  getVoiceById: (id) => db.prepare(`SELECT * FROM voices WHERE id = ?`).get(id),

  getVoiceByName: (name) =>
    db.prepare(`SELECT * FROM voices WHERE lower(name) = lower(?)`).get(name),

  createVoice: ({ id, name, language = 'auto', refText = '', audioPath, duration = 0 }) => {
    const now = Date.now();
    db.prepare(`
      INSERT INTO voices (id, name, language, ref_text, audio_path, duration, origin, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'uploaded', ?, ?)
    `).run(id, name, language, refText, audioPath, duration, now, now);
    return queries.getVoiceById(id);
  },

  updateVoice: (id, { name, language, refText, duration }) => {
    const current = queries.getVoiceById(id);
    if (!current) return null;
    db.prepare(`
      UPDATE voices SET name = ?, language = ?, ref_text = ?, duration = ?, updated_at = ? WHERE id = ?
    `).run(
      name ?? current.name,
      language ?? current.language,
      refText ?? current.ref_text,
      duration ?? current.duration,
      Date.now(),
      id
    );
    return queries.getVoiceById(id);
  },

  deleteVoice: (id) => {
    db.prepare(`DELETE FROM voices WHERE id = ?`).run(id);
  }
};

// Metering sink: server/usage.js forwards every normalized call record here.
setUsageSink((record) => queries.logApiCall(record));

export default db;
