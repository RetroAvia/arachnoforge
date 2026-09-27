// =====================================================================
// ArachnoForge — src/utils/localBackups.test.js (V41)
// Punti di ripristino: riepilogo e rotazione (la parte pura).
// =====================================================================
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeState, snapshotsToPrune, SNAPSHOT_REASON, SNAPSHOT_REASON_LABEL } from './localBackups.js';

describe('summarizeState', () => {
  test('conta materie, nodi e minuti di Focus', () => {
    const s = summarizeState({
      profile: { username: 'Gabriele', level: 14 },
      materie: [{ sfide: [{}, {}] }, { sfide: [{}] }, null],
      starLog: [{ type: 'FOCUS_MINUTES', minutes: 50 }, { type: 'FOCUS_MINUTES', minutes: 25.4 }, { type: 'FOCUS_SESSION' }, null]
    });
    assert.deepEqual(s, { username: 'Gabriele', level: 14, materie: 3, nodi: 3, minutiFocus: 75 });
  });
  test('stato vuoto o corrotto', () => {
    assert.deepEqual(summarizeState(null), { username: '', level: 1, materie: 0, nodi: 0, minutiFocus: 0 });
  });
});

describe('snapshotsToPrune', () => {
  const mk = (id, reason, createdAt) => ({ id, reason, createdAt });
  test('tiene le più recenti di ciascun tipo', () => {
    const list = [
      mk('a1', SNAPSHOT_REASON.AUTO, 1),
      mk('a2', SNAPSHOT_REASON.AUTO, 2),
      mk('a3', SNAPSHOT_REASON.AUTO, 3),
      mk('s1', SNAPSHOT_REASON.PRE_DELETE, 4),
      mk('s2', SNAPSHOT_REASON.MANUAL, 5)
    ];
    assert.deepEqual(snapshotsToPrune(list, 2, 1).sort(), ['a1', 's1']);
  });
  test('niente da eliminare sotto i limiti', () => {
    assert.deepEqual(snapshotsToPrune([mk('a', SNAPSHOT_REASON.AUTO, 1)]), []);
    assert.deepEqual(snapshotsToPrune(null), []);
  });
  test('ogni motivo ha la sua etichetta', () => {
    Object.values(SNAPSHOT_REASON).forEach((r) => assert.ok(SNAPSHOT_REASON_LABEL[r], r));
  });
});
