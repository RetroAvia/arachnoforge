import { OVERDRIVE_MULTIPLIER } from '../utils/xpEngine.js';

/**
 * V25.0 — Pillar 3: "Tech Tokens & The Passive Skill Tree".
 *
 * Ogni Level Up garantisce 1 Tech Token (vedi xpEngine.applyXpDeltaWithTokens
 * e il reducer del Context). I token si spendono qui per sbloccare abilità
 * PASSIVE — mai un'azione da attivare manualmente: una volta sbloccata,
 * un'abilità modifica per sempre la matematica dell'app (XP, Stamina,
 * Boss Fight, Blood Pact...).
 *
 * Struttura ad albero a 3 corsie parallele (Tier 1 -> 2 -> 3), pensata per
 * un layout a colonne nello Skill Tree della Suit Lab: ogni corsia è un
 * "percorso" narrativo coerente (Difesa / Efficienza XP / Aggressività).
 */
export const SKILL_TIER = { T1: 1, T2: 2, T3: 3 };

export const SKILL_PATH = {
  DEFENSE: 'DEFENSE',
  EFFICIENCY: 'EFFICIENCY',
  AGGRESSION: 'AGGRESSION'
};

export const SKILL_PATH_META = {
  DEFENSE: { label: 'Sopravvivenza', color: 'text-secondary', border: 'border-secondary/40', bar: 'from-secondary to-secondary-dark' },
  EFFICIENCY: { label: 'Efficienza', color: 'text-accent', border: 'border-accent/40', bar: 'from-accent to-accent/70' },
  AGGRESSION: { label: 'Aggressività', color: 'text-primary', border: 'border-primary/40', bar: 'from-primary to-primary-dark' }
};

export const SKILL_DEFS = [
  // --- Corsia "Sopravvivenza" (Difesa) ---
  {
    id: 'istinto_ragno',
    title: 'Istinto di Ragno',
    tier: SKILL_TIER.T1,
    path: SKILL_PATH.DEFENSE,
    cost: 1,
    requires: [],
    icon: 'radar',
    tagline: '-15% danno subito',
    description: 'Il tuo Spider-Sense anticipa i colpi prima che arrivino: -15% danno subito ad ogni Penalità nel Sinister Six Simulator.',
    effect: { bossDamageReduction: 0.15 }
  },
  {
    id: 'resistenza_simbionte',
    title: 'Resistenza Simbionte',
    tier: SKILL_TIER.T2,
    path: SKILL_PATH.DEFENSE,
    cost: 3,
    requires: ['istinto_ragno'],
    icon: 'drop',
    tagline: '-15% costo Stamina',
    description: 'Il simbionte assorbe parte della fatica: il costo Stamina di ogni sessione di Focus scende del 15%.',
    effect: { staminaCostMultiplier: 0.85 }
  },

  // --- Corsia "Efficienza" (XP) ---
  {
    id: 'focus_migliorato',
    title: 'Focus Migliorato',
    tier: SKILL_TIER.T1,
    path: SKILL_PATH.EFFICIENCY,
    cost: 2,
    requires: [],
    icon: 'bolt',
    tagline: '+5% XP passivo',
    description: '+5% XP su ogni sessione di Focus completata, sempre attivo, si somma a tutti gli altri moltiplicatori.',
    effect: { xpBonusPct: 0.05 }
  },
  {
    id: 'webshooter_potenziati',
    title: 'Web-Shooter Potenziati',
    tier: SKILL_TIER.T2,
    path: SKILL_PATH.EFFICIENCY,
    cost: 2,
    requires: ['focus_migliorato'],
    icon: 'target',
    tagline: '+5 XP per ripasso',
    description: 'Meccanismi di precisione: ogni ripasso completato (Spider-Sense placato) frutta +5 XP flat extra.',
    effect: { reviewXpBonus: 5 }
  },
  {
    id: 'sesto_senso',
    title: 'Sesto Senso Ragnesco',
    tier: SKILL_TIER.T3,
    path: SKILL_PATH.EFFICIENCY,
    cost: 3,
    requires: ['webshooter_potenziati'],
    icon: 'eye',
    tagline: 'Streak più rapida',
    description: 'Le soglie di streak per i bonus XP (+10% / +20%) si abbassano di 2 giorni: la costanza premia ancora più in fretta.',
    effect: { streakThresholdBonus: 2 }
  },

  // --- Corsia "Aggressività" (Overdrive / Blood Pact) ---
  {
    id: 'nervi_acciaio',
    title: "Nervi d'Acciaio",
    tier: SKILL_TIER.T1,
    path: SKILL_PATH.AGGRESSION,
    cost: 2,
    requires: [],
    icon: 'shield',
    tagline: '-30% penalità Blood Pact',
    description: 'Sangue freddo sotto pressione: riduce del 30% la penalità XP del Blood Pact quando interrompi una sessione di Focus.',
    effect: { bloodPactReduction: 0.3 }
  },
  {
    id: 'adrenalina_combattimento',
    title: 'Adrenalina da Combattimento',
    tier: SKILL_TIER.T2,
    path: SKILL_PATH.AGGRESSION,
    cost: 3,
    requires: ['nervi_acciaio'],
    icon: 'flame',
    tagline: `Overdrive x${(OVERDRIVE_MULTIPLIER + 0.15).toFixed(2)}`,
    description: `Il moltiplicatore Overdrive sale da x${OVERDRIVE_MULTIPLIER} a x${(OVERDRIVE_MULTIPLIER + 0.15).toFixed(2)}: rischiare di più paga di più.`,
    effect: { overdriveMultiplierBonus: 0.15 }
  },
  {
    id: 'simbiosi_notturna',
    title: 'Simbiosi Notturna',
    tier: SKILL_TIER.T3,
    path: SKILL_PATH.AGGRESSION,
    cost: 4,
    requires: ['adrenalina_combattimento'],
    icon: 'moon',
    tagline: '+10% XP notturno',
    description: '+10% XP extra sulle sessioni di Focus completate fra le 00:00 e le 04:00 — il simbionte non dorme mai.',
    effect: { nightBonus: true }
  }
];

