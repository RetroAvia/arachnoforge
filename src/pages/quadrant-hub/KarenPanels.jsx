import React from 'react';
import { Icon } from '../../components/Icons.jsx';
import { BADGE } from '../../utils/designSystem.js';

// =====================================================================
// V35.2 — "Disaccoppiamento Meccanico QuadrantHub". Estratto VERBATIM da
// QuadrantHub.jsx, senza alcuna modifica comportamentale: entrambi i
// componenti qui dentro sono presentazionali puri (nessuna chiusura
// sullo stato locale del componente pagina, solo props + import
// module-level), quindi lo spostamento è comportamentalmente neutro al
// 100%. Vedi PHASE5_REFACTOR.md per il razionale completo.
// =====================================================================

/**
 * Karen's Tactical Suggestor (V18.0, Pillar 2) — pannello HUD in cima al
 * Web-Matrix, sempre visibile: l'IA scansiona le Materie non ancora
 * superate e decreta il "Primary Target" secondo lo Spider-Score. Bordi
 * neon pulsanti + glow, mai un pannello piatto: è la card che deve
 * dimostrare che l'app "pensa" per l'utente.
 */
export function KarenSuggestorPanel({ primaryTarget, onSelect }) {
  return (
    <div className="relative bg-surface/80 backdrop-blur-lg border-2 border-secondary/50 rounded-2xl shadow-secondary-glow-lg p-6 overflow-hidden">
      <div className="absolute -top-16 -left-16 w-64 h-64 rounded-full bg-secondary/20 blur-3xl pointer-events-none animate-pulse-slow" />
      <div className="absolute -bottom-16 -right-16 w-64 h-64 rounded-full bg-primary/10 blur-3xl pointer-events-none" />
      <div className="relative flex items-center gap-3 mb-4">
        <div className="w-11 h-11 rounded-xl bg-secondary/15 border border-secondary/50 flex items-center justify-center text-secondary shrink-0 shadow-secondary-glow">
          <Icon name="chip" className="w-6 h-6" />
        </div>
        <div>
          <p className="text-xs tracking-[0.25em] text-secondary font-mono">KAREN OS</p>
          <h2 className="text-lg font-extrabold text-white tracking-tight">Analisi Traiettoria Accademica</h2>
        </div>
      </div>

      {!primaryTarget ? (
        <div className="relative flex items-center gap-3 bg-emerald-900/20 border border-emerald-400/30 rounded-xl px-4 py-3.5">
          <Icon name="check" className="w-5 h-5 text-emerald-400 shrink-0" />
          <p className="text-sm text-emerald-300">
            Karen: nessun esame in sospeso rilevato. Traiettoria pulita — apri un nuovo nodo dal piano di studi quando sei pronto.
          </p>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => onSelect(primaryTarget.materia.id)}
          className="relative w-full text-left bg-primary/10 border border-primary/40 rounded-xl px-5 py-4 flex items-start gap-4 hover:border-primary/70 hover:bg-primary/15 transition-all duration-300"
        >
          <div className="w-10 h-10 rounded-lg bg-primary/20 border border-primary/50 flex items-center justify-center text-primary shrink-0">
            <Icon name="crosshair" className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-mono tracking-widest text-primary">PRIMARY TARGET</span>
              <span className={BADGE.amber}>
                <Icon name="bolt" className="w-3.5 h-3.5" />
                Spider-Score {primaryTarget.spiderScore}
              </span>
            </div>
            <p className="text-lg font-bold leading-snug text-white mt-1 break-words">{primaryTarget.materia.nome}</p>
            <p className="text-sm text-slate-300 mt-1 leading-relaxed">{primaryTarget.reason}</p>
          </div>
          <Icon name="chevronDown" className="w-5 h-5 text-primary -rotate-90 shrink-0 mt-2" />
        </button>
      )}
    </div>
  );
}

/**
 * V31.3 — Bounty Board (Friction Analytics): riattiva `utils/friction.js`,
 * finora scaffoldato ma mai esposto in nessuna UI. Mostra i nodi con più
 * "attrito" (ripassi giudicati Difficile) tra quelli con almeno 3
 * tentativi registrati (guardia contro il rumore statistico su campioni
 * piccoli, applicata a monte in `derived.bountyTargets`). Ogni riga salta
 * direttamente al nodo riusando lo stesso meccanismo di quick-jump dello
 * Spider-Sense Schedule (`openNodeFromSchedule`).
 */
export function BountyBoardPanel({ targets, onSelect }) {
  if (!targets || targets.length === 0) return null;
  return (
    <div className="relative bg-surface/80 backdrop-blur-lg border-2 border-primary/40 rounded-2xl shadow-primary-glow p-6 overflow-hidden">
      <div className="absolute -top-16 -right-16 w-64 h-64 rounded-full bg-primary/15 blur-3xl pointer-events-none" />
      <div className="relative flex items-center gap-3 mb-4">
        <div className="w-11 h-11 rounded-xl bg-primary/15 border border-primary/50 flex items-center justify-center text-primary shrink-0 shadow-primary-glow">
          <Icon name="crosshair" className="w-6 h-6" />
        </div>
        <div>
          <p className="text-xs tracking-[0.25em] text-primary font-mono">BOUNTY BOARD</p>
          <h2 className="text-lg font-extrabold text-white tracking-tight">Nodi ad Alta Frizione</h2>
        </div>
      </div>
      <div className="relative space-y-2">
        {targets.map((t) => (
          <button
            key={t.sfidaId}
            type="button"
            onClick={() => onSelect(t.materiaId, t.sfidaId)}
            className="w-full text-left bg-primary/5 border border-primary/25 rounded-xl px-4 py-3 flex items-center justify-between gap-3 hover:border-primary/60 hover:bg-primary/10 transition-all duration-300"
          >
            <div className="min-w-0">
              <p className="text-base font-semibold text-white line-clamp-2 break-words">{t.sfidaNome}</p>
              <p className="text-sm text-slate-500 truncate">{t.materiaNome}</p>
            </div>
            <span className={BADGE.red}>
              <Icon name="alertTriangle" className="w-3.5 h-3.5" />
              {t.friction}% frizione
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
