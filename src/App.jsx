import React, { useEffect, Suspense, lazy } from 'react';
import { ArachnoForgeProvider, useArachnoForge } from './context/ArachnoForgeContext.jsx';
import { useAuthContext } from './context/AuthContext.jsx';
import { useArachnoForgeRouter, ROUTES } from './hooks/useArachnoForgeRouter.js';
import Sidebar from './components/Sidebar.jsx';
import CyberToastStack from './components/CyberToast.jsx';
import PageErrorBoundary from './components/PageErrorBoundary.jsx';
import NexusGate from './components/NexusGate.jsx';
import BootScreen from './components/BootScreen.jsx';
import MaxCarnageBanner from './components/MaxCarnageBanner.jsx';
import { APP_BG } from './utils/designSystem.js';

// V34.3 — Code-splitting per rotta (risolve il warning Vite/Vercel "Some
// chunks are larger than 500 kB after minification"): ognuna delle 7
// pagine viene scaricata SOLO al primo accesso a quella rotta, invece di
// finire tutte nell'unico bundle iniziale — bundle di primo caricamento
// molto più leggero, decisivo su rete mobile. `PageErrorBoundary` +
// `Suspense` (vedi Shell più sotto) restano gli unici due punti che
// reagiscono rispettivamente a un errore di rendering o al breve
// caricamento del chunk.
const MissionControl = lazy(() => import('./pages/MissionControl.jsx'));
const QuadrantHub = lazy(() => import('./pages/QuadrantHub.jsx'));
const BossFight = lazy(() => import('./pages/BossFight.jsx'));
const StarLog = lazy(() => import('./pages/StarLog.jsx'));
const Armory = lazy(() => import('./pages/Armory.jsx'));
const CoreConfig = lazy(() => import('./pages/CoreConfig.jsx'));
const MultiverseSimulator = lazy(() => import('./pages/MultiverseSimulator.jsx'));

function PageSwitch({ currentPage }) {
  switch (currentPage) {
    case ROUTES.QUADRANT_HUB:
      return <QuadrantHub />;
    case ROUTES.BOSS_FIGHT:
      return <BossFight />;
    case ROUTES.STAR_LOG:
      return <StarLog />;
    case ROUTES.ARMORY:
      return <Armory />;
    case ROUTES.MULTIVERSE_SIMULATOR:
      return <MultiverseSimulator />;
    case ROUTES.CORE_CONFIG:
      return <CoreConfig />;
    case ROUTES.MISSION_CONTROL:
    default:
      return <MissionControl />;
  }
}

/** Fallback leggero durante il caricamento del chunk di una pagina — mai il
 * BootScreen a schermo intero (quello resta riservato al boot di sessione/
 * Cloud Sync): qui basta un piccolo respiro visivo coerente con l'HUD, la
 * Sidebar e il resto della Shell restano sempre visibili e interattivi. */
function PageLoadingFallback() {
  return (
    <div className="flex items-center justify-center py-24">
      <span className="w-10 h-10 rounded-full border-[3px] border-secondary/25 border-t-secondary animate-spin" />
    </div>
  );
}

function Shell() {
  const { currentPage, navigate } = useArachnoForgeRouter();
  const { state, derived, toasts, dismissToast } = useArachnoForge();

  // V16.0 True Theme Engine (Pillar 3): l'attributo vive su <body>, non
  // più su <html> — le variabili CSS del costume attivo (index.css,
  // [data-theme=...]) cascano comunque su tutto l'albero React sottostante.
  useEffect(() => {
    document.body.dataset.theme = state.settings.suit || 'classic';
    return () => {
      delete document.body.dataset.theme;
    };
  }, [state.settings.suit]);

  // V27.0 — Pillar 3 (Maximum Carnage Mode): stesso pattern del True Theme
  // Engine — [data-carnage] su <body> ritinteggia istantaneamente l'intera
  // app in nero/argento/rosso simbionte (vedi index.css), senza toccare
  // un solo componente esistente.
  useEffect(() => {
    if (derived.isMaxCarnageActive) {
      document.body.dataset.carnage = 'true';
    } else {
      delete document.body.dataset.carnage;
    }
    return () => {
      delete document.body.dataset.carnage;
    };
  }, [derived.isMaxCarnageActive]);

  const showInterference = derived.fatigued && !state.settings.calmMode;

  return (
    // V26.0 — "The Nexus Gate": ingresso in fade-in + blur-out (af-shell-fade-in,
    // vedi index.css) ogni volta che la Shell viene montata per la prima
    // volta dopo un login riuscito — la "porta che si apre sull'hub".
    // V34.3 — "100dvh" al posto di "100vh"/h-screen: sui browser mobili la
    // viewport unit classica include (o esclude, a seconda del motore)
    // l'ingombro reale della barra degli indirizzi in modo incoerente fra
    // orientamento verticale/orizzontale — sintomo tipico "funziona in
    // orizzontale, tagliato/traballante in verticale". La Dynamic Viewport
    // Height si ricalcola invece SEMPRE sullo spazio realmente visibile.
    <div className={`flex min-h-[100dvh] relative af-shell-fade-in ${APP_BG}`}>
      <div className="af-grain" />
      {/* V27.0 — Pillar 3: vignette simbionte a schermo intero, sopra ogni
          pagina ma sotto toast/modali — Feedback Sensoriale Completo. */}
      {derived.isMaxCarnageActive && <div className="af-carnage-overlay" />}
      <Sidebar currentPage={currentPage} navigate={navigate} />
      <main
        className={`flex-1 min-w-0 h-[100dvh] overflow-y-auto af-viewport px-4 py-6 md:px-8 md:py-8 transition-all duration-500 relative ${
          derived.fatigued ? 'saturate-[0.4] brightness-90 ring-1 ring-inset ring-af-attack/30' : ''
        }`}
      >
        {showInterference && <div className="af-interference" />}
        <div className="max-w-[1400px] mx-auto pt-10 md:pt-0">
          <MaxCarnageBanner />
          <PageErrorBoundary key={currentPage} onRecover={() => navigate(ROUTES.MISSION_CONTROL)}>
            <Suspense fallback={<PageLoadingFallback />}>
              <PageSwitch currentPage={currentPage} />
            </Suspense>
          </PageErrorBoundary>
        </div>
      </main>
      <CyberToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

/**
 * V26.0 — "The Nexus Gate" (Pillar 2: Authentication Logic). App è ora il
 * "portiere" dell'intera esperienza:
 *   - sessione in bootstrap (`loading`)         -> BootScreen
 *   - nessuna sessione attiva (`session === null`) -> SOLO il NexusGate
 *   - sessione valida                            -> ArachnoForgeProvider + Shell
 * `key={session.user.id}` forza un ArachnoForgeProvider completamente
 * nuovo ad ogni cambio di utente (logout + login con account diverso):
 * nessuno stato/ref del provider precedente può mai sopravvivere e
 * "trapelare" nella sessione successiva.
 */
export default function App() {
  const { session, loading, isGuest } = useAuthContext();

  if (loading) {
    return <BootScreen message="Verifica sessione Nexus in corso..." />;
  }

  // V28.1 — Pillar 2: Modalità Ospite monta lo stesso Provider di una
  // sessione reale (stessa Shell, stesse pagine) — cambia solo il backend
  // di persistenza scelto DENTRO ArachnoForgeProvider (vedi `storageMode`),
  // mai la logica di routing/gating qui.
  if (!session && !isGuest) {
    return <NexusGate />;
  }

  return (
    <ArachnoForgeProvider key={session ? session.user.id : 'guest-local'}>
      <Shell />
    </ArachnoForgeProvider>
  );
}
