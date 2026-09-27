import React, { memo } from 'react';
import { Icon } from '../../components/Icons.jsx';
import EmptyState from '../../components/EmptyState.jsx';
import { CARD_NOPAD } from '../../utils/designSystem.js';
import { formatHoursMinutes, formatDateOnlyHuman, daysUntilDateOnly } from '../../utils/dateUtils.js';
import { formatNumber } from '../../utils/format.js';
import { isGoblinProtocol } from '../../utils/materiaMeta.js';

// =====================================================================
// V41 — Elenco delle materie del Web-Matrix (colonna sinistra).
//
// Prima: una card alta per materia, con bordi che pulsavano in rosso e in
// ambra, fino a quattro badge e due righe di avviso. Con venti esami il
// colpo d'occhio era rumore. Ora ogni materia è una riga compatta: nome,
// Spider-Score (o voto, se superata), CFU e data, avanzamento, e UNA sola
// riga di stato quando c'è davvero qualcosa da dire. La gravità si legge
// dalla barretta colorata a sinistra, ferma.
// =====================================================================

/** Giorni all'esame in parole brevi. */
function examCountdownLabel(examDate) {
  const days = daysUntilDateOnly(examDate);
  if (days == null) return '';
  if (days === 0) return 'oggi';
  if (days === 1) return 'domani';
  if (days > 1) return `tra ${days} gg`;
  return '';
}

/** Lo stato di una materia, calcolato una volta per riga. */
function describeMateria(m, quota) {
  const archiviata = !!m.examPassed;
  const status = archiviata ? 'ARCHIVIATA' : quota?.status;
  const goblin = !archiviata && isGoblinProtocol(m);
  const critico = status === 'CRITICO';
  // V40.0 — "Attenzione" solo con una data vera: un corso senza esame
  // fissato non ha niente da rischiare.
  const attenzione = status === 'ATTENZIONE' && quota?.daysRemaining != null;
  const congelata = status === 'CONGELATA';
  const dataScaduta = !archiviata && !!quota?.dataScaduta;

  let bar = 'bg-transparent';
  let note = null;
  if (archiviata) {
    bar = 'bg-emerald-500/60';
  } else if (goblin) {
    bar = 'bg-primary';
    note = { tone: 'text-primary', icon: 'skull', text: 'Goblin Protocol: esame imminente, solo ripasso' };
  } else if (critico) {
    bar = 'bg-primary';
    note = { tone: 'text-primary', icon: 'alertTriangle', text: 'Traiettoria critica' };
  } else if (dataScaduta) {
    bar = 'bg-accent';
    note = { tone: 'text-accent', icon: 'alertTriangle', text: "Appello passato: segna l'esito o la nuova data" };
  } else if (attenzione) {
    bar = 'bg-accent';
    note = { tone: 'text-accent', icon: 'alertTriangle', text: 'Un po’ indietro sul ritmo' };
  } else if (congelata) {
    bar = 'bg-slate-600';
    const names = Array.isArray(quota?.missingPrereqNames) ? quota.missingPrereqNames.join(', ') : '';
    note = {
      tone: 'text-slate-400',
      icon: 'lock',
      text: names ? `Propedeuticità mancante: ${names}` : 'Propedeuticità mancante',
      title: 'Esclusa dal planner automatico finché non superi le propedeuticità. Puoi comunque prepararla.'
    };
  }
  return { archiviata, goblin, congelata, bar, note };
}

const MateriaRow = memo(function MateriaRow({ materia: m, active, spiderScore, readiness, quota, oreLezioneMin, verdictMeta, onSelect }) {
  const sfide = Array.isArray(m?.sfide) ? m.sfide : [];
  const total = sfide.length;
  const done = sfide.filter((s) => s.status === 'COMPLETED').length;
  const { archiviata, bar, note } = describeMateria(m, quota);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const verdict = !archiviata && readiness && readiness.verdict !== 'UNKNOWN' ? verdictMeta[readiness.verdict] : null;

  return (
    <button
      type="button"
      onClick={() => onSelect(m.id)}
      aria-current={active ? 'true' : undefined}
      className={`group relative w-full text-left rounded-lg pl-3.5 pr-3 py-2.5 transition-colors duration-150 ${
        active ? 'bg-panel-3/80 ring-1 ring-inset ring-white/10' : 'hover:bg-white/[0.035]'
      }`}
    >
      <span
        className={`absolute left-1 top-2.5 bottom-2.5 w-[3px] rounded-full ${active && bar === 'bg-transparent' ? 'bg-secondary' : bar}`}
        aria-hidden="true"
      />
      <div className="flex items-start justify-between gap-2">
        <p
          className={`text-[13.5px] font-medium leading-snug break-words line-clamp-2 min-w-0 ${
            archiviata ? 'text-slate-400' : active ? 'text-white' : 'text-slate-100'
          }`}
        >
          {m.nome}
        </p>
        {archiviata ? (
          <span className="shrink-0 inline-flex items-center gap-1 text-xs font-semibold text-emerald-300 ds-num mt-px">
            <Icon name="check" className="w-3 h-3" />
            {Number.isFinite(m.voto) ? `${m.voto}${m.lode ? 'L' : ''}` : 'Superato'}
          </span>
        ) : (
          <span
            className="shrink-0 inline-flex items-center gap-0.5 text-xs font-semibold text-accent ds-num mt-px"
            title="Spider-Score: priorità di Karen (ore residue contro ore disponibili)"
          >
            <Icon name="bolt" className="w-3 h-3" />
            {formatNumber(spiderScore, 1)}
          </span>
        )}
      </div>

      <div className="mt-1 flex items-center gap-x-1.5 gap-y-0.5 flex-wrap text-[11px] text-slate-500 ds-num">
        <span>{m.cfu} CFU</span>
        {archiviata && m.examPassedDate && (
          <>
            <span aria-hidden="true">·</span>
            <span>{formatDateOnlyHuman(m.examPassedDate)}</span>
          </>
        )}
        {!archiviata && m.examDate && !quota?.dataScaduta && (
          <>
            <span aria-hidden="true">·</span>
            <span title={formatDateOnlyHuman(m.examDate)}>esame {examCountdownLabel(m.examDate) || formatDateOnlyHuman(m.examDate)}</span>
          </>
        )}
        {!archiviata && oreLezioneMin > 0 && (
          <>
            <span aria-hidden="true">·</span>
            <span className="text-cyan-300/90" title="Ore di lezione a settimana nel semestre in corso">
              {formatHoursMinutes(oreLezioneMin / 60)}/sett
            </span>
          </>
        )}
        {verdict && (
          <span className={`ml-auto font-semibold ${verdict.tone}`} title={readiness.rationale}>
            {verdict.short}
          </span>
        )}
      </div>

      {note && (
        <p className={`mt-1.5 text-[11px] leading-snug flex items-start gap-1 ${note.tone}`} title={note.title}>
          <Icon name={note.icon} className="w-3 h-3 mt-px shrink-0" />
          <span className="min-w-0">{note.text}</span>
        </p>
      )}

      {!archiviata && (
        <div className="mt-2 flex items-center gap-2">
          <span className="ds-progress flex-1 !h-1">
            <span className="bg-secondary" style={{ width: `${pct}%` }} />
          </span>
          <span className="text-[11px] text-slate-500 ds-num whitespace-nowrap">
            {total > 0 ? `${done}/${total}` : 'nessun argomento'}
          </span>
        </div>
      )}
    </button>
  );
});

