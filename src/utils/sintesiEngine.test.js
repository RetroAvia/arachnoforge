import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FONTE_TIPO,
  WORK_MODE,
  DEFAULT_RESA_SINTESI,
  DEFAULT_SINTESI_PAGES_PER_HOUR,
  createFonte,
  normalizeFonti,
  nodeSources,
  nodeNotes,
  nodeWorkBreakdown,
  nodeTotalHours,
  nodeRemainingHours,
  computeResaSintesi,
  computeSintesiPagesPerHour,
  materiaSintesiPlan,
  suggestedWorkMode,
  applySintesiProgress,
  RACCOMANDAZIONE
} from './sintesiEngine.js';
import { addDaysToDateOnly, todayDateOnlyKey } from './dateUtils.js';
import { nodeBudgetHours, computeRemainingHours } from './materiaMeta.js';

/** Calibrazione completa e "misurata": rende i test deterministici. */
const CAL = {
  hoursPerDay: 5,
  biasFactor: 1,
  pagesPerHour: 5, // 5 pagine di appunti studiate all'ora
  sintesiPagesPerHour: 10, // 10 pagine di fonte snellite all'ora
  resaSintesi: 0.2 // da 100 pagine di fonte, 20 mie
};

function nodo(over = {}) {
  return {
    id: 'n1',
    nome: 'Limiti',
    status: 'PENDING',
    oreStimate: 4,
    focusMinutes: 0,
    fonti: [],
    pagineAppunti: 0,
    appuntiCompleti: false,
    ...over
  };
}

function fonte(pagine, pagineFatte = 0, tipo = FONTE_TIPO.LIBRO) {
  return { id: `f_${pagine}_${pagineFatte}`, tipo, etichetta: '', pagine, pagineFatte };
}

/* ================================================================== *
 * LETTURA DEL NODO
 * ================================================================== */

test('nodeSources', async (t) => {
  await t.test('somma le fonti e calcola il residuo', () => {
    const s = nodo({ fonti: [fonte(600, 100), fonte(400, 50)] });
    const r = nodeSources(s);
    assert.equal(r.totali, 1000);
    assert.equal(r.fatte, 150);
    assert.equal(r.residue, 850);
    assert.equal(r.pct, 15);
  });

  await t.test('pagineFatte non può superare il totale nemmeno da dato corrotto', () => {
    const s = nodo({ fonti: [{ id: 'x', pagine: 100, pagineFatte: 9999 }] });
    const r = nodeSources(s);
    assert.equal(r.fatte, 100, 'un import sbagliato non deve produrre un residuo negativo');
    assert.equal(r.residue, 0);
  });

  await t.test('sintesi conclusa sia per spunta sia per esaurimento pagine', () => {
    assert.equal(nodeSources(nodo({ fonti: [fonte(100, 100)] })).conclusa, true);
    assert.equal(nodeSources(nodo({ fonti: [fonte(100, 10)], appuntiCompleti: true })).conclusa, true);
    assert.equal(nodeSources(nodo({ fonti: [fonte(100, 10)] })).conclusa, false);
  });

  await t.test('nodo senza fonti: tutto a zero, mai NaN', () => {
    const r = nodeSources(nodo());
    assert.equal(r.totali, 0);
    assert.equal(r.residue, 0);
    assert.equal(r.pct, 0);
    assert.equal(r.conclusa, false, 'senza fonti non c’è una sintesi da dichiarare conclusa');
  });
});

test('nodeNotes proietta le pagine finali di appunti', async (t) => {
  await t.test('somma appunti esistenti e proiezione sul residuo', () => {
    // 100 pagine di fonte fatte -> 20 mie; ne restano 100 -> +20 previste.
    const s = nodo({ fonti: [fonte(200, 100)], pagineAppunti: 20 });
    const n = nodeNotes(s, 0.2);
    assert.equal(n.attuali, 20);
    assert.equal(n.daProdurre, 20);
    assert.equal(n.proiettate, 40);
  });

  await t.test('sintesi chiusa: nessuna pagina futura, solo quelle reali', () => {
    const s = nodo({ fonti: [fonte(200, 100)], pagineAppunti: 20, appuntiCompleti: true });
    const n = nodeNotes(s, 0.2);
    assert.equal(n.daProdurre, 0);
    assert.equal(n.proiettate, 20, 'dichiarare chiusa la sintesi congela il totale sulle pagine vere');
  });

  await t.test('legge il campo V37 `pagine` come sinonimo', () => {
    assert.equal(nodeNotes(nodo({ pagine: 15 })).attuali, 15);
  });
});

