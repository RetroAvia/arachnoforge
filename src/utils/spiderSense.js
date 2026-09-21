import { addDaysToDateOnly, todayDateOnlyKey, daysUntilDateOnly } from './dateUtils.js';

/**
 * Spider-Sense Engine — motore di Spaced Repetition.
 *
 * V36.0 — "Intervalli Viventi" (SM-2 lite). Fino alla V35 gli intervalli
 * erano COSTANTI: 7 giorni al primo completamento, poi 4/2/1 giorni per
 * Facile/Medio/Difficile, per sempre. Conseguenza matematica: un nodo
 * saputo perfettamente tornava NEEDS_REVIEW ogni 4 giorni a vita, e il
 * carico di ripassi cresceva LINEARMENTE col numero di nodi completati —
 * a tre mesi dalla sessione la lista diventava ingestibile e smetteva di
 * essere guardata (è così che muoiono i sistemi di ripetizione dilazionata).
 *
 * Ora ogni nodo porta con sé due campi persistiti:
 *   - `srsEase`          fattore di facilità personale del nodo (1.3-3.2)
 *   - `srsIntervalDays`  ampiezza dell'ultimo intervallo concesso
 * e l'intervallo successivo è MOLTIPLICATIVO: `intervallo × ease`, con
 * l'ease che si muove col giudizio (Facile +0.15, Medio invariato,
 * Difficile -0.2). Un "Difficile" azzera l'intervallo a 1 giorno — la
 * curva riparte, esattamente come in SM-2/Anki. Un nodo solido percorre
 * quindi 7 -> 16 -> 39 -> 94 giorni invece di ripresentarsi ogni 4.
 *
 * V36.0 — Vincolo d'esame: nessun ripasso viene MAI schedulato oltre la
 * data dell'esame della materia (vedi `capIntervalToExam`). Man mano che
 * l'esame si avvicina gli intervalli si comprimono da soli, garantendo
 * che ogni nodo cada almeno una volta nei giorni finali — senza nessuna
 * logica di "modalità ripasso pre-esame" da attivare a mano.
 */
export const REVIEW_RATING = {
  EASY: 'EASY',
  MEDIUM: 'MEDIUM',
  HARD: 'HARD'
};

/** Intervallo di prima revisione dopo il primo completamento di un nodo. */
export const INITIAL_REVIEW_INTERVAL_DAYS = 7;

/** Ease di partenza di un nodo mai ripassato, e limiti invalicabili. */
export const DEFAULT_EASE = 2.3;
export const MIN_EASE = 1.3;
export const MAX_EASE = 3.2;

/** Un "Difficile" riporta sempre il nodo a domani: la curva riparte. */
export const HARD_RESET_INTERVAL_DAYS = 1;

/** Tetto di sicurezza: oltre i 6 mesi un ripasso non è più tale. */
export const MAX_INTERVAL_DAYS = 180;

/** Quanto l'ease si muove ad ogni giudizio. */
export const EASE_DELTA = {
  EASY: 0.15,
  MEDIUM: 0,
  HARD: -0.2
};

/** Moltiplicatore applicato all'intervallo corrente per ciascun giudizio.
 * EASY spinge oltre l'ease (sai bene: allunga di più), MEDIUM segue
 * l'ease puro, HARD non moltiplica affatto (vedi HARD_RESET_INTERVAL_DAYS). */
export const INTERVAL_FACTOR = {
  EASY: 1.3,
  MEDIUM: 1,
  HARD: 0
};

export const REVIEW_RATING_META = {
  EASY: { label: 'Facile', color: 'text-emerald-400', border: 'border-emerald-400/50' },
  MEDIUM: { label: 'Medio', color: 'text-af-decay', border: 'border-af-decay/50' },
  HARD: { label: 'Difficile', color: 'text-af-attack', border: 'border-af-attack/50' }
};

function clampEase(ease) {
  if (!Number.isFinite(ease)) return DEFAULT_EASE;
  return Math.min(MAX_EASE, Math.max(MIN_EASE, Math.round(ease * 100) / 100));
}

/**
 * Nessun ripasso oltre la data d'esame: l'intervallo viene compresso per
 * cadere al più tardi il giorno PRIMA dell'esame. Con esame assente,
 * già passato o superato, l'intervallo passa intatto.
 * @param {number} intervalDays intervallo desiderato
 * @param {string|null} examDate "YYYY-MM-DD" della materia
 */
