import crypto from 'node:crypto';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

// Resolved from this module, not the cwd, so the page is found wherever the server starts.
export const LISTEN_PAGE = fileURLToPath(new URL('./share/listen.html', import.meta.url));

// Listen-link helpers. The share listener is a second port that only serves the
// read-only routes below, so the full owner API is never exposed to the LAN.
const SHARE_ROUTES = [
  /^\/listen\/[A-Za-z0-9_-]+$/,
  /^\/api\/shared\/[A-Za-z0-9_-]+$/,
  /^\/api\/shared\/[A-Za-z0-9_-]+\/pages\/\d+\/audio$/,
  /^\/api\/shared\/[A-Za-z0-9_-]+\/audio-full$/
];

export function generateShareToken() {
  return crypto.randomBytes(24).toString('base64url');
}

export function shareOnlyGate(req, res, next) {
  if (req.method === 'GET' && SHARE_ROUTES.some((route) => route.test(req.path))) return next();
  res.status(404).json({ error: 'Not found' });
}

/** IPv4 addresses other devices on the LAN (e.g. an iPhone on the same Wi-Fi) can reach. */
export function lanAddresses() {
  const addresses = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' && !entry.internal) addresses.push(entry.address);
    }
  }
  return addresses;
}

/** Page rows that have narration audio available (local file, Drive copy, or legacy path). */
export function pagesWithAudio(pages, fileExists) {
  return pages.filter(
    (page) => page.audio_path || page.audio_drive_id || fileExists(page.page_number)
  );
}
