import { PERSISTED_STATUS } from '../utils/skillTree.js';
import { DIFFICULTY } from '../utils/xpEngine.js';
import { computeInitialReview, DEFAULT_EASE, INITIAL_REVIEW_INTERVAL_DAYS } from '../utils/spiderSense.js';
import { HOURS_PER_NODE_DAY } from '../utils/materiaMeta.js';
import { pruneStarLog } from '../utils/starLogMaintenance.js';
import { normalizeFonti } from '../utils/sintesiEngine.js';
import { createDefaultCampus, normalizeCampus } from '../utils/campusEngine.js';

/**
 * Schema di default ArachnoForge — versione dati 10.0.0 "Piano Reale"
 * (V37.0). Iniettato silenziosamente alla prima esecuzione (Safe
 * Hydration); ogni campo nuovo ha una migrazione non distruttiva in
 * migrateSfida/hydrateState, mai un reset del profilo.
 *
 * Novità 10.0.0:
 *  - `materia.examPassedDate` — la data in cui l'esame è stato
 *    effettivamente verbalizzato. Prima esisteva solo il booleano
 *    `examPassed`, e lo storico della media registrava il giorno in cui
 *    si spuntava la casella, non quello dell'esame: bastava inserire un
 *    esame con qualche settimana di ritardo per deformare il grafico.
 *  - `sfida.pagine` — le pagine di libro/appunti di QUEL nodo. Alimenta
 *    una stima delle ore basata sul tuo ritmo di lettura reale invece
 *    che sulle ore dichiarate a occhio (vedi utils/calibration.js).
 *
 * V38.0 — "La Forgia degli Appunti". Il lavoro su un argomento sono due
 * lavori: RICAVARE i propri appunti dalle fonti, e poi studiarli. Il
 * nodo li tiene separati:
 *  - `sfida.fonti[]` — libro, slide, dispense del prof: ognuna con le
 *    sue pagine totali e quelle già snellite;
 *  - `sfida.pagineAppunti` — le pagine dei TUOI appunti definitivi,
 *    prodotte finora. È il numero su cui poggia tutto il calcolo dello
 *    studio, ed è la migrazione diretta del vecchio `sfida.pagine`, che
 *    significava già questo;
 *  - `sfida.appuntiCompleti` — la sintesi di questo nodo è chiusa;
 *  - `sfida.focusMinutesSintesi` / `focusMinutesStudio` — le ore spese
 *    nei due modi, separate perché i due ritmi vanno misurati a parte.
 */
