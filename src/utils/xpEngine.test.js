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
  MAX_CARNAGE_MULTIPLIER,
  // V42
  xpRequiredForLevelV1,
  convertProfileToCurveV2,
  computeNodeCompletionXp,
  computeBreakStaminaRestore,
  SURGE_MIN_MINUTES,
  NODE_COMPLETION_MIN_MINUTES,
  XP_CURVE_VERSION
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
  test('V42: Maximum Carnage non azzera più il costo', () => {
    assert.equal(computeFocusStaminaCost(25, DIFFICULTY.HARD, 1, true), computeFocusStaminaCost(25, DIFFICULTY.HARD, 1, false));
  });
  test('V42: tarato sulla capacità — la giornata tipo consuma circa tre quarti della Stamina', () => {
    // 4,5 ore di studio a difficoltà media: 77 punti, la stanchezza (sotto 20)
    // arriva solo oltre la giornata tipo. Prima: 15 ogni 25 minuti, fatica
    // dopo 150 minuti, cioè sotto il piano che l'app stessa chiedeva.
    assert.equal(computeFocusStaminaCost(25, DIFFICULTY.MEDIUM), 8);
    const giornata = computeFocusStaminaCost(270, DIFFICULTY.MEDIUM, 1, false, 4.5);
    assert.ok(giornata >= 70 && giornata <= 80, `giornata tipo: ${giornata}`);
  });
  test('V42: con più capacità ogni minuto costa meno', () => {
    assert.ok(computeFocusStaminaCost(50, DIFFICULTY.MEDIUM, 1, false, 6) < computeFocusStaminaCost(50, DIFFICULTY.MEDIUM, 1, false, 3));
  });
  test('difficoltà Easy riduce il costo, Hard lo aumenta', () => {
    const medium = computeFocusStaminaCost(25, DIFFICULTY.MEDIUM);
    assert.ok(computeFocusStaminaCost(25, DIFFICULTY.EASY) < medium);
    assert.ok(computeFocusStaminaCost(25, DIFFICULTY.HARD) > medium);
  });
  test('il costo non scende mai sotto 1', () => {
    assert.ok(computeFocusStaminaCost(1, DIFFICULTY.EASY, 0.1) >= 1);
  });
});

describe('computeBreakStaminaRestore', () => {
  test('V42: le pause ricaricano in proporzione ai minuti, con un tetto', () => {
    assert.equal(computeBreakStaminaRestore(5), 3);
    assert.equal(computeBreakStaminaRestore(15), 9);
    assert.equal(computeBreakStaminaRestore(500), computeBreakStaminaRestore(60));
    assert.equal(computeBreakStaminaRestore(10, 0.5), 9);
    assert.equal(computeBreakStaminaRestore(NaN), 0);
  });
});

