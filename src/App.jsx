import React, { useEffect } from 'react';
import { ArachnoForgeProvider, useArachnoForge } from './context/ArachnoForgeContext.jsx';
import { useArachnoForgeRouter, ROUTES } from './hooks/useArachnoForgeRouter.js';
import Sidebar from './components/Sidebar.jsx';
import CyberToastStack from './components/CyberToast.jsx';
import PageErrorBoundary from './components/PageErrorBoundary.jsx';
import { APP_BG } from './utils/designSystem.js';
import MissionControl from './pages/MissionControl.jsx';
import QuadrantHub from './pages/QuadrantHub.jsx';
import BossFight from './pages/BossFight.jsx';
import StarLog from './pages/StarLog.jsx';
import Armory from './pages/Armory.jsx';
import CoreConfig from './pages/CoreConfig.jsx';
import MultiverseSimulator from './pages/MultiverseSimulator.jsx';

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

  const showInterference = derived.fatigued && !state.settings.calmMode;

  return (
    <div className={`flex min-h-screen relative ${APP_BG}`}>
      <div className="af-grain" />
      <Sidebar currentPage={currentPage} navigate={navigate} />
      <main
        className={`flex-1 min-w-0 h-screen overflow-y-auto af-viewport px-4 py-6 md:px-8 md:py-8 transition-all duration-500 relative ${
          derived.fatigued ? 'saturate-[0.4] brightness-90 ring-1 ring-inset ring-af-attack/30' : ''
        }`}
      >
        {showInterference && <div className="af-interference" />}
        <div className="max-w-[1400px] mx-auto pt-10 md:pt-0">
          <PageErrorBoundary key={currentPage} onRecover={() => navigate(ROUTES.MISSION_CONTROL)}>
            <PageSwitch currentPage={currentPage} />
          </PageErrorBoundary>
        </div>
      </main>
      <CyberToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

export default function App() {
  return (
    <ArachnoForgeProvider>
      <Shell />
    </ArachnoForgeProvider>
  );
}
