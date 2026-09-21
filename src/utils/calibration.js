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
import { todayDateOnlyKey, dateOnlyToUtcMs } from './dateUtils.js';
import { DEFAULT_PAGES_PER_HOUR } from './planningConstants.js';
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

  // V39.0 — finché oggi non hai ancora studiato, la giornata in corso
  // NON entra nel denominatore. Prima veniva contata come un giorno
  // intero a zero ore: ogni mattina la capacità risultava più bassa
  // (-12% con 8 giorni osservati) proprio mentre l'app ti diceva quanto
  // studiare oggi. I giorni di riposo passati restano dentro, come
  // devono: sono giorni conclusi, e sono reali.
  const todayKey = todayDateOnlyKey();
  const hasToday = inWindow.some((e) => e.dateKey === todayKey);
  const endMs = hasToday ? todayMs : todayMs - 86400000;
  const firstMs = Math.min(...inWindow.map((e) => dateOnlyToUtcMs(e.dateKey)));
  // +1 perché la finestra è inclusiva su entrambi gli estremi.
  const observedDays = Math.max(1, Math.round((endMs - firstMs) / 86400000) + 1);
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
export function computeCalibration(state) {
  const capacity = computeDailyCapacity(state?.starLog);
  const bias = computeEstimateBias(state?.materie);
  const pages = computePagesPerHour(state?.materie);
  // V38.0 — "La Forgia degli Appunti": due ritmi, non uno. Snellire 20
  // pagine di libro e studiare 20 pagine dei propri appunti sono due
  // lavori con velocità diverse, e misurarli insieme produceva un
  // numero medio che non descriveva nessuno dei due.
  const sintesi = computeSintesiPagesPerHour(state?.starLog);
  const resa = computeResaSintesi(state?.materie);
  return {
    hoursPerDay: capacity.hoursPerDay,
    capacityConfident: capacity.confident,
    observedDays: capacity.observedDays,
    biasFactor: bias.factor,
    biasConfident: bias.confident,
    biasSampleSize: bias.sampleSize,
    // V37.0 — ritmo di lettura misurato: quando è affidabile, i nodi che
    // dichiarano le pagine smettono di dipendere da una stima a occhio.
    pagesPerHour: pages.confident ? pages.pagesPerHour : null,
    pagesPerHourRaw: pages.pagesPerHour,
    pagesConfident: pages.confident,
    pagesSampleSize: pages.sampleSize,
    // V38.0 — ritmo di SINTESI (pagine di fonte snellite all'ora) e resa
    // (quante pagine tue escono da una pagina di fonte). A differenza
    // del ritmo di studio questi due hanno un fallback anche da non
    // misurati, perché senza di loro il lavoro di snellimento
    // sparirebbe del tutto dal piano invece di comparirci come stima —
    // e il punto di tutta la funzione è che quel lavoro esista nei
    // conti. `*Confident` dice alla UI quale dei due casi è.
    sintesiPagesPerHour: sintesi.confident ? sintesi.pagesPerHour : null,
    sintesiPagesPerHourRaw: sintesi.pagesPerHour,
    sintesiConfident: sintesi.confident,
    sintesiSampleSize: sintesi.sampleSize,
    resaSintesi: resa.confident ? resa.resa : null,
    resaSintesiRaw: resa.resa,
    resaConfident: resa.confident,
    resaSampleSize: resa.sampleSize
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
  biasSampleSize: 0,
  // `null` e non il default: senza abbastanza campioni le pagine NON
  // devono guidare la stima, altrimenti si sostituirebbe un numero
  // inventato (le ore) con un altro numero inventato (6 pagine/ora).
  pagesPerHour: null,
  pagesPerHourRaw: DEFAULT_PAGES_PER_HOUR,
  pagesConfident: false,
  pagesSampleSize: 0,
  // V38.0 — stessa logica in due varianti: il ritmo di studio resta
  // `null` (esiste un'alternativa, le ore dichiarate), il ritmo di
  // sintesi e la resa hanno un default perché un'alternativa non c'è.
  sintesiPagesPerHour: null,
  sintesiPagesPerHourRaw: DEFAULT_SINTESI_PAGES_PER_HOUR,
  sintesiConfident: false,
  sintesiSampleSize: 0,
  resaSintesi: null,
  resaSintesiRaw: DEFAULT_RESA_SINTESI,
  resaConfident: false,
  resaSampleSize: 0
};