/* ================================================================== *
 * IL BILANCIO IN ORE — il cuore
 * ================================================================== */

test('nodeWorkBreakdown', async (t) => {
  await t.test('separa le ore di sintesi da quelle di studio', () => {
    // 200 pagine di fonte @10/h = 20h di sintesi.
    // 40 pagine di appunti proiettate @5/h = 8h di studio.
    const s = nodo({ fonti: [fonte(200, 0)], pagineAppunti: 0 });
    const b = nodeWorkBreakdown(s, CAL);
    assert.equal(b.oreSintesiTotali, 20);
    assert.equal(b.pagineAppuntiProiettate, 40);
    assert.equal(b.oreStudioTotali, 8);
    assert.equal(b.oreTotali, 28);
  });

  await t.test('la sintesi già fatta riduce il residuo ma non il totale', () => {
    const s = nodo({ fonti: [fonte(200, 150)], pagineAppunti: 30 });
    const b = nodeWorkBreakdown(s, CAL);
    assert.equal(b.oreSintesiTotali, 20, 'il costo del nodo da zero non cambia');
    assert.equal(b.oreSintesiResidue, 5, '50 pagine rimaste @10/h');
    assert.ok(b.oreResidue < b.oreTotali, 'il piano deve accorciarsi mentre lavori');
  });

  await t.test('nodo completato: nessuna ora di studio residua', () => {
    const s = nodo({ status: 'COMPLETED', fonti: [fonte(200, 200)], pagineAppunti: 40 });
    const b = nodeWorkBreakdown(s, CAL);
    assert.equal(b.oreResidue, 0);
    assert.ok(b.oreTotali > 0, 'il totale storico resta, serve alla calibrazione');
  });

  await t.test('senza fonti e senza pagine ricade sulle ore dichiarate (comportamento V37)', () => {
    const b = nodeWorkBreakdown(nodo({ oreStimate: 4 }), { biasFactor: 1.5 });
    assert.equal(b.oreSintesiTotali, 0);
    assert.equal(b.oreStudioTotali, 6, '4h dichiarate × bias 1.5');
    assert.equal(b.oreTotali, 6);
  });

  await t.test('le ore di sintesi non vengono scontate due volte dal tempo tracciato', () => {
    // 10h di sintesi già spese su un nodo con fonti: il residuo va
    // calcolato sulle PAGINE rimaste, non anche scalando quelle ore.
    const s = nodo({
      fonti: [fonte(200, 100)],
      pagineAppunti: 20,
      focusMinutes: 600,
      focusMinutesSintesi: 600,
      focusMinutesStudio: 0
    });
    const b = nodeWorkBreakdown(s, CAL);
    assert.equal(b.oreSintesiResidue, 10, '100 pagine rimaste @10/h');
    assert.equal(b.oreStudioTracciate, 0, 'nessuna ora di studio ancora spesa');
    assert.equal(b.oreStudioResidueNette, b.oreStudioResidue);
  });

  await t.test('le ore di studio tracciate scalano il residuo di studio', () => {
    const s = nodo({
      fonti: [fonte(200, 200)],
      pagineAppunti: 40,
      appuntiCompleti: true,
      focusMinutes: 180,
      focusMinutesStudio: 180
    });
    const b = nodeWorkBreakdown(s, CAL);
    assert.equal(b.oreStudioTotali, 8);
    assert.equal(b.oreStudioTracciate, 3);
    assert.equal(b.oreStudioResidueNette, 5);
  });

  await t.test('un nodo pre-V38 con fonti non scala nulla (non si sa come fu speso il tempo)', () => {
    const s = nodo({ fonti: [fonte(100, 0)], focusMinutes: 300 });
    delete s.focusMinutesStudio;
    const b = nodeWorkBreakdown(s, CAL);
    assert.equal(b.oreStudioTracciate, 0, 'prudenza: meglio sovrastimare il residuo che far sparire lavoro');
  });

  await t.test('senza ritmo di sintesi misurato usa il default e lo dichiara', () => {
    const b = nodeWorkBreakdown(nodo({ fonti: [fonte(120, 0)] }), { biasFactor: 1, pagesPerHour: 5 });
    assert.equal(b.oreSintesiTotali, 120 / DEFAULT_SINTESI_PAGES_PER_HOUR);
    assert.equal(b.sintesiStimata, true, 'la UI deve poter dire che non è ancora calibrato');
  });

  await t.test('senza ritmo di studio misurato vince la stima più prudente', () => {
    // 1000 pagine di fonte -> 180 pagine di appunti previste. A 6 pag/h
    // sono 30h di studio: le 3h dichiarate (default del form) non possono
    // descrivere quel volume. Era il caso "162 pagine = 4h" della V38.
    const b = nodeWorkBreakdown(nodo({ fonti: [fonte(1000, 0)], oreStimate: 3 }), {
      biasFactor: 1,
      sintesiPagesPerHour: 10
    });
    assert.equal(b.oreSintesiTotali, 100);
    assert.equal(b.pagineAppuntiProiettate, 180);
    assert.equal(b.oreStudioTotali, 30);
    assert.equal(b.studioDaPagine, true);
    assert.equal(b.studioStimato, true, 'la UI deve poter dire che il ritmo non è misurato');
  });

  await t.test('senza ritmo misurato le ore dichiarate vincono se più prudenti', () => {
    const b = nodeWorkBreakdown(nodo({ pagineAppunti: 12, oreStimate: 10 }), { biasFactor: 1 });
    assert.equal(b.oreStudioTotali, 10);
    assert.equal(b.studioDaPagine, false);
  });

  await t.test('con ritmo misurato le pagine sostituiscono la stima e non è più stimato', () => {
    const b = nodeWorkBreakdown(nodo({ pagineAppunti: 40, oreStimate: 2 }), { biasFactor: 1, pagesPerHour: 5 });
    assert.equal(b.oreStudioTotali, 8);
    assert.equal(b.studioStimato, false);
  });

  await t.test('modo consigliato: sintesi finché resta fonte, poi studio', () => {
    assert.equal(nodeWorkBreakdown(nodo({ fonti: [fonte(100, 10)] }), CAL).modo, WORK_MODE.SINTESI);
    assert.equal(nodeWorkBreakdown(nodo({ fonti: [fonte(100, 100)] }), CAL).modo, WORK_MODE.STUDIO);
    assert.equal(nodeWorkBreakdown(nodo(), CAL).modo, WORK_MODE.STUDIO);
  });
});

