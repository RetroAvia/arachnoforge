/**
 * Motore XP centralizzato. Ogni sessione di Focus (o completamento nodo)
 * attraversa questa pipeline di modificatori, in ordine deterministico,
 * per evitare ambiguità su come si combinano i bonus.
 */
export const XP_PER_FOCUS_MINUTE = 2;
export const CFU_XP_WEIGHT = 0.05;
export const OVERDRIVE_MULTIPLIER = 1.5;
export const FATIGUE_MULTIPLIER = 0.5;
export const BLOOD_PACT_PENALTY = 50;
export const LAST_STAND_SACRIFICE_RATE = 0.1;
export const FATIGUE_STAMINA_THRESHOLD = 20;
export const REVIEW_FLAT_XP = 10;

/**
 * V27.0 — Pillar 3 "Maximum Carnage Mode": moltiplicatore XP simbionte,
 * applicato DOPO tutti gli altri fattori. V42 — la Stamina NON è più
 * gratis durante la finestra (due ore di XP doppi senza fatica erano un
 * invito a studiare oltre il limite) e la finestra si attiva a mano, di
 * giorno, con una carica guadagnata (vedi utils/maxCarnage.js).
 */
export const MAX_CARNAGE_MULTIPLIER = 2;

/**
 * V28.1 — Pillar 3 "Spider-Sense Focus Surge": bonus XP dedicato alle
 * sessioni di Focus completate PULITE (mai interrotte con un Blood Pact —
 * per costruzione, un'interruzione azzera i minuti in sospeso PRIMA che
 * FOCUS_COMPLETED possa mai scattare, quindi raggiungere questo bonus
 * implica già sessione pulita, nessun tracking aggiuntivo necessario) su
 * una sessione agganciata a una Materia universitaria. Scala linearmente
 * sulla Difficoltà Percepita (1-5, Web-Path Planner) attorno a un
 * baseline neutro a 3/5, cosi' le materie più ostiche premiano di più la
 * costanza del "non mollare a metà".
 */
export const SPIDER_SENSE_BASE_XP = 20;
export const SPIDER_SENSE_NEUTRAL_DIFFICULTY = 3;
/**
 * V42 — Il bonus premia una sessione VERA: sotto i 20 minuti non c'è, e
 * sopra cresce coi minuti (0,4 XP al minuto a difficoltà media). Prima era
 * un premio fisso a sessione: un minuto di Focus valeva 36 XP, cinquanta
 * minuti 3,6 XP al minuto — conveniva spezzettare.
 */
export const SURGE_MIN_MINUTES = 20;
export const SURGE_XP_PER_MINUTE = 0.4;

export function computeSpiderSenseSurgeXp(perceivedDifficulty, focusMinutes = 25) {
  const minuti = Math.max(0, Number(focusMinutes) || 0);
  if (minuti < SURGE_MIN_MINUTES) return 0;
  const safeDifficulty =
    Number.isFinite(perceivedDifficulty) && perceivedDifficulty >= 1 && perceivedDifficulty <= 5
      ? perceivedDifficulty
      : SPIDER_SENSE_NEUTRAL_DIFFICULTY;
  return Math.round(minuti * SURGE_XP_PER_MINUTE * (safeDifficulty / SPIDER_SENSE_NEUTRAL_DIFFICULTY));
}

/** Costo Stamina base per un Focus "standard" da 25 minuti a difficoltà Media. */
export const BASE_STAMINA_PER_25MIN = 15;
export const BASE_FOCUS_MINUTES = 25;

export const DIFFICULTY = {
  EASY: 'EASY',
  MEDIUM: 'MEDIUM',
  HARD: 'HARD'
};

export const DIFFICULTY_META = {
  EASY: { label: 'Easy', xpMultiplier: 1, staminaMultiplier: 0.8, color: 'text-emerald-400', border: 'border-emerald-400/40' },
  MEDIUM: { label: 'Medium', xpMultiplier: 1, staminaMultiplier: 1, color: 'text-af-refuel', border: 'border-af-refuel/40' },
  HARD: { label: 'Hard', xpMultiplier: 1.3, staminaMultiplier: 1.3, color: 'text-af-attack', border: 'border-af-attack/40' }
};

