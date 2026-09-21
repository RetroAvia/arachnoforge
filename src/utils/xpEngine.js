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
 * applicato DOPO tutti gli altri fattori (CFU, Overdrive, Qualità, Streak,
 * Notturno, Skill Tree) — un vero raddoppio finale, mai un bonus piatto
 * che si perderebbe nell'arrotondamento. Il costo Stamina viene invece
 * azzerato del tutto (vedi computeFocusStaminaCost) per l'intera finestra
 * di 2 ore: "furia dopaminica" totale, nessun compromesso energetico.
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

export function computeSpiderSenseSurgeXp(perceivedDifficulty) {
  const safeDifficulty =
    Number.isFinite(perceivedDifficulty) && perceivedDifficulty >= 1 && perceivedDifficulty <= 5
      ? perceivedDifficulty
      : SPIDER_SENSE_NEUTRAL_DIFFICULTY;
  return Math.round(SPIDER_SENSE_BASE_XP * (safeDifficulty / SPIDER_SENSE_NEUTRAL_DIFFICULTY));
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
    xpMultiplier: 1.15,
    badge: '+15% XP',
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
    hint: 'Ritmo di lavoro solido, nessun bonus o penalità.',
    xpMultiplier: 1,
    badge: 'XP Standard',
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
    hint: 'Sessione difficile: attiva un Daily Protocol per recuperare.',
    xpMultiplier: 0.9,
    badge: '-10% XP',
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
 * V25.0 — Curva di Progressione Esponenziale ("The Endgame"). Sostituisce
 * la vecchia progressione lineare (level * 1000) con una cubica calibrata
 * per accelerare drasticamente nel lungo periodo, restando comunque
 * raggiungibile: Lv.1 = 1.000 XP, Lv.10 ≈ 15.000 XP, Lv.30 ≈ 100.000 XP,
 * Lv.50 ≈ 308.000 XP ("Difensore del Multiverso" — un vero traguardo di
 * fine gioco). I tre coefficienti sono la soluzione esatta del sistema
 * lineare a 3 incognite che passa per (1, 1000), (10, 15000), (30, 100000):
 * un polinomio cubico cresce più che quadraticamente e dà quella sensazione
 * di "grind esponenziale" senza mai sfondare in valori astronomici
 * ingiocabili (una vera progressione geometrica a questi tassi renderebbe
 * il Lv.30 dell'ordine dei milioni di XP). Il risultato è arrotondato al
 * multiplo di 50 più vicino per numeri sempre "puliti" in UI.
 */
const XP_CURVE_A = 956.8965517;
const XP_CURVE_B = 41.85775862;
const XP_CURVE_C = 1.245689655;

export function xpRequiredForLevel(level) {
  const n = Math.max(1, level);
  const raw = XP_CURVE_A * n + XP_CURVE_B * n * n + XP_CURVE_C * n * n * n;
  return Math.max(1000, Math.round(raw / 50) * 50);
}

/**
 * Costo Stamina di una sessione di Focus, proporzionale alla durata reale
 * (non più un costo fisso), e scalato dalla difficoltà del nodo bersaglio.
 * Formula base: ceil((minuti / 25) * 15), poi moltiplicata per il peso
 * di difficoltà (Easy -0.8x, Medium 1x, Hard 1.3x).
 * @param {number} [staminaCostMultiplier] - moltiplicatore aggiuntivo dallo
 *   Skill Tree ("Resistenza Simbionte": la Stamina scende più lentamente).
 */
export function computeFocusStaminaCost(focusMinutes, difficulty = DIFFICULTY.MEDIUM, staminaCostMultiplier = 1, isMaxCarnage = false) {
  // Maximum Carnage Mode: "consumo di Stamina azzerato" — nessun calcolo
  // parziale, il costo è letteralmente 0 per tutta la finestra attiva.
  if (isMaxCarnage) return 0;
  const meta = DIFFICULTY_META[difficulty] || DIFFICULTY_META.MEDIUM;
  const base = Math.ceil((focusMinutes / BASE_FOCUS_MINUTES) * BASE_STAMINA_PER_25MIN);
  return Math.max(1, Math.ceil(base * meta.staminaMultiplier * staminaCostMultiplier));
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
 * @param {boolean} [params.nightBonus] - sessione nelle ore 00:00-04:00, Skill Tree ("Simbiosi Notturna")
 * @param {number} [params.overdriveMultiplier] - moltiplicatore Overdrive effettivo (default costante globale,
 *   potenziato dallo Skill Tree "Adrenalina da Combattimento")
 * @param {number} [params.streakThresholdBonus] - vedi computeStreakMultiplier
 */
export function computeFocusXp({
  focusMinutes,
  cfu = 0,
  isOverdrive,
  isFatigued,
  difficulty = DIFFICULTY.MEDIUM,
  streak = 0,
  quality = DEFAULT_FOCUS_QUALITY,
  xpBonusPct = 0,
  nightBonus = false,
  overdriveMultiplier = OVERDRIVE_MULTIPLIER,
  streakThresholdBonus = 0,
  isMaxCarnage = false
}) {
  const diffMeta = DIFFICULTY_META[difficulty] || DIFFICULTY_META.MEDIUM;
  const qualityMeta = FOCUS_QUALITY_META[quality] || FOCUS_QUALITY_META[DEFAULT_FOCUS_QUALITY];
  let xp = focusMinutes * XP_PER_FOCUS_MINUTE;
  xp *= diffMeta.xpMultiplier;
  xp *= computeCfuMultiplier(cfu);
  if (isOverdrive) xp *= overdriveMultiplier;
  xp *= qualityMeta.xpMultiplier;
  xp *= computeStreakMultiplier(streak, streakThresholdBonus);
  if (nightBonus) xp *= 1.1;
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
 * V25.0 — Pillar 3 (Tech Tokens): wrapper attorno ad applyXpDelta che
 * rileva quanti livelli sono stati guadagnati in questo singolo delta
 * (anche più di uno, in caso di XP-bomb) e accredita 1 Tech Token per
 * ogni livello superato, sulla STESSA transizione di stato — nessun
 * secondo dispatch, nessuna finestra in cui il token "non esiste ancora".
 * Mai applicato ai delta negativi (Blood Pact, Reward Shop, Last Stand):
 * applyXpDelta può far *scendere* di livello in quei casi, ma i Tech
 * Token già assegnati restano acquisiti per sempre (mai retrocessi).
 */
export function applyXpDeltaWithTokens(profile, delta) {
  const before = Number.isFinite(profile.level) ? profile.level : 1;
  const updated = applyXpDelta(profile, delta);
  const levelsGained = Math.max(0, updated.level - before);
  if (levelsGained === 0) return updated;
  const techTokens = (Number.isFinite(profile.techTokens) ? profile.techTokens : 0) + levelsGained;
  return { ...updated, techTokens };
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
