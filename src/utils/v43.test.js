// =====================================================================
// ArachnoForge — src/utils/v43.test.js (V43)
// Le correzioni della V43, una per blocco. Ogni test fissa il giorno.
// =====================================================================
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeStudyPlan, PLAN_STATUS } from './studyPlanner.js';
import { getPrerequisiteStatus } from '../data/vanvitelliCourseMap.js';
import { addDaysToDateOnly } from './dateUtils.js';

const OGGI = '2027-01-20';
const fra = (n) => addDaysToDateOnly(OGGI, n);
const CAL = { hoursPerDay: 4.5, biasFactor: 1 };
let seq = 0;
const nodo = (over = {}) => {
  seq += 1;
  return { id: `n${seq}`, nome: `Nodo ${seq}`, status: 'PENDING', oreStimate: 6, focusMinutes: 0, fonti: [], ...over };
};
const conAppello = (m, scritto, esito = null) => ({
  ...m,
  examDate: scritto,
  appelli: [{ id: `a_${m.id}`, scritto, orale: null, nota: '', esito, esitoAt: null }],
  appelloTargetId: `a_${m.id}`
});

describe('V43 · propedeutica sostenuta, esito in attesa', () => {
  const analisi1 = (esito) =>
    conAppello({ id: 'a1', nome: 'Analisi Matematica 1', courseId: 'analisi1', cfu: 12, examPassed: false, sfide: [nodo(), nodo()] }, fra(-5), esito);
  const analisi2 = () =>
    conAppello({ id: 'a2', nome: 'Analisi Matematica 2', courseId: 'analisi2', cfu: 9, examPassed: false, sfide: Array.from({ length: 10 }, () => nodo()) }, fra(21));

  test('senza esito dichiarato la materia successiva NON è congelata', () => {
    const st = getPrerequisiteStatus('analisi2', [analisi1(null), analisi2()], { excludeMateriaId: 'a2', dependentExamDate: fra(21), todayKey: OGGI });
    assert.equal(st.bloccanti.length, 0);
    assert.equal(st.pianificate.length, 1);
    assert.equal(st.pianificate[0].inAttesaEsito, true);
  });

  test('con "aspetto l\'esito" (IN_ATTESA) idem', () => {
    const st = getPrerequisiteStatus('analisi2', [analisi1('IN_ATTESA'), analisi2()], { excludeMateriaId: 'a2', dependentExamDate: fra(21), todayKey: OGGI });
    assert.equal(st.bloccanti.length, 0);
  });

  test('dichiarata NON superata: resta bloccante', () => {
    const st = getPrerequisiteStatus('analisi2', [analisi1('NON_SUPERATO'), analisi2()], { excludeMateriaId: 'a2', dependentExamDate: fra(21), todayKey: OGGI });
    assert.equal(st.bloccanti.length, 1);
  });

  test('propedeutica senza data: resta bloccante (come prima)', () => {
    const a1 = { id: 'a1', nome: 'Analisi Matematica 1', courseId: 'analisi1', cfu: 12, examPassed: false, examDate: null, sfide: [] };
    const st = getPrerequisiteStatus('analisi2', [a1, analisi2()], { excludeMateriaId: 'a2', dependentExamDate: fra(21), todayKey: OGGI });
    assert.equal(st.bloccanti.length, 1);
  });

  test('nel piano Analisi 2 riceve ore oggi e non è CONGELATA', () => {
    const plan = computeStudyPlan([analisi1(null), analisi2()], { calibration: CAL, todayKey: OGGI });
    const a2 = plan.byMateriaId.get('a2');
    assert.notEqual(a2.status, PLAN_STATUS.CONGELATA);
    assert.equal(a2.frozen, false);
    assert.ok(a2.todayTargetHours > 0, `ore di oggi: ${a2.todayTargetHours}`);
    assert.equal(a2.prereqPianificate[0].inAttesaEsito, true);
  });
});

