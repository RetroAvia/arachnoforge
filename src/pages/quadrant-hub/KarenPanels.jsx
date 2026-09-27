import React from 'react';
import { Icon } from '../../components/Icons.jsx';
import { BADGE, CARD_NOPAD } from '../../utils/designSystem.js';
import { formatNumber } from '../../utils/format.js';

// =====================================================================
// Pannelli di K.A.R.E.N. in testa al Web-Matrix: Primary Target e
// Bounty Board. Presentazionali puri (solo props).
//
// V41 — prima occupavano da soli l'intero primo schermo (due riquadri
// al neon a tutta larghezza), e l'elenco delle materie iniziava sotto la
// piega. Ora stanno affiancati in una riga compatta: l'informazione è la
// stessa, lo spazio un terzo.
// =====================================================================

/**
 * Karen's Tactical Suggestor — la materia su cui lavorare adesso secondo
 * lo Spider-Score (stesso calcolo di Mission Control, letto da `derived`).
 */
export function KarenSuggestorPanel({ primaryTarget, onSelect, selectedId = null }) {
  if (!primaryTarget) {
    return (
      <div className={`${CARD_NOPAD} flex items-center gap-3.5 px-4 sm:px-5 py-4`}>
        <span className="ds-icon-tile text-emerald-300">
          <Icon name="check" className="w-[18px] h-[18px]" />
        </span>
        <div className="min-w-0">
          <p className="ds-eyebrow">Karen · Primary Target</p>
          <p className="text-sm text-slate-300 mt-0.5">
            Nessun esame in sospeso: traiettoria pulita. Aggiungi una materia quando sei pronto.
          </p>
        </div>
      </div>
    );
  }

  const { materia, spiderScore, reason } = primaryTarget;
  const isOpen = selectedId === materia.id;

  const action = isOpen ? (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
      <Icon name="check" className="w-3.5 h-3.5" />
      Aperta qui sotto
    </span>
  ) : (
    <button type="button" onClick={() => onSelect(materia.id)} className="ds-btn ds-btn-ghost ds-btn-sm">
      Apri materia
      <Icon name="chevronRight" className="w-3.5 h-3.5" />
    </button>
  );

  return (
    <div className={`${CARD_NOPAD} h-full`}>
      <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-primary" aria-hidden="true" />
      <div className="flex items-start gap-3.5 sm:gap-4 pl-5 pr-4 sm:pr-5 py-4">
        <span className="ds-icon-tile text-primary hidden sm:inline-flex">
          <Icon name="crosshair" className="w-[18px] h-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="ds-eyebrow !text-primary">Karen · Primary Target</p>
            <span
              className={BADGE.amber}
              title="Spider-Score: ore di lavoro residue contro ore disponibili prima dell'esame, pesate per importanza"
            >
              <Icon name="bolt" className="w-3 h-3" />
              Spider-Score {formatNumber(spiderScore, 1)}
            </span>
          </div>
          <p className="text-[17px] font-semibold text-white mt-1 leading-snug break-words">{materia.nome}</p>
          {reason && <p className="text-[13.5px] text-slate-300 mt-1 leading-relaxed">{reason}</p>}
          <div className="mt-3 lg:hidden">{action}</div>
        </div>
        <div className="shrink-0 hidden lg:block">{action}</div>
      </div>
    </div>
  );
}

/**
 * V31.3 — Bounty Board (Friction Analytics): gli argomenti con più ripassi
 * giudicati "Difficile", fra quelli con almeno 3 tentativi (guardia contro
 * il rumore, applicata a monte in `derived.bountyTargets`). Un clic apre
 * l'argomento. Non compare se non c'è niente da segnalare.
 */
export function BountyBoardPanel({ targets, onSelect, limit = 4 }) {
  if (!targets || targets.length === 0) return null;
  const shown = targets.slice(0, limit);
  const hidden = targets.length - shown.length;
  return (
    <div className={`${CARD_NOPAD} h-full`}>
      <div className="flex items-center justify-between gap-2 px-4 pt-3.5 pb-2">
        <p className="ds-eyebrow flex items-center gap-1.5">
          <Icon name="crosshair" className="w-3.5 h-3.5 text-primary" />
          Bounty Board
        </p>
        <span className="text-[11px] text-slate-500">alta frizione nei ripassi</span>
      </div>
      <ul className="px-2 pb-2">
        {shown.map((t) => (
          <li key={t.sfidaId}>
            <button
              type="button"
              onClick={() => onSelect(t.materiaId, t.sfidaId)}
              className="w-full text-left flex items-center justify-between gap-3 rounded-lg px-2.5 py-2 hover:bg-white/[0.04] transition-colors"
            >
              <span className="min-w-0">
                <span className="block text-[13.5px] font-medium text-slate-100 truncate">{t.sfidaNome}</span>
                <span className="block text-[11px] text-slate-500 truncate">{t.materiaNome}</span>
              </span>
              <span className={`${BADGE.red} shrink-0`} title="Percentuale di ripassi giudicati Difficile">
                {t.friction}%
              </span>
            </button>
          </li>
        ))}
      </ul>
      {hidden > 0 && <p className="px-4 pb-3 -mt-1 text-[11px] text-slate-500">e altri {hidden}</p>}
      {shown.length < 3 && (
        <p className="px-4 pb-3.5 text-[11px] leading-relaxed text-slate-500">
          Sono gli argomenti che nei ripassi giudichi più spesso «Difficile»: aprili e mettili alla prova con
          l'Interrogazione K.A.R.E.N.
        </p>
      )}
    </div>
  );
}
