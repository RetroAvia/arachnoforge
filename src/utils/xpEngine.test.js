// =====================================================================
// ArachnoForge — src/utils/xpEngine.test.js
// Test unitari (node:test built-in, zero dipendenze npm) per il motore
// XP centralizzato. Eseguibile con: node --test src/utils/xpEngine.test.js
// =====================================================================
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  xpRequiredForLevel,
  applyXpDelta,
  applyXpDeltaWithTokens,
  computeFocusXp,
  computeStreakMultiplier,
  computeCfuMultiplier,
  computeFocusStaminaCost,
  computeSpiderSenseSurgeXp,
  computeBloodPactPenalty,
  computeReviewXp,
  computeTotalBankedXp,
  getRankMeta,
  getRankTitle,
  DIFFICULTY,
  FOCUS_QUALITY,
  MAX_CARNAGE_MULTIPLIER
} from './xpEngine.js';

describe('xpRequiredForLevel', () => {
  test('calibrazione nota: Lv.1 = 1000 XP esatti', () => {
    assert.equal(xpRequiredForLevel(1), 1000);
  });

  test('è sempre un multiplo di 50 (numeri "puliti" in UI)', () => {
    for (const lvl of [1, 5, 10, 25, 30, 50, 80]) {
      assert.equal(xpRequiredForLevel(lvl) % 50, 0);
    }
  });

  test('è strettamente crescente al crescere del livello', () => {
    let prev = 0;
    for (let lvl = 1; lvl <= 60; lvl += 1) {
      const req = xpRequiredForLevel(lvl);
      assert.ok(req > prev, `xpRequiredForLevel(${lvl}) = ${req} dovrebbe superare il livello precedente ${prev}`);
      prev = req;
    }
  });

  test('livelli <= 0 vengono trattati come livello 1 (mai un risultato assurdo)', () => {
    assert.equal(xpRequiredForLevel(0), xpRequiredForLevel(1));
    assert.equal(xpRequiredForLevel(-5), xpRequiredForLevel(1));
  });
});

describe('applyXpDelta', () => {
  test('accumula XP senza salire di livello se sotto soglia', () => {
    const result = applyXpDelta({ level: 1, currentXp: 0 }, 500);
    assert.equal(result.level, 1);
    assert.equal(result.currentXp, 500);
  });

  test('sale di livello quando l\'XP supera la soglia, riportando l\'eccedenza', () => {
    const req1 = xpRequiredForLevel(1);
    const result = applyXpDelta({ level: 1, currentXp: 0 }, req1 + 100);
    assert.equal(result.level, 2);
    assert.equal(result.currentXp, 100);
  });

  test('gestisce il cascading di più level-up in un solo delta (XP-bomb)', () => {
    const req1 = xpRequiredForLevel(1);
    const req2 = xpRequiredForLevel(2);
    const result = applyXpDelta({ level: 1, currentXp: 0 }, req1 + req2 + 50);
    assert.equal(result.level, 3);
    assert.equal(result.currentXp, 50);
  });

  test('un delta negativo che sfonda lo zero fa scendere di livello (mai sotto 1)', () => {
    const result = applyXpDelta({ level: 2, currentXp: 10 }, -60);
    assert.equal(result.level, 1);
    assert.ok(result.currentXp >= 0);
  });

  test('non scende mai sotto il livello 1 anche con un delta enormemente negativo', () => {
    const result = applyXpDelta({ level: 1, currentXp: 10 }, -999999);
    assert.equal(result.level, 1);
    assert.equal(result.currentXp, 0);
  });

  test('blinda input corrotti (NaN/undefined) senza propagare NaN', () => {
    const result = applyXpDelta({ level: NaN, currentXp: undefined }, NaN);
    assert.equal(result.level, 1);
    assert.equal(Number.isFinite(result.currentXp), true);
  });
});

describe('applyXpDeltaWithTokens', () => {
  test('accredita 1 Tech Token per ogni livello guadagnato', () => {
    const req1 = xpRequiredForLevel(1);
    const req2 = xpRequiredForLevel(2);
    const result = applyXpDeltaWithTokens({ level: 1, currentXp: 0, techTokens: 0 }, req1 + req2 + 10);
    assert.equal(result.level, 3);
    assert.equal(result.techTokens, 2);
  });

  test('nessun token se non si sale di livello', () => {
    const result = applyXpDeltaWithTokens({ level: 1, currentXp: 0, techTokens: 5 }, 10);
    assert.equal(result.level, 1);
    assert.equal(result.techTokens, 5);
  });

  test('i token già assegnati non vengono mai ritirati da un delta negativo che fa scendere di livello', () => {
    const result = applyXpDeltaWithTokens({ level: 2, currentXp: 10, techTokens: 3 }, -60);
    assert.equal(result.level, 1);
    assert.equal(result.techTokens, 3);
  });
});

describe('computeStreakMultiplier', () => {
  test('nessun bonus sotto la soglia bassa', () => {
    assert.equal(computeStreakMultiplier(1), 1);
  });
  test('bonus intermedio fra soglia bassa e alta', () => {
    assert.equal(computeStreakMultiplier(3), 1.1);
  });
  test('bonus massimo alla/sopra la soglia alta', () => {
    assert.equal(computeStreakMultiplier(7), 1.2);
    assert.equal(computeStreakMultiplier(100), 1.2);
  });
  test('streakThresholdBonus (Skill Tree) anticipa le soglie', () => {
    assert.equal(computeStreakMultiplier(5, 2), 1.2); // soglia alta abbassata a 5
  });
});

