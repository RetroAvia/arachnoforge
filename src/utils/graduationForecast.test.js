import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeGraduationForecast, CAREER_MIN_EXAMS } from './gpaEngine.js';
import { computePagesPerHour, calibratedNodeHours, NEUTRAL_CALIBRATION } from './calibration.js';
import { nodeBudgetHours } from './materiaMeta.js';
import { PIANO_CFU_TOTALI } from '../data/vanvitelliCourseMap.js';

/**
 * V37.0 — Test delle due funzionalità nuove che entrano nei calcoli:
 * la stima del tempo di laurea e il ritmo di lettura in pagine/ora.
 * Entrambe possono produrre numeri che l'utente userà per decidere se
 * rimandare un appello: devono degradare con onestà quando i dati non
 * bastano, invece di inventare una cifra autorevole.
 */

function materia(patch = {}) {
  return {
    id: Math.random().toString(36).slice(2),
    nome: 'Materia',
    cfu: 9,
    sfide: [],
    examPassed: false,
    examPassedDate: null,
    examDate: null,
    voto: null,
    ...patch
  };
}

function nodo(patch = {}) {
  return { id: Math.random().toString(36).slice(2), status: 'PENDING', oreStimate: 4, pagine: 0, focusMinutes: 0, ...patch };
}

describe('computeGraduationForecast', () => {
  test('piano vuoto: tutti i CFU sono ancora davanti', () => {
    const f = computeGraduationForecast([], NEUTRAL_CALIBRATION);
    assert.equal(f.cfuTotali, PIANO_CFU_TOTALI);
    assert.equal(f.cfuAcquisiti, 0);
    assert.equal(f.cfuRimanenti, PIANO_CFU_TOTALI);
    assert.equal(f.progressPct, 0);
    assert.equal(f.done, false);
  });

  test('piano completato: nessuna proiezione, solo il fatto', () => {
    const tutte = [materia({ cfu: PIANO_CFU_TOTALI, examPassed: true, examPassedDate: '2026-01-10' })];
    const f = computeGraduationForecast(tutte, NEUTRAL_CALIBRATION);
    assert.equal(f.done, true);
    assert.equal(f.progressPct, 100);
    assert.equal(f.dateKey, null);
  });

  test('il ritmo di carriera resta assente sotto la soglia di campioni', () => {
    const poche = [];
    for (let i = 0; i < CAREER_MIN_EXAMS - 1; i += 1) {
      poche.push(materia({ cfu: 6, examPassed: true, examPassedDate: `2026-0${i + 1}-10` }));
    }
    const f = computeGraduationForecast(poche, NEUTRAL_CALIBRATION);
    assert.equal(f.byCareer, null, 'ha inventato un ritmo su troppo pochi esami');
    assert.equal(f.metodo, 'CARICO');
  });

  test('con abbastanza esami datati calcola i CFU/mese', () => {
    const passate = [
      materia({ cfu: 12, examPassed: true, examPassedDate: '2026-01-15' }),
      materia({ cfu: 9, examPassed: true, examPassedDate: '2026-03-15' }),
      materia({ cfu: 9, examPassed: true, examPassedDate: '2026-05-15' }),
      materia({ cfu: 6, examPassed: true, examPassedDate: '2026-07-15' })
    ];
    const f = computeGraduationForecast(passate, NEUTRAL_CALIBRATION);
    assert.ok(f.byCareer, 'nessun ritmo di carriera calcolato');
    assert.ok(f.byCareer.cfuAlMese > 0);
    assert.equal(f.byCareer.esamiOsservati, 4);
    assert.ok(f.byCareer.dateKey > '2026-09-01', 'data di laurea nel passato');
  });

  test('gli esami senza data non alimentano il ritmo di carriera', () => {
    const senzaData = [
      materia({ cfu: 12, examPassed: true }),
      materia({ cfu: 9, examPassed: true }),
      materia({ cfu: 9, examPassed: true }),
      materia({ cfu: 6, examPassed: true })
    ];
    const f = computeGraduationForecast(senzaData, NEUTRAL_CALIBRATION);
    assert.equal(f.byCareer, null);
    // ...ma i CFU contano comunque per l'avanzamento.
    assert.equal(f.cfuAcquisiti, 36);
  });

  test("non si può laurearsi prima dell'ultimo appello già fissato", () => {
    const lontano = '2029-12-20';
    const m = [
      materia({ cfu: PIANO_CFU_TOTALI - 6, examPassed: true, examPassedDate: '2026-01-10' }),
      materia({ cfu: 6, examDate: lontano, sfide: [nodo({ oreStimate: 1 })] })
    ];
    const f = computeGraduationForecast(m, NEUTRAL_CALIBRATION);
    assert.equal(f.dateKey, lontano);
    assert.equal(f.limitataDaAppello, true);
  });

  test('i CFU non ancora aperti nel Web-Matrix entrano comunque nel carico', () => {
    // Senza questa parte la stima direbbe "finisci domani" solo perché
    // non hai ancora creato le Materie che ti mancano.
    const f = computeGraduationForecast([materia({ cfu: 6, sfide: [nodo({ oreStimate: 1 })] })], NEUTRAL_CALIBRATION);
    assert.ok(f.byWorkload.oreNonTracciate > 0, 'i CFU non tracciati sono stati ignorati');
    assert.ok(f.byWorkload.oreResidue > 100);
  });

  test('una materia superata non pesa più sul carico residuo', () => {
    const conNodiAperti = materia({
      cfu: 9,
      examPassed: true,
      examPassedDate: '2026-04-01',
      sfide: [nodo({ oreStimate: 50 }), nodo({ oreStimate: 50 })]
    });
    const f = computeGraduationForecast([conNodiAperti], NEUTRAL_CALIBRATION);
    assert.equal(f.cfuAcquisiti, 9);
    // Le 100 ore dei nodi rimasti formalmente aperti non devono comparire.
    const soloNonTracciati = f.byWorkload.oreNonTracciate;
    assert.equal(f.byWorkload.oreResidue, soloNonTracciati);
  });
});

