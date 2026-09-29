// =====================================================================
// V39.0 — Test delle correzioni all'algoritmo del piano di studio.
//
// Ogni blocco qui sotto riproduce un difetto trovato dalla revisione
// dell'algoritmo con un input concreto, e fissa il comportamento
// corretto. Se uno di questi test si rompe, un difetto reale è tornato.
//
// V42 — il piano del giorno è il piano GLOBALE (utils/studyPlanner.js,
// dietro la facciata computeDailyPlan): le vecchie funzioni per materia
// (computeMateriaQuota, applyCumulativeLoad, selectDailyFocus) non
// esistono più. Gli stessi difetti si verificano sul piano vero.
// =====================================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import { compareByUrgency, computeDailyPlan, QUOTA_STATUS } from './quotaEngine.js';
import { computeEstimateBias, computePagesPerHour, computeDailyCapacity } from './calibration.js';
import { computeResaSintesi, materiaSintesiPlan, RACCOMANDAZIONE } from './sintesiEngine.js';
import { computeEstimatedCompletion } from './materiaMeta.js';
import { computeExamReadiness } from './examReadiness.js';
import { computePressure } from '../data/vanvitelliCourseMap.js';
import { computeGraduationForecast } from './gpaEngine.js';
import { computePrimaryTarget } from './karenSuggestor.js';
import { addDaysToDateOnly, todayDateOnlyKey } from './dateUtils.js';
import { reducer } from '../state/reducer.js';
import { createDefaultState } from '../data/defaultSchema.js';

const oggi = () => todayDateOnlyKey();
const fra = (n) => addDaysToDateOnly(oggi(), n);
const CAL = { hoursPerDay: 4.5, biasFactor: 1, pagesPerHour: null, sintesiPagesPerHour: 10, resaSintesi: 0.2 };

let seq = 0;
function nodo(over = {}) {
  seq += 1;
  return {
    id: `n${seq}`,
    nome: `Nodo ${seq}`,
    status: 'PENDING',
    oreStimate: 2,
    focusMinutes: 0,
    focusMinutesStudio: 0,
    focusMinutesSintesi: 0,
    fonti: [],
    pagineAppunti: 0,
    appuntiCompleti: false,
    ...over
  };
}
function materia(over = {}) {
  seq += 1;
  return { id: `m${seq}`, nome: `Materia ${seq}`, cfu: 6, examDate: null, examPassed: false, courseId: null, tipoPiano: 'PIANO', sfide: [], ...over };
}

const piano = (materie, extra = {}) => computeDailyPlan(materie, { calibration: CAL, todayKey: oggi(), ...extra });
const quota = (materie, m, extra) => piano(materie, extra).byMateriaId.get(m.id);

/* ------------------------------------------------------------------ */

test('esame passato non verbalizzato: non è un\'emergenza', async (t) => {
  const m = materia({ examDate: fra(-20), sfide: [nodo({ oreStimate: 10 }), nodo({ oreStimate: 10 })] });

  await t.test('niente scadenza, niente ritardo, stato non CRITICO', () => {
    const q = quota([m], m);
    assert.equal(q.dataScaduta, true);
    assert.equal(q.daysRemaining, null);
    assert.equal(q.lateHours, 0, 'prima: tutte le ore residue in un giorno');
    assert.notEqual(q.status, QUOTA_STATUS.CRITICO);
    assert.equal(q.overdue, false);
  });

  await t.test('non forza il monotask né prende il primo slot', () => {
    const b = materia({ examDate: fra(30), sfide: [nodo({ oreStimate: 20 })] });
    const plan = piano([m, b]);
    assert.equal(plan.monotaskActive, false);
    assert.equal(plan.dailyFocusQuotas[0].materiaId, b.id);
  });

  await t.test('la pressione temporale è nulla', () => {
    assert.equal(computePressure(20, fra(-20), 4.5), 0);
    assert.ok(computePressure(20, fra(0), 4.5) > 0, 'l’esame OGGI resta urgente');
  });

  await t.test('Exam Readiness chiede di aggiornare l’appello', () => {
    const r = computeExamReadiness(m, null, CAL);
    assert.equal(r.dataScaduta, true);
    assert.equal(r.verdict, 'UNKNOWN');
    assert.match(r.rationale, /appello/i);
  });
});

