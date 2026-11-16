import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline as streamPipeline } from 'node:stream/promises';

// Google Drive backup for synthesized narration audio.
// Uses the user's own OAuth client (GOOGLE_DRIVE_CLIENT_ID / _SECRET env vars) and
// the `drive.file` scope, so the app can only see files it created itself.

const DATA_DIR = path.resolve(process.cwd(), 'data');
const TOKEN_DIR = path.join(DATA_DIR, 'drive');
const TOKEN_PATH = path.join(TOKEN_DIR, 'token.json');
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const FOLDER_NAME = 'PDF Reader Audio';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const API_URL = 'https://www.googleapis.com/drive/v3';
const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3';
const STATE_TTL_MS = 10 * 60 * 1000;

const pendingStates = new Map(); // state -> expiresAt

export function driveConfigured() {
  return Boolean(process.env.GOOGLE_DRIVE_CLIENT_ID && process.env.GOOGLE_DRIVE_CLIENT_SECRET);
}

function clientConfig() {
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Set GOOGLE_DRIVE_CLIENT_ID and GOOGLE_DRIVE_CLIENT_SECRET in .env to enable Drive storage.');
  }
  return { clientId, clientSecret };
}

function redirectUri(port) {
  return `http://localhost:${port}/api/drive/auth/callback`;
}

function readToken() {
  if (!fs.existsSync(TOKEN_PATH)) return null;
  return JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
}

function writeToken(token) {
  fs.mkdirSync(TOKEN_DIR, { recursive: true });
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(token, null, 2), { mode: 0o600 });
}

function clearToken() {
  if (fs.existsSync(TOKEN_PATH)) fs.unlinkSync(TOKEN_PATH);
}

export function driveStatus() {
  const token = readToken();
  return {
    configured: driveConfigured(),
    connected: Boolean(token?.refresh_token)
  };
}

/** Build the Google consent URL. The state value guards the loopback callback. */
export function startDriveAuth(port) {
  const { clientId } = clientConfig();
  const state = crypto.randomBytes(16).toString('hex');
  pendingStates.set(state, Date.now() + STATE_TTL_MS);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(port),
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    state
  });
  return { authUrl: `${AUTH_URL}?${params.toString()}` };
}

async function postToken(form) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(`Google token request failed (${res.status}): ${data.error_description || data.error || 'unknown error'}`);
    error.code = data.error;
    throw error;
  }
  return data;
}

/** Exchange the authorization code from the callback for a refresh token. */
export async function finishDriveAuth({ code, state, port }) {
  const expiresAt = pendingStates.get(state);
  pendingStates.delete(state);
  if (!expiresAt || expiresAt < Date.now()) {
    throw new Error('Drive sign-in expired or was not started from this app. Try connecting again.');
  }
  const { clientId, clientSecret } = clientConfig();
  const data = await postToken({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri(port),
    grant_type: 'authorization_code'
  });
  if (!data.refresh_token) {
    throw new Error('Google did not return a refresh token. Remove the app at myaccount.google.com/permissions and connect again.');
  }
  writeToken({
    refresh_token: data.refresh_token,
    access_token: data.access_token,
    expires_at: Date.now() + (data.expires_in || 3600) * 1000,
    folder_id: null
  });
}

async function accessToken() {
  const token = readToken();
  if (!token?.refresh_token) throw new Error('Google Drive is not connected.');
  if (token.access_token && token.expires_at - 60_000 > Date.now()) return token.access_token;

  const { clientId, clientSecret } = clientConfig();
  let data;
  try {
    data = await postToken({
      refresh_token: token.refresh_token,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token'
    });
  } catch (err) {
    if (err.code === 'invalid_grant') {
      clearToken();
      throw new Error('Google Drive authorization expired or was revoked. Connect Drive again.');
    }
    throw err;
  }
  token.access_token = data.access_token;
  token.expires_at = Date.now() + (data.expires_in || 3600) * 1000;
  writeToken(token);
  return token.access_token;
}

async function driveFetch(url, options = {}) {
  const authToken = await accessToken();
  const res = await fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${authToken}` }
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const error = new Error(`Drive request failed (${res.status}): ${text.slice(0, 200)}`);
    error.status = res.status;
    throw error;
  }
  return res;
}

async function ensureFolder() {
  const token = readToken();
  if (token?.folder_id) return token.folder_id;
  const res = await driveFetch(`${API_URL}/files?fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' })
  });
  const { id } = await res.json();
  const next = readToken();
  next.folder_id = id;
  writeToken(next);
  return id;
}

/** Upload a local audio file to the app folder. Returns the Drive file id. */
export async function uploadAudioFile(localPath, name) {
  const folderId = await ensureFolder();
  const content = fs.readFileSync(localPath);
  const boundary = `pdfreader${crypto.randomUUID()}`;
  const metadata = JSON.stringify({ name, parents: [folderId], mimeType: 'audio/wav' });
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
        `--${boundary}\r\nContent-Type: audio/wav\r\n\r\n`
    ),
    content,
    Buffer.from(`\r\n--${boundary}--`)
  ]);
  const res = await driveFetch(`${UPLOAD_URL}/files?uploadType=multipart&fields=id`, {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/related; boundary=${boundary}`,
      'Content-Length': String(body.length)
    },
    body
  });
  const { id } = await res.json();
  return id;
}

/** Stream a Drive file to a local path (written to a temp file, then renamed). */
export async function downloadFileTo(driveId, destPath) {
  const res = await driveFetch(`${API_URL}/files/${encodeURIComponent(driveId)}?alt=media`);
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  const tmpPath = `${destPath}.part-${crypto.randomUUID()}`;
  try {
    await streamPipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmpPath));
    fs.renameSync(tmpPath, destPath);
  } catch (err) {
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    throw err;
  }
}

/** Delete a Drive file. A file that is already gone counts as deleted. */
export async function deleteDriveFile(driveId) {
  try {
    await driveFetch(`${API_URL}/files/${encodeURIComponent(driveId)}`, { method: 'DELETE' });
  } catch (err) {
    if (err.status !== 404) throw err;
  }
}

/** Revoke the grant at Google (best effort) and forget the local token. */
export async function disconnectDrive() {
  const token = readToken();
  if (token?.refresh_token) {
    try {
      await fetch(`${REVOKE_URL}?token=${encodeURIComponent(token.refresh_token)}`, { method: 'POST' });
    } catch (err) {
      console.warn(`[Drive] Could not revoke grant at Google (remove it at myaccount.google.com/permissions): ${err.message}`);
    }
  }
  clearToken();
}

/** Size in bytes of a Drive file, or null when the file no longer exists (or is trashed). */
export async function getDriveFileSize(driveId) {
  try {
    const res = await driveFetch(`${API_URL}/files/${encodeURIComponent(driveId)}?fields=size,trashed`);
    const meta = await res.json();
    if (meta.trashed) return null;
    return Number(meta.size);
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}
