import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Trash2,
  Search,
  CheckSquare,
  Square,
  RefreshCw,
  Sparkles,
  Volume2,
  FileText,
  Type,
  MoreVertical,
  Check
} from 'lucide-react';
import { Button } from './ui/Button';
import { Tag } from './ui/Badge';
import { PageThumbnail } from './ui/PageThumbnail';
import { AddPageModal } from './AddPageModal';
import { ConfirmModal } from './ui/ConfirmModal';
import { pageStages } from '../lib/pageStages';

export function PageNavigatorSidebar({
  project,
  pages = [],
  activePageNumber = 0,
  isOpen = true,
  onToggle,
  onSelectPage,
  onAddPage,
  onDeletePage,
  onDeletePages,
  onRegeneratePage
}) {
  const [filterQuery, setFilterQuery] = useState('');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedPageIds, setSelectedPageIds] = useState(() => new Set());
  const [activeMenuPage, setActiveMenuPage] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState({ isOpen: false, pageNumber: null, isBulk: false });

  const activeItemRef = useRef(null);
  const listContainerRef = useRef(null);

  // Auto-scroll the active page thumbnail into view in the sidebar
  useEffect(() => {
    if (isOpen && activeItemRef.current && listContainerRef.current) {
      activeItemRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest'
      });
    }
  }, [activePageNumber, isOpen]);

  // Filter pages by number
  const filteredPages = useMemo(() => {
    if (!filterQuery.trim()) return pages;
    const q = filterQuery.toLowerCase().trim();
    return pages.filter((p) => {
      const pageStr = `${p.page_number + 1}`;
      return pageStr.includes(q) || (p.page_type === 'custom' && 'custom'.includes(q));
    });
  }, [pages, filterQuery]);

  const toggleSelectPage = (id) => {
    setSelectedPageIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selectedPageIds.size === pages.length) {
      setSelectedPageIds(new Set());
    } else {
      setSelectedPageIds(new Set(pages.map((p) => p.id)));
    }
  };

  const handleBulkDelete = async () => {
    if (selectedPageIds.size === 0) return;
    try {
      await onDeletePages(Array.from(selectedPageIds));
      setSelectedPageIds(new Set());
      setIsSelectMode(false);
      setDeleteConfirm({ isOpen: false, pageNumber: null, isBulk: false });
    } catch (err) {
      console.error('Failed to bulk delete pages:', err);
    }
  };

  const handleDeleteSingle = async (pageNumber) => {
    try {
      await onDeletePage(pageNumber);
      setDeleteConfirm({ isOpen: false, pageNumber: null, isBulk: false });
    } catch (err) {
      console.error('Failed to delete page:', err);
    }
  };

  if (!isOpen) {
    return (
      <div className="flex-shrink-0 flex items-start p-2 border-r border-obsidian-750 bg-obsidian-900 z-10">
        <Button
          variant="ghost"
          size="icon-sm"
          icon={PanelLeftOpen}
          onClick={onToggle}
          title="Open Page Navigator sidebar"
          aria-label="Open Page Navigator sidebar"
        />
      </div>
    );
  }

  return (
    <aside
      className="flex-shrink-0 w-72 flex flex-col h-full border-r border-obsidian-750 bg-obsidian-900 transition-all duration-200 select-none z-10"
      aria-label="Page Navigator"
    >
      {/* Sidebar Header */}
      <div className="p-3 border-b border-obsidian-750 flex items-center justify-between gap-2 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-semibold text-slate-100 tracking-wide uppercase">
            Pages
          </span>
          <Tag tone="slate" size="xs" className="font-mono">
            {pages.length}
          </Tag>
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-xs"
            icon={Plus}
            onClick={() => setIsAddModalOpen(true)}
            title="Add custom text page"
            aria-label="Add custom text page"
          />
          <Button
            variant={isSelectMode ? 'secondary' : 'ghost'}
            size="icon-xs"
            icon={isSelectMode ? CheckSquare : Square}
            onClick={() => {
              setIsSelectMode(!isSelectMode);
              setSelectedPageIds(new Set());
            }}
            title={isSelectMode ? 'Exit select mode' : 'Select pages to manage'}
            aria-label={isSelectMode ? 'Exit select mode' : 'Select pages to manage'}
          />
          <Button
            variant="ghost"
            size="icon-xs"
            icon={PanelLeftClose}
            onClick={onToggle}
            title="Collapse sidebar"
            aria-label="Collapse sidebar"
          />
        </div>
      </div>

      {/* Filter / Jump & Select Toolbar */}
      <div className="px-3 py-2 border-b border-obsidian-750/70 bg-obsidian-850/60 flex items-center gap-2 flex-shrink-0">
        {isSelectMode ? (
          <div className="flex items-center justify-between w-full text-xs">
            <button
              type="button"
              onClick={handleSelectAll}
              className="text-brand-400 hover:text-brand-300 font-medium transition"
            >
              {selectedPageIds.size === pages.length ? 'Deselect All' : 'Select All'}
            </button>
            <span className="text-slate-400 font-mono">
              {selectedPageIds.size} selected
            </span>
          </div>
        ) : (
          <div className="relative w-full">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              placeholder="Jump to page #..."
              className="w-full h-7 pl-7 pr-2 rounded-md bg-obsidian-950/70 border border-obsidian-750 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-400 transition"
            />
          </div>
        )}
      </div>

      {/* Page Thumbnails List */}
      <div
        ref={listContainerRef}
        className="flex-1 overflow-y-auto p-3 space-y-2.5 scroll-slim"
      >
        {filteredPages.map((page) => {
          const isActive = page.page_number === activePageNumber;
          const stages = pageStages(page);
          const isSelected = selectedPageIds.has(page.id);

          return (
            <div
              key={page.id}
              ref={isActive ? activeItemRef : null}
              onClick={() => {
                if (isSelectMode) {
                  toggleSelectPage(page.id);
                } else {
                  onSelectPage(page.page_number);
                }
              }}
              className={`group relative rounded-xl border p-2 flex items-center gap-3 cursor-pointer transition-all ${
                isActive
                  ? 'border-brand-500 bg-brand-500/10 shadow-sm'
                  : isSelected
                  ? 'border-brand-400/80 bg-brand-500/5'
                  : 'border-obsidian-750/80 bg-obsidian-950/40 hover:border-obsidian-600 hover:bg-obsidian-850'
              }`}
            >
              {/* Checkbox (in select mode) */}
              {isSelectMode && (
                <div className="flex-shrink-0">
                  {isSelected ? (
                    <CheckSquare className="w-4 h-4 text-brand-400" />
                  ) : (
                    <Square className="w-4 h-4 text-slate-500" />
                  )}
                </div>
              )}

              {/* Thumbnail Container */}
              <div className="w-12 h-16 rounded-md overflow-hidden bg-obsidian-950 border border-obsidian-750 flex-shrink-0 flex items-center justify-center relative">
                <PageThumbnail
                  projectId={project.id}
                  page={page}
                  size="sm"
                  className="w-full h-full object-cover"
                />
              </div>

              {/* Info Column */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span
                    className={`text-xs font-medium truncate ${
                      isActive ? 'text-brand-300 font-semibold' : 'text-slate-200'
                    }`}
                  >
                    Page {page.page_number + 1}
                  </span>
                  {page.page_type === 'custom' && (
                    <Tag tone="purple" size="xs">
                      Custom
                    </Tag>
                  )}
                </div>

                {/* Pipeline Stage Status Dots */}
                <div className="flex items-center gap-1.5 mt-2" title="Pipeline stages: Text • Script • Audio">
                  <span
                    className={`w-2 h-2 rounded-full transition-colors ${
                      stages.ocr ? 'bg-sky-400 shadow-sm shadow-sky-400/40' : 'bg-obsidian-700'
                    }`}
                    title={stages.ocr ? 'OCR Text ready' : 'OCR pending'}
                  />
                  <span
                    className={`w-2 h-2 rounded-full transition-colors ${
                      stages.refine ? 'bg-violet-400 shadow-sm shadow-violet-400/40' : 'bg-obsidian-700'
                    }`}
                    title={stages.refine ? 'Narration Script refined' : 'Refinement pending'}
                  />
                  <span
                    className={`w-2 h-2 rounded-full transition-colors ${
                      stages.audio ? 'bg-emerald-400 shadow-sm shadow-emerald-400/40' : 'bg-obsidian-700'
                    }`}
                    title={stages.audio ? 'Audio synthesized' : 'Audio pending'}
                  />
                  <span className="text-[10px] text-slate-500 ml-1 font-mono">
                    {stages.audio ? 'Audio' : stages.refine ? 'Script' : stages.ocr ? 'Text' : 'Pending'}
                  </span>
                </div>
              </div>

              {/* Quick actions on hover */}
              {!isSelectMode && (
                <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 flex-shrink-0">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    icon={Trash2}
                    className="text-slate-400 hover:text-rose-400"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteConfirm({
                        isOpen: true,
                        pageNumber: page.page_number,
                        isBulk: false
                      });
                    }}
                    title={`Delete page ${page.page_number + 1}`}
                    aria-label={`Delete page ${page.page_number + 1}`}
                  />
                </div>
              )}
            </div>
          );
        })}

        {filteredPages.length === 0 && (
          <div className="text-center py-8 text-xs text-slate-500">
            No pages match "{filterQuery}"
          </div>
        )}
      </div>

      {/* Bulk Delete Footer (when in select mode with items selected) */}
      {isSelectMode && selectedPageIds.size > 0 && (
        <div className="p-3 border-t border-obsidian-750 bg-obsidian-850 flex items-center justify-between gap-2 flex-shrink-0">
          <span className="text-xs text-slate-300 font-medium">
            {selectedPageIds.size} selected
          </span>
          <Button
            variant="danger"
            size="xs"
            icon={Trash2}
            onClick={() => setDeleteConfirm({ isOpen: true, pageNumber: null, isBulk: true })}
          >
            Delete Selected
          </Button>
        </div>
      )}

      {/* Add Page Modal */}
      <AddPageModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        project={project}
        pages={pages}
        activePageNumber={activePageNumber}
        onAddPage={onAddPage}
      />

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={deleteConfirm.isOpen}
        onClose={() => setDeleteConfirm({ isOpen: false, pageNumber: null, isBulk: false })}
        onConfirm={
          deleteConfirm.isBulk
            ? handleBulkDelete
            : () => handleDeleteSingle(deleteConfirm.pageNumber)
        }
        title={deleteConfirm.isBulk ? 'Delete Selected Pages' : `Delete Page ${(deleteConfirm.pageNumber ?? 0) + 1}`}
        message={
          deleteConfirm.isBulk
            ? `Are you sure you want to delete ${selectedPageIds.size} pages? This will re-index all remaining pages permanently.`
            : `Are you sure you want to delete Page ${(deleteConfirm.pageNumber ?? 0) + 1}? All subsequent pages will be renumbered.`
        }
        confirmText="Delete"
        variant="danger"
      />
    </aside>
  );
}
