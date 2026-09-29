import React from 'react';
import { Icon } from '../../components/Icons.jsx';

// =====================================================================
// Controlli del form "materia" del Web-Matrix: cursore della difficoltà
// percepita e interruttore "Esame superato". Presentazionali puri.
// V41 — stile unico dell'app (.ds-range / .ds-switch in index.css).
// =====================================================================

/** Colore di riempimento del cursore: classi statiche, mai composte a runtime. */
export const TECH_SLIDER_ACCENT = {
  primary: { fill: 'rgb(var(--af-attack-rgb))', text: 'text-primary' },
  secondary: { fill: 'rgb(var(--af-refuel-rgb))', text: 'text-secondary' }
};

/** Cursore 1–5 con etichetta parlante del valore corrente. */
export function TechSlider({ value, onChange, labels, accent = 'primary', id }) {
  const accentCls = TECH_SLIDER_ACCENT[accent] || TECH_SLIDER_ACCENT.primary;
  const pct = ((Math.min(5, Math.max(1, Number(value) || 1)) - 1) / 4) * 100;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <span className="text-sm text-slate-300">Difficoltà percepita</span>
        <span className={`text-sm font-semibold ds-num ${accentCls.text}`}>
          {value}/5 · {labels[value - 1]}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={1}
        max={5}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="ds-range"
        style={{ '--range-pct': `${pct}%`, '--range-fill': accentCls.fill }}
        aria-valuetext={`${value} su 5, ${labels[value - 1]}`}
      />
      <div className="flex items-center justify-between mt-1 text-[11px] text-slate-500">
        <span>{labels[0]}</span>
        <span>{labels[labels.length - 1]}</span>
      </div>
    </div>
  );
}

/** Interruttore "Esame superato". */
export function ExamPassedToggle({ checked, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className={`w-full flex items-center justify-between gap-3 px-4 py-3 rounded-xl border text-left transition-colors duration-150 ${
        checked ? 'bg-emerald-500/[0.07] border-emerald-400/35' : 'bg-surface border-line hover:border-line-strong'
      }`}
    >
      <span className="flex items-start gap-3 min-w-0">
        <Icon
          name={checked ? 'trophy' : 'check'}
          className={`w-4 h-4 mt-0.5 shrink-0 ${checked ? 'text-emerald-300' : 'text-slate-500'}`}
        />
        <span className="min-w-0">
          <span className={`block text-sm font-semibold ${checked ? 'text-emerald-200' : 'text-slate-200'}`}>Esame superato</span>
          <span className="block text-xs text-slate-500 mt-0.5">
            Archivia la materia e sblocca le propedeuticità degli altri corsi.
          </span>
        </span>
      </span>
      <span className="ds-switch" data-on={checked ? 'true' : 'false'} aria-hidden="true" />
    </button>
  );
}
