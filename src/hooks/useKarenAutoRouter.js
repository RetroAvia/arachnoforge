import { useMemo, useState, useEffect } from 'react';
import { daysUntilDateOnly, todayDateOnlyKey, dateOnlyToUtcMs } from '../utils/dateUtils.js';
import { computeEstimatedCompletion } from '../utils/materiaMeta.js';
import { getMissingPrerequisites } from '../data/vanvitelliCourseMap.js';

/**
 * K.A.R.E.N. AUTO-ROUTER — V23.0 "The Quantum Router" (Modulo 1), esteso in
 * V29.0 "The Quantum Syllabus & Mobile Overhaul" (Pillar 1 + Pillar 2).
 *
 * DYNAMIC FALLBACK LOGIC (invariata da V23.0):
 *   - SE la Materia ha Nodi (sfide.length > 0): il Monte Ore Residuo si
 *     costruisce dal BASSO, nodo per nodo — `oreStimate` di ciascun nodo
 *     ANCORA incompleto (unità nativa in ore, vedi V34.2), meno le ore di
 *     Focus già tracciate su quello specifico nodo.
 *   - SE la Materia ha 0 Nodi creati: fallback puro sul monte-ore
 *     accademico standard (CFU * 10).
 *
 * V29.0 — Pillar 1 (Realistic Hour Balancing): `HOURS_PER_NODE_DAY`
 * (importato da utils/materiaMeta.js, unica fonte di verità) converte le
 * ore totali stimate di una Materia in giorni di calendario SOLO per
 * proiettare "Fine Prevista" — un monte ore REALMENTE sostenibile per uno
 * studente (4.5 ore di studio effettivo al giorno), non una frazione
 * irrisoria.
 *
 * V34.2 — "Ore Previste": ogni nodo dichiara direttamente le proprie ore
 * stimate (`oreStimate`, decimale) invece dei vecchi "giorni previsti"
 * (intero, poi moltiplicato per HOURS_PER_NODE_DAY) — stessa unità finale
 * (ore), granularità più fine, una moltiplicazione in meno da propagare.
 *
 * V29.0 — Pillar 1 (Planner Restriction): il Quantum Router non elenca più
 * "tutto insieme" come consiglio attivo. `selectDailyFocus` isola al
 * massimo `MAX_DAILY_FOCUS_MATERIE` materie come "in focus oggi",
 * ordinate per URGENZA ASSOLUTA (stato + giorni residui, MAI il monte-ore
 * grezzo a scavalcare una scadenza vicina) — e forza il monotask (1 sola
 * materia) quando la più urgente è a distanza critica
 * (`CRITICAL_DISTANCE_DAYS`).
 *
 * V29.0 — Pillar 2 (Automatic Precedence Engine): ogni Materia con
 * propedeuticità ufficiali (piano di studi Vanvitelli) non ancora
 * superate risulta `frozen` — stato di planner forzato a CONGELATA,
 * esclusa da `selectDailyFocus` e dal Primary Target (vedi
 * `utils/karenSuggestor.js`). Resta comunque calcolabile e visibile: la
 * congelazione riguarda SOLO la spinta automatica del planner, mai la
 * possibilità di aprire la scheda e preparare i nodi in anticipo.
 */
export const HOURS_PER_CFU = 10;
export const EVENT_HORIZON_THRESHOLD_HOURS = 8;

export const MAX_DAILY_FOCUS_MATERIE = 2; // limite rigido: mai più di 2 materie spinte nello stesso giorno.
export const CRITICAL_DISTANCE_DAYS = 10; // sotto questa soglia: monotask intensivo forzato (1 sola materia).

