import { useMemo, useState, useEffect } from 'react';
import { daysUntilDateOnly, todayDateOnlyKey, dateOnlyToUtcMs } from '../utils/dateUtils.js';
import { computeEstimatedCompletion, computeRemainingHours, HOURS_PER_CFU } from '../utils/materiaMeta.js';
import { NEUTRAL_CALIBRATION } from '../utils/calibration.js';
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
 *
 * V35.4 — "Correzione disparità elevata": il commento sopra prometteva
 * "MAI il monte-ore grezzo a scavalcare una scadenza vicina", ma
 * l'implementazione originale di `compareByUrgency` ordinava PRIMA per
 * `status` (CRITICO > ATTENZIONE > OTTIMALE > CONGELATA) e SOLO POI per
 * giorni residui. Questo permetteva esattamente lo scavalcamento
 * promesso come impossibile: una materia lontana (es. 111gg) ma indietro
 * di passo (CRITICO, tanto monte-ore non ancora affrontato) scavalcava in
 * classifica una materia vicinissima (es. 6gg) ma ancora "in pari" col
 * proprio ritmo (OTTIMALE) — cosi' la seconda restava fuori dal Top-1,
 * `selectDailyFocus` non attivava il monotask (perché guardava SOLO
 * `eligible[0].daysRemaining`, cioè quello della materia lontana), e la
 * Quota Odierna finiva per spingere 1-2 materie lontane con un "Oggi: Xh"
 * paragonabile a quello della materia realmente urgente — esattamente la
 * "disparità elevata" segnalata dall'utente con un esame fra 6 giorni
 * trattato come equivalente a uno fra 87-111. Fix: qualunque materia
 * entro `CRITICAL_DISTANCE_DAYS` scavalca ORA sempre tutto il resto (a
 * prescindere dal suo status di passo), e fra due materie entrambe entro
 * quella soglia vince la più vicina — la vicinanza della scadenza,
 * l'unica cosa che l'utente non può recuperare con più impegno, viene
 * prima della salute della traiettoria. Lo stato/passo resta il criterio
 * di ordinamento SOLO fra materie che hanno tutte più di
 * `CRITICAL_DISTANCE_DAYS` giorni di margine, dove ha senso dare priorità
 * a chi è più indietro rispetto a chi è comodamente in pari.
 */
export { HOURS_PER_CFU };
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

/** V29.0 — Pillar 2: propedeuticità ufficiali NON ancora soddisfatte per questa Materia (grafo Vanvitelli), sempre calcolate sullo stato REALE (`examPassed`) delle altre Materie dell'utente. */
function computePrereqFreeze(materia, allMaterie) {
  if (!materia.courseId) return { frozen: false, missingPrereqNames: [] };
  const missing = getMissingPrerequisites(materia.courseId, allMaterie, materia.id);
  return { frozen: missing.length > 0, missingPrereqNames: missing.map((c) => c.nome) };
}

/** Esportata per test unitari mirati (V35.4) — il motore di calcolo della
 * quota di una singola Materia resta comunque uso interno primario di
 * `useKarenAutoRouter`, questa non è un'API pubblica per la UI. */
