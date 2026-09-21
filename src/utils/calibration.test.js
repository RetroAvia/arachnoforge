// =====================================================================
// ArachnoForge — src/utils/calibration.test.js (V36.0)
// "Karen impara da te": i due numeri misurati che hanno sostituito le
// costanti inventate. Il comportamento più importante da blindare è il
// DEGRADO: sotto la soglia di campioni devono tornare i default e
// dichiararsi non affidabili, mai un numero autorevole costruito su due
// sessioni.
// =====================================================================
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeDailyCapacity, computeEstimateBias, calibratedNodeHours, CAPACITY_MAX_HOURS } from './calibration.js';
import { HOURS_PER_NODE_DAY } from './materiaMeta.js';
import { addDaysToDateOnly, todayDateOnlyKey } from './dateUtils.js';

/**
 * V38.0 — FIX: questo helper costruiva la data nel calendario UTC,
 * mentre TUTTA l'app ragiona in giorni di calendario LOCALI
 * (`getDateKey` usa getFullYear/getMonth/getDate). Le due cose
 * coincidono per 22 ore al giorno e divergono di un giorno intero
 * nella finestra fra la mezzanotte locale e quella UTC — in Italia
 * dalle 00:00 alle 02:00. Risultato: una suite che passava di
 * pomeriggio e falliva di notte su 9 test, facendo sospettare una
 * regressione che non c'era. Ora l'attesa si costruisce con le stesse
 * funzioni che usa il codice sotto test.
 */
function dayKey(offset) {
  return addDaysToDateOnly(todayDateOnlyKey(), offset);
}

/** N giorni consecutivi che finiscono OGGI, ognuno con `minutes` minuti. */
function focusLog(days, minutes) {
  return Array.from({ length: days }, (_, i) => ({
    type: 'FOCUS_MINUTES',
    dateKey: dayKey(-(days - 1 - i)),
    minutes,
    xp: 0
  }));
}

describe('computeDailyCapacity', () => {
  test('senza storico torna il default dichiarandosi non affidabile', () => {
    const c = computeDailyCapacity([]);
    assert.equal(c.hoursPerDay, HOURS_PER_NODE_DAY);
    assert.equal(c.confident, false);
  });

  test('con meno di 7 giorni osservati resta non affidabile', () => {
    const c = computeDailyCapacity(focusLog(3, 180));
    assert.equal(c.confident, false);
  });

  test('con abbastanza storico misura la media reale sui giorni di calendario', () => {
    // 10 giorni consecutivi a 2 ore esatte.
    const c = computeDailyCapacity(focusLog(10, 120));
    assert.equal(c.confident, true);
    assert.equal(c.observedDays, 10);
    assert.equal(c.hoursPerDay, 2);
  });

  test('i giorni di riposo entrano nel denominatore e abbassano la capacità', () => {
    // Stesso monte ore del test precedente (20h) ma concentrato in 5
    // giorni su 10: la capacità SOSTENIBILE resta 2h/giorno, non 4h.
    const log = [
      { type: 'FOCUS_MINUTES', dateKey: dayKey(-9), minutes: 240 },
      { type: 'FOCUS_MINUTES', dateKey: dayKey(-7), minutes: 240 },
      { type: 'FOCUS_MINUTES', dateKey: dayKey(-5), minutes: 240 },
      { type: 'FOCUS_MINUTES', dateKey: dayKey(-3), minutes: 240 },
      { type: 'FOCUS_MINUTES', dateKey: dayKey(0), minutes: 240 }
    ];
    const c = computeDailyCapacity(log);
    assert.equal(c.hoursPerDay, 2);
  });

  test('un valore assurdo viene comunque limitato al tetto di sicurezza', () => {
    const c = computeDailyCapacity(focusLog(10, 1200)); // 20h/giorno
    assert.equal(c.hoursPerDay, CAPACITY_MAX_HOURS);
  });

  test('voci non-Focus o corrotte vengono ignorate senza far crollare il calcolo', () => {
    const log = [...focusLog(10, 120), { type: 'BOSS_FIGHT', dateKey: dayKey(-1) }, null, { type: 'FOCUS_MINUTES' }];
    const c = computeDailyCapacity(log);
    assert.equal(c.hoursPerDay, 2);
  });
});

describe('computeEstimateBias', () => {
  const nodo = (oreStimate, focusMinutes, status = 'COMPLETED') => ({ oreStimate, focusMinutes, status });

  test('sotto i 5 campioni non si azzarda nessuna correzione', () => {
    const b = computeEstimateBias([{ sfide: [nodo(2, 180), nodo(2, 180)] }]);
    assert.equal(b.factor, 1);
    assert.equal(b.confident, false);
    assert.equal(b.sampleSize, 2);
  });

  test('con abbastanza nodi chiusi misura di quanto sbagli le stime', () => {
    // Ogni nodo stimato 2h ne è costati 3: fattore 1.5.
    const sfide = Array.from({ length: 6 }, () => nodo(2, 180));
    const b = computeEstimateBias([{ sfide }]);
    assert.equal(b.confident, true);
    assert.equal(b.factor, 1.5);
  });

  test('usa la mediana, quindi una singola maratona non sposta tutto', () => {
    const sfide = [nodo(2, 120), nodo(2, 120), nodo(2, 120), nodo(2, 120), nodo(2, 120), nodo(2, 3000)];
    const b = computeEstimateBias([{ sfide }]);
    assert.equal(b.factor, 1);
  });

  test('i nodi non completati e quelli senza tempo tracciato non contano', () => {
    const sfide = [nodo(2, 180, 'PENDING'), nodo(2, 0), nodo(0, 180)];
    const b = computeEstimateBias([{ sfide }]);
    assert.equal(b.sampleSize, 0);
    assert.equal(b.factor, 1);
  });
});

describe('calibratedNodeHours', () => {
  test('applica il fattore alle ore dichiarate', () => {
    assert.equal(calibratedNodeHours({ oreStimate: 4 }, 1.5), 6);
  });

  test('un nodo con ore corrotte non scende mai sotto la guardia di 0.5h', () => {
    assert.equal(calibratedNodeHours({ oreStimate: 0 }, 1), 0.5);
    assert.equal(calibratedNodeHours({}, 1), 0.5);
  });

  test('un fattore non valido non altera il valore', () => {
    assert.equal(calibratedNodeHours({ oreStimate: 4 }, NaN), 4);
  });
});
