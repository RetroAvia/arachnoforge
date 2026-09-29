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
import { HOURS_PER_NODE_DAY, nodeBudgetHours } from './materiaMeta.js';
import {
  computeSintesiPagesPerHour,
  computeResaSintesi,
  DEFAULT_SINTESI_PAGES_PER_HOUR,
  DEFAULT_RESA_SINTESI
} from './sintesiEngine.js';
import { todayDateOnlyKey, addDaysToDateOnly, isoWeekdayOfDateKey } from './dateUtils.js';
import { detectPhase } from './campusEngine.js';
import { DEFAULT_PAGES_PER_HOUR } from './planningConstants.js';
import { PERSISTED_STATUS } from './skillTree.js';

/** Finestra di osservazione della capacità giornaliera. */
export const CAPACITY_WINDOW_DAYS = 30;
/** Sotto questo numero di giorni osservati la capacità non è affidabile. */
export const CAPACITY_MIN_DAYS = 7;
/** Limiti di sicurezza: nessuna capacità sotto 1h o sopra 10h/giorno. */
export const CAPACITY_MIN_HOURS = 1;
export const CAPACITY_MAX_HOURS = 10;
/** V42 — Giorni osservati necessari per fidarsi del profilo settimanale. */
export const WEEKDAY_MIN_DAYS = 14;
/** V42 — Peso del "valore neutro 1" nel fattore di un giorno della settimana. */
const WEEKDAY_SMOOTHING = 2;
/** V42 — Giorni di una fase (lezioni/sessione) per misurarne la capacità. */
export const PHASE_MIN_DAYS = 7;
/** V42 — Nei giorni di lezione, ogni ora in aula toglie mezz'ora di studio al default. */
export const LECTURE_HOUR_COST = 0.5;
export const LECTURE_DAY_MIN_HOURS = 1.5;

/** Nodi completati necessari prima di fidarsi del fattore di calibrazione. */
export const BIAS_MIN_SAMPLES = 5;
/** Limiti di sicurezza sul fattore (mai oltre il triplo, mai sotto la metà). */
export const BIAS_MIN = 0.5;
export const BIAS_MAX = 3;

/** V42 — Durata di un ripasso di un argomento, finché non è misurata. */
export const DEFAULT_REVIEW_MINUTES = 15;
export const REVIEW_MINUTES_MIN = 5;
export const REVIEW_MINUTES_MAX = 60;
export const REVIEW_MIN_SAMPLES = 3;

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

/**
 * Capacità giornaliera SOSTENIBILE, in ore.
 *
 * Media sui giorni di CALENDARIO della finestra (non sui soli giorni
 * attivi): i giorni di riposo esistono e devono entrare nella proiezione,
 * altrimenti ogni "Fine Prevista" presuppone che tu studi anche la
 * domenica. La finestra parte dal primo giorno realmente registrato.
 *
 * V42 — tre correzioni verificate:
 *  1. SOLO GIORNI CONCLUSI. Oggi non entra mai: la mattina, dopo la prima
 *     sessione, la giornata contava già come intera e la capacità
 *     scendeva (4,5 -> 4,1 dopo 25 minuti), cambiando stati e date a metà
 *     giornata.
 *  2. MISCELA COL DEFAULT. Prima la capacità misurata si usava anche con
 *     un solo giorno alle spalle: una sessione da 25 minuti il primo
 *     giorno dava 1 h/giorno e un esame OTTIMALE diventava CRITICO. Ora il
 *     peso della misura cresce con i giorni osservati (piena a 7).
 *  3. PROFILO SETTIMANALE E PER FASE. Con almeno due settimane di storico
 *     ogni giorno della settimana ha il suo fattore (la domenica di
 *     riposo pesa zero, il martedì pieno di più) e, con almeno 7 giorni
 *     per fase, lezioni e sessione hanno ciascuna la propria media.
 *
 * @param {Array} starLog `state.starLog`
 * @param {{todayKey?:string, phaseOf?:(dateKey:string)=>string|null}} [opts]
 */
