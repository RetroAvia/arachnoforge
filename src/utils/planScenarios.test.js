// =====================================================================
// ArachnoForge — src/utils/planScenarios.test.js (V42)
// "E se…?": gli scenari del piano della sessione, ricalcolati sul piano
// vero. Il giorno è fissato: il 5 ottobre 2026.
// =====================================================================
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computePlanScenarios, planPressure } from './planScenarios.js';
import { computeDailyPlan } from './quotaEngine.js';
import { withPlanningDates, syncAppelli } from './appelli.js';
import { addDaysToDateOnly } from './dateUtils.js';

const OGGI = '2026-10-05';
const fra = (n) => addDaysToDateOnly(OGGI, n);
const INPUTS = { calibration: { hoursPerDay: 4.5, biasFactor: 1 }, todayKey: OGGI };

let seq = 0;
function materia({ ore = 20, appelli = [], ...over } = {}) {
  seq += 1;
  const m = {
    id: `m${seq}`,
    nome: `Materia ${seq}`,
    cfu: 6,
    examPassed: false,
    courseId: null,
    formatoEsame: 'SOLO_SCRITTO',
    appelli: appelli.map((d, i) => ({ id: `a${seq}_${i}`, scritto: d, orale: null })),
    sfide: [{ id: `n${seq}`, nome: 'Argomento', status: 'PENDING', oreStimate: ore, focusMinutes: 0, fonti: [] }],
    ...over
  };
  return syncAppelli(m, OGGI);
}

function scenari(materie) {
  const piano = withPlanningDates(materie, OGGI);
  const base = computeDailyPlan(piano, { ...INPUTS, timelineDays: 0 });
  return { base, list: computePlanScenarios(piano, INPUTS, base, { todayKey: OGGI }) };
}

describe('planPressure', () => {
  test('ore scoperte e materie critiche, escluse le congelate e quelle senza data', () => {
    const p = planPressure({
      quotas: [
        { status: 'CRITICO', lateHours: 10, daysRemaining: 5, frozen: false },
        { status: 'CRITICO', lateHours: 7, daysRemaining: 9, frozen: true },
        { status: 'ATTENZIONE', lateHours: 0.26, daysRemaining: null, frozen: false },
        { status: 'OTTIMALE', lateHours: 0, daysRemaining: 30, frozen: false }
      ],
      today: { deficitHours: 2 }
    });
    assert.deepEqual(p, { lateHours: 10, critiche: 1, deficitHours: 2 });
    assert.deepEqual(planPressure(null), { lateHours: 0, critiche: 0, deficitHours: 0 });
  });
});

describe('computePlanScenarios', () => {
  test('un piano che sta nei tempi non propone scenari', () => {
    const { list } = scenari([materia({ ore: 10, appelli: [fra(40)] })]);
    assert.deepEqual(list, []);
  });

  test('una materia in ritardo con un appello successivo: spostarla alleggerisce il piano', () => {
    const pesante = materia({ ore: 80, appelli: [fra(8), fra(40)] });
    const { base, list } = scenari([pesante]);
    assert.equal(base.byMateriaId.get(pesante.id).status, 'CRITICO');
    const sposta = list.find((s) => s.kind === 'SPOSTA');
    assert.ok(sposta, 'manca lo scenario "appello successivo"');
    assert.equal(sposta.materiaId, pesante.id);
    assert.deepEqual(sposta.applica, { materiaId: pesante.id, appelloTargetId: pesante.appelli[1].id, data: fra(40) });
    assert.ok(sposta.dopo.lateHours < sposta.prima.lateHours);
    assert.equal(sposta.dopo.critiche, 0);
  });

  test('senza un appello successivo resta la scelta di toglierla dalla sessione', () => {
    const pesante = materia({ ore: 80, appelli: [fra(8)] });
    const altra = materia({ ore: 30, appelli: [fra(12)] });
    const { list } = scenari([pesante, altra]);
    assert.ok(!list.some((s) => s.kind === 'SPOSTA' && s.materiaId === pesante.id));
    const rinuncia = list.find((s) => s.kind === 'RINUNCIA' && s.materiaId === pesante.id);
    assert.ok(rinuncia);
    assert.ok(rinuncia.dopo.critiche < rinuncia.prima.critiche || rinuncia.dopo.lateHours < rinuncia.prima.lateHours);
    assert.equal(rinuncia.applica, undefined, 'togliere una materia si decide a mano, non con un click');
  });

  test('un’ora in più al giorno: mai peggio di adesso, e il testo dice da quante a quante ore', () => {
    const { list } = scenari([materia({ ore: 60, appelli: [fra(10)] })]);
    const ora = list.find((s) => s.kind === 'ORA_IN_PIU');
    assert.ok(ora);
    assert.ok(ora.dopo.lateHours <= ora.prima.lateHours);
    assert.match(ora.dettaglio, /Da 4\.5 a 5\.5 ore al giorno/);
  });

  test('al massimo tre materie critiche entrano negli scenari, dalla più vicina', () => {
    const critiche = [6, 7, 8, 9].map((g) => materia({ ore: 60, appelli: [fra(g)] }));
    const { list } = scenari(critiche);
    const materieNegliScenari = new Set(list.filter((s) => s.materiaId).map((s) => s.materiaId));
    assert.ok(materieNegliScenari.size <= 3);
    assert.ok(materieNegliScenari.has(critiche[0].id));
  });

  test('input mancanti: nessuno scenario, nessun errore', () => {
    assert.deepEqual(computePlanScenarios(null, INPUTS, {}), []);
    assert.deepEqual(computePlanScenarios([], null, {}), []);
    assert.deepEqual(computePlanScenarios([], INPUTS, null), []);
  });
});
