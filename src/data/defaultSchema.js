import { PERSISTED_STATUS } from '../utils/skillTree.js';
import { DIFFICULTY } from '../utils/xpEngine.js';
import { computeInitialReviewDate } from '../utils/spiderSense.js';
import { HOURS_PER_NODE_DAY } from '../utils/materiaMeta.js';

/**
 * Schema di default ArachnoForge — versione dati 7.0.0 "The Quantum Router"
 * (V23.0). Iniettato silenziosamente alla prima esecuzione (Safe Hydration).
 */
export const SCHEMA_VERSION = '8.0.0';
export const SUITS = { CLASSIC: 'classic', SYMBIOTE: 'symbiote', Y2099: '2099' };
export const DEFAULT_CFU = 6;

export function createDefaultState() {
  const now = new Date().toISOString();
  return {
    metadata: {
      version: SCHEMA_VERSION,
      lastSaveTimestamp: now
    },
    profile: {
      username: 'Cadetto',
      level: 1,
      currentXp: 0,
      streak: 0,
      stamina: 100,
      lastActiveDate: now,
      lastStaminaResetDate: now,
      overdriveCount: 0,
      bloodPactCount: 0,
      quickQuestsUsed: 0,
      hardNodesCompleted: 0,
      reviewsCompleted: 0,
      lastStandCount: 0,
      dailyProtocolsCompletedToday: [],
      // V23.0 — Daily Patrol Engine: contatore lifetime di missioni
      // giornaliere completate (di qualunque tier), alimenta il trofeo
      // segreto "Karen's Favorite" e potrà alimentare altre statistiche.
      dailyPatrolsCompleted: 0,
      // V25.0 — Pillar 3 (Tech Tokens & Passive Skill Tree): 1 token per
      // ogni Level Up, spendibile nello Skill Tree della Suit Lab.
      techTokens: 0,
      unlockedSkills: [],
      // V27.0 — Pillar 3 (Maximum Carnage Mode): streak di azioni critiche
      // (nodi Hard, Overdrive, vittorie Boss Fight) verso il prossimo
      // sblocco, più lo stato della finestra attiva da 2 ore corrente.
      criticalActionStreak: 0,
      maxCarnageActive: false,
      maxCarnageExpiresAt: null,
      // V27.0 — Pillar 4 (Daily Web-Sling): dateKey dell'ultimo riscatto
      // del Forziere di Parker — un solo claim al giorno, blindato sulla
      // stessa chiave calendariale del Daily Patrol Engine.
      webSlingLastClaimDateKey: null,
      // V31.3 — Pity System: aperture consecutive senza tier Raro+,
      // vedi utils/webSling.js (rollWebSlingRewardWithPity).
      webSlingPityCounter: 0,
      // V31.3 — Suit Unlock Gating: la Symbiote Suit si sblocca al primo
      // trigger di Maximum Carnage Mode (vedi applyCriticalAction) — un
      // flag one-way, mai revocato. La 2099 Suit non ha bisogno di un
      // flag dedicato: si sblocca direttamente a Lv.50+ (vedi CoreConfig).
      symbioteSuitUnlocked: false,
      // V33.1 — Sinister Six Gauntlet: contatore lifetime delle run
      // completate "pulite" (6/6 Villain abbattuti nella stessa run senza
      // mai perdere un round) — alimenta il trofeo dedicato in
      // data/trophies.js, stesso pattern di dailyPatrolsCompleted.
      gauntletsCleared: 0
    },
    settings: {
      focusTime: 25,
      shortBreakTime: 5,
      longBreakTime: 15,
      suit: SUITS.CLASSIC,
      calmMode: false,
      soundEffects: true
    },
    materie: [],
    starLog: [],
    // V32.0 — Multiverse Simulator (Storico Media Ponderata): ogni volta
    // che una Materia passa a "votata" per la prima volta, il reducer
    // registra un punto `{ dateKey, average, gradedCount }` qui — un
    // ledger append-only leggero (solo 3 numeri/stringhe per voce, non i
    // dettagli della Materia) che alimenta il grafico storico. Mai
    // ricalcolato retroattivamente sui voti passati: uno storico onesto
    // parte da zero al momento dell'aggiornamento.
    gradeHistory: [],
    combatLog: [],
    // V31.3 — Reward Shop: un profilo nuovo di zecca partiva sempre vuoto,
    // costringendo il Cadetto a inventarsi da solo la prima ricompensa
    // prima che il loop "guadagna XP -> spendi XP" avesse un senso
    // qualsiasi. Quattro esempi di partenza, liberamente modificabili o
    // cancellabili — MAI iniettati retroattivamente su un profilo già
    // esistente (vedi hydrateState: uno shopRewards già presente, anche
    // vuoto, resta intoccato).
    shopRewards: [
      { id: 'reward_starter_snack', nome: 'Snack goloso', costoXp: 50 },
      { id: 'reward_starter_episodio', nome: 'Un episodio della tua serie preferita', costoXp: 80 },
      { id: 'reward_starter_gioco', nome: '30 minuti di gioco libero', costoXp: 120 },
      { id: 'reward_starter_cinema', nome: 'Serata cinema', costoXp: 300 }
    ],
    inventory: [],
    trophies: [],
    quickQuests: [
      { id: 'qq_palestra', nome: 'Allenamento Palestra', staminaReward: 50, xpReward: 25 },
      { id: 'qq_pasto', nome: 'Pasto Completo', staminaReward: 20, xpReward: 0 },
      { id: 'qq_sonno', nome: '8 Ore di Sonno', staminaReward: 100, xpReward: 0 },
      { id: 'qq_passeggiata', nome: 'Passeggiata all’Aperto', staminaReward: 15, xpReward: 10 }
    ],
    // V23.0 — The Daily Patrol Engine (Modulo 2): 3 missioni vere e
    // proprie (una per tier EASY/MEDIUM/HARD), rigenerate ogni giorno e
    // aggiornate in modo "event-driven" dal reducer (vedi
    // src/utils/dailyPatrol.js — applyQuestEvent). `quests` parte vuoto:
    // la prima generazione avviene al mount tramite l'effetto dedicato in
    // ArachnoForgeContext (dateKey nullo != dateKey odierno).
    dailyPatrols: {
      dateKey: null,
      quests: []
    }
  };
}

