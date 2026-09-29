// =====================================================================
// ArachnoForge — src/utils/nowTarget.test.js (V42)
// "Cosa faccio adesso", dal piano: il blocco deciso ieri sera, la lezione
// (se viene prima), i ripassi, poi le materie di oggi col lavoro giusto
// sull'argomento giusto. K.A.R.E.N. sceglie solo DENTRO il piano.
// =====================================================================
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeTodaySequence, tomorrowPlanDraft, pickNode, nodesInTreeOrder, subjectWorkNow, METODO } from './nowTarget.js';
import { WORK_MODE } from './sintesiEngine.js';

const OGGI = '2026-10-05';
const DOMANI = '2026-10-06';

const nodo = (id, over = {}) => ({ id, nome: `Argomento ${id}`, status: 'PENDING', parentId: null, oreStimate: 2, focusMinutes: 0, fonti: [], ...over });
const analisi = {
  id: 'analisi',
  nome: 'Analisi 1',
  formatoEsame: 'SCRITTO_ORALE',
  sfide: [nodo('limiti'), nodo('derivate', { focusMinutes: 50, focusMinutesStudio: 50 }), nodo('integrali')]
};
const fisica = {
  id: 'fisica',
  nome: 'Fisica 1',
  formatoEsame: 'SOLO_ORALE',
  sfide: [nodo('cinematica', { fonti: [{ id: 'f', tipo: 'LIBRO', pagine: 100, pagineFatte: 30 }] }), nodo('dinamica')]
};
const materie = [analisi, fisica];

/** Una materia del piano di oggi (forma di studyPlanner.subjects). */
const voce = (materiaId, over = {}) => ({
  materiaId,
  status: 'OTTIMALE',
  daysRemaining: 20,
  todayTargetHours: 2,
  todayMinHours: 0,
  todaySintesiHours: 0,
  todayStudioHours: 2,
  todayFinalReviewHours: 0,
  doneTodaySintesiHours: 0,
  doneTodayStudioHours: 0,
  doneTodayRipassoHours: 0,
  lateHours: 0,
  ...over
});
const planToday = (subjects, over = {}) => ({
  capacityHours: 4.5,
  targetHours: subjects.reduce((a, s) => a + s.todayTargetHours, 0),
  subjects,
  reviews: { targetCount: 0, done: 0, total: 0 },
  lessons: { prima: false, riservateOre: 0 },
  ...over
});

describe('gli argomenti giusti', () => {
  test('l’ordine dell’albero: ogni padre seguito dai suoi figli', () => {
    const m = { sfide: [nodo('b', { parentId: 'a' }), nodo('c'), nodo('a'), nodo('d', { parentId: 'b' })] };
    assert.deepEqual(nodesInTreeOrder(m).map((s) => s.id), ['c', 'a', 'b', 'd']);
  });

  test('STUDIO: l’argomento già iniziato con gli appunti pronti, altrimenti il primo libero', () => {
    assert.equal(pickNode(analisi, WORK_MODE.STUDIO, OGGI).id, 'derivate');
    assert.equal(pickNode({ sfide: [nodo('x'), nodo('y')] }, WORK_MODE.STUDIO, OGGI).id, 'x');
  });

  test('SINTESI: la sintesi già avviata', () => {
    assert.equal(pickNode(fisica, WORK_MODE.SINTESI, OGGI).id, 'cinematica');
  });

  test('RIPASSO: fra i completati non ripassati oggi, quello che ricordi meno', () => {
    const m = {
      sfide: [
        nodo('solido', { status: 'COMPLETED', srsStability: 60, srsDifficulty: 5, lastReviewedAt: '2026-10-03T10:00:00.000Z' }),
        nodo('fragile', { status: 'COMPLETED', srsStability: 2, srsDifficulty: 8, lastReviewedAt: '2026-09-20T10:00:00.000Z' }),
        nodo('oggi', { status: 'COMPLETED', srsStability: 1, srsDifficulty: 9, lastReviewedAt: `${OGGI}T08:00:00.000Z`, reviewCount: 1 })
      ]
    };
    assert.equal(pickNode(m, WORK_MODE.RIPASSO, OGGI).id, 'fragile');
    assert.equal(pickNode({ sfide: [] }, WORK_MODE.STUDIO, OGGI), null);
  });

  test('il lavoro che resta oggi su una materia: sintesi, poi studio, poi ripasso finale', () => {
    assert.equal(subjectWorkNow(voce('a', { todaySintesiHours: 1, todayStudioHours: 1 })).modo, WORK_MODE.SINTESI);
    assert.equal(subjectWorkNow(voce('a', { todaySintesiHours: 1, doneTodaySintesiHours: 1 })).kind, 'T');
    assert.equal(subjectWorkNow(voce('a', { todayStudioHours: 0, todayFinalReviewHours: 0.5 })).kind, 'F');
    assert.equal(subjectWorkNow(voce('a', { todayStudioHours: 2, doneTodayStudioHours: 2 })), null, 'fatto');
    assert.equal(subjectWorkNow(null), null);
  });
});

