import React, { useState, useEffect, useRef } from 'react';
import { Save, Sparkles, Volume2, X } from 'lucide-react';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';

export function PageTextEditModal({
  isOpen,
  onClose,
  page,
  mode = 'refined', // 'refined' | 'raw'
  onSave
}) {
  const [text, setText] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    if (isOpen && page) {
      setText(mode === 'raw' ? page.raw_text || '' : page.refined_text || '');
      setError(null);
      setIsSaving(false);
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 50);
    }
  }, [isOpen, page, mode]);

  const insertTag = (tag) => {
    const el = textareaRef.current;
    if (!el) {
      setText((prev) => `${prev} ${tag}`);
      return;
    }
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const current = el.value;
    const before = current.substring(0, start);
    const after = current.substring(end);
    const spacerBefore = before.length && !before.endsWith(' ') ? ' ' : '';
    const spacerAfter = after.length && !after.startsWith(' ') ? ' ' : '';
    const next = `${before}${spacerBefore}${tag}${spacerAfter}${after}`;
    setText(next);
    setTimeout(() => {
      const pos = start + spacerBefore.length + tag.length + spacerAfter.length;
      el.focus();
      el.setSelectionRange(pos, pos);
    }, 10);
  };

  const handleSave = async (options = {}) => {
    try {
      setIsSaving(true);
      setError(null);
      await onSave({
        pageNumber: page.page_number,
        text,
        mode,
        ...options
      });
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to save text.');
    } finally {
      setIsSaving(false);
    }
  };

  if (!page) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Edit ${mode === 'raw' ? 'Raw OCR Text' : 'Narration Script'} — Page ${page.page_number + 1}`}
      size="xl"
    >
      <div className="space-y-4">
        {error && (
          <div className="p-3 rounded-lg text-xs bg-rose-500/10 border border-rose-500/30 text-rose-300">
            {error}
          </div>
        )}

        {mode === 'refined' && (
          <div className="flex flex-wrap items-center gap-1.5 p-2 rounded-lg bg-obsidian-950/60 border border-obsidian-750">
            <span className="text-[11px] text-slate-400 font-medium mr-1">Insert tags:</span>
            {['[sigh]', '[laughter]', '[gasp]', '[whisper]', '[pause]'].map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => insertTag(tag)}
                className="px-2 py-0.5 rounded text-[11px] font-mono bg-obsidian-850 hover:bg-obsidian-800 text-brand-300 border border-obsidian-750 transition"
              >
                {tag}
              </button>
            ))}
          </div>
        )}

        <div>
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={14}
            className="w-full p-4 rounded-xl bg-obsidian-950/80 border border-obsidian-750 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-400 font-sans leading-relaxed select-text"
            placeholder={
              mode === 'raw'
                ? 'Raw extracted text from PDF...'
                : 'Refined narration script for text-to-speech...'
            }
          />
          <div className="flex justify-between items-center text-xs text-slate-500 mt-1.5">
            <span>{text.length} characters • {text.split('\n\n').filter(Boolean).length} paragraphs</span>
            <span>Supports Bengali (বাংলা), Arabic (العربية), and English</span>
          </div>
        </div>

        <div className="flex items-center justify-between pt-3 border-t border-obsidian-750">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>

          <div className="flex items-center gap-2">
            {mode === 'raw' ? (
              <Button
                variant="secondary"
                size="sm"
                icon={Sparkles}
                isLoading={isSaving}
                onClick={() => handleSave({ andRefine: true })}
                title="Save OCR text and immediately refine narration with AI"
              >
                Save & Refine
              </Button>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                icon={Volume2}
                isLoading={isSaving}
                onClick={() => handleSave({ andSynthesize: true })}
                title="Save script and immediately generate audio"
              >
                Save & Synthesize
              </Button>
            )}

            <Button
              variant="primary"
              size="sm"
              icon={Save}
              isLoading={isSaving}
              onClick={() => handleSave()}
            >
              Save Text
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
