import React, { useMemo, useState } from 'react';
import {
  BookOpen,
  Plus,
  Trash2,
  FileText,
  ArrowRight,
  Activity,
  Settings as SettingsIcon,
  Search,
  CheckCircle2,
  Layers,
  Clock,
  Mic,
  Boxes,
  Upload
} from 'lucide-react';
import { Button } from './ui/Button';
import { Card } from './ui/Card';
import { Badge, Tag } from './ui/Badge';
import { ProgressBar } from './ui/ProgressBar';
import { MetricCard } from './ui/MetricCard';
import { ConfirmModal } from './ui/ConfirmModal';
import { ThemeToggle } from './ui/ThemeToggle';
import { formatRelativeTime } from '../lib/format';

/** First-page cover for a project; falls back to a branded placeholder. */
function ProjectCover({ projectId, updatedAt }) {
  const [failed, setFailed] = useState(false);
  const src = `/api/projects/${projectId}/pages/0/preview?v=${updatedAt || 0}`;

  return (
    <div className="relative w-[58px] h-[80px] flex-shrink-0 rounded-md overflow-hidden border border-obsidian-700 bg-obsidian-950 shadow-md shadow-black/40">
      {failed ? (
        <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-brand-500/20 via-obsidian-900 to-indigo-500/20">
          <BookOpen className="w-5 h-5 text-brand-300/70" />
        </div>
      ) : (
        <img
          src={src}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          className="w-full h-full object-cover object-top opacity-90 group-hover:opacity-100 transition-opacity"
        />
      )}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-[3px] bg-gradient-to-b from-brand-400/70 to-indigo-500/70" />
    </div>
  );
}

const SORT_OPTIONS = [
  { id: 'recent', label: 'Recently updated' },
  { id: 'name', label: 'Name (A–Z)' },
  { id: 'progress', label: 'Most complete' }
];

