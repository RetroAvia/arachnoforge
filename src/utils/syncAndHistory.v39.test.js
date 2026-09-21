import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stableStringify, sameAppState, stripSync, classifyRemoteWrite, getDeviceId } from './syncIdentity.js';
import { effectivePassedDate, computeGradeHistory, computeGraduationForecast } from './gpaEngine.js';

/* ---------------------------------------------------------------- *
 * Sincronizzazione: niente più falsi conflitti con un solo dispositivo
 * ---------------------------------------------------------------- */

test('stableStringify ignora l’ordine delle chiavi (jsonb le riordina)', () => {
  const a = { b: 1, a: { d: [1, { y: 2, x: 1 }], c: 'z' } };
  const b = { a: { c: 'z', d: [1, { x: 1, y: 2 }] }, b: 1 };
  assert.equal(stableStringify(a), stableStringify(b));
  assert.equal(stableStringify({ a: undefined, b: 2 }), stableStringify({ b: 2 }));
});

test('sameAppState esclude la firma _sync', () => {
  const base = { profile: { xp: 10 }, materie: [] };
  assert.ok(sameAppState({ ...base, _sync: { writer: 'x' } }, { ...base, _sync: { writer: 'y' } }));
  assert.ok(!sameAppState({ ...base, profile: { xp: 11 } }, base));
  assert.deepEqual(stripSync({ a: 1, _sync: {} }), { a: 1 });
});

test('classifyRemoteWrite: la nostra scrittura non è un conflitto', () => {
  const remote = { profile: { xp: 1 }, _sync: { writer: 's1', device: 'd1' } };
  assert.equal(classifyRemoteWrite(remote, { sessionId: 's1', deviceId: 'd1' }), 'own');
});

test('classifyRemoteWrite: stesso contenuto già noto = nessun conflitto', () => {
  const known = { profile: { xp: 5 }, materie: [{ id: 'm', nome: 'A' }] };
  const remote = { materie: [{ nome: 'A', id: 'm' }], profile: { xp: 5 }, _sync: { writer: 'altro', device: 'd9' } };
  assert.equal(classifyRemoteWrite(remote, { sessionId: 's1', deviceId: 'd1', knownStates: [known] }), 'own');
});

test('classifyRemoteWrite: altra scheda dello stesso browser vs altro dispositivo', () => {
  const sameDev = { profile: { xp: 2 }, _sync: { writer: 's2', device: 'd1' } };
  const other = { profile: { xp: 2 }, _sync: { writer: 's3', device: 'd7' } };
  assert.equal(classifyRemoteWrite(sameDev, { sessionId: 's1', deviceId: 'd1' }), 'sameDevice');
  assert.equal(classifyRemoteWrite(other, { sessionId: 's1', deviceId: 'd1' }), 'foreign');
  // Versione scritta da una build precedente (senza firma): estranea.
  assert.equal(classifyRemoteWrite({ profile: {} }, { sessionId: 's1', deviceId: 'd1' }), 'foreign');
});

test('getDeviceId è stabile e non lancia con storage bloccato', () => {
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const a = getDeviceId(storage);
  assert.equal(getDeviceId(storage), a);
  const broken = {
    getItem: () => {
      throw new Error('blocked');
    }
  };
  assert.match(getDeviceId(broken), /^d_volatile_/);
});

/* ---------------------------------------------------------------- *
 * Storico della media e ritmo di carriera collegati al Web-Matrix
 * ---------------------------------------------------------------- */

const TODAY = '2026-09-21';
const m = (id, cfu, voto, extra = {}) => ({ id, nome: id, cfu, voto, examPassed: true, sfide: [], ...extra });