describe('V43 · ripassi: il giorno è quello locale, non UTC', () => {
  test('un ripasso alle 00:30 ora italiana conta per quel giorno', async () => {
    const prev = process.env.TZ;
    process.env.TZ = 'Europe/Rome';
    try {
      const { localDateKeyOf } = await import('./dateUtils.js');
      const { reviewedToday, scheduleNextReview } = await import('./spiderSense.js');
      // 6 ottobre, 00:30 in Italia (ora legale) = 5 ottobre 22:30 UTC.
      const iso = '2026-10-05T22:30:00.000Z';
      assert.equal(localDateKeyOf(iso), '2026-10-06');
      assert.equal(localDateKeyOf('2026-10-06'), '2026-10-06');
      assert.equal(localDateKeyOf(null), null);
      const nodoRipassato = { id: 'x', status: 'COMPLETED', reviewCount: 1, srsStability: 20, srsDifficulty: 5, lastReviewedAt: iso };
      assert.equal(reviewedToday(nodoRipassato, '2026-10-06'), true);
      // Secondo "Facile" la stessa notte: è una ripetizione dello stesso
      // giorno (elapsed 0), non un giorno di distanza.
      const out = scheduleNextReview(nodoRipassato, 'EASY', null, { todayKey: '2026-10-06', nowIso: '2026-10-05T22:50:00.000Z' });
      assert.equal(out.elapsedDays, 0);
    } finally {
      if (prev === undefined) delete process.env.TZ;
      else process.env.TZ = prev;
    }
  });
});

describe('V43 · i ripassi arretrati rinviati occupano i giorni dopo', () => {
  test('40 ripassi scaduti: quelli che non stanno oggi tolgono tempo da domani in poi', () => {
    const OGGI2 = '2026-10-05';
    const fatti = Array.from({ length: 40 }, (_, i) => ({
      id: `r${i}`, nome: `R${i}`, status: 'COMPLETED', oreStimate: 1, focusMinutes: 60, fonti: [],
      nextReviewDate: '2026-09-20', reviewCount: 1, lastReviewedAt: '2026-09-10T10:00:00.000Z'
    }));
    const vecchia = { id: 'mv', nome: 'Vecchia', cfu: 6, examPassed: false, examDate: null, sfide: fatti };
    const nuova = { id: 'mn', nome: 'Nuova', cfu: 6, examPassed: false, examDate: addDaysToDateOnly(OGGI2, 40), sfide: Array.from({ length: 30 }, () => nodo()) };
    const plan = computeStudyPlan([vecchia, nuova], { calibration: CAL, todayKey: OGGI2, timelineDays: 30 });
    const r = plan.today.reviews;
    assert.ok(r.rinviati > 0);
    const oreRinviate = r.rinviatiPerGiorno.reduce((a, g) => a + g.hours, 0);
    assert.ok(Math.abs(oreRinviate - (r.rinviati * 15) / 60) < 0.05, `ore rinviate ${oreRinviate}`);
    // Ogni giorno al massimo metà della capacità va all'arretrato.
    r.rinviatiPerGiorno.forEach((g) => assert.ok(g.hours <= 4.5 * 0.5 + 1e-9));
    // Domani lo studio nuovo ha meno della capacità piena.
    const domani = plan.timeline.find((g) => g.day === 1);
    assert.ok(domani.capacity < 4.5 - 1, `capacità di domani per lo studio: ${domani.capacity}`);
  });

  test('senza arretrato nulla cambia', () => {
    const OGGI2 = '2026-10-05';
    const m = { id: 'm1', nome: 'M', cfu: 6, examPassed: false, examDate: addDaysToDateOnly(OGGI2, 40), sfide: [nodo(), nodo()] };
    const plan = computeStudyPlan([m], { calibration: CAL, todayKey: OGGI2 });
    assert.equal(plan.today.reviews.rinviati, 0);
    assert.deepEqual(plan.today.reviews.rinviatiPerGiorno, []);
  });
});

