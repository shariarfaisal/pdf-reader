import React, { useState } from 'react';
import { HardDrive, CheckCircle2, AlertCircle, UploadCloud, Trash2 } from 'lucide-react';
import { Button } from './ui/Button';
import { Tag } from './ui/Badge';
import { ConfirmModal } from './ui/ConfirmModal';
import { DriveSyncBadge } from './DriveSyncBadge';
import { useDriveSyncStatus } from '../lib/useDriveSyncStatus';
import { formatBytes, formatBookDisplayTitle } from '../lib/format';

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

/**
 * Google Drive connection plus sync overview for narration audio.
 * The per-project table reads the same live status as the project cards.
 */
export function DriveStorageCard() {
  const drive = useDriveSyncStatus();
  const [busy, setBusy] = useState(null); // 'connect' | 'disconnect' | 'sync-all' | projectId:'sync' | projectId:'free'
  const [message, setMessage] = useState(null); // { tone: 'ok' | 'error', text }
  const [freePlan, setFreePlan] = useState(null); // { project, result } awaiting confirmation

  const run = async (key, task) => {
    setBusy(key);
    setMessage(null);
    try {
      await task();
    } catch (err) {
      setMessage({ tone: 'error', text: err.message });
    } finally {
      setBusy(null);
      drive.refresh();
    }
  };

  const connect = () =>
    run('connect', async () => {
      const data = await postJson('/api/drive/auth/start');
      window.open(data.authUrl, '_blank', 'noopener');
      setMessage({ tone: 'ok', text: 'Finish sign-in in the Google tab, then return here.' });
    });

  const disconnect = () =>
    run('disconnect', async () => {
      await postJson('/api/drive/disconnect');
      setMessage({ tone: 'ok', text: 'Disconnected. Audio already in Drive stays there until you delete it.' });
    });

  const syncAll = () =>
    run('sync-all', async () => {
      const data = await postJson('/api/drive/sync-all');
      setMessage({ tone: 'ok', text: `Upload started for ${data.started} project(s). Progress updates here.` });
    });

  const syncProject = (project) =>
    run(`${project.id}:sync`, async () => {
      await postJson(`/api/projects/${project.id}/drive/sync`);
      setMessage({ tone: 'ok', text: `Uploading "${formatBookDisplayTitle(project.name)}" to Drive.` });
    });

  // Verify first (dry run), then ask. Nothing is deleted until the user confirms the numbers.
  const planFree = (project) =>
    run(`${project.id}:free`, async () => {
      const result = await postJson(`/api/projects/${project.id}/drive/free-local`, { dryRun: true });
      setFreePlan({ project, result });
    });

  const confirmFree = async () => {
    const { project } = freePlan;
    setFreePlan((plan) => ({ ...plan, working: true }));
    try {
      const result = await postJson(`/api/projects/${project.id}/drive/free-local`, {});
      setMessage({ tone: 'ok', text: `Freed ${formatBytes(result.freedBytes)} from "${formatBookDisplayTitle(project.name)}". Playback now loads from Drive.` });
      setFreePlan(null);
    } catch (err) {
      setMessage({ tone: 'error', text: err.message });
      setFreePlan(null);
    } finally {
      drive.refresh();
    }
  };

  const connected = Boolean(drive.drive?.connected);
  const configured = Boolean(drive.drive?.configured);
  const projects = drive.projects;
  const totals = projects.reduce(
    (sum, p) => ({
      pages: sum.pages + p.total,
      backedUp: sum.backedUp + p.backedUp,
      localBytes: sum.localBytes + p.localBytes,
      pending: sum.pending + p.pendingUpload,
      running: sum.running || ['queued', 'running'].includes(p.job?.state)
    }),
    { pages: 0, backedUp: 0, localBytes: 0, pending: 0, running: false }
  );
  const freePlanResult = freePlan?.result;

  return (
    <div className="p-5 rounded-xl border border-obsidian-700/80 bg-obsidian-850 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <HardDrive className="w-4 h-4 text-sky-400" />
          <span className="text-sm font-semibold text-slate-200">Google Drive</span>
        </div>
        {drive.loaded && (
          <Tag tone={connected ? 'success' : 'slate'} size="xs" dot={connected}>
            {connected ? 'Connected' : 'Not connected'}
          </Tag>
        )}
      </div>

      {drive.loaded && !configured && (
        <p className="text-xs text-amber-300 leading-relaxed">
          Add GOOGLE_DRIVE_CLIENT_ID and GOOGLE_DRIVE_CLIENT_SECRET to .env and restart the server (see .env.example).
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {!connected ? (
          <Button variant="primary" size="sm" onClick={connect} disabled={!configured || busy !== null} isLoading={busy === 'connect'}>
            Connect Google Drive
          </Button>
        ) : (
          <>
            <Button variant="primary" size="sm" icon={UploadCloud} onClick={syncAll} disabled={busy !== null || totals.pending === 0} isLoading={busy === 'sync-all'}>
              Upload all missing ({totals.pending})
            </Button>
            <Button variant="outline" size="sm" onClick={disconnect} disabled={busy !== null} isLoading={busy === 'disconnect'}>
              Disconnect
            </Button>
          </>
        )}
        <Button variant="ghost" size="sm" onClick={drive.refresh} disabled={busy !== null}>
          Refresh
        </Button>
      </div>

      {connected && (
        <div className="grid grid-cols-3 gap-2 text-center">
          <Stat label="On Drive" value={`${totals.backedUp}/${totals.pages}`} />
          <Stat label="Local audio" value={formatBytes(totals.localBytes)} />
          <Stat label="Uploading" value={totals.running ? 'Yes' : 'No'} />
        </div>
      )}

      {connected && projects.length > 0 && (
        <ul className="divide-y divide-obsidian-800 rounded-lg border border-obsidian-800">
          {projects.map((project) => {
            const uploading = ['queued', 'running'].includes(project.job?.state);
            const canUpload = project.pendingUpload > 0 && !uploading;
            const canFree = project.backedUp > 0 && project.localFiles > 0 && !uploading;
            return (
              <li key={project.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-slate-200 truncate">{formatBookDisplayTitle(project.name)}</div>
                  <div className="mt-1">
                    <DriveSyncBadge sync={project} />
                  </div>
                </div>
                <div className="flex gap-1.5">
                  <Button variant="secondary" size="sm" icon={UploadCloud} onClick={() => syncProject(project)} disabled={!canUpload || busy !== null} isLoading={busy === `${project.id}:sync`}>
                    Upload
                  </Button>
                  <Button variant="outline" size="sm" icon={Trash2} onClick={() => planFree(project)} disabled={!canFree || busy !== null} isLoading={busy === `${project.id}:free`}>
                    Free local
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {connected && projects.length === 0 && drive.loaded && (
        <p className="text-xs text-slate-400">No narration audio yet. Synthesized pages appear here.</p>
      )}

      {message && (
        <p className={`text-xs flex items-start gap-1.5 ${message.tone === 'error' ? 'text-rose-300' : 'text-emerald-300'}`}>
          {message.tone === 'error' ? <AlertCircle className="w-3.5 h-3.5 mt-px shrink-0" /> : <CheckCircle2 className="w-3.5 h-3.5 mt-px shrink-0" />}
          <span>{message.text}</span>
        </p>
      )}

      <ConfirmModal
        isOpen={Boolean(freePlan)}
        onClose={() => setFreePlan(null)}
        onConfirm={confirmFree}
        title="Free local audio?"
        message={
          freePlanResult
            ? `${freePlanResult.verified} of ${freePlanResult.checked} local file(s) are confirmed on Google Drive with matching size. Deleting them frees ${formatBytes(freePlanResult.freedBytes)} on this Mac. Files that fail the check are kept. Playback will download pages from Drive when needed.`
            : ''
        }
        confirmText="Free local space"
        variant="danger"
        isLoading={Boolean(freePlan?.working)}
      />
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-lg border border-obsidian-800 px-2 py-2">
      <div className="text-sm font-semibold text-slate-100">{value}</div>
      <div className="text-[11px] text-slate-400">{label}</div>
    </div>
  );
}
