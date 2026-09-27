import React from 'react';
import { Icon } from '../../components/Icons.jsx';
import { CARD_NOPAD, BADGE } from '../../utils/designSystem.js';
import { formatDateOnlyHuman, formatHoursMinutes, daysUntilDateOnly } from '../../utils/dateUtils.js';
import { NODE_STATUS } from '../../utils/skillTree.js';

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

const PILLAR_LABEL = { coverage: 'copertura', stability: 'stabilità', feasibility: 'fattibilità', friction: 'attrito' };
const PILLAR_KNOWN = { coverage: 'hasNodes', stability: 'hasStability', feasibility: 'hasExamDate', friction: 'hasFriction' };

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

function examLine(materia, quota) {
  if (!materia.examDate) return { value: 'Da fissare', hint: 'Nessun appello in calendario', tone: 'text-slate-400' };
  const days = daysUntilDateOnly(materia.examDate);
  const date = formatDateOnlyHuman(materia.examDate);
  if (materia.examPassed) return { value: date, hint: 'Appello sostenuto', tone: 'text-slate-300' };
  if (quota?.dataScaduta || (days != null && days < 0)) return { value: date, hint: 'Appello passato', tone: 'text-accent' };
  if (days === 0) return { value: 'Oggi', hint: date, tone: 'text-primary' };
  if (days === 1) return { value: 'Domani', hint: date, tone: 'text-primary' };
  return { value: date, hint: `tra ${days} giorni`, tone: days <= 7 ? 'text-accent' : 'text-slate-100' };
}

export default function MateriaHeader({
  materia,
  course,
  quota,
  estimate,
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
  const exam = examLine(materia, quota);
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
  } else if (estimate?.dateKey) {
    const late = materia.examDate && estimate.dateKey > materia.examDate;
    finePrevista = {
      value: formatDateOnlyHuman(estimate.dateKey),
      hint: `${formatHoursMinutes(estimate.totalHoursNeeded)} residue${estimate.senzaNodi ? ' (stima dai CFU)' : ''}`,
      tone: late ? 'text-primary' : 'text-secondary',
      title: estimate.senzaNodi
        ? `Nessun argomento ancora: ${formatHoursMinutes(estimate.totalHoursNeeded)} stimate dai CFU (~${estimate.totalDaysNeeded} giorni al tuo ritmo). Mappa il programma per una stima vera.`
        : `${formatHoursMinutes(estimate.totalHoursNeeded)} stimate sui ${estimate.remaining} argomenti ancora aperti (~${estimate.totalDaysNeeded} giorni a ritmo sostenibile)`
    };
  }

  const eyebrow = course ? `${course.anno}° anno · piano di studi` : 'Materia libera';
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
