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
import {
  computeDailyCapacity,
  computeEstimateBias,
  calibratedNodeHours,
  capacityForDate,
  computeReviewMinutes,
  CAPACITY_MAX_HOURS,
  CAPACITY_MIN_DAYS,
  DEFAULT_REVIEW_MINUTES
} from './calibration.js';
import { HOURS_PER_NODE_DAY } from './materiaMeta.js';
import { addDaysToDateOnly, todayDateOnlyKey, isoWeekdayOfDateKey } from './dateUtils.js';

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

/**
 * N giorni consecutivi che finiscono IERI, ognuno con `minutes` minuti.
 * V42 — la capacità si misura solo sui giorni CONCLUSI: oggi non entra.
 */
function focusLog(days, minutes) {
  return Array.from({ length: days }, (_, i) => ({
    type: 'FOCUS_MINUTES',
    dateKey: dayKey(-(days - i)),
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
      { type: 'FOCUS_MINUTES', dateKey: dayKey(-10), minutes: 240 },
      { type: 'FOCUS_MINUTES', dateKey: dayKey(-8), minutes: 240 },
      { type: 'FOCUS_MINUTES', dateKey: dayKey(-6), minutes: 240 },
      { type: 'FOCUS_MINUTES', dateKey: dayKey(-4), minutes: 240 },
      { type: 'FOCUS_MINUTES', dateKey: dayKey(-2), minutes: 240 }
    ];
    const c = computeDailyCapacity(log);
    assert.equal(c.observedDays, 10);
    assert.equal(c.hoursPerDay, 2);
  });

  test('V42: oggi non entra mai nel calcolo (la capacità non cambia a metà giornata)', () => {
    const conOggi = [...focusLog(10, 120), { type: 'FOCUS_MINUTES', dateKey: dayKey(0), minutes: 25 }];
    assert.deepEqual(computeDailyCapacity(conOggi), computeDailyCapacity(focusLog(10, 120)));
    const soloOggi = computeDailyCapacity([{ type: 'FOCUS_MINUTES', dateKey: dayKey(0), minutes: 300 }]);
    assert.equal(soloOggi.hoursPerDay, HOURS_PER_NODE_DAY);
    assert.equal(soloOggi.observedDays, 0);
  });

  test('V42: con pochi giorni la misura si miscela col default, piena a 7 giorni', () => {
    // Due giorni da 1 ora: peso 2/7 → 2/7·1 + 5/7·4,5 = 3,5 h (prima: 1 h secca).
    const c = computeDailyCapacity(focusLog(2, 60));
    assert.equal(c.measuredHoursPerDay, 1);
    assert.equal(c.weight, Math.round((2 / CAPACITY_MIN_DAYS) * 100) / 100);
    assert.equal(c.hoursPerDay, Math.round(((2 / 7) * 1 + (5 / 7) * HOURS_PER_NODE_DAY) * 10) / 10);
    assert.equal(computeDailyCapacity(focusLog(7, 60)).hoursPerDay, 1);
  });

  test('V42: con due settimane di storico ogni giorno della settimana ha il suo fattore', () => {
    // 28 giorni: 3 ore nei giorni feriali, zero la domenica.
    const log = [];
    for (let i = 28; i >= 1; i -= 1) {
      const d = dayKey(-i);
      if (isoWeekdayOfDateKey(d) !== 7) log.push({ type: 'FOCUS_MINUTES', dateKey: d, minutes: 180 });
    }
    const c = computeDailyCapacity(log);
    assert.equal(c.weekdayConfident, true);
    assert.ok(c.weekdayFactors[7] < 0.5, `domenica: ${c.weekdayFactors[7]}`);
    assert.ok(c.weekdayFactors[2] > 1, `martedì: ${c.weekdayFactors[2]}`);
    const media = c.weekdayFactors.slice(1).reduce((a, b) => a + b, 0) / 7;
    assert.ok(Math.abs(media - 1) < 0.02, 'fattori normalizzati a media 1');
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

describe('capacityForDate (V42)', () => {
  const lunedi = '2026-10-05';
  test('giorno di riposo dichiarato: zero; capacità manuale: vale quella', () => {
    assert.equal(capacityForDate(lunedi, { restDays: [1], hoursPerDay: 4, capacityWeight: 1, measuredHoursPerDay: 4 }), 0);
    assert.equal(capacityForDate(lunedi, { manualHours: 6, hoursPerDay: 2, capacityWeight: 1, measuredHoursPerDay: 2 }), 6);
  });
  test('la parte non ancora misurata cala nei giorni con lezioni in aula', () => {
    const cal = { capacityWeight: 0, measuredHoursPerDay: null, hoursPerDay: HOURS_PER_NODE_DAY };
    assert.equal(capacityForDate(lunedi, cal), HOURS_PER_NODE_DAY);
    assert.equal(capacityForDate(lunedi, cal, { lectureHoursOf: () => 4 }), HOURS_PER_NODE_DAY - 0.5 * 4);
    assert.equal(capacityForDate(lunedi, cal, { lectureHoursOf: () => 10 }), 1.5, 'mai sotto un’ora e mezza');
    // Misurata al 100%: le lezioni sono già dentro la tua media.
    assert.equal(capacityForDate(lunedi, { capacityWeight: 1, measuredHoursPerDay: 3, hoursPerDay: 3 }, { lectureHoursOf: () => 4 }), 3);
  });
  test('la media di fase, se misurata, vince sulla media generale', () => {
    const cal = { capacityWeight: 1, measuredHoursPerDay: 3, hoursPerDay: 3, phaseHours: { SESSIONE: 5 } };
    assert.equal(capacityForDate(lunedi, cal, { phaseOf: () => 'SESSIONE' }), 5);
    assert.equal(capacityForDate(lunedi, cal, { phaseOf: () => 'LEZIONI' }), 3);
  });
  test('senza profilo settimanale, i giorni di riposo spalmano la media sugli altri', () => {
    // 3 h di media su 7 giorni con la domenica libera: 3,5 h nei giorni di studio.
    const cal = { capacityWeight: 1, measuredHoursPerDay: 3, hoursPerDay: 3, restDays: [7] };
    assert.equal(capacityForDate(lunedi, cal), 3.5);
  });
  test('un pacchetto parziale (solo hoursPerDay) resta compatibile', () => {
    assert.equal(capacityForDate(lunedi, { hoursPerDay: 2.5 }), 2.5);
    assert.equal(capacityForDate(lunedi, null), HOURS_PER_NODE_DAY);
  });
});

describe('computeReviewMinutes (V42)', () => {
  const ripasso = (minutes, argomentiRipassati = 1) => ({ type: 'FOCUS_SESSION', workMode: 'RIPASSO', minutes, argomentiRipassati });
  test('sotto i 3 campioni torna il default dichiarato non affidabile', () => {
    const r = computeReviewMinutes([ripasso(20), ripasso(30)]);
    assert.equal(r.minutes, DEFAULT_REVIEW_MINUTES);
    assert.equal(r.confident, false);
  });
  test('mediana dei minuti per argomento ripassato; le sessioni brevissime non contano', () => {
    const r = computeReviewMinutes([ripasso(20), ripasso(40, 2), ripasso(60, 3), ripasso(2), { type: 'FOCUS_SESSION', workMode: 'STUDIO', minutes: 90 }]);
    assert.equal(r.confident, true);
    assert.equal(r.sampleSize, 3);
    assert.equal(r.minutes, 20);
  });
});
