// =====================================================================
// ArachnoForge — src/hooks/useKarenAutoRouter.test.js
// Test unitari (node:test built-in) per le funzioni pure del Quantum
// Router — non per l'hook React stesso (richiederebbe un renderer),
// ma per la logica di ranking/selezione che governa "IN FOCUS OGGI".
//
// V42 — dietro l'hook c'è il piano globale (utils/studyPlanner.js via
// quotaEngine.computeDailyPlan): la selezione delle materie di oggi e il
// riparto delle ore si verificano sul piano vero. Il giorno è fissato.
// =====================================================================
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { compareByUrgency, computeDailyPlan, CRITICAL_DISTANCE_DAYS, MAX_DAILY_FOCUS_MATERIE, QUOTA_STATUS } from './useKarenAutoRouter.js';
import { addDaysToDateOnly } from '../utils/dateUtils.js';

const OGGI = '2026-10-05';
const fra = (days) => addDaysToDateOnly(OGGI, days);
const CAL = { hoursPerDay: 4.5, biasFactor: 1 };

let seq = 0;
function nodo(oreStimate, over = {}) {
  seq += 1;
  return { id: `n${seq}`, nome: `Nodo ${seq}`, status: 'PENDING', oreStimate, focusMinutes: 0, fonti: [], ...over };
}
function mkMateria(overrides = {}) {
  seq += 1;
  return { id: `m${seq}`, nome: `Materia ${seq}`, examDate: null, cfu: 6, courseId: null, perceivedDifficulty: 3, examPassed: false, sfide: [], ...overrides };
}
const piano = (materie, calibration = CAL) => computeDailyPlan(materie, { calibration, todayKey: OGGI });

describe('compareByUrgency — V35.4 fix per la disparità esame vicino vs lontano', () => {
  const q = (materiaId, daysRemaining, status) => ({ materiaId, daysRemaining, status, haLavoro: true, frozen: false });

  test('una materia entro CRITICAL_DISTANCE_DAYS scavalca SEMPRE una materia lontana, anche se questa è CRITICO e la vicina è OTTIMALE', () => {
    // Scenario esatto segnalato dall'utente: Analisi 1 fra 6gg (ma "in pari",
    // quindi status OTTIMALE) contro Calcolo Numerico fra 111gg ma indietro
    // di passo (status CRITICO, tanto lavoro ancora da fare).
    const sorted = [q('calcolo', 111, QUOTA_STATUS.CRITICO), q('analisi1', 6, QUOTA_STATUS.OTTIMALE)].sort(compareByUrgency);
    assert.equal(sorted[0].materiaId, 'analisi1');
  });

  test('fra due materie entrambe entro la soglia critica, vince la più vicina indipendentemente dallo status', () => {
    const sorted = [q('a', 8, QUOTA_STATUS.OTTIMALE), q('b', 3, QUOTA_STATUS.CRITICO)].sort(compareByUrgency);
    assert.equal(sorted[0].materiaId, 'b');
  });

  test("oltre la soglia critica per entrambe, l'ordinamento resta status-first come da comportamento originale", () => {
    const sorted = [q('in-pari', 40, QUOTA_STATUS.OTTIMALE), q('indietro', 87, QUOTA_STATUS.CRITICO)].sort(compareByUrgency);
    assert.equal(sorted[0].materiaId, 'indietro');
  });

  test('V42: prima le materie con una scadenza, poi quelle senza data, poi quelle senza lavoro, infine le congelate', () => {
    const sorted = [
      { ...q('congelata', 5, QUOTA_STATUS.CONGELATA), frozen: true },
      { ...q('finita', 20, QUOTA_STATUS.OTTIMALE), haLavoro: false },
      q('senza-data', null, QUOTA_STATUS.ATTENZIONE),
      q('con-data', 60, QUOTA_STATUS.OTTIMALE)
    ].sort(compareByUrgency);
    assert.deepEqual(sorted.map((x) => x.materiaId), ['con-data', 'senza-data', 'finita', 'congelata']);
  });
});

