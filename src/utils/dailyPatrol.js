/**
 * THE DAILY PATROL ENGINE — V23.0 "The Quantum Router" (Modulo 2).
 *
 * Riscrittura completa rispetto alla V20: non più un calcolo "derivato" a
 * ogni render (che richiedeva ricomputare da zero l'intera condizione ogni
 * volta), ma un VERO motore a eventi persistito in `state.dailyPatrols`:
 *
 *   state.dailyPatrols = {
 *     dateKey: 'YYYY-MM-DD',
 *     quests: [{ id, templateId, title, description, type, difficulty,
 *                targetAmount, currentProgress, isCompleted, xpReward, icon }]
 *   }
 *
 * Ogni giorno (dateKey diverso da oggi) il Context rigenera 3 missioni —
 * una per tier di difficoltà (EASY/MEDIUM/HARD) — pescate a caso da un
 * pool di template più ampio (varietà giorno per giorno), con un seed
 * deterministico derivato dalla data stessa: stesso giorno, stesse quest,
 * anche se l'app viene ricaricata più volte (mai un reroll accidentale a
 * metà giornata). Il progresso si aggiorna in modo "event-driven": ogni
 * azione rilevante del reducer (Focus completato, Ripasso, Nodo
 * completato, Boss Fight vinta) chiama `applyQuestEvent`, una funzione
 * pura che scorre le quest attive e incrementa quelle il cui `type`
 * corrisponde all'evento — zero derivazione a runtime, zero doppio
 * calcolo, auto-tracking reale.
 */
import { getDateKey } from './dateUtils.js';

export const QUEST_DIFFICULTY = { EASY: 'EASY', MEDIUM: 'MEDIUM', HARD: 'HARD' };

export const QUEST_DIFFICULTY_META = {
  EASY: { label: 'Facile', color: 'text-emerald-400', border: 'border-emerald-400/40', bg: 'bg-emerald-900/20', bar: 'from-emerald-500 to-emerald-600' },
  MEDIUM: { label: 'Media', color: 'text-accent', border: 'border-accent/40', bg: 'bg-accent/10', bar: 'from-accent to-accent/70' },
  HARD: { label: 'Difficile', color: 'text-primary', border: 'border-primary/40', bg: 'bg-primary/10', bar: 'from-primary to-primary-dark' }
};

export const QUEST_TYPE = {
  FOCUS_MINUTES: 'FOCUS_MINUTES',
  REVIEWS_CLEARED: 'REVIEWS_CLEARED',
  PRIMARY_TARGET_SESSION: 'PRIMARY_TARGET_SESSION',
  EARLY_BIRD_FOCUS: 'EARLY_BIRD_FOCUS',
  NIGHT_OWL_FOCUS: 'NIGHT_OWL_FOCUS',
  NODES_COMPLETED: 'NODES_COMPLETED',
  FLOW_STATE_SESSIONS: 'FLOW_STATE_SESSIONS',
  BOSS_DEFEATED: 'BOSS_DEFEATED',
  SINISTER_SIX_WINS: 'SINISTER_SIX_WINS',
  OVERDRIVE_STRIKES: 'OVERDRIVE_STRIKES'
};

export const QUEST_EVENTS = {
  FOCUS_SESSION: 'FOCUS_SESSION',
  REVIEW_DONE: 'REVIEW_DONE',
  NODE_COMPLETED: 'NODE_COMPLETED',
  BOSS_FIGHT_WIN: 'BOSS_FIGHT_WIN'
};

/**
 * Pool di template — INIZIATIVA LIBERA: oltre alle 3 missioni base
 * richieste, sono state aggiunte varianti creative (Early Bird, Night
 * Owl, Flow Seeker, Overdrive Master...) per garantire varietà reale
 * giorno per giorno invece delle solite 3 sempre uguali.
 */
