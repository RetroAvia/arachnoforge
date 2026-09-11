// =====================================================================
// ArachnoForge — src/utils/dateUtils.test.js
// Test unitari (node:test built-in, zero dipendenze npm) per gli helper
// data/tempo. Eseguibile con: node --test src/utils/dateUtils.test.js
// =====================================================================
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  getDateKey,
  isSameDay,
  daysBetween,
  formatCountdown,
  formatClock,
  dateOnlyToUtcMs,
  daysUntilDateOnly,
  addDaysToDateOnly,
  monthKeyFromDateKey,
  formatHoursMinutes,
  msUntilNextLocalMidnight
} from './dateUtils.js';

describe('getDateKey', () => {
  test('formatta correttamente una data nota', () => {
    assert.equal(getDateKey(new Date(2026, 8, 11)), '2026-09-11'); // mese 0-indexed: 8 = settembre
  });
  test('applica lo zero-padding a mese e giorno', () => {
    assert.equal(getDateKey(new Date(2026, 0, 5)), '2026-01-05');
  });
});

describe('isSameDay', () => {
  test('due timestamp nello stesso giorno locale', () => {
    assert.equal(isSameDay(new Date(2026, 8, 11, 1).toISOString(), new Date(2026, 8, 11, 23).toISOString()), true);
  });
  test('due timestamp in giorni diversi', () => {
    assert.equal(isSameDay(new Date(2026, 8, 11).toISOString(), new Date(2026, 8, 12).toISOString()), false);
  });
});

describe('daysBetween', () => {
  test('differenza esatta in giorni interi', () => {
    assert.equal(daysBetween(new Date(2026, 8, 1).toISOString(), new Date(2026, 8, 11).toISOString()), 10);
  });
  test('ordine invertito produce un valore negativo', () => {
    assert.equal(daysBetween(new Date(2026, 8, 11).toISOString(), new Date(2026, 8, 1).toISOString()), -10);
  });
});

describe('formatCountdown', () => {
  test('scompone correttamente in giorni/ore/minuti/secondi', () => {
    const ms = 2 * 86400000 + 3 * 3600000 + 4 * 60000 + 5000;
    assert.deepEqual(formatCountdown(ms), { days: 2, hours: 3, minutes: 4, seconds: 5, expired: false });
  });
  test('tempo scaduto (<=0) -> expired true, tutti zero', () => {
    assert.deepEqual(formatCountdown(0), { days: 0, hours: 0, minutes: 0, seconds: 0, expired: true });
    assert.deepEqual(formatCountdown(-500), { days: 0, hours: 0, minutes: 0, seconds: 0, expired: true });
  });
});

describe('formatClock', () => {
  test('formatta mm:ss con zero-padding', () => {
    assert.equal(formatClock(65), '01:05');
    assert.equal(formatClock(5), '00:05');
  });
  test('valori negativi vengono trattati come zero', () => {
    assert.equal(formatClock(-10), '00:00');
  });
});

describe('date-only helpers (UTC assoluto — fix Timezone Shift)', () => {
  test('dateOnlyToUtcMs produce sempre mezzanotte UTC per quella data', () => {
    const ms = dateOnlyToUtcMs('2026-09-11');
    const d = new Date(ms);
    assert.equal(d.getUTCFullYear(), 2026);
    assert.equal(d.getUTCMonth(), 8);
    assert.equal(d.getUTCDate(), 11);
    assert.equal(d.getUTCHours(), 0);
  });

  test('dateOnlyToUtcMs — null su input vuoto', () => {
    assert.equal(dateOnlyToUtcMs(''), null);
    assert.equal(dateOnlyToUtcMs(null), null);
  });

  test('addDaysToDateOnly attraversa correttamente un cambio di mese/anno', () => {
    assert.equal(addDaysToDateOnly('2026-12-30', 5), '2027-01-04');
  });

  test('addDaysToDateOnly con giorni negativi va indietro nel tempo', () => {
    assert.equal(addDaysToDateOnly('2026-03-01', -1), '2026-02-28');
  });

  test('daysUntilDateOnly è coerente con addDaysToDateOnly', () => {
    const today = getDateKey(new Date());
    const future = addDaysToDateOnly(today, 10);
    assert.equal(daysUntilDateOnly(future), 10);
  });
});

describe('monthKeyFromDateKey', () => {
  test('estrae correttamente lo YYYY-MM da una data-only', () => {
    assert.equal(monthKeyFromDateKey('2026-09-11'), '2026-09');
  });
  test('null su input vuoto', () => {
    assert.equal(monthKeyFromDateKey(''), null);
    assert.equal(monthKeyFromDateKey(null), null);
  });
});

describe('formatHoursMinutes', () => {
  test('formatta ore e minuti insieme', () => {
    assert.equal(formatHoursMinutes(2.25), '2h 15m');
  });
  test('solo minuti se meno di un\'ora', () => {
    assert.equal(formatHoursMinutes(0.5), '30m');
  });
  test('solo ore se i minuti sono zero', () => {
    assert.equal(formatHoursMinutes(3), '3h');
  });
  test('input non validi producono un placeholder, mai NaN', () => {
    assert.equal(formatHoursMinutes(null), '—');
    assert.equal(formatHoursMinutes(NaN), '—');
    assert.equal(formatHoursMinutes(undefined), '—');
  });
  test('valori negativi vengono trattati come zero', () => {
    assert.equal(formatHoursMinutes(-5), '0m');
  });
});

describe('msUntilNextLocalMidnight', () => {
  test('restituisce esattamente 1 ora di millisecondi alle 23:00', () => {
    const from = new Date(2026, 8, 11, 23, 0, 0, 0);
    assert.equal(msUntilNextLocalMidnight(from), 3600000);
  });
  test('non è mai negativo', () => {
    const from = new Date(2026, 8, 11, 0, 0, 0, 0);
    assert.ok(msUntilNextLocalMidnight(from) >= 0);
  });
});