export const QUOTA_STATUS = {
  OTTIMALE: 'OTTIMALE',
  ATTENZIONE: 'ATTENZIONE',
  CRITICO: 'CRITICO',
  CONGELATA: 'CONGELATA' // V29.0 — Pillar 2: propedeuticità non soddisfatte, planner automatico disattivato.
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

/** Ramo Nodi: Ore Residue = Σ (oreStimate_nodo - ore già tracciate su quel nodo), solo sui nodi NON completati. */
function computeNodeBasedLoad(materia) {
  const sfide = Array.isArray(materia.sfide) ? materia.sfide : [];
  const incomplete = sfide.filter((s) => s.status !== 'COMPLETED');
  const hoursRemaining = incomplete.reduce((sum, s) => {
    const budgetHours = Math.max(0.5, Number(s.oreStimate) || 0);
    const trackedHours = (Number(s.focusMinutes) || 0) / 60;
    return sum + Math.max(0, budgetHours - trackedHours);
  }, 0);
  return { hoursRemaining, remainingNodeCount: incomplete.length };
}

/** V29.0 — Pillar 2: propedeuticità ufficiali NON ancora soddisfatte per questa Materia (grafo Vanvitelli), sempre calcolate sullo stato REALE (`examPassed`) delle altre Materie dell'utente. */
function computePrereqFreeze(materia, allMaterie) {
  if (!materia.courseId) return { frozen: false, missingPrereqNames: [] };
  const missing = getMissingPrerequisites(materia.courseId, allMaterie, materia.id);
  return { frozen: missing.length > 0, missingPrereqNames: missing.map((c) => c.nome) };
}

function computeMateriaQuota(materia, allMaterie) {
  const sfide = Array.isArray(materia.sfide) ? materia.sfide : [];
  const hasNodes = sfide.length > 0;
  const daysRemaining = materia.examDate ? daysUntilDateOnly(materia.examDate) : null;

  let hoursRemaining = 0;
  let finePrevistaDateKey = null;
  let totalDaysNeeded = 0;

  if (hasNodes) {
    const nodeLoad = computeNodeBasedLoad(materia);
    hoursRemaining = nodeLoad.hoursRemaining;
    // Single source of truth: la STESSA funzione che disegna "Fine
    // Prevista" nella card Skill Tree di QuadrantHub.jsx — zero drift
    // possibile fra i due motori.
    const estimate = computeEstimatedCompletion(materia);
    finePrevistaDateKey = estimate.done ? null : estimate.dateKey;
    totalDaysNeeded = estimate.totalDaysNeeded || 0;
  } else {
    hoursRemaining = Math.max(0, (Number(materia.cfu) || 0) * HOURS_PER_CFU);
  }

  let dailyQuotaHours = null;
  let overdue = false;
  if (hoursRemaining <= 0) {
    dailyQuotaHours = 0;
  } else if (daysRemaining == null) {
    dailyQuotaHours = null;
  } else if (daysRemaining <= 0) {
    dailyQuotaHours = hoursRemaining;
    overdue = true;
  } else {
    dailyQuotaHours = hoursRemaining / daysRemaining;
  }

  // --- QUANTUM ROUTER: risoluzione status a 3 livelli, MAI un conflitto. ---
  let status;
  let paceRatio = null;
  if (hoursRemaining <= 0) {
    status = QUOTA_STATUS.OTTIMALE;
  } else if (daysRemaining == null) {
    status = QUOTA_STATUS.ATTENZIONE; // nessuna data esame: Karen non può proiettare il rischio.
  } else if (overdue) {
    status = QUOTA_STATUS.CRITICO; // esame oggi/scaduto con lavoro ancora aperto: sempre critico.
  } else if (hasNodes) {
    paceRatio = totalDaysNeeded / daysRemaining;
    const finePrevistaOk =
      finePrevistaDateKey != null && dateOnlyToUtcMs(finePrevistaDateKey) <= dateOnlyToUtcMs(materia.examDate);
    if (finePrevistaOk) {
      status = QUOTA_STATUS.OTTIMALE; // OVERRIDE DEFCON 1: la traiettoria a nodi arriva in tempo, allarme disattivato per direttiva.
    } else if (paceRatio <= 1.5) {
      status = QUOTA_STATUS.ATTENZIONE;
    } else {
      status = QUOTA_STATUS.CRITICO;
    }
  } else {
    const ratio = dailyQuotaHours / EVENT_HORIZON_THRESHOLD_HOURS;
    if (ratio <= 0.5) status = QUOTA_STATUS.OTTIMALE;
    else if (ratio <= 1) status = QUOTA_STATUS.ATTENZIONE;
    else status = QUOTA_STATUS.CRITICO;
  }

  const rawStatus = status;
  const { frozen, missingPrereqNames } = computePrereqFreeze(materia, allMaterie);
  // V29.0 — Pillar 2: la congelazione da propedeuticità mancante scavalca
  // SEMPRE lo stato "grezzo" (anche se sarebbe Critico) — Karen non spinge
  // mai una materia che l'utente non può ancora ufficialmente sostenere.
  if (frozen) status = QUOTA_STATUS.CONGELATA;

  return {
    materiaId: materia.id,
    nome: materia.nome,
    hasNodes,
    hoursRemaining: Math.round(hoursRemaining * 100) / 100,
    daysRemaining,
    dailyQuotaHours,
    finePrevistaDateKey,
    paceRatio: paceRatio != null ? Math.round(paceRatio * 100) / 100 : null,
    overdue,
    status,
    rawStatus,
    frozen,
    missingPrereqNames,
    // Alias di retro-compatibilità per l'HUD Rosso Lampeggiante già cablato altrove.
    eventHorizon: status === QUOTA_STATUS.CRITICO
  };
}

/** V29.0 — Pillar 1: ordinamento a precedenza assoluta — stato (Critico > Attenzione > Ottimale > Congelata) e poi giorni residui ascendenti. Mai il monte-ore grezzo a scavalcare una scadenza più vicina. */
const STATUS_RANK = {
  [QUOTA_STATUS.CRITICO]: 0,
  [QUOTA_STATUS.ATTENZIONE]: 1,
  [QUOTA_STATUS.OTTIMALE]: 2,
  [QUOTA_STATUS.CONGELATA]: 3
};

function compareByUrgency(a, b) {
  const rankA = STATUS_RANK[a.status] ?? 4;
  const rankB = STATUS_RANK[b.status] ?? 4;
  if (rankA !== rankB) return rankA - rankB;
  const daysA = a.daysRemaining == null ? Infinity : a.daysRemaining;
  const daysB = b.daysRemaining == null ? Infinity : b.daysRemaining;
  if (daysA !== daysB) return daysA - daysB;
  return (b.dailyQuotaHours || 0) - (a.dailyQuotaHours || 0);
}

/**
 * V29.0 — Pillar 1: seleziona quali Materie il planner "spinge" oggi.
 * Regole rigide, nessuna eccezione:
 *   1. Mai una Materia congelata (propedeuticità mancante, Pillar 2).
 *   2. Mai più di MAX_DAILY_FOCUS_MATERIE materie insieme.
 *   3. Se la Materia più urgente (già in cima a `sortedQuotas`, ordinata
 *      da `compareByUrgency`) è a CRITICAL_DISTANCE_DAYS giorni o meno,
 *      monotask intensivo forzato: una sola Materia in focus.
 */
function selectDailyFocus(sortedQuotas) {
  const eligible = sortedQuotas.filter((q) => !q.frozen);
  if (eligible.length === 0) return { focusIds: new Set(), monotaskActive: false };
  const topDays = eligible[0].daysRemaining;
  const monotaskActive = topDays != null && topDays <= CRITICAL_DISTANCE_DAYS;
  const limit = monotaskActive ? 1 : MAX_DAILY_FOCUS_MATERIE;
  const focusIds = new Set(eligible.slice(0, limit).map((q) => q.materiaId));
  return { focusIds, monotaskActive };
}

/**
 * @param {Array} materie - state.materie corrente
 * @returns {{
 *   quotas: Array, byMateriaId: Map, eventHorizonList: Array, criticalCount: number,
 *   dailyFocusIds: Set, monotaskActive: boolean,
 *   dailyFocusQuotas: Array, queuedQuotas: Array, frozenQuotas: Array
 * }}
 */
export function useKarenAutoRouter(materie) {
  const [dayKey, setDayKey] = useState(todayDateOnlyKey);

  // Heartbeat leggero: ricalcola la chiave del giorno ogni minuto, così il
  // memo sottostante si invalida esplicitamente attraversando la mezzanotte
  // (GPS che ricalcola il percorso), anche a stato applicativo fermo.
  useEffect(() => {
    const check = () => {
      const key = todayDateOnlyKey();
      setDayKey((prev) => (prev !== key ? key : prev));
    };
    const id = setInterval(check, 60000);
    return () => clearInterval(id);
  }, []);

  const quotas = useMemo(() => {
    const safe = Array.isArray(materie) ? materie : [];
    return safe
      .filter((m) => m && !m.examPassed)
      .map((m) => computeMateriaQuota(m, safe))
      .sort(compareByUrgency);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [materie, dayKey]);

  const byMateriaId = useMemo(() => {
    const map = new Map();
    quotas.forEach((q) => map.set(q.materiaId, q));
    return map;
  }, [quotas]);

  const { focusIds, monotaskActive } = useMemo(() => selectDailyFocus(quotas), [quotas]);

  // V29.0 — Pillar 1: tre liste distinte per la UI (Quota Odierna) — "in
  // focus oggi" (planner attivo, max 1-2), "in coda" (visibile ma non
  // spinta oggi, resta calcolabile) e "congelata" (propedeuticità
  // mancante, Pillar 2) — mai più un'unica lista indifferenziata.
  const dailyFocusQuotas = useMemo(() => quotas.filter((q) => focusIds.has(q.materiaId)), [quotas, focusIds]);
  const queuedQuotas = useMemo(() => quotas.filter((q) => !focusIds.has(q.materiaId) && !q.frozen), [quotas, focusIds]);
  const frozenQuotas = useMemo(() => quotas.filter((q) => q.frozen), [quotas]);

  const eventHorizonList = useMemo(() => quotas.filter((q) => q.status === QUOTA_STATUS.CRITICO), [quotas]);

  return {
    quotas,
    byMateriaId,
    eventHorizonList,
    criticalCount: eventHorizonList.length,
    dailyFocusIds: focusIds,
    monotaskActive,
    dailyFocusQuotas,
    queuedQuotas,
    frozenQuotas
  };
}

export default useKarenAutoRouter;
