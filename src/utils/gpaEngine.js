import { computeSpiderScore } from '../data/vanvitelliCourseMap.js';

/**
 * GPA / Laurea Engine — V18.0 "The Multiverse Projection" (Pillar 3).
 *
 * Formule ufficiali del sistema universitario italiano, applicate senza
 * arrotondamenti nascosti:
 *  - Media Ponderata Reale = Somma(Voto × CFU) / Somma(CFU), sui soli
 *    esami con Esame Superato + un Voto (18-30) effettivamente registrato.
 *    "A scelta dello studente" e "Prova Finale" seguono la stessa regola:
 *    contano solo se e quando l'utente inserisce un voto per loro.
 *  - Proiezione di Laurea (voto di partenza, base 110) = Media Ponderata × 11 / 3.
 *    Nessun bonus tesi/attività extra: è il calcolo matematico puro
 *    richiesto, la commissione può sempre aggiungere punti a parte.
 */
export const MIN_VOTO = 18;
export const MAX_VOTO = 30;
export const LODE_VALUE = 30; // 30 e lode entra in media come 30 (convenzione standard italiana).
export const GRADUATION_MULTIPLIER = 11 / 3;
// V20.0 (Pillar 4): "due slider fittizi" — la Direttiva Suprema restringe
// esplicitamente lo scenario What-If ai 2 esami più prioritari secondo
// Karen, non più 3.
export const WHAT_IF_SLOT_COUNT = 2;
export const DEFAULT_WHAT_IF_VOTO = 27;

/** Una Materia "conta" per la media solo se l'esame è superato E ha un voto valido registrato. */
export function isGradedMateria(materia) {
  return !!materia && !!materia.examPassed && Number.isFinite(materia.voto) && materia.voto >= MIN_VOTO && materia.voto <= MAX_VOTO;
}

/**
 * Media Ponderata Reale sulle Materie già superate e votate.
 * @returns {{average:number|null, totalCfu:number, totalPoints:number, gradedCount:number}}
 */
export function computeWeightedAverage(materie) {
  const graded = (Array.isArray(materie) ? materie : []).filter(isGradedMateria);
  const totalCfu = graded.reduce((sum, m) => sum + (Number(m.cfu) || 0), 0);
  const totalPoints = graded.reduce((sum, m) => sum + (Number(m.cfu) || 0) * m.voto, 0);
  const average = totalCfu > 0 ? totalPoints / totalCfu : null;
  return { average, totalCfu, totalPoints, gradedCount: graded.length };
}

/** Proiezione di Laurea (voto di partenza su base 110) dalla Media Ponderata. Null se non c'è ancora nessun voto registrato. */
export function computeGraduationProjection(average) {
  if (average == null || !Number.isFinite(average)) return null;
  const raw = average * GRADUATION_MULTIPLIER;
  return Math.round(raw * 10) / 10;
}

/**
 * Combina la Media Ponderata reale con un set di esami "What-If" simulati
 * (non ancora superati davvero), per proiettare l'effetto di voti
 * ipotetici sul voto di laurea finale.
 * @param {Array} materie - stato reale
 * @param {Array<{cfu:number, voto:number}>} simulatedEntries - esami ipotizzati
 */
export function computeWhatIfProjection(materie, simulatedEntries) {
  const base = computeWeightedAverage(materie);
  const entries = Array.isArray(simulatedEntries) ? simulatedEntries.filter((e) => e && Number.isFinite(e.voto) && e.cfu > 0) : [];
  const extraCfu = entries.reduce((sum, e) => sum + e.cfu, 0);
  const extraPoints = entries.reduce((sum, e) => sum + e.cfu * e.voto, 0);
  const totalCfu = base.totalCfu + extraCfu;
  const totalPoints = base.totalPoints + extraPoints;
  const average = totalCfu > 0 ? totalPoints / totalCfu : null;
  return {
    average,
    totalCfu,
    projection: computeGraduationProjection(average)
  };
}

/**
 * Selezione dei prossimi N esami da simulare nel What-If Scenario: le
 * Materie non ancora superate con lo Spider-Score più alto (coerente col
 * Karen's Tactical Suggestor — gli stessi esami che l'IA consiglierebbe
 * di affrontare per primi sono quelli più utile simulare).
 */
export function getTopIncompleteByScore(materie, n = WHAT_IF_SLOT_COUNT) {
  const pending = (Array.isArray(materie) ? materie : []).filter((m) => m && !m.examPassed && Number(m.cfu) > 0);
  return [...pending]
    .sort((a, b) => computeSpiderScore(b) - computeSpiderScore(a))
    .slice(0, n);
}

/**
 * Effetto marginale di UN SOLO esame simulato sulla proiezione attuale
 * (baseline reale + questo esame soltanto) — alimenta la frase dinamica
 * "Karen: Se prendi 28 in Aerodinamica, il tuo voto di partenza salirà a 98.4."
 */
export function computeMarginalProjection(materie, cfu, voto) {
  return computeWhatIfProjection(materie, [{ cfu, voto }]);
}
