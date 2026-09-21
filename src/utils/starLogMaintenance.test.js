import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pruneStarLog, oldestDetailedMonth, SESSION_RETENTION_DAYS, MAX_SESSION_ENTRIES } from './starLogMaintenance.js';

const DAY_MS = 86400000;
const NOW = Date.UTC(2026, 8, 20); // 2026-09-20, fisso: i test non devono dipendere da "oggi"

function key(offsetGiorni) {
  return new Date(NOW - offsetGiorni * DAY_MS).toISOString().slice(0, 10);
}

function sessione(offsetGiorni) {
  return { type: 'FOCUS_SESSION', dateKey: key(offsetGiorni), minutes: 50, xp: 120 };
}

function aggregato(offsetGiorni) {
  return { type: 'FOCUS_MINUTES', dateKey: key(offsetGiorni), minutes: 50, xp: 120 };
}

describe('pruneStarLog', () => {
  test('uno storico corto non viene toccato', () => {
    const log = [aggregato(3), sessione(3), aggregato(1), sessione(1)];
    const out = pruneStarLog(log, NOW);
    assert.equal(out.pruned, 0);
    assert.equal(out.starLog, log, 'ha ricostruito inutilmente l\'array');
  });

  test('gli aggregati giornalieri non vengono MAI potati', () => {
    // È il contratto che tiene in vita Heatmap, minuti totali e
    // calibrazione della capacità: quei numeri devono restare completi
    // per sempre, indipendentemente dall'età.
    const log = [];
    for (let i = 0; i < 900; i += 1) {
      log.push(aggregato(i));
      log.push(sessione(i));
    }
    const out = pruneStarLog(log, NOW);
    const aggregatiPrima = log.filter((e) => e.type === 'FOCUS_MINUTES').length;
    const aggregatiDopo = out.starLog.filter((e) => e.type === 'FOCUS_MINUTES').length;
    assert.equal(aggregatiDopo, aggregatiPrima);
    assert.ok(out.pruned > 0, 'non ha potato nulla su 900 giorni di storico');
  });

  test('pota le sessioni oltre la finestra di ritenzione', () => {
    const log = [sessione(SESSION_RETENTION_DAYS + 30), sessione(SESSION_RETENTION_DAYS + 10), sessione(5)];
    const out = pruneStarLog(log, NOW);
    const rimaste = out.starLog.filter((e) => e.type === 'FOCUS_SESSION');
    assert.equal(rimaste.length, 1);
    assert.equal(rimaste[0].dateKey, key(5));
  });

  test('pota sempre le PIÙ VECCHIE, mai le recenti', () => {
    const log = [];
    // `+ 1 + i`: una sessione esattamente sul giorno di taglio è ancora
    // dentro la finestra (il confronto è `<`, non `<=`), quindi viene
    // conservata. Qui interessano solo quelle oltre il bordo.
    for (let i = 0; i < 40; i += 1) log.push(sessione(SESSION_RETENTION_DAYS + 1 + i));
    for (let i = 0; i < 10; i += 1) log.push(sessione(i));
    const out = pruneStarLog(log, NOW);
    const rimaste = out.starLog.filter((e) => e.type === 'FOCUS_SESSION');
    assert.equal(rimaste.length, 10);
    assert.ok(rimaste.every((e) => e.dateKey >= key(9)), 'sono state tolte sessioni recenti');
  });

  test('una sessione esattamente sul bordo della finestra viene conservata', () => {
    const log = [sessione(SESSION_RETENTION_DAYS), sessione(SESSION_RETENTION_DAYS + 1)];
    const out = pruneStarLog(log, NOW);
    const rimaste = out.starLog.filter((e) => e.type === 'FOCUS_SESSION');
    assert.equal(rimaste.length, 1);
    assert.equal(rimaste[0].dateKey, key(SESSION_RETENTION_DAYS));
  });

  test('le voci Boss non vengono mai toccate', () => {
    const log = [
      { type: 'BOSS_WIN', dateKey: key(SESSION_RETENTION_DAYS + 100), xp: 500 },
      sessione(SESSION_RETENTION_DAYS + 100),
      sessione(1)
    ];
    const out = pruneStarLog(log, NOW);
    assert.ok(out.starLog.some((e) => e.type === 'BOSS_WIN'));
  });

  test('il tetto duro vale anche dentro la finestra', () => {
    const log = [];
    for (let i = 0; i < MAX_SESSION_ENTRIES + 120; i += 1) log.push(sessione(i % 300));
    const out = pruneStarLog(log, NOW);
    const rimaste = out.starLog.filter((e) => e.type === 'FOCUS_SESSION').length;
    assert.ok(rimaste <= MAX_SESSION_ENTRIES, `rimaste ${rimaste}, oltre il tetto`);
  });

  test('regge input corrotti senza lanciare', () => {
    assert.equal(pruneStarLog(null, NOW).pruned, 0);
    assert.equal(pruneStarLog(undefined, NOW).pruned, 0);
    assert.equal(pruneStarLog([], NOW).pruned, 0);
  });
});

describe('oldestDetailedMonth', () => {
  test('ritorna il mese della sessione più vecchia rimasta', () => {
    assert.equal(oldestDetailedMonth([sessione(40), sessione(1)]), key(40).slice(0, 7));
  });

  test('null quando non ci sono sessioni', () => {
    assert.equal(oldestDetailedMonth([aggregato(1)]), null);
    assert.equal(oldestDetailedMonth([]), null);
  });
});
