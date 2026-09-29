import React, { useState, useEffect } from 'react';
import { useArachnoForge } from '../context/ArachnoForgeContext.jsx';
import { Icon } from './Icons.jsx';
import { BADGE } from '../utils/designSystem.js';
import { maxCarnageMsRemaining, formatMsRemaining, CRITICAL_ACTION_THRESHOLD } from '../utils/maxCarnage.js';

/**
 * V27.0 — Pillar 3: banner globale "MAXIMUM CARNAGE MODE", montato in cima
 * (V42: la finestra si apre solo quando attivi una carica, e la Stamina
 * non è più gratis) 
 * a ogni pagina (App.jsx) quando la finestra da 2 ore è attiva. Il
 * countdown vive in un timer LOCALE da 1s (non nel Context/`nowTick`, che
 * tikka ogni 60s) per restare fluido senza forzare un re-render globale
 * dell'intera app ogni secondo — solo questo piccolo componente si
 * aggiorna cosi' spesso.
 *
 * Mobile-first: pila verticale compatta su schermi stretti (icona + testo
 * + countdown impilati), riga singola orizzontale da `sm:` in su — mai
 * un overflow orizzontale su smartphone.
 */
export default function MaxCarnageBanner() {
  const { derived, state, actions } = useArachnoForge();
  const [msRemaining, setMsRemaining] = useState(() => maxCarnageMsRemaining(state.profile));
  // V40.3 — "cos'è e come si è attivata" non era scritto da nessuna parte.
  const [spiegazioneAperta, setSpiegazioneAperta] = useState(false);
  const droneAcceso = state.settings.carnageDrone !== false;

  useEffect(() => {
    if (!derived.isMaxCarnageActive) return undefined;
    setMsRemaining(maxCarnageMsRemaining(state.profile));
    const id = setInterval(() => setMsRemaining(maxCarnageMsRemaining(state.profile)), 1000);
    return () => clearInterval(id);
  }, [derived.isMaxCarnageActive, state.profile]);

  if (!derived.isMaxCarnageActive) return null;

  return (
    <div className="af-carnage-in af-carnage-pulse ds-card-nopad !border-primary/45 mb-5">
      <div className="px-4 py-3 sm:px-5 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="w-9 h-9 rounded-lg bg-primary/10 border border-primary/35 flex items-center justify-center text-primary shrink-0">
            <Icon name="skull" className="w-[18px] h-[18px]" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-primary">Maximum Carnage Mode</p>
            <p className="text-xs text-slate-400 mt-0.5">Il simbionte ha il controllo: XP raddoppiati per due ore. La Stamina si consuma come sempre.</p>
          </div>
        </div>
        <div className="flex items-center gap-2 justify-between sm:justify-end">
          <span className={BADGE.red}>
            <Icon name="bolt" className="w-3.5 h-3.5" />
            XP ×2
          </span>
          <span className="ds-num font-mono text-base font-semibold text-white min-w-[4.5rem] text-right" aria-label="Tempo rimasto">
            {formatMsRemaining(msRemaining)}
          </span>
          <div className="flex items-center">
            {/* V40.3 — il drone simbionte si zittisce da qui, senza spegnere
                tutti gli effetti sonori e senza cercare l'interruttore nelle
                Impostazioni mentre stai studiando. */}
            <button
              type="button"
              onClick={() => actions.updateSettings({ carnageDrone: !droneAcceso })}
              aria-pressed={!droneAcceso}
              aria-label={droneAcceso ? 'Zittisci il drone simbionte' : 'Riattiva il drone simbionte'}
              title={droneAcceso ? 'Zittisci il drone simbionte' : 'Riattiva il drone simbionte'}
              className={`ds-icon-btn ${droneAcceso ? '!text-primary' : ''}`}
            >
              <Icon name="speaker" className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setSpiegazioneAperta((v) => !v)}
              aria-expanded={spiegazioneAperta}
              aria-label="Come funziona Maximum Carnage"
              title="Come funziona Maximum Carnage"
              className="ds-icon-btn"
            >
              <Icon name={spiegazioneAperta ? 'chevronUp' : 'info'} className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
      {spiegazioneAperta && (
        <p className="px-4 sm:px-5 py-3 border-t border-line text-xs text-slate-400 leading-relaxed">
          Con {CRITICAL_ACTION_THRESHOLD} «azioni critiche» nella stessa giornata (argomenti Hard completati con studio tracciato, blocchi di
          Focus in Overdrive da almeno 20 minuti, simulazioni d’esame vinte) guadagni una carica, che attivi tu da Mission Control quando vuoi,
          fra le 6 e le 23. Dura 2 ore: XP raddoppiati, Stamina normale — il simbionte non ti fa studiare oltre il limite. Il ronzio grave di
          sottofondo è il drone simbionte: l’altoparlante qui accanto lo zittisce (anche dalle Impostazioni › Suoni e notifiche).
        </p>
      )}
    </div>
  );
}
