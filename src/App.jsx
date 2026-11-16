import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ProjectList } from './components/ProjectList';
import { ProjectWorkspace } from './components/ProjectWorkspace';
import { SettingsModal } from './components/SettingsModal';
import { NewProjectModal } from './components/NewProjectModal';
import { ApiUsageDashboard } from './components/ApiUsageDashboard';
import { VoiceStudio } from './components/VoiceStudio';
import { Loader2 } from 'lucide-react';
import { stageForStatus } from './lib/pageStages';
import { useTheme } from './lib/theme';
import {
  useRoute,
  navigate,
  matchRoute,
  projectPath,
  LIBRARY_PATH,
  USAGE_PATH,
  VOICES_PATH,
  MODELS_PATH,
  SETTINGS_PATH
} from './lib/router';
import { SettingsView } from './components/SettingsView';
import { GlobalAudioProvider, useAudioPlayer } from './lib/audioPlayerContext';
import { FloatingAudioPlayer } from './components/FloatingAudioPlayer';

export function App() {
  const autoFollowRef = useRef(null);
  return (
    <GlobalAudioProvider
      onAutoFollowPage={(projId, prevPage, nextPage) => {
        autoFollowRef.current?.(projId, prevPage, nextPage);
      }}
    >
      <AppContent autoFollowRef={autoFollowRef} />
    </GlobalAudioProvider>
  );
}

