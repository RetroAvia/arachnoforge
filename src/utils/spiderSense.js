import { addDaysToDateOnly, todayDateOnlyKey, daysUntilDateOnly, daysBetweenDateKeys, localDateKeyOf } from './dateUtils.js';

/**
 * Spider-Sense Engine — motore di ripetizione dilazionata.
 *
 * V42 — "Memoria vera". Fino alla V41 era un SM-2 semplificato: un
 * fattore di facilità che si muoveva col giudizio e un intervallo che si
 * moltiplicava. Tre difetti misurati sui dati reali:
 *
 *  1. Il TEMPO PASSATO non contava. Tre "Facile" di fila nella stessa
 *     sessione portavano un argomento da 22 a 180 giorni; un ripasso fatto
 *     con due mesi di ritardo valeva quanto uno puntuale.
 *  2. "Difficile" era trattato come "dimenticato" (ritorno a 1 giorno), e
 *     un fattore sotto 1.5 intrappolava il nodo in un ripasso al giorno.
 *  3. Il TETTO D'ESAME metteva ogni ripasso che avrebbe superato l'esame
 *     sul giorno prima: 30 argomenti, 30 ripassi tutti alla vigilia.
 *
 * Ora il modello è FSRS-5 (Free Spaced Repetition Scheduler, lo stesso di
 * Anki), con i parametri di default pubblicati. Ogni nodo porta tre numeri:
 *
 *   - STABILITÀ S (giorni): dopo S giorni la probabilità di ricordarlo è
 *     del 90%. È anche l'intervallo "naturale" del prossimo ripasso;
 *   - DIFFICOLTÀ D (1-10): quanto quel contenuto ti resiste;
 *   - l'ultimo ripasso, da cui si calcola il RICORDO di oggi:
 *     R(t) = (1 + 19/81 · t/S)^-0.5.
 *
 * Un ripasso puntuale (R ≈ 90%) fa crescere S di 3-4 volte; uno anticipato
 * (R ≈ 100%) quasi niente — ripetere nella stessa sessione non "gonfia"
 * più la memoria; uno in ritardo, se ricordi ancora, la fa crescere di
 * più. Quattro giudizi: Non ricordavo / Difficile / Bene / Facile.
 *
 * VINCOLO D'ESAME, rifatto: l'intervallo naturale non viene toccato (resta
 * sul nodo), si sposta solo la DATA. Quando il prossimo ripasso cadrebbe
 * oltre l'esame, finisce nella prossima delle tre FINESTRE DI RIPASSO
 * FINALE (da 21 a 15 giorni prima, da 10 a 6, da 4 a 1), nel giorno di
 * quella finestra con meno ripassi già in programma per la stessa materia.
 * Ogni argomento passa così tre volte nelle ultime tre settimane, e il
 * carico si spalma invece di cadere tutto sulla vigilia.
 */
export const REVIEW_RATING = {
  AGAIN: 'AGAIN',
  HARD: 'HARD',
  // `MEDIUM` resta la chiave storica di "Bene" (Good): è il valore già
  // salvato in `lastReviewRating` su tutti i nodi ripassati prima della V42.
  MEDIUM: 'MEDIUM',
  EASY: 'EASY'
};

const GRADE = { AGAIN: 1, HARD: 2, MEDIUM: 3, EASY: 4 };

export const REVIEW_RATING_META = {
  AGAIN: { label: 'Non ricordavo', short: 'Buio', color: 'text-primary', border: 'border-primary/50', hint: 'Non me lo ricordavo: va ristudiato.' },
  HARD: { label: 'Difficile', short: 'Difficile', color: 'text-af-attack', border: 'border-af-attack/50', hint: 'Ricordato, ma con fatica e buchi.' },
  MEDIUM: { label: 'Bene', short: 'Bene', color: 'text-af-decay', border: 'border-af-decay/50', hint: 'Ricordato con un po’ di sforzo.' },
  EASY: { label: 'Facile', short: 'Facile', color: 'text-emerald-400', border: 'border-emerald-400/50', hint: 'Ricordato subito e senza errori.' }
};

