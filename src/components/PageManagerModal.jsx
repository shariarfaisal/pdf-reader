import React, { useEffect, useState, useRef } from 'react';
import {
  Trash2,
  Pencil,
  FileText,
  Type,
  Check,
  X,
  ArrowDownToLine,
  Eye,
  Square,
  CheckSquare,
  AlertTriangle
} from 'lucide-react';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { Badge, Tag } from './ui/Badge';
import { PageThumbnail } from './ui/PageThumbnail';
import { PagePreviewModal } from './PagePreviewModal';

/**
 * Page manager: delete unwanted pages and insert custom text pages at any
 * position. Custom pages carry their own text, so the pipeline skips render +
 * OCR for them and narrates the pasted content directly.
 */
export function PageManagerModal({
  isOpen,
  onClose,
  project,
  pages = [],
  activePageNumber,
  onAddPage,
  onUpdatePageText,
  onDeletePage,
  onDeletePages,
  onSelectPage
}) {
  const [insertAt, setInsertAt] = useState('end'); // 'start' | 'end' | 'after:<n>'
  const [text, setText] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState(null);
  const [editingPage, setEditingPage] = useState(null);
  const [editText, setEditText] = useState('');
  const [previewPage, setPreviewPage] = useState(null);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [isBulkConfirming, setIsBulkConfirming] = useState(false);
  const lastClickedIndex = useRef(null);

  const ordered = [...pages].sort((a, b) => a.page_number - b.page_number);

  useEffect(() => {
    if (!isOpen) {
      setText('');
      setError(null);
      setEditingPage(null);
      setEditText('');
      setInsertAt('end');
      setPreviewPage(null);
      setSelectedIds(new Set());
      setIsBulkConfirming(false);
      lastClickedIndex.current = null;
    }
  }, [isOpen]);

  // Drop selections for pages that no longer exist (after any delete).
  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const live = new Set(ordered.map((p) => p.id));
      const next = new Set([...prev].filter((id) => live.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [pages]);

  const resolvePosition = () => {
    if (insertAt === 'start') return 0;
    if (insertAt === 'end') return ordered.length;
    const after = parseInt(insertAt.replace('after:', ''), 10);
    return Number.isInteger(after) ? after + 1 : ordered.length;
  };

  const handleAdd = async () => {
    if (!text.trim()) {
      setError('Paste the text you want narrated on this page.');
      return;
    }
    setError(null);
    setIsBusy(true);
    try {
      await onAddPage(resolvePosition(), text.trim());
      setText('');
    } catch (err) {
      setError(err.message || 'Could not add the custom page');
    } finally {
      setIsBusy(false);
    }
  };

  const handleSaveEdit = async (pageNumber) => {
    if (!editText.trim()) {
      setError('Custom page text cannot be empty.');
      return;
    }
    setError(null);
    setIsBusy(true);
    try {
      await onUpdatePageText(pageNumber, editText.trim());
      setEditingPage(null);
      setEditText('');
    } catch (err) {
      setError(err.message || 'Could not update the page');
    } finally {
      setIsBusy(false);
    }
  };

  /** Open the preview/confirm dialog instead of a blind browser confirm(). */
  const handleDelete = async (page) => {
    setError(null);
    setIsBusy(true);
    try {
      await onDeletePage(page.page_number);
      setPreviewPage(null);
    } catch (err) {
      setError(err.message || 'Could not delete the page');
    } finally {
      setIsBusy(false);
    }
  };

  /** Toggle one page; shift-click extends the selection over the clicked range. */
  const toggleSelected = (index, id, shiftKey) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const from = shiftKey && lastClickedIndex.current !== null ? lastClickedIndex.current : index;
      const [start, end] = from < index ? [from, index] : [index, from];
      const ids = ordered.slice(start, end + 1).map((p) => p.id);

      if (shiftKey && lastClickedIndex.current !== null) {
        const shouldSelect = !prev.has(id);
        ids.forEach((pageId) => (shouldSelect ? next.add(pageId) : next.delete(pageId)));
      } else if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }

      lastClickedIndex.current = index;
      return next;
    });
    setIsBulkConfirming(false);
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
    setIsBulkConfirming(false);
    lastClickedIndex.current = null;
  };

  const selectedCount = ordered.filter((p) => selectedIds.has(p.id)).length;
  const allSelected = ordered.length > 0 && selectedCount === ordered.length;

  const toggleSelectAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(ordered.map((p) => p.id)));
    setIsBulkConfirming(false);
    lastClickedIndex.current = null;
  };

  const handleBulkDelete = async () => {
    if (!onDeletePages) return;
    setError(null);
    setIsBusy(true);
    try {
      await onDeletePages([...selectedIds]);
      clearSelection();
    } catch (err) {
      setError(err.message || 'Could not delete the selected pages');
    } finally {
      setIsBusy(false);
      setIsBulkConfirming(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Manage Pages — ${project?.name || ''}`} maxWidth="max-w-4xl">
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {error && (
          <div className="lg:col-span-5 px-3 py-2 bg-rose-500/10 border border-rose-500/30 rounded-lg text-[11px] text-rose-300">
            {error}
          </div>
        )}

        {/* Insert custom text page */}
        <div className="lg:col-span-2 space-y-3">
          <div className="flex items-center gap-2">
            <Type className="w-4 h-4 text-brand-400" />
            <h4 className="text-sm font-semibold text-slate-100">Add Custom Text Page</h4>
          </div>
          <p className="text-[11px] text-slate-500 leading-snug">
            Pasted text is narrated as-is. No rasterizing or OCR runs for this page — only voice synthesis.
          </p>

          <div>
            <label className="text-xs text-slate-400 font-medium">Insert position</label>
            <select
              value={insertAt}
              onChange={(e) => setInsertAt(e.target.value)}
              className="w-full mt-1 bg-obsidian-950 border border-obsidian-700 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-brand-400"
            >
              <option value="start">At the beginning (before page 1)</option>
              {ordered.map((p) => (
                <option key={p.page_number} value={`after:${p.page_number}`}>
                  After page {p.page_number + 1}
                  {p.page_type === 'custom' ? ' (custom)' : ''}
                </option>
              ))}
              <option value="end">At the end (after page {ordered.length})</option>
            </select>
          </div>

          <div>
            <label className="text-xs text-slate-400 font-medium">Page text</label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={9}
              placeholder="Paste the text that should be narrated on this page…"
              className="w-full mt-1 bg-obsidian-950 border border-obsidian-700 rounded-lg px-3 py-2 text-sm text-slate-200 leading-relaxed focus:outline-none focus:border-brand-400 resize-y select-text"
            />
          </div>

          <Button
            variant="primary"
            size="sm"
            icon={ArrowDownToLine}
            isLoading={isBusy && !editingPage}
            disabled={isBusy || !text.trim()}
            onClick={handleAdd}
            className="w-full"
          >
            Add Page
          </Button>
        </div>

        {/* Page list */}
        <div className="lg:col-span-3 flex flex-col min-h-0">
          <div className="flex items-center justify-between mb-2 gap-3">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-brand-400" />
              <h4 className="text-sm font-semibold text-slate-100">Pages ({ordered.length})</h4>
            </div>
            <div className="flex items-center gap-2">
              {selectedCount > 0 && (
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-brand-500/15 text-brand-300 border border-brand-500/30">
                  {selectedCount} selected
                </span>
              )}
              <button
                onClick={toggleSelectAll}
                className="text-[10px] uppercase tracking-wide text-slate-400 hover:text-brand-300 transition"
                title={allSelected ? 'Clear selection' : 'Select every page'}
              >
                {allSelected ? 'Clear' : 'Select all'}
              </button>
            </div>
          </div>

          <div className="space-y-1.5 max-h-[52vh] overflow-y-auto pr-1">
            {ordered.length === 0 && (
              <div className="text-center py-10 border border-dashed border-obsidian-700 rounded-xl text-xs text-slate-500">
                No pages left. Add a custom text page to rebuild the narration.
              </div>
            )}

            {ordered.map((p, index) => {
              const isCustom = p.page_type === 'custom';
              const isEditing = editingPage === p.page_number;
              const isActive = p.page_number === activePageNumber;
              const isSelected = selectedIds.has(p.id);
              const snippet = (p.refined_text || p.raw_text || '').replace(/\s+/g, ' ').trim();

              return (
                <div
                  key={p.page_number}
                  className={`rounded-xl border px-3 py-2 transition-colors ${
                    isSelected
                      ? 'border-rose-500/50 bg-rose-500/5'
                      : isActive
                        ? 'border-brand-500/60 bg-brand-500/5'
                        : 'border-obsidian-700 bg-obsidian-900/60'
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    <button
                      type="button"
                      onClick={(e) => toggleSelected(index, p.id, e.shiftKey)}
                      className={`mt-1 flex-shrink-0 transition ${
                        isSelected ? 'text-rose-400' : 'text-slate-600 hover:text-slate-300'
                      }`}
                      title="Select this page (shift-click for a range)"
                      aria-pressed={isSelected}
                      aria-label={`Select page ${p.page_number + 1}`}
                    >
                      {isSelected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                    </button>

                    <PageThumbnail
                      projectId={project.id}
                      page={p}
                      onClick={() => setPreviewPage(p)}
                    />

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Tag tone="slate" size="xs" className="font-mono">
                          #{p.page_number + 1}
                        </Tag>
                        <Tag tone={isCustom ? 'purple' : 'sky'} size="xs">
                          {isCustom ? 'Custom text' : 'PDF'}
                        </Tag>
                        <Badge status={p.status} size="xs" />
                        {p.audio_duration > 0 && (
                          <Tag tone="slate" size="xs" className="font-mono">
                            {Math.round(p.audio_duration)}s
                          </Tag>
                        )}
                      </div>

                      {isEditing ? (
                        <div className="mt-2 space-y-2">
                          <textarea
                            value={editText}
                            onChange={(e) => setEditText(e.target.value)}
                            rows={5}
                            className="w-full bg-obsidian-950 border border-obsidian-700 rounded-lg px-2.5 py-2 text-xs text-slate-200 leading-relaxed focus:outline-none focus:border-brand-400 resize-y select-text"
                          />
                          <div className="flex items-center gap-2">
                            <Button
                              variant="primary"
                              size="xs"
                              icon={Check}
                              isLoading={isBusy}
                              onClick={() => handleSaveEdit(p.page_number)}
                            >
                              Save
                            </Button>
                            <Button
                              variant="ghost"
                              size="xs"
                              icon={X}
                              onClick={() => {
                                setEditingPage(null);
                                setEditText('');
                              }}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <p className="mt-1 text-[11px] text-slate-400 leading-snug line-clamp-2">
                          {snippet || (isCustom ? 'Empty custom page' : 'Not extracted yet')}
                        </p>
                      )}
                    </div>

                    {!isEditing && (
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={() => setPreviewPage(p)}
                          className="p-1.5 text-slate-500 hover:text-brand-300 transition"
                          title="Preview this page"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        {isCustom && (
                          <button
                            onClick={() => {
                              setEditingPage(p.page_number);
                              setEditText(p.raw_text || p.refined_text || '');
                            }}
                            className="p-1.5 text-slate-500 hover:text-brand-300 transition"
                            title="Edit this custom page's text"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          onClick={() => setPreviewPage(p)}
                          disabled={isBusy}
                          className="p-1.5 text-slate-500 hover:text-rose-400 transition disabled:opacity-40"
                          title="Delete this page"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Bulk actions — appears only when pages are selected */}
          {selectedCount > 0 && (
            <div className="mt-3 rounded-xl border border-rose-500/30 bg-rose-500/5 px-3 py-2.5">
              {isBulkConfirming ? (
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 justify-between">
                  <p className="text-[11px] text-rose-200 leading-snug flex items-start gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                    Delete {selectedCount} page{selectedCount === 1 ? '' : 's'} permanently? Their cached OCR, narration and
                    audio are removed. This cannot be undone.
                  </p>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Button variant="ghost" size="xs" onClick={() => setIsBulkConfirming(false)} disabled={isBusy}>
                      Cancel
                    </Button>
                    <Button
                      variant="danger"
                      size="xs"
                      icon={Trash2}
                      isLoading={isBusy}
                      onClick={handleBulkDelete}
                    >
                      Delete {selectedCount}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 justify-between">
                  <p className="text-[11px] text-slate-300 leading-snug">
                    {selectedCount} page{selectedCount === 1 ? '' : 's'} selected — shift-click selects a range.
                  </p>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Button variant="ghost" size="xs" onClick={clearSelection}>
                      Clear
                    </Button>
                    <Button
                      variant="danger"
                      size="xs"
                      icon={Trash2}
                      disabled={!onDeletePages}
                      onClick={() => setIsBulkConfirming(true)}
                    >
                      Delete selected
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          <p className="mt-3 text-[10px] text-slate-500 leading-snug">
            Tick the boxes to select several pages at once (shift-click for a range), then delete them together. Click a
            thumbnail to preview a page before acting on it. Deleting or inserting pages never re-runs OCR, refinement, or
            audio for the pages you keep — their caches stay attached to their own rows. Newly added custom pages need
            one pipeline run (Start) to produce audio.
          </p>
        </div>
      </div>

      {/* Preview / delete confirmation with the actual page visible */}
      <PagePreviewModal
        isOpen={Boolean(previewPage)}
        onClose={() => setPreviewPage(null)}
        projectId={project?.id}
        page={previewPage}
        totalPages={ordered.length}
        isDeleting={isBusy}
        onConfirmDelete={() => previewPage && handleDelete(previewPage)}
        onOpenPage={() => {
          if (!previewPage) return;
          onSelectPage(previewPage.page_number);
          setPreviewPage(null);
          onClose();
        }}
      />
    </Modal>
  );
}
