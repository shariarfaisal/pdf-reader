import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Replace, Wand2, AlertTriangle, Check } from 'lucide-react';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { TextInput } from './ui/Field';

const CONTROL =
  'w-full bg-obsidian-950/80 border border-obsidian-700 rounded-lg px-2.5 h-8 text-xs text-slate-200 focus:outline-none focus:border-brand-400';

/** One rule row: "replace [find] with [replace]". */
function RuleRow({ rule, scopeLabel, onSave, onDelete, busy }) {
  const [find, setFind] = useState(rule.find);
  const [replace, setReplace] = useState(rule.replace);

  useEffect(() => {
    setFind(rule.find);
    setReplace(rule.replace);
  }, [rule.id, rule.find, rule.replace]);

  const dirty = find !== rule.find || replace !== rule.replace;

  return (
    <li className="rounded-lg border border-obsidian-800 bg-obsidian-900/50 p-2.5">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="text-[10px] font-mono uppercase tracking-wide text-slate-500">replace</span>
        <div className="flex items-center gap-1.5">
          <span className="rounded border border-obsidian-700 bg-obsidian-950 px-1.5 h-5 inline-flex items-center text-[10px] text-slate-400">
            {scopeLabel}
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={Boolean(rule.enabled)}
            aria-label={rule.enabled ? 'Disable rule' : 'Enable rule'}
            onClick={() => onSave({ enabled: !rule.enabled })}
            disabled={busy}
            className={`h-5 w-9 rounded-full transition relative ${
              rule.enabled ? 'bg-emerald-500/70' : 'bg-obsidian-700'
            }`}
            title={rule.enabled ? 'Rule is on' : 'Rule is off'}
          >
            <span
              className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
                rule.enabled ? 'left-4.5' : 'left-0.5'
              }`}
            />
          </button>
          <button
            type="button"
            onClick={() => onDelete(rule)}
            disabled={busy}
            className="p-1 rounded text-slate-500 hover:text-rose-300 hover:bg-rose-500/10 transition"
            title="Delete rule"
            aria-label="Delete rule"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <label className="block">
          <span className="sr-only">Text to find</span>
          <textarea
            value={find}
            onChange={(e) => setFind(e.target.value)}
            rows={2}
            spellCheck={false}
            placeholder="text to find"
            className={`${CONTROL} h-auto py-1.5 leading-relaxed resize-y`}
          />
        </label>
        <label className="block">
          <span className="sr-only">Replacement text</span>
          <textarea
            value={replace}
            onChange={(e) => setReplace(e.target.value)}
            rows={2}
            spellCheck={false}
            placeholder="replace with (empty = delete)"
            className={`${CONTROL} h-auto py-1.5 leading-relaxed resize-y`}
          />
        </label>
      </div>

      <div className="mt-1.5 flex items-center justify-between gap-2">
        <label className="inline-flex items-center gap-1.5 text-[10px] text-slate-400">
          <input
            type="checkbox"
            checked={Boolean(rule.is_regex)}
            onChange={(e) => onSave({ isRegex: e.target.checked })}
            disabled={busy}
            className="accent-brand-500"
          />
          regex
        </label>
        {dirty && (
          <Button
            size="xs"
            variant="secondary"
            icon={Check}
            isLoading={busy}
            onClick={() => onSave({ find, replace })}
          >
            Save
          </Button>
        )}
      </div>
    </li>
  );
}

/**
 * Find/replace rules for a project and for the page currently on screen.
 * Rules rewrite the narration script (what is displayed and narrated) — never
 * the raw OCR layer — and can be applied to pages already processed.
 */
export function TextRulesModal({
  isOpen,
  onClose,
  project,
  pageNumber,
  onApplied
}) {
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [applyScope, setApplyScope] = useState('project');

  const [scope, setScope] = useState('project');
  const [find, setFind] = useState('');
  const [replace, setReplace] = useState('');
  const [isRegex, setIsRegex] = useState(false);

  const projectId = project?.id;

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/rules`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load replacement rules');
      setRules(data.rules || []);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (!isOpen) return;
    setNotice(null);
    setError(null);
    setFind('');
    setReplace('');
    setIsRegex(false);
    setScope(pageNumber !== null && pageNumber !== undefined ? 'page' : 'project');
    load();
  }, [isOpen, load, pageNumber]);

  const projectRules = useMemo(() => rules.filter((rule) => rule.page_number === null), [rules]);
  const pageRules = useMemo(
    () => rules.filter((rule) => rule.page_number !== null && rule.page_number === pageNumber),
    [rules, pageNumber]
  );
  const otherPageRuleCount = useMemo(
    () => rules.filter((rule) => rule.page_number !== null && rule.page_number !== pageNumber).length,
    [rules, pageNumber]
  );

  const mutate = async (rule, patch) => {
    setBusy(rule.id);
    try {
      const res = await fetch(`/api/projects/${projectId}/rules/${rule.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not update the rule');
      setRules(data.rules || []);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const remove = async (rule) => {
    setBusy(rule.id);
    try {
      const res = await fetch(`/api/projects/${projectId}/rules/${rule.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not delete the rule');
      setRules(data.rules || []);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const addRule = async (e) => {
    e.preventDefault();
    if (!find.trim()) {
      setError('Enter the text to replace first.');
      return;
    }
    setBusy('new');
    try {
      const res = await fetch(`/api/projects/${projectId}/rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          find,
          replace,
          isRegex,
          pageNumber: scope === 'page' ? pageNumber : null
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not add the rule');
      setRules(data.rules || []);
      setFind('');
      setReplace('');
      setIsRegex(false);
      setError(null);
      setNotice('Rule saved. Apply it to existing pages to hear the change.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const applyRules = async () => {
    setBusy('apply');
    try {
      const payload = applyScope === 'page' && pageNumber !== null && pageNumber !== undefined
        ? { pageNumbers: [pageNumber] }
        : {};
      const res = await fetch(`/api/projects/${projectId}/rules/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not apply the rules');
      setNotice(
        data.changed
          ? `${data.changed} script${data.changed === 1 ? '' : 's'} rewritten` +
            (data.audioCleared ? ` · ${data.audioCleared} audio file(s) queued for re-synthesis` : '')
          : 'Nothing to change — every processed script already has these rules.'
      );
      setError(null);
      onApplied?.(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Text replacements"
      subtitle="Find and replace inside the narration script — whole project or just this page."
      icon={Replace}
      maxWidth="max-w-3xl"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-slate-400">Apply to</span>
            <select
              value={applyScope}
              onChange={(e) => setApplyScope(e.target.value)}
              className={`${CONTROL} w-auto`}
            >
              <option value="project">every processed page</option>
              <option value="page">this page only</option>
            </select>
            <Button size="sm" variant="secondary" icon={Wand2} onClick={applyRules} isLoading={busy === 'apply'}>
              Apply rules
            </Button>
          </div>
          <Button size="sm" variant="primary" onClick={onClose}>
            Done
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {error && (
          <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[11.5px] text-rose-200">
            {error}
          </p>
        )}
        {notice && (
          <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[11.5px] text-emerald-200">
            {notice}
          </p>
        )}

        <form onSubmit={addRule} className="rounded-xl border border-obsidian-700 bg-obsidian-900/60 p-3">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-300">New rule</span>
            <div className="flex rounded-lg border border-obsidian-700 bg-obsidian-950 p-0.5 text-[11px]">
              <button
                type="button"
                onClick={() => setScope('project')}
                className={`h-6 px-2 rounded ${scope === 'project' ? 'bg-brand-500/25 text-brand-300' : 'text-slate-400'}`}
              >
                Whole project
              </button>
              <button
                type="button"
                onClick={() => setScope('page')}
                disabled={pageNumber === null || pageNumber === undefined}
                className={`h-6 px-2 rounded disabled:opacity-40 ${
                  scope === 'page' ? 'bg-brand-500/25 text-brand-300' : 'text-slate-400'
                }`}
              >
                Page {(pageNumber ?? 0) + 1} only
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <TextInput
              value={find}
              onChange={(e) => setFind(e.target.value)}
              placeholder="find, e.g. (সাঃ)"
              spellCheck={false}
            />
            <TextInput
              value={replace}
              onChange={(e) => setReplace(e.target.value)}
              placeholder="replace with, e.g. সাল্লাল্লাহু আলাইহি ওয়া সাল্লাম"
              spellCheck={false}
            />
          </div>

          <div className="mt-2 flex items-center justify-between gap-2">
            <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-400">
              <input
                type="checkbox"
                checked={isRegex}
                onChange={(e) => setIsRegex(e.target.checked)}
                className="accent-brand-500"
              />
              treat “find” as a regular expression
            </label>
            <Button type="submit" size="sm" variant="primary" icon={Plus} isLoading={busy === 'new'}>
              Add rule
            </Button>
          </div>
        </form>

        <section>
          <h4 className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-300">
            Whole project
            <span className="rounded bg-obsidian-800 px-1.5 text-[10px] font-normal text-slate-400">
              {projectRules.length}
            </span>
          </h4>
          {projectRules.length === 0 ? (
            <p className="rounded-lg border border-dashed border-obsidian-700 px-3 py-2 text-[11px] text-slate-500">
              No project-wide rules yet — they run on every page in this book.
            </p>
          ) : (
            <ul className="space-y-2">
              {projectRules.map((rule) => (
                <RuleRow
                  key={rule.id}
                  rule={rule}
                  scopeLabel="project"
                  onSave={(patch) => mutate(rule, patch)}
                  onDelete={remove}
                  busy={busy === rule.id}
                />
              ))}
            </ul>
          )}
        </section>

        <section>
          <h4 className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-300">
            Page {(pageNumber ?? 0) + 1}
            <span className="rounded bg-obsidian-800 px-1.5 text-[10px] font-normal text-slate-400">
              {pageRules.length}
            </span>
          </h4>
          {pageRules.length === 0 ? (
            <p className="rounded-lg border border-dashed border-obsidian-700 px-3 py-2 text-[11px] text-slate-500">
              No rules for this page. Page rules run after the project rules.
            </p>
          ) : (
            <ul className="space-y-2">
              {pageRules.map((rule) => (
                <RuleRow
                  key={rule.id}
                  rule={rule}
                  scopeLabel={`page ${(rule.page_number ?? 0) + 1}`}
                  onSave={(patch) => mutate(rule, patch)}
                  onDelete={remove}
                  busy={busy === rule.id}
                />
              ))}
            </ul>
          )}
        </section>

        {loading && <p className="text-[11px] text-slate-500">Loading rules…</p>}

        {otherPageRuleCount > 0 && (
          <p className="flex items-start gap-2 rounded-lg border border-obsidian-700 bg-obsidian-900/60 px-3 py-2 text-[11px] text-slate-400">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-300 flex-shrink-0 mt-0.5" aria-hidden="true" />
            {otherPageRuleCount} other page-specific rule{otherPageRuleCount === 1 ? '' : 's'} exist in this
            project. Open those pages to edit them.
          </p>
        )}

        <p className="text-[11px] leading-relaxed text-slate-500">
          Rules rewrite the narration script — the text shown in the reader and spoken by the narrator — after the
          LLM refiner runs. Rewritten pages lose their audio so the next Audio run speaks the new text; the OCR layer
          is never modified.
        </p>
      </div>
    </Modal>
  );
}
