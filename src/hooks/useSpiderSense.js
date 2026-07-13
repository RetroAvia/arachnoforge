import { useMemo } from 'react';
import { daysUntilReview, isReviewDue, REVIEW_RATING } from '../utils/spiderSense.js';
import { isGoblinProtocol } from '../utils/materiaMeta.js';

/**
 * useSpiderSense — motore derivato dello Spider-Sense Engine (Spaced
 * Repetition). Espone:
 *  - `allTrackedReviews`: ogni nodo COMPLETED con nextReviewDate tracciata,
 *    scaduto o no (visibilità totale sullo Spider-Sense Schedule);
 *  - `upcomingReviews`: il sottoinsieme già scaduto (isDue);
 *  - `memoryRadar`: il Web-Matrix Radar di stabilità sinaptica, globale e
 *    per materia;
 *  - `goblinMaterie`: le materie attualmente in Green Goblin Protocol.
 *
 * Estratto dal ArachnoForgeContext (Fase 2 — Custom Hooks & State Split)
 * per isolare tutta la logica di Spaced Repetition in un solo posto
 * riusabile, invece di tenerla annegata dentro il grande `derived` useMemo.
 */
export function useSpiderSense(materie) {
  return useMemo(() => {
    const allTrackedReviews = materie.flatMap((m) =>
      m.sfide
        .filter((s) => s.status === 'COMPLETED' && s.nextReviewDate)
        .map((s) => {
          const daysUntil = daysUntilReview(s.nextReviewDate);
          return {
            materiaId: m.id,
            materiaNome: m.nome,
            sfidaId: s.id,
            sfidaNome: s.nome,
            nextReviewDate: s.nextReviewDate,
            difficulty: s.difficulty,
            lastReviewRating: s.lastReviewRating,
            reviewCount: s.reviewCount || 0,
            daysUntil,
            isDue: daysUntil !== null && daysUntil <= 0
          };
        })
        .sort((a, b) => (a.daysUntil ?? 0) - (b.daysUntil ?? 0))
    );

    const upcomingReviews = allTrackedReviews.filter((r) => r.isDue);
    const goblinMaterie = materie.filter((m) => isGoblinProtocol(m));

    // Percentuale di nodi "stabili" (ultimo giudizio Facile/Medio, non
    // attualmente in allerta Spider-Sense) sul totale dei nodi già entrati
    // nel motore SRS. I nodi mai ripassati ancora (prima esposizione, in
    // attesa dei +7gg iniziali) sono "in osservazione": non contano né a
    // favore né contro la percentuale.
    const buildRadar = (sfide) => {
      const tracked = sfide.filter((s) => s.status === 'COMPLETED');
      const total = tracked.length;
      if (total === 0) return { total: 0, stable: 0, attention: 0, observing: 0, stabilityPct: null };
      let stable = 0;
      let attention = 0;
      let observing = 0;
      tracked.forEach((s) => {
        const due = isReviewDue(s.nextReviewDate);
        if (due) {
          attention += 1;
        } else if (!s.lastReviewRating) {
          observing += 1;
        } else if (s.lastReviewRating === REVIEW_RATING.HARD) {
          attention += 1;
        } else {
          stable += 1;
        }
      });
      const ratable = stable + attention;
      const stabilityPct = ratable > 0 ? Math.round((stable / ratable) * 100) : null;
      return { total, stable, attention, observing, stabilityPct };
    };

    const memoryRadar = {
      global: buildRadar(materie.flatMap((m) => m.sfide)),
      byMateria: materie.map((m) => ({ materiaId: m.id, materiaNome: m.nome, ...buildRadar(m.sfide) }))
    };

    return { allTrackedReviews, upcomingReviews, goblinMaterie, memoryRadar };
  }, [materie]);
}

export default useSpiderSense;
