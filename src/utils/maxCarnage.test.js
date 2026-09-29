// =====================================================================
// ArachnoForge — src/utils/maxCarnage.test.js (V42)
// Maximum Carnage: le azioni critiche contano nella stessa giornata, alla
// quinta si guadagna UNA carica, che si attiva a scelta fra le 6 e le 23.
// =====================================================================
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  bumpCriticalActionStreak,
  activateMaxCarnage,
  deactivateMaxCarnage,
  isMaxCarnageActive,
  maxCarnageMsRemaining,
  isCarnageHour,
  formatMsRemaining,
  CRITICAL_ACTION_THRESHOLD,
  MAX_CARNAGE_CHARGES,
  MAX_CARNAGE_DURATION_MS
} from './maxCarnage.js';

/** Un istante locale: giorno 5 ottobre 2026 all'ora indicata. */
const ore = (h, giorno = 5, min = 0) => new Date(2026, 9, giorno, h, min, 0).getTime();

describe('le azioni critiche', () => {
  test(`alla ${CRITICAL_ACTION_THRESHOLD}ª azione critica della giornata si guadagna una carica`, () => {
    let p = {};
    for (let i = 1; i < CRITICAL_ACTION_THRESHOLD; i += 1) {
      const r = bumpCriticalActionStreak(p, 1, ore(10));
      assert.equal(r.chargeEarned, false);
      assert.equal(r.criticalActionStreak, i);
      p = { ...p, ...r };
    }
    const r = bumpCriticalActionStreak(p, 1, ore(11));
    assert.equal(r.chargeEarned, true);
    assert.equal(r.carnageCharges, 1);
    assert.equal(r.criticalActionStreak, 0, 'il contatore riparte');
    assert.equal(r.justActivated, false, 'la carica non si attiva da sola');
  });

  test('il contatore non attraversa i giorni', () => {
    const ieri = { criticalActionStreak: 4, criticalActionDateKey: '2026-10-04' };
    const r = bumpCriticalActionStreak(ieri, 1, ore(9));
    assert.equal(r.chargeEarned, false);
    assert.equal(r.criticalActionStreak, 1);
    assert.equal(r.criticalActionDateKey, '2026-10-05');
  });

  test(`al massimo ${MAX_CARNAGE_CHARGES} carica in cassa`, () => {
    const pieno = { criticalActionStreak: 4, criticalActionDateKey: '2026-10-05', carnageCharges: MAX_CARNAGE_CHARGES };
    const r = bumpCriticalActionStreak(pieno, 1, ore(15));
    assert.equal(r.chargeEarned, false);
    assert.equal(r.carnageCharges, undefined, 'la patch non tocca le cariche');
    assert.equal(r.criticalActionStreak, CRITICAL_ACTION_THRESHOLD);
  });

  test('un valore negativo non toglie azioni già fatte', () => {
    const r = bumpCriticalActionStreak({ criticalActionStreak: 2, criticalActionDateKey: '2026-10-05' }, -5, ore(12));
    assert.equal(r.criticalActionStreak, 2);
  });
});

describe('l’attivazione', () => {
  test('senza carica non si attiva', () => {
    assert.deepEqual(activateMaxCarnage({ carnageCharges: 0 }, ore(10)), { ok: false, reason: 'NO_CHARGE' });
  });

  test('fra le 23 e le 6 non si attiva: niente premi per lo studio notturno', () => {
    assert.equal(activateMaxCarnage({ carnageCharges: 1 }, ore(23)).reason, 'NIGHT');
    assert.equal(activateMaxCarnage({ carnageCharges: 1 }, ore(5, 5, 59)).reason, 'NIGHT');
    assert.equal(isCarnageHour(ore(6)), true);
    assert.equal(isCarnageHour(ore(22, 5, 59)), true);
  });

  test('con una carica, di giorno: due ore di finestra e la carica consumata', () => {
    const now = ore(10);
    const r = activateMaxCarnage({ carnageCharges: 1, carnageActivations: 2 }, now);
    assert.equal(r.ok, true);
    assert.equal(r.patch.carnageCharges, 0);
    assert.equal(r.patch.maxCarnageActive, true);
    assert.equal(Date.parse(r.patch.maxCarnageExpiresAt) - now, MAX_CARNAGE_DURATION_MS);
    assert.equal(r.patch.carnageActivations, 3);
  });

  test('già attiva: non si consuma una seconda carica', () => {
    const attiva = { carnageCharges: 1, maxCarnageActive: true, maxCarnageExpiresAt: new Date(Date.now() + 60_000).toISOString() };
    assert.equal(activateMaxCarnage(attiva, ore(10)).reason, 'ALREADY_ACTIVE');
  });
});

describe('lo stato della finestra', () => {
  test('attiva solo con flag e scadenza coerenti e nel futuro', () => {
    const futura = new Date(Date.now() + 30 * 60_000).toISOString();
    assert.equal(isMaxCarnageActive({ maxCarnageActive: true, maxCarnageExpiresAt: futura }), true);
    assert.equal(isMaxCarnageActive({ maxCarnageActive: true, maxCarnageExpiresAt: new Date(Date.now() - 1000).toISOString() }), false);
    assert.equal(isMaxCarnageActive({ maxCarnageActive: true, maxCarnageExpiresAt: 'boh' }), false);
    assert.equal(isMaxCarnageActive({ maxCarnageActive: false, maxCarnageExpiresAt: futura }), false);
    assert.equal(isMaxCarnageActive(null), false);
    const resto = maxCarnageMsRemaining({ maxCarnageActive: true, maxCarnageExpiresAt: futura });
    assert.ok(resto > 29 * 60_000 && resto <= 30 * 60_000);
    assert.equal(maxCarnageMsRemaining({}), 0);
  });

  test('disattivazione e countdown', () => {
    assert.deepEqual(deactivateMaxCarnage(), { maxCarnageActive: false, maxCarnageExpiresAt: null });
    assert.equal(formatMsRemaining(MAX_CARNAGE_DURATION_MS - 1000), '01:59:59');
    assert.equal(formatMsRemaining(0), '00:00:00');
    assert.equal(formatMsRemaining(-5), '00:00:00');
  });
});
