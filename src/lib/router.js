import { useEffect, useState } from 'react';

/**
 * Minimal history-API router.
 * Routes:
 *   /                          -> library
 *   /projects/:id              -> project workspace (page from server state)
 *   /projects/:id/pages/:page  -> project workspace at a specific page (1-based in URL)
 *   /usage                     -> API usage dashboard
 *   /voices                    -> voice library (voice cloning studio)
 */

export const LIBRARY_PATH = '/';
export const USAGE_PATH = '/usage';
export const VOICES_PATH = '/voices';
export const MODELS_PATH = '/models';

export const projectPath = (projectId, pageNumber) => {
  const base = `/projects/${encodeURIComponent(projectId)}`;
  // URL pages are 1-based so deep links read naturally; 0 maps to page 1.
  return Number.isInteger(pageNumber) ? `${base}/pages/${pageNumber + 1}` : base;
};

export function matchRoute(pathname = window.location.pathname) {
  const clean = `/${pathname.replace(/^\/+|\/+$/g, '')}`;

  if (clean === '/') return { name: 'library' };

  if (clean === '/usage') return { name: 'usage' };

  if (clean === '/voices') return { name: 'voices' };

  if (clean === '/models') return { name: 'models' };

  const projectMatch = clean.match(/^\/projects\/([A-Za-z0-9_-]+)(?:\/pages\/(\d+))?$/);
  if (projectMatch) {
    const urlPage = projectMatch[2];
    return {
      name: 'project',
      projectId: projectMatch[1],
      pageNumber: urlPage === undefined ? null : Math.max(0, Number(urlPage) - 1)
    };
  }

  return { name: 'library' };
}

export function navigate(path, { replace = false } = {}) {
  const current = `${window.location.pathname}${window.location.search}`;
  if (path === current) return;

  if (replace) {
    window.history.replaceState(null, '', path);
  } else {
    window.history.pushState(null, '', path);
  }
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function useRoute() {
  const [route, setRoute] = useState(() => matchRoute());

  useEffect(() => {
    const onLocationChange = () => setRoute(matchRoute());
    window.addEventListener('popstate', onLocationChange);
    return () => window.removeEventListener('popstate', onLocationChange);
  }, []);

  return route;
}
