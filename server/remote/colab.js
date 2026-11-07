import { spawn, execFile, execSync } from 'node:child_process';
import { promisify } from 'node:util';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { queries } from '../db.js';

const execFileAsync = promisify(execFile);

const REMOTE_DIR = '/content/.pdfreader';
const REMOTE_WORKER = '/content/pdfreader_worker.py';
const REMOTE_REF = '/content/pdfreader_ref.wav';
const REMOTE_BOOTSTRAP = '/content/pdfreader_bootstrap.sh';
const REMOTE_MARKER = `${REMOTE_DIR}/ready`;
const REMOTE_WORKER_LOG = '/content/pdfreader_worker.log';
const REMOTE_BOOTSTRAP_LOG = '/content/pdfreader_bootstrap.log';
const WORKER_PORT = 8790;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_WORKER = path.join(__dirname, 'colab_worker.py');

/**
 * Remote TTS on a Google Colab GPU.
 *
 * Lifecycle is deliberately "long-lived, warmed once":
 *   allocate session (if needed) → bootstrap deps + model (once per session)
 *   → keep the worker warm → open one `ssh -L` tunnel → serve /tts per page.
 * The session is only torn down when the user stops it or the configured idle
 * timer fires, so a 300-page book pays the cold start exactly once.
 */
export class ColabRemoteTTS {
  constructor() {
    this.state = 'stopped'; // stopped | starting | running | stopping | error
    this.session = null;
    this.gpu = null;
    this.localPort = null;
    this.tunnelProc = null;
    this.lastError = null;
    this.startPromise = null;
    this.queue = Promise.resolve();
    this.idleTimer = null;
    this.heartbeat = null;
    this.lastSynthAt = null;
    this.lastStats = null;
    this.modelInfo = null;
    this.cooldownUntil = null;
    // Voice library sync: ids already pushed to this worker session. Cleared
    // whenever the tunnel/worker is (re)created.
    this.uploadedVoices = new Set();
    this.voiceProvider = null;
    this.pendingAuth = null; // { authUrl, state, codeVerifier, startedAt }
    this.cachedAccount = null; // { email, expiresIn, usage, checkedAt }
    this.installState = { installing: false, logs: [], error: null, completedAt: null };
    this.logger = (level, message) => console.log(`[Colab] [${level}] ${message}`);
    this.onStatusChange = () => {};
  }

  log(level, message) {
    try {
      this.logger(level, message);
    } catch {
      // logging must never break synthesis
    }
  }

  setLogger(fn) {
    if (typeof fn === 'function') this.logger = fn;
  }

  setStatusListener(fn) {
    if (typeof fn === 'function') this.onStatusChange = fn;
  }

  status() {
    return {
      state: this.state,
      session: this.session,
      gpu: this.gpu,
      localPort: this.localPort,
      workerPort: WORKER_PORT,
      lastError: this.lastError,
      lastSynthAt: this.lastSynthAt,
      lastStats: this.lastStats,
      modelInfo: this.modelInfo,
      idleStopMin: this.settingsSnapshot().idleStopMin,
      idleRemainingMin: (() => {
        const min = this.settingsSnapshot().idleStopMin;
        if (!min || min <= 0 || !this.lastSynthAt || this.state !== 'running') return null;
        const expiresAt = this.lastSynthAt + min * 60000;
        return Math.max(0, Math.round((expiresAt - Date.now()) / 60000));
      })()
    };
  }

  setState(state, extra = {}) {
    this.state = state;
    Object.assign(this, extra);
    try {
      this.onStatusChange(this.status());
    } catch {
      // ignore listener failures
    }
  }

  // -------------------------
  // Settings & helpers
  // -------------------------

  settingsSnapshot() {
    const settings = queries.getSettings();
    return {
      backend: settings.tts_backend || 'auto',
      gpu: (settings.colab_gpu || 'T4').trim(),
      session: (settings.colab_session || 'pdfreader').trim().replace(/[^a-zA-Z0-9_-]/g, '-'),
      idleStopMin: Math.max(20, parseInt(settings.colab_idle_stop_min || '30', 10)),
      colabBin: (settings.colab_bin || '').trim(),
      sshKey: (settings.colab_ssh_key || '').trim()
    };
  }

  resolveColabBin(explicit) {
    if (explicit) {
      const expanded = explicit.startsWith('~/')
        ? path.join(os.homedir(), explicit.slice(2))
        : explicit;
      return expanded;
    }
    const candidates = [
      path.join(os.homedir(), '.local', 'bin', 'colab'),
      path.resolve(process.cwd(), 'data', 'colab-cli-venv', 'bin', 'colab'),
      '/opt/homebrew/bin/colab',
      '/usr/local/bin/colab',
      '/usr/bin/colab'
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate;
    }
    return 'colab';
  }

  /** Always the absolute path to the colab CLI (ProxyCommand cannot use PATH). */
  colabBinary() {
    return this.resolveColabBin(this.settingsSnapshot().colabBin);
  }