/** Parametri di default di FSRS-5 (open-spaced-repetition). */
export const FSRS_W = [
  0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192, 1.01925, 1.9395, 0.11, 0.29605, 2.2698,
  0.2315, 2.9898, 0.51655, 0.6621
];
const W = FSRS_W;
const FACTOR = 19 / 81;
const DECAY = -0.5;

/** Probabilità di ricordo a cui si fissa il prossimo ripasso. */
export const DESIRED_RETENTION = 0.9;
/** Tetto di sicurezza: oltre i 6 mesi un ripasso non è più tale. */
export const MAX_INTERVAL_DAYS = 180;
const MIN_STABILITY = 0.1;
const MAX_STABILITY = 3650;

/**
 * Finestre di ripasso finale, in giorni PRIMA dell'esame (estremi inclusi).
 * Tre passaggi nelle ultime tre settimane: consolidamento, verifica,
 * rifinitura.
 */
export const CHECKPOINT_WINDOWS = [
  { from: 21, to: 15 },
  { from: 10, to: 6 },
  { from: 4, to: 1 }
];

/** Primo ripasso dopo il primo completamento, per difficoltà dichiarata del nodo. */
const INITIAL_STABILITY = { EASY: 3.173, MEDIUM: 2.4, HARD: 1.18385 };

/** Compatibilità con i chiamanti pre-V42 (creazione nodi, import). */
export const DEFAULT_EASE = 2.3;
export const INITIAL_REVIEW_INTERVAL_DAYS = 2;

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}
function round2(n) {
  return Math.round(n * 100) / 100;
}
function clampD(d) {
  return clamp(d, 1, 10);
}
function clampS(s) {
  return clamp(s, MIN_STABILITY, MAX_STABILITY);
}

// V43 — giorno LOCALE dell'istante (vedi dateUtils.localDateKeyOf).
function dateKeyOf(value) {
  return localDateKeyOf(value);
}

/* ------------------------------------------------------------------ *
 * IL MODELLO
 * ------------------------------------------------------------------ */

/** Probabilità di ricordare dopo `elapsedDays` giorni con stabilità `stability`. */
export function retrievability(elapsedDays, stability) {
  if (!(Number(stability) > 0)) return 0;
  const t = Math.max(0, Number(elapsedDays) || 0);
  return Math.pow(1 + (FACTOR * t) / stability, DECAY);
}

/** Intervallo (giorni) dopo il quale il ricordo scende a `retention`. */
export function intervalForRetention(stability, retention = DESIRED_RETENTION) {
  return (stability / FACTOR) * (Math.pow(retention, 1 / DECAY) - 1);
}

function initDifficulty(grade) {
  return clampD(W[4] - Math.exp(W[5] * (grade - 1)) + 1);
}

function nextDifficulty(d, grade) {
  const delta = -W[6] * (grade - 3);
  const damped = d + (delta * (10 - d)) / 9;
  return clampD(W[7] * initDifficulty(4) + (1 - W[7]) * damped);
}

function recallStability(d, s, r, grade) {
  const hardPenalty = grade === GRADE.HARD ? W[15] : 1;
  const easyBonus = grade === GRADE.EASY ? W[16] : 1;
  const growth = Math.exp(W[8]) * (11 - d) * Math.pow(s, -W[9]) * (Math.exp(W[10] * (1 - r)) - 1) * hardPenalty * easyBonus;
  return clampS(s * (1 + growth));
}

function forgetStability(d, s, r) {
  const sf = W[11] * Math.pow(d, -W[12]) * (Math.pow(s + 1, W[13]) - 1) * Math.exp(W[14] * (1 - r));
  return clampS(Math.min(sf, s));
}