export function capIntervalToExam(intervalDays, examDate) {
  if (!examDate) return intervalDays;
  const daysToExam = daysUntilDateOnly(examDate);
  // Esame oggi o già passato: non c'è più una scadenza da rispettare,
  // si torna alla curva normale.
  if (daysToExam == null || daysToExam <= 0) return intervalDays;
  // V39.0 — con l'esame DOMANI il ripasso cadeva dopo l'esame (fra 69
  // giorni con un "Facile"). Ora al più tardi è domani mattina, cioè il
  // ripasso del giorno d'esame; negli altri casi il giorno prima.
  return Math.min(intervalDays, Math.max(1, daysToExam - 1));
}

/**
 * Prima schedulazione, al primo completamento del nodo.
 * @param {string|null} examDate data d'esame della materia (per il cap).
 */
export function computeInitialReview(examDate = null) {
  const intervalDays = Math.max(1, capIntervalToExam(INITIAL_REVIEW_INTERVAL_DAYS, examDate));
  return {
    nextReviewDate: addDaysToDateOnly(todayDateOnlyKey(), intervalDays),
    srsEase: DEFAULT_EASE,
    srsIntervalDays: intervalDays
  };
}

/**
 * Schedulazione successiva a un giudizio di ripasso (SM-2 lite).
 *
 * @param {{srsEase?:number, srsIntervalDays?:number}} sfida nodo ripassato
 * @param {'EASY'|'MEDIUM'|'HARD'} rating giudizio dell'utente
 * @param {string|null} examDate data d'esame della materia (per il cap)
 * @returns {{nextReviewDate:string, srsEase:number, srsIntervalDays:number}}
 */
export function scheduleNextReview(sfida, rating, examDate = null) {
  const safeRating = REVIEW_RATING[rating] ? rating : REVIEW_RATING.MEDIUM;
  const prevEase = clampEase(Number(sfida?.srsEase));
  const prevInterval =
    Number.isFinite(Number(sfida?.srsIntervalDays)) && Number(sfida.srsIntervalDays) > 0
      ? Number(sfida.srsIntervalDays)
      : INITIAL_REVIEW_INTERVAL_DAYS;

  const srsEase = clampEase(prevEase + EASE_DELTA[safeRating]);

  let intervalDays;
  if (safeRating === REVIEW_RATING.HARD) {
    intervalDays = HARD_RESET_INTERVAL_DAYS;
  } else {
    intervalDays = Math.round(prevInterval * srsEase * INTERVAL_FACTOR[safeRating]);
  }
  intervalDays = Math.min(MAX_INTERVAL_DAYS, Math.max(1, intervalDays));
  intervalDays = Math.max(1, capIntervalToExam(intervalDays, examDate));

  return {
    nextReviewDate: addDaysToDateOnly(todayDateOnlyKey(), intervalDays),
    srsEase,
    srsIntervalDays: intervalDays
  };
}

/**
 * Anteprima "fra quanti giorni tornerà" per ciascun giudizio — alimenta
 * le etichette dei tre pulsanti di ripasso, che così mostrano l'intervallo
 * REALE di quel nodo (es. "Facile · 39gg") invece dei vecchi 4/2/1 fissi
 * uguali per tutti.
 */
export function previewReviewIntervals(sfida, examDate = null) {
  return Object.keys(REVIEW_RATING).reduce((acc, rating) => {
    acc[rating] = scheduleNextReview(sfida, rating, examDate).srsIntervalDays;
    return acc;
  }, {});
}

/** Confronto lessicografico sicuro: "YYYY-MM-DD" ordina cronologicamente come stringa. */
export function isReviewDue(nextReviewDate) {
  if (!nextReviewDate) return false;
  return nextReviewDate <= todayDateOnlyKey();
}

/**
 * Differenza in giorni interi fra oggi e la prossima data di ripasso.
 * Positivo = ripasso futuro ("tra N giorni"), 0 = oggi, negativo = scaduto
 * da |N| giorni. Riusa l'aritmetica UTC assoluta di dateUtils, quindi è
 * sempre coerente con isReviewDue (stesso spazio di calcolo, zero drift).
 */
export function daysUntilReview(nextReviewDate) {
  if (!nextReviewDate) return null;
  return daysUntilDateOnly(nextReviewDate);
}
