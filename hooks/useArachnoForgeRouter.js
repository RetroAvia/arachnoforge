import { useState, useEffect, useCallback } from 'react';

/**
 * Router SPA custom basato su window.location.hash — nessuna dipendenza
 * esterna (niente react-router-dom). Sincronizzato con l'evento nativo
 * 'hashchange' per supportare avanti/indietro del browser.
 */
export const ROUTES = {
  MISSION_CONTROL: 'mission-control',
  QUADRANT_HUB: 'quadrant-hub',
  // V39.0 — Empire State University: semestre, orario, lezioni/sessione.
  CAMPUS: 'campus',
  BOSS_FIGHT: 'boss-fight',
  STAR_LOG: 'star-log',
  ARMORY: 'armory',
  CORE_CONFIG: 'core-config',
  MULTIVERSE_SIMULATOR: 'multiverse-simulator',
  SUIT_TELEMETRY: 'suit-telemetry'
};

const VALID_ROUTES = new Set(Object.values(ROUTES));
const DEFAULT_ROUTE = ROUTES.MISSION_CONTROL;

function parseHash() {
  const raw = window.location.hash.replace(/^#\/?/, '').trim();
  return VALID_ROUTES.has(raw) ? raw : DEFAULT_ROUTE;
}

/**
 * V39.0 — Navigazione da qualunque pagina, senza passare l'hook come
 * prop: il router ascolta `hashchange`, quindi basta cambiare l'hash. Usata
 * per esempio da Empire State University, che avvia una sessione di
 * sintesi e porta direttamente al timer.
 */
export function goTo(route) {
  if (!VALID_ROUTES.has(route)) return;
  if (parseHash() === route) return;
  window.location.hash = `/${route}`;
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
