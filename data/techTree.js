import { OVERDRIVE_MULTIPLIER } from '../utils/xpEngine.js';

/**
 * V25.0 — Pillar 3: "Tech Tokens & The Passive Skill Tree".
 * V35.0 — "Ribilanciamento Economico": espansione da 3 a 5 tier per
 * corsia (8 -> 15 nodi totali). Causa radice del problema originale: 1
 * Tech Token per Level Up (xpEngine.applyXpDeltaWithTokens) contro un
 * albero da soli 20 token totali, interamente esauribile entro il
 * Livello ~20 mentre la curva XP/i ranghi arrivano fino al Livello 50+
 * ("Difensore del Multiverso") — da lì in poi ogni token guadagnato non
 * aveva più nulla da comprare. Costo totale del nuovo albero: 3 corsie ×
 * (2+3+4+6+9) = 72 Tech Token, raggiungibile solo da un Cadetto che
 * macina in modo costante ben oltre il Livello 50 — mai più un albero
 * "finito" a metà partita. Nessuna modifica alla curva XP né alla
 * formula di guadagno token: il fix vive interamente qui (costi) + un
 * piccolo bonus di costanza nel reducer (vedi
 * ArachnoForgeContext.jsx — applyStreakTokenMilestone).
 *
 * Ogni Level Up garantisce 1 Tech Token (vedi xpEngine.applyXpDeltaWithTokens
 * e il reducer del Context). I token si spendono qui per sbloccare abilità
 * PASSIVE — mai un'azione da attivare manualmente: una volta sbloccata,
 * un'abilità modifica per sempre la matematica dell'app (XP, Stamina,
 * Boss Fight, Blood Pact...).
 *
 * Struttura ad albero a 3 corsie parallele (Tier 1 -> 5), pensata per un
 * layout a colonne nello Skill Tree della Suit Lab: ogni corsia è un
 * "percorso" narrativo coerente (Resilienza/Tattico, Ingegneria/Cognitivo,
 * Disciplina/Fisico). Ogni nodo riusa esclusivamente le chiavi di effetto
 * già aggregate da `computeSkillEffects` — nessun nuovo tipo di effetto
 * introdotto, quindi zero nuovo wiring richiesto nel reducer/BossFight/
 * xpEngine: i nodi T4/T5 si limitano ad approfondire lo stesso tema
 * meccanico già stabilito dai tier precedenti della propria corsia.
 */
export const SKILL_TIER = { T1: 1, T2: 2, T3: 3, T4: 4, T5: 5 };
export const SKILL_TIER_ORDER = [SKILL_TIER.T1, SKILL_TIER.T2, SKILL_TIER.T3, SKILL_TIER.T4, SKILL_TIER.T5];

export const SKILL_PATH = {
  DEFENSE: 'DEFENSE',
  EFFICIENCY: 'EFFICIENCY',
  AGGRESSION: 'AGGRESSION'
};

// V35.0 — Le CHIAVI di SKILL_PATH restano invariate (usate come parte
// stabile dell'identità di ogni skill, referenziata da `unlockedSkills`
// nei profili già persistiti) — solo le ETICHETTE visualizzate cambiano,
// per riflettere le 3 famiglie tematiche richieste dal reset strategico.
export const SKILL_PATH_META = {
  DEFENSE: { label: 'Resilienza/Tattico', color: 'text-secondary', border: 'border-secondary/40', bar: 'from-secondary to-secondary-dark' },
  EFFICIENCY: { label: 'Ingegneria/Cognitivo', color: 'text-accent', border: 'border-accent/40', bar: 'from-accent to-accent/70' },
  AGGRESSION: { label: 'Disciplina/Fisico', color: 'text-primary', border: 'border-primary/40', bar: 'from-primary to-primary-dark' }
};