test('esame oggi con lavoro aperto resta CRITICO', () => {
  const m = materia({ examDate: fra(0), sfide: [nodo({ oreStimate: 5 })] });
  const q = quota([m], m);
  assert.equal(q.overdue, true);
  assert.equal(q.status, QUOTA_STATUS.CRITICO);
  assert.ok(q.lateHours > 0);
});

test('soglie uniche: stesso rapporto, stesso stato, con o senza nodi', () => {
  // 30 ore in 10 giorni a 4.5h/giorno = rapporto 0.67 -> OTTIMALE in entrambi i casi.
  const conNodi = materia({ examDate: fra(10), sfide: [nodo({ oreStimate: 30 })] });
  const senzaNodi = materia({ examDate: fra(10), cfu: 2 }); // 2 CFU × 15h = 30h
  assert.equal(quota([conNodi], conNodi).status, QUOTA_STATUS.OTTIMALE);
  assert.equal(quota([senzaNodi], senzaNodi).status, QUOTA_STATUS.OTTIMALE);
});

test('carico cumulativo: tre esami che da soli ci stanno, insieme no', () => {
  const tre = [1, 2, 3].map(() => materia({ examDate: fra(14), sfide: [nodo({ oreStimate: 55 })] }));
  tre.forEach((m) => assert.equal(quota([m], m).status, QUOTA_STATUS.OTTIMALE, 'ciascuna da sola ci sta (55h su 63)'));

  const plan = piano(tre);
  const qs = tre.map((m) => plan.byMateriaId.get(m.id));
  qs.forEach((q) => assert.equal(q.cumulativeOverload, true, '165h su 63 disponibili'));
  // V42 — critiche quelle che arrivano all'esame con ore scoperte; quella
  // che il piano porta in tempo è "al limite", schiacciata dalle altre.
  const critiche = qs.filter((q) => q.status === QUOTA_STATUS.CRITICO);
  assert.equal(critiche.length, 2);
  critiche.forEach((q) => assert.ok(q.lateHours > 0));
  const salva = qs.find((q) => q.status !== QUOTA_STATUS.CRITICO);
  assert.equal(salva.status, QUOTA_STATUS.ATTENZIONE);
  assert.equal(salva.pressioneDaAltri, true);
  assert.equal(salva.lateHours, 0);
});

test('carico cumulativo: la materia che viene prima non viene penalizzata da quella dopo', () => {
  const prima = materia({ examDate: fra(10), sfide: [nodo({ oreStimate: 10 })] });
  const dopo = materia({ examDate: fra(20), sfide: [nodo({ oreStimate: 200 })] });
  const plan = piano([prima, dopo]);
  const qPrima = plan.byMateriaId.get(prima.id);
  const qDopo = plan.byMateriaId.get(dopo.id);
  assert.equal(qPrima.cumulativeOverload, false);
  assert.equal(qPrima.status, QUOTA_STATUS.OTTIMALE);
  assert.equal(qDopo.cumulativeOverload, true);
  assert.equal(qDopo.status, QUOTA_STATUS.CRITICO);
});

test('focus: una materia senza data non ruba lo slot a una con scadenza', () => {
  const senzaData = materia({ sfide: [nodo({ oreStimate: 10 })] });
  const y = materia({ examDate: fra(20), sfide: [nodo({ oreStimate: 5 })] });
  const z = materia({ examDate: fra(25), sfide: [nodo({ oreStimate: 5 })] });
  const plan = piano([senzaData, y, z]);
  const ids = plan.dailyFocusQuotas.map((q) => q.materiaId);
  assert.ok(!ids.includes(senzaData.id));
  // V42 — dentro le tre settimane vale la scadenza più vicina: la giornata va a y.
  assert.equal(ids[0], y.id);
});