/**
 * Tactical Debriefing — valutazione qualitativa post-sessione (Fase 1 del
 * refactoring "Symbiote Awakening"). Ogni sessione di Focus chiusa
 * volontariamente (Termina Sessione / Avvia Pausa) chiede all'utente di
 * valutare il proprio livello di concentrazione reale, applicando un
 * moltiplicatore XP dedicato oltre ai già esistenti (CFU, Overdrive,
 * Streak, Fatigue).
 */
export const FOCUS_QUALITY = {
  FLOW: 'FLOW',
  NORMAL: 'NORMAL',
  DISTRACTED: 'DISTRACTED'
};

export const DEFAULT_FOCUS_QUALITY = FOCUS_QUALITY.NORMAL;

export const FOCUS_QUALITY_META = {
  FLOW: {
    id: 'FLOW',
    label: 'Spider-Sense / Flow State',
    shortLabel: 'Flow State',
    hint: 'Concentrazione totale, quasi nessuna distrazione.',
    // V42 — il giudizio è un dato per te (Star Log, K.A.R.E.N.), non un
    // premio: con +15%/-10% conveniva dichiararsi sempre in Flow.
    xpMultiplier: 1,
    badge: 'Flow',
    icon: 'bolt',
    color: 'text-af-attack',
    border: 'border-af-attack/50',
    bg: 'bg-af-attack/10',
    glow: 'shadow-attack-glow'
  },
  NORMAL: {
    id: 'NORMAL',
    label: 'Produttiva / Normale',
    shortLabel: 'Normale',
    hint: 'Ritmo di lavoro solido.',
    xpMultiplier: 1,
    badge: 'Normale',
    icon: 'check',
    color: 'text-af-refuel',
    border: 'border-af-refuel/50',
    bg: 'bg-af-refuel/10',
    glow: 'shadow-refuel-glow'
  },
  DISTRACTED: {
    id: 'DISTRACTED',
    label: 'Distratta / Faticosa',
    shortLabel: 'Distratta',
    hint: 'Sessione difficile: dirlo aiuta Karen a tarare timer e carico.',
    xpMultiplier: 1,
    badge: 'Faticosa',
    icon: 'alertTriangle',
    color: 'text-af-decay',
    border: 'border-af-decay/50',
    bg: 'bg-af-decay/10',
    glow: 'shadow-decay-glow'
  }
};

/**
 * V25.0 — "The Endgame": Dynamic Titles Engine. Cinque bande di livello,
 * ognuna con la propria identità cromatica (classe Tailwind pronta per
 * bg-clip-text + un glow dedicato), pensate per rendere leggibile a colpo
 * d'occhio "quanto lontano" è arrivato il Cadetto. Le bande più alte usano
 * gradienti multi-stop; l'ultima ("Difensore del Multiverso") è animata
 * (vedi keyframe `gradient-shift` in tailwind.config.js).
 */
export const RANK_TIERS = [
  {
    minLevel: 1,
    maxLevel: 9,
    title: 'Bimbo Ragno',
    textClass: 'text-slate-400',
    glowClass: '',
    chipClass: 'bg-slate-800/60 text-slate-300 border-slate-600/40',
    animated: false
  },
  {
    minLevel: 10,
    maxLevel: 19,
    title: 'Ragno di Quartiere',
    textClass: 'bg-clip-text text-transparent bg-gradient-to-r from-cyan-300 to-blue-500',
    glowClass: 'drop-shadow-[0_0_10px_rgba(56,189,248,0.55)]',
    chipClass: 'bg-cyan-500/15 text-cyan-300 border-cyan-400/40',
    animated: false
  },
  {
    minLevel: 20,
    maxLevel: 39,
    title: 'Vendicatore in Addestramento',
    textClass: 'bg-clip-text text-transparent bg-gradient-to-r from-fuchsia-400 via-purple-400 to-violet-600',
    glowClass: 'drop-shadow-[0_0_10px_rgba(217,70,239,0.55)]',
    chipClass: 'bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-400/40',
    animated: false
  },
  {
    minLevel: 40,
    maxLevel: 49,
    title: 'Iron Spider',
    textClass: 'bg-clip-text text-transparent bg-gradient-to-r from-red-500 via-orange-400 to-amber-300',
    glowClass: 'drop-shadow-[0_0_12px_rgba(239,68,68,0.6)]',
    chipClass: 'bg-red-500/15 text-red-300 border-red-400/40',
    animated: false
  },
  {
    minLevel: 50,
    maxLevel: Infinity,
    title: 'Difensore del Multiverso',
    // Nota tecnica: Tailwind supporta un SOLO stop `via-*` per gradiente
    // (classi via- multiple si sovrascrivono a vicenda, l'ultima vince) —
    // per un vero gradiente a 4 colori che rientra su se stesso si usa
    // un'immagine di sfondo arbitraria invece di impilare `via-*` morte.
    textClass:
      'af-title-epic bg-clip-text text-transparent bg-[linear-gradient(90deg,#e879f9,#67e8f9,#fcd34d,#e879f9)] bg-[length:300%_auto] animate-gradient-shift',
    glowClass: 'drop-shadow-[0_0_14px_rgba(255,255,255,0.55)]',
    chipClass: 'bg-white/10 text-white border-white/30',
    animated: true
  }
];