/**
 * Pannello con l'elenco: gruppi per anno di corso (1°/2°/3° + materie
 * libere), ciascuno richiudibile; dentro, l'ordine è lo Spider-Score.
 */
export default function MateriaListPanel({
  sections,
  materieByYear,
  openYears,
  onToggleYear,
  primaryTargetYearKey,
  selectedMateriaId,
  onSelect,
  onAdd,
  spiderScoreById,
  readinessById,
  quotaById,
  oreLezioneById,
  verdictMeta,
  totalCount
}) {
  const visibleSections = sections.filter((sec) => (materieByYear.get(sec.key) || []).length > 0);

  return (
    <div className={CARD_NOPAD}>
      <div className="flex items-center justify-between gap-2 px-4 pt-3.5 pb-2.5 border-b border-line">
        <p className="text-sm font-semibold text-white flex items-center gap-2">
          Materie
          <span className="ds-badge ds-badge-slate">{totalCount}</span>
        </p>
        <button type="button" onClick={onAdd} className="ds-btn ds-btn-quiet ds-btn-sm !px-2" title="Nuova materia">
          <Icon name="plus" className="w-4 h-4" />
          <span className="sr-only">Nuova materia</span>
        </button>
      </div>

      {totalCount === 0 ? (
        <div className="p-4">
          <EmptyState
            variant="tree"
            compact
            title="Nessuna materia"
            subtitle="Aggiungi il primo corso dal piano di studi: da lì costruirai l'albero degli argomenti."
          />
          <button type="button" onClick={onAdd} className="ds-btn ds-btn-primary w-full mt-3">
            <Icon name="plus" className="w-4 h-4" />
            Nuova materia
          </button>
        </div>
      ) : (
        <div className="p-2 space-y-1">
          {visibleSections.map((sec) => {
            const items = materieByYear.get(sec.key) || [];
            const isOpen = openYears.has(sec.key);
            const hasPrimaryTarget = sec.key === primaryTargetYearKey;
            const hasSelected = items.some((m) => m.id === selectedMateriaId);
            const attive = items.filter((m) => !m.examPassed).length;
            return (
              <div key={sec.key}>
                <button
                  type="button"
                  onClick={() => onToggleYear(sec.key)}
                  aria-expanded={isOpen}
                  className="w-full flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-white/[0.035] transition-colors"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <Icon
                      name="chevronRight"
                      className={`w-3.5 h-3.5 text-slate-500 shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}`}
                    />
                    <span className="text-[13px] font-semibold text-slate-200">{sec.label}</span>
                    <span className="text-[11px] text-slate-500 ds-num truncate">
                      {attive === 0
                        ? `${items.length} ${items.length === 1 ? 'superata' : 'superate'}`
                        : attive === items.length
                        ? `${attive} da sostenere`
                        : `${attive} da sostenere · ${items.length - attive} ${items.length - attive === 1 ? 'superata' : 'superate'}`}
                    </span>
                  </span>
                  <span className="flex items-center gap-1.5 shrink-0">
                    {hasPrimaryTarget && (
                      <span className="w-1.5 h-1.5 rounded-full bg-primary" title="Contiene il Primary Target di Karen" />
                    )}
                    {!isOpen && hasSelected && <span className="w-1.5 h-1.5 rounded-full bg-secondary" title="Contiene la materia aperta" />}
                  </span>
                </button>
                {isOpen && (
                  <div className="mt-0.5 mb-1.5 space-y-0.5">
                    {items.map((m) => (
                      <MateriaRow
                        key={m.id}
                        materia={m}
                        active={m.id === selectedMateriaId}
                        spiderScore={spiderScoreById.get(m.id) ?? 0}
                        readiness={readinessById.get(m.id) || null}
                        quota={quotaById.get(m.id)}
                        oreLezioneMin={oreLezioneById.get(m.id) || 0}
                        verdictMeta={verdictMeta}
                        onSelect={onSelect}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
