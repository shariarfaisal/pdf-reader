import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Activity,
  Coins,
  ArrowDownToLine,
  ArrowUpFromLine,
  Timer,
  AlertTriangle,
  RefreshCw,
  Download,
  Search,
  Hash,
  Layers
} from 'lucide-react';
import { Button } from './ui/Button';
import { Card } from './ui/Card';
import { Tag } from './ui/Badge';
import { MetricCard } from './ui/MetricCard';
import { ThemeToggle } from './ui/ThemeToggle';
import {
  formatUsd,
  formatTokens,
  formatDuration,
  formatDateTime,
  formatDayLabel,
  toDateInput,
  stageLabel
} from '../lib/format';

const PAGE_SIZE = 50;

const PRESETS = [
  { id: 'today', label: 'Today' },
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
  { id: '90d', label: '90 days' },
  { id: 'all', label: 'All time' },
  { id: 'custom', label: 'Custom' }
];

const STAGES = ['ocr', 'refiner', 'tts', 'other'];

/** Resolve a preset into inclusive `YYYY-MM-DD` bounds. */
function resolveRange(preset, customFrom, customTo) {
  const now = new Date();
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const shiftDays = (days) => {
    const d = startOfDay(now);
    d.setDate(d.getDate() - days);
    return d;
  };

  switch (preset) {
    case 'today':
      return { from: toDateInput(now), to: toDateInput(now) };
    case '7d':
      return { from: toDateInput(shiftDays(6)), to: toDateInput(now) };
    case '30d':
      return { from: toDateInput(shiftDays(29)), to: toDateInput(now) };
    case '90d':
      return { from: toDateInput(shiftDays(89)), to: toDateInput(now) };
    case 'custom':
      return { from: customFrom || '', to: customTo || '' };
    case 'all':
    default:
      return { from: '', to: '' };
  }
}

function buildQuery(range, filters, extra = {}) {
  const params = new URLSearchParams();
  if (range.from) params.set('from', range.from);
  if (range.to) params.set('to', range.to);
  if (filters.projectId) params.set('projectId', filters.projectId);
  if (filters.stage) params.set('stage', filters.stage);
  if (filters.status) params.set('status', filters.status);
  if (filters.model) params.set('model', filters.model);
  if (filters.q) params.set('q', filters.q);
  for (const [key, value] of Object.entries(extra)) {
    if (value !== null && value !== undefined && value !== '') params.set(key, value);
  }
  return params.toString();
}

function StatusPill({ status }) {
  const ok = status === 'ok';
  return (
    <Tag tone={ok ? 'emerald' : 'rose'} size="xs" dot={ok}>
      {ok ? 'OK' : 'Error'}
    </Tag>
  );
}

function FilterBar({ preset, setPreset, customFrom, setCustomFrom, customTo, setCustomTo, filters, setFilter, search, setSearch, projects, models }) {
  const selectClass =
    'bg-obsidian-800 border border-obsidian-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-brand-500';

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 bg-obsidian-900/80 border border-obsidian-700 rounded-lg p-1">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => setPreset(p.id)}
              className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                preset === p.id
                  ? 'bg-brand-500 text-obsidian-950 font-semibold'
                  : 'text-slate-400 hover:text-slate-100 hover:bg-obsidian-800'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {preset === 'custom' && (
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className={selectClass}
            />
            <span className="text-slate-500 text-xs">→</span>
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className={selectClass}
            />
          </div>
        )}

        <div className="flex-1" />

        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search model, stage, error…"
            className={`${selectClass} pl-8 w-56`}
          />
        </div>

        <select value={filters.projectId} onChange={(e) => setFilter('projectId', e.target.value)} className={selectClass}>
          <option value="">All projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>

        <select value={filters.stage} onChange={(e) => setFilter('stage', e.target.value)} className={selectClass}>
          <option value="">All stages</option>
          {STAGES.map((s) => (
            <option key={s} value={s}>
              {stageLabel(s)}
            </option>
          ))}
        </select>

        <select value={filters.model} onChange={(e) => setFilter('model', e.target.value)} className={selectClass}>
          <option value="">All models</option>
          {models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>

        <select value={filters.status} onChange={(e) => setFilter('status', e.target.value)} className={selectClass}>
          <option value="">All statuses</option>
          <option value="ok">Successful</option>
          <option value="error">Failed</option>
        </select>
      </div>
    </Card>
  );
}

