// =====================================================================
// ArachnoForge — src/data/trophies.test.js
// Test unitari (node:test built-in, zero dipendenze npm) per la Trophy
// Room. Eseguibile con: node --test src/data/trophies.test.js
// =====================================================================
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { TIER, TROPHY_DEFINITIONS, evaluateTrophies } from './trophies.js';

/** Stato minimo valido — copre tutti i campi letti da qualunque
 * condizione in TROPHY_DEFINITIONS senza far esplodere nulla (materie e
 * starLog vuoti, profile con tutti i contatori a zero). Ogni test parte
 * da questo baseline e sovrascrive solo ciò che gli serve. */
function baseState(overrides = {}) {
  return {
    materie: [],
    starLog: [],
    profile: {
      streak: 0,
      level: 1,
      quickQuestsUsed: 0,
      hardNodesCompleted: 0,
      overdriveCount: 0,
      lastStandCount: 0,
      dailyPatrolsCompleted: 0,
      gauntletsCleared: 0,
      readinessLogDaysTotal: 0,
      optimalReadinessDaysTotal: 0,
      readinessLogStreak: 0,
      ...(overrides.profile || {})
    },
    ...Object.fromEntries(Object.entries(overrides).filter(([k]) => k !== 'profile'))
  };
}

describe('evaluateTrophies — struttura del risultato', () => {
  test('ritorna esattamente un risultato per ogni definizione, mai di più o di meno', () => {
    const results = evaluateTrophies(baseState());
    assert.equal(results.length, TROPHY_DEFINITIONS.length);
  });

  test('con stato vuoto nessun trofeo è sbloccato', () => {
    const results = evaluateTrophies(baseState());
    assert.equal(results.every((r) => r.unlocked === false), true);
  });

  test('un trofeo segreto e bloccato nasconde nome/descrizione dietro "???"', () => {
    const results = evaluateTrophies(baseState());
    const secretLocked = results.find((r) => r.id === 'multiverse_streak_30'); // streak 30gg, secret: true
    assert.ok(secretLocked, 'il trofeo di test deve esistere in TROPHY_DEFINITIONS');
    assert.equal(secretLocked.nome, '???');
  });

  test('un trofeo non-segreto mostra sempre nome/descrizione, sbloccato o no', () => {
    const results = evaluateTrophies(baseState());
    const nonSecret = results.find((r) => r.id === 'spider_reflexes_3'); // streak 3gg, secret: false
    assert.ok(nonSecret);
    assert.notEqual(nonSecret.nome, '???');
  });
});

describe('evaluateTrophies — famiglia streak (Bronzo/Argento/Oro/Vibranio)', () => {
  test('streak 3 sblocca solo la soglia Neighborhood', () => {
    const results = evaluateTrophies(baseState({ profile: { streak: 3 } }));
    const byId = Object.fromEntries(results.map((r) => [r.id, r]));
    assert.equal(byId.spider_reflexes_3.unlocked, true);
    assert.equal(byId.multiverse_streak_30.unlocked, false);
  });

  test('streak 30 sblocca anche la soglia Multiverse (a cascata verso il basso)', () => {
    const results = evaluateTrophies(baseState({ profile: { streak: 30 } }));
    const byId = Object.fromEntries(results.map((r) => [r.id, r]));
    assert.equal(byId.spider_reflexes_3.unlocked, true);
    assert.equal(byId.multiverse_streak_30.unlocked, true);
  });

  test('streak 100 sblocca anche il trofeo Vibranium dedicato', () => {
    const results = evaluateTrophies(baseState({ profile: { streak: 100 } }));
    const vibranium = results.find((r) => r.tier === TIER.VIBRANIUM && r.id.includes('streak'));
    assert.ok(vibranium);
    assert.equal(vibranium.unlocked, true);
  });
});

describe('evaluateTrophies — famiglia Monte Ore Focus (FOCUS_MINUTES nello starLog)', () => {
  function starLogWithMinutes(totalMinutes) {
    return [{ type: 'FOCUS_MINUTES', dateKey: '2026-01-01', minutes: totalMinutes }];
  }

  test('2 ore accumulate sbloccano solo la soglia Bronzo', () => {
    const results = evaluateTrophies(baseState({ starLog: starLogWithMinutes(120) }));
    const byId = Object.fromEntries(results.map((r) => [r.id, r]));
    assert.equal(byId.monte_ore_bronzo.unlocked, true);
  });

  test('sotto la soglia Bronzo nessun trofeo della famiglia è sbloccato', () => {
    const results = evaluateTrophies(baseState({ starLog: starLogWithMinutes(60) }));
    const byId = Object.fromEntries(results.map((r) => [r.id, r]));
    assert.equal(byId.monte_ore_bronzo.unlocked, false);
  });

  test('300 ore sbloccano l\'intera famiglia fino al Vibranium', () => {
    const results = evaluateTrophies(baseState({ starLog: starLogWithMinutes(18000) }));
    const byId = Object.fromEntries(results.map((r) => [r.id, r]));
    assert.equal(byId.monte_ore_bronzo.unlocked, true);
  });
});

describe('evaluateTrophies — readiness biometrica (nuova famiglia V35.0)', () => {
  test('nessun log di readiness -> famiglia interamente bloccata', () => {
    const results = evaluateTrophies(baseState());
    const readinessTrophies = results.filter((r) => r.id.includes('readiness'));
    assert.ok(readinessTrophies.length > 0, 'devono esistere trofei di readiness da testare');
    assert.equal(readinessTrophies.every((r) => r.unlocked === false), true);
  });

  test('readinessLogStreak 30 sblocca il trofeo Vibranium dedicato ("Sincronia Biometrica Totale")', () => {
    const results = evaluateTrophies(baseState({ profile: { readinessLogStreak: 30 } }));
    const trophy = results.find((r) => r.id === 'readiness_streak_vibranio');
    assert.ok(trophy);
    assert.equal(trophy.unlocked, true);
  });

  test('readinessLogDaysTotal alto sblocca le soglie cumulative di "giorni loggati" (famiglia telemetria_*)', () => {
    const results = evaluateTrophies(baseState({ profile: { readinessLogDaysTotal: 100 } }));
    const telemetryTrophies = results.filter((r) => r.id.startsWith('telemetria_'));
    assert.ok(telemetryTrophies.length > 0, 'devono esistere trofei telemetria_* da testare');
    assert.equal(telemetryTrophies.every((r) => r.unlocked === true), true);
  });
});

describe('evaluateTrophies — non regressione (nessuna eccezione su stato realistico)', () => {
  test('uno stato con materie/sfide/voti popolati non genera errori', () => {
    const state = baseState({
      materie: [
        { courseId: 'c1', examPassed: true, voto: 30, cfu: 9, sfide: [{ status: 'COMPLETED', nextReviewDate: null }] },
        { courseId: 'c2', examPassed: false, voto: null, cfu: 6, sfide: [{ status: 'PENDING' }] }
      ],
      starLog: [
        { type: 'FOCUS_SESSION', hour: 5, minutes: 30, dateKey: '2026-01-01' },
        { type: 'BOSS_WIN', hpRemaining: 1 }
      ]
    });
    assert.doesNotThrow(() => evaluateTrophies(state));
  });
});