describe('V43 · scenario "+1 ora al giorno"', () => {
  test('bonusHours aggiunge esattamente 1h a ogni giorno di studio, sopra il profilo vero', async () => {
    const { capacityForDate } = await import('./calibration.js');
    const cal = {
      capacityWeight: 1, measuredHoursPerDay: 3, hoursPerDay: 3, restDays: [7],
      weekdayConfident: true, weekdayFactors: [1, 1.2, 0.8, 1, 1, 1, 0.7, 0]
    };
    const lunedi = '2026-10-05';
    const domenica = '2026-10-11';
    for (let i = 0; i < 6; i += 1) {
      const k = addDaysToDateOnly(lunedi, i);
      const prima = capacityForDate(k, cal);
      const dopo = capacityForDate(k, { ...cal, bonusHours: 1 });
      assert.ok(Math.abs(dopo - prima - 1) < 1e-9, `${k}: ${prima} -> ${dopo}`);
    }
    assert.equal(capacityForDate(domenica, { ...cal, bonusHours: 1 }), 0);
  });

  test('lo scenario usa bonusHours e mantiene il profilo', async () => {
    const { computePlanScenarios } = await import('./planScenarios.js');
    const { computeDailyPlan } = await import('./quotaEngine.js');
    const OGGI2 = '2026-10-05';
    const tanti = Array.from({ length: 40 }, () => nodo({ oreStimate: 5 }));
    const m = { id: 'mx', nome: 'Grossa', cfu: 9, examPassed: false, examDate: addDaysToDateOnly(OGGI2, 20), sfide: tanti };
    const cal = { capacityWeight: 1, measuredHoursPerDay: 3, hoursPerDay: 3, restDays: [7] };
    const inputs = { calibration: cal, todayKey: OGGI2 };
    const base = computeDailyPlan([m], { ...inputs, timelineDays: 0 });
    const scen = computePlanScenarios([m], inputs, base, { todayKey: OGGI2 });
    const ora = scen.find((s) => s.kind === 'ORA_IN_PIU');
    assert.ok(ora, 'scenario presente');
    // 19 giorni di studio prima della vigilia, 16 lavorativi circa: le ore
    // scoperte calano di circa 1h per giorno di studio, non di 0,5h.
    const guadagno = ora.prima.lateHours - ora.dopo.lateHours;
    assert.ok(guadagno >= 15, `ore recuperate: ${guadagno}`);
  });
});

describe('V43 · salva prima di chiamare K.A.R.E.N.', () => {
  test('attende il salvataggio registrato', async () => {
    const { awaitSaveBeforeAi } = await import('./aiSaveGuard.js');
    const ordine = [];
    const salva = () => new Promise((r) => setTimeout(() => { ordine.push('salvato'); r(true); }, 20));
    const ok = await awaitSaveBeforeAi(salva);
    ordine.push('chiamata IA');
    assert.equal(ok, true);
    assert.deepEqual(ordine, ['salvato', 'chiamata IA']);
  });
  test('un salvataggio lento non blocca oltre il tetto, uno che lancia non rompe', async () => {
    const { awaitSaveBeforeAi } = await import('./aiSaveGuard.js');
    const t0 = Date.now();
    const lento = () => new Promise((r) => setTimeout(() => r(true), 5000));
    assert.equal(await awaitSaveBeforeAi(lento, 50), false);
    assert.ok(Date.now() - t0 < 1000);
    assert.equal(await awaitSaveBeforeAi(() => { throw new Error('x'); }), false);
    assert.equal(await awaitSaveBeforeAi(null), false);
  });
});