test('nodeTotalHours e nodeRemainingHours sono le due facce dello stesso bilancio', () => {
  const s = nodo({ fonti: [fonte(200, 100)], pagineAppunti: 20 });
  assert.equal(nodeTotalHours(s, CAL), nodeWorkBreakdown(s, CAL).oreTotali);
  assert.equal(nodeRemainingHours(s, CAL), nodeWorkBreakdown(s, CAL).oreResidue);
});

/* ================================================================== *
 * IL PONTE VERSO IL RESTO DELL'APP
 * ================================================================== */

test('materiaMeta eredita le fonti senza modifiche ai motori a valle', async (t) => {
  await t.test('nodeBudgetHours include ora le ore di sintesi', () => {
    const s = nodo({ fonti: [fonte(200, 0)] });
    assert.equal(nodeBudgetHours(s, CAL), 28, '20h di sintesi + 8h di studio proiettato');
  });

  await t.test('la firma storica resta identica per i nodi senza fonti', () => {
    assert.equal(nodeBudgetHours({ oreStimate: 4 }, { biasFactor: 1.5 }), 6);
    assert.equal(nodeBudgetHours({ oreStimate: 0 }, { biasFactor: 1 }), 0.5, 'guardia minima invariata');
    assert.equal(nodeBudgetHours({}, { biasFactor: 1 }), 0.5);
  });

  await t.test('computeRemainingHours somma i residui, non i budget pieni', () => {
    const materia = {
      id: 'm',
      cfu: 9,
      sfide: [nodo({ id: 'a', fonti: [fonte(200, 200)], pagineAppunti: 40, appuntiCompleti: true })]
    };
    // Sintesi conclusa: restano solo le 8h di studio sulle 40 pagine.
    assert.equal(computeRemainingHours(materia, CAL), 8);
  });

  await t.test('esame verbalizzato: zero ore, fonti comprese', () => {
    const materia = { id: 'm', examPassed: true, cfu: 9, sfide: [nodo({ fonti: [fonte(1000, 0)] })] };
    assert.equal(computeRemainingHours(materia, CAL), 0);
  });
});