export const SCHEMA_VERSION = '12.0.0';
// V39.0 (12.0.0): `campus` — semestri, orario settimanale, fase di
// studio (lezioni/sessione). Vedi utils/campusEngine.js. `sfida.
// chiusoDaVerbale` marca i nodi chiusi d'ufficio dall'esame verbalizzato,
// esclusi dalla calibrazione.
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
      gauntletsCleared: 0,
      // V35.0 — Ribilanciamento Economico: soglie di streak (giorni) per
      // cui è già stato assegnato il Tech Token bonus "Costanza Premiata"
      // — lifetime, mai revocato, mai riassegnato sulla stessa soglia
      // (vedi applyStreakTokenMilestone in ArachnoForgeContext.jsx).
      streakTokenMilestonesAwarded: [],
      // V35.0 — K.A.R.E.N. Daily Brain (Sala Trofei — Aderenza alla
      // Readiness Biometrica): contatori lifetime alimentati da
      // LOG_READINESS_SNAPSHOT (edge-trigger giornaliero, dispatchato dal
      // componente-ponte KarenTrophyBridge quando un nuovo briefing è
      // disponibile). Compartimenti stagni preservati: nessuna tabella
      // biometrica viene letta/scritta da questo Cloud State, solo un
      // riepilogo numerico già calcolato altrove.
      lastReadinessLogDateKey: null,
      readinessLogDaysTotal: 0,
      readinessLogStreak: 0,
      optimalReadinessDaysTotal: 0,
      // V35.5 — Streak Shield (stile Duolingo): scudi disponibili (cap
      // STREAK_SHIELD_CAP in ArachnoForgeContext.jsx), assegnati in modo
      // automatico 1 a calendar-month tramite grantMonthlyStreakShield —
      // nessuna attivazione manuale, nessun rischio di "dimenticare" di
      // proteggere la streak. `lastStreakShieldGrantMonthKey` è la chiave
      // "YYYY-MM" dell'ultimo mese già premiato (edge-trigger, mai due
      // scudi nello stesso mese solare).
      streakShields: 0,
      streakShieldsUsedTotal: 0,
      lastStreakShieldGrantMonthKey: null
    },
    settings: {
      focusTime: 25,
      shortBreakTime: 5,
      longBreakTime: 15,
      suit: SUITS.CLASSIC,
      calmMode: false,
      soundEffects: true,
      // V35.0 — Focus Timer Adattivo: quando true (default), i minuti di
      // Focus/Pausa Breve seguono la direttiva `focus_timer` del Daily
      // Brief K.A.R.E.N. odierno (se disponibile) invece dei valori
      // manuali qui sopra — mai un override silenzioso e non
      // disattivabile: l'utente può spegnerlo in Karen OS Settings.
      karenAdaptiveTimer: true,
      // V36.0 — Notifiche di sistema a fine blocco Focus/pausa. Default
      // `false` per costruzione: il permesso del browser va chiesto da un
      // gesto esplicito dell'utente (vedi utils/systemNotify.js), mai da
      // solo al primo caricamento.
      systemNotifications: false,
      // V36.0 — Wake Lock durante il Focus: default attivo, è il
      // comportamento che ci si aspetta da un timer di studio.
      keepScreenAwake: true,
      // V36.0 — Modalità "Una cosa alla volta": Mission Control si apre
      // sulla sola decisione operativa (argomento + minuti + Avvia), con
      // tutto il resto collassato. Default attivo: il numero di pannelli
      // che reclamano attenzione insieme È esso stesso una fonte di
      // stress, e l'app nasce per toglierlo.
      focusFirstHome: true,
      // V36.0 — Effetti pesanti (blur profondi, grana, particelle,
      // interferenza). Disattivabili in blocco: su mobile sono il primo
      // posto dove si perdono frame e batteria durante un pomodoro.
      heavyEffects: true,
      // V36.0 — data dell'ultimo export locale del profilo ("YYYY-MM-DD"),
      // usata solo per il promemoria di backup in Karen OS Settings.
      lastExportDateKey: null
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
    },
    // V39.0 — "Empire State University" (utils/campusEngine.js): periodi
    // di lezione dei semestri, orario settimanale collegato alle materie
    // del Web-Matrix, forzatura manuale della fase (con scadenza) e
    // rapporto ore di sintesi / ore di lezione.
    campus: createDefaultCampus()
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
    ? (raw.nextReviewDate || computeInitialReview().nextReviewDate)
    : null;
  // V36.0 — migrazione SM-2 lite. Un nodo salvato prima della V36 non ha
  // né ease né intervallo: riceve l'ease di default e, come intervallo di
  // partenza, quello che il vecchio motore a intervalli fissi gli avrebbe
  // dato per il suo ultimo giudizio (7 se mai ripassato). Così la curva
  // riparte da dove il nodo si trovava davvero, invece di azzerare
  // mesi di ripassi già fatti.
  const LEGACY_FIXED_INTERVALS = { EASY: 4, MEDIUM: 2, HARD: 1 };
  const srsEase = Number.isFinite(raw.srsEase) && raw.srsEase > 0 ? raw.srsEase : DEFAULT_EASE;
  const srsIntervalDays = Number.isFinite(raw.srsIntervalDays) && raw.srsIntervalDays > 0
    ? raw.srsIntervalDays
    : (status === PERSISTED_STATUS.COMPLETED
      ? (LEGACY_FIXED_INTERVALS[raw.lastReviewRating] || INITIAL_REVIEW_INTERVAL_DAYS)
      : 0);
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
    // V38.0 — "La Forgia degli Appunti": le ore di un nodo si dividono
    // in due lavori, e vanno misurate separatamente o i due ritmi si
    // inquinano a vicenda (vedi utils/sintesiEngine.js). I nodi salvati
    // prima non hanno la separazione: restano a `0` e la calibrazione
    // sa ricadere su `focusMinutes` per quelli, invece di considerarli
    // campioni a zero ore.
    focusMinutesSintesi: Number.isFinite(raw.focusMinutesSintesi) && raw.focusMinutesSintesi > 0 ? raw.focusMinutesSintesi : 0,
    // Un nodo pre-V38 non ha la separazione, ma non è ambiguo: prima di
    // V38 la sintesi non esisteva come attività tracciata, quindi TUTTE
    // le sue ore erano ore di studio. Seminarle qui è necessario, non
    // cosmetico: scriverle a `0` avrebbe fatto due danni silenziosi al
    // primo avvio dopo l'aggiornamento — le ore residue di ogni materia
    // sarebbero tornate al budget pieno (in V37 il tempo tracciato
    // veniva sottratto), gonfiando di colpo Fine Prevista, Spider-Score
    // e Quota Odierna; e il ritmo di lettura misurato in V37 si sarebbe
    // azzerato, perché ogni nodo completato sarebbe risultato studiato
    // in zero ore e quindi scartato dal campione.
    focusMinutesStudio: Number.isFinite(raw.focusMinutesStudio) && raw.focusMinutesStudio > 0
      ? raw.focusMinutesStudio
      : Number.isFinite(raw.focusMinutesSintesi)
      ? 0
      : Math.max(0, Number(raw.focusMinutes) || 0),
    // V38.0 — Le FONTI da snellire (libro, slide, dispense del prof) con
    // il loro avanzamento. Vuoto = nessuna sintesi da fare su questo
    // nodo, che è il caso di chi studia direttamente dai propri appunti.
    fonti: normalizeFonti(raw.fonti),
    // V38.0 — Le pagine dei TUOI appunti definitivi: quelle che
    // studierai davvero. Il campo V37 `pagine` significava già
    // esattamente questo, quindi migra qui senza perdere niente.
    pagineAppunti:
      Number.isFinite(raw.pagineAppunti) && raw.pagineAppunti > 0
        ? Math.round(raw.pagineAppunti)
        : Number.isFinite(raw.pagine) && raw.pagine > 0
        ? Math.round(raw.pagine)
        : 0,
    // Sintesi dichiarata chiusa a mano: serve per i casi in cui non
    // snellirai davvero TUTTE le pagine dichiarate (metà libro era
    // ripasso, tre capitoli non sono in programma) e il nodo resterebbe
    // altrimenti per sempre "in lavorazione".
    appuntiCompleti: raw.appuntiCompleti === true,
    blueprint: raw.blueprint || '',
    // V36.0 — Appunti del nodo (markdown leggero) e stato della curva SRS.
    note: typeof raw.note === 'string' ? raw.note : '',
    srsEase,
    srsIntervalDays,
    // V36.0 — "Interrogazione K.A.R.E.N.": le domande di richiamo attivo
    // generate una volta sul contenuto di QUESTO nodo, conservate qui
    // dentro (nessuna tabella nuova) così restano disponibili offline ad
    // ogni ripasso successivo. `null` finché non ne è stata generata una.
    quiz: raw.quiz && typeof raw.quiz === 'object' && Array.isArray(raw.quiz.domande) ? raw.quiz : null,
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
    // Campo legacy pre-V20.0 (slider manuale di Urgenza, sostituito dal
    // calcolo automatico sulla data d'esame): conservato per non alterare
    // i profili salvati, non letto da nessun motore.
    urgency: Number.isFinite(raw.urgency) ? raw.urgency : 3,
    examPassed: !!raw.examPassed,
    // V37.0 — data di verbalizzazione dell'esame. Retro-compatibile: un
    // profilo precedente non ce l'ha e riceve `null`, che i consumatori
    // trattano come "data sconosciuta" senza inventarne una.
    examPassedDate: raw.examPassedDate ? String(raw.examPassedDate).slice(0, 10) : null,
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
    gauntletsCleared: Number.isFinite(rawProfile.gauntletsCleared) && rawProfile.gauntletsCleared >= 0 ? rawProfile.gauntletsCleared : 0,
    // V35.0 — Blindatura Ribilanciamento Economico + Daily Brain: stessa
    // logica "mai un valore sporco propagato" già applicata sopra.
    streakTokenMilestonesAwarded: Array.isArray(rawProfile.streakTokenMilestonesAwarded)
      ? rawProfile.streakTokenMilestonesAwarded.filter((n) => Number.isFinite(n))
      : [],
    lastReadinessLogDateKey: typeof rawProfile.lastReadinessLogDateKey === 'string' ? rawProfile.lastReadinessLogDateKey : null,
    readinessLogDaysTotal: Number.isFinite(rawProfile.readinessLogDaysTotal) && rawProfile.readinessLogDaysTotal >= 0 ? rawProfile.readinessLogDaysTotal : 0,
    readinessLogStreak: Number.isFinite(rawProfile.readinessLogStreak) && rawProfile.readinessLogStreak >= 0 ? rawProfile.readinessLogStreak : 0,
    optimalReadinessDaysTotal: Number.isFinite(rawProfile.optimalReadinessDaysTotal) && rawProfile.optimalReadinessDaysTotal >= 0 ? rawProfile.optimalReadinessDaysTotal : 0,
    // V35.5 — Blindatura Streak Shield: stessa identica logica "mai un
    // valore sporco propagato" già applicata sopra a tutti gli altri
    // contatori lifetime del profilo.
    streakShields: Number.isFinite(rawProfile.streakShields) && rawProfile.streakShields >= 0 ? rawProfile.streakShields : 0,
    streakShieldsUsedTotal: Number.isFinite(rawProfile.streakShieldsUsedTotal) && rawProfile.streakShieldsUsedTotal >= 0 ? rawProfile.streakShieldsUsedTotal : 0,
    lastStreakShieldGrantMonthKey: typeof rawProfile.lastStreakShieldGrantMonthKey === 'string' ? rawProfile.lastStreakShieldGrantMonthKey : null
  };

  return {
    metadata: { ...defaults.metadata, ...(rawState.metadata || {}), version: SCHEMA_VERSION },
    profile: safeProfile,
    settings: { ...defaults.settings, ...(rawState.settings || {}) },
    materie: Array.isArray(rawState.materie) ? rawState.materie.map(migrateMateria) : defaults.materie,
    // V37.0 — Potatura al boot. Era l'unico array dello stato senza
    // tetto: ogni salvataggio riscrive l'INTERO app_state, quindi un
    // Star Log che cresce all'infinito fa crescere all'infinito anche il
    // costo di ogni singola scrittura. Gli aggregati giornalieri
    // (FOCUS_MINUTES) non vengono toccati — Heatmap, minuti totali e
    // calibrazione restano completi per sempre. Vedi
    // utils/starLogMaintenance.js per il ragionamento esteso.
    starLog: Array.isArray(rawState.starLog) ? pruneStarLog(rawState.starLog).starLog : defaults.starLog,
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
      : defaults.dailyPatrols,
    // V39.0 — normalizzato contro le materie REALI del profilo: una
    // lezione che punta a una materia cancellata non sopravvive alla
    // reidratazione (integrità referenziale in un punto solo).
    campus: normalizeCampus(
      rawState.campus,
      new Set((Array.isArray(rawState.materie) ? rawState.materie : []).map((m) => m && m.id).filter(Boolean))
    )
  };
}