describe('computeCfuMultiplier', () => {
  test('CFU 0 -> nessun moltiplicatore', () => {
    assert.equal(computeCfuMultiplier(0), 1);
  });
  test('CFU 12 -> +60%', () => {
    assert.equal(computeCfuMultiplier(12), 1.6);
  });
  test('CFU negativi vengono trattati come zero', () => {
    assert.equal(computeCfuMultiplier(-5), 1);
  });
});

describe('computeFocusStaminaCost', () => {
  test('Maximum Carnage Mode azzera sempre il costo', () => {
    assert.equal(computeFocusStaminaCost(25, DIFFICULTY.HARD, 1, true), 0);
  });
  test('costo base per 25 minuti a difficoltà Media', () => {
    assert.equal(computeFocusStaminaCost(25, DIFFICULTY.MEDIUM), 15);
  });
  test('difficoltà Easy riduce il costo, Hard lo aumenta', () => {
    const easy = computeFocusStaminaCost(25, DIFFICULTY.EASY);
    const hard = computeFocusStaminaCost(25, DIFFICULTY.HARD);
    assert.ok(easy < 15);
    assert.ok(hard > 15);
  });
  test('il costo non scende mai sotto 1', () => {
    assert.ok(computeFocusStaminaCost(1, DIFFICULTY.EASY, 0.1) >= 1);
  });
});

describe('computeSpiderSenseSurgeXp', () => {
  test('difficoltà neutra (3) -> bonus base esatto', () => {
    assert.equal(computeSpiderSenseSurgeXp(3), 20);
  });
  test('scala linearmente con la difficoltà percepita', () => {
    assert.equal(computeSpiderSenseSurgeXp(5), Math.round(20 * (5 / 3)));
  });
  test('valori fuori range (0-5) ricadono sulla difficoltà neutra', () => {
    assert.equal(computeSpiderSenseSurgeXp(99), 20);
    assert.equal(computeSpiderSenseSurgeXp(undefined), 20);
  });
});

describe('computeFocusXp', () => {
  test('caso base: 25 minuti, nessun modificatore', () => {
    const xp = computeFocusXp({ focusMinutes: 25, isOverdrive: false, isFatigued: false });
    assert.equal(xp, 50); // 25 * 2
  });
  test('Overdrive moltiplica correttamente', () => {
    const base = computeFocusXp({ focusMinutes: 25, isOverdrive: false, isFatigued: false });
    const overdrive = computeFocusXp({ focusMinutes: 25, isOverdrive: true, isFatigued: false });
    assert.equal(overdrive, Math.round(base * 1.5));
  });
  test('Fatigue dimezza l\'XP', () => {
    const base = computeFocusXp({ focusMinutes: 25, isOverdrive: false, isFatigued: false });
    const fatigued = computeFocusXp({ focusMinutes: 25, isOverdrive: false, isFatigued: true });
    assert.equal(fatigued, Math.round(base * 0.5));
  });
  test('Maximum Carnage raddoppia il risultato finale, applicato per ultimo', () => {
    const base = computeFocusXp({ focusMinutes: 25, isOverdrive: false, isFatigued: false });
    const carnage = computeFocusXp({ focusMinutes: 25, isOverdrive: false, isFatigued: false, isMaxCarnage: true });
    assert.equal(carnage, base * MAX_CARNAGE_MULTIPLIER);
  });
  test('qualità FLOW premia, DISTRACTED penalizza rispetto a NORMAL', () => {
    const normal = computeFocusXp({ focusMinutes: 25, isOverdrive: false, isFatigued: false, quality: FOCUS_QUALITY.NORMAL });
    const flow = computeFocusXp({ focusMinutes: 25, isOverdrive: false, isFatigued: false, quality: FOCUS_QUALITY.FLOW });
    const distracted = computeFocusXp({ focusMinutes: 25, isOverdrive: false, isFatigued: false, quality: FOCUS_QUALITY.DISTRACTED });
    assert.ok(flow > normal);
    assert.ok(distracted < normal);
  });
});

describe('computeBloodPactPenalty / computeReviewXp / computeTotalBankedXp', () => {
  test('Blood Pact penalty base senza riduzioni Skill Tree', () => {
    assert.equal(computeBloodPactPenalty(0), 50);
  });
  test('Blood Pact penalty ridotta non scende mai sotto 1', () => {
    assert.ok(computeBloodPactPenalty(0.99) >= 1);
  });
  test('Review Xp flat più eventuale bonus', () => {
    assert.equal(computeReviewXp(0), 10);
    assert.equal(computeReviewXp(5), 15);
  });
  test('computeTotalBankedXp somma tutti i livelli precedenti + XP corrente', () => {
    const banked = computeTotalBankedXp({ level: 3, currentXp: 100 });
    assert.equal(banked, xpRequiredForLevel(1) + xpRequiredForLevel(2) + 100);
  });
});

describe('getRankMeta / getRankTitle', () => {
  test('Livello 1 -> Bimbo Ragno', () => {
    assert.equal(getRankTitle(1), 'Bimbo Ragno');
  });
  test('Livello 50 -> Difensore del Multiverso', () => {
    assert.equal(getRankTitle(50), 'Difensore del Multiverso');
  });
  test('livello altissimo resta nell\'ultima banda (mai undefined)', () => {
    const meta = getRankMeta(9999);
    assert.equal(meta.title, 'Difensore del Multiverso');
  });
});
