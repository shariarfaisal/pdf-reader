import React, { useEffect, useState } from 'react';
import { Share2, Copy, Check, Link2Off, Link } from 'lucide-react';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';

async function requestJson(method, url) {
  const res = await fetch(url, { method });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Button size="icon-sm" variant="ghost" title="Copy link" aria-label="Copy link" onClick={copy}>
      {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
    </Button>
  );
}

/**
 * Creates or revokes a read-only listen link for a project. The link opens a
 * mobile player on the same Wi-Fi network (served on the share port).
 */
export function ShareProjectModal({ isOpen, onClose, projectId, projectName }) {
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    requestJson('GET', `/api/projects/${projectId}/share`)
      .then(setInfo)
      .catch((err) => setError(err.message));
  }, [isOpen, projectId]);

  const run = async (method) => {
    setBusy(true);
    setError(null);
    try {
      setInfo(await requestJson(method, `/api/projects/${projectId}/share`));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const links = info?.enabled ? (info.urls.length ? info.urls : [info.localUrl]) : [];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Share for listening"
      subtitle={projectName}
      icon={Share2}
      maxWidth="max-w-lg"
    >
      <div className="space-y-4 text-sm text-slate-300">
        <p className="text-slate-400">
          Open the link on your iPhone while it is on the same Wi-Fi as this Mac. Anyone with the link can listen
          to the narrated pages; nothing else is exposed.
        </p>

        {links.length > 0 && (
          <ul className="space-y-2">
            {links.map((url) => (
              <li
                key={url}
                className="flex items-center gap-2 rounded-xl border border-obsidian-700 bg-obsidian-800/60 px-3 py-2"
              >
                <Link className="w-4 h-4 shrink-0 text-slate-500" />
                <code className="min-w-0 flex-1 truncate font-mono text-xs text-slate-200">{url}</code>
                <CopyButton text={url} />
              </li>
            ))}
          </ul>
        )}

        {info?.enabled && info.urls.length === 0 && (
          <p className="text-amber-400">No LAN address found. Connect this Mac to Wi-Fi to share with a phone.</p>
        )}

        {error && <p className="text-red-400">{error}</p>}

        <div className="flex flex-wrap gap-2 pt-1">
          {!info?.enabled ? (
            <Button variant="primary" disabled={busy || !info} onClick={() => run('POST')}>
              <Link className="w-4 h-4" />
              Create listen link
            </Button>
          ) : (
            <Button variant="danger" disabled={busy} onClick={() => run('DELETE')}>
              <Link2Off className="w-4 h-4" />
              Revoke link
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
