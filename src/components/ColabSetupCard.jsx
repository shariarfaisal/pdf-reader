import React, { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  Copy,
  Check,
  ExternalLink,
  KeyRound,
  Download,
  RefreshCw,
  LogOut,
  Terminal,
  AlertCircle,
  Sparkles,
  ShieldCheck,
  Coins
} from 'lucide-react';
import { Button } from './ui/Button';
import { Tag } from './ui/Badge';
import { Field, TextInput } from './ui/Field';
import { ConfirmModal } from './ui/ConfirmModal';

function shortenHome(p) {
  if (!p || typeof p !== 'string') return '';
  return p.replace(/^\/Users\/[^/]+/, '~').replace(/^\/home\/[^/]+/, '~');
}

/**
 * Plug-and-Play Google Colab CLI Installer & OAuth2 Onboarding Card.
 *
 * Lets any user:
 *  1. Install or update `google-colab-cli` + auto-generate the SSH tunnel key in one click.
 *  2. Authorize their Google account via a copyable OAuth URL + verification code input.
 *  3. Inspect connected Google account email, token state, and live Colab Compute Units.
 */
export function ColabSetupCard({ onSetupChange }) {
  const [setup, setSetup] = useState(null);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [checkingUsage, setCheckingUsage] = useState(false);
  const [authUrl, setAuthUrl] = useState('');
  const [authCode, setAuthCode] = useState('');
  const [showAuthWizard, setShowAuthWizard] = useState(false);
  const [startingAuth, setStartingAuth] = useState(false);
  const [verifyingAuth, setVerifyingAuth] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [showInstallLogs, setShowInstallLogs] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const loadStatus = useCallback(
    async ({ verify = false, usage = false } = {}) => {
      if (usage) setCheckingUsage(true);
      try {
        const qs = new URLSearchParams();
        if (verify) qs.set('verify', '1');
        if (usage) qs.set('usage', '1');
        const res = await fetch(`/api/remote/setup-status?${qs.toString()}`);
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.setup) {
          setSetup(data.setup);
          if (data.setup.auth?.pendingFlow?.authUrl) {
            setAuthUrl(data.setup.auth.pendingFlow.authUrl);
            setShowAuthWizard(true);
          }
          onSetupChange?.(data.setup);
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
        setCheckingUsage(false);
      }
    },
    [onSetupChange]
  );

  useEffect(() => {
    loadStatus({ verify: true, usage: false });
  }, [loadStatus]);

  const handleInstallCli = async () => {
    setInstalling(true);
    setError(null);
    setNotice(null);
    setShowInstallLogs(true);
    try {
      const res = await fetch('/api/remote/install', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.setup) setSetup(data.setup);
        throw new Error(data.error || 'Failed to install Google Colab CLI');
      }
      setSetup(data.setup);
      setNotice('Google Colab CLI and SSH tunnel key are installed and ready.');
      onSetupChange?.(data.setup);
      if (!data.setup?.auth?.authenticated) {
        setShowAuthWizard(true);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setInstalling(false);
    }
  };

  const handleStartAuth = async () => {
    setStartingAuth(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/remote/auth/start', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not start Google OAuth flow');
      setAuthUrl(data.authUrl || '');
      setShowAuthWizard(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setStartingAuth(false);
    }
  };

  const handleCopyUrl = async () => {
    if (!authUrl) return;
    try {
      await navigator.clipboard.writeText(authUrl);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    } catch {}
  };

  const handleCompleteAuth = async () => {
    if (!authCode.trim()) {
      setError('Paste the authorization code from Google before verifying.');
      return;
    }
    setVerifyingAuth(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/remote/auth/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: authCode.trim() })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to verify authorization code');
      setSetup(data.setup);
      setAuthCode('');
      setAuthUrl('');
      setShowAuthWizard(false);
      setNotice(
        `Connected to Google Colab${data.setup?.auth?.email ? ` as ${data.setup.auth.email}` : ''}.`
      );
      onSetupChange?.(data.setup);
    } catch (err) {
      setError(err.message);
    } finally {
      setVerifyingAuth(false);
    }
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/remote/auth/logout', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to disconnect account');
      setSetup(data.setup);
      setConfirmLogout(false);
      setNotice('Google Colab account disconnected.');
      onSetupChange?.(data.setup);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoggingOut(false);
    }
  };

  const cliInstalled = Boolean(setup?.cli?.installed);
  const sshReady = Boolean(setup?.sshKey?.ready);
  const isAuthenticated = Boolean(setup?.auth?.authenticated);
  const accountEmail = setup?.auth?.email;
  const usage = setup?.auth?.usage;
  const installLogs = setup?.cli?.installLogs || [];

  return (
    <div className="rounded-xl border border-obsidian-700/80 bg-obsidian-950/60 p-3.5 space-y-3">
      {/* Header row */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <ShieldCheck
            className={`w-4 h-4 flex-shrink-0 ${
              cliInstalled && isAuthenticated ? 'text-emerald-400' : 'text-amber-400'
            }`}
          />
          <span className="text-[12.5px] font-semibold text-slate-100">
            Google Colab Plug-and-Play Setup
          </span>
          {loading ? (
            <Tag tone="slate" size="xs">
              Checking…
            </Tag>
          ) : cliInstalled && isAuthenticated ? (
            <Tag tone="emerald" size="xs" dot>
              Connected
            </Tag>
          ) : cliInstalled ? (
            <Tag tone="amber" size="xs">
              Auth required
            </Tag>
          ) : (
            <Tag tone="rose" size="xs">
              CLI not installed
            </Tag>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {cliInstalled && isAuthenticated && (
            <Button
              variant="ghost"
              size="xs"
              icon={Coins}
              isLoading={checkingUsage}
              onClick={() => loadStatus({ verify: true, usage: true })}
              title="Query live Google Colab compute unit balance"
            >
              {usage?.balance !== undefined && usage?.balance !== null
                ? `${usage.balance.toFixed(1)} CU`
                : 'Check CU Balance'}
            </Button>
          )}
          <Button
            variant="ghost"
            size="xs"
            icon={RefreshCw}
            isLoading={loading && !checkingUsage}
            onClick={() => loadStatus({ verify: true, usage: Boolean(usage) })}
            title="Refresh Colab CLI & authentication status"
          >
            Refresh
          </Button>
        </div>
      </div>

      {/* Status Checklist Pills */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {/* 1. Colab CLI */}
        <div className="rounded-lg border border-obsidian-800 bg-obsidian-900/70 px-2.5 py-2 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[10.5px] uppercase tracking-wider text-slate-500 font-semibold">
              1. Colab CLI
            </div>
            <div className="text-[11.5px] text-slate-200 font-mono truncate mt-0.5">
              {cliInstalled
                ? `v${setup.cli.version || 'ready'} · ${shortenHome(setup.cli.binaryPath)}`
                : 'Not installed'}
            </div>
          </div>
          <Tag tone={cliInstalled ? 'emerald' : 'amber'} size="xs">
            {cliInstalled ? 'Ready' : 'Missing'}
          </Tag>
        </div>

        {/* 2. SSH Key */}
        <div className="rounded-lg border border-obsidian-800 bg-obsidian-900/70 px-2.5 py-2 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[10.5px] uppercase tracking-wider text-slate-500 font-semibold">
              2. SSH Tunnel Key
            </div>
            <div className="text-[11.5px] text-slate-200 font-mono truncate mt-0.5">
              {sshReady ? shortenHome(setup.sshKey.path) : 'Auto-created on install'}
            </div>
          </div>
          <Tag tone={sshReady ? 'emerald' : 'slate'} size="xs">
            {sshReady ? 'Ready' : 'Pending'}
          </Tag>
        </div>

        {/* 3. Google OAuth */}
        <div className="rounded-lg border border-obsidian-800 bg-obsidian-900/70 px-2.5 py-2 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[10.5px] uppercase tracking-wider text-slate-500 font-semibold">
              3. Google Account
            </div>
            <div className="text-[11.5px] text-slate-200 truncate mt-0.5" title={accountEmail || ''}>
              {isAuthenticated ? accountEmail || 'Authorized (OAuth2)' : 'Not signed in'}
            </div>
          </div>
          <Tag tone={isAuthenticated ? 'emerald' : 'amber'} size="xs">
            {isAuthenticated ? 'Linked' : 'Unlinked'}
          </Tag>
        </div>
      </div>

      {/* Compute units summary bar when loaded */}
      {isAuthenticated && usage && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-brand-500/20 bg-brand-500/5 px-3 py-1.5 text-[11.5px]">
          <div className="flex items-center gap-2 text-brand-200">
            <Sparkles className="w-3.5 h-3.5 text-brand-400 flex-shrink-0" />
            <span>
              Compute Balance:{' '}
              <strong className="font-mono text-white">
                {usage.balance !== null ? `${usage.balance.toFixed(2)} CU` : 'Available'}
              </strong>
            </span>
          </div>
          <div className="flex items-center gap-3 text-[11px] font-mono text-slate-400">
            {usage.ratePerHour !== null && <span>Burn rate: {usage.ratePerHour}/hr</span>}
            <span>Active runtimes: {usage.activeAssignments ?? 0}</span>
          </div>
        </div>
      )}

      {/* Alerts / Notices */}
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
          <span className="flex-1 leading-relaxed">{error}</span>
        </div>
      )}

      {notice && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
          <span className="flex-1">{notice}</span>
        </div>
      )}

      {/* Action Row: Install / Auth / Switch Account */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={cliInstalled ? 'ghost' : 'primary'}
            size="sm"
            icon={Download}
            isLoading={installing}
            onClick={handleInstallCli}
          >
            {cliInstalled ? 'Update Colab CLI' : 'Install Google Colab CLI'}
          </Button>

          {cliInstalled && !isAuthenticated && !showAuthWizard && (
            <Button
              variant="primary"
              size="sm"
              icon={KeyRound}
              isLoading={startingAuth}
              onClick={handleStartAuth}
            >
              Connect Google Account
            </Button>
          )}

          {cliInstalled && isAuthenticated && (
            <Button
              variant="secondary"
              size="sm"
              icon={KeyRound}
              isLoading={startingAuth}
              onClick={async () => {
                if (showAuthWizard) {
                  setShowAuthWizard(false);
                  setAuthUrl('');
                  setAuthCode('');
                  await fetch('/api/remote/auth/cancel', { method: 'POST' }).catch(() => {});
                } else {
                  handleStartAuth();
                }
              }}
            >
              {showAuthWizard ? 'Hide Auth Wizard' : 'Switch / Re-authorize Account'}
            </Button>
          )}

          {installLogs.length > 0 && (
            <Button
              variant="ghost"
              size="xs"
              icon={Terminal}
              onClick={() => setShowInstallLogs((v) => !v)}
            >
              {showInstallLogs ? 'Hide Install Log' : 'Install Log'}
            </Button>
          )}
        </div>

        {isAuthenticated && (
          <Button
            variant="ghost"
            size="xs"
            icon={LogOut}
            onClick={() => setConfirmLogout(true)}
            className="text-slate-400 hover:text-rose-300"
          >
            Disconnect
          </Button>
        )}
      </div>

      {/* Collapsible CLI Install Logs */}
      {showInstallLogs && installLogs.length > 0 && (
        <pre className="max-h-36 overflow-y-auto rounded-lg border border-obsidian-800 bg-obsidian-950 p-2.5 text-[10.5px] font-mono text-slate-300 leading-relaxed whitespace-pre-wrap">
          {installLogs.join('\n')}
        </pre>
      )}

      {/* Guided Browser OAuth Wizard */}
      {cliInstalled && (showAuthWizard || !isAuthenticated) && (
        <div className="rounded-xl border border-brand-500/25 bg-obsidian-900/90 p-3.5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h4 className="text-xs font-semibold text-white">
                Authorize Google Colab Access (Copy &amp; Paste OAuth Flow)
              </h4>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Follow these 3 quick steps to link your Google account for remote GPU synthesis:
              </p>
            </div>
            {!authUrl && (
              <Button
                variant="primary"
                size="xs"
                icon={KeyRound}
                isLoading={startingAuth}
                onClick={handleStartAuth}
              >
                Generate Auth URL
              </Button>
            )}
          </div>

          <ol className="space-y-2.5 text-[11.5px] text-slate-300">
            <li className="space-y-1.5">
              <div className="flex items-center gap-1.5 font-medium text-slate-200">
                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-brand-500/20 text-brand-300 text-[10px] font-bold">
                  1
                </span>
                Copy the authorization URL below and open it in any browser:
              </div>
              {authUrl ? (
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    readOnly
                    value={authUrl}
                    onFocus={(e) => e.target.select()}
                    aria-label="Google OAuth Authorization URL"
                    className="flex-1 bg-obsidian-950 border border-obsidian-700 rounded-lg px-2.5 py-1.5 text-[11px] font-mono text-brand-200 focus:outline-none focus:border-brand-400"
                  />
                  <Button
                    variant="secondary"
                    size="xs"
                    icon={copiedUrl ? Check : Copy}
                    onClick={handleCopyUrl}
                  >
                    {copiedUrl ? 'Copied' : 'Copy URL'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="xs"
                    icon={ExternalLink}
                    onClick={() => window.open(authUrl, '_blank', 'noopener,noreferrer')}
                  >
                    Open
                  </Button>
                </div>
              ) : (
                <div className="text-[11px] text-slate-500 pl-5">
                  Click <strong className="text-slate-300">Generate Auth URL</strong> to create a fresh Google sign-in link.
                </div>
              )}
            </li>

            <li className="flex items-start gap-1.5">
              <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-brand-500/20 text-brand-300 text-[10px] font-bold mt-0.5 flex-shrink-0">
                2
              </span>
              <span>
                Sign in with your Google account and click <strong className="text-white">Allow</strong>. Google will display an authorization code on screen.
              </span>
            </li>

            <li className="space-y-1.5">
              <div className="flex items-center gap-1.5 font-medium text-slate-200">
                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-brand-500/20 text-brand-300 text-[10px] font-bold">
                  3
                </span>
                Paste the authorization code (or token JSON) here to finish connecting:
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <TextInput
                    mono
                    placeholder="Paste authorization code (e.g. 4/0AeanS0...)"
                    value={authCode}
                    onChange={(e) => setAuthCode(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleCompleteAuth();
                      }
                    }}
                  />
                </div>
                <Button
                  variant="primary"
                  size="sm"
                  icon={CheckCircle2}
                  isLoading={verifyingAuth}
                  disabled={!authCode.trim()}
                  onClick={handleCompleteAuth}
                >
                  Verify &amp; Connect
                </Button>
              </div>
            </li>
          </ol>
        </div>
      )}

      <ConfirmModal
        isOpen={confirmLogout}
        onClose={() => setConfirmLogout(false)}
        onConfirm={handleLogout}
        isLoading={loggingOut}
        title="Disconnect Google Colab Account?"
        message="This removes the local OAuth token (~/.config/colab-cli/token.json) and stops any active Colab GPU tunnel. You can reconnect anytime."
        confirmText="Disconnect Account"
        variant="danger"
      />
    </div>
  );
}