export function computeMateriaQuota(materia, allMaterie, calibration = NEUTRAL_CALIBRATION) {
  const sfide = Array.isArray(materia.sfide) ? materia.sfide : [];
  const hasNodes = sfide.length > 0;
  const daysRemaining = materia.examDate ? daysUntilDateOnly(materia.examDate) : null;

  // V36.0 — una sola definizione di "ore residue" per tutta l'app
  // (utils/materiaMeta.js), già corretta dal fattore di calibrazione
  // personale: il ramo nodi e il fallback CFU vivono lì dentro.
  let hoursRemaining = computeRemainingHours(materia, calibration);
  let finePrevistaDateKey = null;
  let totalDaysNeeded = 0;

  if (hasNodes) {
    // Single source of truth: la STESSA funzione che disegna "Fine
    // Prevista" nella card Skill Tree di QuadrantHub.jsx — zero drift
    // possibile fra i due motori.
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
    // V36.0 — la soglia non è più un 8h/giorno teorico uguale per tutti
    // ma la TUA capacità reale misurata (utils/calibration.js): una quota
    // di 5h/giorno è "ottimale" per chi ne regge 9 e "critica" per chi ne
    // regge 3. EVENT_HORIZON_THRESHOLD_HOURS resta solo come fallback.
    const capacity = calibration?.hoursPerDay > 0 ? calibration.hoursPerDay : EVENT_HORIZON_THRESHOLD_HOURS;
    const ratio = dailyQuotaHours / capacity;
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

/** V29.0 — Pillar 1: ordinamento a precedenza assoluta. V35.4: la
 * vicinanza di un esame entro CRITICAL_DISTANCE_DAYS scavalca SEMPRE lo
 * status di passo — vedi commento esteso in cima al file. Fra materie
 * tutte oltre quella soglia, resta status (Critico > Attenzione >
 * Ottimale > Congelata) poi giorni residui ascendenti. */
export const STATUS_RANK = {
  [QUOTA_STATUS.CRITICO]: 0,
  [QUOTA_STATUS.ATTENZIONE]: 1,
  [QUOTA_STATUS.OTTIMALE]: 2,
  [QUOTA_STATUS.CONGELATA]: 3
};

/** Esportata per test unitari mirati (V35.4). */
export function compareByUrgency(a, b) {
  const daysA = a.daysRemaining == null ? Infinity : a.daysRemaining;
  const daysB = b.daysRemaining == null ? Infinity : b.daysRemaining;

  // Un esame entro CRITICAL_DISTANCE_DAYS scavalca sempre tutto il resto,
  // a prescindere dallo status di passo — vedi commento V35.4 sopra.
  const aImminent = daysA <= CRITICAL_DISTANCE_DAYS;
  const bImminent = daysB <= CRITICAL_DISTANCE_DAYS;
  if (aImminent !== bImminent) return aImminent ? -1 : 1;
  if (aImminent && bImminent && daysA !== daysB) return daysA - daysB;

  const rankA = STATUS_RANK[a.status] ?? 4;
  const rankB = STATUS_RANK[b.status] ?? 4;
  if (rankA !== rankB) return rankA - rankB;
  if (daysA !== daysB) return daysA - daysB;
  return (b.dailyQuotaHours || 0) - (a.dailyQuotaHours || 0);
}

/**
 * V29.0 — Pillar 1: seleziona quali Materie il planner "spinge" oggi.
 * Regole rigide, nessuna eccezione:
 *   1. Mai una Materia congelata (propedeuticità mancante, Pillar 2).
 *   2. Mai più di MAX_DAILY_FOCUS_MATERIE materie insieme.
 *   3. Se la Materia più urgente (già in cima a `sortedQuotas`, ordinata
 *      da `compareByUrgency` — V35.4: ora garantita essere l'esame più
 *      vicino fra quelle eleggibili, se ce n'è uno entro
 *      CRITICAL_DISTANCE_DAYS) è a CRITICAL_DISTANCE_DAYS giorni o meno,
 *      monotask intensivo forzato: una sola Materia in focus.
 *
 * Esportata per test unitari mirati (V35.4).
 */
export function selectDailyFocus(sortedQuotas) {
  const eligible = sortedQuotas.filter((q) => !q.frozen);
  if (eligible.length === 0) return { focusIds: new Set(), monotaskActive: false };
  const topDays = eligible[0].daysRemaining;
  const monotaskActive = topDays != null && topDays <= CRITICAL_DISTANCE_DAYS;
  const limit = monotaskActive ? 1 : MAX_DAILY_FOCUS_MATERIE;
  const focusIds = new Set(eligible.slice(0, limit).map((q) => q.materiaId));
  return { focusIds, monotaskActive };
}

/**
 * V36.0 — BUDGET GIORNALIERO GLOBALE.
 *
 * Fino alla V35 ogni materia in focus calcolava la propria quota in modo
 * INDIPENDENTE (ore residue / giorni residui) e la UI le mostrava
 * affiancate. Con 2 materie in focus si arrivava tranquillamente a
 * "Oggi: 4h" + "Oggi: 3h" = 7 ore, un totale che nessuna giornata reale
 * contiene — e il Cadetto lo scopriva solo a fine giornata, fallendo
 * entrambe le quote e pagandone il prezzo emotivo.
 *
 * Ora esiste UN budget (la capacità reale misurata, eventualmente ridotta
 * dalla direttiva `mission_control.load_adjustment_pct` di K.A.R.E.N.) che
 * viene RIPARTITO fra le materie in focus:
 *  - se il budget basta, ognuna riceve esattamente quello che le serve e
 *    l'avanzo resta libero (`slackHours`);
 *  - se non basta, le ore vengono distribuite in proporzione al bisogno e
 *    il deficit viene dichiarato apertamente (`deficitHours`) invece di
 *    essere nascosto in due numeri che non tornano.
 *
 * Il deficit è un'informazione preziosa, non un fallimento: dice che il
 * piano NON è eseguibile al ritmo attuale, cioè esattamente quando serve
 * spostare una data d'esame o tagliare del programma.
 */
export function allocateDailyBudget(focusQuotas, budgetHours) {
  const safeBudget = Number.isFinite(budgetHours) && budgetHours > 0 ? budgetHours : 0;
  const needs = focusQuotas.map((q) => ({
    materiaId: q.materiaId,
    // Una materia senza data d'esame non ha una quota calcolabile: entra
    // nel riparto con un bisogno nullo e riceve solo dall'avanzo.
    need: Number.isFinite(q.dailyQuotaHours) && q.dailyQuotaHours > 0 ? q.dailyQuotaHours : 0
  }));
  const totalNeed = needs.reduce((sum, n) => sum + n.need, 0);
  const fits = totalNeed <= safeBudget;

  const allocation = new Map();
  needs.forEach((n) => {
    const assigned = fits || totalNeed === 0 ? n.need : (n.need / totalNeed) * safeBudget;
    allocation.set(n.materiaId, Math.round(assigned * 100) / 100);
  });

  return {
    allocation,
    budgetHours: Math.round(safeBudget * 100) / 100,
    totalNeedHours: Math.round(totalNeed * 100) / 100,
    overCapacity: !fits && totalNeed > 0,
    deficitHours: fits ? 0 : Math.round((totalNeed - safeBudget) * 100) / 100,
    slackHours: fits ? Math.round((safeBudget - totalNeed) * 100) / 100 : 0
  };
}

/**
 * @param {Array} materie - state.materie corrente
 * @returns {{
 *   quotas: Array, byMateriaId: Map, eventHorizonList: Array, criticalCount: number,
 *   dailyFocusIds: Set, monotaskActive: boolean,
 *   dailyFocusQuotas: Array, queuedQuotas: Array, frozenQuotas: Array
 * }}
 */
export function useKarenAutoRouter(materie, options = {}) {
  const { calibration = NEUTRAL_CALIBRATION, loadAdjustmentPct = 0 } = options;
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
      .map((m) => computeMateriaQuota(m, safe, calibration))
      .sort(compareByUrgency);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [materie, dayKey, calibration]);

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

  // V36.0 — la direttiva `mission_control.load_adjustment_pct` del Daily
  // Brief MODIFICA davvero il budget del giorno. Fino alla V35 era un
  // banner e basta: K.A.R.E.N. diceva "-30% oggi" e il numero sotto
  // continuava a chiedere le stesse ore. Una direttiva che il sistema
  // stesso ignora insegna a ignorare tutte le direttive.
  const budget = useMemo(() => {
    const safePct = Number.isFinite(loadAdjustmentPct) ? Math.max(-50, Math.min(0, loadAdjustmentPct)) : 0;
    const base = calibration?.hoursPerDay > 0 ? calibration.hoursPerDay : EVENT_HORIZON_THRESHOLD_HOURS;
    const adjusted = base * (1 + safePct / 100);
    const result = allocateDailyBudget(dailyFocusQuotas, adjusted);
    return { ...result, baseBudgetHours: Math.round(base * 100) / 100, loadAdjustmentPct: safePct };
  }, [dailyFocusQuotas, calibration, loadAdjustmentPct]);

  // Le quote in focus, arricchite con le ore REALMENTE assegnate oggi
  // dal riparto — la UI legge `assignedHours` e non deve più sommare da
  // sola due numeri indipendenti.
  const dailyFocusQuotasWithBudget = useMemo(
    () => dailyFocusQuotas.map((q) => ({ ...q, assignedHours: budget.allocation.get(q.materiaId) ?? null })),
    [dailyFocusQuotas, budget]
  );

  return {
    quotas,
    byMateriaId,
    eventHorizonList,
    criticalCount: eventHorizonList.length,
    dailyFocusIds: focusIds,
    monotaskActive,
    dailyFocusQuotas: dailyFocusQuotasWithBudget,
    queuedQuotas,
    frozenQuotas,
    budget
  };
}

export default useKarenAutoRouter;