/** Ricava la banda di rango attiva per un dato livello (mai undefined: L1 come minimo garantito). */
export function getRankMeta(level) {
  let tier = RANK_TIERS[0];
  for (const t of RANK_TIERS) {
    if (level >= t.minLevel) tier = t;
    else break;
  }
  return tier;
}

/** Compat: alcuni chiamanti storici vogliono solo la stringa del titolo. */
export function getRankTitle(level) {
  return getRankMeta(level).title;
}

/**
 * Buff XP legato alla streak di giorni consecutivi di attività.
 * @param {number} streak - streak corrente in giorni
 * @param {number} [streakThresholdBonus] - riduzione (in giorni) delle soglie,
 *   concessa dallo Skill Tree ("Sesto Senso Ragnesco": raggiungi prima i bonus streak).
 */
export function computeStreakMultiplier(streak, streakThresholdBonus = 0) {
  const highThreshold = Math.max(1, 7 - streakThresholdBonus);
  const lowThreshold = Math.max(1, 3 - streakThresholdBonus);
  if (streak >= highThreshold) return 1.2;
  if (streak >= lowThreshold) return 1.1;
  return 1;
}

/** Peso dei CFU sull'XP: una materia da 12 CFU vale il 60% di XP in più di una da 0. */
export function computeCfuMultiplier(cfu = 0) {
  return 1 + Math.max(0, cfu) * CFU_XP_WEIGHT;
}

/**
 * V42 — CURVA DEI LIVELLI ribilanciata.
 *
 * La curva cubica della V25 era tarata per LIVELLO (Lv.10 = 15.000 XP,
 * Lv.30 = 100.000, Lv.50 = 308.000 per salire di un livello), e il
 * commento la leggeva come totale: in realtà il Lv.50 costava 4,73 milioni
 * di XP cumulati, circa 12-16 anni di studio onesto, e dal Lv.20 in su un
 * livello chiedeva mesi. I Tech Token, che arrivano dai livelli, si
 * fermavano proprio quando lo Skill Tree diventava interessante.
 *
 * Ora il costo cresce in modo quadratico dolce:
 *   xp(n) = 1000 + 150·(n-1) + 14·(n-1)²   (arrotondato a 50)
 * Lv.10 = 3.500 per livello, Lv.30 = 17.100, Lv.49 = 40.450; il Lv.50
 * richiede circa 758.000 XP totali: con ~4 ore di studio al giorno, due
 * anni e mezzo — un traguardo da laurea, raggiungibile.
 *
 * I profili esistenti si convertono UNA volta sugli XP TOTALI (vedi
 * convertProfileToCurveV2): nessun XP perso, livello ricalcolato.
 */
export const XP_CURVE_VERSION = 2;

export function xpRequiredForLevel(level) {
  const n = Math.max(1, Math.floor(Number(level) || 1));
  const raw = 1000 + 150 * (n - 1) + 14 * (n - 1) * (n - 1);
  return Math.max(1000, Math.round(raw / 50) * 50);
}

/** La curva della V25-V41, solo per convertire i profili salvati. */
const XP_CURVE_A = 956.8965517;
const XP_CURVE_B = 41.85775862;
const XP_CURVE_C = 1.245689655;
export function xpRequiredForLevelV1(level) {
  const n = Math.max(1, level);
  const raw = XP_CURVE_A * n + XP_CURVE_B * n * n + XP_CURVE_C * n * n * n;
  return Math.max(1000, Math.round(raw / 50) * 50);
}

