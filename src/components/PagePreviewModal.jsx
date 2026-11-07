import React from 'react';
import { Trash2, ExternalLink } from 'lucide-react';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { Badge } from './ui/Badge';
import { PageThumbnail } from './ui/PageThumbnail';

/**
 * Confirmation dialog that shows the actual page before it is deleted, so the
 * page manager is never a blind "black box" action.
 */
export function PagePreviewModal({
  isOpen,
  onClose,
  projectId,
  page,
  totalPages,
  isDeleting = false,
  onConfirmDelete,
  onOpenPage
}) {
  if (!page) return null;

  const isCustom = page.page_type === 'custom';
  const label = isCustom ? 'custom text page' : 'PDF page';

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Page ${page.page_number + 1} of ${totalPages}`} maxWidth="max-w-xl">
      <div className="space-y-4">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span
            className={`text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded border ${
              isCustom
                ? 'text-purple-300 bg-purple-500/10 border-purple-500/30'
                : 'text-sky-300 bg-sky-500/10 border-sky-500/30'
            }`}
          >
            {isCustom ? 'Custom text' : 'PDF'}
          </span>
          <Badge status={page.status} size="xs" />
          {page.audio_duration > 0 && (
            <span className="text-[10px] font-mono text-slate-500">{Math.round(page.audio_duration)}s audio</span>
          )}
          {!isCustom && page.source_page !== null && page.source_page !== undefined && (
            <span className="text-[10px] font-mono text-slate-500">
              source PDF page {page.source_page + 1}
            </span>
          )}
        </div>

        <PageThumbnail projectId={projectId} page={page} size="lg" />

        {!isCustom && (
          <p className="text-[11px] text-slate-500 leading-snug">
            {(page.refined_text || page.raw_text || '').replace(/\s+/g, ' ').slice(0, 240) || 'Not extracted yet.'}
          </p>
        )}

        <div className="p-3 bg-rose-500/5 border border-rose-500/25 rounded-lg text-[11px] text-rose-200/90 leading-snug">
          Deleting this {label} also removes its extracted text, refined narration and generated audio, and the pages
          after it move up by one. The original PDF file is never modified.
        </div>

        <div className="flex items-center justify-between pt-1">
          <Button variant="ghost" size="sm" icon={ExternalLink} onClick={onOpenPage}>
            Open in reader
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="danger" size="sm" icon={Trash2} isLoading={isDeleting} onClick={onConfirmDelete}>
              Delete Page {page.page_number + 1}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
