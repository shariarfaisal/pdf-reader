import React, { useState } from 'react';
import { Plus, Type, FileText } from 'lucide-react';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';

export function AddPageModal({
  isOpen,
  onClose,
  project,
  pages = [],
  activePageNumber = 0,
  onAddPage
}) {
  const [insertAt, setInsertAt] = useState(() => `after:${activePageNumber}`);
  const [text, setText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e?.preventDefault();
    if (!text.trim()) {
      setError('Please enter some text for this page.');
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);
      await onAddPage(insertAt, text.trim());
      setText('');
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to add custom page.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Add Custom Text Page"
      size="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 rounded-lg text-xs bg-rose-500/10 border border-rose-500/30 text-rose-300">
            {error}
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-slate-300 mb-1.5">
            Insert Position
          </label>
          <select
            value={insertAt}
            onChange={(e) => setInsertAt(e.target.value)}
            className="w-full h-9 rounded-lg bg-obsidian-950/80 border border-obsidian-750 text-xs text-slate-200 px-3 focus:outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-400"
          >
            <option value="start">At the very beginning (Page 1)</option>
            <option value="end">At the very end (after last page)</option>
            {pages.map((p) => (
              <option key={p.id} value={`after:${p.page_number}`}>
                After Page {p.page_number + 1}
              </option>
            ))}
          </select>
          <p className="text-[11px] text-slate-400 mt-1">
            Custom pages skip OCR and are immediately ready for AI narration refinement and audio synthesis.
          </p>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-300 mb-1.5">
            Page Content (Bengali, Arabic, or English)
          </label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Type or paste text content for this custom page..."
            rows={8}
            className="w-full p-3 rounded-lg bg-obsidian-950/80 border border-obsidian-750 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-400 leading-relaxed font-sans"
            required
          />
          <div className="flex justify-between items-center text-[11px] text-slate-500 mt-1">
            <span>{text.length} characters</span>
            <span>Supports markdown paragraphs</span>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-obsidian-750">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            icon={Plus}
            isLoading={isSubmitting}
            disabled={!text.trim()}
          >
            Insert Page
          </Button>
        </div>
      </form>
    </Modal>
  );
}