test('focus: una materia senza data entra solo se avanza posto, e riceve l’avanzo', () => {
  const senzaData = materia({ sfide: [nodo({ oreStimate: 10 })] });
  const y = materia({ examDate: fra(20), sfide: [nodo({ oreStimate: 1 })] });
  const plan = piano([senzaData, y]);
  const qSenza = plan.dailyFocusQuotas.find((q) => q.materiaId === senzaData.id);
  assert.ok(qSenza, 'con l’esame coperto, il tempo che avanza va alla materia senza data');
  assert.ok(qSenza.assignedHours > 0, 'e riceve le ore avanzate invece di 0h');
  const qy = plan.byMateriaId.get(y.id);
  assert.ok(Math.abs(qy.todayTargetHours + qSenza.assignedHours - plan.today.capacityHours) < 0.02, 'la giornata è piena, non oltre');
});

test('focus: una materia già studiata occupa solo il suo ripasso finale, non uno slot di studio', () => {
  const finita = materia({ examDate: fra(3), sfide: [nodo({ status: 'COMPLETED' })] });
  const b = materia({ examDate: fra(8), sfide: [nodo({ oreStimate: 30 })] });
  const plan = piano([finita, b]);
  const qf = plan.byMateriaId.get(finita.id);
  assert.equal(qf.todayStudioHours + qf.todaySintesiHours, 0);
  assert.ok(qf.todayFinalReviewHours > 0 && qf.todayFinalReviewHours <= 0.5, 'un passaggio di ripasso finale, a tre giorni dall’esame');
  assert.ok(plan.byMateriaId.get(b.id).todayStudioHours > 3.5);
  assert.ok(plan.budget.targetHours > 0);
});

test('V40 — le lezioni non rubano più uno slot agli esami', () => {
  const a = materia({ examDate: fra(40), sfide: [nodo({ oreStimate: 150 })] });
  const b = materia({ examDate: fra(50), sfide: [nodo({ oreStimate: 150 })] }); // insieme: CRITICO
  const lezione = materia({ sfide: [nodo({ oreStimate: 5, fonti: [{ id: 'f', tipo: 'ALTRO', pagine: 100, pagineFatte: 0 }] })] });
  const plan = piano([a, b, lezione], { sintesiLezioni: [{ materiaId: lezione.id, ore: 2 }] });
  const ids = plan.dailyFocusQuotas.map((q) => q.materiaId);
  assert.ok(!ids.includes(lezione.id), 'gli slot restano agli esami');
  assert.equal(plan.sintesi.esameARischio, true);
  assert.equal(plan.priorityApplied, null);
});

test('V42 — due esami: il parallelo non manda in ritardo il primo, che da solo ci sta', () => {
  // 150h a 40 giorni + 150h a 50 giorni con 4,5h/giorno: il primo ci sta,
  // il secondo no. Prima il tempo si divideva a metà per 17 giorni e il
  // primo finiva 10 ore in ritardo; ora si lavora per scadenza.
  const a = materia({ examDate: fra(40), sfide: [nodo({ oreStimate: 150 })] });
  const b = materia({ examDate: fra(50), sfide: [nodo({ oreStimate: 150 })] });
  const plan = piano([a, b]);
  const qa = plan.byMateriaId.get(a.id);
  const qb = plan.byMateriaId.get(b.id);
  assert.equal(qa.lateHours, 0);
  assert.equal(qa.status, QUOTA_STATUS.OTTIMALE);
  assert.ok(qa.finePrevistaDateKey < a.examDate);
  assert.equal(qb.status, QUOTA_STATUS.CRITICO);
});

test('V42 — lontano dagli esami e con margine, due materie in parallelo', () => {
  const a = materia({ examDate: fra(60), sfide: [nodo({ oreStimate: 20 })] });
  const b = materia({ examDate: fra(70), sfide: [nodo({ oreStimate: 20 })] });
  const plan = piano([a, b]);
  assert.ok(plan.byMateriaId.get(a.id).todayTargetHours > 0);
  assert.ok(plan.byMateriaId.get(b.id).todayTargetHours > 0);
});