export function getSkillDef(id) {
  return SKILL_DEFS.find((s) => s.id === id) || null;
}

/** Un'abilità è sbloccabile se tutti i suoi prerequisiti sono già sbloccati e il Cadetto può permettersela. */
export function canUnlockSkill(skillDef, unlockedSkills = [], techTokens = 0) {
  if (!skillDef) return false;
  if (unlockedSkills.includes(skillDef.id)) return false;
  if (techTokens < skillDef.cost) return false;
  return skillDef.requires.every((reqId) => unlockedSkills.includes(reqId));
}

/**
 * Aggrega TUTTI gli effetti delle abilità sbloccate in un unico oggetto di
 * modificatori, consumato direttamente dal reducer del Context per ogni
 * calcolo di XP/Stamina/Boss/Blood-Pact — un solo punto di verità, nessuna
 * duplicazione della logica "quali skill sono attive" sparsa nell'app.
 */
export function computeSkillEffects(unlockedSkills = []) {
  const effects = {
    xpBonusPct: 0,
    staminaCostMultiplier: 1,
    bossDamageReduction: 0,
    reviewXpBonus: 0,
    bloodPactReduction: 0,
    overdriveMultiplierBonus: 0,
    streakThresholdBonus: 0,
    nightBonusEnabled: false
  };
  (Array.isArray(unlockedSkills) ? unlockedSkills : []).forEach((id) => {
    const def = getSkillDef(id);
    if (!def) return;
    const e = def.effect || {};
    if (e.xpBonusPct) effects.xpBonusPct += e.xpBonusPct;
    if (e.staminaCostMultiplier != null) effects.staminaCostMultiplier *= e.staminaCostMultiplier;
    if (e.bossDamageReduction) effects.bossDamageReduction = Math.min(0.6, effects.bossDamageReduction + e.bossDamageReduction);
    if (e.reviewXpBonus) effects.reviewXpBonus += e.reviewXpBonus;
    if (e.bloodPactReduction) effects.bloodPactReduction = Math.min(0.9, effects.bloodPactReduction + e.bloodPactReduction);
    if (e.overdriveMultiplierBonus) effects.overdriveMultiplierBonus += e.overdriveMultiplierBonus;
    if (e.streakThresholdBonus) effects.streakThresholdBonus += e.streakThresholdBonus;
    if (e.nightBonus) effects.nightBonusEnabled = true;
  });
  effects.overdriveMultiplier = OVERDRIVE_MULTIPLIER + effects.overdriveMultiplierBonus;
  return effects;
}

export default SKILL_DEFS;
