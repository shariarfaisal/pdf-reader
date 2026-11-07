import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { queries, DEFAULT_SETTINGS } from './db.js';
import { rulesStamp } from './textRules.js';
import { pipeline } from './pipeline.js';
import { getPdfInfo, renderPdfPage } from './ocr.js';
import { remoteColab } from './remote/colab.js';
import { modelManager } from './models.js';
import { PRICING } from './usage.js';
import { synthesizeAudio } from './tts.js';
import {
  BUILTIN_VOICE,
  PREVIEW_TEXT,
  deleteVoiceFiles,
  invalidatePrompt,
  newVoiceId,
  normalizeSample,
  syncVoicesToRemote,
  toPublicVoice,
  transcribeSample,
  writeVoiceManifest
} from './voices.js';
const app = express();
const PORT = process.env.PORT || 4321;

app.use(cors());
app.use(express.json());

// Static directories
const DATA_DIR = path.resolve(process.cwd(), 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Serve rendered page images, synthesized audio, and uploads
app.use('/data', express.static(DATA_DIR));

// Configure Multer for PDF uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const safeName = `${Date.now()}_${file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
    cb(null, safeName);
  }
});
const upload = multer({ storage });

// ==========================================
// SSE Real-Time Event Stream
// ==========================================
app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });

  const sendEvent = (eventData) => {
    res.write(`data: ${JSON.stringify(eventData)}\n\n`);
  };

  const unsubscribe = pipeline.subscribe(sendEvent);

  // Push the current remote GPU worker state to every new client immediately.
  sendEvent({ type: 'remote_status', status: remoteColab.status(), timestamp: Date.now() });

  // Send periodic system load stats every 2.5s
  const healthInterval = setInterval(() => {
    pipeline.broadcastSystemHealth();
  }, 2500);

  req.on('close', () => {
    clearInterval(healthInterval);
    unsubscribe();
  });
});

// ==========================================
// Projects API
// ==========================================

// List projects
app.get('/api/projects', (req, res) => {
  const projects = queries.getAllProjects();
  const enhanced = projects.map(p => {
    const pages = queries.getPagesByProjectId(p.id);
    const readyPages = pages.filter(pg => pg.status === 'ready').length;
    return {
      ...p,
      readyPages,
      percent: p.page_count > 0 ? Math.round((readyPages / p.page_count) * 100) : 0
    };
  });
  res.json({ projects: enhanced });
});