describe('la sequenza di oggi', () => {
  test('le materie del piano, nell’ordine del piano, col lavoro e il metodo giusti', () => {
    const s = computeTodaySequence({ materie, planToday: planToday([voce('analisi'), voce('fisica', { todaySintesiHours: 1, todayStudioHours: 0 })]), todayKey: OGGI });
    assert.deepEqual(s.items.map((i) => [i.kind, i.materiaId, i.sfidaId]), [
      ['STUDIO', 'analisi', 'derivate'],
      ['SINTESI', 'fisica', 'cinematica']
    ]);
    assert.equal(s.current.metodo, METODO.STUDIO_SCRITTO, 'con uno scritto, lo studio chiude con esercizi');
    assert.equal(s.current.etichettaOre, 'di studio oggi');
    assert.equal(s.next.etichettaOre, 'di sintesi oggi');
    assert.equal(s.next.metodo, METODO.SINTESI);
  });

  test('i ripassi dovuti vengono prima delle materie', () => {
    const dueReviews = [{ isDue: true, materiaId: 'analisi', sfidaId: 'limiti', sfidaNome: 'Limiti', materiaNome: 'Analisi 1', recall: 0.62, daysUntil: -2 }];
    const s = computeTodaySequence({
      materie,
      planToday: planToday([voce('analisi')], { reviews: { targetCount: 3, done: 1, total: 3 } }),
      dueReviews,
      reviewMinutes: 15,
      todayKey: OGGI
    });
    assert.equal(s.current.kind, 'RIPASSI');
    assert.equal(s.current.ripassiTotali, 1);
    assert.match(s.current.rationale, /62%/);
    assert.match(s.current.rationale, /scaduto da 2 giorni/);
    assert.equal(s.next.kind, 'STUDIO');
  });

  test('il primo blocco deciso ieri sera apre la giornata, finché non lo avvii', () => {
    const tomorrowPlan = { primoBlocco: { materiaId: 'fisica', modo: 'STUDIO', sfidaId: 'dinamica', minuti: 50 }, oraInizio: '09:00', nota: 'prima la dinamica' };
    const s = computeTodaySequence({ materie, planToday: planToday([voce('analisi')]), tomorrowPlan, todayKey: OGGI });
    assert.equal(s.current.kind, 'PIANO_IERI');
    assert.equal(s.current.sfidaId, 'dinamica');
    assert.equal(s.current.minutes, 50);
    assert.match(s.current.badge, /09:00/);
    assert.match(s.current.rationale, /prima la dinamica/);
    const avviato = computeTodaySequence({ materie, planToday: planToday([voce('analisi')]), tomorrowPlan: { ...tomorrowPlan, avviatoAt: `${OGGI}T09:01:00.000Z` }, todayKey: OGGI });
    assert.equal(avviato.current.kind, 'STUDIO');
  });

  test('K.A.R.E.N. sceglie DENTRO il piano: la sua materia passa avanti solo se è fra quelle di oggi', () => {
    const karen = { primary: { materiaId: 'fisica', sfidaId: 'dinamica', metodo: 'Tecnica Feynman sulla dinamica.', rationale: 'La più fragile.' } };
    const conFisica = computeTodaySequence({ materie, planToday: planToday([voce('analisi'), voce('fisica')]), karen, todayKey: OGGI });
    assert.equal(conFisica.current.materiaId, 'fisica');
    assert.equal(conFisica.current.sfidaId, 'dinamica');
    assert.equal(conFisica.current.daKaren, true);
    assert.equal(conFisica.current.metodo, 'Tecnica Feynman sulla dinamica.');
    const senzaFisica = computeTodaySequence({ materie, planToday: planToday([voce('analisi')]), karen, todayKey: OGGI });
    assert.ok(senzaFisica.items.every((i) => i.materiaId !== 'fisica'), 'una materia fuori dal piano di oggi non entra');
  });

  test('studio chiesto ma appunti non pronti: prima la sintesi che manca', () => {
    const soloFonti = { id: 'chimica', nome: 'Chimica', sfide: [nodo('atomi', { fonti: [{ id: 'f', tipo: 'LIBRO', pagine: 50, pagineFatte: 0 }] })] };
    const s = computeTodaySequence({ materie: [soloFonti], planToday: planToday([voce('chimica')]), todayKey: OGGI });
    assert.equal(s.current.kind, 'SINTESI');
    assert.equal(s.current.intent, WORK_MODE.SINTESI);
  });

  test('la lezione da sistemare: prima degli esami solo se il piano lo dice, altrimenti dopo', () => {
    const campus = { fase: 'LEZIONI', coda: [{ materiaId: 'fisica', materia: fisica, lezioniDaSistemare: 1, inizio: '09:00', oreFa: 0 }] };
    const prima = computeTodaySequence({ materie, planToday: planToday([voce('analisi')], { lessons: { prima: true, riservateOre: 1 } }), campus, todayKey: OGGI });
    assert.equal(prima.current.kind, 'LEZIONE');
    assert.equal(prima.current.oreOggi, 1);
    const dopo = computeTodaySequence({ materie, planToday: planToday([voce('analisi')], { lessons: { prima: false, riservateOre: 0 } }), campus, todayKey: OGGI });
    assert.equal(dopo.current.kind, 'STUDIO');
    assert.equal(dopo.items[dopo.items.length - 1].kind, 'LEZIONE');
    assert.equal(dopo.items[dopo.items.length - 1].dopoGliEsami, true);
  });

  test('il ripasso finale ha il suo metodo e la sua etichetta', () => {
    const s = computeTodaySequence({ materie, planToday: planToday([voce('analisi', { todayStudioHours: 0, todayFinalReviewHours: 0.5 })]), todayKey: OGGI });
    assert.equal(s.current.kind, 'FINALE');
    assert.equal(s.current.metodo, METODO.FINALE);
    assert.equal(s.current.etichettaOre, 'di ripasso finale');
  });

  test('tutto fatto: "fatto per oggi"; nessuna capacità e niente da fare: giorno di riposo', () => {
    const fatto = computeTodaySequence({ materie, planToday: planToday([voce('analisi', { doneTodayStudioHours: 2 })]), todayKey: OGGI });
    assert.equal(fatto.current, null);
    assert.equal(fatto.doneForToday, true);
    const riposo = computeTodaySequence({ materie, planToday: planToday([], { capacityHours: 0, targetHours: 0 }), todayKey: OGGI });
    assert.equal(riposo.restDay, true);
    assert.equal(riposo.doneForToday, false);
    assert.equal(computeTodaySequence({}).current, null);
  });

  test('lo stesso blocco non compare due volte di fila', () => {
    const tomorrowPlan = { primoBlocco: { materiaId: 'analisi', modo: 'STUDIO', sfidaId: 'derivate', minuti: 50 } };
    const s = computeTodaySequence({ materie, planToday: planToday([voce('analisi')]), tomorrowPlan, todayKey: OGGI });
    assert.equal(s.items.length, 1);
    assert.equal(s.current.kind, 'PIANO_IERI');
  });
});

