import React from 'react';
import { Icon } from '../../components/Icons.jsx';
import { CARD_NOPAD, BADGE } from '../../utils/designSystem.js';
import { formatDateOnlyHuman, formatHoursMinutes, daysUntilDateOnly } from '../../utils/dateUtils.js';
import { NODE_STATUS } from '../../utils/skillTree.js';
import { formatoMeta, targetAppello } from '../../utils/appelli.js';
import { plurale } from '../../utils/format.js';
import { tipoPianoOf, TIPO_PIANO, TIPO_PIANO_META, isUngradedMateria } from '../../data/vanvitelliCourseMap.js';

// =====================================================================
// V41 — Testata della materia aperta nel Web-Matrix: chi è, quando è
// l'esame, quanto manca, a che punto sei, e le azioni. Prima le stesse
// informazioni erano sparse fra tre righe di testo colorato e sei
// pulsanti di peso uguale; ora c'è una gerarchia: prima il nome, poi i
// quattro numeri che contano, poi l'avanzamento per stato.
// =====================================================================

function Fact({ icon, label, value, hint, tone = 'text-slate-100', title, onClick }) {
  const body = (
    <>
      <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
        <Icon name={icon} className="w-3.5 h-3.5 shrink-0" />
        {label}
        {onClick && <Icon name="chevronDown" className="w-3 h-3 text-slate-600 group-hover:text-slate-300 transition-colors" />}
      </p>
      <p className={`mt-1 text-sm font-semibold ds-num truncate ${tone}`}>{value}</p>
      {hint && <p className="text-[11px] leading-snug text-slate-500 line-clamp-2">{hint}</p>}
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={title}
        className="group min-w-0 text-left rounded-lg -m-1.5 p-1.5 hover:bg-white/[0.035] transition-colors"
      >
        {body}
      </button>
    );
  }
  return (
    <div className="min-w-0" title={title}>
      {body}
    </div>
  );
}

// V42 — i quattro pilastri veri della prontezza.
const PILLAR_LABEL = { coverage: 'copertura', memory: 'memoria', practice: 'esercizi', feasibility: 'fattibilità' };
const PILLAR_KNOWN = { coverage: 'hasNodes', memory: 'hasMemory', practice: 'hasPractice', feasibility: 'hasFeasibility' };

/** Il pilastro più basso fra quelli misurati davvero: è lì che conviene lavorare. */
function weakestPillar(readiness) {
  if (!readiness?.parts || !readiness?.known) return null;
  let worst = null;
  Object.keys(PILLAR_LABEL).forEach((k) => {
    const v = Number(readiness.parts[k]);
    if (!readiness.known[PILLAR_KNOWN[k]] || !Number.isFinite(v)) return;
    if (!worst || v < worst.value) worst = { key: k, value: v };
  });
  return worst;
}

const STATUS_ORDER = [
  { key: NODE_STATUS.COMPLETED, label: 'completati', dot: 'bg-emerald-400' },
  { key: NODE_STATUS.NEEDS_REVIEW, label: 'da ripassare', dot: 'bg-accent' },
  { key: NODE_STATUS.IN_PROGRESS, label: 'in corso', dot: 'bg-cyan-400' },
  { key: NODE_STATUS.AVAILABLE, label: 'da studiare', dot: 'bg-secondary' },
  { key: NODE_STATUS.LOCKED, label: 'Boss in attesa', dot: 'bg-slate-500' }
];

/**
 * V42 — la PROSSIMA PROVA dell'appello obiettivo (dopo lo scritto, l'orale),
 * con il formato e, se c'è, la seconda prova.
 */
function examLine(materia, quota, planningDate) {
  const meta = formatoMeta(materia);
  const app = targetAppello(materia);
  if (!planningDate && !materia.examDate) return { value: 'Da fissare', hint: 'Nessun appello in calendario', tone: 'text-slate-400' };
  const data = planningDate || materia.examDate;
  const days = daysUntilDateOnly(data);
  const date = formatDateOnlyHuman(data);
  const orale = app && app.scritto && app.orale && data === app.scritto ? ` · orale ${formatDateOnlyHuman(app.orale)}` : '';
  const prova = app && app.orale && data === app.orale && app.scritto ? `${meta.secondaLabel || 'Orale'}: ` : '';
  if (materia.examPassed) return { value: date, hint: 'Appello sostenuto', tone: 'text-slate-300' };
  if (quota?.dataScaduta || (days != null && days < 0)) return { value: date, hint: 'Appello passato: registra l’esito', tone: 'text-accent' };
  if (days === 0) return { value: `${prova}oggi`, hint: `${date}${orale}`, tone: 'text-primary' };
  if (days === 1) return { value: `${prova}domani`, hint: `${date}${orale}`, tone: 'text-primary' };
  return { value: `${prova}${date}`, hint: `tra ${days} giorni · ${meta.short}${orale}`, tone: days <= 7 ? 'text-accent' : 'text-slate-100' };
}