// Create new project by uploading PDF or supplying path
app.post('/api/projects', upload.single('pdf'), async (req, res) => {
  try {
    let pdfPath = '';
    let projectName = '';

    if (req.file) {
      pdfPath = req.file.path;
      projectName = req.body.name || path.basename(req.file.originalname, path.extname(req.file.originalname));
    } else if (req.body.pdfPath) {
      pdfPath = path.resolve(req.body.pdfPath);
      projectName = req.body.name || path.basename(pdfPath, path.extname(pdfPath));
    } else {
      return res.status(400).json({ error: 'No PDF file uploaded or path provided.' });
    }

    if (!fs.existsSync(pdfPath)) {
      return res.status(400).json({ error: `File not found at ${pdfPath}` });
    }

    // Inspect PDF info
    const info = await getPdfInfo(pdfPath);
    if (!info.pageCount || info.pageCount <= 0) {
      return res.status(400).json({ error: 'Invalid PDF or 0 pages found.' });
    }

    const projectId = 'proj_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
    const project = queries.createProject({
      id: projectId,
      name: projectName,
      pdfPath,
      pageCount: info.pageCount
    });

    // Pre-populate page rows. `sourcePage` pins each row to its physical PDF
    // page so later custom-page inserts / page deletions never re-map OCR.
    for (let i = 0; i < info.pageCount; i++) {
      queries.upsertPage({
        projectId,
        pageNumber: i,
        pageType: 'pdf',
        sourcePage: i,
        status: 'pending'
      });
    }

    pipeline.log('info', `Created project "${projectName}" with ${info.pageCount} pages.`);
    res.json({ project });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get project details + all page rows
app.get('/api/projects/:id', (req, res) => {
  const project = queries.getProjectById(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const pages = queries.getPagesByProjectId(req.params.id);
  res.json({ project, pages });
});

// Delete project
app.delete('/api/projects/:id', (req, res) => {  const id = req.params.id;
  if (pipeline.activeProjectId === id) {
    pipeline.stop(id);
  }
  queries.deleteProject(id);

  // Remove project folder on disk
  const projectDir = path.resolve(DATA_DIR, 'projects', id);
  if (fs.existsSync(projectDir)) {
    try { fs.rmSync(projectDir, { recursive: true, force: true }); } catch {}
  }

  res.json({ success: true });
});

// ==========================================
// Page Management API (insert / edit / delete)
// ==========================================

/** Stop any in-flight job for this project before page rows are re-indexed. */
async function haltPipelineForPageEdit(projectId) {
  if (pipeline.activeProjectId !== projectId) return;
  if (!pipeline.isRunning && !pipeline.loopInFlight) return;
  pipeline.stop(projectId);
  await waitForPipelineIdle();
}

/** Resolve the rendered page image on disk (DB path first, then id/canonical names). */
function resolvePageImage(projectId, pageNum) {
  const page = queries.getPage(projectId, pageNum);
  if (page?.render_path && fs.existsSync(page.render_path)) return page.render_path;
  const dir = path.resolve(DATA_DIR, 'projects', projectId, 'pages');
  const candidates = [];
  if (page?.id) candidates.push(path.join(dir, `page_${page.id}.png`));
  candidates.push(path.join(dir, `page_${pageNum}.png`));
  return candidates.find((f) => fs.existsSync(f)) || null;
}

/** Remove the on-disk artifacts that belong to a single page row. */
function deletePageArtifacts(page) {
  const files = [page?.render_path, page?.audio_path];
  if (page && page.source_page !== null && page.source_page !== undefined) {
    files.push(
      path.resolve(DATA_DIR, 'projects', page.project_id, 'previews', `page_${page.source_page}.jpg`)
    );
  }
  for (const file of files) {
    if (!file) continue;
    try {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch (err) {
      console.warn(`[Page] Could not delete ${file}: ${err.message}`);
    }
  }
}

// ------------------------------------------
// On-demand page previews
// The page manager must show what a page looks like BEFORE it is deleted, and
// most pages are not rasterized yet. Previews render at a small scale into their
// own `previews/` folder (never touching pipeline caches), one at a time, so the
// 8 GB M2 never spawns a burst of render processes.
// ------------------------------------------
const previewQueue = [];
const previewInFlight = new Map();
let previewRendering = false;

function previewPathFor(page) {
  const dir = path.resolve(DATA_DIR, 'projects', page.project_id, 'previews');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `page_${page.source_page ?? page.page_number}.jpg`);
}

function drainPreviewQueue() {
  if (previewRendering) return;
  const task = previewQueue.shift();
  if (!task) return;

  previewRendering = true;
  renderPdfPage(task.pdfPath, task.pageIndex, task.outPath, 1.4)
    .then(() => task.resolve(task.outPath))
    .catch((err) => task.reject(err))
    .finally(() => {
      previewRendering = false;
      drainPreviewQueue();
    });
}

function renderPagePreview({ project, page }) {
  const outPath = previewPathFor(page);
  if (fs.existsSync(outPath)) return Promise.resolve(outPath);
  if (previewInFlight.has(outPath)) return previewInFlight.get(outPath);

  const pdfPageIndex = page.source_page !== null && page.source_page !== undefined
    ? page.source_page
    : page.page_number;

  const task = new Promise((resolve, reject) => {
    previewQueue.push({ pdfPath: project.pdf_path, pageIndex: pdfPageIndex, outPath, resolve, reject });
    drainPreviewQueue();
  });

  previewInFlight.set(outPath, task);
  return task.finally(() => previewInFlight.delete(outPath));
}

/** Small rasterized preview of a page for the page manager (JPEG, cached on disk). */
app.get('/api/projects/:id/pages/:pageNum/preview', async (req, res) => {
  const projectId = req.params.id;
  const pageNum = parseInt(req.params.pageNum, 10);
  if (!Number.isInteger(pageNum) || pageNum < 0) {
    return res.status(400).json({ error: 'Invalid page number' });
  }

  const project = queries.getProjectById(projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const page = queries.getPage(projectId, pageNum);
  if (!page) return res.status(404).json({ error: 'Page not found' });
  if (page.page_type === 'custom') {
    return res.status(404).json({ error: 'Custom text pages have no page image' });
  }

  try {
    // Reuse the crisp pipeline raster if this page was already processed.
    const rendered = resolvePageImage(projectId, pageNum);
    const file = rendered || (await renderPagePreview({ project, page }));
    res.setHeader('Content-Type', rendered ? 'image/png' : 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.sendFile(file);
  } catch (err) {
    res.status(500).json({ error: `Preview render failed: ${err.message}` });
  }
});

/** Serve the rasterized page canvas for the reader. */
app.get('/api/projects/:id/pages/:pageNum/image', (req, res) => {
  const projectId = req.params.id;
  const pageNum = parseInt(req.params.pageNum, 10);
  if (!Number.isInteger(pageNum) || pageNum < 0) {
    return res.status(400).json({ error: 'Invalid page number' });
  }
  const imageFile = resolvePageImage(projectId, pageNum);
  if (!imageFile) {
    return res.status(404).json({ error: `Page ${pageNum + 1} has not been rasterized yet` });
  }
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(imageFile);
});

/** Insert a user-written text page at any position (0 = before the first page). */
app.post('/api/projects/:id/pages', async (req, res) => {
  const projectId = req.params.id;
  const project = queries.getProjectById(projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const text = String(req.body?.text ?? '').trim();
  if (!text) return res.status(400).json({ error: 'Custom page text cannot be empty.' });

  const pageCount = queries.countPages(projectId);
  const rawPosition = req.body?.position;
  const position =
    rawPosition === undefined || rawPosition === null || rawPosition === 'end'
      ? pageCount
      : parseInt(rawPosition, 10);

  if (!Number.isInteger(position) || position < 0 || position > pageCount) {
    return res.status(400).json({ error: `Invalid insert position (allowed 0-${pageCount}).` });
  }

  try {
    await haltPipelineForPageEdit(projectId);
    const page = queries.insertCustomPage({ projectId, position, text });
    pipeline.log(
      'info',
      `Custom text page inserted at position ${position + 1} of "${project.name}" (no OCR needed).`
    );
    res.json({
      success: true,
      page,
      pages: queries.getPagesByProjectId(projectId),
      project: queries.getProjectById(projectId)
    });
  } catch (err) {
    pipeline.log('error', `Insert custom page failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/** Edit the text of a page (custom or PDF). Allows editing raw OCR text, refined script, or both. */
app.patch('/api/projects/:id/pages/:pageNum', async (req, res) => {
  const projectId = req.params.id;
  const project = queries.getProjectById(projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const pageNum = parseInt(req.params.pageNum, 10);
  if (!Number.isInteger(pageNum) || pageNum < 0) {
    return res.status(400).json({ error: 'Invalid page number' });
  }

  const existing = queries.getPage(projectId, pageNum);
  if (!existing) return res.status(404).json({ error: 'Page not found' });

  // Support legacy custom page payload `{ text }` or specific `{ rawText, refinedText, clearAudio, clearRefined }`
  const hasSpecificFields = req.body?.rawText !== undefined || req.body?.raw_text !== undefined || req.body?.refinedText !== undefined || req.body?.refined_text !== undefined;
  const legacyText = req.body?.text !== undefined ? String(req.body.text).trim() : null;

  try {
    await haltPipelineForPageEdit(projectId);

    let updatedPage = null;
    if (!hasSpecificFields && legacyText !== null) {
      if (existing.page_type === 'custom') {
        if (!legacyText) return res.status(400).json({ error: 'Custom page text cannot be empty.' });
        deletePageArtifacts(existing);
        updatedPage = queries.updateCustomPageText(projectId, pageNum, legacyText);
        pipeline.log('info', `Custom text page ${pageNum + 1} updated — audio will be re-synthesized.`);
      } else {
        // For standard PDF pages, default legacy { text } to refined_text
        clearAudioFiles(projectId, [pageNum]);
        updatedPage = queries.updatePageText(projectId, pageNum, {
          refinedText: legacyText,
          clearAudio: true
        });
        pipeline.log('info', `Page ${pageNum + 1} narration script updated.`);
      }
    } else {
      const rawText = req.body?.rawText !== undefined ? String(req.body.rawText) : (req.body?.raw_text !== undefined ? String(req.body.raw_text) : undefined);
      const refinedText = req.body?.refinedText !== undefined ? String(req.body.refinedText) : (req.body?.refined_text !== undefined ? String(req.body.refined_text) : undefined);
      const clearAudio = Boolean(req.body?.clearAudio);
      const clearRefined = Boolean(req.body?.clearRefined);

      if (clearAudio) {
        clearAudioFiles(projectId, [pageNum]);
      }

      updatedPage = queries.updatePageText(projectId, pageNum, {
        rawText,
        refinedText,
        clearAudio,
        clearRefined
      });
      pipeline.log('info', `Page ${pageNum + 1} text updated manually.`);
    }

    if (updatedPage) {
      pipeline.broadcastPageStatus(projectId, pageNum, updatedPage.status, 'Text updated manually');
    }

    res.json({
      success: true,
      page: updatedPage,
      pages: queries.getPagesByProjectId(projectId),
      project: queries.getProjectById(projectId)
    });
  } catch (err) {
    pipeline.log('error', `Update page text failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/** Delete a page at any position; remaining positions are compacted. */
app.delete('/api/projects/:id/pages/:pageNum', async (req, res) => {
  const projectId = req.params.id;
  const project = queries.getProjectById(projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const pageNum = parseInt(req.params.pageNum, 10);
  if (!Number.isInteger(pageNum) || pageNum < 0) {
    return res.status(400).json({ error: 'Invalid page number' });
  }

  const existing = queries.getPage(projectId, pageNum);
  if (!existing) return res.status(404).json({ error: 'Page not found' });

  try {
    await haltPipelineForPageEdit(projectId);
    deletePageArtifacts(existing);
    queries.deletePageAt(projectId, pageNum);
    pipeline.log(
      'info',
      `Page ${pageNum + 1} (${existing.page_type === 'custom' ? 'custom text' : 'PDF'}) removed from "${project.name}".`
    );
    res.json({
      success: true,
      removedPageNumber: pageNum,
      pages: queries.getPagesByProjectId(projectId),
      project: queries.getProjectById(projectId)
    });
  } catch (err) {
    pipeline.log('error', `Delete page failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/** Bulk delete: remove many pages in one atomic pass, then compact the numbering once. */
app.delete('/api/projects/:id/pages', async (req, res) => {
  const projectId = req.params.id;
  const project = queries.getProjectById(projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const pageIds = Array.isArray(req.body?.pageIds) ? req.body.pageIds.map(String) : [];
  const pageNumbers = Array.isArray(req.body?.pageNumbers)
    ? req.body.pageNumbers.map((n) => parseInt(n, 10)).filter((n) => Number.isInteger(n) && n >= 0)
    : [];

  if (pageIds.length === 0 && pageNumbers.length === 0) {
    return res.status(400).json({ error: 'Select at least one page to delete.' });
  }

  const wantedIds = new Set(pageIds);
  const wantedNumbers = new Set(pageNumbers);
  const targets = queries
    .getPagesByProjectId(projectId)
    .filter((page) => wantedIds.has(page.id) || wantedNumbers.has(page.page_number));

  if (targets.length === 0) {
    return res.status(404).json({ error: 'Those pages no longer exist. Refresh and try again.' });
  }

  try {
    await haltPipelineForPageEdit(projectId);
    for (const page of targets) deletePageArtifacts(page);

    const removed = queries.deletePagesAt(
      projectId,
      targets.map((page) => page.page_number)
    );

    pipeline.log(
      'info',
      `${removed.length} page${removed.length === 1 ? '' : 's'} removed from "${project.name}" (positions ${removed
        .map((page) => page.page_number + 1)
        .join(', ')}).`
    );

    res.json({
      success: true,
      removedCount: removed.length,
      removedPageNumbers: removed.map((page) => page.page_number),
      pages: queries.getPagesByProjectId(projectId),
      project: queries.getProjectById(projectId)
    });
  } catch (err) {
    pipeline.log('error', `Bulk delete failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// Remote Colab GPU TTS control & Plug-and-Play Setup
// ==========================================
remoteColab.setLogger((level, message) => pipeline.log(level, message));
remoteColab.setStatusListener((status) => {
  pipeline.broadcast({ type: 'remote_status', status, timestamp: Date.now() });
});

modelManager.subscribe((event) => {
  pipeline.broadcast({ ...event, timestamp: Date.now() });
});

app.get('/api/remote/status', (req, res) => {
  res.json({ status: remoteColab.status() });
});

app.get('/api/remote/setup-status', async (req, res) => {
  try {
    const verifyAccount = req.query.verify === '1' || req.query.verify === 'true';
    const includeUsage = req.query.usage === '1' || req.query.usage === 'true';
    const setup = await remoteColab.getSetupStatus({ verifyAccount, includeUsage });
    res.json({ success: true, setup });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/remote/install', async (req, res) => {
  try {
    const setup = await remoteColab.installCli();
    res.json({ success: true, setup });
  } catch (error) {
    const setup = await remoteColab.getSetupStatus().catch(() => null);
    res.status(500).json({ error: error.message, setup });
  }
});

app.post('/api/remote/ssh-key', async (req, res) => {
  try {
    const ssh = await remoteColab.ensureSshKey();
    const setup = await remoteColab.getSetupStatus();
    res.json({ success: true, ssh, setup });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/remote/auth/start', async (req, res) => {
  try {
    const flow = await remoteColab.startAuthFlow();
    res.json({ success: true, ...flow });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/remote/auth/cancel', (req, res) => {
  remoteColab.cancelAuthFlow();
  res.json({ success: true });
});

app.post('/api/remote/auth/complete', async (req, res) => {
  try {
    const setup = await remoteColab.completeAuthFlow(req.body?.code || req.body?.token);
    res.json({ success: true, setup });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/remote/auth/logout', async (req, res) => {
  try {
    const setup = await remoteColab.logoutAuth();
    res.json({ success: true, setup });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/remote/start', async (req, res) => {
  try {
    // Explicit user action: bypass the failure cooldown.
    const status = await remoteColab.start('manual start', { force: true });
    res.json({ success: true, status });
  } catch (error) {
    res.status(500).json({ error: error.message, status: remoteColab.status() });
  }
});

app.post('/api/remote/touch', (req, res) => {
  if (remoteColab.status().state === 'running') {
    remoteColab.touch();
  }
  res.json({ success: true, status: remoteColab.status() });
});

app.post('/api/remote/stop', async (req, res) => {
  try {
    const status = await remoteColab.stop('manual stop');
    res.json({ success: true, status });
  } catch (error) {
    res.status(500).json({ error: error.message, status: remoteColab.status() });
  }
});

// ==========================================
// Local AI Models & Catalog Manager API
// ==========================================
app.get('/api/models', async (req, res) => {
  try {
    const refreshPython = req.query.refresh === '1' || req.query.refresh === 'true';
    const data = await modelManager.getCatalogStatus({ refreshPython });
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/models/custom', async (req, res) => {
  try {
    const model = modelManager.registerCustomModel(req.body || {});
    pipeline.log('info', `Registered custom model "${model.name}" (${model.task.toUpperCase()}).`);
    const catalog = await modelManager.getCatalogStatus();
    res.status(201).json({ success: true, model, ...catalog });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/models/:id/download', async (req, res) => {
  try {
    const progress = await modelManager.startDownload(req.params.id);
    pipeline.log('info', `Started model download: ${req.params.id}`);
    res.json({ success: true, progress });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/models/:id/cancel', (req, res) => {
  const cancelled = modelManager.cancelDownload(req.params.id);
  if (cancelled) {
    pipeline.log('info', `Cancelled model download: ${req.params.id}`);
  }
  res.json({ success: true, cancelled });
});

app.post('/api/models/:id/reference', async (req, res) => {
  try {
    const model = modelManager.setReferencePath(req.params.id, req.body?.path || '');
    pipeline.log(
      'info',
      model.customRefPath
        ? `Linked "${model.name}" to local path: ${model.customRefPath}`
        : `Cleared custom path for "${model.name}" (using default cache).`
    );
    const catalog = await modelManager.getCatalogStatus();
    res.json({ success: true, model, ...catalog });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/models/:id/activate', async (req, res) => {
  try {
    const def = modelManager.getModelDefinition(req.params.id);
    if (!def) return res.status(404).json({ error: 'Model not found' });
    const task = req.body?.task || def.task;
    const model = modelManager.setActiveModel(task, req.params.id);
    pipeline.log('info', `Set active ${task.toUpperCase()} model to "${model.name}".`);
    const catalog = await modelManager.getCatalogStatus();
    res.json({ success: true, model, settings: queries.getSettings(), ...catalog });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/models/:id', async (req, res) => {
  try {
    const deleteFiles = req.query.deleteFiles !== '0' && req.query.deleteFiles !== 'false';
    const removeCustomEntry = req.query.removeEntry === '1' || req.query.removeEntry === 'true';
    const result = modelManager.deleteModel(req.params.id, { deleteFiles, removeCustomEntry });
    pipeline.log('info', `Removed model weights / reference for "${req.params.id}".`);
    const catalog = await modelManager.getCatalogStatus();
    res.json({ success: true, ...result, ...catalog });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Pipeline Controls
// `stage` accepts 'all' | 'ocr' | 'refine' | 'audio'. Each stage keeps its own
// state, so starting/​pausing one never disturbs the others.
app.post('/api/projects/:id/start', async (req, res) => {
  const settings = queries.getSettings();
  const stage = req.body?.stage || settings.pipeline_stage_target || 'all';
  await pipeline.start(req.params.id, { stage });
  res.json({ success: true, message: `Pipeline started [${stage}]`, stage });
});

app.post('/api/projects/:id/pause', (req, res) => {
  const stage = req.body?.stage || 'all';
  pipeline.pause(req.params.id, { stage });
  res.json({ success: true, message: `Paused [${stage}]`, stage });
});

app.post('/api/projects/:id/resume', (req, res) => {
  const stage = req.body?.stage || 'all';
  pipeline.resume(req.params.id, { stage });
  res.json({ success: true, message: `Resumed [${stage}]`, stage });
});

app.post('/api/projects/:id/step', async (req, res) => {
  const pageNum = req.body?.pageNumber !== undefined ? parseInt(req.body.pageNumber, 10) : null;
  const settings = queries.getSettings();
  const stage = req.body?.stage || settings.pipeline_stage_target || 'all';
  await pipeline.step(req.params.id, pageNum, { stage });
  res.json({ success: true, message: `Step page triggered [${stage}]`, stage, pageNumber: pageNum });
});

app.post('/api/projects/:id/stop', (req, res) => {
  pipeline.stop(req.params.id);
  res.json({ success: true, message: 'Pipeline stopped' });
});

// Live per-stage state (the SSE stream also pushes `stage_status` events).
app.get('/api/projects/:id/stages', (req, res) => {
  res.json({
    success: true,
    activeProjectId: pipeline.activeProjectId,
    loopInFlight: pipeline.loopInFlight,
    stages: { ...pipeline.stageStates }
  });
});

// ==========================================
// Text replacement rules (per project or per page)
// ==========================================
const TEXT_RULE_MAX = 200;

function parseRuleScope(value) {
  if (value === null || value === undefined || value === '' || value === 'project') return null;
  const pageNumber = parseInt(value, 10);
  return Number.isInteger(pageNumber) && pageNumber >= 0 ? pageNumber : null;
}

function validateRuleInput(body, { partial = false } = {}) {
  const find = body?.find !== undefined ? String(body.find) : undefined;
  if (!partial && (!find || !find.trim())) {
    return { error: 'find is required — that is the text to replace.' };
  }
  if (!partial && find !== undefined && find.length > 2000) {
    return { error: 'find is limited to 2000 characters.' };
  }
  const replace = body?.replace !== undefined ? String(body.replace) : undefined;
  if (replace !== undefined && replace.length > 2000) {
    return { error: 'replace is limited to 2000 characters.' };
  }
  return { find, replace };
}

app.get('/api/projects/:id/rules', (req, res) => {
  const project = queries.getProjectById(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const rules = queries.listTextRules(project.id);
  res.json({
    success: true,
    rules,
    // Fully applied rules version, useful for spotting stale pages.
    stamp: rulesStamp(rules)
  });
});

app.post('/api/projects/:id/rules', (req, res) => {
  const project = queries.getProjectById(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const existing = queries.listTextRules(project.id);
  if (existing.length >= TEXT_RULE_MAX) {
    return res.status(400).json({ error: `At most ${TEXT_RULE_MAX} replacement rules per project.` });
  }

  const { error, find, replace } = validateRuleInput(req.body);
  if (error) return res.status(400).json({ error });

  const isRegex = Boolean(req.body?.isRegex);
  if (isRegex) {
    try {
      new RegExp(find);
    } catch (err) {
      return res.status(400).json({ error: `Invalid regex: ${err.message}` });
    }
  }

  const pageNumber = parseRuleScope(req.body?.pageNumber);
  const rule = queries.createTextRule({
    projectId: project.id,
    pageNumber,
    find,
    replace: replace ?? '',
    enabled: req.body?.enabled === undefined ? true : Boolean(req.body.enabled),
    isRegex
  });
  pipeline.log(
    'info',
    `Replacement rule added (${pageNumber === null ? 'project' : `page ${pageNumber + 1}`}): "${find.slice(0, 40)}" → "${(replace ?? '').slice(0, 40)}".`
  );
  res.status(201).json({ success: true, rule, rules: queries.listTextRules(project.id) });
});

app.patch('/api/projects/:id/rules/:ruleId', (req, res) => {
  const project = queries.getProjectById(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const existing = queries.getTextRule(project.id, req.params.ruleId);
  if (!existing) return res.status(404).json({ error: 'Rule not found' });

  const { error, find, replace } = validateRuleInput(req.body, { partial: true });
  if (error) return res.status(400).json({ error });

  const isRegex = req.body?.isRegex === undefined ? existing.is_regex : Boolean(req.body.isRegex);
  const nextFind = find ?? existing.find;
  if (isRegex) {
    try {
      new RegExp(nextFind);
    } catch (err) {
      return res.status(400).json({ error: `Invalid regex: ${err.message}` });
    }
  }

  const rule = queries.updateTextRule(project.id, existing.id, {
    find,
    replace,
    isRegex: req.body?.isRegex === undefined ? undefined : isRegex,
    enabled: req.body?.enabled === undefined ? undefined : Boolean(req.body.enabled)
  });
  res.json({ success: true, rule, rules: queries.listTextRules(project.id) });
});

app.delete('/api/projects/:id/rules/:ruleId', (req, res) => {
  const project = queries.getProjectById(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const removed = queries.deleteTextRule(project.id, req.params.ruleId);
  if (!removed) return res.status(404).json({ error: 'Rule not found' });
  res.json({ success: true, rules: queries.listTextRules(project.id) });
});

// Apply stored scripts through the current rules (no LLM / TTS calls).
app.post('/api/projects/:id/rules/apply', (req, res) => {
  const project = queries.getProjectById(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const rawPages = req.body?.pageNumbers;
  const pageNumbers = Array.isArray(rawPages)
    ? rawPages.map((n) => parseInt(n, 10)).filter((n) => Number.isInteger(n) && n >= 0)
    : null;

  try {
    const result = pipeline.applyRulesToProject(project.id, { pageNumbers });
    pipeline.log(
      'info',
      `Text rules applied: ${result.changed} script${result.changed === 1 ? '' : 's'} rewritten${result.audioCleared ? `, ${result.audioCleared} audio file(s) cleared for re-synthesis` : ''}.`
    );
    res.json({ success: true, ...result, pages: queries.getPagesByProjectId(project.id) });
  } catch (err) {
    pipeline.log('error', `Applying text rules failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// Regeneration API (page-wise or whole book)
// ==========================================

/** Remove synthesized audio files so the pipeline re-synthesizes them. */
function clearAudioFiles(projectId, pageNumbers = null) {
  const audioDir = path.resolve(DATA_DIR, 'projects', projectId, 'audio');
  if (!fs.existsSync(audioDir)) return;

  const targets = new Set();
  if (!pageNumbers) {
    // Full project clear: every file in the audio dir is fair game.
    for (const file of fs.readdirSync(audioDir)) targets.add(path.join(audioDir, file));
  }

  // Page rows store their own audio filename (id-based for new rows, legacy
  // page_<n>.wav for old ones), so resolve them from the DB. Never guess a
  // filename from the display position — positions shift when pages are edited.
  const pages = pageNumbers
    ? pageNumbers.map((n) => queries.getPage(projectId, n)).filter(Boolean)
    : queries.getPagesByProjectId(projectId);
  for (const page of pages) {
    if (page.audio_path) targets.add(page.audio_path);
  }

  for (const file of targets) {
    try {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch (err) {
      console.warn(`[Regenerate] Could not delete ${file}: ${err.message}`);
    }
  }
}

/** Wait (briefly) for any in-flight pipeline loop to release the engine. */
async function waitForPipelineIdle(timeoutMs = 8000) {
  const started = Date.now();
  while (pipeline.loopInFlight && Date.now() - started < timeoutMs) {
    await new Promise((r) => setTimeout(r, 150));
  }
  return !pipeline.loopInFlight;
}

// Regenerate one page: 'audio' (audio only), 'narration' / 'refine' (refine + audio), 'ocr' (OCR only), or 'full' (OCR + refine + audio)
app.post('/api/projects/:id/pages/:pageNum/regenerate', async (req, res) => {
  const projectId = req.params.id;
  const pageNum = parseInt(req.params.pageNum, 10);
  const rawMode = req.body?.mode || 'narration';
  const mode = ['audio', 'refine', 'narration', 'ocr', 'full'].includes(rawMode) ? rawMode : 'narration';
  const autoStart = req.body?.start !== false;

  if (!queries.getProjectById(projectId)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  if (!Number.isInteger(pageNum) || pageNum < 0) {
    return res.status(400).json({ error: 'Invalid page number' });
  }

  try {
    if (pipeline.activeProjectId === projectId && (pipeline.isRunning || pipeline.loopInFlight)) {
      pipeline.stop(projectId);
      await waitForPipelineIdle();
    }

    if (mode === 'audio') {
      queries.resetPageStages(projectId, pageNum, { audioOnly: true });
      clearAudioFiles(projectId, [pageNum]);
      pipeline.log('info', `Regenerate Page ${pageNum + 1} (Audio only) — cache cleared.`);
      if (autoStart) await pipeline.step(projectId, pageNum, { stage: 'audio' });
    } else if (mode === 'ocr') {
      queries.resetPageStages(projectId, pageNum, { ocrOnly: true });
      clearAudioFiles(projectId, [pageNum]);
      pipeline.log('info', `Regenerate Page ${pageNum + 1} (OCR extraction only) — cache cleared.`);
      if (autoStart) await pipeline.step(projectId, pageNum, { stage: 'ocr' });
    } else if (mode === 'refine' || mode === 'narration') {
      queries.resetPageStages(projectId, pageNum, { includeRaw: false });
      clearAudioFiles(projectId, [pageNum]);
      pipeline.log('info', `Regenerate Page ${pageNum + 1} (Narration + Audio) — cache cleared.`);
      if (autoStart) await pipeline.step(projectId, pageNum, { stage: 'all' });
    } else {
      queries.resetPageStages(projectId, pageNum, { includeRaw: true });
      clearAudioFiles(projectId, [pageNum]);
      pipeline.log('info', `Regenerate Page ${pageNum + 1} (Full: OCR + Narration + Audio) — cache cleared.`);
      if (autoStart) await pipeline.step(projectId, pageNum, { stage: 'all' });
    }

    res.json({ success: true, scope: 'page', pageNumber: pageNum, mode, started: autoStart });
  } catch (err) {
    pipeline.log('error', `Regenerate page failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// Regenerate every page of a project: 'audio', 'narration', 'ocr', or 'full'
app.post('/api/projects/:id/regenerate', async (req, res) => {
  const projectId = req.params.id;
  const rawMode = req.body?.mode || 'narration';
  const mode = ['audio', 'refine', 'narration', 'ocr', 'full'].includes(rawMode) ? rawMode : 'narration';
  const autoStart = req.body?.start !== false;

  const project = queries.getProjectById(projectId);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  try {
    if (pipeline.activeProjectId === projectId && (pipeline.isRunning || pipeline.loopInFlight)) {
      pipeline.stop(projectId);
      await waitForPipelineIdle();
    }

    if (mode === 'audio') {
      queries.resetProjectStages(projectId, { audioOnly: true });
      clearAudioFiles(projectId);
      pipeline.log('info', `Regenerate Book "${project.name}" (Audio only) — all audio caches cleared.`);
      if (autoStart) await pipeline.start(projectId, { stage: 'audio' });
    } else if (mode === 'ocr') {
      queries.resetProjectStages(projectId, { ocrOnly: true });
      clearAudioFiles(projectId);
      pipeline.log('info', `Regenerate Book "${project.name}" (OCR extraction only) — all caches cleared.`);
      if (autoStart) await pipeline.start(projectId, { stage: 'ocr' });
    } else if (mode === 'refine' || mode === 'narration') {
      queries.resetProjectStages(projectId, { includeRaw: false });
      clearAudioFiles(projectId);
      pipeline.log('info', `Regenerate Book "${project.name}" (Narration + Audio) — script & audio caches cleared.`);
      if (autoStart) await pipeline.start(projectId, { stage: 'all' });
    } else {
      queries.resetProjectStages(projectId, { includeRaw: true });
      clearAudioFiles(projectId);
      pipeline.log('info', `Regenerate Book "${project.name}" (Full: OCR + Narration + Audio) — all caches cleared.`);
      if (autoStart) await pipeline.start(projectId, { stage: 'all' });
    }

    res.json({ success: true, scope: 'project', pageCount: project.page_count, mode, started: autoStart });
  } catch (err) {
    pipeline.log('error', `Regenerate project failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// Audio Download API
// ==========================================

/** Resolve the audio file on disk for a page (DB path first, then canonical path). */
function resolvePageAudio(projectId, pageNum) {
  const page = queries.getPage(projectId, pageNum);
  if (page?.audio_path && fs.existsSync(page.audio_path)) return page.audio_path;
  const fallback = path.join(DATA_DIR, 'projects', projectId, 'audio', `page_${pageNum}.wav`);
  return fs.existsSync(fallback) ? fallback : null;
}

/** Sanitize a project name for use inside a download filename. */
function safeFileName(name, fallback = 'audio') {
  const clean = (name || '').replace(/[^a-zA-Z0-9._ -]/g, '').replace(/\s+/g, ' ').trim();
  return clean || fallback;
}

// Stream a page's narration audio (inline for the player, attachment for download)
app.get('/api/projects/:id/pages/:pageNum/audio', (req, res) => {
  const projectId = req.params.id;
  const pageNum = parseInt(req.params.pageNum, 10);
  if (!Number.isInteger(pageNum) || pageNum < 0) {
    return res.status(400).json({ error: 'Invalid page number' });
  }

  const audioFile = resolvePageAudio(projectId, pageNum);
  if (!audioFile) {
    return res.status(404).json({ error: `No audio synthesized yet for page ${pageNum + 1}` });
  }

  const inline = req.query.inline === '1' || req.query.inline === 'true';
  const stat = fs.statSync(audioFile);
  res.setHeader('Content-Type', 'audio/wav');
  // Byte ranges let the player scrub, resume mid-page, and jump to the sentence
  // the user clicked. Without them Chrome reports seekable=0 and refuses seeks.
  res.setHeader('Accept-Ranges', 'bytes');
  // The URL carries a version param that changes when audio is regenerated, so
  // short-lived caching is safe and lets the player pre-buffer the next page.
  res.setHeader('Cache-Control', inline ? 'private, max-age=600' : 'no-store');

  if (!inline) {
    const project = queries.getProjectById(projectId);
    const baseName = safeFileName(project?.name, 'narration');
    const downloadName = `${baseName} - Page ${String(pageNum + 1).padStart(4, '0')}.wav`;
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${downloadName.replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(downloadName)}`
    );
  }

  const rangeMatch = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || '').trim());
  if (rangeMatch && (rangeMatch[1] || rangeMatch[2])) {
    const size = stat.size;
    let start = rangeMatch[1] ? parseInt(rangeMatch[1], 10) : 0;
    let end = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : size - 1;
    if (!rangeMatch[1] && rangeMatch[2]) {
      start = Math.max(0, size - parseInt(rangeMatch[2], 10));
      end = size - 1;
    }
    if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) {
      res.status(416).setHeader('Content-Range', `bytes */${size}`);
      return res.end();
    }
    end = Math.min(end, size - 1);
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
    res.setHeader('Content-Length', end - start + 1);
    const partial = fs.createReadStream(audioFile, { start, end });
    partial.on('error', (err) => {
      if (!res.headersSent) res.status(500).json({ error: err.message });
      else res.destroy();
    });
    req.on('close', () => partial.destroy());
    return partial.pipe(res);
  }

  res.setHeader('Content-Length', stat.size);
  const stream = fs.createReadStream(audioFile);
  stream.on('error', (err) => {
    if (!res.headersSent) res.status(500).json({ error: err.message });
    else res.destroy();
  });
  req.on('close', () => stream.destroy());
  stream.pipe(res);
});

// Download every synthesized page audio as a single .tar.gz archive
app.get('/api/projects/:id/audio-archive', (req, res) => {
  const projectId = req.params.id;
  const project = queries.getProjectById(projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  // Order strictly by the project's page sequence, so custom pages / deletions
  // are reflected in the archive no matter what the file names look like.
  const pages = queries.getPagesByProjectId(projectId);
  const entries = [];
  for (const page of pages) {
    const file = resolvePageAudio(projectId, page.page_number);
    if (!file) continue;
    entries.push({ file, name: `Page_${String(page.page_number + 1).padStart(4, '0')}.wav` });
  }

  if (entries.length === 0) {
    return res.status(404).json({ error: 'No audio synthesized for this project yet' });
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-reader-audio-'));
  const cleanup = () => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  };

  try {
    for (const entry of entries) {
      fs.copyFileSync(entry.file, path.join(tmpDir, entry.name));
    }
  } catch (err) {
    cleanup();
    return res.status(500).json({ error: `Could not stage audio files: ${err.message}` });
  }

  const archiveName = `${safeFileName(project.name, 'project')} - Audio.tar.gz`;
  res.setHeader('Content-Type', 'application/gzip');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${archiveName.replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(archiveName)}`
  );

  const tar = spawn('tar', ['-czf', '-', '-C', tmpDir, '.'], {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let tarErr = '';
  tar.stderr.on('data', (chunk) => {
    tarErr += chunk.toString();
  });
  tar.on('error', (err) => {
    cleanup();
    if (!res.headersSent) res.status(500).json({ error: `tar failed: ${err.message}` });
    else res.destroy();
  });
  tar.on('close', (code) => {
    if (code !== 0) console.error(`[Audio Archive] tar exited ${code}: ${tarErr}`);
    cleanup();
  });
  req.on('close', () => tar.kill('SIGTERM'));
  tar.stdout.pipe(res);
});

// ==========================================
// API Usage & Call Logs
// ==========================================
/**
 * Normalize usage filters from a query string.
 * `from`/`to` accept `YYYY-MM-DD` (local day, inclusive) or epoch milliseconds.
 */
function parseUsageFilters(query = {}) {
  const toEpoch = (value, isEnd) => {
    if (value === undefined || value === null || value === '') return null;
    const raw = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      const [y, m, d] = raw.split('-').map(Number);
      return isEnd
        ? new Date(y, m - 1, d, 23, 59, 59, 999).getTime()
        : new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
    }
    const num = Number(raw);
    return Number.isFinite(num) && num > 0 ? num : null;
  };

  return {
    from: toEpoch(query.from, false),
    to: toEpoch(query.to, true),
    projectId: query.projectId || query.project_id || null,
    stage: query.stage || null,
    model: query.model || null,
    provider: query.provider || null,
    status: query.status || null,
    q: query.q || null,
    limit: query.limit,
    offset: query.offset
  };
}

// Aggregated metrics for the date range (cards, charts, breakdowns)
app.get('/api/usage/summary', (req, res) => {
  try {
    const filters = parseUsageFilters(req.query);
    res.json({ filters, ...queries.getApiUsageSummary(filters) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Paginated raw call log
app.get('/api/usage/logs', (req, res) => {
  try {
    const filters = parseUsageFilters(req.query);
    const result = queries.queryApiCalls(filters);
    res.json({ filters, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Price list used for cost estimation (USD per 1M tokens)
app.get('/api/usage/pricing', (req, res) => {
  res.json({ unit: 'USD per 1M tokens', pricing: PRICING });
});

// CSV export of the filtered log
app.get('/api/usage/export.csv', (req, res) => {
  try {
    const filters = { ...parseUsageFilters(req.query), limit: 500, offset: 0 };
    const header = [
      'timestamp', 'project', 'page', 'stage', 'provider', 'model',
      'input_tokens', 'output_tokens', 'cached_tokens', 'total_tokens',
      'cost_usd', 'list_cost_usd', 'estimated', 'latency_ms', 'http_status', 'status', 'error'
    ];
    const escape = (value) => {
      if (value === null || value === undefined) return '';
      const str = String(value);
      return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    };

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="api-usage-${new Date().toISOString().slice(0, 10)}.csv"`
    );
    res.write(`${header.join(',')}\n`);

    let offset = 0;
    for (;;) {
      const { rows } = queries.queryApiCalls({ ...filters, limit: 500, offset });
      for (const r of rows) {
        res.write([
          new Date(r.ts).toISOString(),
          r.project_name || r.project_id || '',
          r.page_number === null ? '' : r.page_number + 1,
          r.stage,
          r.provider,
          r.model,
          r.input_tokens,
          r.output_tokens,
          r.cached_tokens,
          r.total_tokens,
          r.cost_usd,
          r.list_cost_usd,
          r.estimated ? 'yes' : 'no',
          r.latency_ms,
          r.http_status,
          r.status,
          r.error
        ].map(escape).join(',') + '\n');
      }
      if (rows.length < 500) break;
      offset += 500;
    }
    res.end();
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
    else res.end();
  }
});

// Prune the log: ?all=1 wipes it, ?before=<epochMs> drops older rows
app.delete('/api/usage/logs', (req, res) => {
  try {
    const all = req.query.all === '1' || req.query.all === 'true';
    const before = Number(req.query.before) || null;
    if (!all && !before) {
      return res.status(400).json({ error: 'Provide ?all=1 or ?before=<epochMs>' });
    }
    queries.deleteApiCalls({ all, before });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// Settings API
// ==========================================
app.get('/api/settings', (req, res) => {
  const settings = queries.getSettings();
  res.json({ settings });
});

// Defaults exposed for UI "reset to default" actions (no secrets beyond local proxy placeholders)
app.get('/api/settings/defaults', (req, res) => {
  res.json({
    defaults: {
      refiner_system_prompt: DEFAULT_SETTINGS.refiner_system_prompt,
      refiner_extra_instructions: DEFAULT_SETTINGS.refiner_extra_instructions
    }
  });
});

app.post('/api/settings', (req, res) => {
  queries.updateSettings(req.body);
  pipeline.log('info', 'Application settings updated.');
  res.json({ success: true, settings: queries.getSettings() });
});

// ==========================================
// Voice library API (cloned voices)
// ==========================================
const audioUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || '.audio';
      cb(null, `voice_${Date.now()}${ext.replace(/[^a-zA-Z0-9.]/g, '')}`);
    }
  }),
  limits: { fileSize: 40 * 1024 * 1024 }
});

app.get('/api/voices', (req, res) => {
  const settings = queries.getSettings();
  const voices = queries.listVoices().map(toPublicVoice);
  res.json({
    voices,
    builtin: {
      id: BUILTIN_VOICE,
      name: 'Built-in reference voice',
      description: 'Bundled Sirah sample — always available, no upload needed.'
    },
    defaults: {
      bn: settings.tts_voice_bn || BUILTIN_VOICE,
      en: settings.tts_voice_en || BUILTIN_VOICE,
      ar: settings.tts_voice_ar || BUILTIN_VOICE
    },
    remote: remoteColab.status().state
  });
});

app.get('/api/voices/:id/audio', (req, res) => {
  const voice = queries.getVoiceById(req.params.id);
  if (!voice || !fs.existsSync(voice.audio_path)) {
    return res.status(404).json({ error: 'Voice sample not found' });
  }
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.resolve(voice.audio_path));
});

// Upload a new voice: normalize audio, transcribe it, store it, warm the worker.
// The file may arrive as `audio`, `sample` or `file` — clients differ, and a
// multer "unexpected field" would otherwise become an HTML error page.
const VOICE_UPLOAD_FIELDS = audioUpload.fields([
  { name: 'audio', maxCount: 1 },
  { name: 'sample', maxCount: 1 },
  { name: 'file', maxCount: 1 }
]);

app.post('/api/voices', VOICE_UPLOAD_FIELDS, async (req, res) => {
  const uploaded =
    (req.files && (req.files.audio?.[0] || req.files.sample?.[0] || req.files.file?.[0])) || req.file;

  if (!uploaded) {
    return res.status(400).json({
      error: 'No audio file uploaded (expected form field "audio", "sample" or "file").'
    });
  }
  req.file = uploaded;

  const name = (req.body.name || '').trim();
  if (!name) {
    fs.rmSync(req.file.path, { force: true });
    return res.status(400).json({ error: 'Voice name is required.' });
  }
  if (queries.getVoiceByName(name)) {
    fs.rmSync(req.file.path, { force: true });
    return res.status(409).json({ error: `A voice named "${name}" already exists.` });
  }

  const language = ['bn', 'en', 'ar', 'auto'].includes(req.body.language) ? req.body.language : 'auto';
  const id = newVoiceId();

  try {
    const { audioPath, duration } = await normalizeSample(req.file.path, id);
    fs.rmSync(req.file.path, { force: true });

    let refText = (req.body.refText || '').trim();
    let warning = null;
    if (!refText) {
      const asr = await transcribeSample(audioPath, language);
      refText = asr.text || '';
      warning = asr.warning || null;
    }

    const voice = queries.createVoice({ id, name, language, refText, audioPath, duration });
    writeVoiceManifest();

    // A hand-typed transcript that does not match the clip wrecks the clone.
    const publicVoice = toPublicVoice(voice);
    if (publicVoice.transcriptWarning) {
      pipeline.log('warn', `Voice "${name}": ${publicVoice.transcriptWarning.message}`);
    }

    // Warm the GPU worker (and its clone prompt) in the background.
    syncVoicesToRemote({ force: true }).catch(() => {});
    pipeline.log('info', `Voice "${name}" added (${duration.toFixed(1)}s sample, language ${language}).`);

    res.status(201).json({
      voice: publicVoice,
      warning:
        publicVoice.transcriptWarning?.message ||
        warning ||
        (refText ? null : 'No transcript detected — edit it for a better clone.')
    });
  } catch (error) {
    fs.rmSync(req.file.path, { force: true });
    deleteVoiceFiles(id);
    res.status(400).json({ error: error.message });
  }
});

app.patch('/api/voices/:id', async (req, res) => {
  const existing = queries.getVoiceById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Voice not found' });

  const patch = {};
  if (typeof req.body?.name === 'string' && req.body.name.trim()) {
    const clash = queries.getVoiceByName(req.body.name.trim());
    if (clash && clash.id !== existing.id) {
      return res.status(409).json({ error: `A voice named "${req.body.name.trim()}" already exists.` });
    }
    patch.name = req.body.name.trim();
  }
  if (typeof req.body?.language === 'string') patch.language = req.body.language;
  if (typeof req.body?.refText === 'string') patch.refText = req.body.refText.trim();

  const voice = queries.updateVoice(existing.id, patch);
  writeVoiceManifest();

  // A changed transcript invalidates the encoded clone prompt on both backends.
  if (patch.refText !== undefined) {
    invalidatePrompt(existing.id);
    syncVoicesToRemote({ force: true }).catch(() => {});
  }

  const publicVoice = toPublicVoice(voice);
  if (publicVoice.transcriptWarning) {
    pipeline.log('warn', `Voice "${voice.name}": ${publicVoice.transcriptWarning.message}`);
  }
  res.json({ voice: publicVoice, warning: publicVoice.transcriptWarning?.message || null });
});

app.post('/api/voices/:id/transcribe', async (req, res) => {
  const voice = queries.getVoiceById(req.params.id);
  if (!voice) return res.status(404).json({ error: 'Voice not found' });

  const asr = await transcribeSample(voice.audio_path, voice.language);
  if (!asr.text) {
    return res.status(422).json({ error: asr.warning || 'Transcription produced no text.' });
  }
  const updated = queries.updateVoice(voice.id, { refText: asr.text });
  writeVoiceManifest();
  invalidatePrompt(voice.id);
  syncVoicesToRemote({ force: true }).catch(() => {});
  res.json({ voice: toPublicVoice(updated), refText: updated.ref_text, warning: asr.warning || null });
});

// Render a short preview with this voice (Colab first, local fallback).
app.post('/api/voices/:id/preview', async (req, res) => {
  const voice = queries.getVoiceById(req.params.id);
  if (!voice) return res.status(404).json({ error: 'Voice not found' });

  const settings = queries.getSettings();
  const text =
    (req.body?.text || '').trim() || PREVIEW_TEXT[voice.language] || PREVIEW_TEXT.auto;
  const outputPath = path.join(path.dirname(voice.audio_path), 'preview.wav');

  try {
    const result = await synthesizeAudio(text, outputPath, {
      ...settings,
      tts_voice_override: voice.id
    });
    pipeline.log('info', `Voice preview rendered for "${voice.name}" (${result.engine || 'tts'}).`);
    const previewUrl = `/api/voices/${voice.id}/preview.wav?v=${Date.now()}`;
    res.json({
      audioUrl: previewUrl,
      previewUrl,
      duration: result.duration || 0,
      engine: result.engine || null
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/voices/:id/preview.wav', (req, res) => {
  const voice = queries.getVoiceById(req.params.id);
  if (!voice) return res.status(404).json({ error: 'Voice not found' });
  const previewPath = path.join(path.dirname(voice.audio_path), 'preview.wav');
  if (!fs.existsSync(previewPath)) return res.status(404).json({ error: 'No preview yet' });
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.resolve(previewPath));
});

// Set/clear the default voice for a language.
app.post('/api/voices/:id/default', (req, res) => {
  const language = req.body?.language;
  if (!['bn', 'en', 'ar'].includes(language)) {
    return res.status(400).json({ error: 'language must be bn, en or ar' });
  }
  const value = req.params.id === BUILTIN_VOICE ? BUILTIN_VOICE : req.params.id;
  if (value !== BUILTIN_VOICE && !queries.getVoiceById(value)) {
    return res.status(404).json({ error: 'Voice not found' });
  }
  queries.updateSetting(`tts_voice_${language}`, value);
  res.json({ success: true, settings: queries.getSettings() });
});

app.delete('/api/voices/:id', async (req, res) => {
  const voice = queries.getVoiceById(req.params.id);
  if (!voice) return res.status(404).json({ error: 'Voice not found' });

  // Never leave a per-language default pointing at a deleted voice.
  const settings = queries.getSettings();
  const updates = {};
  for (const lang of ['bn', 'en', 'ar']) {
    if (settings[`tts_voice_${lang}`] === voice.id) updates[`tts_voice_${lang}`] = BUILTIN_VOICE;
  }
  if (Object.keys(updates).length) queries.updateSettings(updates);

  queries.deleteVoice(voice.id);
  deleteVoiceFiles(voice.id);
  writeVoiceManifest();
  await remoteColab.removeVoice(voice.id);
  pipeline.log('info', `Voice "${voice.name}" deleted.`);
  res.json({ success: true, settings: queries.getSettings() });
});

// ==========================================
// API error boundary
// ==========================================
// Any error thrown inside an /api route (multer field mismatch, ffmpeg failure,
// sqlite error, ...) must come back as JSON. Express' default handler answers
// with an HTML error page, which clients then fail to parse as
// `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`.
app.use((err, req, res, next) => {
  if (!req.path.startsWith('/api')) return next(err);

  const status = err.status || err.statusCode || (err instanceof multer.MulterError ? 400 : 500);
  let message = err.message || 'Request failed';
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') message = 'That audio file is larger than the 40 MB limit.';
    else if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      message = `Unexpected upload field "${err.field}" — send the audio as "audio" or "sample".`;
    }
  }

  console.error(`[API] ${req.method} ${req.originalUrl} failed: ${err.stack || message}`);
  res.status(status).json({ error: message });
});

// Serve frontend build if present
const DIST_DIR = path.resolve(process.cwd(), 'dist');
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api') && !req.path.startsWith('/data')) {
      res.sendFile(path.join(DIST_DIR, 'index.html'));
    } else {
      next();
    }
  });
}

// Start Antigravity Proxy Sidecar if not running
const PROXY_SCRIPT = path.resolve(process.cwd(), 'server', 'proxy', 'antigravity-proxy.mjs');

function ensureAntigravityProxy() {
  fetch('http://127.0.0.1:8085/health')
    .then(res => res.json())
    .then(data => {
      console.log(`[Proxy] Antigravity Proxy already running for ${data.account || 'user'}`);
    })
    .catch(() => {
      console.log(`[Proxy] Launching Antigravity Local Proxy Sidecar on :8085...`);
      const child = spawn('node', [PROXY_SCRIPT], {
        detached: true,
        stdio: 'inherit'
      });
      child.unref();
    });
}
ensureAntigravityProxy();

// Never auto-resume after a restart: the in-memory engine starts empty, so any
// project left in running/paused must go back to idle until the user presses Start.
const interruptedProjects = queries.resetInterruptedProjects();
if (interruptedProjects > 0) {
  console.log(`[PDF Reader Server] Reset ${interruptedProjects} interrupted project(s) to idle.`);
}

// Never leave a GPU runtime burning compute units after the app exits.
async function shutdownRemoteWorker() {
  try {
    const status = remoteColab.status();
    if (status.state === 'running' || status.state === 'starting') {
      await Promise.race([
        remoteColab.stop('server shutdown'),
        new Promise((resolve) => setTimeout(resolve, 20000))
      ]);
    }
  } catch (error) {
    console.warn(`[Colab] Shutdown cleanup failed: ${error.message}`);
  }
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await shutdownRemoteWorker();
    process.exit(0);
  });
}

app.listen(PORT, () => {
  console.log(`[PDF Reader Server] Running on http://localhost:${PORT}`);
});
