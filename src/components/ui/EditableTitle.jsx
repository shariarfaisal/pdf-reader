import React, { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';

/**
 * Click-to-rename title, Google Drive/Docs style.
 * - Click the text → becomes an input with the name selected.
 * - Enter or blur commits, Escape reverts, an emptied name reverts.
 * - `editSignal`: bump a number to open edit mode from outside (menu item).
 */
export function EditableTitle({
  value,
  displayValue,
  onRename,
  onActivate,
  clickToEdit = true,
  className = '',
  wrapperClassName = '',
  inputClassName = '',
  maxLength = 200,
  disabled = false,
  editSignal = 0,
  title,
  placeholder = 'Untitled'
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!editing) setDraft(value ?? '');
  }, [value, editing]);

  // Focus + select the whole name as soon as edit mode opens.
  useEffect(() => {
    if (!editing) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [editing]);

  // External trigger (e.g. "Rename book…" in a menu).
  const lastSignal = useRef(editSignal);
  useEffect(() => {
    if (editSignal === lastSignal.current) return;
    lastSignal.current = editSignal;
    if (!disabled && !saving) {
      cancelledRef.current = false;
      setDraft(value ?? '');
      setEditing(true);
    }
  }, [editSignal, disabled, saving, value]);

  const startEdit = () => {
    if (disabled || saving) return;
    cancelledRef.current = false;
    setDraft(value ?? '');
    setEditing(true);
  };

  const cancel = () => {
    cancelledRef.current = true;
    setDraft(value ?? '');
    setEditing(false);
  };

  const commit = async ({ allowEmpty = false } = {}) => {
    if (saving) return;
    const next = (draft ?? '').trim();
    const current = (value ?? '').trim();

    if (!next) {
      // Blur with an empty field reverts instead of nagging.
      if (allowEmpty) cancel();
      else {
        inputRef.current?.focus();
        inputRef.current?.select();
      }
      return;
    }
    if (next === current) {
      setEditing(false);
      return;
    }

    setSaving(true);
    try {
      await onRename?.(next);
      setEditing(false);
    } catch (err) {
      console.error('Rename failed:', err);
      // Keep the field open so the user can retry or press Escape.
      inputRef.current?.focus();
      inputRef.current?.select();
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <span className={`inline-flex items-center gap-1.5 min-w-0 max-w-full ${wrapperClassName}`}>
        <input
          ref={inputRef}
          type="text"
          value={draft}
          maxLength={maxLength}
          disabled={saving}
          aria-label="Book title"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              cancel();
            }
          }}
          onBlur={() => {
            if (cancelledRef.current) return;
            commit({ allowEmpty: true });
          }}
          className={`min-w-0 max-w-full bg-obsidian-900 border border-indigo-500 rounded-md px-2 h-7.5 text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/25 disabled:opacity-60 ${inputClassName}`}
        />
        {saving && <Loader2 className="w-3.5 h-3.5 flex-shrink-0 animate-spin text-indigo-400" />}
      </span>
    );
  }

  const shownTitle = displayValue || value || placeholder;

  return (
    <button
      type="button"
      onClick={clickToEdit ? startEdit : onActivate || startEdit}
      disabled={disabled}
      title={
        title ??
        (clickToEdit
          ? `${value || placeholder} — click to rename`
          : `${value || placeholder}`)
      }
      aria-label={clickToEdit ? `Rename "${shownTitle}"` : `Open "${shownTitle}"`}
      className={`min-h-[28px] inline-flex items-center text-left rounded-md px-1 -mx-1 hover:bg-obsidian-800/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 ${
        clickToEdit ? 'cursor-text' : 'cursor-pointer hover:text-indigo-600 dark:hover:text-indigo-300 transition-colors'
      } disabled:cursor-default ${className}`}
    >
      <span className="line-clamp-2 [overflow-wrap:anywhere]">{shownTitle}</span>
    </button>
  );
}
