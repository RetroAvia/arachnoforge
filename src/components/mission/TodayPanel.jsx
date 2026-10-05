import React, { useState } from 'react';
import { Icon } from '../Icons.jsx';
import EmptyState from '../EmptyState.jsx';
import { QUOTA_STATUS_META } from '../../hooks/useKarenAutoRouter.js';
import { formatHoursMinutes, formatDateShort, formatDateRelative, todayDateOnlyKey } from '../../utils/dateUtils.js';
import { plurale } from '../../utils/format.js';
import { BADGE, BTN_GHOST, BTN_SM } from '../../utils/designSystem.js';
import { goTo, ROUTES } from '../../hooks/useArachnoForgeRouter.js';

/**
 * V42 — "OGGI": il piano della giornata, materia per materia.
 *
 * Prima la Quota Odierna mostrava un solo numero per materia ("Oggi 2h"),
 * senza dire quanto ne avevi già fatto, quanto era davvero necessario e
 * quanto era anticipo. Ora ogni riga ha:
 *  - la barra fatto / previsto (si riempie mentre studi: l'obiettivo di
 *    oggi resta fermo, non si rimpicciolisce);
 *  - il MINIMO per restare in tempo con tutti gli esami e l'ANTICIPO;
 *  - il lavoro previsto (sintesi, studio, ripasso finale) e la fine prevista.
 * Sotto: i ripassi dovuti, la riserva per le lezioni, e il resto delle
 * materie (in coda, congelate) con le loro date chiave.
 */

/** Sotto i 3 minuti un ritardo è rumore di arrotondamento. */
const LATE_EPS = 0.05;

const STATUS_BADGE = {
  OTTIMALE: BADGE.green,
  ATTENZIONE: BADGE.amber,
  CRITICO: BADGE.red,
  CONGELATA: BADGE.slate
};

function esameLabel(q) {
  if (q.dataScaduta) return 'Appello passato: registra l’esito o scegli il prossimo';
  if (q.daysRemaining == null) return 'Nessuna data d’esame';
  if (q.daysRemaining === 0) return 'Esame oggi';
  if (q.daysRemaining === 1) return 'Esame domani';
  return `Esame fra ${q.daysRemaining} giorni`;
}

function statusLabel(q) {
  if (q.senzaData && !q.frozen && !q.dataScaduta) return 'Senza data';
  return QUOTA_STATUS_META[q.status]?.label || q.status;
}