/* ================================================================== *
 * MISURA DELLA RESA E DEL RITMO
 * ================================================================== */

test('computeResaSintesi', async (t) => {
  const materieCon = (rese) => [
    {
      sfide: rese.map(([fatte, appunti], i) => ({
        id: `n${i}`,
        fonti: [fonte(fatte, fatte)],
        pagineAppunti: appunti
      }))
    }
  ];

  await t.test('sotto la soglia di campioni resta il default e lo dichiara', () => {
    const r = computeResaSintesi(materieCon([[100, 20], [100, 20]]));
    assert.equal(r.resa, DEFAULT_RESA_SINTESI);
    assert.equal(r.confident, false);
    assert.equal(r.sampleSize, 2);
  });

  await t.test('con abbastanza campioni usa la mediana', () => {
    const r = computeResaSintesi(materieCon([[100, 10], [100, 20], [100, 60]]));
    assert.equal(r.confident, true);
    assert.equal(r.resa, 0.2, 'mediana, non media: il 60 non deve trascinare il risultato');
  });

  await t.test('ignora i nodi con sintesi ancora aperta', () => {
    const materie = [
      {
        sfide: [
          { id: 'a', fonti: [fonte(100, 50)], pagineAppunti: 10 },
          { id: 'b', fonti: [fonte(100, 50)], pagineAppunti: 10 },
          { id: 'c', fonti: [fonte(100, 50)], pagineAppunti: 10 }
        ]
      }
    ];
    assert.equal(computeResaSintesi(materie).confident, false, 'a metà nodo il rapporto è falsato');
  });
});

test('computeSintesiPagesPerHour misura sulle singole sessioni', async (t) => {
  const sessione = (minutes, pagineFonte, workMode = 'SINTESI') => ({
    type: 'FOCUS_SESSION',
    dateKey: '2026-09-01',
    minutes,
    workMode,
    pagineFonte
  });

  await t.test('sotto la soglia di campioni resta il default', () => {
    const r = computeSintesiPagesPerHour([sessione(60, 100), sessione(60, 100)]);
    assert.equal(r.sampleSize, 2);
    assert.equal(r.confident, false);
    assert.equal(r.pagesPerHour, DEFAULT_SINTESI_PAGES_PER_HOUR);
  });

  await t.test('mediana sulle sessioni di sintesi', () => {
    const r = computeSintesiPagesPerHour([sessione(60, 8), sessione(60, 10), sessione(60, 30)]);
    assert.equal(r.confident, true);
    assert.equal(r.pagesPerHour, 10, 'mediana: la sessione anomala da 30 non trascina');
  });

  await t.test('ignora le sessioni di studio e quelle senza pagine', () => {
    const r = computeSintesiPagesPerHour([
      sessione(60, 100, 'STUDIO'),
      sessione(60, 0),
      sessione(0, 100),
      { type: 'FOCUS_MINUTES', dateKey: '2026-09-01', minutes: 300 }
    ]);
    assert.equal(r.sampleSize, 0);
  });

  await t.test('non confonde il totale storico del nodo con la sessione', () => {
    // Il caso che rendeva la misura inservibile: un libro con 500
    // pagine dichiarate già fatte e una sola sessione da 30 minuti che
    // ne copre 10. La risposta giusta è 20 pagine/ora, non 1020.
    const r = computeSintesiPagesPerHour([sessione(30, 10), sessione(30, 10), sessione(30, 10)]);
    assert.equal(r.pagesPerHour, 20);
  });

  await t.test('input non-array non esplode', () => {
    assert.equal(computeSintesiPagesPerHour(null).confident, false);
  });
});

/* ================================================================== *
 * IL PIANO DI UNA MATERIA
 * ================================================================== */