describe('Ritmo di lettura (pagine/ora)', () => {
  test('sotto la soglia di campioni non è affidabile', () => {
    const m = [
      materia({
        sfide: [
          nodo({ status: 'COMPLETED', pagine: 20, focusMinutes: 120 }),
          nodo({ status: 'COMPLETED', pagine: 10, focusMinutes: 60 })
        ]
      })
    ];
    const r = computePagesPerHour(m);
    assert.equal(r.confident, false);
    assert.equal(r.sampleSize, 2);
  });

  test('con abbastanza campioni misura la mediana', () => {
    // 10 pagine/ora su tutti e quattro i nodi.
    const sfide = [1, 2, 3, 4].map((i) => nodo({ status: 'COMPLETED', pagine: 10 * i, focusMinutes: 60 * i }));
    const r = computePagesPerHour([materia({ sfide })]);
    assert.equal(r.confident, true);
    assert.equal(r.pagesPerHour, 10);
  });

  test('i nodi senza pagine o senza tempo tracciato non contano', () => {
    const sfide = [
      nodo({ status: 'COMPLETED', pagine: 0, focusMinutes: 120 }),
      nodo({ status: 'COMPLETED', pagine: 20, focusMinutes: 0 }),
      nodo({ status: 'PENDING', pagine: 20, focusMinutes: 120 })
    ];
    assert.equal(computePagesPerHour([materia({ sfide })]).sampleSize, 0);
  });

  test('un dato assurdo viene comunque limitato', () => {
    const sfide = [1, 2, 3, 4].map(() => nodo({ status: 'COMPLETED', pagine: 5000, focusMinutes: 60 }));
    const r = computePagesPerHour([materia({ sfide })]);
    assert.ok(r.pagesPerHour <= 60, 'nessun tetto applicato al ritmo');
  });
});

describe('nodeBudgetHours — pagine vs ore dichiarate', () => {
  // V39.0 — senza un ritmo misurato si prende la stima PIÙ PRUDENTE fra
  // le ore dichiarate e le pagine a un ritmo standard (6 pagine/ora).
  // La V38 dava sempre ragione alle ore dichiarate, che però valgono 4
  // per default e non sanno nulla del volume: 60 pagine in 4 ore sono
  // 15 pagine/ora di materiale tecnico, un piano ottimista per costruzione.
  test('senza ritmo affidabile: pagine a ritmo standard se sono più prudenti', () => {
    const n = nodo({ oreStimate: 4, pagine: 60 });
    assert.equal(nodeBudgetHours(n, NEUTRAL_CALIBRATION), 10, '60 pagine a 6 pag/h');
  });

  test('senza ritmo affidabile: ore dichiarate se sono più prudenti', () => {
    // Un argomento difficile dichiarato a 10h con 12 pagine: le pagine a
    // ritmo standard direbbero 2h, e sarebbe sbagliato scavalcare chi
    // conosce l'argomento.
    const n = nodo({ oreStimate: 10, pagine: 12 });
    assert.equal(nodeBudgetHours(n, NEUTRAL_CALIBRATION), 10);
  });

  test('con ritmo affidabile le pagine sostituiscono la stima', () => {
    const n = nodo({ oreStimate: 4, pagine: 60 });
    assert.equal(nodeBudgetHours(n, { biasFactor: 1, pagesPerHour: 10 }), 6);
  });

  test('senza pagine si applica il bias storico alle ore', () => {
    const n = nodo({ oreStimate: 4, pagine: 0 });
    assert.equal(nodeBudgetHours(n, { biasFactor: 1.5, pagesPerHour: 10 }), 6);
  });

  test('mai sotto mezz\'ora, nemmeno con una pagina sola', () => {
    assert.equal(nodeBudgetHours(nodo({ pagine: 1, oreStimate: 0 }), { biasFactor: 1, pagesPerHour: 60 }), 0.5);
  });

  test('calibratedNodeHours resta compatibile con la vecchia firma numerica', () => {
    // Senza pagine: la firma storica (solo biasFactor) si comporta come sempre.
    const n = nodo({ oreStimate: 4, pagine: 0 });
    assert.equal(calibratedNodeHours(n, 1.5), 6, 'la firma storica (solo biasFactor) è cambiata');
  });
});
