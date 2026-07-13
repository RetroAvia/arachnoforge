import { computeSpiderScore, computeDirectUnlockCount, getMissingPrerequisites } from '../data/vanvitelliCourseMap.js';
import { daysUntilDateOnly } from './dateUtils.js';

/**
 * Karen's Tactical Suggestor — V20.0 "The Master Control" (Pillar 2).
 *
 * L'IA della tuta scansiona ogni Materia del Web-Matrix ancora NON
 * superata (`examPassed !== true`) e decreta il "Primary Target": la
 * materia con lo Spider-Score più alto secondo la Time-Weaver Formula
 * (Difficoltà + Esami Sbloccati + 1000/Giorni Mancanti). Non è un secondo
 * algoritmo — riusa esattamente lo stesso Spider-Score già mostrato in
 * ogni card del Web-Matrix, così il consiglio di Karen è sempre coerente
 * con l'ordinamento visibile all'utente, mai un numero calcolato "a
 * parte". La motivazione ora parla di GIORNI reali, non più di uno
 * slider soggettivo di "Urgenza": il tempo è il fattore dominante.
 */
function buildReason(materia, unlocksCount, daysRemaining) {
  const difficulty = Number(materia.perceivedDifficulty) || 3;

  if (daysRemaining != null && daysRemaining <= 30) {
    const dayLabel = daysRemaining <= 0 ? 'è SCADUTO o è oggi' : `mancano solo ${daysRemaining} giorni`;
    return `EVENT HORIZON TEMPORALE: per ${materia.nome} ${dayLabel}. Il tempo scavalca ogni altra priorità del piano di studi.`;
  }
  if (unlocksCount >= 3) {
    return `Priorità Massima: ${materia.nome} sblocca ${unlocksCount} esami successivi del piano di studi.`;
  }
  if (unlocksCount >= 1 && daysRemaining != null && daysRemaining <= 60) {
    return `Nodo strategico e temporalmente vicino: sblocca ${unlocksCount} esame/i e mancano ${daysRemaining} giorni.`;
  }
  if (unlocksCount >= 1) {
    return `Sblocca ${unlocksCount} esame/i successivo/i: propedeuticità chiave del piano di studi.`;
  }
  if (daysRemaining == null) {
    return 'Nessuna data d\'esame impostata: Karen valuta solo Difficoltà e propedeuticità. Imposta una data per attivare la pressione temporale della Time-Weaver Formula.';
  }
  if (difficulty >= 4) {
    return `Difficoltà elevata (mancano ${daysRemaining} giorni): Karen consiglia di affrontarlo con il margine temporale più ampio possibile.`;
  }
  return `Spider-Score più alto del Web-Matrix (mancano ${daysRemaining} giorni): il miglior bilancio fra difficoltà, tempo e impatto strategico.`;
}

/** V29.0 — Pillar 2 (Automatic Precedence Engine): una Materia con propedeuticità ufficiali del piano di studi non ancora superate è "congelata" per il planner automatico. */
function isPrereqFrozen(materia, allMaterie) {
  if (!materia.courseId) return false;
  return getMissingPrerequisites(materia.courseId, allMaterie, materia.id).length > 0;
}

/**
 * @param {Array} materie - state.materie corrente
 * @returns {null|{materia, spiderScore, unlocksCount, daysRemaining, reason}} null se non ci sono materie da superare (o se sono tutte congelate).
 */
export function computePrimaryTarget(materie) {
  const safeMaterie = Array.isArray(materie) ? materie : [];
  const pending = safeMaterie.filter((m) => m && !m.examPassed);
  if (pending.length === 0) return null;

  // V29.0 — Pillar 2: Karen non spinge MAI una Materia le cui
  // propedeuticità ufficiali non sono ancora superate (es. Aerodinamica
  // prima di Analisi 1) — resta comunque aperta e preparabile a mano nel
  // Web-Matrix, ma esclusa dal Primary Target automatico finché non si
  // sblocca. Se risultano TUTTE congelate, Karen non ha nulla da spingere
  // (nessun fallback silenzioso su una materia bloccata).
  const eligible = pending.filter((m) => !isPrereqFrozen(m, safeMaterie));
  if (eligible.length === 0) return null;

  let best = null;
  let bestScore = -Infinity;
  eligible.forEach((m) => {
    const score = computeSpiderScore(m);
    if (score > bestScore) {
      bestScore = score;
      best = m;
    }
  });
  if (!best) return null;

  const unlocksCount = computeDirectUnlockCount(best.courseId);
  const daysRemaining = best.examDate ? daysUntilDateOnly(best.examDate) : null;
  return {
    materia: best,
    spiderScore: bestScore,
    unlocksCount,
    daysRemaining,
    reason: buildReason(best, unlocksCount, daysRemaining)
  };
}

export default computePrimaryTarget;