/**
 * Ripasso nella stessa giornata dell'ultimo. FSRS-5 lo tratta a parte
 * (S · e^(w17·(G-3+w18))). V42 — un successo ripetuto nello stesso giorno
 * NON allunga la memoria (niente più "tre Facile = 180 giorni"); un
 * insuccesso la accorcia come da modello.
 */
function sameDayStability(s, grade) {
  if (grade >= GRADE.MEDIUM) return s;
  return clampS(s * Math.min(1, Math.exp(W[17] * (grade - 3 + W[18]))));
}

/**
 * Lo stato di memoria di un nodo, anche se salvato prima della V42: dalla
 * vecchia curva SM-2 si ricava una stabilità equivalente (l'intervallo che
 * aveva) e una difficoltà coerente col suo fattore di facilità.
 * @returns {{stability:number, difficulty:number, lastKey:string|null, known:boolean}}
 */
export function memoryState(sfida) {
  const s = Number(sfida?.srsStability);
  const d = Number(sfida?.srsDifficulty);
  const lastKey = dateKeyOf(sfida?.lastReviewedAt) || dateKeyOf(sfida?.completionTimestamp);
  if (Number.isFinite(s) && s > 0 && Number.isFinite(d) && d > 0) {
    return { stability: clampS(s), difficulty: clampD(d), lastKey, known: true };
  }
  const legacyInterval = Number(sfida?.srsIntervalDays);
  const ease = Number(sfida?.srsEase);
  const diffKey = INITIAL_STABILITY[sfida?.difficulty] ? sfida.difficulty : 'MEDIUM';
  const stability = Number.isFinite(legacyInterval) && legacyInterval > 0 ? clampS(legacyInterval) : INITIAL_STABILITY[diffKey];
  const difficulty = Number.isFinite(ease) && ease > 0 ? clampD(initDifficulty(3) + (2.3 - ease) * 2.5) : initialDifficultyFor(diffKey);
  return { stability, difficulty, lastKey, known: false };
}

function initialDifficultyFor(difficultyKey) {
  if (difficultyKey === 'HARD') return initDifficulty(GRADE.HARD);
  if (difficultyKey === 'EASY') return clampD(initDifficulty(GRADE.MEDIUM) - 0.8);
  return initDifficulty(GRADE.MEDIUM);
}

/** Ricordo stimato OGGI di un nodo completato (0-1), `null` se non ha memoria. */
export function nodeRetrievability(sfida, todayKey = todayDateOnlyKey()) {
  if (!sfida || sfida.status !== 'COMPLETED') return null;
  const m = memoryState(sfida);
  if (!m.lastKey) return null;
  const elapsed = Math.max(0, daysBetweenDateKeys(m.lastKey, todayKey) ?? 0);
  return retrievability(elapsed, m.stability);
}

/** Ricordo previsto in una data futura SENZA altri ripassi (0-1). */
export function retrievabilityAt(sfida, dateKey) {
  if (!sfida || sfida.status !== 'COMPLETED') return null;
  const m = memoryState(sfida);
  if (!m.lastKey || !dateKey) return null;
  const elapsed = Math.max(0, daysBetweenDateKeys(m.lastKey, dateKey) ?? 0);
  return retrievability(elapsed, m.stability);
}

/* ------------------------------------------------------------------ *
 * LA DATA DEL PROSSIMO RIPASSO
 * ------------------------------------------------------------------ */

function naturalIntervalDays(stability) {
  return clamp(Math.round(intervalForRetention(stability)), 1, MAX_INTERVAL_DAYS);
}

/** Le finestre di ripasso finale come date concrete, dalla più lontana. */
export function checkpointDates(examDate) {
  if (!dateKeyOf(examDate)) return [];
  return CHECKPOINT_WINDOWS.map((w, index) => ({
    index,
    start: addDaysToDateOnly(examDate, -w.from),
    end: addDaysToDateOnly(examDate, -w.to)
  }));
}

/**
 * Il giorno meno carico di [start, end] secondo `load` (Map dateKey ->
 * ripassi già in programma). A parità vince il PIÙ TARDI: più spazio fra
 * un ripasso e l'altro, e i ripassi di una finestra si distribuiscono
 * dalla fine all'indietro invece di ammucchiarsi il primo giorno.
 */
