import React from 'react';
import { Icon } from './Icons.jsx';

/**
 * V41 — Testata di pagina unica per tutta l'app: etichetta di contesto,
 * titolo (i nomi a tema restano), sottotitolo e azioni allineate a destra.
 * Prima ogni pagina componeva la propria con misure e colori diversi.
 */
export default function PageHeader({ eyebrow, icon, title, subtitle, actions = null, children = null }) {
  return (
    <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0">
        {eyebrow && (
          <p className="ds-eyebrow flex items-center gap-1.5 mb-2">
            {icon && <Icon name={icon} className="w-3.5 h-3.5" />}
            {eyebrow}
          </p>
        )}
        <h1 className="ds-h1">{title}</h1>
        {subtitle && <p className="ds-subtitle mt-1.5 max-w-3xl">{subtitle}</p>}
        {children}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
    </header>
  );
}

/** Piccola statistica per la testata (es. "Oggi 1h 24m"). */
export function HeaderStat({ icon, label, value, tone = 'text-slate-100', title }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-line bg-panel/70 px-3 py-2" title={title}>
      {icon && <Icon name={icon} className={`w-4 h-4 ${tone}`} />}
      <div className="leading-tight">
        <p className={`text-sm font-semibold ds-num ${tone}`}>{value}</p>
        <p className="text-[11px] text-slate-500">{label}</p>
      </div>
    </div>
  );
}