describe('tomorrowPlanDraft — il piano di domani per "Chiudi la giornata"', () => {
  test('per materia: minuti arrotondati a 5, lavoro con cui partire e argomento', () => {
    const timeline = [
      { dateKey: DOMANI, capacity: 4.5, items: [{ materiaId: 'analisi', kind: 'T', hours: 2.3 }, { materiaId: 'fisica', kind: 'S', hours: 1 }, { materiaId: 'fisica', kind: 'T', hours: 0.5 }] },
      { dateKey: '2026-10-07', capacity: 4.5, items: [{ materiaId: 'analisi', kind: 'T', hours: 4.5 }] }
    ];
    const allTrackedReviews = [
      { materiaId: 'analisi', nextReviewDate: DOMANI },
      { materiaId: 'analisi', nextReviewDate: OGGI },
      { materiaId: 'analisi', nextReviewDate: '2026-10-20' }
    ];
    const d = tomorrowPlanDraft({ timeline, materie, allTrackedReviews, todayKey: OGGI });
    assert.equal(d.dateKey, DOMANI);
    assert.equal(d.capacityHours, 4.5);
    assert.deepEqual(d.items.map((i) => [i.materiaId, i.minuti, i.modo, i.sfidaId]), [
      ['analisi', 140, WORK_MODE.STUDIO, 'derivate'],
      ['fisica', 90, WORK_MODE.SINTESI, 'cinematica']
    ]);
    assert.equal(d.ripassiDomani, 2);
    assert.equal(d.giornoLibero, false);
  });

  test('domani senza lavoro in calendario: giornata libera', () => {
    const d = tomorrowPlanDraft({ timeline: [], materie, todayKey: OGGI });
    assert.equal(d.giornoLibero, true);
    assert.equal(d.capacityHours, 0);
  });
});