const EASY_TEMPLATES = [
  {
    id: 'focusStrikeEasy',
    title: 'Focus Strike',
    type: QUEST_TYPE.FOCUS_MINUTES,
    targetAmount: 60,
    xpReward: 25,
    icon: 'bolt',
    description: 'Studia almeno 1 ora (60 min) oggi.'
  },
  {
    id: 'webShooter',
    title: 'Web-Shooter',
    type: QUEST_TYPE.REVIEWS_CLEARED,
    dynamicTarget: (ctx) => Math.max(1, ctx.upcomingReviewsCount || 1),
    xpReward: 25,
    icon: 'radar',
    description: 'Azzera tutti i ripassi in sospeso nello Spider-Sense.'
  },
  {
    id: 'earlyBird',
    title: 'Early Bird Special',
    type: QUEST_TYPE.EARLY_BIRD_FOCUS,
    targetAmount: 1,
    xpReward: 25,
    icon: 'flag',
    description: 'Completa una sessione di Focus prima delle 9:00.'
  }
];

const MEDIUM_TEMPLATES = [
  {
    id: 'focusStrikeMedium',
    title: 'Focus Strike II',
    type: QUEST_TYPE.FOCUS_MINUTES,
    targetAmount: 120,
    xpReward: 45,
    icon: 'bolt',
    description: 'Studia almeno 2 ore (120 min) oggi.'
  },
  {
    id: 'primaryTarget',
    title: 'Primary Target',
    type: QUEST_TYPE.PRIMARY_TARGET_SESSION,
    targetAmount: 1,
    xpReward: 50,
    icon: 'crosshair',
    description: "Completa una sessione di Focus sull'esame suggerito da Karen."
  },
  {
    id: 'nodeHunter',
    title: 'Node Hunter',
    type: QUEST_TYPE.NODES_COMPLETED,
    targetAmount: 2,
    xpReward: 45,
    icon: 'target',
    description: '2 dello Skill Tree oggi.'
  },
  {
    id: 'flowSeeker',
    title: 'Flow Seeker',
    type: QUEST_TYPE.FLOW_STATE_SESSIONS,
    targetAmount: 2,
    xpReward: 45,
    icon: 'heart',
    description: 'Completa 2 sessioni di Focus valutate come Flow State nel Tactical Debriefing.'
  }
];

const HARD_TEMPLATES = [
  {
    id: 'focusMarathon',
    title: 'Focus Marathon',
    type: QUEST_TYPE.FOCUS_MINUTES,
    targetAmount: 240,
    xpReward: 90,
    icon: 'flame',
    description: 'Studia almeno 4 ore (240 min) in un solo giorno.'
  },
  {
    id: 'sinisterSixSlayer',
    title: 'Sinister Six Slayer',
    type: QUEST_TYPE.SINISTER_SIX_WINS,
    targetAmount: 1,
    xpReward: 90,
    icon: 'skull',
    description: 'Vinci una Boss Fight nel Sinister Six Simulator oggi.'
  },
  {
    id: 'bossHunter',
    title: 'Boss Hunter',
    type: QUEST_TYPE.BOSS_DEFEATED,
    targetAmount: 1,
    xpReward: 90,
    icon: 'shield',
    description: 'Completa un Nodo Padre (Boss) dello Skill Tree oggi.'
  },
  {
    id: 'nightOwl',
    title: 'Night Owl Protocol',
    type: QUEST_TYPE.NIGHT_OWL_FOCUS,
    targetAmount: 1,
    xpReward: 90,
    icon: 'moon',
    description: 'Completa una sessione di Focus fra le 22:00 e le 4:00.'
  },
  {
    id: 'overdriveMaster',
    title: 'Overdrive Master',
    type: QUEST_TYPE.OVERDRIVE_STRIKES,
    targetAmount: 2,
    xpReward: 90,
    icon: 'bolt',
    description: 'Attiva Overdrive 2 volte in sessioni di Focus oggi.'
  }
];

const TEMPLATE_TIERS = [
  { difficulty: QUEST_DIFFICULTY.EASY, pool: EASY_TEMPLATES },
  { difficulty: QUEST_DIFFICULTY.MEDIUM, pool: MEDIUM_TEMPLATES },
  { difficulty: QUEST_DIFFICULTY.HARD, pool: HARD_TEMPLATES }
];