describe('V43 · Stamina ribilanciata e collegata alla Readiness', () => {
  test('2 ore di Focus non svuotano più la Stamina con una capacità media bassa', async () => {
    const { computeFocusStaminaCost } = await import('./xpEngine.js');
    // Capacità misurata 1,2 h/giorno (giorni saltati nella media del mese):
    // prima 4 blocchi da 30' costavano 4 × 33 = 132 → Stamina a zero. Ora ~36.
    const costo = 4 * computeFocusStaminaCost(30, 'MEDIUM', 1, false, 1.2);
    assert.ok(costo <= 40, `costo di 2 ore: ${costo}`);
    const difficile = 4 * computeFocusStaminaCost(30, 'HARD', 1, false, 1.2);
    assert.ok(difficile <= 48, `2 ore difficili: ${difficile}`);
  });

  test('chi studia abitualmente di più ha una riserva più grande (fino a 9 ore)', async () => {
    const { computeFocusStaminaCost } = await import('./xpEngine.js');
    assert.ok(computeFocusStaminaCost(120, 'MEDIUM', 1, false, 7) < computeFocusStaminaCost(120, 'MEDIUM', 1, false, 4.5));
    assert.equal(computeFocusStaminaCost(120, 'MEDIUM', 1, false, 20), computeFocusStaminaCost(120, 'MEDIUM', 1, false, 9));
  });

  test('la Readiness di oggi regola il consumo; senza Readiness nessun effetto', async () => {
    const { computeFocusStaminaCost, staminaReadinessFactor } = await import('./xpEngine.js');
    assert.equal(staminaReadinessFactor(null), 1);
    assert.equal(staminaReadinessFactor(undefined), 1);
    assert.equal(staminaReadinessFactor(100), 0.85);
    assert.equal(staminaReadinessFactor(0), 1.3);
    const neutro = computeFocusStaminaCost(120, 'MEDIUM', 1, false, 4.5, null);
    const riposato = computeFocusStaminaCost(120, 'MEDIUM', 1, false, 4.5, 95);
    const distrutto = computeFocusStaminaCost(120, 'MEDIUM', 1, false, 4.5, 25);
    assert.ok(riposato < neutro && neutro < distrutto, `${riposato} < ${neutro} < ${distrutto}`);
  });
});

