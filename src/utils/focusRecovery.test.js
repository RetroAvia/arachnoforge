// =====================================================================
// ArachnoForge — src/utils/focusRecovery.test.js (V41)
// Recupero di una sessione di Focus dopo una chiusura imprevista.
// =====================================================================
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { planRunningBlockRestore, isCheckpointStale, CHECKPOINT_MAX_AGE_MS, isForeignLeaseAlive, LEASE_TTL_MS } from './focusRecovery.js';

const NOW = 1_800_000_000_000;
const MIN = 60_000;

function record(patch = {}) {
  return { mode: 'FOCUS', endsAt: NOW + 10 * MIN, pausedRemainingMs: null, totalSeconds: 1500, overdrive: false, savedAt: NOW - 15 * MIN, ...patch };
}

describe('planRunningBlockRestore', () => {
  test('blocco ancora in corso: riparte con lo stesso istante di fine', () => {
    const plan = planRunningBlockRestore(record(), NOW);
    assert.equal(plan.action, 'resume');
    assert.equal(plan.endsAt, NOW + 10 * MIN);
    assert.equal(plan.remainingMs, 10 * MIN);
  });
  test('un orologio spostato non allunga il blocco oltre la sua durata', () => {
    const plan = planRunningBlockRestore(record({ endsAt: NOW + 90 * MIN }), NOW);
    assert.equal(plan.action, 'resume');
    assert.equal(plan.remainingMs, 1500 * 1000);
  });
  test('blocco in pausa: torna in pausa con lo stesso residuo', () => {
    const plan = planRunningBlockRestore(record({ endsAt: null, pausedRemainingMs: 7 * MIN }), NOW);
    assert.deepEqual(plan, { action: 'paused', remainingMs: 7 * MIN });
  });
  test('Focus finito ad app chiusa: minuti da salvare', () => {
    const plan = planRunningBlockRestore(record({ endsAt: NOW - 5 * MIN, savedAt: NOW - 30 * MIN }), NOW);
    assert.deepEqual(plan, { action: 'complete', minutes: 25 });
  });
  test('una pausa finita ad app chiusa non lascia niente', () => {
    const plan = planRunningBlockRestore(record({ mode: 'BREAK', endsAt: NOW - MIN, totalSeconds: 300 }), NOW);
    assert.equal(plan.action, 'discard');
  });
  test('record troppo vecchio o illeggibile: niente da recuperare', () => {
    assert.equal(planRunningBlockRestore(record({ savedAt: NOW - CHECKPOINT_MAX_AGE_MS - 1 }), NOW).action, 'discard');
    assert.equal(planRunningBlockRestore(record({ totalSeconds: 0 }), NOW).action, 'discard');
    assert.equal(planRunningBlockRestore(record({ mode: 'ALTRO' }), NOW).action, 'discard');
    assert.equal(planRunningBlockRestore(record({ endsAt: 'ieri' }), NOW).action, 'discard');
    assert.equal(planRunningBlockRestore(null, NOW).action, 'discard');
  });
});

describe('isCheckpointStale', () => {
  test('entro e oltre la finestra', () => {
    assert.equal(isCheckpointStale({ savedAt: NOW - MIN }, NOW), false);
    assert.equal(isCheckpointStale({ savedAt: NOW - CHECKPOINT_MAX_AGE_MS - 1 }, NOW), true);
  });
  test('senza timestamp (versioni precedenti) si accetta una volta', () => {
    assert.equal(isCheckpointStale({}, NOW), false);
  });
});

describe('isForeignLeaseAlive — una sola finestra alla volta', () => {
  test('un’altra finestra viva ha la sessione', () => {
    assert.equal(isForeignLeaseAlive({ tabId: 'altra', at: NOW - 5000 }, 'questa', NOW), true);
  });
  test('il possesso di questa stessa finestra (ricaricata) non blocca', () => {
    assert.equal(isForeignLeaseAlive({ tabId: 'questa', at: NOW - 5000 }, 'questa', NOW), false);
  });
  test('un possesso non rinnovato è di una finestra chiusa', () => {
    assert.equal(isForeignLeaseAlive({ tabId: 'altra', at: NOW - LEASE_TTL_MS - 1 }, 'questa', NOW), false);
  });
  test('nessun possesso', () => {
    assert.equal(isForeignLeaseAlive(null, 'questa', NOW), false);
  });
  test('orologio spostato indietro: vale la stessa finestra di tempo', () => {
    assert.equal(isForeignLeaseAlive({ tabId: 'altra', at: NOW + 5000 }, 'questa', NOW), true);
    assert.equal(isForeignLeaseAlive({ tabId: 'altra', at: NOW + LEASE_TTL_MS + 1 }, 'questa', NOW), false);
  });
});