  /** Check whether the resolved colab binary actually exists on disk. */
  isColabInstalled() {
    const bin = this.colabBinary();
    if (path.isAbsolute(bin)) return fs.existsSync(bin);
    try {
      const out = execSync(`command -v ${bin}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      return Boolean(out && fs.existsSync(out));
    } catch {
      return false;
    }
  }

  /** Resolve the Python interpreter backing `colab-cli` (from its shebang or fallback). */
  getColabPythonBin() {
    const bin = this.colabBinary();
    try {
      if (fs.existsSync(bin)) {
        const firstLine = fs.readFileSync(bin, 'utf8').split('\n')[0] || '';
        if (firstLine.startsWith('#!')) {
          const shebang = firstLine.slice(2).trim().split(/\s+/)[0];
          if (shebang && fs.existsSync(shebang)) return shebang;
        }
      }
    } catch {}
    const uvToolPy = path.join(os.homedir(), '.local', 'share', 'uv', 'tools', 'google-colab-cli', 'bin', 'python');
    if (fs.existsSync(uvToolPy)) return uvToolPy;
    const localVenvPy = path.resolve(process.cwd(), 'data', 'colab-cli-venv', 'bin', 'python');
    if (fs.existsSync(localVenvPy)) return localVenvPy;
    return 'python3';
  }

  tokenConfigPath() {
    return path.join(os.homedir(), '.config', 'colab-cli', 'token.json');
  }

  hasStoredToken() {
    const tokenPath = this.tokenConfigPath();
    if (!fs.existsSync(tokenPath)) return false;
    try {
      const data = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
      return Boolean(data && (data.refresh_token || data.token));
    } catch {
      return false;
    }
  }

  /** Ensure an ed25519 SSH key exists for the Colab SSH tunnel. */
  async ensureSshKey() {
    const existing = this.resolveSshKey(this.settingsSnapshot().sshKey);
    if (existing && fs.existsSync(existing)) {
      return { ready: true, path: existing, created: false };
    }
    const sshDir = path.join(os.homedir(), '.ssh');
    const keyPath = path.join(sshDir, 'id_ed25519');
    fs.mkdirSync(sshDir, { recursive: true, mode: 0o700 });
    await execFileAsync('ssh-keygen', ['-t', 'ed25519', '-N', '', '-f', keyPath, '-C', 'pdf-reader-colab'], {
      timeout: 15000
    });
    try {
      fs.chmodSync(keyPath, 0o600);
    } catch {}
    this.log('info', `Generated SSH key for Colab tunnel at ${keyPath}`);
    return { ready: true, path: keyPath, created: true };
  }

  /** Query `colab whoami` and optionally `colab usage` to verify auth & get account details. */
  async refreshAccountInfo({ includeUsage = false } = {}) {
    if (!this.isColabInstalled() || !this.hasStoredToken()) {
      this.cachedAccount = null;
      return null;
    }
    const colabBin = this.colabBinary();
    let email = this.cachedAccount?.email || null;
    let expiresIn = this.cachedAccount?.expiresIn || null;
    let usage = this.cachedAccount?.usage || null;

    try {
      const out = await this.run(colabBin, ['whoami'], { timeout: 25000 });
      const emailMatch = out.match(/Email:\s*([^\s\n]+)/i);
      const expMatch = out.match(/Expires in:\s*([^\n]+)/i);
      if (emailMatch) email = emailMatch[1].trim();
      if (expMatch) expiresIn = expMatch[1].trim();
    } catch (err) {
      this.log('warn', `Colab whoami check failed: ${err.message}`);
      return null;
    }

    if (includeUsage) {
      try {
        const usageOut = await this.run(colabBin, ['usage'], { timeout: 25000 });
        const balMatch = usageOut.match(/Current balance:\s*([0-9.]+)/i);
        const rateMatch = usageOut.match(/Usage rate:\s*([0-9.]+)/i);
        const assignMatch = usageOut.match(/Active assignments:\s*(\d+)/i);
        usage = {
          balance: balMatch ? parseFloat(balMatch[1]) : null,
          ratePerHour: rateMatch ? parseFloat(rateMatch[1]) : null,
          activeAssignments: assignMatch ? parseInt(assignMatch[1], 10) : 0,
          raw: usageOut.trim()
        };
      } catch {}
    }

    this.cachedAccount = {
      email,
      expiresIn,
      usage,
      checkedAt: Date.now()
    };
    return this.cachedAccount;
  }

  /** Inspect CLI version without triggering update network checks if possible. */
  async getCliVersion() {
    if (!this.isColabInstalled()) return null;
    const pyBin = this.getColabPythonBin();
    try {
      const { stdout } = await execFileAsync(
        pyBin,
        ['-c', 'from importlib.metadata import version; print(version("google-colab-cli"))'],
        { timeout: 8000 }
      );
      return stdout.trim() || 'installed';
    } catch {
      return 'installed';
    }
  }

  /**
   * Full plug-and-play setup status for the Settings / Onboarding UI.
   */
  async getSetupStatus({ verifyAccount = false, includeUsage = false } = {}) {
    const installed = this.isColabInstalled();
    const binaryPath = installed ? this.colabBinary() : null;
    const version = installed ? await this.getCliVersion() : null;
    const sshKeyPath = this.resolveSshKey(this.settingsSnapshot().sshKey);
    const hasToken = this.hasStoredToken();

    if (installed && hasToken && (verifyAccount || includeUsage || !this.cachedAccount)) {
      await this.refreshAccountInfo({ includeUsage });
    } else if (!hasToken) {
      this.cachedAccount = null;
    }

    return {
      cli: {
        installed,
        binaryPath,
        version,
        installing: this.installState.installing,
        installLogs: this.installState.logs.slice(-40),
        installError: this.installState.error
      },
      sshKey: {
        ready: Boolean(sshKeyPath && fs.existsSync(sshKeyPath)),
        path: sshKeyPath || null
      },
      auth: {
        authenticated: Boolean(hasToken && (this.cachedAccount?.email || hasToken)),
        hasTokenFile: hasToken,
        tokenPath: this.tokenConfigPath(),
        email: this.cachedAccount?.email || null,
        expiresIn: this.cachedAccount?.expiresIn || null,
        usage: this.cachedAccount?.usage || null,
        pendingFlow: this.pendingAuth
          ? {
              authUrl: this.pendingAuth.authUrl,
              startedAt: this.pendingAuth.startedAt
            }
          : null
      },
      worker: this.status()
    };
  }

  /**
   * Install or update `google-colab-cli` + ensure SSH key is ready.
   */
  async installCli() {
    if (this.installState.installing) {
      return this.getSetupStatus();
    }

    this.installState = {
      installing: true,
      logs: ['Starting Google Colab CLI installation…'],
      error: null,
      completedAt: null
    };

    const appendLog = (line) => {
      const clean = String(line || '').trim();
      if (!clean) return;
      this.installState.logs.push(clean);
      if (this.installState.logs.length > 100) {
        this.installState.logs = this.installState.logs.slice(-100);
      }
      this.log('info', clean);
    };

    try {
      // 1. Ensure SSH key exists for tunnel
      const sshRes = await this.ensureSshKey();
      if (sshRes.created) {
        appendLog(`Generated SSH key at ${sshRes.path}`);
      } else {
        appendLog(`SSH key verified at ${sshRes.path}`);
      }

      // 2. Locate best package installer: uv -> pipx -> local venv
      const uvCandidates = [
        path.join(os.homedir(), '.local', 'bin', 'uv'),
        '/opt/homebrew/bin/uv',
        '/usr/local/bin/uv'
      ];
      const uvBin = uvCandidates.find((p) => fs.existsSync(p));

      const pipxCandidates = [
        '/opt/homebrew/bin/pipx',
        path.join(os.homedir(), '.local', 'bin', 'pipx'),
        '/usr/local/bin/pipx'
      ];
      const pipxBin = pipxCandidates.find((p) => fs.existsSync(p));

      const runInstallCmd = (cmd, args) =>
        new Promise((resolve, reject) => {
          appendLog(`Running: ${cmd} ${args.join(' ')}`);
          const child = spawn(cmd, args, {
            stdio: ['ignore', 'pipe', 'pipe'],
            env: {
              ...process.env,
              PATH: `${path.join(os.homedir(), '.local', 'bin')}:/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || ''}`
            }
          });
          child.stdout.on('data', (d) => d.toString().split('\n').forEach(appendLog));
          child.stderr.on('data', (d) => d.toString().split('\n').forEach(appendLog));
          child.on('error', reject);
          child.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`${path.basename(cmd)} exited with code ${code}`));
          });
        });

      if (uvBin) {
        await runInstallCmd(uvBin, ['tool', 'install', '--upgrade', 'google-colab-cli']);
      } else if (pipxBin) {
        await runInstallCmd(pipxBin, ['install', '--force', 'google-colab-cli']);
      } else {
        const venvDir = path.resolve(process.cwd(), 'data', 'colab-cli-venv');
        appendLog(`Creating dedicated virtual environment at ${venvDir}…`);
        await runInstallCmd('python3', ['-m', 'venv', venvDir]);
        const pipBin = path.join(venvDir, 'bin', 'pip');
        await runInstallCmd(pipBin, ['install', '--upgrade', 'pip', 'google-colab-cli']);
        const localBinDir = path.join(os.homedir(), '.local', 'bin');
        fs.mkdirSync(localBinDir, { recursive: true });
        const targetLink = path.join(localBinDir, 'colab');
        const venvColab = path.join(venvDir, 'bin', 'colab');
        try {
          if (fs.existsSync(targetLink)) fs.unlinkSync(targetLink);
          fs.symlinkSync(venvColab, targetLink);
        } catch {
          queries.updateSetting('colab_bin', venvColab);
        }
      }

      // Silence daily update banner so non-interactive calls stay clean
      const colabConfigDir = path.join(os.homedir(), '.config', 'colab-cli');
      const settingsFile = path.join(colabConfigDir, 'settings.json');
      try {
        fs.mkdirSync(colabConfigDir, { recursive: true });
        const existing = fs.existsSync(settingsFile)
          ? JSON.parse(fs.readFileSync(settingsFile, 'utf8'))
          : {};
        existing.enable_update_check = false;
        fs.writeFileSync(settingsFile, JSON.stringify(existing, null, 2));
      } catch {}

      appendLog('Google Colab CLI installed and ready.');
      this.installState.installing = false;
      this.installState.completedAt = Date.now();
      return await this.getSetupStatus({ verifyAccount: true });
    } catch (error) {
      appendLog(`Installation failed: ${error.message}`);
      this.installState.installing = false;
      this.installState.error = error.message;
      throw error;
    }
  }

  /**
   * Generate a Google OAuth2 authorization URL for `colab-cli` (remote copy-paste flow).
   * Returns `{ authUrl, startedAt, instructions }` so the user can open the URL in any
   * browser, sign in, and paste back the authorization code.
   */
  async startAuthFlow() {
    if (!this.isColabInstalled()) {
      throw new Error('Google Colab CLI is not installed yet. Click "Install Colab CLI" first.');
    }

    const pyBin = this.getColabPythonBin();
    const snippet = [
      'import json, os',
      'from importlib import resources',
      'from google_auth_oauthlib.flow import InstalledAppFlow',
      'from colab_cli.auth import PUBLIC_SCOPES, REMOTE_REDIRECT_URI',
      'cfg_path = os.path.expanduser("~/.colab-cli-oauth-config.json")',
      'if os.path.exists(cfg_path):',
      '    cfg = json.load(open(cfg_path))',
      'else:',
      '    cfg = json.loads(resources.files("colab_cli").joinpath("oauth_config.json").read_text())',
      'flow = InstalledAppFlow.from_client_config(cfg, PUBLIC_SCOPES)',
      'flow.redirect_uri = REMOTE_REDIRECT_URI',
      'auth_url, state = flow.authorization_url(prompt="consent", token_usage="remote")',
      'print(json.dumps({"authUrl": auth_url, "state": state, "codeVerifier": getattr(flow, "code_verifier", None)}))'
    ].join('\n');

    const { stdout } = await execFileAsync(pyBin, ['-c', snippet], { timeout: 15000 });
    const parsed = JSON.parse(stdout.trim());
    if (!parsed.authUrl) {
      throw new Error('Failed to generate Google OAuth authorization URL.');
    }

    this.pendingAuth = {
      authUrl: parsed.authUrl,
      state: parsed.state,
      codeVerifier: parsed.codeVerifier,
      startedAt: Date.now()
    };

    this.log('info', 'Generated Google Colab OAuth authorization URL. Waiting for verification code.');
    return {
      authUrl: parsed.authUrl,
      startedAt: this.pendingAuth.startedAt
    };
  }

  cancelAuthFlow() {
    this.pendingAuth = null;
    return { cancelled: true };
  }

  /**
   * Complete Google OAuth2 flow with the authorization code (or redirect URL / token JSON)
   * pasted by the user, save `~/.config/colab-cli/token.json`, and verify the account.
   */
  async completeAuthFlow(rawInput) {
    const cleaned = (rawInput || '').trim();
    if (!cleaned) {
      throw new Error('Paste the authorization code shown by Google after approving access.');
    }

    const tokenPath = this.tokenConfigPath();
    fs.mkdirSync(path.dirname(tokenPath), { recursive: true });

    // Support direct token.json paste if user pasted full credentials JSON
    if (cleaned.startsWith('{') && cleaned.endsWith('}')) {
      let parsed;
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        throw new Error('Invalid JSON token payload.');
      }
      if (!parsed.refresh_token && !parsed.token) {
        throw new Error('JSON payload is missing "refresh_token" or "token".');
      }
      fs.writeFileSync(tokenPath, JSON.stringify(parsed, null, 2), { mode: 0o600 });
      this.pendingAuth = null;
      await this.refreshAccountInfo({ includeUsage: true });
      this.log('info', `Google Colab authenticated (${this.cachedAccount?.email || 'token saved'}).`);
      return this.getSetupStatus({ verifyAccount: false });
    }

    // If the user pasted the full redirect URL (e.g. https://sdk.cloud.google.com/...?code=4/0A...), extract `code`
    let code = cleaned;
    if (/^https?:\/\//i.test(cleaned) || cleaned.includes('code=')) {
      try {
        const u = new URL(cleaned.startsWith('http') ? cleaned : `https://dummy.local/?${cleaned}`);
        const extracted = u.searchParams.get('code');
        if (extracted) code = extracted.trim();
      } catch {}
    }