/** Porta un nodo salvato con schemi precedenti (status LOCKED/AVAILABLE
 * lineare, tentativi successo/fallimento, nessun parentId/difficulty) alla
 * forma 3.0.0: la catena di sblocco lineare diventa parentId verso il
 * fratello precedente; i vecchi nodi COMPLETED ricevono una prima
 * nextReviewDate calcolata da oggi (+7gg) se non già presente. */
function migrateSfida(raw, index, arr) {
  const legacyStatus = raw.status;
  const status = legacyStatus === 'COMPLETED' ? PERSISTED_STATUS.COMPLETED : PERSISTED_STATUS.PENDING;
  const parentId = 'parentId' in raw ? raw.parentId : (index > 0 ? arr[index - 1].id : null);
  const nextReviewDate = status === PERSISTED_STATUS.COMPLETED
    ? (raw.nextReviewDate || computeInitialReviewDate())
    : null;
  return {
    id: raw.id,
    nome: raw.nome,
    obiettivo: raw.obiettivo || '',
    // V34.2 — "Ore Previste": migrazione silenziosa dal vecchio campo
    // `giorni` (numero intero di giorni) al nuovo `oreStimate` (ore,
    // granularità decimale). Se il nodo ha già `oreStimate` (già
    // migrato/creato dopo l'update), lo usa direttamente; altrimenti
    // converte il vecchio `giorni` moltiplicandolo per HOURS_PER_NODE_DAY
    // — cosi' un nodo salvato come "3 giorni" prima dell'update proietta
    // ESATTAMENTE lo stesso carico di lavoro (13.5 ore) invece di
    // ridursi silenziosamente a "3 ore" con la sola rietichettatura.
    // Fallback neutro di 2 ore se nessuno dei due campi è presente/valido.
    oreStimate: Number.isFinite(raw.oreStimate) && raw.oreStimate > 0
      ? raw.oreStimate
      : (Number.isFinite(raw.giorni) && raw.giorni > 0 ? raw.giorni * HOURS_PER_NODE_DAY : 2),
    parentId: parentId || null,
    difficulty: raw.difficulty || DIFFICULTY.MEDIUM,
    status,
    completionTimestamp: raw.completionTimestamp || null,
    nextReviewDate,
    lastReviewRating: raw.lastReviewRating || null,
    reviewCount: typeof raw.reviewCount === 'number' ? raw.reviewCount : 0,
    focusMinutes: raw.focusMinutes || 0,
    blueprint: raw.blueprint || '',
    // V31.3 — Bounty Board (Friction Analytics): contatori di ripasso
    // Facile/Medio vs Difficile per nodo, alimentano `utils/friction.js`.
    // Blindati a interi >= 0 anche da un import/salvataggio corrotto.
    tentativiSuccessi: Number.isFinite(raw.tentativiSuccessi) && raw.tentativiSuccessi >= 0 ? raw.tentativiSuccessi : 0,
    tentativiFalliti: Number.isFinite(raw.tentativiFalliti) && raw.tentativiFalliti >= 0 ? raw.tentativiFalliti : 0
  };
}