test('materiaSintesiPlan', async (t) => {
  await t.test('materia senza fonti né pagine: il pannello non ha niente da dire', () => {
    const plan = materiaSintesiPlan({ id: 'm', sfide: [nodo()] }, CAL);
    assert.equal(plan.attiva, false);
  });

  await t.test('calcola la data entro cui gli appunti vanno chiusi', () => {
    // 100 pagine di fonte residue -> 20 pagine mie -> 4h di studio
    // @5/h; con 5h/giorno servono 1 giorno di studio.
    const esame = addDaysToDateOnly(todayDateOnlyKey(), 30);
    const plan = materiaSintesiPlan(
      { id: 'm', examDate: esame, sfide: [nodo({ fonti: [fonte(100, 0)] })] },
      CAL
    );
    assert.equal(plan.attiva, true);
    assert.equal(plan.fontiResidue, 100);
    assert.ok(plan.giorniPerStudio >= 1);
    assert.equal(plan.dataChiusuraAppunti, addDaysToDateOnly(esame, -plan.giorniPerStudio));
    assert.ok(
      plan.giorniAllaChiusura < 30,
      'la scadenza vera è sempre più vicina della data d’esame'
    );
  });

  await t.test('la quota giornaliera divide il residuo per i giorni che restano', () => {
    const esame = addDaysToDateOnly(todayDateOnlyKey(), 21);
    const plan = materiaSintesiPlan(
      { id: 'm', examDate: esame, sfide: [nodo({ fonti: [fonte(200, 0)] })] },
      CAL
    );
    assert.ok(plan.quotaSintesiOggi > 0);
    assert.equal(plan.quotaSintesiOggi, Math.ceil(plan.fontiResidue / plan.giorniAllaChiusura));
  });

  await t.test('oltre la scadenza degli appunti lo dice e consiglia sintesi', () => {
    const esame = addDaysToDateOnly(todayDateOnlyKey(), 1);
    const plan = materiaSintesiPlan(
      { id: 'm', examDate: esame, sfide: [nodo({ fonti: [fonte(500, 0)] })] },
      CAL
    );
    assert.equal(plan.inRitardo, true);
    assert.equal(plan.raccomandazione, RACCOMANDAZIONE.SINTESI);
    assert.equal(plan.quotaSintesiOggi, 500, 'a scadenza passata la quota è tutto il residuo');
  });

  await t.test('senza data d’esame niente scadenza ma il consiglio resta', () => {
    const plan = materiaSintesiPlan({ id: 'm', examDate: null, sfide: [nodo({ fonti: [fonte(300, 0)] })] }, CAL);
    assert.equal(plan.dataChiusuraAppunti, null);
    assert.equal(plan.giorniAllaChiusura, null);
    assert.equal(plan.raccomandazione, RACCOMANDAZIONE.SINTESI);
    assert.ok(plan.quotaSintesiOggi > 0, 'senza scadenza resta comunque un ritmo suggerito');
  });

  await t.test('appunti chiusi su tutti i nodi: si passa a STUDIO', () => {
    const plan = materiaSintesiPlan(
      {
        id: 'm',
        examDate: addDaysToDateOnly(todayDateOnlyKey(), 20),
        sfide: [nodo({ fonti: [fonte(100, 100)], pagineAppunti: 20 })]
      },
      CAL
    );
    assert.equal(plan.fontiResidue, 0);
    assert.equal(plan.raccomandazione, RACCOMANDAZIONE.STUDIO);
    assert.equal(plan.dataChiusuraAppunti, null, 'senza fonte residua non serve una scadenza');
  });

  await t.test('con materiale pronto E fonte residua il consiglio è misto', () => {
    const plan = materiaSintesiPlan(
      {
        id: 'm',
        examDate: addDaysToDateOnly(todayDateOnlyKey(), 60),
        sfide: [
          nodo({ id: 'pronto', fonti: [fonte(100, 100)], pagineAppunti: 20 }),
          nodo({ id: 'aperto', fonti: [fonte(200, 20)], pagineAppunti: 4 })
        ]
      },
      CAL
    );
    assert.equal(plan.nodiPronti, 1);
    assert.equal(plan.raccomandazione, RACCOMANDAZIONE.MISTO);
  });

  await t.test('a materia chiusa le pagine finali restano quelle vere, non zero', () => {
    const plan = materiaSintesiPlan(
      {
        id: 'm',
        sfide: [nodo({ status: 'COMPLETED', fonti: [fonte(200, 200)], pagineAppunti: 40, appuntiCompleti: true })]
      },
      CAL
    );
    assert.equal(plan.fontiFatte, 200);
    assert.equal(plan.pagineAppuntiProiettate, 40, 'un nodo chiuso ha prodotto pagine vere, vanno contate');
  });

  await t.test('esame verbalizzato: piano spento', () => {
    const plan = materiaSintesiPlan({ id: 'm', examPassed: true, sfide: [nodo({ fonti: [fonte(500, 0)] })] }, CAL);
    assert.equal(plan.attiva, false);
    assert.equal(plan.oreResidue, 0);
  });

  await t.test('il caso reale: Analisi 1, libro 600 + dispense 400', () => {
    const plan = materiaSintesiPlan(
      {
        id: 'analisi',
        examDate: addDaysToDateOnly(todayDateOnlyKey(), 120),
        sfide: [
          nodo({
            id: 'limiti',
            fonti: [fonte(600, 100, FONTE_TIPO.LIBRO), fonte(400, 0, FONTE_TIPO.APPUNTI_PROF)],
            pagineAppunti: 20
          })
        ]
      },
      CAL
    );
    assert.equal(plan.fontiTotali, 1000);
    assert.equal(plan.fontiFatte, 100);
    assert.equal(plan.fontiResidue, 900);
    // 20 già scritte + 900 × 0.2 = 180 previste -> 200 pagine finali.
    assert.equal(plan.pagineAppuntiProiettate, 180 + 20);
    assert.ok(plan.dataChiusuraAppunti, 'con un esame in calendario la scadenza esiste');
  });
});

