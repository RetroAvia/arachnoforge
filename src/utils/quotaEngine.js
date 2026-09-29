// =====================================================================
// ArachnoForge — src/utils/quotaEngine.js (V42)
// La facciata del piano giornaliero, PURA.
//
// Dalla V42 il calcolo vero vive in `utils/studyPlanner.js` (piano
// globale: capacità giorno per giorno, minimo di oggi, anticipo sulla
// scadenza più vicina, fine prevista condivisa fra le materie, ripassi e
// lezioni dentro i conti). Questo modulo ne traduce il risultato nella
// forma che il resto dell'app già legge ("quote" per materia, budget del
// giorno, riserva per le lezioni), così Mission Control, Web-Matrix,
// Sidebar, K.A.R.E.N. e il reducer leggono UNA sola risposta.
// =====================================================================
import { HOURS_PER_CFU } from './materiaMeta.js';
import { HOURS_PER_NODE_DAY } from './planningConstants.js';
import { computeStudyPlan, PLAN_STATUS, PLAN_RATIO_OK, PLAN_RATIO_LIMITE, statusFromPlanRatio, MAX_SUBJECTS_PER_DAY, MONOTASK_DAYS } from './studyPlanner.js';

export { HOURS_PER_CFU };
/** Fallback della capacità giornaliera: lo stesso di ogni altro motore. */
export const EVENT_HORIZON_THRESHOLD_HOURS = HOURS_PER_NODE_DAY;
/** Di norma non più di 2 materie nello stesso giorno (salvo sovraccarico). */
export const MAX_DAILY_FOCUS_MATERIE = MAX_SUBJECTS_PER_DAY;
/** Entro questi giorni dall'esame più vicino il piano si concentra su di lui. */
export const CRITICAL_DISTANCE_DAYS = MONOTASK_DAYS;

/**
 * Soglie del rapporto carico/capacità fino alla scadenza (cumulativo su
 * tutte le materie con esame entro quella data):
 *  ≤ 0.90 -> ci sta con margine: OTTIMALE;
 *  ≤ 1.15 -> al limite: serve il tuo ritmo pieno (o poco più);
 *  > 1.15 -> non ci sta: CRITICO (sposta l'appello o riduci il programma).
 */
export const RATIO_OK = PLAN_RATIO_OK;
export const RATIO_ATTENZIONE = PLAN_RATIO_LIMITE;

export const QUOTA_STATUS = PLAN_STATUS;

export const QUOTA_STATUS_META = {
  OTTIMALE: {
    label: 'Ottimale',
    badgeClass: 'bg-emerald-900/40 text-emerald-300 border-emerald-400/40',
    dotClass: 'bg-emerald-400',
    cardClass: '',
    glowStyle: { filter: 'drop-shadow(0 0 6px rgba(52,211,153,0.7))' }
  },
  ATTENZIONE: {
    label: 'Al limite',
    badgeClass: 'bg-accent/15 text-accent border-accent/40',
    dotClass: 'bg-accent',
    cardClass: 'af-attenzione-pulse border-accent/60 bg-accent/10',
    glowStyle: {}
  },
  CRITICO: {
    label: 'Critico',
    badgeClass: 'bg-primary/15 text-primary border-primary/60',
    dotClass: 'bg-primary',
    cardClass: 'af-event-horizon border-primary/70 bg-primary/10',
    glowStyle: {}
  },
  CONGELATA: {
    label: 'Congelata',
    badgeClass: 'bg-slate-800/60 text-slate-400 border-slate-500/30',
    dotClass: 'bg-slate-500',
    cardClass: 'opacity-60 border-slate-500/20',
    glowStyle: {}
  }
};

export const STATUS_RANK = {
  [QUOTA_STATUS.CRITICO]: 0,
  [QUOTA_STATUS.ATTENZIONE]: 1,
  [QUOTA_STATUS.OTTIMALE]: 2,
  [QUOTA_STATUS.CONGELATA]: 3
};

export const statusFromRatio = statusFromPlanRatio;

function round2(n) {
  return Math.round(n * 100) / 100;
}

function urgencyGroup(q) {
  if (q.frozen) return 3;
  if (!q.haLavoro && !(q.finalReviewHours > 0)) return 2;
  if (q.daysRemaining == null) return 1;
  return 0;
}

/**
 * Ordinamento per urgenza (liste del Web-Matrix e di Mission Control):
 * prima le materie con una scadenza vera (quelle entro 10 giorni per
 * data, poi per gravità e data), poi quelle senza data, poi quelle senza
 * lavoro, infine le congelate.
 */
