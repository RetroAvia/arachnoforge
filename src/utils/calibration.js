// =====================================================================
// ArachnoForge — src/utils/calibration.js (V36.0)
// "Karen impara da te": sostituisce le due costanti inventate su cui
// poggiava l'intera pianificazione con due numeri misurati sul TUO
// storico reale.
//
//  1. CAPACITÀ GIORNALIERA — quante ore di studio effettivo riesci
//     davvero a fare in un giorno medio. Prima era HOURS_PER_NODE_DAY =
//     4.5, un valore da manuale: ogni "Fine Prevista" dell'app era
//     tarata su uno studente ideale che non esiste.
//  2. FATTORE DI CALIBRAZIONE DELLE STIME — di quanto sbagli, in modo
//     sistematico, quando dichiari le "Ore previste" di un nodo. L'app
//     tracciava già `focusMinutes` per nodo e `oreStimate` dichiarate,
//     ma non le aveva mai confrontate: il dato era lì, inutilizzato.
//
// Entrambi degradano con grazia: sotto la soglia minima di campioni
// tornano il default storico (4.5 h/giorno, fattore 1.0) marcandosi come
// non affidabili, così la UI può dire onestamente "stima non ancora
// calibrata" invece di mostrare un numero costruito su 2 sessioni.
// =====================================================================
import { HOURS_PER_NODE_DAY } from './materiaMeta.js';
import { todayDateOnlyKey, dateOnlyToUtcMs } from './dateUtils.js';
import { PERSISTED_STATUS } from './skillTree.js';

/** Finestra di osservazione della capacità giornaliera. */
export const CAPACITY_WINDOW_DAYS = 30;
/** Sotto questo numero di giorni osservati la capacità non è affidabile. */
export const CAPACITY_MIN_DAYS = 7;
/** Limiti di sicurezza: nessuna capacità sotto 1h o sopra 10h/giorno. */
export const CAPACITY_MIN_HOURS = 1;
export const CAPACITY_MAX_HOURS = 10;

/** Nodi completati necessari prima di fidarsi del fattore di calibrazione. */
export const BIAS_MIN_SAMPLES = 5;
/** Limiti di sicurezza sul fattore (mai oltre il triplo, mai sotto la metà). */
export const BIAS_MIN = 0.5;
export const BIAS_MAX = 3;

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

/**
 * Capacità giornaliera SOSTENIBILE, in ore.
 *
 * Deliberatamente calcolata come media sui giorni di CALENDARIO della
 * finestra (non sui soli giorni attivi): i giorni di riposo esistono e
 * devono entrare nella proiezione, altrimenti ogni "Fine Prevista"
 * presuppone che tu studi anche la domenica. È lo stesso motivo per cui
 * non serve una logica feriale/weekend separata — i weekend sono già
 * dentro il denominatore, pesati per come li vivi davvero.
 *
 * La finestra parte dal primo giorno realmente registrato, così un
 * profilo attivo da 10 giorni non viene diluito su 30.
 *
 * @param {Array} starLog `state.starLog`
 * @returns {{hoursPerDay:number, confident:boolean, observedDays:number, totalHours:number}}
 */
export function computeDailyCapacity(starLog) {
  const entries = (Array.isArray(starLog) ? starLog : []).filter(
    (e) => e && e.type === 'FOCUS_MINUTES' && typeof e.dateKey === 'string' && Number(e.minutes) > 0
  );
  if (entries.length === 0) {
    return { hoursPerDay: HOURS_PER_NODE_DAY, confident: false, observedDays: 0, totalHours: 0 };
  }

  const todayMs = dateOnlyToUtcMs(todayDateOnlyKey());
  const windowStartMs = todayMs - (CAPACITY_WINDOW_DAYS - 1) * 86400000;
  const inWindow = entries.filter((e) => dateOnlyToUtcMs(e.dateKey) >= windowStartMs);
  if (inWindow.length === 0) {
    return { hoursPerDay: HOURS_PER_NODE_DAY, confident: false, observedDays: 0, totalHours: 0 };
  }

  const firstMs = Math.min(...inWindow.map((e) => dateOnlyToUtcMs(e.dateKey)));
  // +1 perché la finestra è inclusiva su entrambi gli estremi.
  const observedDays = Math.max(1, Math.round((todayMs - firstMs) / 86400000) + 1);
  const totalHours = inWindow.reduce((sum, e) => sum + Number(e.minutes) / 60, 0);
  const raw = totalHours / observedDays;

  return {
    hoursPerDay: clamp(Math.round(raw * 10) / 10, CAPACITY_MIN_HOURS, CAPACITY_MAX_HOURS),
    confident: observedDays >= CAPACITY_MIN_DAYS,
    observedDays,
    totalHours: Math.round(totalHours * 10) / 10
  };
}

/**
 * Fattore di calibrazione delle stime: mediana di (ore reali / ore
 * stimate) sui nodi già completati che portano entrambi i dati.
 *
 * Mediana e non media: una singola sessione-maratona su un nodo non deve
 * spostare permanentemente la percezione di tutte le stime future.
 *
 * @param {Array} materie `state.materie`
 * @returns {{factor:number, confident:boolean, sampleSize:number}}
 */
export function computeEstimateBias(materie) {
  const ratios = [];
  (Array.isArray(materie) ? materie : []).forEach((m) => {
    (Array.isArray(m?.sfide) ? m.sfide : []).forEach((s) => {
      if (!s || s.status !== PERSISTED_STATUS.COMPLETED) return;
      const estimated = Number(s.oreStimate);
      const actual = Number(s.focusMinutes) / 60;
      if (!Number.isFinite(estimated) || estimated <= 0) return;
      if (!Number.isFinite(actual) || actual <= 0) return;
      ratios.push(actual / estimated);
    });
  });

  if (ratios.length < BIAS_MIN_SAMPLES) {
    return { factor: 1, confident: false, sampleSize: ratios.length };
  }
  const raw = median(ratios);
  return {
    factor: clamp(Math.round(raw * 100) / 100, BIAS_MIN, BIAS_MAX),
    confident: true,
    sampleSize: ratios.length
  };
}

/** Ore previste di un nodo, corrette dal tuo bias personale. Minimo 0.5h
 * (stessa guardia anti dato corrotto già usata in materiaMeta.js). */
export function calibratedNodeHours(sfida, biasFactor = 1) {
  const base = Math.max(0.5, Number(sfida?.oreStimate) || 0);
  const factor = Number.isFinite(biasFactor) && biasFactor > 0 ? biasFactor : 1;
  return Math.round(base * factor * 100) / 100;
}

/** Il pacchetto completo, calcolato una volta sola a livello di Provider
 * e passato a valle: nessun consumatore ricalcola per conto proprio. */
export function computeCalibration(state) {
  const capacity = computeDailyCapacity(state?.starLog);
  const bias = computeEstimateBias(state?.materie);
  return {
    hoursPerDay: capacity.hoursPerDay,
    capacityConfident: capacity.confident,
    observedDays: capacity.observedDays,
    biasFactor: bias.factor,
    biasConfident: bias.confident,
    biasSampleSize: bias.sampleSize
  };
}

/** Valori neutri, identici al comportamento pre-V36.0 — usati come
 * default da ogni funzione che accetta una calibrazione opzionale, così
 * ogni chiamante non aggiornato continua a funzionare esattamente come
 * prima invece di ricevere `undefined`. */
export const NEUTRAL_CALIBRATION = {
  hoursPerDay: HOURS_PER_NODE_DAY,
  capacityConfident: false,
  observedDays: 0,
  biasFactor: 1,
  biasConfident: false,
  biasSampleSize: 0
};
