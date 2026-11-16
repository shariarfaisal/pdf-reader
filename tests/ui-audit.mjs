import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';

/**
 * Headless UI audit: WCAG text-contrast, clipped text and sub-28px tap targets.
 *
 *   node tests/ui-audit.mjs [theme] [width] [height] [path] [osColorScheme]
 *   node tests/ui-audit.mjs light 1440 1000 '/settings?tab=models' dark
 *
 * Writes /tmp/audit-<theme>-<os>-<width>.json plus a full-page screenshot at
 * /tmp/ui-<theme>-<width>.png. Requires the app on http://localhost:4321.
 * `osColorScheme` emulates the OS preference independently of the app theme.
 */

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9227;
const PROFILE_DIR = '/tmp/chrome-audit-models2';

const fetchJson = (url) =>
  new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on('error', reject);
  });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const AUDIT_JS = `(() => {
  // Colours are resolved through a canvas so oklch()/oklab() tokens and
  // translucent layers are measured instead of skipped.
  const scratch = document.createElement('canvas');
  scratch.width = scratch.height = 1;
  const sctx = scratch.getContext('2d', { willReadFrequently: true });
  const paint = (layers) => {
    sctx.clearRect(0, 0, 1, 1);
    sctx.fillStyle = '#ffffff';
    sctx.fillRect(0, 0, 1, 1);
    for (const c of layers) {
      if (!c || c === 'none' || c === 'transparent') continue;
      sctx.fillStyle = c;
      sctx.fillRect(0, 0, 1, 1);
    }
    const d = sctx.getImageData(0, 0, 1, 1).data;
    return { r: d[0], g: d[1], b: d[2] };
  };
  /** Composite every ancestor background under the element, outermost first. */
  const effectiveBg = (el) => {
    const layers = [];
    for (let cur = el; cur; cur = cur.parentElement) {
      layers.push(getComputedStyle(cur).backgroundColor);
    }
    return paint(layers.reverse());
  };
  const lum = ({ r, g, b }) => {
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const seen = new Set();
  const issues = [];
  const clipped = [];
  const small = [];
  for (const el of document.querySelectorAll('body *')) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    const directText = Array.from(el.childNodes)
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent.trim())
      .join(' ')
      .trim();
    if (directText.length > 1 && !['SCRIPT','STYLE'].includes(el.tagName)) {
      const bg = effectiveBg(el);
      {
        const fgc = paint(['rgb(' + bg.r + ',' + bg.g + ',' + bg.b + ')', cs.color]);
        const L1 = lum(fgc);
        const L2 = lum(bg);
        const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
        const fontSize = parseFloat(cs.fontSize);
        const bold = parseInt(cs.fontWeight, 10) >= 600;
        const large = fontSize >= 24 || (fontSize >= 18.66 && bold);
        const min = large ? 3 : 4.5;
        if (ratio < min) {
          const key = el.className + '|' + directText.slice(0, 20);
          if (!seen.has(key)) {
            seen.add(key);
            issues.push({
              text: directText.slice(0, 60),
              ratio: Math.round(ratio * 100) / 100,
              color: cs.color,
              bg: 'rgb(' + [bg.r, bg.g, bg.b].map(Math.round).join(',') + ')',
              cls: (el.className || '').toString().slice(0, 110),
              tag: el.tagName
            });
          }
        }
      }
    }
    if (cs.overflow === 'hidden' && cs.textOverflow === 'ellipsis') continue;
    if (el.scrollWidth > el.clientWidth + 2 && cs.overflowX !== 'auto' && cs.overflowX !== 'scroll' && rect.width > 40) {
      const t = (el.textContent || '').trim().slice(0, 40);
      if (t) clipped.push({ text: t, cls: (el.className || '').toString().slice(0, 90), w: el.clientWidth, sw: el.scrollWidth });
    }
  }
  for (const el of document.querySelectorAll('button, a, input')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.height < 28 || r.width < 28) {
      small.push({
        label: (el.innerText || el.placeholder || el.getAttribute('aria-label') || '').trim().slice(0, 32),
        w: Math.round(r.width), h: Math.round(r.height),
        cls: (el.className || '').toString().slice(0, 80)
      });
    }
  }
  const tabRow = document.querySelector('.inline-flex.items-center.p-1');
  return {
    theme: document.documentElement.className,
    contrast: issues.slice(0, 40),
    clipped: clipped.slice(0, 20),
    small: small.slice(0, 25),
    tabRow: tabRow ? { cw: tabRow.clientWidth, sw: tabRow.scrollWidth } : null,
    docHeight: document.body.scrollHeight
  };
})()`;

async function run() {
  fs.rmSync(PROFILE_DIR, { recursive: true, force: true });
  const chrome = spawn(
    CHROME_PATH,
    [
      '--headless=new',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${PROFILE_DIR}`,
      '--window-size=1440,1000',
      '--no-first-run',
      '--no-default-browser-check'
    ],
    { stdio: 'ignore' }
  );

  let info = null;
  for (let i = 0; i < 40; i++) {
    await sleep(200);
    try {
      info = await fetchJson(`http://127.0.0.1:${PORT}/json/version`);
      if (info?.webSocketDebuggerUrl) break;
    } catch {}
  }
  if (!info) throw new Error('chrome not ready');
  const list = await fetchJson(`http://127.0.0.1:${PORT}/json/list`);
  const page = list.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));

  let id = 1;
  const cdp = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const myId = id++;
      const onMsg = (ev) => {
        const msg = JSON.parse(ev.data.toString());
        if (msg.id !== myId) return;
        ws.removeEventListener('message', onMsg);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      };
      ws.addEventListener('message', onMsg);
      ws.send(JSON.stringify({ id: myId, method, params }));
    });

  await cdp('Page.enable');
  await cdp('Runtime.enable');
  const theme = process.argv[2] || 'light';
  const media = process.argv[6] || theme;
  await cdp('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: media }]
  });
  const width = Number(process.argv[3] || 1440);
  const height = Number(process.argv[4] || 1000);
  const path = process.argv[5] || '/settings?tab=models';

  await cdp('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false
  });
  await cdp('Page.addScriptToEvaluateOnNewDocument', {
    source: `try { localStorage.setItem('pdf-reader-theme', '${theme}'); } catch (e) {}`
  });
  await cdp('Page.navigate', { url: `http://localhost:4321${path}` });
  await sleep(1500);
  for (let i = 0; i < 40; i++) {
    const st = await cdp('Runtime.evaluate', {
      expression: `(() => { const t = document.body.innerText; return { loading: t.includes('Scanning local model cache'), ready: /models installed/.test(t) }; })()`,
      returnByValue: true
    });
    if (st.result.value.ready && !st.result.value.loading) break;
    await sleep(300);
  }
  await cdp('Runtime.evaluate', {
    expression: `document.documentElement.className = '${theme}';`
  });
  await sleep(500);

  const res = await cdp('Runtime.evaluate', {
    expression: AUDIT_JS,
    returnByValue: true
  });
  fs.writeFileSync(`/tmp/audit-${theme}-${media}-${width}.json`, JSON.stringify(res.result.value, null, 2));
  console.log(JSON.stringify(res.result.value, null, 2).slice(0, 6000));

  const shot = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  const raw = `/tmp/ui-${theme}-${width}.png`;
  fs.writeFileSync(raw, Buffer.from(shot.data, 'base64'));
  console.log('shot', raw);

  ws.close();
  chrome.kill();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