test('V40 — riserva per le lezioni: solo con tempo libero dagli esami, massimo 40%, zero in monotask', () => {
  // V42 — le lezioni si sistemano con la SINTESI della loro materia: la
  // riserva esiste solo per una materia con fonti da snellire.
  const lez = materia({ sfide: [nodo({ oreStimate: 5, fonti: [{ id: 'f', tipo: 'ALTRO', pagine: 100, pagineFatte: 0 }] })] });
  const coda = (ore) => ({ sintesiLezioni: [{ materiaId: lez.id, ore }] });

  const rischio = materia({ examDate: fra(40), sfide: [nodo({ oreStimate: 300 })] }); // 300h in 40gg: CRITICO
  const r1 = piano([rischio, lez], coda(3));
  assert.equal(r1.sintesi.esameARischio, true);
  assert.equal(r1.sintesi.riservateOre, 0, 'un esame a rischio non cede tempo alle lezioni');
  assert.equal(r1.sintesi.prima, false);

  const calmo = materia({ examDate: fra(90), sfide: [nodo({ oreStimate: 5 })] });
  const r2 = piano([calmo, lez], coda(1));
  assert.equal(r2.sintesi.riservateOre, 1, 'serve 1h e c’è spazio');
  assert.equal(r2.sintesi.prima, true);
  assert.equal(r2.budget.overCapacity, false, 'la riserva non crea mai un deficit');
  const r2b = piano([calmo, lez], coda(5));
  assert.equal(r2b.sintesi.riservateOre, 1.8, 'mai oltre il 40% della giornata');

  const soloLezioni = piano([lez], coda(3));
  assert.equal(soloLezioni.sintesi.riservateOre, 1.8);
  assert.ok(soloLezioni.byMateriaId.get(lez.id).todaySintesiHours >= 3, 'senza esami la giornata va comunque alla sintesi');

  const imminente = materia({ examDate: fra(5), sfide: [nodo({ oreStimate: 10 })] });
  const r3 = piano([imminente, lez], coda(1));
  assert.equal(r3.monotaskActive, true);
  assert.equal(r3.sintesi.riservateOre, 0);

  const senzaFonti = materia({ sfide: [nodo({ oreStimate: 5 })] });
  assert.equal(piano([calmo, senzaFonti], { sintesiLezioni: [{ materiaId: senzaFonti.id, ore: 2 }] }).sintesi.riservateOre, 0, 'niente fonti, niente sintesi da riservare');
});

test('V40 — materia senza nodi e senza data: nessuna ora finta nel piano del giorno', () => {
  const vuota = materia({ cfu: 9, sfide: [] });
  const esame = materia({ examDate: fra(60), sfide: [nodo({ oreStimate: 10 })] });
  const plan = piano([vuota, esame]);
  assert.ok(!plan.dailyFocusIds.has(vuota.id), 'la stima dai CFU non è lavoro di oggi');
  // con una data d'esame, invece, la stima dai CFU serve a pianificare
  const conData = materia({ cfu: 9, examDate: fra(60), sfide: [] });
  const p2 = piano([conData]);
  assert.ok(p2.dailyFocusIds.has(conData.id));
});

test('V40 — l’avanzo del budget non supera il lavoro residuo della materia', () => {
  const pochissimo = materia({ sfide: [nodo({ oreStimate: 0.5 })] }); // senza data, 0.5h di lavoro
  const plan = piano([pochissimo]);
  const q = plan.dailyFocusQuotas.find((x) => x.materiaId === pochissimo.id);
  assert.ok(q.assignedHours <= 0.5 + 1e-9, `assegnate ${q.assignedHours}h a una materia con 0.5h di lavoro`);
});

test('ordinamento: una materia senza data non scavalca una con esame vero', () => {
  const senzaData = { materiaId: 'x', daysRemaining: null, status: QUOTA_STATUS.ATTENZIONE, hoursRemaining: 10, haLavoro: true, frozen: false };
  const conData = { materiaId: 'y', daysRemaining: 30, status: QUOTA_STATUS.OTTIMALE, hoursRemaining: 10, haLavoro: true, frozen: false };
  assert.equal([senzaData, conData].sort(compareByUrgency)[0].materiaId, 'y');
  // Il piano vero: la giornata va alla materia con l'esame.
  const x = materia({ sfide: [nodo({ oreStimate: 10 })] });
  const y = materia({ examDate: fra(30), sfide: [nodo({ oreStimate: 10 })] });
  assert.equal(piano([x, y]).dailyFocusQuotas[0].materiaId, y.id);
});

