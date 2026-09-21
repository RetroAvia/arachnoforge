// =====================================================================
// ArachnoForge — src/utils/quotaEngine.js (V39.0)
// Il motore del piano giornaliero, PURO.
//
// Fino alla V38 queste funzioni vivevano dentro hooks/useKarenAutoRouter.js,
// un modulo che importa React. Il reducer — che deve verificare la
// missione "Primary Target" alla fine di ogni sessione — non poteva
// usarle, e si ricalcolava il bersaglio con una funzione diversa e SENZA
// la calibrazione personale: così la UI indicava una materia e la
// missione ne verificava un'altra, e studiare il bersaglio mostrato
// poteva non completarla. Ora c'è un solo motore, qui, senza React;
// l'hook lo avvolge con la memoizzazione e il reducer lo chiama
// direttamente con gli stessi input.
//
// Cosa è cambiato nel motore (tutti difetti verificati con input reali):
//
//  1. ESAME PASSATO NON VERBALIZZATO. Una data d'esame nel passato era
//     trattata come "esame oggi": quota = tutte le ore residue in un
//     giorno, stato CRITICO, monotask forzato, Primary Target. Ma è lo
//     stato normale dopo ogni appello (gli esiti arrivano settimane
//     dopo): la materia andava in allarme rosso proprio quando non c'era
//     più niente da fare. Ora è `dataScaduta`: esce dal planner come una
//     materia senza data, e la UI chiede di aggiornare l'appello.
//
//  2. SOGLIE DIVERSE PER LO STESSO RAPPORTO. Con i nodi, ore/disponibili
//     = 0.8 era OTTIMALE; senza nodi era ATTENZIONE, e 1.2 CRITICO invece
//     di ATTENZIONE. Ora un solo rapporto e un solo insieme di soglie.
//
//  3. NESSUNA CONCORRENZA FRA MATERIE. Tre materie da 60 ore con esame
//     fra 14 giorni risultavano tutte OTTIMALE — ciascuna, da sola, ci
//     sta — con 180 ore richieste contro 63 disponibili. Ora esiste il
//     CARICO CUMULATIVO: per ogni scadenza si sommano le ore di tutte le
//     materie con esame entro quella data e le si confrontano con le ore
//     disponibili fino a lì. È l'unico modo di rispondere a "ce la faccio
//     a darli tutti?".
//
//  4. SLOT DI FOCUS SPRECATI. Una materia senza data (o già finita)
//     poteva occupare uno dei due slot "in focus oggi" e ricevere 0 ore,
//     lasciando fuori una materia con una scadenza vera. Ora gli slot si
//     riempiono prima con chi ha una quota, e l'avanzo di budget va
//     davvero a chi non ne ha una, come il commento prometteva.
// =====================================================================
import { daysUntilDateOnly, dateOnlyToUtcMs } from './dateUtils.js';
import { computeEstimatedCompletion, computeRemainingHours, HOURS_PER_CFU } from './materiaMeta.js';
import { getMissingPrerequisites } from '../data/vanvitelliCourseMap.js';
import { HOURS_PER_NODE_DAY } from './planningConstants.js';

export { HOURS_PER_CFU };
/** Fallback della capacità giornaliera quando la calibrazione non c'è. */
export const EVENT_HORIZON_THRESHOLD_HOURS = 8;
/** Limite rigido: mai più di 2 materie spinte nello stesso giorno. */
export const MAX_DAILY_FOCUS_MATERIE = 2;
/** Sotto questa soglia di giorni: monotask intensivo forzato (1 sola materia). */
export const CRITICAL_DISTANCE_DAYS = 10;

/**
 * V39.0 — Soglie UNICHE del rapporto ore residue / ore disponibili.
 *  ≤ 1.0 -> il lavoro ci sta al tuo ritmo reale: OTTIMALE;
 *  ≤ 1.5 -> non ci sta, ma recuperabile con un impegno sopra la media;
 *  > 1.5 -> non ci sta nemmeno forzando: CRITICO.
 */
export const RATIO_OK = 1;
export const RATIO_ATTENZIONE = 1.5;