export function computeDailyCapacity(starLog, { todayKey = todayDateOnlyKey(), phaseOf = null } = {}) {
  const neutral = {
    hoursPerDay: HOURS_PER_NODE_DAY,
    measuredHoursPerDay: null,
    weight: 0,
    confident: false,
    observedDays: 0,
    totalHours: 0,
    weekdayFactors: [null, 1, 1, 1, 1, 1, 1, 1],
    weekdayConfident: false,
    phaseHours: {}
  };
  const perGiorno = new Map();
  (Array.isArray(starLog) ? starLog : []).forEach((e) => {
    if (!e || e.type !== 'FOCUS_MINUTES' || typeof e.dateKey !== 'string' || !(Number(e.minutes) > 0)) return;
    if (e.dateKey >= todayKey) return; // solo giorni conclusi
    perGiorno.set(e.dateKey, (perGiorno.get(e.dateKey) || 0) + Number(e.minutes) / 60);
  });
  if (perGiorno.size === 0) return neutral;

  const ieri = addDaysToDateOnly(todayKey, -1);
  const inizioFinestra = addDaysToDateOnly(todayKey, -CAPACITY_WINDOW_DAYS);
  const primo = [...perGiorno.keys()].sort()[0];
  const start = primo > inizioFinestra ? primo : inizioFinestra;
  if (start > ieri) return neutral;

  const giorni = [];
  for (let d = start; d <= ieri; d = addDaysToDateOnly(d, 1)) giorni.push(d);
  const observedDays = giorni.length;
  const ore = giorni.map((d) => perGiorno.get(d) || 0);
  const totalHours = ore.reduce((a, b) => a + b, 0);
  if (totalHours <= 0) return { ...neutral, observedDays };
  const measured = totalHours / observedDays;
  const weight = Math.min(1, observedDays / CAPACITY_MIN_DAYS);
  const blended = weight * measured + (1 - weight) * HOURS_PER_NODE_DAY;

  // --- profilo per giorno della settimana ------------------------------
  const weekdayConfident = observedDays >= WEEKDAY_MIN_DAYS;
  let weekdayFactors = [null, 1, 1, 1, 1, 1, 1, 1];
  if (weekdayConfident) {
    const somma = [0, 0, 0, 0, 0, 0, 0, 0];
    const conta = [0, 0, 0, 0, 0, 0, 0, 0];
    giorni.forEach((d, i) => {
      const w = isoWeekdayOfDateKey(d);
      somma[w] += ore[i];
      conta[w] += 1;
    });
    const grezzi = [null];
    for (let w = 1; w <= 7; w += 1) {
      const media = conta[w] > 0 ? somma[w] / conta[w] : measured;
      grezzi.push(clamp((conta[w] * (media / measured) + WEEKDAY_SMOOTHING) / (conta[w] + WEEKDAY_SMOOTHING), 0, 2.5));
    }
    // Normalizzati a media 1: il totale settimanale resta quello misurato.
    const mediaFattori = grezzi.slice(1).reduce((a, b) => a + b, 0) / 7;
    weekdayFactors = mediaFattori > 0 ? grezzi.map((f, i) => (i === 0 ? null : Math.round((f / mediaFattori) * 100) / 100)) : weekdayFactors;
  }

  // --- media per fase (lezioni / sessione) -----------------------------
  const phaseHours = {};
  if (typeof phaseOf === 'function') {
    const acc = {};
    giorni.forEach((d, i) => {
      const f = phaseOf(d);
      if (!f) return;
      if (!acc[f]) acc[f] = { ore: 0, giorni: 0 };
      acc[f].ore += ore[i];
      acc[f].giorni += 1;
    });
    Object.entries(acc).forEach(([f, v]) => {
      if (v.giorni >= PHASE_MIN_DAYS) phaseHours[f] = round1(v.ore / v.giorni);
    });
  }

  return {
    hoursPerDay: clamp(round1(blended), CAPACITY_MIN_HOURS, CAPACITY_MAX_HOURS),
    measuredHoursPerDay: round1(measured),
    weight: Math.round(weight * 100) / 100,
    confident: observedDays >= CAPACITY_MIN_DAYS,
    observedDays,
    totalHours: round1(totalHours),
    weekdayFactors,
    weekdayConfident,
    phaseHours
  };
}

/**
 * V42 — Le ore di studio disponibili in UN giorno preciso (passato o
 * futuro): è ciò che il planner usa giorno per giorno.
 *
 *  - giorno di riposo dichiarato -> 0;
 *  - capacità manuale impostata -> quella, e basta;
 *  - altrimenti: media della fase di quel giorno se misurata, oppure la
 *    capacità miscelata; la parte NON ancora misurata (il default) cala
 *    nei giorni con lezioni in aula; infine il fattore del giorno della
 *    settimana.
 *
 * @param {string} dateKey
 * @param {object} calibration pacchetto di computeCalibration
 * @param {{phaseOf?:Function, lectureHoursOf?:Function}} [ctx]
 */