/**
 * Costo Stamina di una sessione di Focus.
 *
 * V42 — tarato sulla TUA capacità giornaliera: una giornata di studio
 * piena (la capacità misurata) consuma circa tre quarti della Stamina, e
 * la stanchezza (sotto 20) arriva solo oltre la giornata tipo. Prima il
 * costo era fisso (15 ogni 25 minuti): la stanchezza scattava dopo 150
 * minuti, sotto il piano di 4,5 ore che l'app stessa chiedeva, e dimezzava
 * gli XP proprio a chi lo seguiva. Maximum Carnage non azzera più il costo.
 *
 * @param {number} focusMinutes
 * @param {string} [difficulty]
 * @param {number} [staminaCostMultiplier] dallo Skill Tree
 * @param {boolean} [_isMaxCarnage] ignorato (compatibilità)
 * @param {number} [capacityHours] capacità giornaliera (calibrazione)
 */
export const STAMINA_DAY_FACTOR = 1.3;
export function computeFocusStaminaCost(focusMinutes, difficulty = DIFFICULTY.MEDIUM, staminaCostMultiplier = 1, _isMaxCarnage = false, capacityHours = 4.5) {
  const meta = DIFFICULTY_META[difficulty] || DIFFICULTY_META.MEDIUM;
  const cap = Number(capacityHours) > 0 ? Math.min(10, Math.max(1, Number(capacityHours))) : 4.5;
  const minutiGiornata = cap * 60 * STAMINA_DAY_FACTOR;
  const base = (Math.max(0, Number(focusMinutes) || 0) / minutiGiornata) * 100;
  return Math.max(1, Math.ceil(base * meta.staminaMultiplier * staminaCostMultiplier));
}

/**
 * V42 — Le PAUSE ricaricano: 0,6 Stamina per minuto di pausa (5 minuti ->
 * 3, pausa lunga da 15 -> 9), di più con "Simbiosi Rigenerante".
 */
export const BREAK_STAMINA_PER_MINUTE = 0.6;
export function computeBreakStaminaRestore(breakMinutes, bonus = 0) {
  const m = Math.max(0, Math.min(60, Number(breakMinutes) || 0));
  return Math.round(m * BREAK_STAMINA_PER_MINUTE * (1 + Math.max(0, Number(bonus) || 0)));
}

/**
 * Calcola l'XP guadagnato per una sessione di Focus o un completamento nodo.
 * Formula CFU: XP_Base * (1 + CFU * 0.05) — una materia da 12 CFU vale il
 * 60% di XP in più di una materia "leggera".
 * @param {object} params
 * @param {number} params.focusMinutes - durata del focus in minuti
 * @param {number} [params.cfu] - CFU della materia (0 se nessuna materia collegata)
 * @param {boolean} params.isOverdrive - sessione avviata in Overdrive
 * @param {boolean} params.isFatigued - stamina < 20% (x0.5)
 * @param {string} [params.difficulty] - EASY/MEDIUM/HARD, default MEDIUM (+30% su Hard)
 * @param {number} [params.streak] - streak corrente, applica il moltiplicatore streak
 * @param {string} [params.quality] - FOCUS_QUALITY del Tactical Debriefing (default NORMAL)
 * @param {number} [params.xpBonusPct] - bonus percentuale piatto dallo Skill Tree ("Focus Migliorato")
 * @param {number} [params.overdriveMultiplier] - moltiplicatore Overdrive effettivo (default costante globale,
 *   potenziato dallo Skill Tree "Adrenalina da Combattimento")
 * @param {number} [params.streakThresholdBonus] - vedi computeStreakMultiplier
 */