/* ------------------------------------------------------------------ */

test('calibrazione: i nodi chiusi dal verbale non sono campioni', async (t) => {
  await t.test('passando dal reducer vero, "esame superato" non falsa fattore e ritmo', () => {
    let s = createDefaultState();
    s = reducer(s, { type: 'ADD_MATERIA', payload: { nome: 'X', cfu: 6, examDate: fra(20) } });
    const mid = s.materie[0].id;
    for (let i = 0; i < 5; i += 1) {
      s = reducer(s, { type: 'ADD_SFIDA', payload: { materiaId: mid, nome: `n${i}`, oreStimate: 4, pagineAppunti: 30 } });
    }
    s = {
      ...s,
      materie: s.materie.map((m) => ({ ...m, sfide: m.sfide.map((x) => ({ ...x, focusMinutes: 30, focusMinutesStudio: 30 })) }))
    };
    s = reducer(s, {
      type: 'UPDATE_MATERIA',
      payload: { id: mid, patch: { examPassed: true, examPassedDate: oggi(), voto: 27 } }
    });
    assert.ok(s.materie[0].sfide.every((x) => x.chiusoDaVerbale === true));
    assert.equal(computeEstimateBias(s.materie).confident, false, 'prima: fattore 0.5 "affidabile"');
    assert.equal(computePagesPerHour(s.materie).confident, false, 'prima: 60 pagine/ora "affidabili"');
  });

  await t.test('esclusi anche dalla resa di sintesi', () => {
    const chiusi = [1, 2, 3].map(() =>
      nodo({ status: 'COMPLETED', chiusoDaVerbale: true, fonti: [{ id: 'f', pagine: 100, pagineFatte: 100 }], pagineAppunti: 90 })
    );
    assert.equal(computeResaSintesi([{ sfide: chiusi }]).confident, false);
  });
});

test('calibrazione: il fattore usa solo le ore di studio, non quelle di sintesi', () => {
  const sfide = [1, 2, 3, 4, 5].map(() =>
    nodo({ status: 'COMPLETED', oreStimate: 2, focusMinutes: 360, focusMinutesStudio: 120, focusMinutesSintesi: 240 })
  );
  const bias = computeEstimateBias([{ sfide }]);
  assert.equal(bias.factor, 1, 'prima: fattore 3, perché contava anche le 4h di sintesi');
});

test('calibrazione: campioni anomali scartati prima della mediana', () => {
  const buoni = [1, 2, 3, 4, 5].map(() => nodo({ status: 'COMPLETED', oreStimate: 2, focusMinutesStudio: 150 }));
  const anomali = [1, 2].map(() => nodo({ status: 'COMPLETED', oreStimate: 10, focusMinutesStudio: 5 }));
  const bias = computeEstimateBias([{ sfide: [...buoni, ...anomali] }]);
  assert.equal(bias.sampleSize, 5);
  assert.equal(bias.factor, 1.25);
});

test('capacità: al mattino, prima di studiare, oggi non vale come giornata a zero', () => {
  const log = Array.from({ length: 8 }, (_, i) => ({ type: 'FOCUS_MINUTES', dateKey: fra(-(8 - i)), minutes: 240 }));
  const c = computeDailyCapacity(log);
  assert.equal(c.observedDays, 8);
  assert.equal(c.hoursPerDay, 4, 'prima: 3.5, perché oggi contava come un giorno a 0h');
});

/* ------------------------------------------------------------------ */

test('Fine Prevista: una materia senza nodi non è "completata"', () => {
  const m = materia({ cfu: 9, examDate: fra(20) });
  const e = computeEstimatedCompletion(m, CAL);
  assert.equal(e.done, false, 'prima: "Nodo Web-Matrix completato" su un esame mai iniziato');
  assert.equal(e.senzaNodi, true);
  assert.equal(e.totalHoursNeeded, 9 * 15);
});

