import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, Check, Copy, Terminal, Trash2 } from 'lucide-react';
import { Section } from '../ui/Section';

const LEVEL_STYLE = {
  error: { text: 'text-rose-300', row: 'border-rose-500/70 bg-rose-500/[0.06]' },
  warn: { text: 'text-amber-300', row: 'border-amber-500/70 bg-amber-500/[0.05]' },
  info: { text: 'text-slate-300', row: 'border-transparent' }
};

const PAGE_PREFIX = /^\[Page (\d+)\]\s*/;

const formatTime = (timestamp) => new Date(timestamp).toLocaleTimeString([], { hour12: false });

function LogRow({ log, onSelectPage }) {
  const style = LEVEL_STYLE[log.level] || LEVEL_STYLE.info;
  const match = PAGE_PREFIX.exec(log.message);
  const pageNumber = match ? Number(match[1]) : null;
  const message = match ? log.message.slice(match[0].length) : log.message;

  return (
    <div className={`grid grid-cols-[auto_1fr] gap-x-2 border-l-2 px-3 py-1 ${style.row}`}>
      <span className="text-slate-600 tabular-nums select-none">{formatTime(log.timestamp)}</span>
      <span className={`break-words ${style.text}`}>
        {pageNumber !== null && (
          <button
            type="button"
            onClick={() => onSelectPage?.(pageNumber - 1)}
            title={`Jump to page ${pageNumber}`}
            className="mr-1.5 rounded bg-obsidian-800 px-1 py-px text-[10px] text-brand-300 hover:bg-obsidian-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/60"
          >
            P{pageNumber}
          </button>
        )}
        {message}
      </span>
    </div>
  );
}

export function LogConsole({ logs, onClear, onSelectPage }) {
  const scrollRef = useRef(null);
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [stuck, setStuck] = useState(true); // follow the tail unless the user scrolled up
  const [copied, setCopied] = useState(false);

  const issueCount = useMemo(() => logs.filter((l) => l.level === 'warn' || l.level === 'error').length, [logs]);
  const visible = useMemo(
    () => (onlyIssues ? logs.filter((l) => l.level === 'warn' || l.level === 'error') : logs),
    [logs, onlyIssues]
  );
  const tail = visible[visible.length - 1];

  useEffect(() => {
    const el = scrollRef.current;
    if (stuck && el) el.scrollTop = el.scrollHeight;
  }, [tail, visible.length, stuck]);

  // The section unmounts when collapsed: land on the tail again when reopened.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleScroll = () => {
    const el = scrollRef.current;
    setStuck(el.scrollHeight - el.scrollTop - el.clientHeight < 24);
  };

  const jumpToLatest = () => {
    setStuck(true);
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  };

  const copyAll = async () => {
    const text = visible.map((l) => `[${formatTime(l.timestamp)}] ${l.level?.toUpperCase() || 'INFO'} ${l.message}`).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const iconBtn =
    'p-1.5 rounded-md text-slate-500 hover:text-slate-200 hover:bg-obsidian-800 disabled:opacity-40 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/60';

  const headerActions = (
    <>
      <button
        type="button"
        aria-pressed={onlyIssues}
        onClick={() => setOnlyIssues((v) => !v)}
        className={`rounded-md px-2 py-1 text-[10px] font-medium border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/60 ${
          onlyIssues
            ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
            : 'border-transparent text-slate-500 hover:text-slate-200 hover:bg-obsidian-800'
        }`}
      >
        Issues{issueCount > 0 ? ` · ${issueCount}` : ''}
      </button>
      <button type="button" onClick={copyAll} disabled={visible.length === 0} className={iconBtn} aria-label="Copy logs" title="Copy logs">
        {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
      <button type="button" onClick={onClear} disabled={logs.length === 0} className={iconBtn} aria-label="Clear logs" title="Clear logs">
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </>
  );

  return (
    <Section
      id="inspector-logs"
      icon={Terminal}
      iconClassName="text-brand-400"
      title="Logs"
      meta={<span className="font-mono tabular-nums text-slate-500">{logs.length}</span>}
      action={headerActions}
      className="flex-1 min-h-0"
      bodyClassName="flex flex-1 min-h-[220px] min-w-0 flex-col bg-obsidian-950"
    >
      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          role="log"
          aria-live="off"
          className="absolute inset-0 overflow-y-auto overscroll-contain py-2 font-mono text-[11px] leading-relaxed select-text"
        >
          {visible.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-8 text-center text-slate-600">
              <Terminal className="w-5 h-5" aria-hidden="true" />
              <p>{logs.length === 0 ? 'No pipeline logs yet. Press Start or Step 1.' : 'No warnings or errors. Nice.'}</p>
            </div>
          ) : (
            visible.map((log, idx) => <LogRow key={`${log.timestamp}-${idx}`} log={log} onSelectPage={onSelectPage} />)
          )}
        </div>

        {!stuck && visible.length > 0 && (
          <button
            type="button"
            onClick={jumpToLatest}
            className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1 rounded-full border border-brand-500/40 bg-obsidian-850/95 px-3 py-1 text-[11px] font-medium text-brand-300 shadow-lg shadow-black/40 hover:bg-obsidian-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/60"
          >
            <ArrowDown className="w-3 h-3" aria-hidden="true" />
            Latest
          </button>
        )}
      </div>
    </Section>
  );
}
