import { addDaysToDateOnly, todayDateOnlyKey, daysUntilDateOnly } from './dateUtils.js';

/**
 * Spider-Sense Engine — motore di Spaced Repetition.
 * Ogni nodo completato porta con sé una `nextReviewDate` (date-only,
 * "YYYY-MM-DD"). Quando quella data è raggiunta o superata, il nodo torna
 * NEEDS_REVIEW ("percepito" dallo Spider-Sense). Il pulsante "Ripassa"
 * offre tre gradi di difficoltà percepita che spostano in avanti la
 * prossima revisione — più la senti facile, più a lungo puoi aspettare.
 */
export const REVIEW_RATING = {
  EASY: 'EASY',
  MEDIUM: 'MEDIUM',
  HARD: 'HARD'
};

export const REVIEW_INTERVAL_DAYS = {
  EASY: 4,
  MEDIUM: 2,
  HARD: 1
};

export const REVIEW_RATING_META = {
  EASY: { label: 'Facile', days: 4, color: 'text-emerald-400', border: 'border-emerald-400/50' },
  MEDIUM: { label: 'Medio', days: 2, color: 'text-af-decay', border: 'border-af-decay/50' },
  HARD: { label: 'Difficile', days: 1, color: 'text-af-attack', border: 'border-af-attack/50' }
};

/** Intervallo di prima revisione dopo il primo completamento di un nodo. */
export const INITIAL_REVIEW_INTERVAL_DAYS = 7;

export function computeInitialReviewDate() {
  return addDaysToDateOnly(todayDateOnlyKey(), INITIAL_REVIEW_INTERVAL_DAYS);
}

export function computeNextReviewDate(rating) {
  const days = REVIEW_INTERVAL_DAYS[rating] || REVIEW_INTERVAL_DAYS.MEDIUM;
  return addDaysToDateOnly(todayDateOnlyKey(), days);
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
