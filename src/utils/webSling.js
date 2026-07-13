/**
 * V27.0 — Pillar 4: "Daily Web-Sling" (Il Forziere di Parker).
 *
 * Motore puro per il forziere giornaliero: probabilità pesate, un solo
 * riscatto al giorno (blindato sulla stessa `dateKey` usata dal Daily
 * Patrol Engine — vedi dailyPatrol.js/dateUtils.js), nessuna logica
 * casuale lato reducer (il roll avviene qui, il reducer applica solo il
 * risultato già deciso — reducer resta puro e deterministico).
 */
import { getDateKey } from './dateUtils.js';

/** True se il profilo NON ha ancora riscattato il forziere di oggi. */
export function canClaimWebSling(profile) {
  const todayKey = getDateKey();
  return (profile?.webSlingLastClaimDateKey || null) !== todayKey;
}

/**
 * Tabella dei premi — Anti-Exploit (probabilità bilanciate, sommano a 100):
 *   75% — Bonus Standard   (+50 XP)
 *   20% — Bonus Medio      (+150 XP, Stamina rigenerata al 100%)
 *    4% — Bonus Raro       (+300 XP, Stamina rigenerata al 100%) — "altri bonus"
 *    1% — Forziere di Parker (Rarissimo): +200 XP + 1 Tech Token
 */
export const WEB_SLING_TIERS = [
  {
    id: 'STANDARD',
    weight: 75,
    label: 'Bonus da Quartiere',
    icon: 'bolt',
    rarity: 'Comune',
    colorClass: 'text-secondary',
    borderClass: 'border-secondary/50',
    glowClass: 'shadow-secondary-glow',
    xp: 50,
    restoreStamina: false,
    techTokens: 0
  },
  {
    id: 'MEDIUM',
    weight: 20,
    label: 'Bonus da Vendicatore',
    icon: 'flame',
    rarity: 'Non Comune',
    colorClass: 'text-emerald-400',
    borderClass: 'border-emerald-400/50',
    glowClass: 'shadow-[0_0_18px_rgba(52,211,153,0.5)]',
    xp: 150,
    restoreStamina: true,
    techTokens: 0
  },
  {
    id: 'RARE',
    weight: 4,
    label: 'Bonus da Iron Spider',
    icon: 'shield',
    rarity: 'Raro',
    colorClass: 'text-accent',
    borderClass: 'border-accent/60',
    glowClass: 'shadow-accent-glow-lg',
    xp: 300,
    restoreStamina: true,
    techTokens: 0
  },
  {
    id: 'PARKER_CHEST',
    weight: 1,
    label: 'Il Forziere di Parker',
    icon: 'trophy',
    rarity: 'Rarissimo',
    colorClass: 'text-primary',
    borderClass: 'border-primary/70',
    glowClass: 'shadow-primary-glow-lg',
    xp: 200,
    restoreStamina: true,
    techTokens: 1
  }
];

const TOTAL_WEIGHT = WEB_SLING_TIERS.reduce((sum, t) => sum + t.weight, 0); // === 100

/**
 * Estrae un tier pesato. `rngFn` iniettabile (default Math.random) solo
 * per rendere la funzione testabile in isolamento — nessuna dipendenza
 * nascosta dal chiamante nel percorso reale.
 */
export function rollWebSlingReward(rngFn = Math.random) {
  const roll = rngFn() * TOTAL_WEIGHT;
  let cumulative = 0;
  for (const tier of WEB_SLING_TIERS) {
    cumulative += tier.weight;
    if (roll < cumulative) return tier;
  }
  return WEB_SLING_TIERS[0]; // fallback di sicurezza, matematicamente irraggiungibile
}

/**
 * V31.3 — Pity System (bad-luck protection). RARE (4%) + PARKER_CHEST (1%)
 * insieme fanno solo il 5%: un giocatore sfortunato potrebbe restare per
 * settimane sui soli tier Comune/Non Comune, l'unica vera fonte di Tech
 * Token oltre al level-up. Dopo `WEB_SLING_PITY_THRESHOLD` aperture DI
 * FILA senza mai pescare Raro o superiore, il prossimo forziere che
 * risulterebbe Comune/Non Comune viene garantito almeno Raro.
 *
 * Non tocca MAI la probabilità reale dell'1% del Forziere di Parker: la
 * pity garantisce solo il pavimento "Raro", il vero jackpot resta
 * genuinamente casuale e rarissimo com'è per design.
 */
export const WEB_SLING_PITY_THRESHOLD = 15;

const HIGH_TIERS = ['RARE', 'PARKER_CHEST'];

export function isHighTier(tier) {
  return !!tier && HIGH_TIERS.includes(tier.id);
}

/**
 * `pityCounter` = numero di aperture consecutive già effettuate SENZA un
 * tier Alto (Raro/Forziere di Parker), prima di questa chiamata — letto
 * da `profile.webSlingPityCounter`, blindato a 0 se assente/non numerico
 * dal chiamante. `rngFn` iniettabile come in `rollWebSlingReward`.
 *
 * Ritorna `{ tier, pityTriggered }` invece del solo tier: il chiamante
 * (reducer) non può altrimenti distinguere un Raro genuinamente estratto
 * dal 4% da un Raro garantito dalla pity — un dettaglio che conta per il
 * messaggio mostrato al Cadetto (mai un'etichetta "Pity" su un colpo di
 * fortuna vero, sarebbe fuorviante).
 */
export function rollWebSlingRewardWithPity(pityCounter = 0, rngFn = Math.random) {
  const rolled = rollWebSlingReward(rngFn);
  if (!isHighTier(rolled) && pityCounter >= WEB_SLING_PITY_THRESHOLD) {
    const guaranteed = WEB_SLING_TIERS.find((t) => t.id === 'RARE') || rolled;
    return { tier: guaranteed, pityTriggered: true };
  }
  return { tier: rolled, pityTriggered: false };
}

export default { WEB_SLING_TIERS, canClaimWebSling, rollWebSlingReward, rollWebSlingRewardWithPity, isHighTier, WEB_SLING_PITY_THRESHOLD };
