import { computeSpiderScore, computeDirectUnlockCount, computePressure, getPrerequisiteStatus } from '../data/vanvitelliCourseMap.js';
import { computeRemainingHours } from './materiaMeta.js';
import { daysUntilDateOnly, todayDateOnlyKey, formatHoursMinutes } from './dateUtils.js';

/**
 * Karen's Tactical Suggestor — il "Primary Target".
 *
 * V39.0 — coincide con la prima materia "in focus oggi" del planner.
 * V42 — il planner è globale (utils/studyPlanner.js): il Primary Target è
 * la prima materia della giornata di oggi, e la motivazione parla con i
 * numeri del piano — minimo di oggi, ore che mancano, margine — invece
 * che con una pressione calcolata come se la materia fosse l'unica.
 * Un appello già passato non è più "Event Horizon": è una materia senza
 * data finché non registri l'esito o imposti il prossimo appello.
 */
function buildReason(materia, { unlocksCount, daysRemaining, remainingHours, quota }) {
  const ore = `${Math.round(remainingHours)}h`;
  if (quota) {
    const oggi = quota.todayTargetHours > 0 ? formatHoursMinutes(quota.todayTargetHours) : null;
    if (quota.daysRemaining === 0) {
      return `L'esame di ${materia.nome} è domani o oggi: ${oggi ? `oggi ${oggi} sugli ultimi argomenti e i ripassi,` : 'solo ripassi mirati,'} niente di nuovo.`;
    }
    if (quota.lateHours > 0.25) {
      return `Non ci sta: al tuo ritmo a ${materia.nome} mancherebbero ~${Math.round(quota.lateHours)}h all'esame (${daysRemaining} giorni). Oggi ${oggi || '—'}, ma serve decidere: appello successivo o programma da tagliare.`;
    }
    if (quota.todayMinHours > 0.1) {
      return `Minimo di oggi per restare in tempo: ${formatHoursMinutes(quota.todayMinHours)} su ${materia.nome} (${ore} di lavoro, esame fra ${daysRemaining} giorni).`;
    }
    if (quota.status === 'ATTENZIONE' && daysRemaining != null) {
      return `Al limite: ${ore} di lavoro in ${daysRemaining} giorni, senza margine. Un giorno saltato ti porta fuori tempo.`;
    }
    if (daysRemaining != null && daysRemaining <= 30) {
      return `Scadenza più vicina del piano (${daysRemaining} giorni, ${ore}): oggi ${oggi || 'un blocco'} per anticiparla e arrivare con margine.`;
    }
    if (quota.inizioEntroDateKey && daysRemaining != null) {
      return `Esame fra ${daysRemaining} giorni: c'è margine, ma ogni ora anticipata ora è un'ora in meno in sessione. Oggi ${oggi || 'un blocco'}.`;
    }
  }
  if (unlocksCount >= 2) {
    return `Nodo strategico: ${materia.nome} sblocca ${unlocksCount} esami successivi del piano di studi (${ore} di lavoro).`;
  }
  if (daysRemaining == null) {
    return "Nessuna data d'esame impostata: senza scadenza Karen può valutare solo CFU, difficoltà e propedeuticità. Aggiungi un appello per attivare il piano completo.";
  }
  return `Prossima scadenza del piano: ${ore} in ${daysRemaining} giorni.`;
}

function isPrereqFrozen(materia, allMaterie) {
  if (!materia.courseId) return false;
  return getPrerequisiteStatus(materia.courseId, allMaterie, { excludeMateriaId: materia.id, dependentExamDate: materia.examDate || null }).bloccanti.length > 0;
}

/**
 * @param {Array} materie materie con la data di pianificazione
 * @param {object|null} calibration pacchetto di utils/calibration.js
 * @param {string|null} preferredMateriaId la prima materia della giornata del planner
 * @param {Map|null} planByMateriaId le "quote" del planner, per le motivazioni
 * @returns {null|{materia, spiderScore, unlocksCount, daysRemaining, remainingHours, pressure, reason}}
 */
export function computePrimaryTarget(materie, calibration = null, preferredMateriaId = null, planByMateriaId = null) {
  const safeMaterie = Array.isArray(materie) ? materie : [];
  const pending = safeMaterie.filter((m) => m && !m.examPassed);
  if (pending.length === 0) return null;

  const oggiKey = todayDateOnlyKey();
  const dataValida = (m) => typeof m.examDate === 'string' && m.examDate.slice(0, 10) >= oggiKey;
  const mappata = (m) => (Array.isArray(m.sfide) && m.sfide.length > 0) || dataValida(m);
  const eligible = pending.filter((m) => !isPrereqFrozen(m, safeMaterie) && mappata(m));
  if (eligible.length === 0) return null;

  let best = preferredMateriaId ? eligible.find((m) => m.id === preferredMateriaId) || null : null;
  let bestScore = best ? computeSpiderScore(best, calibration) : -Infinity;
  if (!best) {
    eligible.forEach((m) => {
      const score = computeSpiderScore(m, calibration);
      if (score > bestScore) {
        bestScore = score;
        best = m;
      }
    });
  }
  if (!best) return null;

  const capacityHours = Number(calibration?.hoursPerDay) > 0 ? Number(calibration.hoursPerDay) : 4.5;
  const unlocksCount = computeDirectUnlockCount(best.courseId);
  const raw = best.examDate ? daysUntilDateOnly(best.examDate) : null;
  const daysRemaining = raw != null && raw >= 0 ? raw : null;
  const remainingHours = computeRemainingHours(best, calibration);
  const pressure = computePressure(remainingHours, best.examDate, capacityHours);
  const quota = planByMateriaId && typeof planByMateriaId.get === 'function' ? planByMateriaId.get(best.id) || null : null;

  return {
    materia: best,
    spiderScore: bestScore,
    unlocksCount,
    daysRemaining,
    remainingHours: Math.round(remainingHours * 10) / 10,
    pressure: Math.round(pressure * 100) / 100,
    reason: buildReason(best, { unlocksCount, daysRemaining, remainingHours, quota })
  };
}

export default computePrimaryTarget;
