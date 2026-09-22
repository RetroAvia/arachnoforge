import React, { useState, useEffect } from 'react';
import { useArachnoForge } from '../context/ArachnoForgeContext.jsx';
import { Icon } from './Icons.jsx';
import { maxCarnageMsRemaining, formatMsRemaining, CRITICAL_ACTION_THRESHOLD } from '../utils/maxCarnage.js';

/**
 * V27.0 — Pillar 3: banner globale "MAXIMUM CARNAGE MODE", montato in cima
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
    <div className="af-carnage-in af-carnage-pulse mb-5 rounded-2xl border border-primary/60 bg-[rgb(3_3_3_/_0.85)] backdrop-blur-2xl px-4 py-3 sm:px-5 sm:py-3.5 flex flex-col sm:flex-row sm:flex-wrap items-start sm:items-center gap-2.5 sm:gap-4 relative overflow-hidden">
      <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-primary/20 blur-3xl pointer-events-none" />
      <div className="relative flex items-center gap-2.5 shrink-0">
        <div className="w-9 h-9 rounded-xl bg-primary/20 border border-primary/60 flex items-center justify-center text-primary shrink-0">
          <Icon name="skull" className="w-5 h-5" />
        </div>
        <div>
          <p className="text-xs sm:text-sm font-extrabold tracking-widest text-primary">MAXIMUM CARNAGE MODE</p>
          <p className="text-[11px] sm:text-xs text-slate-400">Il simbionte ha il controllo — XP x2, Stamina illimitata.</p>
        </div>
      </div>
      <div className="relative flex items-center gap-2 ml-0 sm:ml-auto w-full sm:w-auto justify-between sm:justify-end">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/50 bg-primary/10 px-3 py-1 text-[11px] font-mono text-primary">
          <Icon name="bolt" className="w-3.5 h-3.5" />
          XP x2
        </span>
        <span className="font-mono text-base sm:text-lg font-bold text-white af-mono-nums tabular-nums">
          {formatMsRemaining(msRemaining)}
        </span>
        {/* V40.3 — il drone simbionte si zittisce da qui, senza spegnere
            tutti gli effetti sonori e senza cercare l'interruttore in
            Karen OS Settings mentre stai studiando. */}
        <button
          type="button"
          onClick={() => actions.updateSettings({ carnageDrone: !droneAcceso })}
          aria-pressed={!droneAcceso}
          title={droneAcceso ? 'Zittisci il drone simbionte' : 'Riattiva il drone simbionte'}
          className={`w-9 h-9 shrink-0 flex items-center justify-center rounded-xl border transition-all duration-300 active:scale-95 ${
            droneAcceso
              ? 'border-primary/40 text-primary hover:bg-primary/10'
              : 'border-white/15 text-slate-500 hover:text-slate-300 hover:bg-white/[0.05]'
          }`}
        >
          <Icon name="speaker" className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => setSpiegazioneAperta((v) => !v)}
          aria-expanded={spiegazioneAperta}
          title="Come funziona Maximum Carnage"
          className="w-9 h-9 shrink-0 flex items-center justify-center rounded-xl border border-white/15 text-slate-400 hover:text-white hover:bg-white/[0.05] transition-all duration-300 active:scale-95"
        >
          <Icon name={spiegazioneAperta ? 'chevronUp' : 'chevronDown'} className="w-4 h-4" />
        </button>
      </div>
      {spiegazioneAperta && (
        <p className="relative w-full text-[11px] sm:text-xs text-slate-400 leading-relaxed border-t border-white/10 pt-2.5 sm:basis-full">
          Si attiva da sola dopo {CRITICAL_ACTION_THRESHOLD} "azioni critiche" di fila: nodi Hard completati, sessioni di
          Focus chiuse in Overdrive e Boss Fight vinte. Dura 2 ore: XP raddoppiati e nessun costo di Stamina. Il ronzio
          grave di sottofondo è il drone simbionte — l'icona dell'altoparlante qui accanto lo zittisce (anche in Karen OS
          Settings).
        </p>
      )}
    </div>
  );
}
