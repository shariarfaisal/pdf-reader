import React from 'react';
import { Tag } from './ui/Badge';
import { formatBytes } from '../lib/format';

/**
 * Compact Drive sync state for one project, built from /api/drive/sync-status.
 * Shared by project cards and the Settings sync table.
 */
export function describeDriveSync(sync) {
  if (!sync || !sync.total) return null;
  const { total, backedUp, lost, job } = sync;
  if (lost > 0) return { tone: 'error', label: `${lost} page(s) lost`, pct: Math.round((backedUp / total) * 100) };
  if (job?.state === 'queued') return { tone: 'info', label: `Queued ${job.total} page(s)`, pct: 0 };
  if (job?.state === 'running') {
    const done = job.uploaded + job.failed;
    return { tone: 'info', label: `Uploading ${done}/${job.total}`, pct: job.total ? Math.round((done / job.total) * 100) : 100 };
  }
  if (backedUp === total) return { tone: 'success', label: `On Drive ${backedUp}/${total}`, pct: 100 };
  if (backedUp === 0) return { tone: 'slate', label: 'Not on Drive', pct: 0 };
  return { tone: 'warning', label: `On Drive ${backedUp}/${total}`, pct: Math.round((backedUp / total) * 100) };
}

export function DriveSyncBadge({ sync }) {
  const view = describeDriveSync(sync);
  if (!view) return null;
  const localText = sync.localBytes > 0 ? `${formatBytes(sync.localBytes)} local` : 'no local copy';
  return (
    <span className="inline-flex items-center gap-2" title={`${sync.backedUp} of ${sync.total} pages on Google Drive · ${localText}`}>
      <Tag tone={view.tone} size="xs" dot>
        {view.label}
      </Tag>
      <span className="text-[11px] text-slate-400 whitespace-nowrap">{localText}</span>
      <span className="block h-1 w-12 rounded-full bg-obsidian-800 overflow-hidden" aria-hidden="true">
        <span className="block h-full bg-emerald-500/80" style={{ width: `${view.pct}%` }} />
      </span>
    </span>
  );
}
