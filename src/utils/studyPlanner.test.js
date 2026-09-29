// =====================================================================
// ArachnoForge — src/utils/studyPlanner.test.js (V42)
// Il piano di studio globale: minimo di oggi (ALAP), fine prevista e
// ritardi (EDF), ripasso finale, ripassi del giorno, capacità vera.
// Ogni test fissa il giorno: il 5 ottobre 2026 è un lunedì.
// =====================================================================
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeStudyPlan,
  materiaWorkNow,
  finalReviewJobs,
  reviewsToday,
  timelineDayTotals,
  PLAN_STATUS,
  LATE_TOLERANCE_HOURS,
  REVIEW_SHARE_MAX
} from './studyPlanner.js';
import { addDaysToDateOnly, isoWeekdayOfDateKey } from './dateUtils.js';

const OGGI = '2026-10-05';
const fra = (n) => addDaysToDateOnly(OGGI, n);
const CAL = { hoursPerDay: 4.5, biasFactor: 1 };

let seq = 0;
function nodo(over = {}) {
  seq += 1;
  return { id: `n${seq}`, nome: `Nodo ${seq}`, status: 'PENDING', oreStimate: 2, focusMinutes: 0, fonti: [], ...over };
}
function materia(over = {}) {
  seq += 1;
  return { id: `m${seq}`, nome: `Materia ${seq}`, cfu: 6, examDate: null, examPassed: false, courseId: null, sfide: [], ...over };
}
const piano = (materie, extra = {}) => computeStudyPlan(materie, { calibration: CAL, todayKey: OGGI, ...extra });
const di = (plan, m) => plan.byMateriaId.get(m.id);

describe('il lavoro di una materia', () => {
  test('senza argomenti: la stima dai CFU, meno lo studio già fatto sulla materia', () => {
    const w = materiaWorkNow({ cfu: 6, focusMinutesLibere: 120, sfide: [] }, CAL);
    assert.equal(w.studio, 6 * 15 - 2);
    assert.equal(w.stimaDaCfu, true);
  });

  test('esame superato: niente lavoro', () => {
    const w = materiaWorkNow({ examPassed: true, sfide: [nodo({ oreStimate: 50 })] }, CAL);
    assert.equal(w.sintesi + w.studio, 0);
  });

  test('con argomenti: la somma dei residui degli argomenti aperti', () => {
    const w = materiaWorkNow({ sfide: [nodo({ oreStimate: 3 }), nodo({ oreStimate: 5 }), nodo({ oreStimate: 9, status: 'COMPLETED' })] }, CAL);
    assert.equal(w.studio, 8);
    assert.equal(w.apertiIds.length, 2);
  });
});

describe('il minimo di oggi (ALAP)', () => {
  test('quello che non ci sta da domani all’esame va fatto oggi; oltre la giornata, deficit dichiarato', () => {
    // 30 ore, esame fra 5 giorni: domani-vigilia sono 4 giorni da 4,5 ore.
    const m = materia({ examDate: fra(5), sfide: [nodo({ oreStimate: 30 })] });
    const p = piano([m]);
    const q = di(p, m);
    assert.equal(q.todayTargetHours, 4.5);
    assert.equal(q.todayMinHours, 4.5, 'il minimo mostrato è quanto oggi ci sta davvero');
    assert.ok(q.todayMinOverflowHours > 7, 'e l’eccesso a parte');
    assert.equal(p.today.overCapacity, true);
    assert.ok(p.today.deficitHours > 7);
    assert.equal(q.status, PLAN_STATUS.CRITICO);
    assert.ok(q.lateHours > 7);
  });

  test('con tempo in avanzo il minimo è zero e "inizia entro" dice l’ultimo giorno utile per lo studio', () => {
    const m = materia({ examDate: fra(60), sfide: [nodo({ oreStimate: 10 })] });
    const q = di(piano([m]), m);
    assert.equal(q.todayMinHours, 0);
    // 10 ore messe il più tardi possibile: vigilia, due giorni prima, tre giorni prima.
    assert.equal(q.inizioEntroDateKey, fra(57));
    assert.ok(q.todayTargetHours > 0, 'ma oggi si anticipa comunque');
  });

  test('la chiusura degli appunti cade il giorno prima dello studio che ne dipende', () => {
    // 60 pagine di fonte (5 ore di sintesi al ritmo di default) e 10 ore di
    // studio, esame fra 60 giorni: lo studio occupa gli ultimi giorni utili
    // (dal 57° alla vigilia), la sintesi va prima e si parte da lei.
    const m = materia({ examDate: fra(60), sfide: [nodo({ oreStimate: 10, fonti: [{ id: 'f', tipo: 'ALTRO', pagine: 60, pagineFatte: 0 }] })] });
    const q = di(piano([m]), m);
    assert.equal(q.chiusuraAppuntiDateKey, fra(56));
    assert.equal(q.inizioEntroDateKey, fra(56), 'si parte dalla sintesi');
    assert.ok(q.chiusuraAppuntiDateKey < m.examDate);
  });
});

