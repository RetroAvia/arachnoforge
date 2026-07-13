import { daysUntilDateOnly, addDaysToDateOnly, todayDateOnlyKey } from './dateUtils.js';

export const GOBLIN_THRESHOLD_DAYS = 3;

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
 *
 * Abbandonato il vecchio calcolo per ritmo medio (nodi completati / giorni
 * trascorsi), inaffidabile e volatile a inizio percorso. La nuova stima è
 * deterministica: somma ESATTA dei "giorni" (costo stimato) di ogni nodo
 * ANCORA incompleto della materia, sommata a "oggi" in UTC assoluto via
 * addDaysToDateOnly/todayDateOnlyKey (stesso motore date-only usato per
 * l'esame — zero drift di fuso orario). Aggiungere un nodo da 3 giorni
 * sposta la stima di ESATTAMENTE 3 giorni: nessuna media, nessuna sorpresa.
 * Ogni nodo contribuisce almeno 1 giorno (guardia anti dato corrotto/zero).
 */
export function computeEstimatedCompletion(materia) {
  const sfide = Array.isArray(materia?.sfide) ? materia.sfide : [];
  const total = sfide.length;
  const incomplete = sfide.filter((s) => s.status !== 'COMPLETED');
  const remaining = incomplete.length;

  if (total === 0 || remaining <= 0) return { done: true, remaining: 0, dateKey: null, totalDaysNeeded: 0 };

  const totalDaysNeeded = incomplete.reduce((sum, s) => sum + Math.max(1, Number(s.giorni) || 1), 0);
  const dateKey = addDaysToDateOnly(todayDateOnlyKey(), totalDaysNeeded);
  return { done: false, remaining, dateKey, totalDaysNeeded };
}
