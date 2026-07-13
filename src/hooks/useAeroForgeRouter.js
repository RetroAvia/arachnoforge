import { useState, useEffect, useCallback } from 'react';

/**
 * Router SPA custom basato su window.location.hash — nessuna dipendenza
 * esterna (niente react-router-dom). Sincronizzato con l'evento nativo
 * 'hashchange' per supportare avanti/indietro del browser.
 */
export const ROUTES = {
  MISSION_CONTROL: 'mission-control',
  QUADRANT_HUB: 'quadrant-hub',
  BOSS_FIGHT: 'boss-fight',
  STAR_LOG: 'star-log',
  ARMORY: 'armory',
  CORE_CONFIG: 'core-config'
};

const VALID_ROUTES = new Set(Object.values(ROUTES));
const DEFAULT_ROUTE = ROUTES.MISSION_CONTROL;

function parseHash() {
  const raw = window.location.hash.replace(/^#\/?/, '').trim();
  return VALID_ROUTES.has(raw) ? raw : DEFAULT_ROUTE;
}

export function useArachnoForgeRouter() {
  const [currentPage, setCurrentPage] = useState(parseHash);

  useEffect(() => {
    const onHashChange = () => setCurrentPage(parseHash());
    window.addEventListener('hashchange', onHashChange);
    if (!window.location.hash) {
      window.location.hash = `/${DEFAULT_ROUTE}`;
    }
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const navigate = useCallback((route) => {
    if (!VALID_ROUTES.has(route)) return;
    if (parseHash() === route) return;
    window.location.hash = `/${route}`;
  }, []);

  return { currentPage, navigate, ROUTES };
}