function leastLoadedDay(start, end, load) {
  let best = end;
  let bestLoad = Infinity;
  for (let d = end; d >= start; d = addDaysToDateOnly(d, -1)) {
    const l = load && typeof load.get === 'function' ? load.get(d) || 0 : 0;
    if (l < bestLoad) {
      best = d;
      bestLoad = l;
    }
  }
  return best;
}

/**
 * Data del prossimo ripasso a partire da `todayKey`, dato l'intervallo
 * naturale. Rispetta le finestre di ripasso finale dell'esame.
 *
 * @param {object} p
 * @param {number} p.intervalDays intervallo naturale (giorni)
 * @param {string} p.todayKey giorno da cui contare
 * @param {string|null} p.examDate data della prossima prova
 * @param {Map|null} p.load ripassi già in programma per data (stessa materia)
 * @param {number} [p.stability] per decidere se serve un ultimo ripasso a ridosso
 * @param {string|null} [p.fromKey] giorno di partenza dell'intervallo (default oggi)
 */
export function placeReviewDate({ intervalDays, todayKey, examDate = null, load = null, stability = null, fromKey = null }) {
  const base = dateKeyOf(fromKey) || todayKey;
  let natural = addDaysToDateOnly(base, Math.max(1, Math.round(intervalDays)));
  if (natural <= todayKey) natural = addDaysToDateOnly(todayKey, 1);
  const exam = dateKeyOf(examDate);
  if (!exam || exam <= todayKey) return natural;
  const eve = addDaysToDateOnly(exam, -1);

  // Nelle ultime tre settimane un ripasso non SALTA mai una finestra
  // finale: se la data naturale cade oltre la fine della prossima finestra
  // (o dopo l'esame), il ripasso va in quella finestra, nel giorno meno
  // carico. Così ogni argomento passa da consolidamento, verifica e
  // rifinitura, e un voto più alto non dà mai una data più vicina di uno
  // più basso (prima "Bene" poteva tornare domani e "Difficile" fra 10 giorni).
  const windows = checkpointDates(exam);
  const next = windows.find((w) => w.start > todayKey);
  if (next && natural > next.end) return leastLoadedDay(next.start, next.end, load);
  if (natural <= eve) return natural;
  // Nessuna finestra davanti (siamo negli ultimi 4 giorni): un ultimo
  // passaggio la vigilia solo se all'esame il ricordo scenderebbe sotto
  // l'85%; altrimenti il ripasso resta dopo l'esame (orale, o mai).
  if (eve > todayKey && Number(stability) > 0) {
    const rAtExam = retrievability(daysBetweenDateKeys(todayKey, exam), Number(stability));
    if (rAtExam < 0.85) return eve;
  }
  return natural;
}

/* ------------------------------------------------------------------ *
 * API USATA DAL REDUCER
 * ------------------------------------------------------------------ */

/**
 * Prima schedulazione, al primo completamento del nodo. Se il nodo aveva
 * già una memoria (era stato completato, riaperto e ora ri-completato)
 * la memoria si conserva: annullare un click non cancella quanto sai.
 */
export function computeInitialReview(examDate = null, { sfida = null, todayKey = todayDateOnlyKey(), load = null, nowIso = null } = {}) {
  const diffKey = INITIAL_STABILITY[sfida?.difficulty] ? sfida.difficulty : 'MEDIUM';
  const prev = sfida ? memoryState(sfida) : null;
  const keep = !!(prev && prev.known);
  const stability = keep ? prev.stability : INITIAL_STABILITY[diffKey];
  const difficulty = keep ? prev.difficulty : initialDifficultyFor(diffKey);
  const intervalDays = naturalIntervalDays(stability);
  const nextReviewDate = placeReviewDate({ intervalDays, todayKey, examDate, load, stability });
  return {
    nextReviewDate,
    srsStability: round2(stability),
    srsDifficulty: round2(difficulty),
    srsIntervalDays: intervalDays,
    lastReviewedAt: nowIso || new Date().toISOString(),
    // Campo storico SM-2: non più letto dai motori, lasciato coerente.
    srsEase: 2.3
  };
}