export function compareByUrgency(a, b) {
  const ga = urgencyGroup(a);
  const gb = urgencyGroup(b);
  if (ga !== gb) return ga - gb;
  const daysA = a.daysRemaining == null ? Infinity : a.daysRemaining;
  const daysB = b.daysRemaining == null ? Infinity : b.daysRemaining;
  const aImminent = daysA <= CRITICAL_DISTANCE_DAYS;
  const bImminent = daysB <= CRITICAL_DISTANCE_DAYS;
  if (aImminent !== bImminent) return aImminent ? -1 : 1;
  if (aImminent && bImminent && daysA !== daysB) return daysA - daysB;
  const rankA = STATUS_RANK[a.status] ?? 4;
  const rankB = STATUS_RANK[b.status] ?? 4;
  if (rankA !== rankB) return rankA - rankB;
  if (daysA !== daysB) return daysA - daysB;
  return (b.todayTargetHours || 0) - (a.todayTargetHours || 0) || (b.hoursRemaining || 0) - (a.hoursRemaining || 0);
}

/** Una materia del piano nella forma "quota" letta dalla UI. */
function toQuota(p) {
  return {
    ...p,
    // Campi storici, ora con il significato del piano globale:
    dailyQuotaHours: p.haLavoro || p.finalReviewHours > 0 ? p.todayTargetHours : 0,
    paceRatio: p.ratio,
    cumulativeRatio: p.ratio,
    cumulativeOverload: Number.isFinite(p.ratio) ? p.ratio > 1 : p.ratio === Infinity,
    overdue: p.daysRemaining === 0 && p.hoursRemaining > p.todayTargetHours + 1 / 60,
    rawStatus: p.status,
    eventHorizon: p.status === QUOTA_STATUS.CRITICO
  };
}

/**
 * Il piano completo del giorno.
 *
 * @param {Array} materie materie con la data di pianificazione (appelli.withPlanningDates)
 * @param {object} options vedi studyPlanner.computeStudyPlan; in più
 *        `sintesiLezioni` (nome storico di `lessonQueue`).
 */
export function computeDailyPlan(
  materie,
  {
    calibration = null,
    loadAdjustmentPct = 0,
    sintesiLezioni = null,
    lessonQueue = null,
    lessonPhase = null,
    calendar = null,
    todayKey,
    doneToday = null,
    timelineDays = 120
  } = {}
) {
  const queue = lessonQueue || sintesiLezioni;
  const plan = computeStudyPlan(materie, {
    calibration,
    calendar,
    ...(todayKey ? { todayKey } : {}),
    doneToday,
    loadAdjustmentPct,
    lessonQueue: queue,
    // Chi passa la coda delle lezioni la passa solo in periodo di lezioni
    // (vedi ArachnoForgeContext): senza indicazione esplicita vale quello.
    lessonPhase: lessonPhase == null ? Array.isArray(queue) && queue.length > 0 : !!lessonPhase,
    timelineDays
  });

  const quotas = plan.subjects.map(toQuota).sort(compareByUrgency);
  const byMateriaId = new Map(quotas.map((q) => [q.materiaId, q]));
  const todayIds = plan.today.subjects.map((s) => s.materiaId);
  const dailyFocusQuotas = todayIds.map((id) => ({ ...byMateriaId.get(id), assignedHours: byMateriaId.get(id).todayTargetHours }));
  const focusIds = new Set(todayIds);
  const queuedQuotas = quotas.filter((q) => !focusIds.has(q.materiaId) && !q.frozen);
  const frozenQuotas = quotas.filter((q) => q.frozen);
  const eventHorizonList = quotas.filter((q) => q.status === QUOTA_STATUS.CRITICO);

  const t = plan.today;
  const budget = {
    budgetHours: t.capacityHours,
    baseBudgetHours: t.baseCapacityHours,
    loadAdjustmentPct: t.loadAdjustmentPct,
    reviewHours: t.reviews.targetHours,
    studioHours: round2(Math.max(0, t.capacityHours - t.reviews.targetHours)),
    sintesiHours: t.lessons.riservateOre,
    assegnateHours: t.studyTargetHours,
    targetHours: t.targetHours,
    totalNeedHours: t.mandatoryHours,
    overCapacity: t.overCapacity,
    deficitHours: t.deficitHours,
    slackHours: t.freeHours,
    doneHours: t.doneHours,
    remainingHours: t.remainingHours,
    allocation: new Map(dailyFocusQuotas.map((q) => [q.materiaId, q.todayTargetHours]))
  };

  const overload = quotas
    .filter((q) => !q.frozen && q.daysRemaining != null && q.cumulativeOverload)
    .sort((a, b) => a.daysRemaining - b.daysRemaining)[0];

  return {
    quotas,
    byMateriaId,
    eventHorizonList,
    criticalCount: eventHorizonList.length,
    dailyFocusIds: focusIds,
    monotaskActive: t.monotaskActive,
    priorityApplied: null,
    dailyFocusQuotas,
    queuedQuotas,
    frozenQuotas,
    budget,
    sintesi: t.lessons,
    reviews: t.reviews,
    today: t,
    timeline: plan.timeline,
    horizonDays: plan.horizonDays,
    cumulativeOverload: overload
      ? { materiaId: overload.materiaId, nome: overload.nome, ratio: overload.cumulativeRatio, daysRemaining: overload.daysRemaining }
      : null
  };
}
