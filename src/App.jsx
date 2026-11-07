import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ProjectList } from './components/ProjectList';
import { ProjectWorkspace } from './components/ProjectWorkspace';
import { SettingsModal } from './components/SettingsModal';
import { NewProjectModal } from './components/NewProjectModal';
import { ApiUsageDashboard } from './components/ApiUsageDashboard';
import { VoiceStudio } from './components/VoiceStudio';
import { ModelHub } from './components/ModelHub';
import { Loader2 } from 'lucide-react';
import { stageForStatus } from './lib/pageStages';
import {
  useRoute,
  navigate,
  matchRoute,
  projectPath,
  LIBRARY_PATH,
  USAGE_PATH,
  VOICES_PATH,
  MODELS_PATH
} from './lib/router';

export function App() {
  const route = useRoute();
  const currentProjectId = route.name === 'project' ? route.projectId : null;

  const [projects, setProjects] = useState([]);
  const [currentProject, setCurrentProject] = useState(null);
  const [pages, setPages] = useState([]);
  const [activePageNumber, setActivePageNumber] = useState(0);

  const [settings, setSettings] = useState({});
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isNewProjectOpen, setIsNewProjectOpen] = useState(false);

  const [logs, setLogs] = useState([]);
  const [remoteStatus, setRemoteStatus] = useState({ state: 'stopped' });
  // Per-stage pipeline state (ocr / refine / audio), pushed by the engine.
  const [pipelineStages, setPipelineStages] = useState({ ocr: 'idle', refine: 'idle', audio: 'idle' });
  // Stage lanes run in parallel, so several pages can be mid-flight at once:
  // map each running stage to the page it is working on right now.
  const [activeRuns, setActiveRuns] = useState({});
  const [systemHealth, setSystemHealth] = useState({
    cpuCount: 8,
    load1m: '0.00',
    totalMemMB: 8192,
    usedMemMB: 4096,
    memPercent: 50
  });

  // Fetch all projects
  const loadProjects = useCallback(async () => {
    try {
      const res = await fetch('/api/projects');
      if (res.ok) {
        const data = await res.json();
        setProjects(data.projects || []);
      }
    } catch (err) {
      console.error('Failed to load projects:', err);
    }
  }, []);

  // Fetch current project and its pages
  const loadProjectDetails = useCallback(async (projectId) => {
    try {
      const res = await fetch(`/api/projects/${projectId}`);
      if (res.ok) {
        const data = await res.json();
        setCurrentProject(data.project);
        setPages(data.pages || []);
        return data;
      }
      // Project vanished (deleted in another tab) — fall back to the library.
      setCurrentProject(null);
      setPages([]);
      if (matchRoute().projectId === projectId) {
        navigate(LIBRARY_PATH, { replace: true });
      }
      return null;
    } catch (err) {
      console.error('Failed to load project details:', err);
      return null;
    }
  }, []);

  // Fetch settings
  const loadSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/settings');
      if (res.ok) {
        const data = await res.json();
        setSettings(data.settings || {});
      }
    } catch (err) {
      console.error('Failed to load settings:', err);
    }
  }, []);

  // Save settings
  const handleSaveSettings = async (newSettings) => {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newSettings)
    });
    if (res.ok) {
      const data = await res.json();
      setSettings(data.settings || newSettings);
    }
  };

  // Initial load
  useEffect(() => {
    loadProjects();
    loadSettings();
    fetch('/api/remote/status')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => data?.status && setRemoteStatus(data.status))
      .catch(() => {});
  }, [loadProjects, loadSettings]);

  // Unknown paths fall back to the library, keeping the URL honest.
  useEffect(() => {
    if (route.name === 'library' && window.location.pathname !== LIBRARY_PATH) {
      navigate(LIBRARY_PATH, { replace: true });
    }
  }, [route]);

  // Read the route without making page turns refetch the whole project.
  const routeRef = useRef(route);
  routeRef.current = route;

  // Load project data once per project route (not per page change)
  useEffect(() => {
    if (!currentProjectId) {
      setCurrentProject(null);
      setPages([]);
      return;
    }

    let cancelled = false;
    (async () => {
      const data = await loadProjectDetails(currentProjectId);
      if (cancelled || !data) return;

      const totalPages = (data.pages || []).length;
      const savedPage = data.project?.active_page ?? 0;
      const wanted = routeRef.current.pageNumber ?? savedPage;
      const page = totalPages > 0 ? Math.min(Math.max(wanted, 0), totalPages - 1) : 0;
      setActivePageNumber(page);

      // Normalize the URL so a refresh returns to the same page.
      if (routeRef.current.pageNumber !== page) {
        navigate(projectPath(currentProjectId, page), { replace: true });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [currentProjectId, loadProjectDetails]);

  // Follow the URL's page segment (deep links, back/forward navigation)
  useEffect(() => {
    const { pageNumber } = route;
    if (!currentProjectId || pageNumber === null) return;

    setActivePageNumber((prev) => {
      if (prev === pageNumber) return prev;
      return pages.length > 0
        ? Math.min(Math.max(pageNumber, 0), pages.length - 1)
        : pageNumber;
    });
  }, [route, currentProjectId, pages.length]);

  // SSE Subscription for live pipeline logs & events
  useEffect(() => {
    const eventSource = new EventSource('/api/events');

    eventSource.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data);

        if (event.type === 'log') {
          setLogs(prev => [...prev.slice(-300), event]);
        } else if (event.type === 'system_health') {
          setSystemHealth(event);
        } else if (event.type === 'remote_status') {
          setRemoteStatus(event.status || { state: 'stopped' });
        } else if (event.type === 'stage_status') {
          // Stage state is engine-wide: only mirror it for the project on screen.
          if (event.stages && (!event.projectId || event.projectId === currentProjectId)) {
            setPipelineStages(event.stages);
          }
        } else if (event.type === 'engine_state') {
          if (event.stages) setPipelineStages(event.stages);
        } else if (event.type === 'page_status') {
          if (event.projectId === currentProjectId) {
            // A lane reports its own stage; lanes advance independently so the
            // grid keeps one in-flight page per stage instead of a single one.
            const stage = event.stage || stageForStatus(event.status);
            if (stage) {
              setActiveRuns((prev) => ({
                ...prev,
                [stage]: stageForStatus(event.status) ? event.pageNumber : null
              }));
            }
            setPages(prevPages =>
              prevPages.map(p => {
                if (p.page_number === event.pageNumber) {
                  return { ...p, status: event.status, updated_at: Date.now() };
                }
                return p;
              })
            );
            // Refresh detailed page fields in background
            loadProjectDetails(event.projectId);
          }
        } else if (event.type === 'project_status') {
          if (event.projectId === currentProjectId) {
            setCurrentProject(prev => prev ? { ...prev, status: event.status } : null);
          }
          if (event.stages) setPipelineStages(event.stages);
          loadProjects();
        }
      } catch (err) {
        console.error('SSE parse error:', err);
      }
    };

    return () => {
      eventSource.close();
    };
  }, [currentProjectId, loadProjectDetails, loadProjects]);

  // Project Creation
  const handleCreateProject = async (payload, isUpload) => {
    const options = isUpload
      ? { method: 'POST', body: payload }
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        };

    const res = await fetch('/api/projects', options);
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to create project');
    }
    const data = await res.json();
    await loadProjects();
    if (data.project?.id) {
      navigate(projectPath(data.project.id));
    }
  };

  // Delete Project
  const handleDeleteProject = async (id) => {
    await fetch(`/api/projects/${id}`, { method: 'DELETE' });
    if (currentProjectId === id) {
      navigate(LIBRARY_PATH, { replace: true });
    }
    loadProjects();
  };

  // Select a page and mirror it in the URL so refresh/deep links keep it.
  const selectPage = useCallback(
    (pageNumber) => {
      setActivePageNumber(pageNumber);
      if (currentProjectId) {
        navigate(projectPath(currentProjectId, pageNumber), { replace: true });
      }
    },
    [currentProjectId]
  );

  // Pipeline Actions
  const handleStartPipeline = async (id, stage = null) => {
    await fetch(`/api/projects/${id}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage })
    });
  };

  const handlePausePipeline = async (id, stage = null) => {
    await fetch(`/api/projects/${id}/pause`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage })
    });
  };

  const handleResumePipeline = async (id, stage = null) => {
    await fetch(`/api/projects/${id}/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage })
    });
  };

  const handleStepPipeline = async (id, pageNum = null, stage = null) => {
    await fetch(`/api/projects/${id}/step`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageNumber: pageNum, stage })
    });
  };

  const handleStopPipeline = async (id) => {
    await fetch(`/api/projects/${id}/stop`, { method: 'POST' });
  };

  // Remote Colab GPU worker controls
  const handleRemoteStart = async () => {
    const res = await fetch('/api/remote/start', { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Failed to start the Colab GPU worker');
    if (data.status) setRemoteStatus(data.status);
    return data.status;
  };

  const handleRemoteStop = async () => {
    const res = await fetch('/api/remote/stop', { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Failed to stop the Colab GPU worker');
    if (data.status) setRemoteStatus(data.status);
    return data.status;
  };

  const handleRegeneratePage = async (projectId, pageNum, mode = 'narration') => {
    const res = await fetch(`/api/projects/${projectId}/pages/${pageNum}/regenerate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, start: true })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to regenerate page');
    }
    await loadProjectDetails(projectId);
    loadProjects();
  };

  const handleRegenerateProject = async (projectId, mode = 'narration') => {
    const res = await fetch(`/api/projects/${projectId}/regenerate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, start: true })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to regenerate project');
    }
    await loadProjectDetails(projectId);
    loadProjects();
  };

  /**
   * Apply a page-list mutation (insert / delete / edit) coming back from the API.
   * The active page follows its own row id, so re-indexing never jumps the reader
   * to an unrelated page.
   */
  const applyPageMutation = (data, previousActiveId) => {
    const nextPages = data.pages || [];
    setPages(nextPages);
    if (data.project) setCurrentProject(data.project);

    const stillThere = previousActiveId
      ? nextPages.find((p) => p.id === previousActiveId)
      : null;
    const target = stillThere
      ? stillThere.page_number
      : Math.max(0, Math.min(activePageNumber, nextPages.length - 1));
    selectPage(target);
  };

  const activePageId = pages.find((p) => p.page_number === activePageNumber)?.id;

  // Insert a custom text page at any position (no OCR for custom pages)
  const handleAddPage = async (projectId, position, text) => {
    const res = await fetch(`/api/projects/${projectId}/pages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ position, text })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Failed to add page');

    applyPageMutation(data, activePageId);
    loadProjects();
    return data;
  };

  // Edit a page's text (custom or PDF: raw OCR, refined script, or both)
  const handleUpdatePageText = async (projectId, pageNumber, payload) => {
    const body = typeof payload === 'string' ? { text: payload } : payload;
    const res = await fetch(`/api/projects/${projectId}/pages/${pageNumber}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Failed to update page');

    applyPageMutation(data, activePageId);
    loadProjects();
    return data;
  };

  // Delete a page at any position
  const handleDeletePage = async (projectId, pageNumber) => {
    const res = await fetch(`/api/projects/${projectId}/pages/${pageNumber}`, {
      method: 'DELETE'
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Failed to delete page');

    applyPageMutation(data, activePageId);
    loadProjects();
    return data;
  };

  // Bulk delete selected pages in a single request (atomic re-index server-side)
  const handleDeletePages = async (projectId, pageIds) => {
    const res = await fetch(`/api/projects/${projectId}/pages`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageIds })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Failed to delete pages');

    applyPageMutation(data, activePageId);
    loadProjects();
    return data;
  };

  // No stage running means no page can be in flight — drop the stale pointers.
  useEffect(() => {
    const anyRunning = Object.values(pipelineStages || {}).some((state) => state === 'running');
    if (!anyRunning) setActiveRuns({});
  }, [pipelineStages]);

  return (
    <div className="min-h-screen bg-obsidian-900 text-slate-100 flex flex-col font-sans">
      {route.name === 'usage' ? (
        <ApiUsageDashboard projects={projects} onBack={() => navigate(LIBRARY_PATH)} />
      ) : route.name === 'voices' ? (
        <VoiceStudio
          onBack={() => navigate(LIBRARY_PATH)}
          onOpenSettings={() => setIsSettingsOpen(true)}
          onOpenModels={() => navigate(MODELS_PATH)}
        />
      ) : route.name === 'models' ? (
        <ModelHub
          onBack={() => navigate(LIBRARY_PATH)}
          onOpenSettings={() => setIsSettingsOpen(true)}
          onOpenVoices={() => navigate(VOICES_PATH)}
          onOpenUsage={() => navigate(USAGE_PATH)}
          onSettingsChanged={(next) => next && setSettings(next)}
        />
      ) : currentProjectId && currentProject ? (
        <ProjectWorkspace
          project={currentProject}
          pages={pages}
          activePageNumber={activePageNumber}
          logs={logs}
          systemHealth={systemHealth}
          remoteStatus={remoteStatus}
          pipelineStages={pipelineStages}
          activeRuns={activeRuns}
          onRemoteStart={handleRemoteStart}
          onRemoteStop={handleRemoteStop}
          onBack={() => {
            navigate(LIBRARY_PATH);
            loadProjects();
          }}
          onOpenSettings={() => setIsSettingsOpen(true)}
          onOpenUsage={() => navigate(USAGE_PATH)}
          onOpenVoices={() => navigate(VOICES_PATH)}
          onOpenModels={() => navigate(MODELS_PATH)}
          onStartPipeline={handleStartPipeline}
          onPausePipeline={handlePausePipeline}
          onResumePipeline={handleResumePipeline}
          onStepPipeline={handleStepPipeline}
          onStopPipeline={handleStopPipeline}
          onSelectPage={selectPage}
          onRegeneratePage={handleRegeneratePage}
          onRegenerateProject={handleRegenerateProject}
          onAddPage={(position, text) => handleAddPage(currentProject.id, position, text)}
          onUpdatePageText={(pageNumber, text) => handleUpdatePageText(currentProject.id, pageNumber, text)}
          onDeletePage={(pageNumber) => handleDeletePage(currentProject.id, pageNumber)}
          onDeletePages={(pageIds) => handleDeletePages(currentProject.id, pageIds)}
          onRefreshProject={() => loadProjectDetails(currentProject.id)}
          onClearLogs={() => setLogs([])}
        />
      ) : currentProjectId ? (
        <div className="flex-1 flex items-center justify-center gap-3 text-slate-400 py-24">
          <Loader2 className="w-5 h-5 animate-spin text-brand-400" />
          <span className="text-sm">Loading project…</span>
        </div>
      ) : (
        <ProjectList
          projects={projects}
          onSelectProject={(id) => navigate(projectPath(id))}
          onNewProject={() => setIsNewProjectOpen(true)}
          onDeleteProject={handleDeleteProject}
          onOpenUsage={() => navigate(USAGE_PATH)}
          onOpenVoices={() => navigate(VOICES_PATH)}
          onOpenModels={() => navigate(MODELS_PATH)}
          onOpenSettings={() => setIsSettingsOpen(true)}
        />
      )}

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        initialSettings={settings}
        onSave={handleSaveSettings}
        remoteStatus={remoteStatus}
        onRemoteStart={handleRemoteStart}
        onRemoteStop={handleRemoteStop}
      />

      {/* New Project Modal */}
      <NewProjectModal
        isOpen={isNewProjectOpen}
        onClose={() => setIsNewProjectOpen(false)}
        onCreateProject={handleCreateProject}
      />
    </div>
  );
}
