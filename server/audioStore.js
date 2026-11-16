import fs from 'node:fs';
import path from 'node:path';
import { queries } from './db.js';
import {
  driveStatus,
  uploadAudioFile,
  downloadFileTo,
  deleteDriveFile,
  getDriveFileSize
} from './drive.js';

// Narration audio lives in two places: a local file (fast, but large) and an
// optional Google Drive copy. Local files act as an LRU cache over the Drive copy.

/** Is Drive backup switched on and connected? */
export function driveBackupEnabled() {
  return queries.getSettings().drive_backup_audio === '1' && driveStatus().connected;
}

function touch(file) {
  const now = new Date();
  try {
    fs.utimesSync(file, now, now);
  } catch {
    // mtime is only the LRU hint; a failed touch just makes eviction slightly less precise
  }
}

/**
 * Upload a page's local audio to Drive and record the file id. Replaces the
 * previous Drive copy for that page so it does not pile up.
 */
export async function backupPageAudio(page, localPath) {
  const driveId = await uploadAudioFile(localPath, `${page.project_id}_${page.id}.wav`);
  if (page.audio_drive_id && page.audio_drive_id !== driveId) {
    await deleteDriveFile(page.audio_drive_id).catch((err) => {
      console.warn(`[Drive] Could not delete previous copy ${page.audio_drive_id}: ${err.message}`);
    });
  }
  queries.setPageAudioDriveId(page.project_id, page.page_number, driveId);
  return driveId;
}

/**
 * Return a local path for the page's audio, downloading it from Drive when the
 * local file was evicted. Returns null when the page has no audio anywhere.
 */
export async function ensureLocalAudio(page) {
  if (!page?.audio_path) return null;
  if (fs.existsSync(page.audio_path)) {
    touch(page.audio_path);
    return page.audio_path;
  }
  if (!page.audio_drive_id) return null;
  await downloadOnce(page.audio_drive_id, page.audio_path);
  touch(page.audio_path);
  enforceCacheBudget(page.audio_path);
  return page.audio_path;
}

// Player prefetch and playback can ask for the same page at once; share one download.
const inFlightDownloads = new Map();

function downloadOnce(driveId, localPath) {
  if (!inFlightDownloads.has(localPath)) {
    const job = downloadFileTo(driveId, localPath).finally(() => inFlightDownloads.delete(localPath));
    inFlightDownloads.set(localPath, job);
  }
  return inFlightDownloads.get(localPath);
}

/**
 * Keep local audio under the configured cap. Evicts least recently used files,
 * only those with a Drive copy, so no audio is ever lost. `keepPath` is never evicted.
 */
export function enforceCacheBudget(keepPath = null) {
  const capMb = Number(queries.getSettings().drive_cache_mb) || 0;
  if (capMb <= 0) return { evicted: 0 };

  const cap = capMb * 1024 * 1024;
  const entries = [];
  let total = 0;
  for (const row of queries.listPagesWithAudioPath()) {
    if (!fs.existsSync(row.audio_path)) continue;
    const stat = fs.statSync(row.audio_path);
    total += stat.size;
    entries.push({ row, size: stat.size, mtime: stat.mtimeMs });
  }

  let evicted = 0;
  entries.sort((a, b) => a.mtime - b.mtime);
  for (const entry of entries) {
    if (total <= cap) break;
    if (!entry.row.audio_drive_id || entry.row.audio_path === keepPath) continue;
    try {
      fs.unlinkSync(entry.row.audio_path);
      total -= entry.size;
      evicted += 1;
    } catch (err) {
      console.warn(`[Drive] Could not evict ${entry.row.audio_path}: ${err.message}`);
    }
  }
  return { evicted };
}

/** Delete Drive copies for a set of page rows (page or project removal). */
export async function deleteRemoteAudio(driveIds) {
  const failures = [];
  for (const driveId of driveIds.filter(Boolean)) {
    try {
      await deleteDriveFile(driveId);
    } catch (err) {
      failures.push(`${driveId}: ${err.message}`);
    }
  }
  return failures;
}

// ---------------------------------------------------------------------------
// Sync status, background sync jobs, and verified local release
// ---------------------------------------------------------------------------

const syncJobs = new Map(); // projectId -> { state, uploaded, total, failed, error, startedAt, finishedAt }

/** Free local audio after upload? Only when Drive is connected and the user opted in. */
export function freeAfterUploadEnabled() {
  return queries.getSettings().drive_free_after_upload === '1';
}

/**
 * Delete a page's local audio only when its Drive copy exists with the same byte size.
 * Returns the freed byte count (0 when the copy could not be verified).
 */