describe('computeSpiderSenseSurgeXp', () => {
  test(`V42: sotto i ${SURGE_MIN_MINUTES} minuti nessun bonus`, () => {
    assert.equal(computeSpiderSenseSurgeXp(3, SURGE_MIN_MINUTES - 1), 0);
    assert.equal(computeSpiderSenseSurgeXp(3, SURGE_MIN_MINUTES), 8);
  });
  test('V42: a difficoltà neutra 0,4 XP al minuto — spezzettare non conviene più', () => {
    assert.equal(computeSpiderSenseSurgeXp(3, 25), 10);
    assert.equal(computeSpiderSenseSurgeXp(3, 50), 20);
  });
  test('scala linearmente con la difficoltà percepita', () => {
    assert.equal(computeSpiderSenseSurgeXp(5, 25), Math.round(25 * 0.4 * (5 / 3)));
  });
  test('valori fuori range (0-5) ricadono sulla difficoltà neutra', () => {
    assert.equal(computeSpiderSenseSurgeXp(99, 25), 10);
    assert.equal(computeSpiderSenseSurgeXp(undefined, 25), 10);
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
  test('V42: la qualità dichiarata è un dato, non un premio — l\'XP non cambia', () => {
    const normal = computeFocusXp({ focusMinutes: 25, isOverdrive: false, isFatigued: false, quality: FOCUS_QUALITY.NORMAL });
    const flow = computeFocusXp({ focusMinutes: 25, isOverdrive: false, isFatigued: false, quality: FOCUS_QUALITY.FLOW });
    const distracted = computeFocusXp({ focusMinutes: 25, isOverdrive: false, isFatigued: false, quality: FOCUS_QUALITY.DISTRACTED });
    assert.equal(flow, normal);
    assert.equal(distracted, normal);
  });
  test('V42: l\'Overdrive moltiplica solo il blocco extra oltre quello pianificato', () => {
    const catena = computeFocusXp({ focusMinutes: 50, baseMinutes: 25, isOverdrive: true, isFatigued: false });
    assert.equal(catena, (25 + 25 * 1.5) * 2);
    const senzaExtra = computeFocusXp({ focusMinutes: 25, baseMinutes: 25, isOverdrive: true, isFatigued: false });
    assert.equal(senzaExtra, computeFocusXp({ focusMinutes: 25, isOverdrive: false, isFatigued: false }));
  });
});

describe('V42 — curva dei livelli e conversione dei profili', () => {
  test('il livello 50 richiede circa 760.000 XP cumulativi', () => {
    let totale = 0;
    for (let L = 1; L < 50; L += 1) totale += xpRequiredForLevel(L);
    assert.ok(totale > 700000 && totale < 800000, `cumulativo al 50: ${totale}`);
  });
  test('la conversione conserva gli XP totali, ricalcola il livello e dà un token per ogni livello nuovo', () => {
    let totaleV1 = 500;
    for (let L = 1; L < 10; L += 1) totaleV1 += xpRequiredForLevelV1(L);
    const { profile, fromLevel, toLevel, tokens } = convertProfileToCurveV2({ level: 10, currentXp: 500, techTokens: 3, maxLevelReached: 10 });
    assert.equal(computeTotalBankedXp(profile), totaleV1, 'stesso potere d’acquisto');
    assert.equal(fromLevel, 10);
    assert.ok(toLevel >= fromLevel);
    assert.equal(tokens, toLevel - 10);
    assert.equal(profile.techTokens, 3 + tokens);
    assert.equal(profile.maxLevelReached, toLevel);
    assert.equal(profile.xpCurveVersion, XP_CURVE_VERSION);
  });
  test('la conversione è idempotente', () => {
    const una = convertProfileToCurveV2({ level: 10, currentXp: 500, techTokens: 3 }).profile;
    const due = convertProfileToCurveV2(una);
    assert.equal(due.tokens, 0);
    assert.deepEqual(due.profile, una);
  });
  test('i Tech Token si guadagnano solo oltre il livello massimo mai raggiunto', () => {
    const risalita = applyXpDeltaWithTokens({ level: 3, currentXp: 10, techTokens: 5, maxLevelReached: 5 }, xpRequiredForLevel(3));
    assert.equal(risalita.level, 4);
    assert.equal(risalita.techTokens, 5, 'livello già raggiunto in passato: nessun token');
    assert.equal(risalita.maxLevelReached, 5);
  });
});

describe('computeNodeCompletionXp', () => {
  test(`V42: senza ${NODE_COMPLETION_MIN_MINUTES} minuti tracciati il completamento vale 10 XP`, () => {
    assert.equal(computeNodeCompletionXp({ trackedMinutes: NODE_COMPLETION_MIN_MINUTES - 1 }), 10);
  });
  test('V42: premio di traguardo fisso, pesato per difficoltà (i minuti li pagano già le sessioni)', () => {
    assert.equal(computeNodeCompletionXp({ trackedMinutes: 30 }), 40);
    assert.equal(computeNodeCompletionXp({ trackedMinutes: 600 }), 40);
    assert.equal(computeNodeCompletionXp({ trackedMinutes: 30, difficulty: DIFFICULTY.HARD }), 52);
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