describe('fine prevista e ritardi (EDF)', () => {
  test('mai lavoro dopo l’esame: il non fatto è ritardo, e la fine si stima oltre la data', () => {
    const m = materia({ examDate: fra(6), sfide: [nodo({ oreStimate: 60 })] });
    const p = piano([m], { timelineDays: 40 });
    const giorni = p.timeline.filter((g) => g.items.some((i) => i.materiaId === m.id)).map((g) => g.dateKey);
    assert.ok(giorni.length > 0);
    assert.ok(giorni.every((d) => d < m.examDate), `lavoro programmato dopo l’esame: ${giorni}`);
    const q = di(p, m);
    assert.ok(q.lateHours > 30);
    assert.equal(q.finePrevistaStimata, true);
    assert.ok(q.finePrevistaDateKey > m.examDate);
  });

  test(`un avanzo sotto la tolleranza (${LATE_TOLERANCE_HOURS} h) non è un esame fuori tempo`, () => {
    // 9,1 ore con esame fra 2 giorni (oggi + domani = 9 ore): 6 minuti scoperti.
    const quasi = materia({ examDate: fra(2), sfide: [nodo({ oreStimate: 9.1 })] });
    const q = di(piano([quasi]), quasi);
    assert.ok(q.lateHours > 0 && q.lateHours <= LATE_TOLERANCE_HOURS);
    assert.notEqual(q.status, PLAN_STATUS.CRITICO);
    const davvero = materia({ examDate: fra(2), sfide: [nodo({ oreStimate: 10 })] });
    assert.equal(di(piano([davvero]), davvero).status, PLAN_STATUS.CRITICO);
  });

  test('schiacciata dalle altre ma in tempo: "al limite", non critica', () => {
    const tre = [1, 2, 3].map(() => materia({ examDate: fra(14), sfide: [nodo({ oreStimate: 55 })] }));
    const p = piano(tre);
    const salve = tre.map((m) => di(p, m)).filter((q) => q.lateHours === 0);
    assert.equal(salve.length, 1);
    assert.equal(salve[0].status, PLAN_STATUS.ATTENZIONE);
    assert.equal(salve[0].pressioneDaAltri, true);
  });

  test('il parallelo lontano dagli esami non manda in ritardo la scadenza più vicina', () => {
    const a = materia({ examDate: fra(40), sfide: [nodo({ oreStimate: 150 })] });
    const b = materia({ examDate: fra(50), sfide: [nodo({ oreStimate: 150 })] });
    const p = piano([a, b]);
    assert.equal(di(p, a).lateHours, 0);
    assert.equal(di(p, a).status, PLAN_STATUS.OTTIMALE);
    assert.equal(di(p, b).status, PLAN_STATUS.CRITICO);
  });

  test('l’esame domani: il ritardo si misura già a fine giornata', () => {
    const m = materia({ examDate: fra(1), sfide: [nodo({ oreStimate: 8 })] });
    const q = di(piano([m]), m);
    assert.equal(q.todayTargetHours, 4.5);
    assert.ok(q.lateHours > 3);
  });

  test('V42: il ritardo del piano è UN numero, la somma delle ore scoperte delle materie attive', () => {
    const a = materia({ examDate: fra(6), sfide: [nodo({ oreStimate: 40 })] });
    const b = materia({ examDate: fra(12), sfide: [nodo({ oreStimate: 45 })] });
    // Meccanica del Volo senza Aerodinamica: congelata dalle propedeuticità.
    const ferma = materia({ examDate: fra(8), courseId: 'meccanicaVolo', sfide: [nodo({ oreStimate: 80 })] });
    const senzaData = materia({ sfide: [nodo({ oreStimate: 30 })] });
    const p = piano([a, b, ferma, senzaData]);
    assert.equal(di(p, ferma).frozen, true);
    const attese = [a, b].reduce((sum, m) => sum + di(p, m).lateHours, 0);
    assert.ok(attese > 5, 'lo scenario deve essere in ritardo');
    assert.equal(p.today.lateHours, Math.round(attese * 100) / 100);
    assert.equal(p.today.criticalCount, [a, b].filter((m) => di(p, m).status === PLAN_STATUS.CRITICO).length);
    const tranquillo = piano([materia({ examDate: fra(30), sfide: [nodo({ oreStimate: 10 })] })]);
    assert.equal(tranquillo.today.lateHours, 0);
    assert.equal(tranquillo.today.criticalCount, 0);
  });
});