export function capacityForDate(dateKey, calibration, { phaseOf = null, lectureHoursOf = null } = {}) {
  const cal = calibration || NEUTRAL_CALIBRATION;
  const w = isoWeekdayOfDateKey(dateKey);
  const riposo = Array.isArray(cal.restDays) ? cal.restDays : [];
  if (riposo.includes(w)) return 0;
  const manual = Number(cal.manualHours);
  if (manual > 0) return manual;
  if (!Number.isFinite(Number(cal.capacityWeight))) {
    // Pacchetto parziale (test, chiamanti storici): conta solo la media.
    return Number(cal.hoursPerDay) > 0 ? Number(cal.hoursPerDay) : HOURS_PER_NODE_DAY;
  }

  const peso = clamp(Number(cal.capacityWeight), 0, 1);
  const lezioni = typeof lectureHoursOf === 'function' ? Math.max(0, Number(lectureHoursOf(dateKey)) || 0) : 0;
  const defaultGiorno = lezioni > 0 ? Math.max(LECTURE_DAY_MIN_HOURS, HOURS_PER_NODE_DAY - LECTURE_HOUR_COST * lezioni) : HOURS_PER_NODE_DAY;
  const fase = typeof phaseOf === 'function' ? phaseOf(dateKey) : null;
  const misurataFase = fase && cal.phaseHours && Number(cal.phaseHours[fase]) > 0 ? Number(cal.phaseHours[fase]) : null;
  const misurata = misurataFase ?? (Number(cal.measuredHoursPerDay) > 0 ? Number(cal.measuredHoursPerDay) : null);
  const profilo = cal.weekdayConfident && Array.isArray(cal.weekdayFactors);
  // La media misurata comprende i giorni di riposo a zero: senza profilo
  // settimanale va spalmata sui soli giorni di studio (col profilo lo fa
  // già il fattore del giorno).
  const studioSuSette = !profilo && riposo.length > 0 && riposo.length < 7 ? 7 / (7 - riposo.length) : 1;
  const base = misurata != null ? peso * misurata * studioSuSette + (1 - peso) * defaultGiorno : defaultGiorno;
  const f = profilo && Number.isFinite(cal.weekdayFactors[w]) ? cal.weekdayFactors[w] : 1;
  return clamp(Math.round(base * f * 100) / 100, 0, 12);
}

/**
 * V42 — Durata tipica di un ripasso: mediana delle sessioni di RIPASSO.
 */