function AppContent({ autoFollowRef }) {
  const { theme, isDark } = useTheme();
  const route = useRoute();
  const currentProjectId = route.name === 'project' ? route.projectId : null;
  const audioPlayer = useAudioPlayer();

  const [projects, setProjects] = useState([]);
  const [currentProject, setCurrentProject] = useState(null);
  const [pages, setPages] = useState([]);
  const [activePageNumber, setActivePageNumber] = useState(0);

  const [settings, setSettings] = useState({});
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isNewProjectOpen, setIsNewProjectOpen] = useState(false);

  const [logsByProject, setLogsByProject] = useState({});
  const [remoteStatus, setRemoteStatus] = useState({ state: 'stopped' });
  // Per-project stage states (ocr / refine / audio) and active page pointers so
  // multiple projects can run simultaneously without bleeding UI state.
  const [stagesByProject, setStagesByProject] = useState({});
  const [activeRunsByProject, setActiveRunsByProject] = useState({});
  const [systemHealth, setSystemHealth] = useState({
    cpuCount: 8,
    load1m: '0.00',
    totalMemMB: 8192,
    usedMemMB: 4096,
    memPercent: 50
  });

  const currentProjectIdRef = useRef(currentProjectId);
  currentProjectIdRef.current = currentProjectId;

  const pipelineStages = (currentProjectId && stagesByProject[currentProjectId]) || {
    ocr: 'idle',
    refine: 'idle',
    audio: 'idle'
  };
  const activeRuns = (currentProjectId && activeRunsByProject[currentProjectId]) || {};
  const projectLogs = (currentProjectId && logsByProject[currentProjectId]) || [];

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

  // Fetch current project and its pages + project-scoped pipeline state
  const loadProjectDetails = useCallback(async (projectId) => {
    try {
      const res = await fetch(`/api/projects/${projectId}`);
      if (res.ok) {
        const data = await res.json();
        if (data.pipeline) {
          if (data.pipeline.stages) {
            setStagesByProject((prev) => ({ ...prev, [projectId]: data.pipeline.stages }));
          }
          if (data.pipeline.activeRuns) {
            setActiveRunsByProject((prev) => ({ ...prev, [projectId]: data.pipeline.activeRuns }));
          }
          if (Array.isArray(data.pipeline.logs)) {
            setLogsByProject((prev) => ({ ...prev, [projectId]: data.pipeline.logs }));
          }
        }
        if (currentProjectIdRef.current === projectId) {
          setCurrentProject(data.project);
          setPages(data.pages || []);
        }
        return data;
      }
      // Project vanished (deleted in another tab) — fall back to the library.
      if (currentProjectIdRef.current === projectId) {
        setCurrentProject(null);
        setPages([]);
      }
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
    setCurrentProject(null);
    setPages([]);
    if (!currentProjectId) {
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

  // SSE Subscription for live pipeline logs & events (scoped per project)
  useEffect(() => {
    const eventSource = new EventSource('/api/events');

    eventSource.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data);
        const activeProjId = currentProjectIdRef.current;

        if (event.type === 'log') {
          if (event.projectId) {
            setLogsByProject((prev) => ({
              ...prev,
              [event.projectId]: [...(prev[event.projectId] || []).slice(-299), event]
            }));
          }
        } else if (event.type === 'logs_cleared') {
          if (event.projectId) {
            setLogsByProject((prev) => ({ ...prev, [event.projectId]: [] }));
          }
        } else if (event.type === 'system_health') {
          setSystemHealth(event);
        } else if (event.type === 'remote_status') {
          setRemoteStatus(event.status || { state: 'stopped' });
        } else if (event.type === 'stage_status') {
          if (event.projectId && event.stages) {
            setStagesByProject((prev) => ({ ...prev, [event.projectId]: event.stages }));
          }
          if (event.projectId && event.activeRuns) {
            setActiveRunsByProject((prev) => ({ ...prev, [event.projectId]: event.activeRuns }));
          }
        } else if (event.type === 'engine_state') {
          if (event.projects && typeof event.projects === 'object') {
            setStagesByProject((prev) => {
              const next = { ...prev };
              for (const [id, snap] of Object.entries(event.projects)) {
                if (snap?.stages) next[id] = snap.stages;
              }
              return next;
            });
            setActiveRunsByProject((prev) => {
              const next = { ...prev };
              for (const [id, snap] of Object.entries(event.projects)) {
                if (snap?.activeRuns) next[id] = snap.activeRuns;
              }
              return next;
            });
          } else if (event.activeProjectId && event.stages) {
            setStagesByProject((prev) => ({ ...prev, [event.activeProjectId]: event.stages }));
          }
        } else if (event.type === 'page_status') {
          if (event.projectId) {
            const stage = event.stage || stageForStatus(event.status);
            if (event.activeRuns) {
              setActiveRunsByProject((prev) => ({ ...prev, [event.projectId]: event.activeRuns }));
            } else if (stage) {
              setActiveRunsByProject((prev) => ({
                ...prev,
                [event.projectId]: {
                  ...(prev[event.projectId] || {}),
                  [stage]: stageForStatus(event.status) ? event.pageNumber : null
                }
              }));
            }
          }

          if (event.projectId === activeProjId) {
            setPages((prevPages) =>
              prevPages.map((p) => {
                if (p.page_number === event.pageNumber) {
                  return { ...p, status: event.status, updated_at: Date.now() };
                }
                return p;
              })
            );
            // Refresh detailed page fields in background
            loadProjectDetails(event.projectId);
          } else if (
            event.status === 'ready' &&
            audioPlayer.session.projectId === event.projectId
          ) {
            fetch(`/api/projects/${event.projectId}`)
              .then((r) => (r.ok ? r.json() : null))
              .then((data) => {
                if (data) {
                  audioPlayer.updateProjectPagesIfMatch(
                    event.projectId,
                    data.project,
                    data.pages
                  );
                }
              })
              .catch(() => {});
          }
          if (event.status === 'ready') {
            loadProjects();
          }
        } else if (event.type === 'project_status') {
          if (event.projectId && event.stages) {
            setStagesByProject((prev) => ({ ...prev, [event.projectId]: event.stages }));
          }
          if (event.projectId && event.activeRuns) {
            setActiveRunsByProject((prev) => ({ ...prev, [event.projectId]: event.activeRuns }));
          }
          if (event.projectId === activeProjId) {
            setCurrentProject((prev) =>
              prev && prev.id === event.projectId ? { ...prev, status: event.status } : prev
            );
          }
          loadProjects();
        }
      } catch (err) {
        console.error('SSE parse error:', err);
      }
    };

    return () => {
      eventSource.close();
    };
  }, [loadProjectDetails, loadProjects, audioPlayer]);

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

  // Rename Project (inline title edit) — no updated_at bump, so library order holds
  const handleRenameProject = async (id, name) => {
    const res = await fetch(`/api/projects/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Could not rename this book.');
    }
    const data = await res.json();
    const renamed = data.project;

    setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, name: renamed.name } : p)));
    setCurrentProject((prev) => (prev && prev.id === id ? { ...prev, name: renamed.name } : prev));
    return renamed;
  };

  // Delete Project
  const handleDeleteProject = async (id) => {
    if (audioPlayer.session.projectId === id) {
      audioPlayer.stopAndDismiss();
    }
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

  // Follow auto-advancing audio pages only when viewing that exact playing page
  useEffect(() => {
    autoFollowRef.current = (projId, prevPage, nextPage) => {
      if (currentProjectId === projId && activePageNumber === prevPage) {
        selectPage(nextPage);
      }
    };
  }, [autoFollowRef, currentProjectId, activePageNumber, selectPage]);

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

  // No stage running on the active project means no page can be in flight for it.
  useEffect(() => {
    if (!currentProjectId) return;
    const anyRunning = Object.values(pipelineStages || {}).some((state) => state === 'running');
    if (!anyRunning) {
      setActiveRunsByProject((prev) => {
        const existing = prev[currentProjectId];
        if (!existing || Object.values(existing).every((v) => v === null || v === undefined)) {
          return prev;
        }
        return { ...prev, [currentProjectId]: {} };
      });
    }
  }, [currentProjectId, pipelineStages]);

  return (
    <div className="min-h-screen bg-obsidian-900 text-slate-100 flex flex-col font-sans">
      {route.name === 'settings' || route.name === 'usage' || route.name === 'voices' || route.name === 'models' || isSettingsOpen ? (
        <SettingsView
          tab={route.tab || (route.name !== 'settings' ? route.name : 'general')}
          initialSettings={settings}
          projects={projects}
          onSave={handleSaveSettings}
          onBack={() => {
            setIsSettingsOpen(false);
            navigate(LIBRARY_PATH);
          }}
          remoteStatus={remoteStatus}
          onRemoteStart={handleRemoteStart}
          onRemoteStop={handleRemoteStop}
        />
      ) : currentProjectId && currentProject && currentProject.id === currentProjectId ? (
        <ProjectWorkspace
          project={currentProject}
          pages={pages}
          activePageNumber={activePageNumber}
          logs={projectLogs}
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
          onOpenSettings={() => navigate(SETTINGS_PATH)}
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
          onRenameProject={handleRenameProject}
          onDeleteProject={handleDeleteProject}
          onAddPage={(position, text) => handleAddPage(currentProject.id, position, text)}
          onUpdatePageText={(pageNumber, text) => handleUpdatePageText(currentProject.id, pageNumber, text)}
          onDeletePage={(pageNumber) => handleDeletePage(currentProject.id, pageNumber)}
          onDeletePages={(pageIds) => handleDeletePages(currentProject.id, pageIds)}
          onRefreshProject={() => loadProjectDetails(currentProject.id)}
          onClearLogs={() => {
            setLogsByProject((prev) => ({ ...prev, [currentProject.id]: [] }));
            fetch(`/api/projects/${currentProject.id}/logs`, { method: 'DELETE' }).catch(() => {});
          }}
        />
      ) : currentProjectId ? (
        <div className="flex-1 flex items-center justify-center gap-3 text-slate-400 py-24">
          <Loader2 className="w-5 h-5 animate-spin text-brand-400" />
          <span className="text-sm">Loading project…</span>
        </div>
      ) : (
        <ProjectList
          projects={projects}
          onSelectProject={(id) => {
            if (
              audioPlayer.session.isActive &&
              audioPlayer.session.projectId === id
            ) {
              navigate(projectPath(id, audioPlayer.session.playingPageNumber));
            } else {
              navigate(projectPath(id));
            }
          }}
          onNewProject={() => setIsNewProjectOpen(true)}
          onDeleteProject={handleDeleteProject}
          onRenameProject={handleRenameProject}
          onOpenUsage={() => navigate(USAGE_PATH)}
          onOpenVoices={() => navigate(VOICES_PATH)}
          onOpenModels={() => navigate(MODELS_PATH)}
          onOpenSettings={() => navigate(SETTINGS_PATH)}
        />
      )}

      {/* Persistent Floating Audio Mini-Player across Library, Settings, and other views */}
      <FloatingAudioPlayer
        currentRouteProjectId={
          route.name === 'project' &&
          !isSettingsOpen
            ? currentProjectId
            : null
        }
        onOpenPlayingPage={(projId, pageNum) => {
          setIsSettingsOpen(false);
          navigate(projectPath(projId, pageNum));
        }}
      />

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
