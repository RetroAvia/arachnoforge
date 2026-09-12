// =====================================================================
// ArachnoForge — src/hooks/useKarenAutoRouter.test.js
// Test unitari (node:test built-in) per le funzioni pure del Quantum
// Router — non per l'hook React stesso (richiederebbe un renderer),
// ma per la logica di ranking/selezione che governa "IN FOCUS OGGI".
// =====================================================================
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeMateriaQuota, compareByUrgency, selectDailyFocus, CRITICAL_DISTANCE_DAYS, QUOTA_STATUS } from './useKarenAutoRouter.js';

function isoInDays(days) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function mkMateria(overrides = {}) {
  return { id: 'm1', nome: 'Materia', examDate: null, cfu: 6, courseId: null, perceivedDifficulty: 3, examPassed: false, sfide: [], ...overrides };
}

describe('compareByUrgency — V35.4 fix per la disparità esame vicino vs lontano', () => {
  test('una materia entro CRITICAL_DISTANCE_DAYS scavalca SEMPRE una materia lontana, anche se questa è CRITICO e la vicina è OTTIMALE', () => {
    // Scenario esatto segnalato dall'utente: Analisi 1 fra 6gg (ma "in pari",
    // quindi status OTTIMALE) contro Calcolo Numerico fra 111gg ma indietro
    // di passo (status CRITICO, tanto lavoro ancora da fare).
    const vicina = { materiaId: 'analisi1', daysRemaining: 6, status: QUOTA_STATUS.OTTIMALE, dailyQuotaHours: 1.5, frozen: false };
    const lontana = { materiaId: 'calcolo', daysRemaining: 111, status: QUOTA_STATUS.CRITICO, dailyQuotaHours: 2, frozen: false };
    const sorted = [lontana, vicina].sort(compareByUrgency);
    assert.equal(sorted[0].materiaId, 'analisi1');
  });

  test('fra due materie entrambe entro la soglia critica, vince la più vicina indipendentemente dallo status', () => {
    const a = { materiaId: 'a', daysRemaining: 8, status: QUOTA_STATUS.OTTIMALE, dailyQuotaHours: 1, frozen: false };
    const b = { materiaId: 'b', daysRemaining: 3, status: QUOTA_STATUS.CRITICO, dailyQuotaHours: 3, frozen: false };
    const sorted = [a, b].sort(compareByUrgency);
    assert.equal(sorted[0].materiaId, 'b');
  });

  test('oltre la soglia critica per entrambe, l\'ordinamento resta status-first come da comportamento originale', () => {
    const inPari = { materiaId: 'in-pari', daysRemaining: 40, status: QUOTA_STATUS.OTTIMALE, dailyQuotaHours: 1, frozen: false };
    const indietro = { materiaId: 'indietro', daysRemaining: 87, status: QUOTA_STATUS.CRITICO, dailyQuotaHours: 2, frozen: false };
    const sorted = [inPari, indietro].sort(compareByUrgency);
    // Nessuna delle due è "imminente" (> CRITICAL_DISTANCE_DAYS): lo status vince ancora.
    assert.equal(sorted[0].materiaId, 'indietro');
  });
});

describe('selectDailyFocus — V35.4: il monotask ora si aggancia SEMPRE all\'esame realmente più vicino', () => {
  test('scenario riportato dall\'utente: esame fra 6gg forza il monotask anche con altre 2 materie CRITICO più lontane', () => {
    const quotas = [
      { materiaId: 'calcolo', daysRemaining: 111, status: QUOTA_STATUS.CRITICO, dailyQuotaHours: 2, frozen: false },
      { materiaId: 'analisi1', daysRemaining: 6, status: QUOTA_STATUS.OTTIMALE, dailyQuotaHours: 1.5, frozen: false },
      { materiaId: 'fisica', daysRemaining: 87, status: QUOTA_STATUS.CRITICO, dailyQuotaHours: 1.8, frozen: false }
    ].sort(compareByUrgency);

    const { focusIds, monotaskActive } = selectDailyFocus(quotas);
    assert.equal(monotaskActive, true);
    assert.equal(focusIds.size, 1);
    assert.equal(focusIds.has('analisi1'), true);
    // Le due materie lontane NON devono più comparire fra quelle spinte oggi.
    assert.equal(focusIds.has('calcolo'), false);
    assert.equal(focusIds.has('fisica'), false);
  });

  test('senza alcun esame entro la soglia critica, il vecchio comportamento (max 2, status-first) resta invariato', () => {
    const quotas = [
      { materiaId: 'a', daysRemaining: 40, status: QUOTA_STATUS.CRITICO, dailyQuotaHours: 2, frozen: false },
      { materiaId: 'b', daysRemaining: 60, status: QUOTA_STATUS.ATTENZIONE, dailyQuotaHours: 1.5, frozen: false },
      { materiaId: 'c', daysRemaining: 20, status: QUOTA_STATUS.OTTIMALE, dailyQuotaHours: 1, frozen: false }
    ].sort(compareByUrgency);
    const { focusIds, monotaskActive } = selectDailyFocus(quotas);
    assert.equal(monotaskActive, false);
    assert.equal(focusIds.size, 2);
    assert.equal(focusIds.has('a'), true);
    assert.equal(focusIds.has('b'), true);
  });

  test('una materia congelata entro la soglia critica non forza il monotask su se stessa (resta esclusa dagli eligible)', () => {
    const quotas = [
      { materiaId: 'congelata', daysRemaining: 5, status: QUOTA_STATUS.CONGELATA, dailyQuotaHours: 2, frozen: true },
      { materiaId: 'lontana', daysRemaining: 50, status: QUOTA_STATUS.ATTENZIONE, dailyQuotaHours: 1, frozen: false }
    ].sort(compareByUrgency);
    const { focusIds, monotaskActive } = selectDailyFocus(quotas);
    assert.equal(focusIds.has('congelata'), false);
    assert.equal(monotaskActive, false);
    assert.equal(focusIds.has('lontana'), true);
  });
});

describe('computeMateriaQuota — invarianti di base (nessuna modifica alla matematica, solo al ranking)', () => {
  test('materia senza nodi e senza data esame: dailyQuotaHours null, status ATTENZIONE', () => {
    const q = computeMateriaQuota(mkMateria({ cfu: 9, sfide: [] }), []);
    assert.equal(q.dailyQuotaHours, null);
    assert.equal(q.status, QUOTA_STATUS.ATTENZIONE);
  });

  test('materia con esame imminente (entro CRITICAL_DISTANCE_DAYS) resta calcolabile come prima — il fix riguarda solo l\'ordinamento', () => {
    const q = computeMateriaQuota(mkMateria({ cfu: 6, examDate: isoInDays(CRITICAL_DISTANCE_DAYS - 2) }), []);
    assert.equal(q.daysRemaining, CRITICAL_DISTANCE_DAYS - 2);
    assert.ok(q.dailyQuotaHours > 0);
  });
});
