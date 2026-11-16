import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9225;
const PROFILE_DIR = '/tmp/chrome-audit-profile';

async function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

function sendCdp(ws, method, params = {}, id = 1) {
  return new Promise((resolve, reject) => {
    const msg = JSON.stringify({ id, method, params });
    const handleMsg = (data) => {
      try {
        const parsed = JSON.parse(data.toString());
        if (parsed.id === id) {
          ws.off('message', handleMsg);
          if (parsed.error) reject(new Error(parsed.error.message));
          else resolve(parsed.result);
        }
      } catch (e) {
        reject(e);
      }
    };
    ws.on('message', handleMsg);
    ws.send(msg);
  });
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function run() {
  if (fs.existsSync(PROFILE_DIR)) {
    fs.rmSync(PROFILE_DIR, { recursive: true, force: true });
  }

  const chrome = spawn(
    CHROME_PATH,
    [
      '--headless=new',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${PROFILE_DIR}`,
      '--window-size=1280,850',
      '--no-first-run',
      '--no-default-browser-check'
    ],
    { stdio: 'ignore' }
  );

  let versionInfo = null;
  for (let i = 0; i < 30; i++) {
    await sleep(200);
    try {
      versionInfo = await fetchJson(`http://127.0.0.1:${PORT}/json/version`);
      if (versionInfo?.webSocketDebuggerUrl) break;
    } catch {}
  }

  if (!versionInfo) {
    chrome.kill();
    throw new Error('Chrome remote debugging did not become ready');
  }

  const list = await fetchJson(`http://127.0.0.1:${PORT}/json/list`);
  const wsUrl = list?.[0]?.webSocketDebuggerUrl;

  const { WebSocket } = await import('ws').catch(async () => {
    return { WebSocket: globalThis.WebSocket };
  });

  const ws = new WebSocket(wsUrl);
  await new Promise((resolve) => ws.on('open', resolve));

  let reqId = 1;
  const cdp = (method, params) => sendCdp(ws, method, params, reqId++);

  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await cdp('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 850,
    deviceScaleFactor: 1,
    mobile: false
  });

  const capture = async (name, url, themeMode = 'light') => {
    console.log(`Capturing ${name} (${themeMode}) at ${url}...`);
    await cdp('Page.navigate', { url });
    await sleep(1200);

    // Apply theme
    await cdp('Runtime.evaluate', {
      expression: `
        localStorage.setItem('pdf-reader-theme', '${themeMode}');
        document.documentElement.className = '${themeMode}';
        document.documentElement.setAttribute('data-theme', '${themeMode}');
        window.dispatchEvent(new CustomEvent('pdf-reader-theme-changed', {
          detail: { preference: '${themeMode}', resolved: '${themeMode}' }
        }));
      `
    });
    await sleep(600);

    const shot = await cdp('Page.captureScreenshot', { format: 'png' });
    const buf = Buffer.from(shot.data, 'base64');
    fs.writeFileSync(`/tmp/${name}-${themeMode}.png`, buf);
    console.log(`Saved /tmp/${name}-${themeMode}.png (${buf.length} bytes)`);
  };

  try {
    // 1. Library
    await capture('library', 'http://localhost:4321/', 'light');
    await capture('library', 'http://localhost:4321/', 'dark');

    // 2. Settings
    await capture('settings', 'http://localhost:4321/settings', 'light');
    await capture('settings', 'http://localhost:4321/settings', 'dark');

    // 3. Models
    await capture('models', 'http://localhost:4321/models', 'light');
    await capture('models', 'http://localhost:4321/models', 'dark');

    // 4. Reader Workspace
    const projects = await fetchJson('http://localhost:4321/api/projects');
    const firstProj = projects?.projects?.[0];
    if (firstProj) {
      await capture('reader', `http://localhost:4321/projects/${firstProj.id}/pages/1`, 'light');
      await capture('reader', `http://localhost:4321/projects/${firstProj.id}/pages/1`, 'dark');
    }

    console.log('Visual audit capture complete!');
  } finally {
    ws.close();
    chrome.kill();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