describe('V43 · memoria delle tecniche', () => {
  test('catalogo: riconosce la tecnica nominata per prima', async () => {
    const { detectStudyTechnique, techniqueOfAdvice } = await import('../data/studyTechniques.js');
    assert.equal(detectStudyTechnique('Scomponilo ed esercitati con esempi svolti; a fine blocco tecnica Feynman.'), 'ESEMPI_SVOLTI');
    assert.equal(detectStudyTechnique('Tecnica Feynman sulle fonti'), 'FEYNMAN');
    assert.equal(detectStudyTechnique(''), null);
    assert.equal(techniqueOfAdvice({ tecnica: 'INTERLEAVING', metodo: 'Feynman' }), 'INTERLEAVING');
    assert.equal(techniqueOfAdvice({ tecnica: 'BOH', metodo: 'richiamo attivo a libro chiuso' }), 'RICHIAMO_ATTIVO');
  });

  test('gli esiti vanno alla tecnica prevalente sull\'argomento fino a quel giorno', async () => {
    const { computeTechniqueMemory, techniqueMemoryForKaren } = await import('./techniqueMemory.js');
    const materie = [
      {
        id: 'm1',
        nome: 'Analisi 1',
        sfide: [
          {
            id: 's1',
            tecniche: [
              { at: '2026-10-01', tecnica: 'ESEMPI_SVOLTI', minuti: 50, modo: 'STUDIO' },
              { at: '2026-10-02', tecnica: 'RILETTURA', minuti: 20, modo: 'STUDIO' }
            ],
            ripassi: [
              { at: '2026-10-04T09:00:00.000Z', voto: 'EASY', fonte: 'FOCUS' },
              { at: '2026-10-08T09:00:00.000Z', voto: 'MEDIUM', fonte: 'MANUALE' },
              // Dall'interrogazione: si conta una volta sola, dal quiz.
              { at: '2026-10-09T09:00:00.000Z', voto: 'AGAIN', fonte: 'QUIZ' }
            ],
            quizEsiti: [{ at: '2026-10-09T09:00:00.000Z', sapevo: 1, parziale: 0, no: 4, modo: 'QUIZ' }]
          },
          {
            id: 's2',
            tecniche: [{ at: '2026-10-01', tecnica: 'RILETTURA', minuti: 60, modo: 'STUDIO' }],
            ripassi: [
              { at: '2026-10-05T09:00:00.000Z', voto: 'AGAIN', fonte: 'FOCUS' },
              { at: '2026-10-06T09:00:00.000Z', voto: 'HARD', fonte: 'FOCUS' }
            ],
            esercizi: [{ at: '2026-10-07', fatti: 10, corretti: 3, minuti: 30 }]
          },
          // Senza tecniche dichiarate: non conta.
          { id: 's3', ripassi: [{ at: '2026-10-05T09:00:00.000Z', voto: 'EASY' }] }
        ]
      }
    ];
    const mem = computeTechniqueMemory(materie);
    const es = mem.tecniche.find((t) => t.id === 'ESEMPI_SVOLTI');
    const ril = mem.tecniche.find((t) => t.id === 'RILETTURA');
    assert.equal(es.buoni, 2);
    assert.equal(es.difficili, 1); // il quiz andato male
    assert.equal(es.tasso, 0.67);
    assert.equal(ril.buoni, 0);
    assert.equal(ril.difficili, 3); // due ripassi + esercizi al 30%
    assert.equal(mem.sessioni, 3);
    const k = techniqueMemoryForKaren(mem);
    assert.equal(k[0].tecnica, 'RILETTURA'); // più minuti
    assert.deepEqual(Object.keys(k[0]).sort(), ['esiti_buoni', 'esiti_difficili', 'minuti', 'per_materia', 'sessioni', 'tecnica']);
    assert.equal(k[0].per_materia[0].materia_id, 'm1');
    assert.equal(techniqueMemoryForKaren(computeTechniqueMemory([])), null);
  });

  test('il Debriefing salva la tecnica sul nodo e nella sessione; il caricamento la conserva', async () => {
    const { reducer } = await import('../state/reducer.js');
    const { createDefaultState, hydrateState } = await import('../data/defaultSchema.js');
    const s = createDefaultState();
    s.materie = [{ id: 'm1', nome: 'Analisi 1', examDate: null, cfu: 12, sfide: [{ id: 'n1', nome: 'Limiti', status: 'PENDING', oreStimate: 4, fonti: [] }], examPassed: false }];
    const next = reducer(s, {
      type: 'FOCUS_COMPLETED',
      payload: { materiaId: 'm1', sfidaId: 'n1', focusMinutes: 50, workMode: 'STUDIO', tecnica: 'FEYNMAN', tecnicaConsigliata: 'ESEMPI_SVOLTI', capacityHours: 4.5 }
    });
    const n1 = next.materie[0].sfide.find((x) => x.id === 'n1');
    assert.equal(n1.tecniche.length, 1);
    assert.equal(n1.tecniche[0].tecnica, 'FEYNMAN');
    assert.equal(n1.tecniche[0].minuti, 50);
    const sess = next.starLog.filter((e) => e.type === 'FOCUS_SESSION').pop();
    assert.equal(sess.tecnica, 'FEYNMAN');
    assert.equal(sess.tecnicaConsigliata, 'ESEMPI_SVOLTI');
    const ricaricato = hydrateState(JSON.parse(JSON.stringify(next)));
    assert.equal(ricaricato.materie[0].sfide.find((x) => x.id === 'n1').tecniche[0].tecnica, 'FEYNMAN');
    // Una tecnica inventata non entra.
    const altro = reducer(s, { type: 'FOCUS_COMPLETED', payload: { materiaId: 'm1', sfidaId: 'n1', focusMinutes: 25, workMode: 'STUDIO', tecnica: 'MAGIA' } });
    assert.equal((altro.materie[0].sfide[0].tecniche || []).length, 0);
  });

  test('la Readiness arriva al reducer e cambia il costo di Stamina', async () => {
    const { reducer } = await import('../state/reducer.js');
    const { createDefaultState } = await import('../data/defaultSchema.js');
    const base = createDefaultState();
    const costo = (readinessScore) => {
      const out = reducer(base, { type: 'FOCUS_COMPLETED', payload: { focusMinutes: 120, capacityHours: 1.2, readinessScore } });
      return base.profile.stamina - out.profile.stamina;
    };
    assert.ok(costo(null) <= 40, `costo neutro ${costo(null)}`);
    assert.ok(costo(95) < costo(null));
    assert.ok(costo(20) > costo(null));
  });
});
