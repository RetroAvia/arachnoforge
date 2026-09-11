import React from 'react';
import { Icon } from '../../components/Icons.jsx';

// =====================================================================
// V35.2 — "Disaccoppiamento Meccanico QuadrantHub". Estratto VERBATIM da
// QuadrantHub.jsx: entrambi i controlli sono presentazionali puri
// (props-only, nessuna chiusura sullo stato del componente pagina),
// spostamento comportamentalmente neutro.
// =====================================================================

/** Classi Tailwind statiche (mai concatenate a runtime — bandito dal Design System) per le due varianti cromatiche dello slider. */
export const TECH_SLIDER_ACCENT = {
  primary: { track: 'accent-primary', text: 'text-primary' },
  secondary: { track: 'accent-secondary', text: 'text-secondary' }
};

/** Slider "Stark-Tech" — riusa la grammatica cromatica reattiva al costume, mai uno slider nativo grigio. */
export function TechSlider({ value, onChange, labels, accent = 'primary' }) {
  const accentCls = TECH_SLIDER_ACCENT[accent] || TECH_SLIDER_ACCENT.primary;
  return (
    <div>
      <input
        type="range"
        min={1}
        max={5}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={`w-full h-2 rounded-full appearance-none bg-surface/80 border border-white/10 cursor-pointer ${accentCls.track}`}
      />
      <div className="flex items-center justify-between mt-1.5">
        <span className="text-xs text-slate-500">{labels[0]}</span>
        <span className={`text-sm font-mono font-semibold ${accentCls.text}`}>{value}/5 — {labels[value - 1]}</span>
        <span className="text-xs text-slate-500">{labels[labels.length - 1]}</span>
      </div>
    </div>
  );
}

/** Toggle Stark-Tech compatto — pillola in vetro con perno luminoso, per "Esame Superato". */
export function ExamPassedToggle({ checked, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className={`w-full flex items-center justify-between gap-3 px-4 py-3 rounded-xl border transition-all duration-300 ${
        checked ? 'bg-emerald-900/25 border-emerald-400/50' : 'bg-surface/80 border-white/10'
      }`}
    >
      <span className={`text-sm font-semibold flex items-center gap-2 ${checked ? 'text-emerald-300' : 'text-slate-400'}`}>
        <Icon name={checked ? 'check' : 'gear'} className="w-4 h-4" />
        Esame Superato (propedeuticità soddisfatta per altri corsi)
      </span>
      <span
        className={`shrink-0 w-11 h-6 rounded-full border relative transition-all duration-300 ${
          checked ? 'bg-emerald-500/30 border-emerald-400/60' : 'bg-surface border-white/10'
        }`}
      >
        <span
          className={`absolute top-0.5 w-5 h-5 rounded-full bg-gradient-to-br transition-all duration-300 ${
            checked ? 'left-[22px] from-emerald-400 to-emerald-600' : 'left-0.5 from-slate-500 to-slate-600'
          }`}
        />
      </span>
    </button>
  );
}