/* ================================================================== *
 * AVANZAMENTO E UTILITY
 * ================================================================== */

test('applySintesiProgress riempie una fonte alla volta', async (t) => {
  await t.test('riempie la prima non finita, poi trabocca sulla successiva', () => {
    const fonti = [fonte(100, 90), fonte(200, 0)];
    const out = applySintesiProgress(fonti, 50);
    assert.equal(out[0].pagineFatte, 100, 'la prima si chiude');
    assert.equal(out[1].pagineFatte, 40, 'le 40 restanti passano alla seconda');
  });

  await t.test('non supera mai il totale di una fonte', () => {
    const out = applySintesiProgress([fonte(50, 0)], 9999);
    assert.equal(out[0].pagineFatte, 50);
  });

  await t.test('zero pagine non tocca niente e non muta l’originale', () => {
    const fonti = [fonte(100, 10)];
    const out = applySintesiProgress(fonti, 0);
    assert.equal(out[0].pagineFatte, 10);
    assert.equal(fonti[0].pagineFatte, 10, 'nessuna mutazione in place');
  });

  await t.test('salta le fonti già complete', () => {
    const out = applySintesiProgress([fonte(100, 100), fonte(100, 0)], 30);
    assert.equal(out[0].pagineFatte, 100);
    assert.equal(out[1].pagineFatte, 30);
  });
});

test('createFonte e normalizeFonti blindano i dati in ingresso', async (t) => {
  await t.test('un tipo sconosciuto diventa ALTRO', () => {
    assert.equal(createFonte({ tipo: 'PERGAMENA', pagine: 10 }).tipo, FONTE_TIPO.ALTRO);
  });

  await t.test('normalizeFonti scarta le fonti senza pagine', () => {
    const out = normalizeFonti([{ pagine: 0 }, { pagine: 100 }, null, 'x']);
    assert.equal(out.length, 1);
    assert.equal(out[0].pagine, 100);
  });

  await t.test('normalizeFonti conserva gli id esistenti', () => {
    const out = normalizeFonti([{ id: 'fonte_mia', pagine: 100, pagineFatte: 10 }]);
    assert.equal(out[0].id, 'fonte_mia');
    assert.equal(out[0].pagineFatte, 10);
  });

  await t.test('input non-array non esplode', () => {
    assert.deepEqual(normalizeFonti(null), []);
    assert.deepEqual(normalizeFonti('libro'), []);
  });
});

test('suggestedWorkMode preseleziona il modo giusto', () => {
  assert.equal(suggestedWorkMode(nodo({ fonti: [fonte(100, 0)] })), WORK_MODE.SINTESI);
  assert.equal(suggestedWorkMode(nodo({ fonti: [fonte(100, 100)] })), WORK_MODE.STUDIO);
  assert.equal(suggestedWorkMode(nodo({ fonti: [fonte(100, 10)], appuntiCompleti: true })), WORK_MODE.STUDIO);
  assert.equal(suggestedWorkMode(nodo()), WORK_MODE.STUDIO, 'nessuna fonte: si studia');
  assert.equal(suggestedWorkMode(null), WORK_MODE.STUDIO);
});
