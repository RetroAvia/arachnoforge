import { test } from 'node:test';
import assert from 'node:assert/strict';

const mem = new Map();
globalThis.window = {
  localStorage: {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k)
  }
};
const { saveCloudCheckpoint, loadCloudCheckpoint, clearCloudCheckpoint } = await import('./cloudCheckpoint.js');

test('il checkpoint conserva token di base e sessione autrice', () => {
  saveCloudCheckpoint('u1', 'cloud', { profile: { xp: 3 } }, { baseVersion: '2026-09-21T10:00:01+00:00', writer: 's_1' });
  const cp = loadCloudCheckpoint('u1', 'cloud');
  assert.equal(cp.baseVersion, '2026-09-21T10:00:01+00:00');
  assert.equal(cp.writer, 's_1');
  assert.deepEqual(cp.state, { profile: { xp: 3 } });
  clearCloudCheckpoint('u1', 'cloud');
  assert.equal(loadCloudCheckpoint('u1', 'cloud'), null);
});

test('checkpoint nel formato precedente: base e autore null, stato intatto', () => {
  saveCloudCheckpoint('u2', 'cloud', { a: 1 });
  const cp = loadCloudCheckpoint('u2', 'cloud');
  assert.equal(cp.baseVersion, null);
  assert.equal(cp.writer, null);
  assert.deepEqual(cp.state, { a: 1 });
});