describe('le materie di oggi — il monotask si aggancia all’esame davvero più vicino', () => {
  test("esame fra 6 giorni: la giornata è sua, anche con altre due materie critiche più lontane", () => {
    const analisi = mkMateria({ examDate: fra(6), sfide: [nodo(20)] });
    const calcolo = mkMateria({ examDate: fra(111), sfide: [nodo(400)] });
    const fisica = mkMateria({ examDate: fra(87), sfide: [nodo(400)] });
    const plan = piano([calcolo, analisi, fisica]);
    assert.equal(plan.monotaskActive, true);
    assert.equal(plan.dailyFocusQuotas[0].materiaId, analisi.id);
    assert.ok(plan.byMateriaId.get(analisi.id).todayTargetHours >= 0.8 * plan.today.studyTargetHours);
  });

  test('senza esami entro la soglia critica: niente monotask e al massimo due materie', () => {
    const materie = [mkMateria({ examDate: fra(40), sfide: [nodo(30)] }), mkMateria({ examDate: fra(60), sfide: [nodo(30)] }), mkMateria({ examDate: fra(80), sfide: [nodo(30)] })];
    const plan = piano(materie);
    assert.equal(plan.monotaskActive, false);
    assert.ok(plan.dailyFocusQuotas.length <= MAX_DAILY_FOCUS_MATERIE);
    assert.ok(!plan.dailyFocusIds.has(materie[2].id), 'la terza materia aspetta');
  });

  test('una materia congelata (propedeuticità non superata) non entra nel piano di oggi', () => {
    // Meccanica del Volo richiede Aerodinamica, con l'appello DOPO: congelata.
    const aerodinamica = mkMateria({ nome: 'Aerodinamica', courseId: 'aerodinamica', examDate: fra(40), sfide: [nodo(10)] });
    const volo = mkMateria({ nome: 'Meccanica del Volo', courseId: 'meccanicaVolo', examDate: fra(5), sfide: [nodo(10)] });
    const plan = piano([aerodinamica, volo]);
    const qVolo = plan.byMateriaId.get(volo.id);
    assert.equal(qVolo.frozen, true);
    assert.equal(qVolo.status, QUOTA_STATUS.CONGELATA);
    assert.ok(!plan.dailyFocusIds.has(volo.id));
    assert.equal(plan.monotaskActive, false, 'una materia congelata non forza il monotask su se stessa');
    // V42 — propedeuticità condizionale: con l'appello di Aerodinamica PRIMA
    // di quello di Meccanica del Volo, niente congelamento.
    const prima = mkMateria({ nome: 'Aerodinamica', courseId: 'aerodinamica', examDate: fra(3), sfide: [nodo(10)] });
    const dopo = mkMateria({ nome: 'Meccanica del Volo', courseId: 'meccanicaVolo', examDate: fra(30), sfide: [nodo(10)] });
    assert.equal(piano([prima, dopo]).byMateriaId.get(dopo.id).frozen, false);
  });

  test(`la soglia critica è di ${CRITICAL_DISTANCE_DAYS} giorni`, () => {
    const dentro = piano([mkMateria({ examDate: fra(CRITICAL_DISTANCE_DAYS), sfide: [nodo(30)] }), mkMateria({ examDate: fra(60), sfide: [nodo(30)] })]);
    assert.equal(dentro.monotaskActive, true);
  });
});

describe('il budget della giornata (V36 "Budget Giornaliero Globale", V42 sul piano globale)', () => {
  // Il difetto che la V36 chiudeva: due materie in focus mostravano due
  // "Oggi: Xh" calcolati in isolamento, la cui somma poteva superare
  // qualunque giornata reale. Ora le ore di oggi sono UNA ripartizione.
  test('le ore di oggi non superano mai la capacità, e il deficit viene dichiarato', () => {
    const plan = piano([mkMateria({ examDate: fra(3), sfide: [nodo(40)] }), mkMateria({ examDate: fra(4), sfide: [nodo(40)] })]);
    const somma = plan.dailyFocusQuotas.reduce((a, q) => a + q.assignedHours, 0);
    assert.ok(somma <= plan.today.capacityHours + 1e-6);
    assert.equal(plan.budget.overCapacity, true);
    assert.ok(plan.budget.deficitHours > 0);
  });

  test('quando il tempo basta, ognuna riceve ciò che le serve e il resto è anticipo sulla scadenza più vicina', () => {
    const a = mkMateria({ examDate: fra(30), sfide: [nodo(4)] });
    const b = mkMateria({ examDate: fra(35), sfide: [nodo(4)] });
    const plan = piano([a, b]);
    assert.equal(plan.budget.overCapacity, false);
    assert.equal(plan.budget.deficitHours, 0);
    assert.ok(Math.abs(plan.budget.targetHours - plan.today.capacityHours) < 0.02, 'la giornata si riempie');
  });

  test('una materia senza data non ha un bisogno proprio: riceve solo l’avanzo', () => {
    const esame = mkMateria({ examDate: fra(20), sfide: [nodo(1)] });
    const senzaData = mkMateria({ sfide: [nodo(20)] });
    const plan = piano([esame, senzaData]);
    const qs = plan.byMateriaId.get(senzaData.id);
    assert.equal(qs.todayMinHours, 0);
    assert.ok(qs.todayTargetHours > 0);
    const pieno = piano([mkMateria({ examDate: fra(3), sfide: [nodo(40)] }), senzaData]);
    assert.equal(pieno.byMateriaId.get(senzaData.id).todayTargetHours, 0, 'se il tempo non basta, niente per la materia senza data');
  });

  test('nessuna materia: nessun deficit, nessuna divisione per zero', () => {
    const plan = piano([]);
    assert.equal(plan.budget.deficitHours, 0);
    assert.equal(plan.dailyFocusQuotas.length, 0);
  });

  test('una capacità non valida non produce NaN', () => {
    const plan = piano([mkMateria({ examDate: fra(10), sfide: [nodo(10)] })], { hoursPerDay: NaN, biasFactor: NaN });
    assert.ok(Number.isFinite(plan.budget.budgetHours));
    assert.ok(Number.isFinite(plan.budget.targetHours));
    plan.quotas.forEach((q) => assert.ok(Number.isFinite(q.todayTargetHours)));
  });
});
