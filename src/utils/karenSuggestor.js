import { computeSpiderScore, computeDirectUnlockCount, getMissingPrerequisites, computePressure } from '../data/vanvitelliCourseMap.js';
import { computeRemainingHours } from './materiaMeta.js';
import { daysUntilDateOnly } from './dateUtils.js';

/**
 * Karen's Tactical Suggestor — V20.0 "The Master Control" (Pillar 2).
 *
 * L'IA della tuta scansiona ogni Materia del Web-Matrix ancora NON
 * superata (`examPassed !== true`) e decreta il "Primary Target": la
 * materia con lo Spider-Score più alto secondo la Pressure Formula
 * (V36.0 — ore residue calibrate contro ore realmente disponibili prima
 * dell'esame, vedi data/vanvitelliCourseMap.js). Non è un secondo
 * algoritmo — riusa esattamente lo stesso Spider-Score già mostrato in
 * ogni card del Web-Matrix, e la stessa nozione di "ore residue" della
 * Quota Odierna: dalla V36.0 "Primary Target" e "In focus oggi" non
 * possono più indicare due materie diverse per criteri diversi.
 */
/**
 * V36.0 — la motivazione parla ora la stessa lingua del punteggio:
 * ore residue contro ore disponibili. "Mancano 12 giorni" da solo non
 * dice se sei in ritardo; "38 ore da fare in 12 giorni, ne hai 50
 * disponibili al tuo ritmo" sì.
 */
function buildReason(materia, { unlocksCount, daysRemaining, remainingHours, pressure, capacityHours }) {
  const difficulty = Number(materia.perceivedDifficulty) || 3;
  const oreLabel = `${Math.round(remainingHours)}h di lavoro residuo`;

  if (daysRemaining != null && daysRemaining <= 0) {
    return `EVENT HORIZON: l'esame di ${materia.nome} è oggi o già scaduto e restano ${oreLabel}. Nient'altro ha priorità.`;
  }
  if (pressure > 1) {
    const disponibili = Math.round(daysRemaining * capacityHours);
    return `IN DEFICIT: ${materia.nome} ha ${oreLabel} ma solo ~${disponibili}h disponibili in ${daysRemaining} giorni al tuo ritmo reale. Serve recuperare terreno adesso.`;
  }
  if (pressure > 0.7) {
    return `Margine sottile: ${oreLabel} in ${daysRemaining} giorni — sei in pari, ma senza riserva. Un giorno saltato ti porta in deficit.`;
  }
  if (daysRemaining != null && daysRemaining <= 30) {
    return `Scadenza vicina (${daysRemaining} giorni, ${oreLabel}): Karen la tiene in testa alla coda finché il margine non torna ampio.`;
  }
  if (unlocksCount >= 2) {
    return `Nodo strategico: ${materia.nome} sblocca ${unlocksCount} esami successivi del piano di studi (${oreLabel}).`;
  }
  if (daysRemaining == null) {
    return 'Nessuna data d\'esame impostata: senza scadenza la pressione temporale è nulla e Karen può valutare solo CFU, difficoltà e propedeuticità. Imposta una data per attivare il calcolo completo.';
  }
  if (difficulty >= 4) {
    return `Difficoltà elevata con ${daysRemaining} giorni di margine: affrontala ora, finché il margine esiste.`;
  }
  return `Pressione più alta del Web-Matrix: ${oreLabel} in ${daysRemaining} giorni.`;
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
export function computePrimaryTarget(materie, calibration = null) {
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
    const score = computeSpiderScore(m, calibration);
    if (score > bestScore) {
      bestScore = score;
      best = m;
    }
  });
  if (!best) return null;

  const capacityHours = Number(calibration?.hoursPerDay) > 0 ? Number(calibration.hoursPerDay) : 4.5;
  const unlocksCount = computeDirectUnlockCount(best.courseId);
  const daysRemaining = best.examDate ? daysUntilDateOnly(best.examDate) : null;
  const remainingHours = computeRemainingHours(best, calibration);
  const pressure = computePressure(remainingHours, best.examDate, capacityHours);

  return {
    materia: best,
    spiderScore: bestScore,
    unlocksCount,
    daysRemaining,
    remainingHours: Math.round(remainingHours * 10) / 10,
    pressure: Math.round(pressure * 100) / 100,
    reason: buildReason(best, { unlocksCount, daysRemaining, remainingHours, pressure, capacityHours })
  };
}

export default computePrimaryTarget;