describe('il ripasso finale', () => {
  test('un passaggio per argomento in ogni finestra non ancora chiusa', () => {
    const m = materia({ examDate: fra(12), sfide: [nodo({ status: 'COMPLETED' }), nodo({ status: 'COMPLETED' })] });
    const jobs = finalReviewJobs(m, m.examDate, OGGI, 15);
    // Esame fra 12 giorni: la finestra da 21 a 15 giorni prima è già passata.
    assert.deepEqual(jobs.map((j) => [j.startKey, j.endKey, j.hours, j.argomenti]), [
      [fra(2), fra(6), 0.5, 2],
      [fra(8), fra(11), 0.5, 2]
    ]);
  });

  test('un argomento il cui ripasso cade già nella finestra (o è stato fatto dentro) non si conta due volte', () => {
    const m = materia({
      examDate: fra(12),
      sfide: [
        // Ripasso già in calendario dentro la finestra da 10 a 6 giorni prima.
        nodo({ status: 'COMPLETED', nextReviewDate: fra(4) }),
        nodo({ status: 'COMPLETED' }),
        nodo({ status: 'COMPLETED' })
      ]
    });
    const [w2, w3] = finalReviewJobs(m, m.examDate, OGGI, 15);
    assert.equal(w2.argomenti, 2);
    assert.equal(w3.argomenti, 3);
    // Dentro l'ultima finestra: chi è già stato ripassato lì non si conta più
    // (dopo il ripasso la sua prossima data esce dalla finestra).
    const dopo = { ...m, sfide: m.sfide.map((s, i) => (i === 1 ? { ...s, lastReviewedAt: `${fra(9)}T10:00:00.000Z`, nextReviewDate: fra(20) } : s)) };
    const [ultima] = finalReviewJobs(dopo, m.examDate, fra(9), 15);
    assert.equal(ultima.startKey, fra(9), 'la finestra, già aperta, parte da oggi');
    assert.equal(ultima.argomenti, 2);
  });

  test('i passaggi finali entrano nel calendario solo dentro la loro finestra, mai oggi se la finestra non è aperta', () => {
    const m = materia({ examDate: fra(12), sfide: [nodo({ status: 'COMPLETED' }), nodo({ status: 'COMPLETED' })] });
    const p = piano([m], { timelineDays: 20 });
    assert.equal(di(p, m).todayFinalReviewHours, 0);
    const conF = p.timeline.filter((g) => g.items.some((i) => i.kind === 'F'));
    assert.ok(conF.length >= 2);
    conF.forEach((g) => assert.ok((g.dateKey >= fra(2) && g.dateKey <= fra(6)) || (g.dateKey >= fra(8) && g.dateKey <= fra(11)), g.dateKey));
  });

  test('senza esame o senza argomenti, nessun ripasso finale', () => {
    assert.deepEqual(finalReviewJobs(materia({ sfide: [nodo()] }), null, OGGI, 15), []);
    assert.deepEqual(finalReviewJobs(materia({ examDate: fra(10) }), fra(10), OGGI, 15), []);
  });
});

describe('i ripassi di oggi', () => {
  test('un arretrato di ripassi occupa al massimo metà della giornata: il resto slitta', () => {
    const sfide = Array.from({ length: 20 }, () => nodo({ status: 'COMPLETED', nextReviewDate: fra(-1) }));
    const m = materia({ examDate: fra(30), sfide: [...sfide, nodo({ oreStimate: 40 })] });
    const p = piano([m]);
    assert.equal(p.today.reviews.due, 20);
    assert.equal(p.today.reviews.targetHours, 4.5 * REVIEW_SHARE_MAX);
    assert.equal(p.today.reviews.targetCount, 9);
    assert.equal(p.today.reviews.rinviati, 11);
    assert.equal(p.today.studyTargetHours, 2.25, 'la giornata resta anche per lo studio');
  });

  test('reviewsToday conta i dovuti (scaduti compresi) e quelli già fatti oggi', () => {
    const m = materia({
      sfide: [
        nodo({ status: 'COMPLETED', nextReviewDate: fra(-3) }),
        nodo({ status: 'COMPLETED', nextReviewDate: OGGI }),
        nodo({ status: 'COMPLETED', nextReviewDate: fra(5), lastReviewedAt: `${OGGI}T08:00:00.000Z`, reviewCount: 2 }),
        nodo({ status: 'COMPLETED', nextReviewDate: fra(5) })
      ]
    });
    const r = reviewsToday([m], OGGI, 20);
    assert.equal(r.due, 2);
    assert.equal(r.done, 1);
    assert.equal(r.perMateria.get(m.id).hours, Math.round((2 * 20) / 60 * 100) / 100);
  });
});