    if (!this.pendingAuth) {
      throw new Error('Authorization session expired or was not started. Click "Get Auth Link" and try again.');
    }

    const pyBin = this.getColabPythonBin();
    const snippet = [
      'import json, os, sys',
      'from importlib import resources',
      'from google_auth_oauthlib.flow import InstalledAppFlow',
      'from colab_cli.auth import PUBLIC_SCOPES, REMOTE_REDIRECT_URI, TOKEN_CONFIG_PATH',
      'payload = json.loads(sys.stdin.read())',
      'cfg_path = os.path.expanduser("~/.colab-cli-oauth-config.json")',
      'if os.path.exists(cfg_path):',
      '    cfg = json.load(open(cfg_path))',
      'else:',
      '    cfg = json.loads(resources.files("colab_cli").joinpath("oauth_config.json").read_text())',
      'flow = InstalledAppFlow.from_client_config(cfg, PUBLIC_SCOPES, state=payload.get("state"))',
      'flow.redirect_uri = REMOTE_REDIRECT_URI',
      'if payload.get("codeVerifier"):',
      '    flow.code_verifier = payload["codeVerifier"]',
      'flow.fetch_token(code=payload["code"])',
      'creds = flow.credentials',
      'os.makedirs(os.path.dirname(TOKEN_CONFIG_PATH), exist_ok=True)',
      'with open(TOKEN_CONFIG_PATH, "w") as fh:',
      '    fh.write(creds.to_json())',
      'os.chmod(TOKEN_CONFIG_PATH, 0o600)',
      'print(json.dumps({"ok": True, "tokenPath": TOKEN_CONFIG_PATH}))'
    ].join('\n');

