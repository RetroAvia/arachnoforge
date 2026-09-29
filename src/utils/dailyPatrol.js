/**
 * THE DAILY PATROL ENGINE — motore delle missioni giornaliere.
 *
 *   state.dailyPatrols = {
 *     dateKey: 'YYYY-MM-DD',
 *     quests: [{ id, templateId, title, description, type, difficulty,
 *                targetAmount, currentProgress, isCompleted, xpReward, icon }]
 *   }
 *
 * Ogni giorno 3 missioni (una per difficoltà) pescate da un pool con un
 * seed derivato dalla data (stesse missioni anche dopo più reload), e
 * aggiornate "a eventi" dal reducer (applyQuestEvent).
 *
 * V42 — le missioni seguono il METODO DI STUDIO e la fase del semestre:
 *  - in periodo di LEZIONI: sistemare le lezioni (sintesi), produrre
 *    pagine dei tuoi appunti, ripassi, il bersaglio del piano;
 *  - in SESSIONE: esercizi, simulazioni d'esame, l'obiettivo di oggi del
 *    piano, ripassi;
 *  - le missioni "a sessioni" contano solo blocchi veri (almeno 20
 *    minuti): prima una sessione da un minuto completava "Primary Target";
 *  - niente più premi per lo studio notturno (Night Owl) né per
 *    l'Overdrive in sé: al loro posto "Chiudi la giornata" e il blocco
 *    profondo;
 *  - una missione impossibile oggi (nessun ripasso scaduto, nessuna
 *    lezione da sistemare) non viene nemmeno pescata.
 */

export const QUEST_DIFFICULTY = { EASY: 'EASY', MEDIUM: 'MEDIUM', HARD: 'HARD' };

export const QUEST_DIFFICULTY_META = {
  EASY: { label: 'Facile', color: 'text-emerald-300', border: 'border-emerald-400/35', bg: 'bg-emerald-900/20', bar: 'from-emerald-500 to-emerald-600', solid: 'bg-emerald-400' },
  MEDIUM: { label: 'Media', color: 'text-accent', border: 'border-accent/35', bg: 'bg-accent/10', bar: 'from-accent to-accent/70', solid: 'bg-accent' },
  HARD: { label: 'Difficile', color: 'text-primary', border: 'border-primary/35', bg: 'bg-primary/10', bar: 'from-primary to-primary-dark', solid: 'bg-primary' }
};

export const QUEST_TYPE = {
  FOCUS_MINUTES: 'FOCUS_MINUTES',
  DAY_TARGET: 'DAY_TARGET',
  REVIEWS_CLEARED: 'REVIEWS_CLEARED',
  PRIMARY_TARGET_SESSION: 'PRIMARY_TARGET_SESSION',
  EARLY_BIRD_FOCUS: 'EARLY_BIRD_FOCUS',
  NODES_COMPLETED: 'NODES_COMPLETED',
  FLOW_STATE_SESSIONS: 'FLOW_STATE_SESSIONS',
  BOSS_DEFEATED: 'BOSS_DEFEATED',
  SINISTER_SIX_WINS: 'SINISTER_SIX_WINS',
  DEEP_WORK: 'DEEP_WORK',
  LESSON_SINTESI: 'LESSON_SINTESI',
  NOTES_PAGES: 'NOTES_PAGES',
  EXERCISES: 'EXERCISES',
  CLOSE_DAY: 'CLOSE_DAY',
  // Storici: missioni già generate prima della V42 (non più pescate).
  NIGHT_OWL_FOCUS: 'NIGHT_OWL_FOCUS',
  OVERDRIVE_STRIKES: 'OVERDRIVE_STRIKES'
};

export const QUEST_EVENTS = {
  FOCUS_SESSION: 'FOCUS_SESSION',
  REVIEW_DONE: 'REVIEW_DONE',
  NODE_COMPLETED: 'NODE_COMPLETED',
  BOSS_FIGHT_WIN: 'BOSS_FIGHT_WIN',
  EXERCISES_LOGGED: 'EXERCISES_LOGGED',
  DAY_CLOSED: 'DAY_CLOSED'
};

/** Minuti minimi perché una sessione conti per le missioni "a sessioni". */
export const QUEST_SESSION_MIN_MINUTES = 20;
/** Il blocco profondo. */
export const DEEP_WORK_MINUTES = 50;