export function computeFocusXp({
  focusMinutes,
  baseMinutes = null,
  cfu = 0,
  isOverdrive,
  isFatigued,
  difficulty = DIFFICULTY.MEDIUM,
  streak = 0,
  quality = DEFAULT_FOCUS_QUALITY,
  xpBonusPct = 0,
  overdriveMultiplier = OVERDRIVE_MULTIPLIER,
  streakThresholdBonus = 0,
  isMaxCarnage = false
}) {
  const diffMeta = DIFFICULTY_META[difficulty] || DIFFICULTY_META.MEDIUM;
  const qualityMeta = FOCUS_QUALITY_META[quality] || FOCUS_QUALITY_META[DEFAULT_FOCUS_QUALITY];
  const minuti = Math.max(0, Number(focusMinutes) || 0);
  // V42 — l'Overdrive moltiplica SOLO il blocco extra oltre quello
  // pianificato. Prima moltiplicava tutta la catena: 25+25 minuti
  // concatenati valevano il 28% in più di 25 + pausa + 25.
  const base = isOverdrive && Number.isFinite(Number(baseMinutes)) ? Math.min(minuti, Math.max(0, Number(baseMinutes))) : minuti;
  const extra = isOverdrive ? Math.max(0, minuti - base) : 0;
  let xp = (base + extra * overdriveMultiplier) * XP_PER_FOCUS_MINUTE;
  xp *= diffMeta.xpMultiplier;
  xp *= computeCfuMultiplier(cfu);
  xp *= qualityMeta.xpMultiplier;
  xp *= computeStreakMultiplier(streak, streakThresholdBonus);
  if (xpBonusPct) xp *= 1 + xpBonusPct;
  if (isFatigued) xp *= FATIGUE_MULTIPLIER;
  // Maximum Carnage Mode (V27.0, Pillar 3): raddoppio finale, applicato per
  // ultimo cosi' da moltiplicare l'intero risultato già rifinito da ogni
  // altro fattore — mai combinato "dentro" gli altri moltiplicatori.
  if (isMaxCarnage) xp *= MAX_CARNAGE_MULTIPLIER;
  return Math.round(xp);
}

/**
 * Applica un delta di XP al profilo, gestendo il cascading di più
 * level-up in un colpo solo (es. un bonus enorme che sfonda 2 soglie).
 * L'XP non può mai scendere sotto zero all'interno del livello corrente:
 * se un decremento (Blood Pact, Reward Shop, Last Stand) sfonda lo zero,
 * si passa al livello precedente (mai sotto il livello 1) riportando
 * l'eccedenza.
 */
export function applyXpDelta(profile, delta) {
  let { level, currentXp } = profile;
  // Blindatura V25.0: delta/currentXp/level non numerici (salvataggi
  // corrotti, importazioni malformate) non devono mai propagare NaN
  // nell'intero profilo — fallback sicuro ai valori minimi validi.
  if (!Number.isFinite(currentXp)) currentXp = 0;
  if (!Number.isFinite(level) || level < 1) level = 1;
  if (!Number.isFinite(delta)) delta = 0;

  currentXp += delta;

  while (currentXp < 0 && level > 1) {
    level -= 1;
    currentXp += xpRequiredForLevel(level);
  }
  if (currentXp < 0) currentXp = 0;

  while (currentXp >= xpRequiredForLevel(level)) {
    currentXp -= xpRequiredForLevel(level);
    level += 1;
  }

  return { ...profile, level, currentXp };
}

/**
 * Tech Token: 1 per ogni livello raggiunto PER LA PRIMA VOLTA.
 *
 * V42 — il conto si fa sul livello massimo mai raggiunto
 * (`maxLevelReached`): perdere un livello (Blood Pact, Reward Shop, Last
 * Stand) e riguadagnarlo non paga di nuovo — prima tre cicli di Blood Pact
 * davano tre token. E vale per TUTTI gli XP (quest, protocolli, forziere):
 * prima un level-up arrivato da una quest non dava il token.
 */
export function applyXpDeltaWithTokens(profile, delta) {
  const before = Number.isFinite(profile?.level) ? profile.level : 1;
  const maxPrima = Math.max(before, Number.isFinite(profile?.maxLevelReached) ? profile.maxLevelReached : before);
  const updated = applyXpDelta(profile, delta);
  if (updated.level <= maxPrima) return { ...updated, maxLevelReached: maxPrima };
  const guadagnati = updated.level - maxPrima;
  const techTokens = (Number.isFinite(profile?.techTokens) ? profile.techTokens : 0) + guadagnati;
  return { ...updated, techTokens, maxLevelReached: updated.level };
}