    try {
      await this.run(pyBin, ['-c', snippet], {
        timeout: 30000,
        input: JSON.stringify({
          code,
          state: this.pendingAuth.state,
          codeVerifier: this.pendingAuth.codeVerifier
        })
      });
    } catch (error) {
      throw new Error(
        `Failed to exchange authorization code: ${error.message.replace(/^python\d* -c exited \d+:\s*/i, '')}`
      );
    }

    this.pendingAuth = null;
    await this.ensureSshKey().catch(() => {});
    await this.refreshAccountInfo({ includeUsage: true });
    this.log('info', `Google Colab account connected (${this.cachedAccount?.email || 'authenticated'}).`);
    return this.getSetupStatus({ verifyAccount: false });
  }

  /**
   * Disconnect / sign out from Google Colab CLI and remove stored token.json.
   */
  async logoutAuth() {
    if (this.state === 'running' || this.state === 'starting') {
      await this.stop('account logout').catch(() => {});
    }
    const tokenPath = this.tokenConfigPath();
    try {
      if (fs.existsSync(tokenPath)) fs.unlinkSync(tokenPath);
    } catch {}
    this.pendingAuth = null;
    this.cachedAccount = null;
    this.log('info', 'Disconnected Google Colab account.');
    return this.getSetupStatus();
  }

  resolveSshKey(explicit) {
    if (explicit) return explicit;
    const candidates = ['id_ed25519', 'id_ecdsa', 'id_ed25519_cicd'].map((name) =>
      path.join(os.homedir(), '.ssh', name)
    );
    return candidates.find((file) => fs.existsSync(file)) || null;
  }

  async findFreePort() {
    return new Promise((resolve, reject) => {
      const server = net.createServer();
      server.unref();
      server.on('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const { port } = server.address();
        server.close(() => resolve(port));
      });
    });
  }

  async run(cmd, args, { timeout = 600000, input = null } = {}) {
    if (input === null) {
      const { stdout, stderr } = await execFileAsync(cmd, args, {
        timeout,
        maxBuffer: 8 * 1024 * 1024,
        encoding: 'utf8'
      });
      return `${stdout || ''}${stderr || ''}`;
    }

    return new Promise((resolve, reject) => {
      const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
      let out = '';
      let err = '';
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`${path.basename(cmd)} ${args[0] || ''} timed out after ${Math.round(timeout / 1000)}s`));
      }, timeout);
      child.stdout.on('data', (chunk) => {
        out += chunk.toString();
      });
      child.stderr.on('data', (chunk) => {
        err += chunk.toString();
      });
      child.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          reject(new Error(`${path.basename(cmd)} exited ${code}: ${err.trim().slice(-400) || out.trim().slice(-400)}`));
        } else {
          resolve(out);
        }
      });
      child.stdin.write(input);
      child.stdin.end();
    });
  }

  /** Run a Python snippet on the VM through the Colab kernel (fast, no TTY). */
  async remoteExec(snippet, timeoutSec = 120) {
    const { session } = this.settingsSnapshot();
    const colabBin = this.colabBinary();
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await this.run(colabBin, ['exec', '-s', session, '--timeout', String(timeoutSec)], {
          timeout: (timeoutSec + 60) * 1000,
          input: snippet
        });
      } catch (error) {
        lastError = error;
        // A brand-new runtime rejects the first exec while its kernel boots.
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }
    throw lastError;
  }

  async sessionExists() {
    const { session } = this.settingsSnapshot();
    try {
      const out = await this.run(this.colabBinary(), ['status', '-s', session], { timeout: 120000 });
      return /Hardware|Status/i.test(out);
    } catch {
      return false;
    }
  }

  // -------------------------
  // Worker bootstrap
  // -------------------------

  bootstrapScript() {
    return [
      'set -eu',
      `mkdir -p ${REMOTE_DIR}`,
      'python -m pip install -q --upgrade omnivoice soundfile fastapi uvicorn',
      "python - <<'PY'",
      'from huggingface_hub import snapshot_download',
      'snapshot_download("k2-fsa/OmniVoice")',
      'PY',
      'python -c "import torch; assert torch.cuda.is_available(), \'CUDA not available\'"',
      `touch ${REMOTE_MARKER}`,
      'echo BOOTSTRAP_DONE'
    ].join('\n');
  }

  async remoteMarkerReady() {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        const out = await this.remoteExec(
          `import os\nprint("READY" if os.path.exists(${JSON.stringify(REMOTE_MARKER)}) else "MISSING")`,
          60
        );
        return out.includes('READY');
      } catch (error) {
        // A freshly assigned runtime needs a few seconds before its kernel
        // accepts `colab exec` calls; retry instead of failing the bootstrap.
        if (attempt === 5) throw error;
        await new Promise((resolve) => setTimeout(resolve, 4000));
      }
    }
    return false;
  }

  async remoteLogTail(file, chars = 300) {
    try {
      const out = await this.remoteExec(
        `import os\np=${JSON.stringify(file)}\nprint(open(p).read()[-${chars}:] if os.path.exists(p) else "")`,
        60
      );
      return out.trim();
    } catch {
      return '';
    }
  }

  async uploadArtifacts() {
    const { session } = this.settingsSnapshot();
    const colabBin = this.colabBinary();
    if (!fs.existsSync(LOCAL_WORKER)) {
      throw new Error(`Worker script missing: ${LOCAL_WORKER}`);
    }
    await this.run(colabBin, ['upload', '-s', session, LOCAL_WORKER, REMOTE_WORKER], { timeout: 300000 });

    const refCandidates = [
      path.resolve(process.cwd(), 'data', 'custom-voice-ref.wav'),
      path.resolve(process.cwd(), 'data', 'custom-audio.m4a')
    ];
    const refFile = refCandidates.find((file) => fs.existsSync(file));
    if (!refFile) {
      throw new Error('No voice-clone reference audio found in data/ (custom-voice-ref.wav).');
    }
    await this.run(colabBin, ['upload', '-s', session, refFile, REMOTE_REF], { timeout: 300000 });

    const bootstrapFile = path.join(os.tmpdir(), `pdfreader_bootstrap_${Date.now()}.sh`);
    fs.writeFileSync(bootstrapFile, this.bootstrapScript(), 'utf8');
    try {
      await this.run(colabBin, ['upload', '-s', session, bootstrapFile, REMOTE_BOOTSTRAP], { timeout: 120000 });
    } finally {
      try {
        fs.unlinkSync(bootstrapFile);
      } catch {
        // temp file cleanup is best effort
      }
    }
  }

  async bootstrapIfNeeded() {
    if (await this.remoteMarkerReady()) {
      this.log('info', 'Colab worker deps + model already present in this session (warm).');
      return;
    }

    this.log('info', 'Provisioning Colab GPU session (upload worker, install deps, prefetch model)...');
    await this.uploadArtifacts();

    await this.remoteExec(
      [
        'import subprocess',
        `log = ${JSON.stringify(REMOTE_BOOTSTRAP_LOG)}`,
        `cmd = "nohup bash ${REMOTE_BOOTSTRAP} > " + log + " 2>&1 &"`,
        'subprocess.Popen(cmd, shell=True)',
        'print("BOOTSTRAP_STARTED")'
      ].join('\n'),
      60
    );

    const deadline = Date.now() + 20 * 60 * 1000;
    let lastReport = 0;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      if (await this.remoteMarkerReady()) {
        this.log('info', 'Colab worker provisioning complete (deps installed, OmniVoice weights cached).');
        return;
      }
      if (Date.now() - lastReport > 30000) {
        lastReport = Date.now();
        const tail = await this.remoteLogTail(REMOTE_BOOTSTRAP_LOG, 200);
        if (tail) this.log('info', `Provisioning... ${tail.replace(/\s+/g, ' ').slice(-160)}`);
      }
    }
    throw new Error('Timed out provisioning the Colab worker (20 minutes).');
  }

  async launchWorker() {
    this.log('info', 'Launching Colab TTS worker (warm model load)...');
    await this.remoteExec(
      [
        'import subprocess',
        `log = ${JSON.stringify(REMOTE_WORKER_LOG)}`,
        'subprocess.Popen("pkill -f [p]dfreader_worker.py", shell=True)',
        'import time; time.sleep(0.5)',
        'subprocess.Popen("nohup python ' + REMOTE_WORKER + ' > " + log + " 2>&1 &", shell=True)',
        'print("WORKER_LAUNCHED")'
      ].join('\n'),
      90
    );

    const deadline = Date.now() + 6 * 60 * 1000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 4000));
      const tail = await this.remoteLogTail(REMOTE_WORKER_LOG, 1200);
      if (tail.includes('MODEL_READY')) {
        const match = tail.match(/MODEL_READY[^\n]*/);
        this.log('info', `Colab worker warm${match ? `: ${match[0]}` : ''}`);
        return;
      }
      if (/Traceback|Error/i.test(tail)) {
        throw new Error(`Colab worker failed to start: ${tail.replace(/\s+/g, ' ').slice(-300)}`);
      }
    }
    throw new Error('Colab TTS worker did not become warm within 6 minutes.');
  }

  // -------------------------
  // Tunnel
  // -------------------------

  async openTunnel() {
    await this.ensureSshKey().catch(() => {});
    const { session, colabBin: configuredBin, sshKey } = this.settingsSnapshot();
    const colabBin = this.resolveColabBin(configuredBin);
    const key = this.resolveSshKey(sshKey);
    if (!key) {
      throw new Error('No ed25519/ecdsa SSH key found. Open Settings → TTS Backend & GPU to generate one.');
    }
    if (!fs.existsSync(colabBin)) {
      throw new Error(`colab CLI not found at ${colabBin}. Open Settings → TTS Backend & GPU to install Google Colab CLI.`);
    }

    const port = await this.findFreePort();

    // Clean up any stale local SSH tunnel processes that might have survived a server crash
    try {
      execSync(`pkill -f "colab ssh.*-s ${session}"`, { stdio: 'ignore' });
      await new Promise((r) => setTimeout(r, 600));
    } catch {
      // no orphan
    }

    const proxyCommand = `${colabBin} ssh --proxy-mode -s ${session} -i ${key}`;
    const args = [
      '-N',
      '-L',
      `${port}:localhost:${WORKER_PORT}`,
      '-i',
      key,
      '-o',
      'IdentitiesOnly=yes',
      '-o',
      `ProxyCommand=${proxyCommand}`,
      '-o',
      'StrictHostKeyChecking=no',
      '-o',
      'UserKnownHostsFile=/dev/null',
      '-o',
      'ExitOnForwardFailure=yes',
      '-o',
      'ServerAliveInterval=15',
      '-o',
      'ServerAliveCountMax=4',
      'root@colab'
    ];

    this.log('info', `Opening SSH tunnel to Colab worker on localhost:${port}...`);
    const child = spawn('ssh', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    this.tunnelProc = child;
    this.localPort = port;

    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('exit', (code) => {
      if (this.tunnelProc === child) {
        this.tunnelProc = null;
        if (this.state === 'running') {
          this.log('warn', `SSH tunnel closed (exit ${code}). ${stderr.trim().slice(-200)}`);
        }
      }
    });
    child.on('error', (error) => {
      this.log('error', `SSH tunnel failed: ${error.message}`);
    });

    // Tunnel is ready once /health answers through it.
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const health = await this.health();
      if (health) {
        this.modelInfo = health;
        this.log('info', `Colab worker online: ${health.gpu || 'GPU'} · VRAM ${health.vram_allocated_gb || '?'} GB`);
        return;
      }
      if (!this.tunnelProc) {
        throw new Error(`SSH tunnel exited before becoming ready. ${stderr.trim().slice(-300)}`);
      }
    }
    throw new Error('SSH tunnel to the Colab worker did not become ready within 60s.');
  }

  async health() {
    if (!this.localPort) return null;
    try {
      const response = await fetch(`http://127.0.0.1:${this.localPort}/health`, {
        signal: AbortSignal.timeout(10000)
      });
      if (!response.ok) return null;
      const data = await response.json();
      return data?.model_loaded ? data : null;
    } catch {
      return null;
    }
  }

  // -------------------------
  // Lifecycle
  // -------------------------

  async start(reason = 'requested', { force = false } = {}) {
    if (this.state === 'running' && (await this.health())) {
      this.touch();
      return this.status();
    }
    if (!force && this.cooldownUntil && Date.now() < this.cooldownUntil) {
      const waitSec = Math.ceil((this.cooldownUntil - Date.now()) / 1000);
      throw new Error(`Colab worker unavailable (cooling down ${waitSec}s after: ${this.lastError || 'previous failure'})`);
    }
    if (this.startPromise) return this.startPromise;

    this.startPromise = this._start(reason).finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }

  async _start(reason) {
    if (!this.isColabInstalled()) {
      const msg = 'Google Colab CLI is not installed. Open Settings → TTS Backend & GPU to install it in one click.';
      this.setState('error', { lastError: msg });
      throw new Error(msg);
    }
    if (!this.hasStoredToken()) {
      const msg = 'Google Colab is not connected yet. Open Settings → TTS Backend & GPU to authorize your Google account.';
      this.setState('error', { lastError: msg });
      throw new Error(msg);
    }

    const { gpu, session } = this.settingsSnapshot();
    this.setState('starting', { lastError: null, session, gpu });
    this.log('info', `Starting Colab GPU TTS (${gpu}, session "${session}", ${reason})...`);

    try {
      if (!(await this.sessionExists())) {
        this.log('info', `Allocating Colab ${gpu} runtime (session "${session}")...`);
        try {
          await this.run(this.colabBinary(), ['new', '-s', session, '--gpu', gpu], {
            timeout: 15 * 60 * 1000
          });
        } catch (error) {
          const sessions = await this.run(this.colabBinary(), ['sessions'], { timeout: 60000 }).catch(() => '');
          throw new Error(
            `${error.message.replace(/\s+/g, ' ').slice(0, 300)}${
              sessions ? ` | active runtimes: ${sessions.replace(/\s+/g, ' ').slice(0, 200)}` : ''
            }`
          );
        }
      } else {
        this.log('info', `Reusing existing Colab session "${session}".`);
      }

      await this.bootstrapIfNeeded();
      await this.launchWorker();
      await this.openTunnel();

      this.setState('running', { lastError: null });
      this.startHeartbeat();
      this.touch();
      this.log('info', 'Colab TTS worker READY — pages will synthesize on the remote GPU.');
      // Push the voice library once per warm session so per-page requests only
      // carry an id and the worker keeps a warm clone prompt per voice.
      this.syncVoices(this.voiceProvider ? await this.voiceProvider() : []).catch(() => {});
      return this.status();
    } catch (error) {
      this.lastError = error.message;
      // Back off so an unavailable runtime does not get hammered once per page.
      this.cooldownUntil = Date.now() + 5 * 60 * 1000;
      this.setState('error', { lastError: error.message });
      this.log('error', `Colab startup failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Register the function that returns the local voice library
   * ([{ id, name, refText, audioPath }]). Kept as a callback so this module
   * stays independent of the database layer.
   */
  setVoiceProvider(provider) {
    this.voiceProvider = provider;
  }

  /**
   * Upload voice reference samples to the running worker. Uploading a voice also
   * drops the worker's cached clone prompt for it, so pass force=true after the
   * sample or its transcript changed.
   */
  async syncVoices(voices = [], { force = false } = {}) {
    if (!this.localPort || this.state !== 'running') return { synced: 0, skipped: true };

    let synced = 0;
    for (const voice of voices) {
      if (!voice || !voice.id || !voice.audioPath) continue;
      if (!force && this.uploadedVoices.has(voice.id)) continue;
      if (!fs.existsSync(voice.audioPath)) continue;

      const audioB64 = fs.readFileSync(voice.audioPath).toString('base64');
      const response = await fetch(`http://127.0.0.1:${this.localPort}/voices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: voice.id,
          name: voice.name || voice.id,
          ref_text: voice.refText || '',
          audio_b64: audioB64
        }),
        signal: AbortSignal.timeout(120000)
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        this.log('warn', `Voice sync failed for ${voice.name || voice.id}: ${detail.slice(0, 120)}`);
        continue;
      }
      this.uploadedVoices.add(voice.id);
      synced += 1;
    }
    if (synced) {
      this.log('info', `Synced ${synced} voice sample(s) to the Colab worker.`);
    }
    return { synced };
  }

  async removeVoice(voiceId) {
    this.uploadedVoices.delete(voiceId);
    if (!this.localPort || this.state !== 'running') return;
    try {
      await fetch(`http://127.0.0.1:${this.localPort}/voices/${encodeURIComponent(voiceId)}`, {
        method: 'DELETE',
        signal: AbortSignal.timeout(15000)
      });
    } catch (error) {
      this.log('warn', `Could not remove voice ${voiceId} from the worker: ${error.message}`);
    }
  }

  startHeartbeat() {
    if (this.heartbeat) return;
    this.heartbeatFailures = 0;
    this.heartbeat = setInterval(async () => {
      if (this.state !== 'running') return;
      const health = await this.health();
      if (!health) {
        this.heartbeatFailures = (this.heartbeatFailures || 0) + 1;
        this.log('warn', `Colab worker heartbeat probe missed (${this.heartbeatFailures}/3).`);
        if (this.heartbeatFailures >= 3) {
          this.log('warn', 'Colab worker heartbeat failed 3 consecutive times — closing dropped tunnel.');
          this.modelInfo = null;
          this.setState('error', { lastError: 'Worker heartbeat failed (tunnel or GPU session dropped).' });
          this.stopHeartbeat();
          await this.closeTunnel();
        }
      } else {
        this.heartbeatFailures = 0;
        this.modelInfo = health;
      }
    }, 45000);
    this.heartbeat.unref?.();
  }

  stopHeartbeat() {
    this.heartbeatFailures = 0;
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
  }

  touch() {
    this.lastSynthAt = Date.now();
    const { idleStopMin } = this.settingsSnapshot();
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (!idleStopMin || idleStopMin <= 0) return;
    const effectiveMin = Math.max(20, idleStopMin);
    this.idleTimer = setTimeout(() => {
      this.log('info', `Colab worker idle for ${effectiveMin} min — stopping the GPU session to save compute units.`);
      this.stop('idle timeout').catch(() => {});
    }, effectiveMin * 60000);
    this.idleTimer.unref?.();
  }

  async closeTunnel() {
    this.uploadedVoices.clear();
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.tunnelProc) {
      try {
        this.tunnelProc.kill('SIGTERM');
      } catch {
        // ignore
      }
      this.tunnelProc = null;
    }
    this.localPort = null;
    this.modelInfo = null;
  }

  async stop(reason = 'user') {
    const { session } = this.settingsSnapshot();
    const hadSession = this.session || session;
    this.cooldownUntil = null;
    this.setState('stopping');
    this.stopHeartbeat();
    await this.closeTunnel();

    try {
      if (hadSession) {
        await this.remoteExec('import subprocess; subprocess.Popen("pkill -f [p]dfreader_worker.py", shell=True); print("WORKER_STOPPED")', 60).catch(() => {});
        await this.run(this.colabBinary(), ['stop', '-s', hadSession], { timeout: 300000 }).catch(() => {});
      }
    } finally {
      this.log('info', `Colab GPU TTS stopped (${reason}).`);
      this.setState('stopped', { lastError: null, session: null, gpu: null });
    }
    return this.status();
  }

  /**
   * Synthesize one page on the remote GPU, writing a WAV to outputPath.
   * Serialized: the pipeline is sequential, and OmniVoice on one GPU must not
   * be hit concurrently.
   */
  async synthesize(text, outputPath, settings = {}, { retry = true, voice = null } = {}) {
    const run = async () => {
      await this.start('page synthesis');
      if (!this.localPort) throw new Error('No tunnel port');

      const payload = { text };
      if (voice && voice.id) {
        // Ensure the worker has this sample before referencing it. A cold VM (or
        // a voice added mid-session) would otherwise 409 on the first page.
        if (!this.uploadedVoices.has(voice.id)) {
          await this.syncVoices([voice]);
        }
        payload.voice_id = voice.id;
        if (voice.refText) payload.ref_text = voice.refText;
      }
      const instruct = (settings.tts_instruct || '').trim();
      if (instruct) payload.instruct = instruct;
      const speed = parseFloat(settings.tts_speed || '1.0');
      if (Number.isFinite(speed)) payload.speed = speed;
      const numStep = parseInt(settings.tts_num_step || '16', 10);
      if (Number.isInteger(numStep)) payload.num_step = numStep;

      const postTts = () =>
        fetch(`http://127.0.0.1:${this.localPort}/tts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(10 * 60 * 1000)
        });

      let response = await postTts();
      // 409 = worker does not hold this sample yet (cold VM or a voice added
      // while it was warm). Push it and retry instead of restarting the worker.
      if (response.status === 409 && voice && voice.id) {
        this.log('info', `Uploading voice "${voice.name || voice.id}" to the worker and retrying.`);
        await this.syncVoices([voice], { force: true });
        response = await postTts();
      }

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(`Colab TTS HTTP ${response.status}: ${detail.slice(0, 200)}`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length < 1000) throw new Error('Colab TTS returned an empty audio body.');

      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, buffer);

      const durationHeader = parseFloat(response.headers.get('x-audio-seconds') || '0');
      const synthHeader = parseFloat(response.headers.get('x-synth-seconds') || '0');
      this.lastStats = {
        audioSeconds: durationHeader,
        synthSeconds: synthHeader,
        bytes: buffer.length,
        at: Date.now()
      };
      this.touch();

      return {
        audioPath: outputPath,
        duration: durationHeader,
        voice: `Colab ${this.gpu || 'GPU'} OmniVoice Clone`,
        engine: 'colab'
      };
    };

    const task = this.queue.then(run, run);
    this.queue = task.catch(() => {});

    try {
      return await task;
    } catch (error) {
      if (!retry) throw error;
      this.log('warn', `Colab TTS failed (${error.message}); restarting the worker once and retrying.`);
      await this.closeTunnel();
      this.setState('error', { lastError: error.message });
      return this.synthesize(text, outputPath, settings, { retry: false, voice });
    }
  }
}

export const remoteColab = new ColabRemoteTTS();
