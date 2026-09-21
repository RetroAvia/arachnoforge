import React, { useState, useEffect } from 'react';
import { useArachnoForge } from '../context/ArachnoForgeContext.jsx';
import { Icon } from './Icons.jsx';
import { maxCarnageMsRemaining, formatMsRemaining } from '../utils/maxCarnage.js';

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
  const { derived, state } = useArachnoForge();
  const [msRemaining, setMsRemaining] = useState(() => maxCarnageMsRemaining(state.profile));

  useEffect(() => {
    if (!derived.isMaxCarnageActive) return undefined;
    setMsRemaining(maxCarnageMsRemaining(state.profile));
    const id = setInterval(() => setMsRemaining(maxCarnageMsRemaining(state.profile)), 1000);
    return () => clearInterval(id);
  }, [derived.isMaxCarnageActive, state.profile]);

  if (!derived.isMaxCarnageActive) return null;

  return (
    <div className="af-carnage-in af-carnage-pulse mb-5 rounded-2xl border border-primary/60 bg-[rgb(3_3_3_/_0.85)] backdrop-blur-2xl px-4 py-3 sm:px-5 sm:py-3.5 flex flex-col sm:flex-row items-start sm:items-center gap-2.5 sm:gap-4 relative overflow-hidden">
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
      </div>
    </div>
  );
}