/**
 * V42 — Conversione una tantum alla nuova curva, sugli XP TOTALI: stesso
 * potere d'acquisto nel Reward Shop, livello ricalcolato, un Tech Token
 * per ogni livello nuovo oltre il massimo raggiunto.
 * @returns {{profile:object, fromLevel:number, toLevel:number, tokens:number}}
 */
export function convertProfileToCurveV2(profile) {
  if (!profile || profile.xpCurveVersion === XP_CURVE_VERSION) return { profile, fromLevel: profile?.level ?? 1, toLevel: profile?.level ?? 1, tokens: 0 };
  const level = Number.isFinite(profile.level) && profile.level >= 1 ? Math.floor(profile.level) : 1;
  let totale = Number.isFinite(profile.currentXp) && profile.currentXp > 0 ? profile.currentXp : 0;
  for (let L = 1; L < level; L += 1) totale += xpRequiredForLevelV1(L);
  let nuovo = 1;
  let resto = totale;
  while (resto >= xpRequiredForLevel(nuovo) && nuovo < 999) {
    resto -= xpRequiredForLevel(nuovo);
    nuovo += 1;
  }
  const maxPrima = Math.max(level, Number.isFinite(profile.maxLevelReached) ? profile.maxLevelReached : level);
  const tokens = Math.max(0, nuovo - maxPrima);
  return {
    profile: {
      ...profile,
      level: nuovo,
      currentXp: resto,
      maxLevelReached: Math.max(maxPrima, nuovo),
      techTokens: (Number.isFinite(profile.techTokens) ? profile.techTokens : 0) + tokens,
      xpCurveVersion: XP_CURVE_VERSION
    },
    fromLevel: level,
    toLevel: nuovo,
    tokens
  };
}

/**
 * V42 — XP del COMPLETAMENTO di un argomento: un premio di traguardo
 * (40 XP pesati per difficoltà, CFU e streak), pagato una volta sola.
 * Il tempo di studio è già pagato dalle sessioni di Focus: prima il
 * completamento regalava i minuti di `focusTime` (fino a 180) a ogni click,
 * e completa/riapri a ripetizione produceva migliaia di XP.
 * Senza almeno 15 minuti tracciati sull'argomento vale 10 XP.
 */
export const NODE_COMPLETION_BASE_XP = 40;
export const NODE_COMPLETION_MIN_MINUTES = 15;
export function computeNodeCompletionXp({ difficulty = DIFFICULTY.MEDIUM, cfu = 0, trackedMinutes = 0, streak = 0, streakThresholdBonus = 0, xpBonusPct = 0, isMaxCarnage = false }) {
  if (!(Number(trackedMinutes) >= NODE_COMPLETION_MIN_MINUTES)) return 10;
  const diffMeta = DIFFICULTY_META[difficulty] || DIFFICULTY_META.MEDIUM;
  let xp = NODE_COMPLETION_BASE_XP * diffMeta.xpMultiplier * computeCfuMultiplier(cfu) * computeStreakMultiplier(streak, streakThresholdBonus);
  if (xpBonusPct) xp *= 1 + xpBonusPct;
  if (isMaxCarnage) xp *= MAX_CARNAGE_MULTIPLIER;
  return Math.round(xp);
}

/** Penalità Blood Pact effettiva, ridotta dallo Skill Tree ("Nervi d'Acciaio"). */
export function computeBloodPactPenalty(bloodPactReduction = 0) {
  return Math.max(1, Math.round(BLOOD_PACT_PENALTY * (1 - bloodPactReduction)));
}

/** XP flat di un ripasso, potenziata dallo Skill Tree ("Web-Shooter Potenziati"). */
export function computeReviewXp(reviewXpBonus = 0) {
  return REVIEW_FLAT_XP + Math.max(0, reviewXpBonus);
}

/**
 * XP totale "bancato" dal giocatore: l'XP del livello corrente più tutta
 * l'XP richiesta dai livelli già superati. Rappresenta il vero potere
 * d'acquisto nel Reward Shop e la base di calcolo del sacrificio Last Stand.
 */
export function computeTotalBankedXp(profile) {
  const { level, currentXp } = profile;
  let banked = currentXp;
  for (let L = 1; L < level; L += 1) {
    banked += xpRequiredForLevel(L);
  }
  return banked;
}