function ProgressBar({ done, target, tone = 'bg-secondary' }) {
  const pct = target > 0 ? Math.min(100, Math.round((done / target) * 100)) : 0;
  const completa = target > 0 && done >= target - 1 / 60;
  return (
    <div className="ds-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
      <span className={completa ? 'bg-emerald-400' : tone} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Una materia del piano di oggi. */
function TodaySubjectRow({ p, todayKey }) {
  const target = p.todayTargetHours || 0;
  const done = Math.min(target, p.doneTodayHours || 0);
  const minimo = p.todayMinHours || 0;
  const anticipo = Math.max(0, target - minimo);
  const critico = p.status === 'CRITICO';
  const completa = target > 0 && (p.remainingTodayHours || 0) <= 1 / 60;
  const lavori = [
    p.todaySintesiHours > 0 && `sintesi ${formatHoursMinutes(p.todaySintesiHours)}`,
    p.todayStudioHours > 0 && `studio ${formatHoursMinutes(p.todayStudioHours)}`,
    p.todayFinalReviewHours > 0 && `ripasso finale ${formatHoursMinutes(p.todayFinalReviewHours)}`
  ].filter(Boolean);
  return (
    <div className={`rounded-xl border px-3.5 py-3 ${critico ? 'border-primary/35 bg-primary/[0.05]' : completa ? 'border-emerald-400/25 bg-emerald-400/[0.04]' : 'border-line bg-surface'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-100 break-words">{p.nome}</p>
          <p className="text-xs text-slate-500 mt-0.5">
            {esameLabel(p)}
            {p.finePrevistaDateKey && !completa
              ? ` · fine prevista ${p.finePrevistaStimata ? '~' : ''}${formatDateShort(p.finePrevistaDateKey, todayKey)}${p.finePrevistaStimata ? ', dopo l’esame' : ''}`
              : ''}
          </p>
        </div>
        <span className="flex flex-col items-end gap-1 shrink-0">
          <span className={STATUS_BADGE[p.status] || BADGE.slate}>{completa ? 'Fatto per oggi' : statusLabel(p)}</span>
        </span>
      </div>
      <div className="mt-2.5 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <ProgressBar done={done} target={target} tone={critico ? 'bg-primary' : 'bg-secondary'} />
        </div>
        <span className="text-xs font-semibold ds-num text-slate-200 shrink-0">
          {formatHoursMinutes(done)} <span className="text-slate-500 font-normal">/ {formatHoursMinutes(target)}</span>
        </span>
      </div>
      <p className="text-[11px] text-slate-500 mt-1.5 leading-relaxed">
        {minimo > 1 / 60 ? (
          <>
            minimo <span className="text-slate-300 ds-num">{formatHoursMinutes(minimo)}</span>
            {anticipo > 1 / 60 ? (
              <>
                {' '}· anticipo <span className="text-slate-300 ds-num">{formatHoursMinutes(anticipo)}</span>
              </>
            ) : null}
          </>
        ) : (
          <>tutto anticipo: oggi non è obbligatoria</>
        )}
        {lavori.length > 0 ? ` · ${lavori.join(' · ')}` : ''}
      </p>
      {p.lateHours > LATE_EPS ? (
        <p className="text-xs text-primary mt-2 leading-relaxed">
          Al tuo ritmo reale {formatHoursMinutes(p.lateHours)} restano scoperte all’esame: valuta l’appello successivo o riduci il programma.
        </p>
      ) : p.todayMinOverflowHours > LATE_EPS ? (
        <p className="text-xs text-accent mt-2 leading-relaxed">
          Per restare in tempo oggi servirebbero altre {formatHoursMinutes(p.todayMinOverflowHours)}: recuperale nei prossimi giorni.
        </p>
      ) : null}
    </div>
  );
}

/** Una materia NON in programma oggi (in coda, senza data, congelata). */
export function QuotaRow({ q, todayKey }) {
  const critico = q.status === 'CRITICO';
  return (
    <div className={`rounded-xl border px-3.5 py-3 ${critico ? 'border-primary/35 bg-primary/[0.05]' : 'border-line bg-surface'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-100 break-words">{q.nome}</p>
          <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
            {esameLabel(q)}
            {' · '}
            {q.stimaDaCfu && q.daysRemaining == null
              ? `fuori dal piano finché non mappi il programma (stima ${formatHoursMinutes(q.hoursRemaining)})`
              : `${formatHoursMinutes(q.hoursRemaining)} residue${q.hasNodes ? '' : ' (stima dai CFU)'}`}
          </p>
        </div>
        <span className={`${STATUS_BADGE[q.status] || BADGE.slate} shrink-0`}>{statusLabel(q)}</span>
      </div>
      {q.frozen ? (
        <p className="text-xs text-slate-500 mt-2 leading-relaxed">
          Propedeuticità da superare prima:{' '}
          {q.prereqBloccanti?.length
            ? q.prereqBloccanti.map((b) => `${b.nome}${b.dataKey ? ` (appello il ${formatDateShort(b.dataKey, todayKey)})` : ' (nessun appello prima)'}`).join(', ')
            : q.missingPrereqNames.join(', ')}
          . Preparabile a mano, fuori dal piano automatico finché non la sblocchi.
        </p>
      ) : (
        (q.inizioEntroDateKey || q.finePrevistaDateKey || q.chiusuraAppuntiDateKey) &&
        q.haLavoro && (
          <p className="text-xs text-slate-400 mt-2 leading-relaxed">
            {q.inizioEntroDateKey && q.inizioEntroDateKey > todayKey ? <>Da iniziare entro {formatDateRelative(q.inizioEntroDateKey, todayKey)}</> : null}
            {q.inizioEntroDateKey && q.inizioEntroDateKey > todayKey && q.finePrevistaDateKey ? ' · ' : null}
            {q.finePrevistaDateKey ? (
              <>
                fine prevista {q.finePrevistaStimata ? '~' : ''}
                {formatDateShort(q.finePrevistaDateKey, todayKey)}
                {q.finePrevistaStimata ? ', dopo l’esame' : ''}
              </>
            ) : q.finePrevistaOltreOrizzonte ? (
              'fine oltre l’orizzonte del piano'
            ) : null}
            {q.chiusuraAppuntiDateKey && q.sintesiHours > 0 ? ` · appunti chiusi entro ${formatDateShort(q.chiusuraAppuntiDateKey, todayKey)}` : ''}
          </p>
        )
      )}
      {q.pressioneDaAltri && !critico && (
        <p className="text-xs text-accent/90 mt-2 leading-relaxed">
          Ci sta, ma solo se gli esami che vengono prima non sforano: il carico fino a questa data è oltre la tua capacità.
        </p>
      )}
      {critico && (
        <p className="text-xs text-primary mt-2 leading-relaxed font-medium">
          {q.lateHours > LATE_EPS
            ? `Al tuo ritmo reale ${formatHoursMinutes(q.lateHours)} restano scoperte all’esame: valuta di rinviare l’appello o di tagliare il programma.`
            : 'Traiettoria al limite al tuo ritmo reale: non rallentare.'}
        </p>
      )}
      {q.prereqPianificate?.length > 0 && !q.frozen && (
        <p className="text-[11px] text-slate-500 mt-1.5">
          Propedeutica in programma prima: {q.prereqPianificate.map((b) => `${b.nome} (${b.inAttesaEsito ? `sostenuta il ${formatDateShort(b.dataKey, todayKey)}, esito in attesa` : formatDateShort(b.dataKey, todayKey)})`).join(', ')}.
        </p>
      )}
    </div>
  );
}

/**
 * @param {object} props
 * @param {object} props.plan       derived.planToday
 * @param {Array}  props.quotas     derived.karenQuotas
 * @param {object} props.calibration
 * @param {boolean} props.monotask
 * @param {Function} props.onCloseDay
 * @param {boolean} props.dayClosed
 */
export default function TodayPanel({ plan, quotas = [], calibration, monotask = false, onCloseDay, dayClosed = false, todayKey = todayDateOnlyKey() }) {
  const [showAll, setShowAll] = useState(false);
  if (!plan) return null;
  const oggiIds = new Set((plan.subjects || []).map((p) => p.materiaId));
  const inCoda = quotas.filter((q) => !oggiIds.has(q.materiaId) && !q.frozen);
  const congelate = quotas.filter((q) => q.frozen);
  const rev = plan.reviews || {};
  const lessons = plan.lessons || {};
  const targetH = plan.targetHours || 0;
  const doneH = Math.min(plan.doneHours || 0, Math.max(targetH, plan.doneHours || 0));
  const pctGiornata = targetH > 0 ? Math.min(100, Math.round(((plan.doneHours || 0) / targetH) * 100)) : 0;
  const riduzione = plan.loadAdjustmentPct < 0 && plan.baseCapacityHours > plan.capacityHours;
  const vuoto = quotas.length === 0 && (rev.total || 0) === 0;
  // Ore scoperte agli esami previste dal piano: non è "oggi è pesante", è un
  // piano che non sta nei tempi, e va detto così (con lo stesso numero del
  // Piano della sessione).
  const strutturale = Number(plan.lateHours) >= 0.5;

  return (
    <div className="ds-card">
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-3">
          <span className="ds-icon-tile text-primary">
            <Icon name="satellite" className="w-[18px] h-[18px]" />
          </span>
          <div>
            <p className="ds-eyebrow">K.A.R.E.N. Quantum Router</p>
            <h2 className="ds-h2">Il piano di oggi</h2>
          </div>
        </div>
        <span className="flex items-center gap-2">
          {monotask && (
            <span className={BADGE.red}>
              <Icon name="crosshair" className="w-3 h-3" />
              Monotask · esame vicino
            </span>
          )}
          <button type="button" onClick={() => goTo(ROUTES.PIANO)} className={`${BTN_GHOST} ${BTN_SM}`} title="Il piano giorno per giorno fino agli esami">
            <Icon name="calendar" className="w-3.5 h-3.5" />
            Piano della sessione
          </button>
        </span>
      </div>

      {vuoto ? (
        <EmptyState variant="radar" compact title="Nessuna rotta attiva" subtitle="Apri una materia nel Web-Matrix con un appello in calendario: il piano si costruisce da solo." />
      ) : (
        <div className="space-y-5">
          {/* La giornata in una riga: fatto / previsto, capacità, riposo. */}
          <div className="ds-well px-4 py-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-sm text-slate-300">
                {plan.capacityHours <= 1 / 60 ? (
                  <>Oggi è un giorno di riposo del piano.</>
                ) : (
                  <>
                    Fatto <span className="font-semibold text-white ds-num">{formatHoursMinutes(doneH)}</span> di{' '}
                    <span className="font-semibold text-white ds-num">{formatHoursMinutes(targetH)}</span> previste
                    <span className="text-slate-500">
                      {' '}
                      · capacità {formatHoursMinutes(plan.capacityHours)}
                      {riduzione ? ` (−${Math.abs(plan.loadAdjustmentPct)}% da K.A.R.E.N. su ${formatHoursMinutes(plan.baseCapacityHours)})` : ''}
                    </span>
                  </>
                )}
              </p>
              {onCloseDay && (
                <button type="button" onClick={onCloseDay} className={`${BTN_GHOST} ${BTN_SM}`}>
                  <Icon name={dayClosed ? 'check' : 'moon'} className={`w-3.5 h-3.5 ${dayClosed ? 'text-emerald-400' : ''}`} />
                  {dayClosed ? 'Giornata chiusa · modifica domani' : 'Chiudi la giornata'}
                </button>
              )}
            </div>
            {targetH > 0 && (
              <div className="mt-2.5">
                <div className="ds-progress">
                  <span className={pctGiornata >= 100 ? 'bg-emerald-400' : 'bg-primary'} style={{ width: `${pctGiornata}%` }} />
                </div>
              </div>
            )}
            {strutturale ? (
              <p className="text-xs text-primary mt-2.5 leading-relaxed">
                Il piano non sta nei tempi: al tuo ritmo reale circa {formatHoursMinutes(plan.lateHours)} di lavoro restano scoperte agli esami. Oggi il tempo va alle
                scadenze più vicine; poi serve una scelta — spostare un appello, ridurre il programma o rivedere le ore al giorno. Gli scenari sono nel{' '}
                <button type="button" onClick={() => goTo(ROUTES.PIANO)} className="underline underline-offset-2 hover:text-white">
                  Piano della sessione
                </button>
                .
              </p>
            ) : plan.overCapacity ? (
              <p className="text-xs text-accent mt-2.5 leading-relaxed">
                Per restare in tempo oggi servirebbero {formatHoursMinutes(plan.mandatoryHours)}, ne hai {formatHoursMinutes(plan.capacityHours)}: {formatHoursMinutes(plan.deficitHours)}{' '}
                slittano sui prossimi giorni. Se succede spesso, la soluzione è spostare un appello o ridurre il programma, non recuperare di notte.
              </p>
            ) : (
              <p className="text-xs text-slate-500 mt-2.5 leading-relaxed">
                {plan.freeHours > 1 / 60 ? `Margine libero ${formatHoursMinutes(plan.freeHours)}. ` : ''}
                {calibration?.manualHours
                  ? 'Capacità impostata a mano (Karen OS Settings).'
                  : calibration?.capacityConfident
                  ? `Capacità misurata sulle tue ultime ${calibration.observedDays} giornate.`
                  : 'Capacità ancora in parte sul valore di default: si calibra da sola con una settimana di sessioni.'}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <p className="ds-eyebrow !text-secondary">Materie di oggi</p>
            {(plan.subjects || []).length === 0 ? (
              <p className="text-sm text-slate-500">
                {plan.capacityHours <= 1 / 60 ? 'Nessuna materia: giornata di riposo.' : 'Nessuna materia da spingere oggi: il piano è in pari.'}
              </p>
            ) : (
              plan.subjects.map((p) => <TodaySubjectRow key={p.materiaId} p={p} todayKey={todayKey} />)
            )}
          </div>

          {((rev.total || 0) > 0 || (lessons.riservateOre || 0) > 0) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {(rev.total || 0) > 0 && (
                <div className="rounded-xl border border-line bg-surface px-3.5 py-3">
                  <p className="text-sm font-semibold text-emerald-300 flex items-center gap-1.5">
                    <Icon name="radar" className="w-4 h-4" />
                    Ripassi
                  </p>
                  <div className="mt-2 flex items-center gap-3">
                    <div className="flex-1">
                      <ProgressBar done={rev.done || 0} target={Math.max(1, rev.targetCount || 0)} tone="bg-emerald-400/70" />
                    </div>
                    <span className="text-xs font-semibold ds-num text-slate-200">
                      {rev.done || 0}
                      <span className="text-slate-500 font-normal">/{rev.targetCount || 0}</span>
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1.5">
                    circa {formatHoursMinutes(rev.targetHours || 0)}
                    {rev.rinviati > 0
                      ? ` · ${plurale(rev.rinviati, 'rinviato', 'rinviati')} ${(rev.rinviatiPerGiorno?.length || 0) > 1 ? `nei prossimi ${rev.rinviatiPerGiorno.length} giorni` : 'a domani'} (giornata piena)`
                      : ''}
                  </p>
                </div>
              )}
              {(lessons.riservateOre || 0) > 0 && (
                <div className="rounded-xl border border-line bg-surface px-3.5 py-3">
                  <p className="text-sm font-semibold text-cyan-300 flex items-center gap-1.5">
                    <Icon name="calendar" className="w-4 h-4" />
                    Lezioni da sistemare
                  </p>
                  <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                    {formatHoursMinutes(lessons.riservateOre)} riservate alla sintesi delle lezioni
                    {lessons.prima ? ', da fare per prime: oggi nessun esame è a rischio.' : ', col tempo che gli esami lasciano libero.'}
                  </p>
                </div>
              )}
            </div>
          )}

          {(inCoda.length > 0 || congelate.length > 0) && (
            <div className="space-y-2">
              <button type="button" onClick={() => setShowAll((v) => !v)} className="ds-eyebrow flex items-center gap-1.5 hover:text-slate-300 transition-colors" aria-expanded={showAll}>
                <Icon name={showAll ? 'chevronUp' : 'chevronDown'} className="w-3.5 h-3.5" />
                Le altre materie ({inCoda.length + congelate.length})
              </button>
              {showAll && (
                <>
                  {inCoda.map((q) => (
                    <QuotaRow key={q.materiaId} q={q} todayKey={todayKey} />
                  ))}
                  {congelate.map((q) => (
                    <QuotaRow key={q.materiaId} q={q} todayKey={todayKey} />
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