export async function releaseLocalIfVerified(page, localPath) {
  if (!page.audio_drive_id || !fs.existsSync(localPath)) return 0;
  const remoteSize = await getDriveFileSize(page.audio_drive_id);
  const localSize = fs.statSync(localPath).size;
  if (remoteSize === null || remoteSize !== localSize) return 0;
  fs.unlinkSync(localPath);
  return localSize;
}

/** Per-project counts for the sync UI. Works from the database and local stat calls only. */
export function projectSyncStatus(projectId) {
  const pages = queries.getPagesByProjectId(projectId).filter((page) => page.audio_path);
  const status = { total: pages.length, backedUp: 0, localFiles: 0, localBytes: 0, remoteOnly: 0, pendingUpload: 0, lost: 0 };
  for (const page of pages) {
    const hasLocal = fs.existsSync(page.audio_path);
    const hasRemote = Boolean(page.audio_drive_id);
    if (hasRemote) status.backedUp += 1;
    if (hasLocal) {
      status.localFiles += 1;
      status.localBytes += fs.statSync(page.audio_path).size;
      if (!hasRemote) status.pendingUpload += 1;
    } else if (hasRemote) {
      status.remoteOnly += 1;
    } else {
      status.lost += 1;
    }
  }
  return { ...status, job: syncJobs.get(projectId) || null };
}

/** Start uploading every local page that has no Drive copy yet. Runs in the background. */
// Projects sync one after another. Parallel uploads would contend for bandwidth and memory.
let syncQueue = Promise.resolve();

export function startProjectSync(projectId) {
  const existing = syncJobs.get(projectId);
  if (existing && (existing.state === 'running' || existing.state === 'queued')) return existing;

  const pending = queries
    .getPagesByProjectId(projectId)
    .filter((page) => page.audio_path && fs.existsSync(page.audio_path) && !page.audio_drive_id);
  const job = { state: 'queued', uploaded: 0, freed: 0, total: pending.length, failed: 0, error: null, startedAt: Date.now(), finishedAt: null };
  syncJobs.set(projectId, job);

  syncQueue = syncQueue.then(() => runSyncJob(projectId, pending, job));
  return job;
}

async function runSyncJob(projectId, pending, job) {
  job.state = 'running';
  job.startedAt = Date.now();
  const freeAfter = freeAfterUploadEnabled();
  for (const page of pending) {
    try {
      const current = queries.getPage(projectId, page.page_number);
      await backupPageAudio({ ...current, project_id: projectId }, current.audio_path);
      job.uploaded += 1;
      if (freeAfter) {
        const fresh = queries.getPage(projectId, page.page_number);
        job.freed += await releaseLocalIfVerified(fresh, fresh.audio_path);
      }
    } catch (err) {
      job.failed += 1;
      job.error = err.message;
      // Auth problems will fail every remaining page the same way; stop early.
      if (/not connected|expired|revoked/i.test(err.message)) break;
    }
  }
  job.state = job.failed ? 'error' : 'done';
  job.finishedAt = Date.now();
}

/**
 * Remove local audio for pages whose Drive copy checks out. `dryRun` reports what
 * would be removed without deleting anything. Pages whose Drive copy vanished get
 * their Drive pointer cleared, so they go back to pending upload instead of being lost.
 */
export async function freeVerifiedLocal(projectId, { dryRun = false } = {}) {
  const result = { checked: 0, verified: 0, freedBytes: 0, mismatched: 0, missingRemote: 0 };
  for (const page of queries.getPagesByProjectId(projectId)) {
    if (!page.audio_path || !page.audio_drive_id || !fs.existsSync(page.audio_path)) continue;
    result.checked += 1;
    const remoteSize = await getDriveFileSize(page.audio_drive_id);
    const localSize = fs.statSync(page.audio_path).size;
    if (remoteSize === null) {
      result.missingRemote += 1;
      if (!dryRun) queries.setPageAudioDriveId(projectId, page.page_number, null);
      continue;
    }
    if (remoteSize !== localSize) {
      result.mismatched += 1;
      continue;
    }
    result.verified += 1;
    result.freedBytes += localSize;
    if (!dryRun) fs.unlinkSync(page.audio_path);
  }
  if (!dryRun) removeEmptyAudioDir(projectId);
  return result;
}

function removeEmptyAudioDir(projectId) {
  const dir = path.resolve(process.cwd(), 'data', 'projects', projectId, 'audio');
  try {
    if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
  } catch (err) {
    console.warn(`[Drive] Could not remove empty audio folder ${dir}: ${err.message}`);
  }
}