const T = {
  focusStrikeEasy: { id: 'focusStrikeEasy', title: 'Focus Strike', type: QUEST_TYPE.FOCUS_MINUTES, targetAmount: 60, xpReward: 25, icon: 'bolt', description: 'Studia almeno 1 ora (60 min) oggi.' },
  webShooter: {
    id: 'webShooter',
    title: 'Web-Shooter',
    type: QUEST_TYPE.REVIEWS_CLEARED,
    dynamicTarget: (ctx) => Math.max(1, Math.min(ctx.upcomingReviewsCount || 1, ctx.reviewTargetCount || ctx.upcomingReviewsCount || 1)),
    available: (ctx) => (ctx.upcomingReviewsCount || 0) > 0,
    xpReward: 25,
    icon: 'radar',
    description: 'Fai i ripassi in scadenza oggi nello Spider-Sense.'
  },
  earlyBird: { id: 'earlyBird', title: 'Early Bird Special', type: QUEST_TYPE.EARLY_BIRD_FOCUS, targetAmount: 1, xpReward: 25, icon: 'flag', description: 'Chiudi un blocco di Focus da almeno 20 minuti prima delle 9:00.' },
  closeDay: {
    id: 'closeDay',
    title: 'Chiudi la giornata',
    type: QUEST_TYPE.CLOSE_DAY,
    targetAmount: 1,
    xpReward: 25,
    icon: 'moon',
    description: 'Stasera fai il bilancio della giornata e prepara il piano di domani.'
  },
  focusStrikeMedium: { id: 'focusStrikeMedium', title: 'Focus Strike II', type: QUEST_TYPE.FOCUS_MINUTES, targetAmount: 120, xpReward: 45, icon: 'bolt', description: 'Studia almeno 2 ore (120 min) oggi.' },
  primaryTarget: {
    id: 'primaryTarget',
    title: 'Primary Target',
    type: QUEST_TYPE.PRIMARY_TARGET_SESSION,
    targetAmount: 1,
    available: (ctx) => ctx.hasPrimaryTarget !== false,
    xpReward: 50,
    icon: 'crosshair',
    description: 'Un blocco da almeno 25 minuti sulla prima materia del piano di oggi.'
  },
  nodeHunter: { id: 'nodeHunter', title: 'Node Hunter', type: QUEST_TYPE.NODES_COMPLETED, targetAmount: 2, xpReward: 45, icon: 'target', description: 'Completa 2 argomenti studiati oggi (almeno 15 minuti di studio ciascuno).' },
  flowSeeker: { id: 'flowSeeker', title: 'Flow Seeker', type: QUEST_TYPE.FLOW_STATE_SESSIONS, targetAmount: 2, xpReward: 45, icon: 'heart', description: 'Due blocchi da almeno 20 minuti valutati Flow State nel Debriefing.' },
  lessonSintesi: {
    id: 'lessonSintesi',
    title: 'Lezione del giorno',
    type: QUEST_TYPE.LESSON_SINTESI,
    targetAmount: 1,
    available: (ctx) => !!ctx.hasLessonsToProcess,
    xpReward: 50,
    icon: 'flask',
    description: 'Sistema una lezione in coda: un blocco di Sintesi da almeno 20 minuti sulla sua materia.'
  },
  notesPages: {
    id: 'notesPages',
    title: 'Forgia degli Appunti',
    type: QUEST_TYPE.NOTES_PAGES,
    targetAmount: 3,
    available: (ctx) => !!ctx.hasSintesiWork,
    xpReward: 45,
    icon: 'book',
    description: 'Scrivi almeno 3 pagine dei tuoi appunti oggi (registrale nel Debriefing).'
  },
  exercises: {
    id: 'exercises',
    title: 'Palestra di Esercizi',
    type: QUEST_TYPE.EXERCISES,
    targetAmount: 8,
    available: (ctx) => !!ctx.hasWrittenExam,
    xpReward: 50,
    icon: 'grid',
    description: "Risolvi almeno 8 esercizi o problemi d'esame oggi."
  },
  focusMarathon: { id: 'focusMarathon', title: 'Focus Marathon', type: QUEST_TYPE.FOCUS_MINUTES, targetAmount: 240, xpReward: 90, icon: 'flame', description: 'Studia almeno 4 ore (240 min) oggi, con le pause.' },
  dayTarget: {
    id: 'dayTarget',
    title: 'Obiettivo di oggi',
    type: QUEST_TYPE.DAY_TARGET,
    dynamicTarget: (ctx) => Math.max(60, Math.round((Number(ctx.todayTargetMinutes) || 0) / 15) * 15),
    available: (ctx) => Number(ctx.todayTargetMinutes) >= 60,
    xpReward: 90,
    icon: 'crosshair',
    description: "Raggiungi l'obiettivo di studio che il piano ti ha dato per oggi."
  },
  sinisterSixSlayer: {
    id: 'sinisterSixSlayer',
    title: 'Sinister Six Slayer',
    type: QUEST_TYPE.SINISTER_SIX_WINS,
    targetAmount: 1,
    available: (ctx) => !!ctx.hasUpcomingExam,
    xpReward: 90,
    icon: 'skull',
    description: "Completa una simulazione d'esame (Boss Fight) da almeno 20 minuti."
  },
  bossHunter: { id: 'bossHunter', title: 'Boss Hunter', type: QUEST_TYPE.BOSS_DEFEATED, targetAmount: 1, xpReward: 90, icon: 'shield', description: 'Completa un modulo (argomento padre) dello Skill Tree oggi.' },
  deepWork: { id: 'deepWork', title: 'Blocco Profondo', type: QUEST_TYPE.DEEP_WORK, targetAmount: 1, xpReward: 90, icon: 'bolt', description: 'Un unico blocco di Focus da almeno 50 minuti, senza interruzioni.' }
};