test('Exam Readiness: copertura pesata sulle ore vere di studio (fonti comprese)', () => {
  // V42 — pesano le ore di STUDIO: le 300 pagine di fonte diventano
  // appunti da studiare (resa misurata 0,2: 60 pagine, a 6/h = 10h), molto
  // più delle 2h dichiarate. La sintesi da fare non è copertura.
  const m = materia({
    examDate: fra(30),
    sfide: [
      nodo({ status: 'COMPLETED', oreStimate: 4 }),
      nodo({ oreStimate: 2, fonti: [{ id: 'f', tipo: 'ALTRO', pagine: 300, pagineFatte: 0 }] })
    ]
  });
  const r = computeExamReadiness(m, null, CAL);
  assert.ok(Math.abs(r.parts.coverage - 4 / 14) < 0.01, `copertura ${r.parts.coverage}`);
  assert.ok(r.parts.coverage < 4 / 6, 'le fonti pesano più delle ore dichiarate');
});

test('piano di sintesi: la sintesi dichiarata chiusa non genera quota né scadenza', () => {
  const m = materia({
    examDate: fra(30),
    sfide: [nodo({ fonti: [{ id: 'f', pagine: 100, pagineFatte: 40 }], pagineAppunti: 10, appuntiCompleti: true })]
  });
  const p = materiaSintesiPlan(m, CAL);
  assert.equal(p.fontiResidue, 0);
  assert.equal(p.quotaSintesiOggi, 0);
  assert.equal(p.dataChiusuraAppunti, null);
  assert.equal(p.raccomandazione, RACCOMANDAZIONE.STUDIO);
});

test('piano di sintesi: appunti propri senza fonti contano come materiale pronto', () => {
  const pronti = [1, 2, 3, 4, 5].map(() => nodo({ pagineAppunti: 20 }));
  const conFonti = nodo({ fonti: [{ id: 'f', pagine: 200, pagineFatte: 0 }] });
  const m = materia({ examDate: fra(60), sfide: [...pronti, conFonti] });
  const p = materiaSintesiPlan(m, CAL);
  assert.equal(p.nodiPronti, 5);
  assert.equal(p.raccomandazione, RACCOMANDAZIONE.MISTO, 'prima: SINTESI, "non c’è materiale tuo pronto"');
});

test('piano di sintesi: la sintesi che non ci sta nei giorni viene segnalata subito', () => {
  const m = materia({ examDate: fra(10), sfide: [nodo({ fonti: [{ id: 'f', pagine: 600, pagineFatte: 0 }] })] });
  const p = materiaSintesiPlan(m, CAL);
  assert.equal(p.inRitardo, true);
  assert.equal(p.sintesiNonCiSta, true);
});

/* ------------------------------------------------------------------ */

test('stima di laurea: una sola sessione intensa non promette la laurea in inverno', () => {
  const esami = [0, 4, 8, 12, 16].map((d) =>
    materia({ cfu: 6, examPassed: true, voto: 27, examPassedDate: fra(-(21 - d)) })
  );
  const f = computeGraduationForecast(esami, CAL);
  assert.ok(f.byCareer, 'con 5 esami la stima di carriera esiste');
  assert.ok(f.byCareer.cfuAlMese < 10, `prima: ~35 CFU/mese, ora ${f.byCareer.cfuAlMese}`);
  assert.equal(f.byCareer.confident, false, 'tre settimane non bastano per un ritmo affidabile');
});

/* ------------------------------------------------------------------ */

test('Primary Target coincide con la prima materia in focus', () => {
  const vicina = materia({ examDate: fra(5), cfu: 3, sfide: [nodo({ oreStimate: 2 })] });
  const grossa = materia({ examDate: fra(30), cfu: 12, sfide: [nodo({ oreStimate: 200 })] });
  const plan = piano([vicina, grossa]);
  const pt = computePrimaryTarget([vicina, grossa], CAL, plan.dailyFocusQuotas[0].materiaId);
  assert.equal(pt.materia.id, plan.dailyFocusQuotas[0].materiaId);
  assert.equal(pt.materia.id, vicina.id);
});