test('effectivePassedDate: verbale, poi appello già passato, mai un appello futuro', () => {
  assert.deepEqual(effectivePassedDate(m('a', 6, 28, { examPassedDate: '2026-02-10', examDate: '2026-02-01' }), TODAY), {
    dateKey: '2026-02-10',
    fonte: 'VERBALE'
  });
  assert.deepEqual(effectivePassedDate(m('b', 6, 28, { examDate: '2026-06-15' }), TODAY), { dateKey: '2026-06-15', fonte: 'APPELLO' });
  assert.deepEqual(effectivePassedDate(m('c', 6, 28, { examDate: '2026-12-15' }), TODAY), { dateKey: null, fonte: null });
  assert.deepEqual(effectivePassedDate({ ...m('d', 6, 28), examPassed: false, examPassedDate: '2026-01-01' }, TODAY), {
    dateKey: null,
    fonte: null
  });
});

test('computeGradeHistory: un punto per data, media cumulata ponderata', () => {
  const materie = [
    m('Analisi', 9, 24, { examPassedDate: '2026-02-10' }),
    m('Fisica', 6, 30, { examPassedDate: '2026-06-20' }),
    m('Chimica', 6, 27, { examDate: '2026-02-10' }), // stessa data della prima, stimata dall'appello
    { id: 'x', nome: 'Aperta', cfu: 6, examPassed: false, sfide: [] }
  ];
  const h = computeGradeHistory(materie, TODAY);
  assert.equal(h.points.length, 2);
  assert.equal(h.points[0].dateKey, '2026-02-10');
  assert.equal(h.points[0].gradedCount, 2);
  assert.ok(Math.abs(h.points[0].average - (9 * 24 + 6 * 27) / 15) < 1e-9);
  assert.ok(Math.abs(h.points[1].average - (9 * 24 + 6 * 27 + 6 * 30) / 21) < 1e-9);
  assert.equal(h.stimateDaAppello, 1);
  assert.equal(h.undatedCount, 0);
});

test('computeGradeHistory: esami inseriti già superati compaiono tutti (non solo uno)', () => {
  const materie = [
    m('A', 6, 25, { examPassedDate: '2025-07-01' }),
    m('B', 6, 27, { examPassedDate: '2025-09-15' }),
    m('C', 12, 29, { examPassedDate: '2026-01-20' })
  ];
  assert.equal(computeGradeHistory(materie, TODAY).points.length, 3);
});

test('computeGradeHistory: gli esami senza data finiscono in un ultimo punto dichiarato', () => {
  const materie = [m('A', 6, 24, { examPassedDate: '2026-02-10' }), m('B', 6, 30)];
  const h = computeGradeHistory(materie, TODAY);
  assert.equal(h.points.length, 2);
  assert.equal(h.points[1].senzaData, 1);
  assert.equal(h.points[1].dateKey, TODAY);
  assert.ok(Math.abs(h.points[1].average - 27) < 1e-9);
});

test('ritmo di carriera: calcolabile anche con la sola data dell’appello', () => {
  const materie = [
    m('A', 6, 25, { examDate: '2025-07-01' }),
    m('B', 6, 27, { examDate: '2025-09-15' }),
    m('C', 12, 29, { examPassedDate: '2026-01-20' })
  ];
  const f = computeGraduationForecast(materie, null, 180);
  assert.ok(f.byCareer, 'con tre esami datati il ritmo di carriera deve esistere');
  assert.equal(f.byCareer.esamiOsservati, 3);
  assert.equal(f.byCareer.stimateDaAppello, 2);
  assert.equal(f.esamiConData, 3);
  assert.equal(f.esamiSuperati, 3);
});

test('ritmo di carriera: dichiara quanti esami hanno una data quando non basta', () => {
  const materie = [m('A', 6, 25, { examPassedDate: '2026-01-10' }), m('B', 6, 27)];
  const f = computeGraduationForecast(materie, null, 180);
  assert.equal(f.byCareer, null);
  assert.equal(f.esamiConData, 1);
  assert.equal(f.esamiSuperati, 2);
});

test('classifyRemoteWrite accetta più sessioni proprie (checkpoint recuperato)', () => {
  const remote = { profile: {}, _sync: { writer: 'old-session', device: 'd1' } };
  assert.equal(classifyRemoteWrite(remote, { sessionId: ['new-session', 'old-session'], deviceId: 'd1' }), 'own');
  assert.equal(classifyRemoteWrite(remote, { sessionId: ['new-session', null], deviceId: 'd1' }), 'sameDevice');
});
