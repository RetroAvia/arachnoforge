// =====================================================================
// ArachnoForge — src/data/techTree.test.js
// Test unitari (node:test built-in, zero dipendenze npm) per lo Skill
// Tree. Eseguibile con: node --test src/data/techTree.test.js
// =====================================================================
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { OVERDRIVE_MULTIPLIER } from '../utils/xpEngine.js';
import { SKILL_DEFS, SKILL_TIER_ORDER, SKILL_PATH, getSkillDef, canUnlockSkill, computeSkillEffects } from './techTree.js';

describe('struttura dell\'albero (invariante griglia 1 nodo per cella)', () => {
  test('esattamente 5 tier per ognuna delle 3 corsie (15 nodi totali)', () => {
    assert.equal(SKILL_DEFS.length, 15);
    for (const path of Object.values(SKILL_PATH)) {
      const nodesOnPath = SKILL_DEFS.filter((s) => s.path === path);
      assert.equal(nodesOnPath.length, 5, `corsia ${path} dovrebbe avere 5 nodi`);
      const tiers = nodesOnPath.map((s) => s.tier).sort((a, b) => a - b);
      assert.deepEqual(tiers, SKILL_TIER_ORDER, `corsia ${path} dovrebbe avere esattamente un nodo per tier`);
    }
  });

  test('ogni id di skill è unico', () => {
    const ids = SKILL_DEFS.map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  test('ogni requires punta a un id esistente', () => {
    const ids = new Set(SKILL_DEFS.map((s) => s.id));
    for (const skill of SKILL_DEFS) {
      for (const reqId of skill.requires) {
        assert.ok(ids.has(reqId), `${skill.id} richiede ${reqId} che non esiste`);
      }
    }
  });

  test('ogni costo è un intero positivo', () => {
    for (const skill of SKILL_DEFS) {
      assert.ok(Number.isInteger(skill.cost) && skill.cost > 0, `${skill.id} ha un costo non valido: ${skill.cost}`);
    }
  });
});

describe('getSkillDef', () => {
  test('trova una skill esistente per id', () => {
    const def = getSkillDef('istinto_ragno');
    assert.ok(def);
    assert.equal(def.id, 'istinto_ragno');
  });
  test('null per un id inesistente', () => {
    assert.equal(getSkillDef('non_esiste'), null);
  });
});

describe('canUnlockSkill', () => {
  test('sbloccabile se nessun prerequisito e token sufficienti', () => {
    const def = getSkillDef('istinto_ragno'); // requires: [], cost: 2
    assert.equal(canUnlockSkill(def, [], 2), true);
  });
  test('non sbloccabile con token insufficienti', () => {
    const def = getSkillDef('istinto_ragno');
    assert.equal(canUnlockSkill(def, [], 1), false);
  });
  test('non sbloccabile se già sbloccata', () => {
    const def = getSkillDef('istinto_ragno');
    assert.equal(canUnlockSkill(def, ['istinto_ragno'], 10), false);
  });
  test('non sbloccabile senza il prerequisito richiesto', () => {
    const def = getSkillDef('resistenza_simbionte'); // requires: ['istinto_ragno']
    assert.equal(canUnlockSkill(def, [], 10), false);
  });
  test('sbloccabile con prerequisito soddisfatto e token sufficienti', () => {
    const def = getSkillDef('resistenza_simbionte');
    assert.equal(canUnlockSkill(def, ['istinto_ragno'], 10), true);
  });
  test('null-safe su un def inesistente', () => {
    assert.equal(canUnlockSkill(null, [], 10), false);
  });
});

describe('computeSkillEffects', () => {
  test('nessuna skill sbloccata -> effetti tutti neutri', () => {
    const effects = computeSkillEffects([]);
    assert.equal(effects.xpBonusPct, 0);
    assert.equal(effects.staminaCostMultiplier, 1);
    assert.equal(effects.bossDamageReduction, 0);
    assert.equal(effects.overdriveMultiplier, OVERDRIVE_MULTIPLIER);
    assert.equal(effects.nightBonusEnabled, false);
  });

  test('aggrega correttamente un singolo effetto (bossDamageReduction)', () => {
    const effects = computeSkillEffects(['istinto_ragno']);
    assert.equal(effects.bossDamageReduction, 0.15);
  });

  test('gli staminaCostMultiplier sono cumulativi (moltiplicativi)', () => {
    const effects = computeSkillEffects(['istinto_ragno', 'resistenza_simbionte', 'metabolismo_simbionte']);
    // 0.85 * 0.9 dai due nodi con staminaCostMultiplier
    assert.ok(Math.abs(effects.staminaCostMultiplier - 0.85 * 0.9) < 1e-9);
  });

  test('ignora silenziosamente id di skill sconosciuti (salvataggi corrotti)', () => {
    const effects = computeSkillEffects(['id_inesistente', 'istinto_ragno']);
    assert.equal(effects.bossDamageReduction, 0.15);
  });

  test('input non-array viene trattato come nessuna skill sbloccata', () => {
    const effects = computeSkillEffects(undefined);
    assert.equal(effects.xpBonusPct, 0);
  });

  test('bossDamageReduction è cappato al 60% anche sommando molti nodi', () => {
    // Prende tutti i nodi con bossDamageReduction, se presenti più di uno
    const bossReducers = SKILL_DEFS.filter((s) => s.effect?.bossDamageReduction);
    const effects = computeSkillEffects(bossReducers.map((s) => s.id));
    assert.ok(effects.bossDamageReduction <= 0.6);
  });
});