/**
 * Esito di un ripasso: nuovo stato di memoria + data del prossimo.
 * @param {object} sfida nodo ripassato
 * @param {'AGAIN'|'HARD'|'MEDIUM'|'EASY'} rating
 * @param {string|null} examDate data della prossima prova della materia
 * @param {{todayKey?:string, load?:Map, nowIso?:string}} [opts]
 */
export function scheduleNextReview(sfida, rating, examDate = null, { todayKey = todayDateOnlyKey(), load = null, nowIso = null } = {}) {
  const safeRating = REVIEW_RATING[rating] ? rating : REVIEW_RATING.MEDIUM;
  const grade = GRADE[safeRating];
  const m = memoryState(sfida);
  const elapsed = m.lastKey ? Math.max(0, daysBetweenDateKeys(m.lastKey, todayKey) ?? 0) : naturalIntervalDays(m.stability);
  const r = retrievability(elapsed, m.stability);

  let stability;
  if (elapsed < 1) stability = sameDayStability(m.stability, grade);
  else if (grade === GRADE.AGAIN) stability = forgetStability(m.difficulty, m.stability, r);
  else stability = recallStability(m.difficulty, m.stability, r, grade);
  const difficulty = nextDifficulty(m.difficulty, grade);

  // "Non ricordavo": domani, qualunque cosa dica il modello — va ristudiato.
  const intervalDays = grade === GRADE.AGAIN ? 1 : naturalIntervalDays(stability);
  const nextReviewDate =
    grade === GRADE.AGAIN ? addDaysToDateOnly(todayKey, 1) : placeReviewDate({ intervalDays, todayKey, examDate, load, stability });

  return {
    nextReviewDate,
    srsStability: round2(stability),
    srsDifficulty: round2(difficulty),
    srsIntervalDays: intervalDays,
    srsLapses: (Number(sfida?.srsLapses) || 0) + (grade === GRADE.AGAIN ? 1 : 0),
    lastReviewedAt: nowIso || new Date().toISOString(),
    retrievabilityAtReview: round2(r),
    elapsedDays: elapsed,
    srsEase: Number.isFinite(Number(sfida?.srsEase)) ? Number(sfida.srsEase) : 2.3
  };
}

/**
 * Anteprima "fra quanti giorni tornerà" per ciascun giudizio: le
 * etichette dei quattro pulsanti mostrano l'intervallo REALE di quel
 * nodo (finestre d'esame comprese), non valori fissi.
 */
export function previewReviewIntervals(sfida, examDate = null, { todayKey = todayDateOnlyKey(), load = null } = {}) {
  return Object.keys(REVIEW_RATING).reduce((acc, rating) => {
    const next = scheduleNextReview(sfida, rating, examDate, { todayKey, load }).nextReviewDate;
    acc[rating] = Math.max(1, daysBetweenDateKeys(todayKey, next) ?? 1);
    return acc;
  }, {});
}

/**
 * Ripianifica un nodo già completato senza un ripasso: serve quando cambia
 * la data d'esame. L'intervallo naturale parte dall'ultimo ripasso; un
 * ripasso già scaduto resta scaduto (non si sposta nel futuro).
 */
export function rescheduleForExam(sfida, examDate, { todayKey = todayDateOnlyKey(), load = null } = {}) {
  if (!sfida || sfida.status !== 'COMPLETED' || !sfida.nextReviewDate) return null;
  if (sfida.nextReviewDate <= todayKey) return null;
  const m = memoryState(sfida);
  const intervalDays = naturalIntervalDays(m.stability);
  const next = placeReviewDate({ intervalDays, todayKey, examDate, load, stability: m.stability, fromKey: m.lastKey || todayKey });
  return next === sfida.nextReviewDate ? null : next;
}