export const QUOTA_STATUS = {
  OTTIMALE: 'OTTIMALE',
  ATTENZIONE: 'ATTENZIONE',
  CRITICO: 'CRITICO',
  CONGELATA: 'CONGELATA'
};

export const QUOTA_STATUS_META = {
  OTTIMALE: {
    label: 'Ottimale',
    badgeClass: 'bg-emerald-900/40 text-emerald-300 border-emerald-400/40',
    dotClass: 'bg-emerald-400',
    cardClass: '',
    glowStyle: { filter: 'drop-shadow(0 0 6px rgba(52,211,153,0.7))' }
  },
  ATTENZIONE: {
    label: 'Attenzione',
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

function capacityOf(calibration) {
  return Number(calibration?.hoursPerDay) > 0 ? Number(calibration.hoursPerDay) : HOURS_PER_NODE_DAY;
}

/** Stato a partire da un rapporto ore/disponibili. */
export function statusFromRatio(ratio) {
  if (!Number.isFinite(ratio)) return QUOTA_STATUS.CRITICO;
  if (ratio <= RATIO_OK) return QUOTA_STATUS.OTTIMALE;
  if (ratio <= RATIO_ATTENZIONE) return QUOTA_STATUS.ATTENZIONE;
  return QUOTA_STATUS.CRITICO;
}

/** Il più grave fra due stati (CONGELATA esclusa: non è una gravità). */
function worst(a, b) {
  return (STATUS_RANK[a] ?? 9) <= (STATUS_RANK[b] ?? 9) ? a : b;
}

/** Propedeuticità ufficiali non ancora soddisfatte (grafo Vanvitelli). */
function computePrereqFreeze(materia, allMaterie) {
  if (!materia.courseId) return { frozen: false, missingPrereqNames: [] };
  const missing = getMissingPrerequisites(materia.courseId, allMaterie, materia.id);
  return { frozen: missing.length > 0, missingPrereqNames: missing.map((c) => c.nome) };
}

/**
 * Quota di UNA materia: ore residue, giorni, quota giornaliera, stato.
 */
export function computeMateriaQuota(materia, allMaterie, calibration = null) {
  const sfide = Array.isArray(materia.sfide) ? materia.sfide : [];
  const hasNodes = sfide.length > 0;
  const rawDays = materia.examDate ? daysUntilDateOnly(materia.examDate) : null;
  // V39.0 — data d'esame nel passato: non è un'emergenza, è un appello
  // già sostenuto in attesa di verbale (o da riprogrammare). Per il
  // planner vale come "nessuna data".
  const dataScaduta = rawDays != null && rawDays < 0;
  const daysRemaining = dataScaduta ? null : rawDays;
  const capacity = capacityOf(calibration);

  const hoursRemaining = computeRemainingHours(materia, calibration);
  let finePrevistaDateKey = null;
  let totalDaysNeeded = 0;
  if (hasNodes) {
    const estimate = computeEstimatedCompletion(materia, calibration);
    finePrevistaDateKey = estimate.done ? null : estimate.dateKey;
    totalDaysNeeded = estimate.totalDaysNeeded || 0;
  }

  let dailyQuotaHours = null;
  let overdue = false;
  if (hoursRemaining <= 0) {
    dailyQuotaHours = 0;
  } else if (daysRemaining == null) {
    dailyQuotaHours = null;
  } else if (daysRemaining === 0) {
    // Esame OGGI con lavoro aperto: tutto quello che resta, oggi.
    dailyQuotaHours = hoursRemaining;
    overdue = true;
  } else {
    dailyQuotaHours = hoursRemaining / daysRemaining;
  }

  // Rapporto unico ore residue / ore disponibili prima dell'esame.
  let paceRatio = null;
  let status;
  if (hoursRemaining <= 0) {
    status = QUOTA_STATUS.OTTIMALE;
  } else if (daysRemaining == null) {
    // Nessuna data (o data scaduta): Karen non può proiettare il rischio.
    status = QUOTA_STATUS.ATTENZIONE;
  } else if (overdue) {
    status = QUOTA_STATUS.CRITICO;
  } else {
    // Con i nodi si usano i giorni INTERI necessari (stessa proiezione
    // della "Fine Prevista", così i due numeri non si contraddicono mai);
    // senza nodi, le ore grezze. Stesse soglie in entrambi i casi.
    paceRatio = hasNodes && totalDaysNeeded > 0 ? totalDaysNeeded / daysRemaining : hoursRemaining / (daysRemaining * capacity);
    status = statusFromRatio(paceRatio);
    // Coerenza con la Fine Prevista: se la traiettoria a nodi arriva in
    // tempo, lo stato non può essere peggiore di OTTIMALE.
    if (
      hasNodes &&
      finePrevistaDateKey != null &&
      dateOnlyToUtcMs(finePrevistaDateKey) <= dateOnlyToUtcMs(materia.examDate)
    ) {
      status = QUOTA_STATUS.OTTIMALE;
    }
  }

  const rawStatus = status;
  const { frozen, missingPrereqNames } = computePrereqFreeze(materia, allMaterie);
  if (frozen) status = QUOTA_STATUS.CONGELATA;

  return {
    materiaId: materia.id,
    nome: materia.nome,
    examDate: materia.examDate || null,
    hasNodes,
    hoursRemaining: Math.round(hoursRemaining * 100) / 100,
    daysRemaining,
    dataScaduta,
    dailyQuotaHours,
    finePrevistaDateKey,
    paceRatio: paceRatio != null ? Math.round(paceRatio * 100) / 100 : null,
    cumulativeRatio: null,
    cumulativeOverload: false,
    overdue,
    status,
    rawStatus,
    frozen,
    missingPrereqNames,
    eventHorizon: status === QUOTA_STATUS.CRITICO
  };
}

/**
 * V39.0 — CARICO CUMULATIVO (fattibilità "earliest deadline first").
 *
 * Per ogni materia con una scadenza vera, somma le ore residue di TUTTE
 * le materie con esame entro la stessa data e le confronta con le ore
 * disponibili fino a quella data. Se non ci stanno, il problema non è
 * di una materia sola ma di tutto ciò che scade entro lì: la materia la
 * cui scadenza rompe la fattibilità viene portata almeno allo stato che
 * quel rapporto impone.
 *
 * Restituisce un array NUOVO; non muta le quote in ingresso.
 */
export function applyCumulativeLoad(quotas, calibration = null) {
  const capacity = capacityOf(calibration);
  const conScadenza = quotas
    .filter((q) => !q.frozen && q.daysRemaining != null && q.daysRemaining > 0 && q.hoursRemaining > 0)
    .sort((a, b) => a.daysRemaining - b.daysRemaining);

  const perId = new Map();
  let cumulate = 0;
  conScadenza.forEach((q) => {
    cumulate += q.hoursRemaining;
    perId.set(q.materiaId, cumulate / (q.daysRemaining * capacity));
  });
  // Materie con la stessa data condividono la stessa scadenza: prendono
  // tutte il rapporto più alto del loro gruppo.
  const perData = new Map();
  conScadenza.forEach((q) => {
    const r = perId.get(q.materiaId);
    perData.set(q.daysRemaining, Math.max(perData.get(q.daysRemaining) ?? 0, r));
  });

  return quotas.map((q) => {
    if (!perId.has(q.materiaId)) return q;
    const ratio = Math.round(perData.get(q.daysRemaining) * 100) / 100;
    const overload = ratio > RATIO_OK;
    const status = worst(q.status, statusFromRatio(ratio));
    return {
      ...q,
      cumulativeRatio: ratio,
      cumulativeOverload: overload,
      status,
      eventHorizon: status === QUOTA_STATUS.CRITICO
    };
  });
}

/**
 * Ordinamento per urgenza.
 *
 * V39.0 — prima si separano i gruppi, poi si ordina dentro ognuno:
 *   0. materie con una scadenza vera e lavoro residuo;
 *   1. materie con lavoro residuo ma senza data (o con data scaduta);
 *   2. materie senza lavoro residuo;
 *   3. materie congelate (propedeuticità mancanti).
 * Prima una materia senza data, essendo ATTENZIONE, scavalcava una
 * materia OTTIMALE con un esame vero.
 *
 * Dentro il gruppo 0 resta la regola V35.4: un esame entro
 * CRITICAL_DISTANCE_DAYS scavalca sempre tutto, fra due imminenti vince il
 * più vicino; oltre quella soglia conta lo stato, poi i giorni.
 */
/** Lavoro residuo: escluso solo chi dichiara esplicitamente 0 ore. */
function haLavoro(q) {
  return !(Number.isFinite(q.hoursRemaining) && q.hoursRemaining <= 0);
}

function urgencyGroup(q) {
  if (q.frozen) return 3;
  if (!haLavoro(q)) return 2;
  if (q.daysRemaining == null) return 1;
  return 0;
}

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
  return (b.dailyQuotaHours || 0) - (a.dailyQuotaHours || 0) || (b.hoursRemaining || 0) - (a.hoursRemaining || 0);
}

/**
 * Quali materie il planner spinge oggi.
 *   1. mai una materia congelata né una senza lavoro residuo;
 *   2. mai più di MAX_DAILY_FOCUS_MATERIE;
 *   3. esame entro CRITICAL_DISTANCE_DAYS in testa: monotask;
 *   4. V39.0 — gli slot si riempiono PRIMA con le materie che hanno una
 *      quota vera; quelle senza data entrano solo se avanza posto;
 *   5. V39.0 — `priorityIds` (le materie seguite a lezione oggi, vedi
 *      utils/campusEngine.js): fuori dal monotask, la prima di queste
 *      prende il SECONDO slot. Mai il primo: la materia più a rischio
 *      resta in testa, ma la lezione di oggi va sistemata oggi, finché è
 *      fresca — è il lavoro di sintesi con il rendimento più alto.
 */
export function selectDailyFocus(sortedQuotas, { priorityIds = null } = {}) {
  const eligible = sortedQuotas.filter((q) => !q.frozen && haLavoro(q));
  if (eligible.length === 0) return { focusIds: new Set(), monotaskActive: false, priorityApplied: null };

  const withQuota = eligible.filter((q) => q.daysRemaining != null);
  const withoutQuota = eligible.filter((q) => q.daysRemaining == null);
  const ordered = [...withQuota, ...withoutQuota];

  const topDays = ordered[0].daysRemaining;
  const monotaskActive = topDays != null && topDays <= CRITICAL_DISTANCE_DAYS;
  const limit = monotaskActive ? 1 : MAX_DAILY_FOCUS_MATERIE;
  const picked = ordered.slice(0, limit).map((q) => q.materiaId);

  let priorityApplied = null;
  if (!monotaskActive && priorityIds && priorityIds.size > 0) {
    const candidate = ordered.find((q) => priorityIds.has(q.materiaId));
    if (candidate && !picked.includes(candidate.materiaId)) {
      if (picked.length < limit) picked.push(candidate.materiaId);
      else picked[limit - 1] = candidate.materiaId;
      priorityApplied = candidate.materiaId;
    } else if (candidate) {
      priorityApplied = candidate.materiaId;
    }
  }
  return { focusIds: new Set(picked), monotaskActive, priorityApplied };
}

/**
 * Budget giornaliero globale ripartito fra le materie in focus.
 *  - se basta: ognuna riceve quello che le serve; V39.0 — l'avanzo va
 *    alle materie in focus senza una quota calcolabile (senza data), che
 *    prima restavano a 0h pur occupando uno slot;
 *  - se non basta: riparto proporzionale e deficit dichiarato.
 */
export function allocateDailyBudget(focusQuotas, budgetHours) {
  const safeBudget = Number.isFinite(budgetHours) && budgetHours > 0 ? budgetHours : 0;
  const needs = focusQuotas.map((q) => ({
    materiaId: q.materiaId,
    need: Number.isFinite(q.dailyQuotaHours) && q.dailyQuotaHours > 0 ? q.dailyQuotaHours : 0,
    senzaQuota: !(Number.isFinite(q.dailyQuotaHours) && q.dailyQuotaHours > 0) && haLavoro(q) && q.dailyQuotaHours !== 0
  }));
  const totalNeed = needs.reduce((sum, n) => sum + n.need, 0);
  const fits = totalNeed <= safeBudget;

  const allocation = new Map();
  needs.forEach((n) => {
    const assigned = fits || totalNeed === 0 ? n.need : (n.need / totalNeed) * safeBudget;
    allocation.set(n.materiaId, Math.round(assigned * 100) / 100);
  });

  let slack = fits ? safeBudget - totalNeed : 0;
  const beneficiari = needs.filter((n) => n.senzaQuota);
  if (slack > 0 && beneficiari.length > 0) {
    const quota = slack / beneficiari.length;
    beneficiari.forEach((n) => allocation.set(n.materiaId, Math.round((allocation.get(n.materiaId) + quota) * 100) / 100));
    slack = 0;
  }

  return {
    allocation,
    budgetHours: Math.round(safeBudget * 100) / 100,
    totalNeedHours: Math.round(totalNeed * 100) / 100,
    overCapacity: !fits && totalNeed > 0,
    deficitHours: fits ? 0 : Math.round((totalNeed - safeBudget) * 100) / 100,
    slackHours: Math.round(slack * 100) / 100
  };
}

/**
 * Il piano completo del giorno, in una funzione: quote (con carico
 * cumulativo), ordinamento, focus, budget. È ciò che l'hook memoizza e
 * che il reducer richiama per verificare la missione Primary Target.
 *
 * @param {Array} materie
 * @param {object} options { calibration, loadAdjustmentPct, priorityIds }
 */
export function computeDailyPlan(materie, { calibration = null, loadAdjustmentPct = 0, priorityIds = null } = {}) {
  const safe = Array.isArray(materie) ? materie : [];
  const quotas = applyCumulativeLoad(
    safe.filter((m) => m && !m.examPassed).map((m) => computeMateriaQuota(m, safe, calibration)),
    calibration
  ).sort(compareByUrgency);

  const { focusIds, monotaskActive, priorityApplied } = selectDailyFocus(quotas, { priorityIds });
  const dailyFocusQuotas = quotas.filter((q) => focusIds.has(q.materiaId));
  // L'ordine delle materie in focus segue quello di urgenza, tranne che
  // per la materia promossa dalla lezione di oggi, che resta seconda.
  const queuedQuotas = quotas.filter((q) => !focusIds.has(q.materiaId) && !q.frozen);
  const frozenQuotas = quotas.filter((q) => q.frozen);
  const eventHorizonList = quotas.filter((q) => q.status === QUOTA_STATUS.CRITICO);

  const safePct = Number.isFinite(loadAdjustmentPct) ? Math.max(-50, Math.min(0, loadAdjustmentPct)) : 0;
  const base = Number(calibration?.hoursPerDay) > 0 ? Number(calibration.hoursPerDay) : EVENT_HORIZON_THRESHOLD_HOURS;
  const adjusted = base * (1 + safePct / 100);
  const budgetResult = allocateDailyBudget(dailyFocusQuotas, adjusted);
  const budget = { ...budgetResult, baseBudgetHours: Math.round(base * 100) / 100, loadAdjustmentPct: safePct };

  const withBudget = dailyFocusQuotas.map((q) => ({
    ...q,
    assignedHours: budget.allocation.get(q.materiaId) ?? null,
    promossaDaLezione: q.materiaId === priorityApplied
  }));

  const byMateriaId = new Map(quotas.map((q) => [q.materiaId, q]));
  const overload = quotas.find((q) => q.cumulativeOverload) || null;

  return {
    quotas,
    byMateriaId,
    eventHorizonList,
    criticalCount: eventHorizonList.length,
    dailyFocusIds: focusIds,
    monotaskActive,
    priorityApplied,
    dailyFocusQuotas: withBudget,
    queuedQuotas,
    frozenQuotas,
    budget,
    // La prima scadenza oltre la quale il carico complessivo non ci sta.
    cumulativeOverload: overload
      ? { materiaId: overload.materiaId, nome: overload.nome, ratio: overload.cumulativeRatio, daysRemaining: overload.daysRemaining }
      : null
  };
}