/* ------------------------------------------------------------------ *
 * Seeded PRNG (mulberry32) — stesse quest per tutta la giornata anche
 * dopo reload multipli, MAI un reroll casuale a metà giornata: il seed è
 * derivato deterministicamente dalla dateKey stessa.
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
 * Genera le 3 missioni del giorno (una per tier), deterministiche sul
 * `dateKey`. `ctx.upcomingReviewsCount` alimenta il target dinamico di
 * Web-Shooter (snapshot preso al momento della generazione — nuovi
 * ripassi diventati dovuti più tardi nella giornata non spostano il
 * traguardo già fissato).
 */
export function generateDailyQuests(dateKey, ctx = {}) {
  const rng = mulberry32(hashStringToInt(dateKey));
  return TEMPLATE_TIERS.map(({ difficulty, pool }) => instantiateQuest(pickRandom(pool, rng), difficulty, dateKey, ctx));
}

/* ------------------------------------------------------------------ *
 * Auto-Tracking — funzione pura richiamata dal reducer di Context ad
 * ogni azione rilevante. Non tocca mai XP/profilo: si limita a
 * incrementare `currentProgress` e a marcare `isCompleted`. È compito del
 * chiamante (il reducer) rilevare le transizioni false -> true e
 * assegnare l'XP corrispondente in modo atomico nella stessa azione.
 * ------------------------------------------------------------------ */
function bumpQuest(quest, amount) {
  if (quest.isCompleted || amount <= 0) return quest;
  const nextProgress = Math.min(quest.targetAmount, quest.currentProgress + amount);
  return { ...quest, currentProgress: nextProgress, isCompleted: nextProgress >= quest.targetAmount };
}

export function applyQuestEvent(quests, eventType, payload = {}) {
  if (!Array.isArray(quests) || quests.length === 0) return quests;
  return quests.map((q) => {
    if (q.isCompleted) return q;
    switch (eventType) {
      case QUEST_EVENTS.FOCUS_SESSION: {
        const { minutes = 0, wasOverdrive = false, quality, hour, materiaId, primaryTargetMateriaId } = payload;
        if (q.type === QUEST_TYPE.FOCUS_MINUTES) return bumpQuest(q, minutes);
        if (q.type === QUEST_TYPE.PRIMARY_TARGET_SESSION && primaryTargetMateriaId && materiaId === primaryTargetMateriaId) {
          return bumpQuest(q, 1);
        }
        if (q.type === QUEST_TYPE.EARLY_BIRD_FOCUS && typeof hour === 'number' && hour < 9) return bumpQuest(q, 1);
        if (q.type === QUEST_TYPE.NIGHT_OWL_FOCUS && typeof hour === 'number' && (hour >= 22 || hour < 4)) return bumpQuest(q, 1);
        if (q.type === QUEST_TYPE.OVERDRIVE_STRIKES && wasOverdrive) return bumpQuest(q, 1);
        if (q.type === QUEST_TYPE.FLOW_STATE_SESSIONS && quality === 'FLOW') return bumpQuest(q, 1);
        return q;
      }
      case QUEST_EVENTS.REVIEW_DONE:
        if (q.type === QUEST_TYPE.REVIEWS_CLEARED) return bumpQuest(q, 1);
        return q;
      case QUEST_EVENTS.NODE_COMPLETED: {
        const { isBoss = false } = payload;
        if (q.type === QUEST_TYPE.NODES_COMPLETED) return bumpQuest(q, 1);
        if (q.type === QUEST_TYPE.BOSS_DEFEATED && isBoss) return bumpQuest(q, 1);
        return q;
      }
      case QUEST_EVENTS.BOSS_FIGHT_WIN:
        if (q.type === QUEST_TYPE.SINISTER_SIX_WINS) return bumpQuest(q, 1);
        return q;
      default:
        return q;
    }
  });
}

/** Helper di comodo per l'UI: dateKey di "oggi" nello stesso formato usato dai quest instance id. */
export function todayPatrolDateKey() {
  return getDateKey();
}

export default generateDailyQuests;