describe('la capacità della giornata', () => {
  test('la riduzione di carico di K.A.R.E.N. vale solo oggi, fra -50% e 0', () => {
    const m = materia({ examDate: fra(60), sfide: [nodo({ oreStimate: 10 })] });
    const p = piano([m], { loadAdjustmentPct: -20 });
    assert.equal(p.today.capacityHours, 3.6);
    assert.equal(p.today.baseCapacityHours, 4.5);
    assert.equal(piano([m], { loadAdjustmentPct: -90 }).today.loadAdjustmentPct, -50);
    assert.equal(piano([m], { loadAdjustmentPct: 30 }).today.loadAdjustmentPct, 0);
  });

  test('i giorni di riposo non ricevono lavoro', () => {
    const m = materia({ examDate: fra(40), sfide: [nodo({ oreStimate: 100 })] });
    const p = piano([m], { calibration: { ...CAL, restDays: [7] }, timelineDays: 30 });
    assert.ok(p.timeline.length > 0);
    assert.equal(p.timeline.filter((g) => isoWeekdayOfDateKey(g.dateKey) === 7).length, 0);
  });

  test('"da inizio giornata": quello che fai oggi consuma l’obiettivo, non lo rimpicciolisce', () => {
    const inizio = materia({ id: 'K', examDate: fra(8), sfide: [nodo({ id: 'kn', oreStimate: 30 })] });
    const dopoDueOre = { ...inizio, sfide: [{ ...inizio.sfide[0], focusMinutes: 120, focusMinutesStudio: 120 }] };
    const prima = di(piano([inizio]), inizio);
    const p = piano([dopoDueOre], { doneToday: new Map([['K', { studio: 2 }]]) });
    const dopo = di(p, dopoDueOre);
    assert.equal(dopo.todayTargetHours, prima.todayTargetHours);
    assert.equal(dopo.doneTodayHours, 2);
    assert.equal(dopo.remainingTodayHours, prima.todayTargetHours - 2);
    assert.equal(p.today.remainingHours, p.today.targetHours - 2);
  });
});

describe('materie particolari', () => {
  test('senza argomenti: con la data la stima dai CFU si pianifica, senza data no', () => {
    const conData = materia({ cfu: 9, examDate: fra(60) });
    const senza = materia({ cfu: 9 });
    const p = piano([conData, senza]);
    assert.equal(di(p, conData).haLavoro, true);
    assert.equal(di(p, conData).hoursRemaining, 135);
    assert.equal(di(p, senza).haLavoro, false);
    assert.equal(di(p, senza).todayTargetHours, 0);
  });

  test('una materia superata esce dal piano', () => {
    const fatta = materia({ examPassed: true, examDate: fra(3), sfide: [nodo({ oreStimate: 30 })] });
    assert.equal(piano([fatta]).byMateriaId.has(fatta.id), false);
  });

  test('un piano vuoto è valido, senza NaN', () => {
    const p = piano([]);
    assert.equal(p.subjects.length, 0);
    assert.equal(p.today.targetHours, 0);
    assert.equal(p.today.deficitHours, 0);
  });

  test('timelineDays 0: nessun calendario (i ricalcoli degli scenari restano leggeri)', () => {
    const m = materia({ examDate: fra(30), sfide: [nodo({ oreStimate: 20 })] });
    assert.deepEqual(piano([m], { timelineDays: 0 }).timeline, []);
  });
});

test('timelineDayTotals somma le ore di una giornata per materia e per tipo', () => {
  const tot = timelineDayTotals({ items: [{ materiaId: 'a', kind: 'T', hours: 1 }, { materiaId: 'a', kind: 'T', hours: 0.5 }, { materiaId: 'a', kind: 'F', hours: 0.25 }, { materiaId: 'b', kind: 'S', hours: 2 }] });
  assert.deepEqual(tot.get('a'), { S: 0, T: 1.5, F: 0.25 });
  assert.deepEqual(tot.get('b'), { S: 2, T: 0, F: 0 });
  assert.equal(timelineDayTotals(null).size, 0);
});