export const SKILL_DEFS = [
  // ============================================================
  // Corsia "Resilienza/Tattico" — bossDamageReduction + staminaCostMultiplier
  // ============================================================
  {
    id: 'istinto_ragno',
    title: 'Istinto di Ragno',
    tier: SKILL_TIER.T1,
    path: SKILL_PATH.DEFENSE,
    cost: 2,
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
  {
    id: 'metabolismo_simbionte',
    title: 'Metabolismo del Simbionte',
    tier: SKILL_TIER.T3,
    path: SKILL_PATH.DEFENSE,
    cost: 4,
    requires: ['resistenza_simbionte'],
    icon: 'drop',
    tagline: '-10% costo Stamina aggiuntivo',
    description: 'Il simbionte impara a razionare le proprie riserve: ulteriore -10% sul costo Stamina di ogni sessione di Focus, cumulativo col tier precedente.',
    effect: { staminaCostMultiplier: 0.9 }
  },
  {
    id: 'corazza_reattiva',
    title: 'Corazza Reattiva',
    tier: SKILL_TIER.T4,
    path: SKILL_PATH.DEFENSE,
    cost: 6,
    requires: ['metabolismo_simbionte'],
    icon: 'radar',
    tagline: '-15% danno subito aggiuntivo',
    description: 'La corazza organica si irrigidisce in tempo reale contro l\'impatto: ulteriore -15% danno subito nel Sinister Six Simulator, cumulativo col tier 1.',
    effect: { bossDamageReduction: 0.15 }
  },
  {
    id: 'armatura_vibranio',
    title: 'Armatura al Vibranio',
    tier: SKILL_TIER.T5,
    path: SKILL_PATH.DEFENSE,
    cost: 9,
    requires: ['corazza_reattiva'],
    icon: 'shield',
    tagline: '-15% costo Stamina e -15% danno subito',
    description: 'Il traguardo della corsia Resilienza/Tattico: la lega simbiotica raggiunge la sua forma definitiva — ulteriore -15% costo Stamina E ulteriore -15% danno subito nel Sinister Six Simulator, entrambi cumulativi.',
    effect: { staminaCostMultiplier: 0.85, bossDamageReduction: 0.15 }
  },

  // ============================================================
  // Corsia "Ingegneria/Cognitivo" — xpBonusPct + reviewXpBonus + streakThresholdBonus
  // ============================================================
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
    cost: 3,
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
    cost: 4,
    requires: ['webshooter_potenziati'],
    icon: 'eye',
    tagline: 'Streak più rapida',
    description: 'Le soglie di streak per i bonus XP (+10% / +20%) si abbassano di 2 giorni: la costanza premia ancora più in fretta.',
    effect: { streakThresholdBonus: 2 }
  },
  {
    id: 'algoritmo_predittivo',
    title: 'Algoritmo Predittivo',
    tier: SKILL_TIER.T4,
    path: SKILL_PATH.EFFICIENCY,
    cost: 6,
    requires: ['sesto_senso'],
    icon: 'bolt',
    tagline: '+5% XP passivo aggiuntivo',
    description: 'K.A.R.E.N. ottimizza in tempo reale il ritmo di studio: ulteriore +5% XP su ogni sessione di Focus, cumulativo col tier 1 (totale +10%).',
    effect: { xpBonusPct: 0.05 }
  },
  {
    id: 'singolarita_cognitiva',
    title: 'Singolarità Cognitiva',
    tier: SKILL_TIER.T5,
    path: SKILL_PATH.EFFICIENCY,
    cost: 9,
    requires: ['algoritmo_predittivo'],
    icon: 'eye',
    tagline: '+10 XP per ripasso e streak ancora più rapida',
    description: 'Il traguardo della corsia Ingegneria/Cognitivo: ulteriore +10 XP flat per ripasso (cumulativo, totale +15) e un\'ulteriore riduzione di 1 giorno delle soglie di streak (cumulativo, totale -3 giorni).',
    effect: { reviewXpBonus: 10, streakThresholdBonus: 1 }
  },

  // ============================================================
  // Corsia "Disciplina/Fisico" — bloodPactReduction + overdriveMultiplierBonus + nightBonus
  // ============================================================
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
  },
  {
    id: 'controllo_totale',
    title: 'Controllo Totale',
    tier: SKILL_TIER.T4,
    path: SKILL_PATH.AGGRESSION,
    cost: 6,
    requires: ['simbiosi_notturna'],
    icon: 'shield',
    tagline: '-20% penalità Blood Pact aggiuntivo',
    description: 'Disciplina ferrea anche nel cedimento: ulteriore -20% sulla penalità XP del Blood Pact, cumulativo col tier 1 (totale -50%).',
    effect: { bloodPactReduction: 0.2 }
  },
  {
    id: 'furia_simbionte',
    title: 'Furia del Simbionte',
    tier: SKILL_TIER.T5,
    path: SKILL_PATH.AGGRESSION,
    cost: 9,
    requires: ['controllo_totale'],
    icon: 'flame',
    tagline: `Overdrive x${(OVERDRIVE_MULTIPLIER + 0.35).toFixed(2)}`,
    description: `Il traguardo della corsia Disciplina/Fisico: il moltiplicatore Overdrive sale ulteriormente fino a x${(OVERDRIVE_MULTIPLIER + 0.35).toFixed(2)} — la disciplina del rischio calcolato portata al limite.`,
    effect: { overdriveMultiplierBonus: 0.2 }
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