export function ProjectList({
  projects,
  onSelectProject,
  onNewProject,
  onDeleteProject,
  onOpenUsage,
  onOpenVoices,
  onOpenModels,
  onOpenSettings
}) {
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState('recent');
  const [projectToDelete, setProjectToDelete] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const stats = useMemo(() => {
    const totalPages = projects.reduce((sum, p) => sum + (p.page_count || 0), 0);
    const readyPages = projects.reduce((sum, p) => sum + (p.readyPages || 0), 0);
    const finished = projects.filter((p) => p.page_count > 0 && p.readyPages >= p.page_count).length;
    const active = projects.filter((p) => p.status === 'running' || p.status === 'paused').length;
    return {
      totalPages,
      readyPages,
      finished,
      active,
      percent: totalPages > 0 ? Math.round((readyPages / totalPages) * 100) : 0
    };
  }, [projects]);

  const visibleProjects = useMemo(() => {
    const term = query.trim().toLowerCase();
    const filtered = term
      ? projects.filter((p) => (p.name || '').toLowerCase().includes(term))
      : projects;

    const sorted = [...filtered];
    if (sortBy === 'name') {
      sorted.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    } else if (sortBy === 'progress') {
      sorted.sort((a, b) => (b.percent || 0) - (a.percent || 0));
    } else {
      sorted.sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
    }
    return sorted;
  }, [projects, query, sortBy]);

  const handleConfirmDelete = async () => {
    if (!projectToDelete) return;
    setIsDeleting(true);
    try {
      await onDeleteProject(projectToDelete.id);
      setProjectToDelete(null);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-obsidian-900 text-slate-100">
      {/* App shell header */}
      <header className="sticky top-0 z-30 border-b border-obsidian-800/80 bg-obsidian-950/85 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-400 to-indigo-500 flex items-center justify-center shadow-lg shadow-brand-500/25 flex-shrink-0">
              <BookOpen className="w-4 h-4 text-obsidian-950" />
            </span>
            <div className="min-w-0">
              <p className="text-[13.5px] font-semibold text-white leading-tight truncate">
                PDF Audiobook Studio
              </p>
              <p className="text-[11px] text-slate-400 leading-tight truncate hidden sm:block">
                Bengali · Arabic · English narration
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {onOpenModels && (
              <Button
                variant="ghost"
                size="sm"
                icon={Boxes}
                onClick={onOpenModels}
                title="Local AI Model Hub"
              >
                <span className="hidden sm:inline">Models</span>
              </Button>
            )}
            {onOpenVoices && (
              <Button
                variant="ghost"
                size="sm"
                icon={Mic}
                onClick={onOpenVoices}
                title="Voice cloning studio"
              >
                <span className="hidden sm:inline">Voices</span>
              </Button>
            )}
            {onOpenUsage && (
              <Button
                variant="ghost"
                size="sm"
                icon={Activity}
                onClick={onOpenUsage}
                title="API usage & costs"
              >
                <span className="hidden sm:inline">Usage</span>
              </Button>
            )}
            {onOpenSettings && (
              <Button
                variant="ghost"
                size="sm"
                icon={SettingsIcon}
                onClick={onOpenSettings}
                title="Engine & AI configuration"
              >
                <span className="hidden sm:inline">Settings</span>
              </Button>
            )}
            <ThemeToggle />
            <Button variant="primary" size="sm" icon={Plus} onClick={onNewProject}>
              New Project
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-7xl mx-auto px-6 py-8">
        {/* Title row */}
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4 mb-6">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-white flex items-center gap-2">
              Library
              <Tag tone="slate" size="xs" className="font-mono">
                {projects.length}
              </Tag>
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              Every PDF is its own project with cached OCR, narration and audio, page by page.
            </p>
          </div>

          {projects.length > 0 && (
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search books…"
                  aria-label="Search projects"
                  className="w-48 sm:w-56 h-8 pl-8 pr-3 rounded-lg bg-obsidian-950/80 border border-obsidian-700 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-500/25 transition-colors"
                />
              </div>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                aria-label="Sort projects"
                className="h-8 rounded-lg bg-obsidian-950/80 border border-obsidian-700 px-2.5 text-xs text-slate-300 focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-500/25 cursor-pointer"
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Library stats */}
        {projects.length > 0 && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            <MetricCard
              label="Books"
              value={projects.length}
              hint={stats.active > 0 ? `${stats.active} in progress` : `${stats.finished} completed`}
              icon={BookOpen}
              accent="brand"
            />
            <MetricCard
              label="Pages"
              value={stats.totalPages.toLocaleString()}
              hint="across the whole library"
              icon={Layers}
              accent="slate"
            />
            <MetricCard
              label="Narrated"
              value={stats.readyPages.toLocaleString()}
              hint={`${stats.percent}% of all pages`}
              icon={CheckCircle2}
              accent="emerald"
            />
            <MetricCard
              label="Remaining"
              value={Math.max(0, stats.totalPages - stats.readyPages).toLocaleString()}
              hint="pages left to OCR or narrate"
              icon={Clock}
              accent="amber"
            />
          </div>
        )}

        {/* Projects */}
        {projects.length === 0 ? (
          <div className="relative overflow-hidden rounded-2xl border border-dashed border-obsidian-700 bg-gradient-to-b from-obsidian-850/70 to-obsidian-900/40 px-6 py-16 text-center">
            <div className="absolute inset-x-0 -top-24 h-48 bg-brand-500/10 blur-3xl pointer-events-none" />
            <div className="relative">
              <span className="mx-auto mb-4 w-12 h-12 rounded-xl bg-brand-500/10 border border-brand-500/25 flex items-center justify-center">
                <BookOpen className="w-5 h-5 text-brand-300" />
              </span>
              <h2 className="text-base font-semibold text-white">No PDF projects yet</h2>
              <p className="text-xs text-slate-400 max-w-sm mx-auto mt-1.5 leading-relaxed">
                Import a scanned book or digital PDF to start page-by-page OCR, narration refinement
                and voice synthesis. Everything is cached, so you can stop and resume anytime.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-2 mt-6">
                <Button variant="primary" size="md" icon={Upload} onClick={onNewProject}>
                  Import your first PDF
                </Button>
                {onOpenSettings && (
                  <Button variant="secondary" size="md" icon={SettingsIcon} onClick={onOpenSettings}>
                    Configure engine
                  </Button>
                )}
              </div>
            </div>
          </div>
        ) : visibleProjects.length === 0 ? (
          <div className="rounded-xl border border-obsidian-800 bg-obsidian-850/40 px-6 py-12 text-center">
            <Search className="w-6 h-6 text-slate-600 mx-auto mb-2" />
            <p className="text-xs text-slate-300">No book matches “{query}”</p>
            <button
              onClick={() => setQuery('')}
              className="text-xs text-brand-300 hover:text-brand-200 mt-1"
            >
              Clear search
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {visibleProjects.map((p) => {
              const total = p.page_count || 0;
              const ready = p.readyPages || 0;
              const percent = total > 0 ? Math.round((ready / total) * 100) : 0;
              const isDone = total > 0 && ready >= total;

              return (
                <Card
                  key={p.id}
                  hover
                  className="group flex flex-col cursor-pointer hover:border-brand-500/50 hover:-translate-y-0.5"
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectProject(p.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelectProject(p.id);
                    }
                  }}
                >
                  <div className="flex items-start gap-3 p-4">
                    <ProjectCover projectId={p.id} updatedAt={p.updated_at} />

                    <div className="min-w-0 flex-1">
                      <h3
                        title={p.name}
                        className="text-[13.5px] font-semibold text-slate-100 group-hover:text-brand-200 transition-colors line-clamp-2 leading-snug"
                      >
                        {p.name}
                      </h3>

                      <div className="mt-2 flex items-center gap-1.5 flex-wrap text-xs text-slate-400">
                        <Badge status={isDone ? 'completed' : p.status} size="xs" />
                        <Tag tone="slate" size="xs" icon={FileText}>
                          {total} pages
                        </Tag>
                        {ready > 0 && (
                          <Tag tone={isDone ? 'emerald' : 'sky'} size="xs">
                            {ready} ready
                          </Tag>
                        )}
                      </div>

                      <div className="mt-1.5 flex items-center gap-1 text-[11px] text-slate-500">
                        <Clock className="w-3 h-3" />
                        <span>Updated {formatRelativeTime(p.updated_at)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="px-4">
                    <ProgressBar value={ready} max={total || 1} height="h-1.5" showPercent={false} />
                    <div className="flex items-center justify-between mt-1.5 text-[11px]">
                      <span className="text-slate-400 font-mono tabular-nums">{percent}%</span>
                      <span className="text-slate-400">
                        {isDone ? 'Audiobook complete' : `${Math.max(0, total - ready)} pages left`}
                      </span>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-2 px-4 py-2.5 border-t border-obsidian-800 bg-obsidian-900/40">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        setProjectToDelete(p);
                      }}
                      className="hover:text-rose-400 hover:bg-rose-500/10 text-slate-500"
                      title="Delete project"
                      aria-label={`Delete ${p.name}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectProject(p.id);
                      }}
                      className="group-hover:text-brand-200 group-hover:bg-brand-500/10"
                    >
                      Open reader
                      <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </main>

      {/* Delete Project Confirm Modal */}
      <ConfirmModal
        isOpen={Boolean(projectToDelete)}
        onClose={() => setProjectToDelete(null)}
        onConfirm={handleConfirmDelete}
        title={`Delete "${projectToDelete?.name}"?`}
        message={`This will permanently remove this project, all ${projectToDelete?.page_count || 0} pages, cached OCR, and generated audiobook narration.`}
        confirmText="Delete Project"
        variant="danger"
        isLoading={isDeleting}
      />
    </div>
  );
}