function DailySpendChart({ days }) {
  const costOf = (day) => displayCost(day).value;
  const max = Math.max(...days.map(costOf), 0.000001);

  if (!days.length) {
    return (
      <Card className="p-4">
        <h3 className="text-sm font-semibold text-slate-200 mb-3">Daily spend</h3>
        <p className="text-xs text-slate-500 py-8 text-center">No calls in this range.</p>
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-slate-200">Daily spend</h3>
        <span className="text-[11px] text-slate-500 font-mono">
          peak {formatUsd(max, { precise: true })}
        </span>
      </div>
      <div className="flex items-end gap-1 h-32">
        {days.map((d) => {
          const cost = costOf(d);
          // Percentage heights need a fixed-height box; the label takes ~14px.
          const height = Math.max(3, Math.round((cost / max) * 100));
          return (
            <div key={d.day} className="flex-1 flex flex-col items-center justify-end gap-1 group min-w-0 h-full">
              <div className="flex-1 w-full flex items-end">
                <div
                  className="w-full bg-gradient-to-t from-brand-600/40 to-brand-400 rounded-t-sm transition-all group-hover:from-brand-500/60 group-hover:to-brand-300"
                  style={{ height: `${height}%` }}
                  title={`${d.day} · ${formatUsd(cost, { precise: true })}${
                    displayCost(d).isList ? ' (list price, not billed)' : ''
                  } · ${d.calls} calls · ${formatTokens(d.inputTokens)} in / ${formatTokens(d.outputTokens)} out`}
                />
              </div>
              <span className="text-[9px] text-slate-500 truncate w-full text-center">
                {formatDayLabel(d.day)}
              </span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function BreakdownTable({ title, rows, columns, emptyLabel }) {
  return (
    <Card className="p-0 overflow-hidden">
      <h3 className="text-sm font-semibold text-slate-200 px-4 py-3 border-b border-obsidian-700/80">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-xs text-slate-500 px-4 py-6 text-center">{emptyLabel}</p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-slate-500 text-[10px] uppercase tracking-wide">
              {columns.map((c) => (
                <th key={c.key} className={`px-4 py-2 font-medium ${c.align === 'right' ? 'text-right' : 'text-left'}`}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-obsidian-800">
            {rows.map((row, i) => (
              <tr key={`${title}-${i}`} className="hover:bg-obsidian-800/40">
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={`px-4 py-2 ${c.align === 'right' ? 'text-right font-mono' : 'text-left'} ${
                      c.strong ? 'text-slate-200' : 'text-slate-400'
                    } ${c.className || ''}`}
                  >
                    {c.render ? c.render(row) : row[c.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function PricingReference({ models }) {
  const rows = models.map((m) => ({
    model: m.model,
    rate: m.rate || { input: 0, output: 0, priced: false, exact: false }
  }));
  const anyDerived = rows.some(({ rate }) => rate.priced && rate.exact === false);

  return (
    <Card className="p-0 overflow-hidden">
      <h3 className="text-sm font-semibold text-slate-200 px-4 py-3 border-b border-obsidian-700/80">
        Pricing reference (USD / 1M tokens)
      </h3>
      {rows.length === 0 ? (
        <p className="text-xs text-slate-500 px-4 py-6 text-center">Prices appear once you have used a model.</p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-slate-500 text-[10px] uppercase tracking-wide">
              <th className="px-4 py-2 text-left font-medium">Model</th>
              <th className="px-4 py-2 text-right font-medium">Input</th>
              <th className="px-4 py-2 text-right font-medium">Output</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-obsidian-800">
            {rows.map(({ model, rate }) => (
              <tr key={model} className="hover:bg-obsidian-800/40">
                <td className="px-4 py-2 text-slate-200 font-mono truncate max-w-[220px]" title={model}>
                  {model}
                </td>
                <td className="px-4 py-2 text-right text-slate-400 font-mono">
                  {rate.priced ? `${rate.exact === false ? '≈ ' : ''}$${rate.input.toFixed(3)}` : 'unpriced'}
                </td>
                <td className="px-4 py-2 text-right text-slate-400 font-mono">
                  {rate.priced ? `${rate.exact === false ? '≈ ' : ''}$${rate.output.toFixed(3)}` : 'unpriced'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {anyDerived && (
        <p className="px-4 py-2 text-[10px] text-slate-500 border-t border-obsidian-800 leading-relaxed">
          ≈ derived from the model family — this exact version has no separate published tier.
        </p>
      )}
    </Card>
  );
}

/**
 * What a row is worth: the billed amount when it was billed, otherwise the list
 * price it represents (loopback / Antigravity-proxy calls are free to run, but
 * the tokens still carry a real cost at API rates).
 */
function displayCost(row = {}) {
  const billed = Number(row.costUsd ?? row.cost_usd) || 0;
  const list = Number(row.listCostUsd ?? row.list_cost_usd) || 0;
  if (billed > 0) return { value: billed, isList: false };
  if (list > 0) return { value: list, isList: true };
  return { value: 0, isList: false };
}

/** Shared cost cell: green = billed, amber + "list" = free endpoint, list price. */
function CostCell({ row }) {
  const { value, isList } = displayCost(row);
  return (
    <span
      className={`font-mono ${isList ? 'text-amber-700 dark:text-amber-300/90' : 'text-emerald-700 dark:text-emerald-400'}`}
      title={
        isList
          ? 'Not billed (local proxy / free endpoint) — shown at API list price'
          : 'Billed'
      }
    >
      {formatUsd(value, { precise: true })}
      {isList ? <span className="ml-1 text-[9px] uppercase tracking-wide text-amber-700 dark:text-amber-400">list</span> : null}
    </span>
  );
}

export function ApiUsageDashboard({ projects = [], onBack, embedded = false }) {
  const [preset, setPreset] = useState('7d');
  const [customFrom, setCustomFrom] = useState(toDateInput(new Date()));
  const [customTo, setCustomTo] = useState(toDateInput(new Date()));
  const [filters, setFilters] = useState({ projectId: '', stage: '', status: '', model: '', q: '' });
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [summary, setSummary] = useState(null);
  const [logPage, setLogPage] = useState({ rows: [], total: 0, limit: PAGE_SIZE, offset: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const range = useMemo(() => resolveRange(preset, customFrom, customTo), [preset, customFrom, customTo]);

  // Debounce the free-text search so typing does not hammer the API.
  useEffect(() => {
    const id = setTimeout(() => {
      setFilters((prev) => (prev.q === search ? prev : { ...prev, q: search }));
      setPage(0);
    }, 300);
    return () => clearTimeout(id);
  }, [search]);

  const setFilter = useCallback((key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(0);
  }, []);

  const load = useCallback(
    async (signal) => {
      setIsLoading(true);
      try {
        const summaryQs = buildQuery(range, filters);
        const logsQs = buildQuery(range, filters, { limit: PAGE_SIZE, offset: page * PAGE_SIZE });
        const [summaryRes, logsRes] = await Promise.all([
          fetch(`/api/usage/summary?${summaryQs}`, { signal }),
          fetch(`/api/usage/logs?${logsQs}`, { signal })
        ]);
        if (!summaryRes.ok || !logsRes.ok) throw new Error('Failed to load API usage data');
        const summaryData = await summaryRes.json();
        const logsData = await logsRes.json();
        setSummary(summaryData);
        setLogPage(logsData);
        setError(null);
      } catch (err) {
        if (err.name !== 'AbortError') setError(err.message);
      } finally {
        if (!signal?.aborted) setIsLoading(false);
      }
    },
    [range, filters, page]
  );

  // Refetch on filter change, and keep the numbers live while the pipeline runs.
  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    const interval = setInterval(() => load(controller.signal), 15000);
    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [load]);

  const totals = summary?.totals || {};
  const byDay = summary?.byDay || [];
  const byModel = summary?.byModel || [];
  const byStage = summary?.byStage || [];
  const byProject = summary?.byProject || [];
  const errorRate = totals.calls > 0 ? Math.round((totals.errorCalls / totals.calls) * 100) : 0;
  // Provider prefix/implicit cache reads, as a share of all input tokens.
  const cacheHitRate =
    totals.inputTokens > 0 ? Math.round(((totals.cachedTokens || 0) / totals.inputTokens) * 100) : 0;
  const totalPages = Math.max(1, Math.ceil((logPage.total || 0) / PAGE_SIZE));

  const exportHref = `/api/usage/export.csv?${buildQuery(range, filters)}`;

  const content = (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight text-slate-100">
            API Usage & Accounting
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Every OCR and narration call tracked with token counts, latency, and cost basis.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="xs" icon={RefreshCw} onClick={() => load()} isLoading={isLoading}>
            Refresh
          </Button>
          <a href={exportHref} download>
            <Button variant="secondary" size="xs" icon={Download}>
              Export CSV
            </Button>
          </a>
        </div>
      </div>

      <FilterBar
        preset={preset}
        setPreset={(p) => {
          setPreset(p);
          setPage(0);
        }}
        customFrom={customFrom}
        setCustomFrom={setCustomFrom}
        customTo={customTo}
        setCustomTo={setCustomTo}
        filters={filters}
        setFilter={setFilter}
        search={search}
        setSearch={setSearch}
        projects={projects}
        models={byModel.map((m) => m.model)}
      />

      {error && (
        <div className="flex items-center gap-2 text-xs text-rose-400 bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3 mt-4">
        <MetricCard label="Total spend" value={formatUsd(totals.costUsd, { precise: true })} hint="Billed only (local proxy = $0)" icon={Coins} accent="emerald" />
        <MetricCard label="List-price value" value={formatUsd(totals.listCostUsd, { precise: true })} hint="What these tokens cost at API rates" icon={Coins} accent="amber" />
        <MetricCard label="API calls" value={formatTokens(totals.calls)} hint={`${totals.okCalls || 0} ok · ${totals.errorCalls || 0} failed`} icon={Hash} accent="brand" />
        <MetricCard label="Input tokens" value={formatTokens(totals.inputTokens)} hint={`Total ${formatTokens(totals.totalTokens)} tokens`} icon={ArrowDownToLine} accent="violet" />
        <MetricCard label="Cache reads" value={formatTokens(totals.cachedTokens)} hint={cacheHitRate > 0 ? `${cacheHitRate}% of input tokens were cache hits` : 'No provider cache hits yet'} icon={Layers} accent="brand" />
        <MetricCard label="Output tokens" value={formatTokens(totals.outputTokens)} hint={totals.estimatedCalls > 0 ? `${totals.estimatedCalls} estimated` : 'Reported by provider'} icon={ArrowUpFromLine} accent="violet" />
        <MetricCard label="Avg latency" value={formatDuration(totals.avgLatencyMs)} hint={`Max ${formatDuration(totals.maxLatencyMs)}`} icon={Timer} accent="slate" />
        <MetricCard label="Error rate" value={`${errorRate}%`} hint={`${totals.errorCalls || 0} failed calls`} icon={AlertTriangle} accent={errorRate > 0 ? 'rose' : 'slate'} />
        <MetricCard label="Range" value={preset === 'all' ? 'All time' : `${range.from || '—'} → ${range.to || '—'}`} hint="Filters apply to all metrics" icon={Activity} accent="slate" />
      </div>

      <DailySpendChart days={byDay} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <BreakdownTable
          title="By model"
          rows={byModel}
          emptyLabel="No calls yet."
          columns={[
            { key: 'model', label: 'Model', strong: true },
            { key: 'calls', label: 'Calls', align: 'right' },
            { key: 'inputTokens', label: 'In', align: 'right', render: (r) => formatTokens(r.inputTokens) },
            { key: 'cachedTokens', label: 'Cached', align: 'right', render: (r) => formatTokens(r.cachedTokens) },
            { key: 'outputTokens', label: 'Out', align: 'right', render: (r) => formatTokens(r.outputTokens) },
            { key: 'costUsd', label: 'Cost', align: 'right', render: (r) => <CostCell row={r} /> }
          ]}
        />
        <BreakdownTable
          title="By stage"
          rows={byStage}
          emptyLabel="No calls yet."
          columns={[
            { key: 'stage', label: 'Stage', strong: true, render: (r) => stageLabel(r.stage) },
            { key: 'calls', label: 'Calls', align: 'right' },
            { key: 'tokens', label: 'Tokens', align: 'right', render: (r) => formatTokens(r.inputTokens + r.outputTokens) },
            { key: 'cachedTokens', label: 'Cached', align: 'right', render: (r) => formatTokens(r.cachedTokens) },
            { key: 'avgLatencyMs', label: 'Avg', align: 'right', render: (r) => formatDuration(r.avgLatencyMs) },
            { key: 'costUsd', label: 'Cost', align: 'right', render: (r) => <CostCell row={r} /> }
          ]}
        />
        <BreakdownTable
          title="By project"
          rows={byProject}
          emptyLabel="No calls yet."
          columns={[
            { key: 'projectName', label: 'Project', strong: true },
            { key: 'calls', label: 'Calls', align: 'right' },
            { key: 'inputTokens', label: 'In', align: 'right', render: (r) => formatTokens(r.inputTokens) },
            { key: 'cachedTokens', label: 'Cached', align: 'right', render: (r) => formatTokens(r.cachedTokens) },
            { key: 'outputTokens', label: 'Out', align: 'right', render: (r) => formatTokens(r.outputTokens) },
            { key: 'costUsd', label: 'Cost', align: 'right', render: (r) => <CostCell row={r} /> }
          ]}
        />
        <PricingReference models={byModel} />
      </div>

      {/* Log table */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
            <span>Call History</span>
            <span className="text-xs text-slate-400 font-mono">({logPage.total} calls)</span>
          </h3>
          <div className="flex items-center gap-1.5 text-xs text-slate-400 font-mono">
            <span>Page {page + 1} of {totalPages}</span>
            <Button
              variant="ghost"
              size="icon-xs"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              ←
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              disabled={page + 1 >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              →
            </Button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="border-b border-obsidian-750 text-[11px] text-slate-400">
                <th className="py-2 px-3 font-medium">Time</th>
                <th className="py-2 px-3 font-medium">Project</th>
                <th className="py-2 px-2 font-medium text-right">Page</th>
                <th className="py-2 px-3 font-medium">Stage</th>
                <th className="py-2 px-3 font-medium">Model</th>
                <th className="py-2 px-3 font-medium text-right">Tokens In</th>
                <th className="py-2 px-3 font-medium text-right">Cached</th>
                <th className="py-2 px-3 font-medium text-right">Tokens Out</th>
                <th className="py-2 px-3 font-medium text-right">Cost</th>
                <th className="py-2 px-3 font-medium text-right">Latency</th>
                <th className="py-2 px-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-obsidian-750/60 font-mono text-[11.5px]">
              {logPage.rows.map((row) => (
                <tr key={row.id} className="hover:bg-obsidian-750/30">
                  <td className="py-2 px-3 text-slate-400 whitespace-nowrap">{formatDateTime(row.ts)}</td>
                  <td className="py-2 px-3 font-sans text-slate-200 truncate max-w-[140px]">{row.project_name || '—'}</td>
                  <td className="py-2 px-2 text-right text-slate-400">{row.page_number !== null ? row.page_number + 1 : '—'}</td>
                  <td className="py-2 px-3 font-sans text-slate-300">{stageLabel(row.stage)}</td>
                  <td className="py-2 px-3 text-slate-300 truncate max-w-[140px]">{row.model}</td>
                  <td className="py-2 px-3 text-right text-slate-400">{formatTokens(row.input_tokens)}</td>
                  <td className="py-2 px-3 text-right text-emerald-400/70">{row.cached_tokens ? formatTokens(row.cached_tokens) : '—'}</td>
                  <td className="py-2 px-3 text-right text-slate-400">{formatTokens(row.output_tokens)}</td>
                  <td className="py-2 px-3 text-right text-slate-200"><CostCell row={row} /></td>
                  <td className="py-2 px-3 text-right text-slate-400">{formatDuration(row.latency_ms)}</td>
                  <td className="py-2 px-3"><StatusPill status={row.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );

  if (embedded) {
    return content;
  }

  return (
    <div className="min-h-screen flex flex-col bg-app text-slate-100">
      <header className="sticky top-0 z-30 border-b border-obsidian-700/80 bg-obsidian-850/95 backdrop-blur-md">
        <div className="max-w-[1280px] mx-auto px-4 sm:px-6 md:px-8 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            {onBack && (
              <Button
                variant="ghost"
                size="sm"
                icon={ArrowLeft}
                onClick={onBack}
                className="text-slate-300"
              >
                Library
              </Button>
            )}
            <span className="text-slate-500 font-normal">/</span>
            <span className="text-sm font-semibold text-slate-100 truncate">
              Usage
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" icon={RefreshCw} onClick={() => load()} isLoading={isLoading}>
              Refresh
            </Button>
            <a href={exportHref} download>
              <Button variant="secondary" size="sm" icon={Download}>
                Export CSV
              </Button>
            </a>
            <div className="h-4 w-px bg-obsidian-700/60 mx-1" aria-hidden="true" />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-[1280px] mx-auto px-4 sm:px-6 md:px-8 py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
            API Usage & Accounting
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Every OCR and narration call tracked with token counts, latency, and cost basis.
          </p>
        </div>

      <FilterBar
        preset={preset}
        setPreset={(p) => {
          setPreset(p);
          setPage(0);
        }}
        customFrom={customFrom}
        setCustomFrom={setCustomFrom}
        customTo={customTo}
        setCustomTo={setCustomTo}
        filters={filters}
        setFilter={setFilter}
        search={search}
        setSearch={setSearch}
        projects={projects}
        models={byModel.map((m) => m.model)}
      />

      {error && (
        <div className="mt-4 flex items-center gap-2 text-xs text-rose-400 bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2">
          <AlertTriangle className="w-4 h-4" />
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3 mt-4">
        <MetricCard label="Total spend" value={formatUsd(totals.costUsd, { precise: true })} hint="Billed only (local proxy = $0)" icon={Coins} accent="emerald" />
        <MetricCard label="List-price value" value={formatUsd(totals.listCostUsd, { precise: true })} hint="What these tokens cost at API rates" icon={Coins} accent="amber" />
        <MetricCard label="API calls" value={formatTokens(totals.calls)} hint={`${totals.okCalls || 0} ok · ${totals.errorCalls || 0} failed`} icon={Hash} accent="brand" />
        <MetricCard label="Input tokens" value={formatTokens(totals.inputTokens)} hint={`Total ${formatTokens(totals.totalTokens)} tokens`} icon={ArrowDownToLine} accent="violet" />
        <MetricCard label="Cache reads" value={formatTokens(totals.cachedTokens)} hint={cacheHitRate > 0 ? `${cacheHitRate}% of input tokens were cache hits` : 'No provider cache hits yet'} icon={Layers} accent="brand" />
        <MetricCard label="Output tokens" value={formatTokens(totals.outputTokens)} hint={totals.estimatedCalls > 0 ? `${totals.estimatedCalls} estimated` : 'Reported by provider'} icon={ArrowUpFromLine} accent="violet" />
        <MetricCard label="Avg latency" value={formatDuration(totals.avgLatencyMs)} hint={`Max ${formatDuration(totals.maxLatencyMs)}`} icon={Timer} accent="slate" />
        <MetricCard label="Error rate" value={`${errorRate}%`} hint={`${totals.errorCalls || 0} failed calls`} icon={AlertTriangle} accent={errorRate > 0 ? 'rose' : 'slate'} />
        <MetricCard label="Range" value={preset === 'all' ? 'All time' : `${range.from || '—'} → ${range.to || '—'}`} hint="Filters apply to all metrics" icon={Activity} accent="slate" />
      </div>

      <div className="mt-4">
        <DailySpendChart days={byDay} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
        <BreakdownTable
          title="By model"
          rows={byModel}
          emptyLabel="No calls yet."
          columns={[
            { key: 'model', label: 'Model', strong: true },
            { key: 'calls', label: 'Calls', align: 'right' },
            { key: 'inputTokens', label: 'In', align: 'right', render: (r) => formatTokens(r.inputTokens) },
            { key: 'cachedTokens', label: 'Cached', align: 'right', render: (r) => formatTokens(r.cachedTokens) },
            { key: 'outputTokens', label: 'Out', align: 'right', render: (r) => formatTokens(r.outputTokens) },
            { key: 'costUsd', label: 'Cost', align: 'right', render: (r) => <CostCell row={r} /> }
          ]}
        />
        <BreakdownTable
          title="By stage"
          rows={byStage}
          emptyLabel="No calls yet."
          columns={[
            { key: 'stage', label: 'Stage', strong: true, render: (r) => stageLabel(r.stage) },
            { key: 'calls', label: 'Calls', align: 'right' },
            { key: 'tokens', label: 'Tokens', align: 'right', render: (r) => formatTokens(r.inputTokens + r.outputTokens) },
            { key: 'cachedTokens', label: 'Cached', align: 'right', render: (r) => formatTokens(r.cachedTokens) },
            { key: 'avgLatencyMs', label: 'Avg', align: 'right', render: (r) => formatDuration(r.avgLatencyMs) },
            { key: 'costUsd', label: 'Cost', align: 'right', render: (r) => <CostCell row={r} /> }
          ]}
        />
        <BreakdownTable
          title="By project"
          rows={byProject}
          emptyLabel="No calls yet."
          columns={[
            { key: 'projectName', label: 'Project', strong: true },
            { key: 'calls', label: 'Calls', align: 'right' },
            { key: 'inputTokens', label: 'In', align: 'right', render: (r) => formatTokens(r.inputTokens) },
            { key: 'cachedTokens', label: 'Cached', align: 'right', render: (r) => formatTokens(r.cachedTokens) },
            { key: 'outputTokens', label: 'Out', align: 'right', render: (r) => formatTokens(r.outputTokens) },
            { key: 'costUsd', label: 'Cost', align: 'right', render: (r) => <CostCell row={r} /> }
          ]}
        />
        <PricingReference models={byModel} />
      </div>

      <Card className="mt-4 p-0 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-obsidian-700/80">
          <h3 className="text-sm font-semibold text-slate-200">Call log</h3>
          <div className="flex items-center gap-2 text-[11px] text-slate-500 font-mono">
            <span>
              {logPage.total > 0 ? `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, logPage.total)} of ${logPage.total}` : '0 of 0'}
            </span>
            <Button variant="ghost" size="xs" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
              Prev
            </Button>
            <Button variant="ghost" size="xs" disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-obsidian-900/60 text-[10px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Time</th>
                <th className="px-4 py-2 text-left font-medium">Project</th>
                <th className="px-3 py-2 text-right font-medium">Page</th>
                <th className="px-3 py-2 text-left font-medium">Stage</th>
                <th className="px-3 py-2 text-left font-medium">Model</th>
                <th className="px-3 py-2 text-right font-medium">In</th>
                <th className="px-3 py-2 text-right font-medium">Cached</th>
                <th className="px-3 py-2 text-right font-medium">Out</th>
                <th className="px-3 py-2 text-right font-medium">Cost</th>
                <th className="px-3 py-2 text-right font-medium">Latency</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-obsidian-800">
              {logPage.rows.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-4 py-10 text-center text-slate-500">
                    No API calls logged for this filter yet.
                  </td>
                </tr>
              )}
              {logPage.rows.map((row) => (
                <tr key={row.id} className="hover:bg-obsidian-800/40">
                  <td className="px-4 py-2 text-slate-400 whitespace-nowrap font-mono">{formatDateTime(row.ts)}</td>
                  <td className="px-4 py-2 text-slate-300 max-w-[180px] truncate" title={row.project_name || row.project_id || ''}>
                    {row.project_name || row.project_id || '—'}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-400 font-mono">
                    {row.page_number === null || row.page_number === undefined ? '—' : row.page_number + 1}
                  </td>
                  <td className="px-3 py-2 text-slate-300 whitespace-nowrap">{stageLabel(row.stage)}</td>
                  <td className="px-3 py-2 text-slate-400 font-mono truncate max-w-[160px]" title={row.model}>
                    {row.model}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-300 font-mono">
                    {formatTokens(row.input_tokens)}
                    {row.estimated ? <span className="text-amber-500/80 ml-1" title="Estimated (provider returned no usage)">*</span> : null}
                  </td>
                  <td className="px-3 py-2 text-right text-emerald-400/70 font-mono">
                    {row.cached_tokens ? formatTokens(row.cached_tokens) : '—'}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-300 font-mono">{formatTokens(row.output_tokens)}</td>
                  <td className="px-3 py-2 text-right">
                    <CostCell row={row} />
                  </td>
                  <td className="px-3 py-2 text-right text-slate-400 font-mono">{formatDuration(row.latency_ms)}</td>
                  <td className="px-3 py-2">
                    <StatusPill status={row.status} />
                    {row.error && (
                      <span className="block text-[10px] text-rose-400/80 truncate max-w-[220px]" title={row.error}>
                        {row.error}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      </main>
    </div>
  );
}
