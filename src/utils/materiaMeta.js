import { daysUntilDateOnly, addDaysToDateOnly, todayDateOnlyKey } from './dateUtils.js';

export const GOBLIN_THRESHOLD_DAYS = 3;

/**
 * V34.2 — "Ore Previste": monte ore giornaliero sostenibile per nodo,
 * usato per convertire un totale di ORE stimate (unità nativa di ogni
 * nodo, vedi createSfida in skillTree.js) in un numero di GIORNI di
 * calendario per proiettare una data ("Fine Prevista" qui sotto, Quota
 * Odierna in useKarenAutoRouter.js). Unica fonte di verità del valore —
 * prima viveva duplicato solo in useKarenAutoRouter.js: spostato qui
 * perché è il modulo condiviso da entrambi i consumatori (data layer +
 * hook), evitando una dipendenza a ritroso hooks -> data.
 */
export const HOURS_PER_NODE_DAY = 4.5;

/**
 * Green Goblin Protocol: la materia entra in stato d'emergenza quando
 * mancano 3 giorni o meno alla data d'esame (e l'esame non è già passato).
 */
export function isGoblinProtocol(materia) {
  if (!materia.examDate) return false;
  const daysLeft = daysUntilDateOnly(materia.examDate);
  return daysLeft !== null && daysLeft <= GOBLIN_THRESHOLD_DAYS && daysLeft >= 0;
}

/**
 * V16.0 — Stima "Fine Prevista" millimetrica (Pillar 2).
 * V34.2 — "Ore Previste": la stima ora parte dalla somma ESATTA delle ORE
 * previste di ogni nodo ancora incompleto (unità più precisa e più utile
 * sia per Karen sia per l'utente stesso rispetto ai vecchi "giorni" a
 * numero intero), convertita in giorni di calendario tramite
 * HOURS_PER_NODE_DAY SOLO per proiettare la data "Fine Prevista" —
 * l'aritmetica del calendario resta in giorni (addDaysToDateOnly /
 * todayDateOnlyKey, stesso motore date-only usato per l'esame, zero drift
 * di fuso orario), ma il costo di ogni singolo nodo è ora granulare
 * (es. 1.5 ore), non più arrotondato per forza a un giorno intero.
 * Ogni nodo contribuisce almeno 0.5 ore (guardia anti dato corrotto/zero).
 */
export function computeEstimatedCompletion(materia) {
  const sfide = Array.isArray(materia?.sfide) ? materia.sfide : [];
  const total = sfide.length;
  const incomplete = sfide.filter((s) => s.status !== 'COMPLETED');
  const remaining = incomplete.length;

  if (total === 0 || remaining <= 0) {
    return { done: true, remaining: 0, dateKey: null, totalDaysNeeded: 0, totalHoursNeeded: 0 };
  }

  const totalHoursNeeded = incomplete.reduce((sum, s) => sum + Math.max(0.5, Number(s.oreStimate) || 0), 0);
  const totalDaysNeeded = Math.max(1, Math.ceil(totalHoursNeeded / HOURS_PER_NODE_DAY));
  const dateKey = addDaysToDateOnly(todayDateOnlyKey(), totalDaysNeeded);
  return { done: false, remaining, dateKey, totalDaysNeeded, totalHoursNeeded };
}
