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
 * V36.0 — "Karen impara da te": HOURS_PER_NODE_DAY resta il FALLBACK
 * (profilo nuovo, storico insufficiente), non più l'unico valore
 * possibile. Quando `utils/calibration.js` ha abbastanza storico, la
 * capacità reale misurata sulle tue sessioni lo sostituisce, e con essa
 * il fattore di calibrazione che corregge le ore dichiarate di ogni nodo.
 * Nessun chiamante è obbligato a passarla: omettendola, il comportamento
 * è identico a quello pre-V36.0.
 */
function resolveCalibration(calibration) {
  const hoursPerDay = Number(calibration?.hoursPerDay);
  const biasFactor = Number(calibration?.biasFactor);
  return {
    hoursPerDay: Number.isFinite(hoursPerDay) && hoursPerDay > 0 ? hoursPerDay : HOURS_PER_NODE_DAY,
    biasFactor: Number.isFinite(biasFactor) && biasFactor > 0 ? biasFactor : 1
  };
}

/**
 * Monte ore accademico standard per CFU — usato SOLO come fallback per
 * una Materia senza alcun nodo creato (nessuna stima dal basso possibile).
 * V36.0: spostato qui da useKarenAutoRouter.js perché ora serve anche al
 * data layer (Spider-Score) — stessa logica per cui HOURS_PER_NODE_DAY
 * vive in questo modulo condiviso invece che nell'hook.
 */
export const HOURS_PER_CFU = 10;

/**
 * Ore di lavoro ancora davanti per una Materia, in UNA sola definizione
 * condivisa da tutti i motori (Spider-Score, Quota Odierna, Exam
 * Readiness) — prima ne esistevano due varianti leggermente diverse in
 * file diversi, ed è da lì che nascevano le classifiche discordanti fra
 * "Primary Target" e "In focus oggi".
 *
 *  - con nodi: Σ (ore stimate calibrate - ore di Focus già tracciate),
 *    sui soli nodi non completati;
 *  - senza nodi: fallback puro su CFU × HOURS_PER_CFU.
 */
export function computeRemainingHours(materia, calibration = null) {
  const { biasFactor } = resolveCalibration(calibration);
  const sfide = Array.isArray(materia?.sfide) ? materia.sfide : [];
  if (sfide.length === 0) {
    return Math.max(0, (Number(materia?.cfu) || 0) * HOURS_PER_CFU);
  }
  return sfide
    .filter((s) => s && s.status !== 'COMPLETED')
    .reduce((sum, s) => {
      const budget = Math.max(0.5, Number(s.oreStimate) || 0) * biasFactor;
      const tracked = (Number(s.focusMinutes) || 0) / 60;
      return sum + Math.max(0, budget - tracked);
    }, 0);
}

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
export function computeEstimatedCompletion(materia, calibration = null) {
  const { hoursPerDay, biasFactor } = resolveCalibration(calibration);
  const sfide = Array.isArray(materia?.sfide) ? materia.sfide : [];
  const total = sfide.length;
  const incomplete = sfide.filter((s) => s.status !== 'COMPLETED');
  const remaining = incomplete.length;

  if (total === 0 || remaining <= 0) {
    return { done: true, remaining: 0, dateKey: null, totalDaysNeeded: 0, totalHoursNeeded: 0, rawHoursNeeded: 0 };
  }

  const rawHoursNeeded = incomplete.reduce((sum, s) => sum + Math.max(0.5, Number(s.oreStimate) || 0), 0);
  // V36.0 — le ore residue sono quelle DICHIARATE corrette dal tuo bias
  // storico: se finora ogni nodo ti è costato il 40% in più di quanto
  // avevi stimato, la proiezione lo sa e smette di essere ottimistica.
  const totalHoursNeeded = Math.round(rawHoursNeeded * biasFactor * 100) / 100;
  const totalDaysNeeded = Math.max(1, Math.ceil(totalHoursNeeded / hoursPerDay));
  const dateKey = addDaysToDateOnly(todayDateOnlyKey(), totalDaysNeeded);
  return { done: false, remaining, dateKey, totalDaysNeeded, totalHoursNeeded, rawHoursNeeded };
}