export function computeReviewMinutes(starLog) {
  const valori = (Array.isArray(starLog) ? starLog : [])
    .filter((e) => e && e.type === 'FOCUS_SESSION' && e.workMode === 'RIPASSO' && Number(e.minutes) >= 3)
    .map((e) => Number(e.minutes) / Math.max(1, Number(e.argomentiRipassati) || 1));
  if (valori.length < REVIEW_MIN_SAMPLES) return { minutes: DEFAULT_REVIEW_MINUTES, confident: false, sampleSize: valori.length };
  return { minutes: clamp(Math.round(median(valori)), REVIEW_MINUTES_MIN, REVIEW_MINUTES_MAX), confident: true, sampleSize: valori.length };
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
/**
 * V39.0 — Un nodo è un campione di misura valido solo se è stato chiuso
 * DAVVERO studiandolo. Segnare un esame come superato chiude d'ufficio
 * tutti i nodi rimasti aperti (`chiusoDaVerbale`): quei nodi hanno
 * pochissimo tempo tracciato perché non sono mai stati studiati in app,
 * e usarli come campioni faceva crollare in silenzio fattore e ritmo —
 * verificato: cinque nodi chiusi dal verbale portavano il fattore a 0.5
 * e il ritmo a 60 pagine/ora, dimezzando ogni stima futura.
 */
function isCampioneValido(s) {
  return !!s && s.status === PERSISTED_STATUS.COMPLETED && s.chiusoDaVerbale !== true;
}

/** Minuti di STUDIO di un nodo (esclusa la sintesi). */
function minutiStudio(s) {
  return Number.isFinite(Number(s?.focusMinutesStudio)) && s.focusMinutesStudio !== null
    ? Number(s.focusMinutesStudio)
    : Number(s?.focusMinutes);
}

/** Campioni plausibili del rapporto ore reali / ore stimate. Fuori da
 * questo intervallo è quasi sempre un dato di tracciamento parziale
 * (nodo studiato in parte fuori dall'app) e non un tuo modo di stimare:
 * scartarlo PRIMA della mediana, non tagliarlo dopo. */
const BIAS_SAMPLE_MIN = 0.25;
const BIAS_SAMPLE_MAX = 4;

export function computeEstimateBias(materie) {
  const ratios = [];
  (Array.isArray(materie) ? materie : []).forEach((m) => {
    (Array.isArray(m?.sfide) ? m.sfide : []).forEach((s) => {
      if (!isCampioneValido(s)) return;
      const estimated = Number(s.oreStimate);
      // V39.0 — solo le ore di STUDIO: `oreStimate` sono ore di studio, e
      // le ore di sintesi vengono già sommate a parte da nodeWorkBreakdown.
      // Usare il totale le contava due volte (verificato: 2h stimate, 2h
      // di studio e 4h di sintesi davano fattore 3 invece di 1).
      const actual = minutiStudio(s) / 60;
      if (!Number.isFinite(estimated) || estimated <= 0) return;
      if (!Number.isFinite(actual) || actual <= 0) return;
      const r = actual / estimated;
      if (r < BIAS_SAMPLE_MIN || r > BIAS_SAMPLE_MAX) return;
      ratios.push(r);
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

/* ------------------------------------------------------------------ *
 * V37.0 — RITMO DI STUDIO IN PAGINE/ORA
 *
 * Le "Ore previste" di un nodo sono una stima a occhio, e il fattore di
 * bias qui sopra la corregge solo in media. Le PAGINE invece sono un
 * dato oggettivo che il Cadetto conosce con precisione prima ancora di
 * iniziare ("i Limiti sono 20 pagine di appunti, le Derivate 10").
 *
 * Misurando quante pagine riesci davvero a coprire in un'ora di Focus,
 * un nodo con le pagine dichiarate smette di aver bisogno di una stima:
 * le sue ore si CALCOLANO. È la differenza fra un piano costruito su
 * un'intuizione e uno costruito su un numero che hai già.
 *
 * Si usa la mediana per lo stesso motivo del bias: una sessione-maratona
 * o un nodo particolarmente ostico non devono spostare in modo
 * permanente la percezione di tutto il resto.
 * ------------------------------------------------------------------ */

/** Nodi con pagine E tempo tracciato necessari per fidarsi del ritmo. */
export const PAGES_MIN_SAMPLES = 4;
/** Limiti di sicurezza: nessun ritmo sotto 1 o sopra 60 pagine/ora.
 * Sotto 1 significa quasi sempre un dato sbagliato, sopra 60 non è
 * studio ma scorrimento. */
export const PAGES_PER_HOUR_MIN = 1;
export const PAGES_PER_HOUR_MAX = 60;
/** Fallback prudente per materiale tecnico universitario, usato finché
 * non ci sono abbastanza campioni personali. V39.0: vive in
 * planningConstants.js (serve anche a sintesiEngine.js); ri-esportato da
 * qui per chi lo importava da questo percorso. */
export { DEFAULT_PAGES_PER_HOUR };

/**
 * Ritmo personale in pagine/ora, misurato sui nodi già completati che
 * portano SIA le pagine dichiarate SIA il tempo di Focus tracciato.
 *
 * @param {Array} materie `state.materie`
 * @returns {{pagesPerHour:number, confident:boolean, sampleSize:number}}
 */
export function computePagesPerHour(materie) {
  const rates = [];
  (Array.isArray(materie) ? materie : []).forEach((m) => {
    (Array.isArray(m?.sfide) ? m.sfide : []).forEach((s) => {
      if (!isCampioneValido(s)) return;
      // V38.0 — le pagine che contano per il ritmo di STUDIO sono quelle
      // dei TUOI appunti, non quelle delle fonti: è su quelle che
      // studi. `pagine` resta letto come sinonimo per i nodi salvati
      // prima della separazione, dove significava già la stessa cosa.
      const pagine = Number(s.pagineAppunti) > 0 ? Number(s.pagineAppunti) : Number(s.pagine);
      // E le ore che contano sono quelle passate a studiare, non quelle
      // passate a snellire. Un nodo che non porta la separazione è un
      // nodo pre-V38: tutte le sue ore erano ore di studio.
      const minuti = Number.isFinite(Number(s.focusMinutesStudio))
        ? Number(s.focusMinutesStudio)
        : Number(s.focusMinutes);
      const ore = minuti / 60;
      if (!Number.isFinite(pagine) || pagine <= 0) return;
      if (!Number.isFinite(ore) || ore <= 0) return;
      const r = pagine / ore;
      // Fuori dai limiti fisici è un dato sbagliato, non un ritmo: va
      // scartato prima della mediana invece di pesare come un estremo.
      if (r < PAGES_PER_HOUR_MIN || r > PAGES_PER_HOUR_MAX) return;
      rates.push(r);
    });
  });

  if (rates.length < PAGES_MIN_SAMPLES) {
    return { pagesPerHour: DEFAULT_PAGES_PER_HOUR, confident: false, sampleSize: rates.length };
  }
  const raw = median(rates);
  return {
    pagesPerHour: clamp(Math.round(raw * 10) / 10, PAGES_PER_HOUR_MIN, PAGES_PER_HOUR_MAX),
    confident: true,
    sampleSize: rates.length
  };
}

/**
 * Ore previste di un nodo. Due strade, in ordine di affidabilità:
 *
 *  1. il nodo dichiara le PAGINE -> le ore si ricavano dal ritmo
 *     misurato (pagine / pagine-all'ora). È il caso migliore: nessuna
 *     stima soggettiva entra nel calcolo;
 *  2. altrimenti -> le ore dichiarate, corrette dal bias storico.
 *
 * Minimo 0.5h in entrambi i rami (stessa guardia anti dato corrotto già
 * usata in materiaMeta.js).
 */
export function calibratedNodeHours(sfida, biasFactorOrCalibration = 1) {
  // Retro-compatibile: i chiamanti storici passano il solo `biasFactor`
  // come numero, i nuovi l'intero pacchetto di calibrazione. In entrambi
  // i casi il calcolo vero vive in UN solo posto — `nodeBudgetHours` in
  // materiaMeta.js — così non possono esistere due definizioni di
  // "quanto costa questo nodo" che divergono nel tempo.
  const packet =
    biasFactorOrCalibration && typeof biasFactorOrCalibration === 'object'
      ? biasFactorOrCalibration
      : { biasFactor: Number(biasFactorOrCalibration), pagesPerHour: null };
  return nodeBudgetHours(sfida, packet);
}

/** Il pacchetto completo, calcolato una volta sola a livello di Provider
 * e passato a valle: nessun consumatore ricalcola per conto proprio. */
export function computeCalibration(state, { todayKey = todayDateOnlyKey() } = {}) {
  const campus = state?.campus;
  const phaseOf = campus && Array.isArray(campus.semestri) && campus.semestri.length > 0 ? (k) => detectPhase(campus, k).fase : null;
  const capacity = computeDailyCapacity(state?.starLog, { todayKey, phaseOf });
  const bias = computeEstimateBias(state?.materie);
  const pages = computePagesPerHour(state?.materie);
  // V38.0 — "La Forgia degli Appunti": due ritmi, non uno. Snellire 20
  // pagine di libro e studiare 20 pagine dei propri appunti sono due
  // lavori con velocità diverse. V42 — e la sintesi, per tipo di fonte.
  const sintesi = computeSintesiPagesPerHour(state?.starLog);
  const resa = computeResaSintesi(state?.materie);
  const review = computeReviewMinutes(state?.starLog);
  // V42 — impostazioni che il piano deve rispettare: capacità decisa a
  // mano (vince sulla misura) e giorni di riposo fissi.
  const manual = Number(state?.settings?.capacitaManuale);
  const manualHours = Number.isFinite(manual) && manual > 0 ? clamp(manual, 0.5, 12) : null;
  const restDays = (Array.isArray(state?.settings?.giorniRiposo) ? state.settings.giorniRiposo : [])
    .map(Number)
    .filter((n, i, arr) => Number.isInteger(n) && n >= 1 && n <= 7 && arr.indexOf(n) === i);
  const perTipoRitmo = {};
  const perTipoResa = {};
  Object.keys(sintesi.perTipo || {}).forEach((t) => {
    perTipoRitmo[t] = sintesi.perTipo[t].confident ? sintesi.perTipo[t].pagesPerHour : null;
  });
  Object.keys(resa.perTipo || {}).forEach((t) => {
    perTipoResa[t] = resa.perTipo[t].confident ? resa.perTipo[t].resa : null;
  });
  const capacitySource = manualHours ? 'MANUALE' : capacity.weight >= 1 ? 'MISURATA' : capacity.weight > 0 ? 'MISTA' : 'DEFAULT';
  return {
    hoursPerDay: manualHours || capacity.hoursPerDay,
    capacityConfident: !!manualHours || capacity.confident,
    capacitySource,
    capacityWeight: manualHours ? 1 : capacity.weight,
    measuredHoursPerDay: capacity.measuredHoursPerDay,
    observedDays: capacity.observedDays,
    weekdayFactors: capacity.weekdayFactors,
    weekdayConfident: capacity.weekdayConfident,
    phaseHours: capacity.phaseHours,
    manualHours,
    restDays,
    biasFactor: bias.factor,
    biasConfident: bias.confident,
    biasSampleSize: bias.sampleSize,
    // V37.0 — ritmo di lettura misurato: quando è affidabile, i nodi che
    // dichiarano le pagine smettono di dipendere da una stima a occhio.
    pagesPerHour: pages.confident ? pages.pagesPerHour : null,
    pagesPerHourRaw: pages.pagesPerHour,
    pagesConfident: pages.confident,
    pagesSampleSize: pages.sampleSize,
    // V38.0 — ritmo di SINTESI e resa: hanno un fallback anche da non
    // misurati, perché senza di loro il lavoro di snellimento sparirebbe
    // dal piano. `*Confident` dice alla UI quale dei due casi è.
    sintesiPagesPerHour: sintesi.confident ? sintesi.pagesPerHour : null,
    sintesiPagesPerHourRaw: sintesi.pagesPerHour,
    sintesiConfident: sintesi.confident,
    sintesiSampleSize: sintesi.sampleSize,
    sintesiRitmoPerTipo: perTipoRitmo,
    resaSintesi: resa.confident ? resa.resa : null,
    resaSintesiRaw: resa.resa,
    resaConfident: resa.confident,
    resaSampleSize: resa.sampleSize,
    resaPerTipo: perTipoResa,
    // V42 — durata di un ripasso, per mettere i ripassi nel piano.
    reviewMinutes: review.minutes,
    reviewMinutesConfident: review.confident
  };
}

/** Valori neutri, identici al comportamento pre-V36.0 — usati come
 * default da ogni funzione che accetta una calibrazione opzionale, così
 * ogni chiamante non aggiornato continua a funzionare esattamente come
 * prima invece di ricevere `undefined`. */
export const NEUTRAL_CALIBRATION = {
  hoursPerDay: HOURS_PER_NODE_DAY,
  capacityConfident: false,
  capacitySource: 'DEFAULT',
  capacityWeight: 0,
  measuredHoursPerDay: null,
  observedDays: 0,
  weekdayFactors: [null, 1, 1, 1, 1, 1, 1, 1],
  weekdayConfident: false,
  phaseHours: {},
  manualHours: null,
  restDays: [],
  biasFactor: 1,
  biasConfident: false,
  biasSampleSize: 0,
  // `null` e non il default: senza abbastanza campioni le pagine NON
  // devono guidare la stima, altrimenti si sostituirebbe un numero
  // inventato (le ore) con un altro numero inventato (6 pagine/ora).
  pagesPerHour: null,
  pagesPerHourRaw: DEFAULT_PAGES_PER_HOUR,
  pagesConfident: false,
  pagesSampleSize: 0,
  sintesiPagesPerHour: null,
  sintesiPagesPerHourRaw: DEFAULT_SINTESI_PAGES_PER_HOUR,
  sintesiConfident: false,
  sintesiSampleSize: 0,
  sintesiRitmoPerTipo: {},
  resaSintesi: null,
  resaSintesiRaw: DEFAULT_RESA_SINTESI,
  resaConfident: false,
  resaSampleSize: 0,
  resaPerTipo: {},
  reviewMinutes: DEFAULT_REVIEW_MINUTES,
  reviewMinutesConfident: false
};