function migrateMateria(raw) {
  const sfideRaw = Array.isArray(raw.sfide) ? raw.sfide : [];
  const cfu = typeof raw.cfu === 'number' ? raw.cfu : (raw.isCritical ? 9 : DEFAULT_CFU);
  return {
    id: raw.id,
    nome: raw.nome,
    examDate: raw.examDate ? String(raw.examDate).slice(0, 10) : null,
    cfu,
    createdAt: raw.createdAt || new Date().toISOString(),
    sfide: sfideRaw.map(migrateSfida),
    // V17.0 — Web-Path Planner (Vanvitelli Exam Engine): collega la Materia
    // a un corso ufficiale del piano di studi (null per "Materia Libera").
    // Retro-compatibile: profili < v17 non hanno questi campi, ricevono i
    // default neutri qui sotto senza mai lanciare un'eccezione.
    courseId: raw.courseId || null,
    perceivedDifficulty: Number.isFinite(raw.perceivedDifficulty) ? raw.perceivedDifficulty : 3,
    urgency: Number.isFinite(raw.urgency) ? raw.urgency : 3,
    examPassed: !!raw.examPassed,
    // V18.0 — Multiverse Simulator (GPA Engine): voto registrato all'esame
    // ufficiale (18-30), con flag Lode separato. `voto` resta `null`
    // finché l'utente non lo inserisce esplicitamente: nessun voto
    // inventato entra mai nella Media Ponderata.
    voto: Number.isFinite(raw.voto) && raw.voto >= 18 && raw.voto <= 30 ? raw.voto : null,
    lode: !!raw.lode
  };
}

/**
 * Fonde in modo sicuro lo stato letto da LocalStorage con lo schema di
 * default, così eventuali campi mancanti (versioni precedenti, dati
 * corrotti parzialmente) non causano crash da 'undefined'. Effettua anche
 * la migrazione strutturale dei nodi verso lo schema 3.0.0.
 */
