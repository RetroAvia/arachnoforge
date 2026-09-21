import React from 'react';
import { Icon } from './Icons.jsx';

/**
 * V26.0 — Schermata di boot condivisa, usata in due momenti distinti:
 * 1. AuthContext in bootstrap (`getSession()` non ancora risolto) — App.jsx.
 * 2. ArachnoForgeProvider in fetch dei dati Cloud (Pillar 3) — dopo login,
 *    prima che il Web-Matrix sia pronto da mostrare.
 * Stesso linguaggio visivo del resto dell'app (nebulosa radiale, glow,
 * font mono), mai un semplice spinner bianco su sfondo nero.
 */
export default function BootScreen({ message = 'Connessione ai satelliti Stark in corso...' }) {
  return (
    <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-af-bg bg-[radial-gradient(ellipse_at_center,rgb(29_131_240/0.08),transparent_55%)]">
      <div className="relative w-20 h-20 mb-6">
        <div className="absolute inset-0 rounded-full border-2 border-secondary/20" />
        <div className="absolute inset-0 rounded-full border-2 border-t-secondary border-r-secondary/60 border-b-transparent border-l-transparent animate-spin" />
        <div className="absolute inset-3 rounded-full border border-primary/30 border-t-primary animate-[spin_1.4s_linear_infinite_reverse]" />
        <div className="absolute inset-0 flex items-center justify-center text-secondary">
          <Icon name="target" className="w-7 h-7" />
        </div>
      </div>
      <p className="text-sm font-mono tracking-[0.2em] text-secondary animate-pulse-slow">{message}</p>
      <p className="text-[11px] font-mono tracking-widest text-slate-600 mt-2">KAREN OS // NEXUS GATE v26.0</p>
    </div>
  );
}