const POOLS = {
  LEZIONI: {
    EASY: [T.webShooter, T.focusStrikeEasy, T.closeDay, T.earlyBird],
    MEDIUM: [T.lessonSintesi, T.notesPages, T.primaryTarget, T.nodeHunter],
    HARD: [T.dayTarget, T.deepWork, T.bossHunter]
  },
  SESSIONE: {
    EASY: [T.webShooter, T.focusStrikeEasy, T.closeDay],
    MEDIUM: [T.primaryTarget, T.exercises, T.nodeHunter, T.flowSeeker, T.focusStrikeMedium],
    HARD: [T.dayTarget, T.sinisterSixSlayer, T.deepWork, T.bossHunter, T.focusMarathon]
  }
};

/* ------------------------------------------------------------------ *
 * Seeded PRNG (mulberry32): stesse missioni per tutta la giornata.
 * ------------------------------------------------------------------ */
function hashStringToInt(str) {
  let h = 0;
  for (let i = 0; i < str.length; i += 1) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return h;
}

function mulberry32(seed) {
  let a = seed;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickRandom(arr, rng) {
  return arr[Math.floor(rng() * arr.length)] || arr[0];
}

function instantiateQuest(template, difficulty, dateKey, ctx) {
  const targetAmount = typeof template.dynamicTarget === 'function' ? template.dynamicTarget(ctx) : template.targetAmount;
  return {
    id: `dq_${dateKey}_${template.id}`,
    templateId: template.id,
    title: template.title,
    description: template.description,
    type: template.type,
    difficulty,
    targetAmount,
    currentProgress: 0,
    isCompleted: false,
    xpReward: template.xpReward,
    icon: template.icon
  };
}

/**
 * Le 3 missioni del giorno (una per difficoltà), deterministiche sul
 * `dateKey` e sul contesto preso alla generazione:
 *   ctx = { fase: 'LEZIONI'|'SESSIONE', upcomingReviewsCount, reviewTargetCount,
 *           hasLessonsToProcess, hasSintesiWork, hasWrittenExam,
 *           hasUpcomingExam, hasPrimaryTarget, todayTargetMinutes }
 */
export function generateDailyQuests(dateKey, ctx = {}) {
  const rng = mulberry32(hashStringToInt(dateKey));
  const pools = POOLS[ctx.fase === 'LEZIONI' ? 'LEZIONI' : 'SESSIONE'];
  return ['EASY', 'MEDIUM', 'HARD'].map((difficulty) => {
    const disponibili = pools[difficulty].filter((t) => typeof t.available !== 'function' || t.available(ctx));
    const pool = disponibili.length > 0 ? disponibili : [T.focusStrikeEasy];
    return instantiateQuest(pickRandom(pool, rng), QUEST_DIFFICULTY[difficulty], dateKey, ctx);
  });
}

/* ------------------------------------------------------------------ *
 * Auto-Tracking — funzione pura richiamata dal reducer. Non tocca mai
 * XP/profilo: incrementa `currentProgress` e marca `isCompleted`.
 * ------------------------------------------------------------------ */
function bumpQuest(quest, amount) {
  if (quest.isCompleted || !(amount > 0)) return quest;
  const nextProgress = Math.min(quest.targetAmount, quest.currentProgress + amount);
  return { ...quest, currentProgress: nextProgress, isCompleted: nextProgress >= quest.targetAmount };
}

export function applyQuestEvent(quests, eventType, payload = {}) {
  if (!Array.isArray(quests) || quests.length === 0) return quests;
  return quests.map((q) => {
    if (!q || typeof q !== 'object' || q.isCompleted) return q;
    switch (eventType) {
      case QUEST_EVENTS.FOCUS_SESSION: {
        const {
          minutes = 0,
          quality,
          hour,
          materiaId,
          primaryTargetMateriaId,
          workMode,
          pagineAppuntiProdotte = 0,
          lessonMateriaIds = []
        } = payload;
        const vera = minutes >= QUEST_SESSION_MIN_MINUTES;
        if (q.type === QUEST_TYPE.FOCUS_MINUTES || q.type === QUEST_TYPE.DAY_TARGET) return bumpQuest(q, minutes);
        if (q.type === QUEST_TYPE.PRIMARY_TARGET_SESSION && primaryTargetMateriaId && materiaId === primaryTargetMateriaId && minutes >= 25) {
          return bumpQuest(q, 1);
        }
        if (q.type === QUEST_TYPE.EARLY_BIRD_FOCUS && vera && typeof hour === 'number' && hour >= 5 && hour < 9) return bumpQuest(q, 1);
        if (q.type === QUEST_TYPE.FLOW_STATE_SESSIONS && vera && quality === 'FLOW') return bumpQuest(q, 1);
        if (q.type === QUEST_TYPE.DEEP_WORK && minutes >= DEEP_WORK_MINUTES) return bumpQuest(q, 1);
        if (q.type === QUEST_TYPE.LESSON_SINTESI && vera && workMode === 'SINTESI' && Array.isArray(lessonMateriaIds) && lessonMateriaIds.includes(materiaId)) {
          return bumpQuest(q, 1);
        }
        if (q.type === QUEST_TYPE.NOTES_PAGES && pagineAppuntiProdotte > 0) return bumpQuest(q, pagineAppuntiProdotte);
        // Missioni storiche generate prima della V42: si completano ancora,
        // ma solo con blocchi veri e mai di notte.
        if (q.type === QUEST_TYPE.OVERDRIVE_STRIKES && vera && payload.wasOverdrive) return bumpQuest(q, 1);
        return q;
      }
      case QUEST_EVENTS.REVIEW_DONE:
        // V42 — solo i ripassi DOVUTI: ripassare dieci volte lo stesso
        // argomento non "azzera" lo Spider-Sense.
        if (q.type === QUEST_TYPE.REVIEWS_CLEARED && payload.wasDue !== false) return bumpQuest(q, 1);
        return q;
      case QUEST_EVENTS.NODE_COMPLETED: {
        const { isBoss = false, tracked = true } = payload;
        if (!tracked) return q;
        if (q.type === QUEST_TYPE.NODES_COMPLETED) return bumpQuest(q, 1);
        if (q.type === QUEST_TYPE.BOSS_DEFEATED && isBoss) return bumpQuest(q, 1);
        return q;
      }
      case QUEST_EVENTS.BOSS_FIGHT_WIN:
        if (q.type === QUEST_TYPE.SINISTER_SIX_WINS && (payload.minutes == null || payload.minutes >= QUEST_SESSION_MIN_MINUTES)) return bumpQuest(q, 1);
        return q;
      case QUEST_EVENTS.EXERCISES_LOGGED:
        if (q.type === QUEST_TYPE.EXERCISES) return bumpQuest(q, Math.max(0, Number(payload.count) || 0));
        return q;
      case QUEST_EVENTS.DAY_CLOSED:
        if (q.type === QUEST_TYPE.CLOSE_DAY) return bumpQuest(q, 1);
        return q;
      default:
        return q;
    }
  });
}

export default generateDailyQuests;