export function hydrateState(rawState) {
  const defaults = createDefaultState();
  if (!rawState || typeof rawState !== 'object') return defaults;

  // V25.0 — Blindatura Tech Tokens: un profilo pre-V25 (o un import
  // corrotto) può non avere `techTokens`/`unlockedSkills`, oppure averli
  // in una forma inattesa (NaN, non-array). Mai propagare quei valori
  // "sporchi" nello stato idratato: fallback sicuro ai default neutri.
  const rawProfile = rawState.profile || {};
  const safeProfile = {
    ...defaults.profile,
    ...rawProfile,
    techTokens: Number.isFinite(rawProfile.techTokens) && rawProfile.techTokens >= 0 ? rawProfile.techTokens : 0,
    unlockedSkills: Array.isArray(rawProfile.unlockedSkills) ? rawProfile.unlockedSkills : [],
    // V27.0 — Blindatura Maximum Carnage / Web-Sling: mai propagare valori
    // "sporchi" (NaN, stringhe, timestamp malformati) da un salvataggio
    // corrotto o un import esterno — fallback sicuro ai default neutri.
    criticalActionStreak: Number.isFinite(rawProfile.criticalActionStreak) && rawProfile.criticalActionStreak >= 0 ? rawProfile.criticalActionStreak : 0,
    maxCarnageActive: rawProfile.maxCarnageActive === true,
    maxCarnageExpiresAt: typeof rawProfile.maxCarnageExpiresAt === 'string' ? rawProfile.maxCarnageExpiresAt : null,
    webSlingLastClaimDateKey: typeof rawProfile.webSlingLastClaimDateKey === 'string' ? rawProfile.webSlingLastClaimDateKey : null,
    webSlingPityCounter: Number.isFinite(rawProfile.webSlingPityCounter) && rawProfile.webSlingPityCounter >= 0 ? rawProfile.webSlingPityCounter : 0,
    // V31.3 — Suit Unlock Gating: retro-compatibile — un profilo pre-V31.3
    // che ha GIÀ la Symbiote Suit attiva in `settings.suit` viene
    // grandfathered direttamente in CoreConfig (mai un downgrade forzato),
    // quindi qui basta un fallback booleano sicuro.
    symbioteSuitUnlocked: rawProfile.symbioteSuitUnlocked === true,
    // V33.1 — Blindatura contatore Gauntlet: mai propagare un valore
    // "sporco" (NaN, negativo, stringa) da un salvataggio corrotto.
    gauntletsCleared: Number.isFinite(rawProfile.gauntletsCleared) && rawProfile.gauntletsCleared >= 0 ? rawProfile.gauntletsCleared : 0
  };

  return {
    metadata: { ...defaults.metadata, ...(rawState.metadata || {}), version: SCHEMA_VERSION },
    profile: safeProfile,
    settings: { ...defaults.settings, ...(rawState.settings || {}) },
    materie: Array.isArray(rawState.materie) ? rawState.materie.map(migrateMateria) : defaults.materie,
    starLog: Array.isArray(rawState.starLog) ? rawState.starLog : defaults.starLog,
    // V32.0 — Storico Media Ponderata: blindato voce per voce (mai un
    // punto con data/average corrotti che romperebbe il grafico).
    gradeHistory: Array.isArray(rawState.gradeHistory)
      ? rawState.gradeHistory.filter((e) => e && typeof e.dateKey === 'string' && Number.isFinite(e.average))
      : defaults.gradeHistory,
    combatLog: Array.isArray(rawState.combatLog) ? rawState.combatLog : defaults.combatLog,
    shopRewards: Array.isArray(rawState.shopRewards) ? rawState.shopRewards : defaults.shopRewards,
    inventory: Array.isArray(rawState.inventory) ? rawState.inventory : defaults.inventory,
    trophies: Array.isArray(rawState.trophies) ? rawState.trophies : defaults.trophies,
    quickQuests: Array.isArray(rawState.quickQuests) && rawState.quickQuests.length > 0
      ? rawState.quickQuests.map((q) => ({ xpReward: 0, ...q }))
      : defaults.quickQuests,
    // V23.0 — Daily Patrol Engine: la struttura `{ claimed }` della V20 è
    // stata sostituita da `{ quests: [] }` (motore event-driven). Un
    // profilo salvato con lo schema vecchio non è compatibile campo per
    // campo: viene semplicemente ignorato e sostituito dal default neutro
    // (`dateKey: null`), che la prima generazione in Context ripopolerà
    // immediatamente al prossimo mount — nessun crash, nessuna quest
    // fantasma con struttura obsoleta.
    dailyPatrols: rawState.dailyPatrols && Array.isArray(rawState.dailyPatrols.quests)
      ? { dateKey: rawState.dailyPatrols.dateKey || null, quests: rawState.dailyPatrols.quests }
      : defaults.dailyPatrols
  };
}