export default function MateriaHeader({
  materia,
  planningDate = null,
  course,
  quota,
  estimate,
  onSimulazione,
  onOrale,
  onRicostruisci,
  readiness,
  verdictMeta,
  goblinActive,
  statusCounts,
  totalNodes,
  oreLezioneMin,
  onEdit,
  onDelete,
  onShowReadiness
}) {
  const archiviata = !!materia.examPassed;
  const exam = examLine(materia, quota, planningDate);
  const done = statusCounts[NODE_STATUS.COMPLETED] + statusCounts[NODE_STATUS.NEEDS_REVIEW];
  const pct = totalNodes > 0 ? Math.round((done / totalNodes) * 100) : 0;

  let finePrevista = { value: '—', hint: 'Aggiungi gli argomenti', tone: 'text-slate-400', title: undefined };
  if (archiviata) {
    finePrevista = {
      value: Number.isFinite(materia.voto) ? `${materia.voto}${materia.lode ? ' e lode' : ''}/30` : 'Superato',
      hint: materia.examPassedDate ? `verbalizzato il ${formatDateOnlyHuman(materia.examPassedDate)}` : 'Esame archiviato',
      tone: 'text-emerald-300'
    };
  } else if (estimate?.done) {
    finePrevista = { value: 'Programma chiuso', hint: 'Restano solo i ripassi', tone: 'text-emerald-300' };
  } else if (quota && !quota.frozen && quota.finePrevistaDateKey) {
    // V42 — la fine prevista del piano GLOBALE: con le altre materie in
    // calendario, non questa da sola a tempo pieno.
    const late = (Number(quota.lateHours) || 0) > 0.05;
    finePrevista = {
      value: formatDateOnlyHuman(quota.finePrevistaDateKey),
      hint: late ? `${formatHoursMinutes(quota.lateHours)} scoperte all’esame` : `${formatHoursMinutes(quota.hoursRemaining)} residue, nel piano con le altre materie`,
      tone: late ? 'text-primary' : 'text-secondary',
      title: 'Calcolata dal planner su tutte le materie, al tuo ritmo reale'
    };
  } else if (estimate?.dateKey) {
    const late = materia.examDate && estimate.dateKey > materia.examDate;
    finePrevista = {
      value: formatDateOnlyHuman(estimate.dateKey),
      hint: `${formatHoursMinutes(estimate.totalHoursNeeded)} residue${estimate.senzaNodi ? ' (stima dai CFU)' : ''}`,
      tone: late ? 'text-primary' : 'text-secondary',
      title: estimate.senzaNodi
        ? `Nessun argomento ancora: ${formatHoursMinutes(estimate.totalHoursNeeded)} stimate dai CFU (~${plurale(estimate.totalDaysNeeded, 'giorno', 'giorni')} al tuo ritmo). Mappa il programma per una stima vera.`
        : `${formatHoursMinutes(estimate.totalHoursNeeded)} stimate su ${plurale(estimate.remaining, 'argomento ancora aperto', 'argomenti ancora aperti')} (~${plurale(estimate.totalDaysNeeded, 'giorno', 'giorni')} a ritmo sostenibile)`
    };
  }

  const tipo = tipoPianoOf(materia);
  const eyebrow = course ? `${course.anno}° anno · piano di studi` : tipo === TIPO_PIANO.EXTRA ? 'Sovrannumerario · fuori dalla laurea' : TIPO_PIANO_META[tipo]?.label || 'Materia libera';
  const vMeta = readiness && verdictMeta ? verdictMeta[readiness.verdict] || verdictMeta.UNKNOWN : null;
  const readinessLabel = vMeta ? vMeta.short : '';
  const readinessTone = vMeta ? vMeta.tone : 'text-slate-400';
  const weakest = weakestPillar(readiness);

  return (
    <section className={`${CARD_NOPAD} ${goblinActive ? '!border-primary/40' : ''}`} aria-label={`Materia ${materia.nome}`}>
      {goblinActive && (
        <div className="flex items-start gap-3 px-4 sm:px-5 py-3 border-b border-primary/25 bg-primary/[0.07]">
          <Icon name="skull" className="w-5 h-5 text-primary shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-primary">Green Goblin Protocol attivo</p>
            <p className="text-[13px] text-slate-400 mt-0.5">
              Esame fra tre giorni o meno: niente argomenti nuovi. Ripassa e allenati nel Sinister Six Simulator.
            </p>
          </div>
        </div>
      )}

      <div className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="ds-eyebrow">{eyebrow}</p>
            <div className="mt-1 flex items-center gap-2 flex-wrap">
              <h2 className="text-xl sm:text-[22px] font-bold tracking-tight text-white break-words min-w-0">{materia.nome}</h2>
              <span className={BADGE.blue}>{materia.cfu} CFU</span>
              {isUngradedMateria(materia) && <span className={BADGE.slate}>Idoneità</span>}
              {materia.ricostruzione && !archiviata && (
                <span className={BADGE.amber} title="Materia in ricostruzione da zero">
                  <Icon name="refresh" className="w-3 h-3" />
                  In ricostruzione
                </span>
              )}
              {archiviata && (
                <span className={BADGE.green}>
                  <Icon name="trophy" className="w-3 h-3" />
                  Superato
                </span>
              )}
              {quota?.status === 'CONGELATA' && !archiviata && (
                <span className={BADGE.slate} title="Propedeuticità mancanti: esclusa dal planner automatico">
                  <Icon name="lock" className="w-3 h-3" />
                  Congelata
                </span>
              )}
              {!archiviata && oreLezioneMin > 0 && (
                <span className={BADGE.cyan} title="Ore di lezione a settimana nel semestre in corso (Empire State University)">
                  <Icon name="calendar" className="w-3 h-3" />
                  {formatHoursMinutes(oreLezioneMin / 60)} di lezione a settimana
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button type="button" onClick={onEdit} className="ds-icon-btn" aria-label="Modifica materia" title="Modifica materia">
              <Icon name="edit" className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="ds-icon-btn hover:!text-primary"
              aria-label="Elimina materia"
              title="Elimina materia"
            >
              <Icon name="trash" className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 min-[1360px]:grid-cols-4 gap-x-5 gap-y-4">
          <Fact icon="calendar" label="Esame" value={exam.value} hint={exam.hint} tone={exam.tone} />
          <Fact
            icon={archiviata ? 'trophy' : 'bolt'}
            label={archiviata ? 'Voto' : 'Fine prevista'}
            value={finePrevista.value}
            hint={finePrevista.hint}
            tone={finePrevista.tone}
            title={finePrevista.title}
          />
          {archiviata ? (
            <Fact icon="chartBar" label="CFU acquisiti" value={`${materia.cfu} CFU`} hint="Contano per la media ponderata" />
          ) : readiness && readiness.verdict === 'UNKNOWN' ? (
            <Fact
              icon="gauge"
              label="Prontezza d'esame"
              value="Dati insufficienti"
              hint="Mappa gli argomenti e fissa la data"
              tone="text-slate-400"
              title="Mostra il dettaglio della prontezza d'esame"
              onClick={onShowReadiness}
            />
          ) : readiness ? (
            <Fact
              icon="gauge"
              label="Prontezza d'esame"
              value={`${readiness.score}/100 · ${readinessLabel}`}
              hint={
                weakest && weakest.value < 0.75
                  ? `punto debole: ${PILLAR_LABEL[weakest.key]} ${Math.round(weakest.value * 100)}%`
                  : 'nessun punto debole evidente'
              }
              tone={readinessTone}
              title="Mostra il dettaglio della prontezza d'esame"
              onClick={onShowReadiness}
            />
          ) : (
            <Fact icon="gauge" label="Prontezza d'esame" value="—" hint="Servono argomenti e data" tone="text-slate-400" />
          )}
          <Fact
            icon="layers"
            label="Argomenti"
            value={totalNodes > 0 ? `${done} su ${totalNodes} chiusi` : 'Nessuno'}
            hint={totalNodes > 0 ? `${pct}% del programma` : 'Mappa il programma'}
          />
        </div>

        {!archiviata && (onSimulazione || onOrale || onRicostruisci) && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {onOrale && (
              <button type="button" onClick={onOrale} className="ds-btn ds-btn-ghost ds-btn-sm" title="Domande dai tuoi appunti, una alla volta, come all'orale">
                <Icon name="speaker" className="w-3.5 h-3.5 text-secondary" />
                Interrogazione orale
              </button>
            )}
            {onSimulazione && (
              <button type="button" onClick={onSimulazione} className="ds-btn ds-btn-ghost ds-btn-sm" title="Registra una prova d'esame completa a tempo">
                <Icon name="flag" className="w-3.5 h-3.5 text-accent" />
                Registra simulazione
              </button>
            )}
            {onRicostruisci && totalNodes > 0 && (
              <button type="button" onClick={onRicostruisci} className="ds-btn ds-btn-quiet ds-btn-sm" title="Per le materie che ricostruisci da capo in sessione">
                <Icon name="refresh" className="w-3.5 h-3.5" />
                Ricomincia da zero
              </button>
            )}
          </div>
        )}

        {totalNodes > 0 && (
          <div className="mt-4 pt-4 border-t border-line">
            <div className="flex h-1.5 rounded-full overflow-hidden bg-white/[0.07] gap-px" aria-hidden="true">
              {STATUS_ORDER.map((s) =>
                statusCounts[s.key] > 0 ? (
                  <span key={s.key} className={`h-full ${s.dot}`} style={{ width: `${(statusCounts[s.key] / totalNodes) * 100}%` }} />
                ) : null
              )}
            </div>
            <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1">
              {STATUS_ORDER.filter((s) => statusCounts[s.key] > 0).map((s) => (
                <li key={s.key} className="flex items-center gap-1.5 text-xs text-slate-400 ds-num">
                  <span className={`w-2 h-2 rounded-full ${s.dot}`} aria-hidden="true" />
                  <span className="text-slate-200 font-semibold">{statusCounts[s.key]}</span> {s.label}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
