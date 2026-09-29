import { useMemo } from 'react';
import { daysUntilReview, nodeRetrievability } from '../utils/spiderSense.js';
import { isGoblinProtocol } from '../utils/materiaMeta.js';
import { todayDateOnlyKey } from '../utils/dateUtils.js';

/** Sopra questa probabilità di ricordo un argomento è "stabile". */
export const RADAR_STABLE = 0.85;
/** Sotto questa è "in allerta" anche se il ripasso non è ancora scaduto. */
export const RADAR_WEAK = 0.7;

/**
 * Il Web-Matrix Radar di una lista di nodi: quanti argomenti completati
 * tengono (ricordo stimato ≥ 85%), quanti stanno sfumando e quanti sono in
 * allerta (ripasso scaduto o ricordo sotto il 70%). `stabilityPct` è il
 * ricordo medio stimato, in percentuale.
 */
export function buildMemoryRadar(sfide, todayKey = todayDateOnlyKey()) {
  const tracked = (Array.isArray(sfide) ? sfide : []).filter((s) => s && s.status === 'COMPLETED');
  const total = tracked.length;
  if (total === 0) return { total: 0, stable: 0, fading: 0, attention: 0, observing: 0, stabilityPct: null, avgRecall: null };
  let stable = 0;
  let fading = 0;
  let attention = 0;
  let somma = 0;
  let conR = 0;
  tracked.forEach((s) => {
    const r = nodeRetrievability(s, todayKey);
    const due = !!s.nextReviewDate && s.nextReviewDate <= todayKey;
    if (r != null) {
      somma += r;
      conR += 1;
    }
    if (due || (r != null && r < RADAR_WEAK)) attention += 1;
    else if (r != null && r < RADAR_STABLE) fading += 1;
    else stable += 1;
  });
  const avgRecall = conR > 0 ? somma / conR : null;
  return {
    total,
    stable,
    fading,
    attention,
    // Compatibilità: "in osservazione" non esiste più (ogni nodo completato
    // ha una memoria stimata dal primo giorno).
    observing: 0,
    stabilityPct: avgRecall != null ? Math.round(avgRecall * 100) : null,
    avgRecall
  };
}

/**
 * useSpiderSense — motore derivato della ripetizione dilazionata. Espone:
 *  - `allTrackedReviews`: ogni nodo COMPLETED con un ripasso in calendario;
 *  - `upcomingReviews`: quelli già scaduti, V42: ordinati per URGENZA
 *    (più giorni di ritardo e ricordo più basso prima), non per materia;
 *  - `memoryRadar`: il ricordo stimato, globale e per materia;
 *  - `goblinMaterie`: le materie in Green Goblin Protocol.
 */
export function useSpiderSense(materie, dayKey = null) {
  return useMemo(() => {
    const oggi = dayKey || todayDateOnlyKey();
    // Le Materie con esame già verbalizzato escono da TUTTO lo Spider-Sense.
    const attive = (Array.isArray(materie) ? materie : []).filter((m) => m && !m.examPassed);
    const allTrackedReviews = attive
      .flatMap((m) =>
        (Array.isArray(m.sfide) ? m.sfide : [])
          .filter((s) => s && s.status === 'COMPLETED' && s.nextReviewDate)
          .map((s) => {
            const daysUntil = daysUntilReview(s.nextReviewDate);
            const recall = nodeRetrievability(s, oggi);
            return {
              materiaId: m.id,
              materiaNome: m.nome,
              // La data della prossima prova viaggia con la voce: serve
              // all'anteprima degli intervalli nel drawer dei ripassi.
              materiaExamDate: m.examDate || null,
              sfidaId: s.id,
              sfidaNome: s.nome,
              nextReviewDate: s.nextReviewDate,
              difficulty: s.difficulty,
              lastReviewRating: s.lastReviewRating,
              reviewCount: s.reviewCount || 0,
              srsStability: s.srsStability,
              srsIntervalDays: s.srsIntervalDays,
              recall,
              daysUntil,
              isDue: daysUntil !== null && daysUntil <= 0
            };
          })
      )
      .sort((a, b) => (a.daysUntil ?? 0) - (b.daysUntil ?? 0) || (a.recall ?? 1) - (b.recall ?? 1));

    const upcomingReviews = allTrackedReviews.filter((r) => r.isDue);
    const goblinMaterie = attive.filter((m) => isGoblinProtocol(m));
    const memoryRadar = {
      global: buildMemoryRadar(attive.flatMap((m) => m.sfide || []), oggi),
      byMateria: attive.map((m) => ({ materiaId: m.id, materiaNome: m.nome, ...buildMemoryRadar(m.sfide, oggi) }))
    };

    return { allTrackedReviews, upcomingReviews, goblinMaterie, memoryRadar };
    // `dayKey`: i ripassi "scaduti" dipendono da oggi, non solo dalle materie.
  }, [materie, dayKey]);
}

export default useSpiderSense;