/** Ripassi già in programma per data fra i nodi di una materia (escluso `excludeId`). */
export function reviewLoadByDate(sfide, excludeId = null) {
  const load = new Map();
  (Array.isArray(sfide) ? sfide : []).forEach((s) => {
    if (!s || s.id === excludeId || s.status !== 'COMPLETED' || !s.nextReviewDate) return;
    load.set(s.nextReviewDate, (load.get(s.nextReviewDate) || 0) + 1);
  });
  return load;
}

/**
 * Ripianifica tutti i nodi di una materia dopo un cambio di data d'esame,
 * spalmando il carico nelle finestre finali. Ritorna un NUOVO array.
 */
export function rescheduleMateriaReviews(sfide, examDate, todayKey = todayDateOnlyKey()) {
  const list = Array.isArray(sfide) ? sfide : [];
  const load = new Map();
  const out = list.map((s) => s);
  // Prima si contano i ripassi che non si muovono (scaduti o senza cambio).
  const moved = new Set();
  list.forEach((s, i) => {
    const next = rescheduleForExam(s, examDate, { todayKey, load: null });
    if (next) moved.add(i);
    else if (s && s.status === 'COMPLETED' && s.nextReviewDate) load.set(s.nextReviewDate, (load.get(s.nextReviewDate) || 0) + 1);
  });
  list.forEach((s, i) => {
    if (!moved.has(i)) return;
    const next = rescheduleForExam(s, examDate, { todayKey, load }) || s.nextReviewDate;
    load.set(next, (load.get(next) || 0) + 1);
    out[i] = { ...s, nextReviewDate: next };
  });
  return out;
}

/** Confronto lessicografico sicuro: "YYYY-MM-DD" ordina cronologicamente come stringa. */
export function isReviewDue(nextReviewDate) {
  if (!nextReviewDate) return false;
  return nextReviewDate <= todayDateOnlyKey();
}

/**
 * Differenza in giorni interi fra oggi e la prossima data di ripasso.
 * Positivo = ripasso futuro ("tra N giorni"), 0 = oggi, negativo = scaduto
 * da |N| giorni.
 */
export function daysUntilReview(nextReviewDate) {
  if (!nextReviewDate) return null;
  return daysUntilDateOnly(nextReviewDate);
}

/**
 * V42 — Il ripasso è stato fatto OGGI? (un solo premio al giorno per nodo)
 */
export function reviewedToday(sfida, todayKey = todayDateOnlyKey()) {
  return dateKeyOf(sfida?.lastReviewedAt) === todayKey && Number(sfida?.reviewCount) > 0;
}

/**
 * Stabilità e difficoltà iniziali per la migrazione di un nodo pre-V42,
 * con `lastReviewedAt` ricostruito dalla data di ripasso programmata.
 */
export function migrateSrsFields(raw) {
  if (!raw || raw.status !== 'COMPLETED') {
    const keep = Number(raw?.srsStability) > 0 && Number(raw?.srsDifficulty) > 0;
    return keep
      ? { srsStability: Number(raw.srsStability), srsDifficulty: Number(raw.srsDifficulty), lastReviewedAt: raw.lastReviewedAt || null }
      : {};
  }
  const m = memoryState(raw);
  let lastReviewedAt = typeof raw.lastReviewedAt === 'string' ? raw.lastReviewedAt : null;
  if (!lastReviewedAt) {
    const next = dateKeyOf(raw.nextReviewDate);
    const interval = Number(raw.srsIntervalDays);
    if (next && Number.isFinite(interval) && interval > 0) lastReviewedAt = `${addDaysToDateOnly(next, -Math.round(interval))}T12:00:00.000Z`;
    else lastReviewedAt = raw.completionTimestamp || null;
  }
  return { srsStability: round2(m.stability), srsDifficulty: round2(m.difficulty), lastReviewedAt };
}
