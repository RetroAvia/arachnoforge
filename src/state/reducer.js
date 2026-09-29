/**
 * ArachnoForge — src/state/reducer.js (V42)
 * =====================================================================
 * IL REDUCER: una funzione PURA, con input e output espliciti, testabile
 * senza montare React. Nessun side-effect qui dentro: niente rete, niente
 * LocalStorage, niente audio, niente Math.random() — i tiri casuali
 * (Daily Web-Sling) avvengono nell'action creator e arrivano al reducer
 * come risultato già deciso.
 *
 * V42 — "XP solo per lavoro vero" e "piano unico":
 *  - il completamento di un argomento paga UNA volta (e riaprirlo ritira
 *    l'XP), i ripassi pagano solo se dovuti e una volta al giorno;
 *  - la serie conta i giorni di studio veri (≥ 25 minuti) con i riposi
 *    settimanali (utils/streakEngine.js);
 *  - la Stamina segue la tua capacità e le pause la ricaricano;
 *  - appelli, simulazioni, esercizi, interrogazioni, piano di domani e
 *    bilancio della giornata sono azioni di prima classe.
 */
import { createDefaultState, normalizeTomorrowPlan, MAX_DAY_CLOSURES, sanitizeSettings } from '../data/defaultSchema.js';
import {
  computeFocusXp,
  computeFocusStaminaCost,
  computeBreakStaminaRestore,
  computeStreakMultiplier,
  applyXpDelta,
  applyXpDeltaWithTokens,
  computeTotalBankedXp,
  computeBloodPactPenalty,
  computeReviewXp,
  computeNodeCompletionXp,
  NODE_COMPLETION_MIN_MINUTES,
  LAST_STAND_SACRIFICE_RATE,
  FATIGUE_STAMINA_THRESHOLD,
  DIFFICULTY,
  FOCUS_QUALITY_META,
  DEFAULT_FOCUS_QUALITY,
  MAX_CARNAGE_MULTIPLIER,
  computeSpiderSenseSurgeXp
} from '../utils/xpEngine.js';
import { NODE_STATUS, PERSISTED_STATUS, deriveNodeStatus, orphanChildren, createSfida, markFirstCompletion } from '../utils/skillTree.js';
import { getSkillDef, canUnlockSkill, computeSkillEffects } from '../data/techTree.js';
import {
  scheduleNextReview,
  REVIEW_RATING,
  REVIEW_RATING_META,
  reviewLoadByDate,
  rescheduleMateriaReviews,
  reviewedToday
} from '../utils/spiderSense.js';
import { isGoblinProtocol } from '../utils/materiaMeta.js';
import { WORK_MODE, isWorkMode, applySintesiProgress, nodeSources, nodeNotes } from '../utils/sintesiEngine.js';
import { createSemestre, createLezione, normalizeCampus, esitoKey, ESITO_LEZIONE } from '../utils/campusEngine.js';
import { computeWeightedAverage, isGradedMateria } from '../utils/gpaEngine.js';
import { nowIso, getDateKey, daysBetween, currentMonthKey, todayDateOnlyKey } from '../utils/dateUtils.js';
import { applyQuestEvent, QUEST_EVENTS } from '../utils/dailyPatrol.js';
import { isMaxCarnageActive, bumpCriticalActionStreak, deactivateMaxCarnage, activateMaxCarnage } from '../utils/maxCarnage.js';
import { canClaimWebSling, isHighTier } from '../utils/webSling.js';
import { computePrimaryTarget } from '../utils/karenSuggestor.js';
import { computeCalibration } from '../utils/calibration.js';
import { computeDailyPlan } from '../utils/quotaEngine.js';
import { syncAppelli, planningExamDate, withPlanningDates, nextAppelloAfter, ESITO_APPELLO } from '../utils/appelli.js';
import { advanceStreak, restAllowance, STREAK_DAY_MIN_MINUTES } from '../utils/streakEngine.js';
import { findDuplicateMateria, isUngradedMateria } from '../data/vanvitelliCourseMap.js';

/** Tetto del Combat Log: 50 voci, tagliate in testa. È il motivo per
 * cui nessun edge-trigger può basarsi sulla LUNGHEZZA dell'array — vedi
 * il fix dello Spider-Sense Surge in ArachnoForgeContext.jsx. */
export const MAX_COMBAT_LOG = 50;
/** Minuti di Focus in un giorno oltre i quali l'app segnala un rischio
 * di burnout invece di continuare a incoraggiare. */
export const BURNOUT_MINUTES_THRESHOLD = 300;
/** V42 — Tetti giornalieri dei Daily Protocols (benessere, non farming). */
export const PROTOCOL_STAMINA_DAY_CAP = 40;
export const PROTOCOL_XP_DAY_CAP = 60;
export const PROTOCOL_MAX_XP = 30;
export const PROTOCOL_MAX_STAMINA = 40;
/** V42 — Una simulazione d'esame paga XP solo da 20 minuti in su. */
export const SIMULATION_MIN_MINUTES = 20;
/** V42 — Azione critica da Overdrive: solo su una sessione vera. */
const CRITICAL_OVERDRIVE_MIN_MINUTES = 20;
const MAX_RIPASSI_LOG = 12;
const MAX_ESERCIZI_LOG = 30;
const MAX_QUIZ_LOG = 12;
const MAX_SINTESI_MANUALE = 20;
const MAX_SIMULAZIONI = 20;

export function pushLog(combatLog, message, tag = 'INFO') {
  const entry = { id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, message, tag, timestamp: nowIso() };
  const next = [...combatLog, entry];
  if (next.length > MAX_COMBAT_LOG) next.splice(0, next.length - MAX_COMBAT_LOG);
  return next;
}

export function findMateria(state, materiaId) {
  return state.materie.find((m) => m.id === materiaId) || null;
}

/** V40.0 — La sintesi di un nodo è andata avanti fra `prima` e `dopo`? */
function sintesiAvanzata(prima, dopo) {
  const a = nodeSources(prima);
  const b = nodeSources(dopo);
  if (b.fatte > a.fatte) return true;
  if (!a.conclusa && b.conclusa && b.totali > 0) return true;
  return nodeNotes(dopo).attuali > nodeNotes(prima).attuali;
}

function updateMateriaSfide(state, materiaId, updater) {
  return {
    ...state,
    materie: state.materie.map((m) => (m.id === materiaId ? { ...m, sfide: updater(m.sfide) } : m))
  };
}

function appendCapped(list, entry, max) {
  return [...(Array.isArray(list) ? list : []), entry].slice(-max);
}

/** Minuti di studio tracciati su un argomento (studio + esercizi + sintesi). */
function trackedMinutes(s) {
  return (Number(s?.focusMinutesStudio) || 0) + (Number(s?.minutiEsercizi) || 0) + (Number(s?.focusMinutesSintesi) || 0);
}

/**
 * V42 — Maximum Carnage: le azioni critiche di OGGI caricano il simbionte;
 * alla quinta si guadagna una carica da attivare quando vuoi.
 */
function applyCriticalAction(profile, combatLog, isCriticalAction) {
  if (!isCriticalAction) return { profile, combatLog };
  const { chargeEarned, justActivated: _ignored, ...patch } = bumpCriticalActionStreak(profile, 1);
  const nextProfile = { ...profile, ...patch };
  if (!chargeEarned) return { profile: nextProfile, combatLog };
  return {
    profile: nextProfile,
    combatLog: pushLog(
      combatLog,
      'Il simbionte è carico: Maximum Carnage pronta. Attivala quando vuoi (2 ore, XP ×2), fra le 6 e le 23.',
      'CARNAGE'
    )
  };
}

/**
 * V35.0 — Tech Token legati anche alla COSTANZA: bonus one-shot LIFETIME
 * per soglia della serie (mai ripetuto).
 */
export const STREAK_TOKEN_MILESTONES = [7, 14, 30, 60, 100];

function applyStreakTokenMilestone(profile, combatLog) {
  const awarded = Array.isArray(profile.streakTokenMilestonesAwarded) ? profile.streakTokenMilestonesAwarded : [];
  const nextMilestone = STREAK_TOKEN_MILESTONES.find((m) => profile.streak >= m && !awarded.includes(m));
  if (!nextMilestone) return { profile, combatLog };
  const nextProfile = {
    ...profile,
    techTokens: (Number.isFinite(profile.techTokens) ? profile.techTokens : 0) + 1,
    streakTokenMilestonesAwarded: [...awarded, nextMilestone]
  };
  const nextLog = pushLog(combatLog, `Costanza Premiata — serie di ${nextMilestone} giorni di studio: +1 Tech Token bonus.`, 'SYSTEM');
  return { profile: nextProfile, combatLog: nextLog };
}

// V35.5 — Streak Shield: massimo 2 in cassa, 1 a mese.
export const STREAK_SHIELD_CAP = 2;

function grantMonthlyStreakShield(profile, combatLog) {
  const monthKey = currentMonthKey();
  if (profile.lastStreakShieldGrantMonthKey === monthKey) return { profile, combatLog };
  const current = Number.isFinite(profile.streakShields) ? profile.streakShields : 0;
  if (current >= STREAK_SHIELD_CAP) {
    return { profile: { ...profile, lastStreakShieldGrantMonthKey: monthKey }, combatLog };
  }
  const nextProfile = { ...profile, streakShields: current + 1, lastStreakShieldGrantMonthKey: monthKey };
  const nextLog = pushLog(
    combatLog,
    `K.A.R.E.N. — Nuovo Streak Shield (${current + 1}/${STREAK_SHIELD_CAP}): copre un giorno saltato oltre i riposi della settimana.`,
    'SYSTEM'
  );
  return { profile: nextProfile, combatLog: nextLog };
}

/**
 * V42 — La serie avanza quando OGGI diventa un giorno di studio valido
 * (≥ 25 minuti di Focus). Prima avanzava con qualunque attività, anche un
 * click su "completato".
 */
function applyStudyDayStreak(profile, combatLog, { todayMinutes, settings }) {
  if (!(todayMinutes >= STREAK_DAY_MIN_MINUTES)) return { profile, combatLog };
  const { patch, event, shieldsUsed, missed } = advanceStreak(profile, getDateKey(), { restDaysPerWeek: restAllowance(settings) });
  if (event === 'GIA') return { profile, combatLog };
  let nextProfile = { ...profile, ...patch };
  let nextLog = combatLog;
  if (event === 'SCUDO') {
    nextLog = pushLog(nextLog, `K.A.R.E.N. — Streak Shield usato (${shieldsUsed}): serie salva a ${nextProfile.streak} giorni.`, 'SYSTEM');
  } else if (event === 'RIPOSO' && missed > 0) {
    nextLog = pushLog(nextLog, `Serie di studio: ${nextProfile.streak} giorni (${missed} di riposo, dentro la settimana).`, 'SYSTEM');
  } else if (event === 'RESET' && (Number(profile.streak) || 0) > 1) {
    nextLog = pushLog(nextLog, `Serie ripartita da oggi: la precedente era di ${profile.streak} giorni.`, 'SYSTEM');
  }
  const shieldGrant = grantMonthlyStreakShield(nextProfile, nextLog);
  const milestone = applyStreakTokenMilestone(shieldGrant.profile, shieldGrant.combatLog);
  nextProfile = milestone.profile;
  nextLog = milestone.combatLog;
  return { profile: nextProfile, combatLog: nextLog };
}

/**
 * Daily Patrol Engine — Auto-Tracking: ogni azione rilevante aggiorna le
 * missioni del giorno nella STESSA transizione. V42 — l'XP delle missioni
 * passa dal calcolo dei Tech Token come ogni altro XP.
 */
function applyQuestProgressAndProfile(state, profile, combatLog, eventType, payload) {
  const dailyPatrols = state.dailyPatrols;
  if (!dailyPatrols || !Array.isArray(dailyPatrols.quests) || dailyPatrols.quests.length === 0) {
    return { dailyPatrols, profile, combatLog };
  }
  const before = dailyPatrols.quests;
  const after = applyQuestEvent(before, eventType, payload);
  let nextProfile = profile;
  let nextCombatLog = combatLog;
  after.forEach((q, i) => {
    if (q.isCompleted && !before[i].isCompleted) {
      nextProfile = applyXpDeltaWithTokens(nextProfile, q.xpReward);
      nextProfile = { ...nextProfile, dailyPatrolsCompleted: (nextProfile.dailyPatrolsCompleted || 0) + 1 };
      nextCombatLog = pushLog(nextCombatLog, `Daily Patrol completata: ${q.title}. +${q.xpReward} XP.`, 'SUCCESS');
    }
  });
  return { dailyPatrols: { ...dailyPatrols, quests: after }, profile: nextProfile, combatLog: nextCombatLog };
}

/** Minuti di Focus registrati OGGI (aggregato giornaliero dello Star Log). */
function todayFocusMinutes(starLog, key = getDateKey()) {
  return (Array.isArray(starLog) ? starLog : [])
    .filter((e) => e && e.type === 'FOCUS_MINUTES' && e.dateKey === key)
    .reduce((sum, e) => sum + (Number(e.minutes) || 0), 0);
}

/**
 * V42 — Il ripasso di un argomento, in un punto solo (bottoni, quiz,
 * interrogazione orale, blocco di Ripasso col timer).
 * @returns {null|{sfide:Array, xp:number, wasDue:boolean, alreadyToday:boolean, schedule:object}}
 */
function reviewOutcome(materia, target, rating, { source = 'MANUALE' } = {}) {
  if (!materia || !target || target.status !== PERSISTED_STATUS.COMPLETED) return null;
  const safeRating = REVIEW_RATING[rating] ? rating : REVIEW_RATING.MEDIUM;
  const oggi = todayDateOnlyKey();
  const wasDue = deriveNodeStatus(target, materia.sfide) === NODE_STATUS.NEEDS_REVIEW;
  const alreadyToday = reviewedToday(target, oggi);
  const examDate = planningExamDate(materia, oggi);
  const schedule = scheduleNextReview(target, safeRating, examDate, { todayKey: oggi, load: reviewLoadByDate(materia.sfide, target.id) });
  const failed = safeRating === REVIEW_RATING.AGAIN || safeRating === REVIEW_RATING.HARD;
  const sfide = materia.sfide.map((s) =>
    s.id === target.id
      ? {
          ...s,
          nextReviewDate: schedule.nextReviewDate,
          srsStability: schedule.srsStability,
          srsDifficulty: schedule.srsDifficulty,
          srsIntervalDays: schedule.srsIntervalDays,
          srsLapses: schedule.srsLapses,
          lastReviewedAt: schedule.lastReviewedAt,
          lastReviewRating: safeRating,
          reviewCount: (s.reviewCount || 0) + 1,
          ripassi: appendCapped(s.ripassi, { at: schedule.lastReviewedAt, voto: safeRating, r: schedule.retrievabilityAtReview, fonte: source }, MAX_RIPASSI_LOG),
          tentativiSuccessi: (s.tentativiSuccessi || 0) + (failed ? 0 : 1),
          tentativiFalliti: (s.tentativiFalliti || 0) + (failed ? 1 : 0)
        }
      : s
  );
  return { sfide, wasDue, alreadyToday, schedule, rating: safeRating };
}

export function reducer(state, action) {
  switch (action.type) {
    case 'HYDRATE':
      return action.payload;

    case 'UPDATE_PROFILE':
      return { ...state, profile: { ...state.profile, ...action.payload } };

    case 'UPDATE_SETTINGS':
      return {
        ...state,
        // V42 — le impostazioni del piano passano sempre dalla stessa
        // pulizia del caricamento (giorni di riposo, capacità, orari).
        settings: sanitizeSettings({ ...state.settings, ...action.payload }),
        combatLog: pushLog(state.combatLog, 'Parametri di sistema aggiornati.', 'CONFIG')
      };

    // V42 — niente doppioni (stesso corso del piano o stesso nome), date
    // valide, appelli e formato d'esame fin dalla creazione.
    case 'ADD_MATERIA': {
      const p = action.payload || {};
      const nome = typeof p.nome === 'string' ? p.nome.trim().slice(0, 80) : '';
      if (!nome) return state;
      const doppione = findDuplicateMateria(state.materie, { courseId: p.courseId || null, nome });
      if (doppione) {
        return { ...state, combatLog: pushLog(state.combatLog, `"${doppione.nome}" è già nel Web-Matrix: nessuna materia aggiunta.`, 'HUB') };
      }
      const cfu = Number.isFinite(Number(p.cfu)) && Number(p.cfu) > 0 ? Math.min(30, Number(p.cfu)) : 6;
      const bozza = {
        id: `materia_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        nome,
        examDate: typeof p.examDate === 'string' && p.examDate ? p.examDate.slice(0, 10) : null,
        oralDate: typeof p.oralDate === 'string' && p.oralDate ? p.oralDate.slice(0, 10) : null,
        appelli: Array.isArray(p.appelli) ? p.appelli : [],
        appelloTargetId: typeof p.appelloTargetId === 'string' ? p.appelloTargetId : null,
        cfu,
        createdAt: nowIso(),
        sfide: [],
        // V17.0 — Web-Path Planner (Vanvitelli Exam Engine).
        courseId: p.courseId || null,
        perceivedDifficulty: Number.isFinite(p.perceivedDifficulty) ? p.perceivedDifficulty : 3,
        urgency: Number.isFinite(p.urgency) ? p.urgency : 3,
        examPassed: !!p.examPassed,
        // V37.0 — data reale di verbalizzazione.
        examPassedDate: p.examPassedDate || null,
        voto: null,
        lode: false,
        simulazioni: [],
        focusMinutesLibere: 0,
        ricostruzione: null,
        tipoPiano: p.tipoPiano || (p.courseId ? 'PIANO' : 'SCELTA')
      };
      bozza.formatoEsame = p.formatoEsame || (isUngradedMateria(bozza) ? 'IDONEITA' : 'SCRITTO_ORALE');
      if (!isUngradedMateria(bozza) && Number.isFinite(p.voto) && p.voto >= 18 && p.voto <= 30) {
        bozza.voto = p.voto;
        bozza.lode = !!p.lode && p.voto === 30;
      }
      const materia = syncAppelli(bozza);
      return {
        ...state,
        materie: [...state.materie, materia],
        combatLog: pushLog(state.combatLog, `Nuovo Nodo del Web-Matrix aperto: ${materia.nome} (${materia.cfu} CFU).`, 'HUB')
      };
    }


    case 'UPDATE_MATERIA': {
      const prevMateria = findMateria(state, action.payload.id);
      if (!prevMateria) return state;
      const wasGraded = isGradedMateria(prevMateria);
      const wasPassed = !!prevMateria.examPassed;
      const patch = action.payload.patch || {};

      let merged = { ...prevMateria, ...patch };
      // V42 — chi cambia solo `examDate` (form rapido, import) sposta la
      // prima prova dell'appello obiettivo, invece di creare un doppione.
      if ('examDate' in patch && !('appelli' in patch)) {
        const data = typeof patch.examDate === 'string' && patch.examDate ? patch.examDate.slice(0, 10) : null;
        const lista = Array.isArray(prevMateria.appelli) ? prevMateria.appelli : [];
        const target = lista.find((a) => a.id === prevMateria.appelloTargetId) || null;
        if (!data) {
          merged = { ...merged, appelli: target ? lista.filter((a) => a.id !== target.id) : lista, appelloTargetId: null, examDate: null, oralDate: null };
        } else if (target) {
          merged = {
            ...merged,
            appelli: lista.map((a) =>
              a.id === target.id
                ? a.scritto || !a.orale
                  ? { ...a, scritto: data, orale: a.orale && a.orale < data ? null : a.orale, esito: null, esitoAt: null }
                  : { ...a, orale: data, esito: null, esitoAt: null }
                : a
            )
          };
        } else {
          merged = { ...merged, appelli: [...lista, { id: `app_${Date.now()}`, scritto: data, orale: null, nota: '', esito: null, esitoAt: null }], appelloTargetId: null };
        }
      }
      merged = syncAppelli(merged);
      // V42 — un'idoneità non ha voto: niente 18 "per errore" in media.
      if (isUngradedMateria(merged)) merged = { ...merged, voto: null, lode: false };
      if (merged.lode && merged.voto !== 30) merged = { ...merged, lode: false };
      // V42 — cambia la data della prossima prova: i ripassi si
      // ripianificano sulle nuove finestre finali (prima restavano dopo
      // l'esame anticipato).
      const oggi = todayDateOnlyKey();
      const prevPlan = planningExamDate(prevMateria, oggi);
      const nextPlan = planningExamDate(merged, oggi);
      if (prevPlan !== nextPlan && !merged.examPassed) {
        merged = { ...merged, sfide: rescheduleMateriaReviews(merged.sfide, nextPlan, oggi) };
      }

      let nextMaterie = state.materie.map((m) => (m.id === merged.id ? merged : m));
      let updatedMateria = merged;
      let extraLog = null;

      // V37.0 — "Esame superato" chiude davvero la Materia: tutti i nodi
      // passano a COMPLETED e la loro curva di ripasso viene chiusa, così
      // spariscono dal piano e dallo Spider-Sense. Transizione a senso
      // unico: togliere la spunta NON riapre i nodi.
      if (!wasPassed && updatedMateria?.examPassed) {
        const sfide = Array.isArray(updatedMateria.sfide) ? updatedMateria.sfide : [];
        const daChiudere = sfide.filter((s) => s.status !== PERSISTED_STATUS.COMPLETED).length;
        const closedAt = nowIso();
        const closedSfide = sfide.map((s) =>
          s.status === PERSISTED_STATUS.COMPLETED
            ? { ...s, nextReviewDate: null }
            : {
                ...s,
                status: PERSISTED_STATUS.COMPLETED,
                completionTimestamp: s.completionTimestamp || closedAt,
                nextReviewDate: null,
                srsIntervalDays: 0,
                // V39.0 — chiuso dal verbale, non studiato in app: fuori
                // dalla calibrazione. V42 — e nessun XP di completamento.
                chiusoDaVerbale: true,
                xpAwarded: 0
              }
        );
        // L'appello obiettivo è quello superato.
        const appelli = (updatedMateria.appelli || []).map((a) =>
          a.id === updatedMateria.appelloTargetId ? { ...a, esito: ESITO_APPELLO.SUPERATO, esitoAt: closedAt } : a
        );
        updatedMateria = { ...updatedMateria, sfide: closedSfide, appelli };
        nextMaterie = nextMaterie.map((m) => (m.id === updatedMateria.id ? updatedMateria : m));
        extraLog =
          daChiudere > 0
            ? `Esame superato: ${updatedMateria.nome}. ${daChiudere} nodo/i chiusi automaticamente e rimossi da piano di studio e Spider-Sense.`
            : `Esame superato: ${updatedMateria.nome}. Materia archiviata: non pesa più sul piano di studio.`;
      }

      const isNowGraded = isGradedMateria(updatedMateria);
      // V32.0 — Storico Media Ponderata: un punto SOLO alla transizione
      // "non ancora votata -> votata", con la data reale di verbalizzazione.
      let gradeHistory = state.gradeHistory;
      if (!wasGraded && isNowGraded) {
        const snapshot = computeWeightedAverage(nextMaterie);
        gradeHistory = [
          ...state.gradeHistory,
          {
            dateKey: updatedMateria.examPassedDate || getDateKey(),
            average: snapshot.average,
            gradedCount: snapshot.gradedCount
          }
        ].sort((a, b) => String(a.dateKey).localeCompare(String(b.dateKey)));
      }
      return {
        ...state,
        materie: nextMaterie,
        gradeHistory,
        combatLog: extraLog ? pushLog(state.combatLog, extraLog, 'HUB') : state.combatLog
      };
    }

    // V42 — ESITO DI UN APPELLO, dopo la data: superato (registra voto e
    // chiude la materia), non superato (l'obiettivo passa al prossimo
    // appello in calendario) o "aspetto l'esito" (la domanda si ripresenta
    // fra qualche giorno).
    case 'SET_APPELLO_ESITO': {
      const { materiaId, appelloId, esito, voto, lode, examPassedDate } = action.payload || {};
      const m = findMateria(state, materiaId);
      if (!m || !ESITO_APPELLO[esito]) return state;
      const lista = Array.isArray(m.appelli) ? m.appelli : [];
      const app = lista.find((a) => a.id === appelloId) || lista.find((a) => a.id === m.appelloTargetId) || null;
      if (!app) return state;
      const at = nowIso();
      const appelli = lista.map((a) => (a.id === app.id ? { ...a, esito, esitoAt: at } : a));
      if (esito === ESITO_APPELLO.SUPERATO) {
        const patch = { appelli, examPassed: true, examPassedDate: examPassedDate || app.orale || app.scritto || getDateKey() };
        if (Number.isFinite(voto)) {
          patch.voto = voto;
          patch.lode = !!lode && voto === 30;
        }
        return reducer(state, { type: 'UPDATE_MATERIA', payload: { id: m.id, patch } });
      }
      if (esito === ESITO_APPELLO.NON_SUPERATO) {
        const prossimo = nextAppelloAfter({ ...m, appelli }, app);
        const next = reducer(state, { type: 'UPDATE_MATERIA', payload: { id: m.id, patch: { appelli, appelloTargetId: prossimo ? prossimo.id : null } } });
        return {
          ...next,
          combatLog: pushLog(
            next.combatLog,
            prossimo
              ? `${m.nome}: appello non superato. Obiettivo spostato al prossimo appello (${prossimo.scritto || prossimo.orale}). Il piano si ricalcola da qui.`
              : `${m.nome}: appello non superato. Nessun altro appello in calendario: aggiungine uno per riattivare il piano.`,
            'HUB'
          )
        };
      }
      const next = reducer(state, { type: 'UPDATE_MATERIA', payload: { id: m.id, patch: { appelli } } });
      return { ...next, combatLog: pushLog(next.combatLog, `${m.nome}: in attesa dell'esito dell'appello. Te lo richiedo fra qualche giorno.`, 'HUB') };
    }

    // V42 — sostituzione integrale di una materia (Annulla di "Ricomincia da zero").
    case 'REPLACE_MATERIA': {
      const materia = action.payload?.materia;
      if (!materia || !materia.id || !state.materie.some((m) => m.id === materia.id)) return state;
      return { ...state, materie: state.materie.map((m) => (m.id === materia.id ? materia : m)) };
    }

    // V42 — "RICOMINCIO DA ZERO": per le materie che ricostruisci in
    // sessione. Gli argomenti tornano da studiare (la memoria stimata resta:
    // quello che sai non sparisce), lo studio già tracciato non conta più
    // nel residuo e, se lo chiedi, anche gli appunti ripartono da capo.
    case 'RICOSTRUISCI_MATERIA': {
      const { materiaId, rifaiAppunti = false } = action.payload || {};
      const m = findMateria(state, materiaId);
      if (!m || m.examPassed) return state;
      const sfide = (m.sfide || []).map((s) => {
        const base = {
          ...s,
          status: PERSISTED_STATUS.PENDING,
          completionTimestamp: null,
          nextReviewDate: null,
          lastReviewRating: null,
          srsIntervalDays: 0,
          storicoMinutiStudio: (Number(s.storicoMinutiStudio) || 0) + (Number(s.focusMinutesStudio) || 0),
          focusMinutesStudio: 0,
          // Il completamento era già stato premiato: rifarlo non paga di nuovo.
          ...(s.status === PERSISTED_STATUS.COMPLETED ? { xpLegacyPaid: true } : {})
        };
        if (!rifaiAppunti) return base;
        return {
          ...base,
          storicoPagineAppunti: (Number(s.storicoPagineAppunti) || 0) + (Number(s.pagineAppunti) || 0),
          pagineAppunti: 0,
          appuntiCompleti: false,
          fonti: (Array.isArray(s.fonti) ? s.fonti : []).map((f) => ({ ...f, pagineFatte: 0 }))
        };
      });
      return {
        ...state,
        materie: state.materie.map((x) => (x.id === m.id ? { ...m, sfide, ricostruzione: { dal: getDateKey() } } : x)),
        combatLog: pushLog(
          state.combatLog,
          `${m.nome}: ricostruzione da zero avviata${rifaiAppunti ? ' (appunti compresi)' : ''}. Il piano conta di nuovo tutto il lavoro.`,
          'HUB'
        )
      };
    }

    // V42 — una simulazione d'esame registrata (a mano o da Boss Fight).
    case 'ADD_SIMULAZIONE': {
      const { materiaId, simulazione } = action.payload || {};
      const m = findMateria(state, materiaId);
      const pct = Number(simulazione?.punteggioPct);
      if (!m || !Number.isFinite(pct)) return state;
      const record = {
        id: `sim_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        at: typeof simulazione.at === 'string' ? simulazione.at : nowIso(),
        tipo: simulazione.tipo === 'ORALE' ? 'ORALE' : 'SCRITTO',
        punteggioPct: Math.max(0, Math.min(100, Math.round(pct))),
        voto: Number.isFinite(Number(simulazione.voto)) ? Math.max(0, Math.min(31, Number(simulazione.voto))) : null,
        durataMin: Math.max(0, Math.min(480, Math.round(Number(simulazione.durataMin) || 0))),
        nota: typeof simulazione.nota === 'string' ? simulazione.nota.slice(0, 200) : '',
        fonte: simulazione.fonte === 'BOSS_FIGHT' ? 'BOSS_FIGHT' : 'MANUALE'
      };
      const materie = state.materie.map((x) => (x.id === m.id ? { ...x, simulazioni: appendCapped(x.simulazioni, record, MAX_SIMULAZIONI) } : x));
      return {
        ...state,
        materie,
        combatLog: pushLog(
          state.combatLog,
          `Simulazione ${record.tipo === 'ORALE' ? 'orale' : 'scritta'} di ${m.nome}: ${record.punteggioPct}%${record.voto != null ? ` (≈ ${record.voto}/30)` : ''}.`,
          'HUB'
        )
      };
    }

    // V42 — esercizi svolti fuori dal timer (su carta, a lezione).
    case 'LOG_ESERCIZI': {
      const { materiaId, sfidaId, fatti, corretti } = action.payload || {};
      const m = findMateria(state, materiaId);
      const f = Math.max(0, Math.min(100, Math.round(Number(fatti) || 0)));
      if (!m || f <= 0) return state;
      const c = Math.max(0, Math.min(f, Math.round(Number(corretti) || 0)));
      const target = (m.sfide || []).find((s) => s.id === sfidaId) || null;
      if (!target) return state;
      const entry = { at: getDateKey(), fatti: f, corretti: c, minuti: 0 };
      const next = updateMateriaSfide(state, m.id, (sfide) =>
        sfide.map((s) => (s.id === target.id ? { ...s, esercizi: appendCapped(s.esercizi, entry, MAX_ESERCIZI_LOG) } : s))
      );
      const combatLog = pushLog(next.combatLog, `Esercizi su "${target.nome}": ${c}/${f} corretti.`, 'HUB');
      const quest = applyQuestProgressAndProfile(next, next.profile, combatLog, QUEST_EVENTS.EXERCISES_LOGGED, { count: f });
      return { ...next, profile: quest.profile, combatLog: quest.combatLog, dailyPatrols: quest.dailyPatrols };
    }


    case 'DELETE_MATERIA': {
      const materia = findMateria(state, action.payload.id);
      // V39.0 — integrità referenziale: le lezioni dell'orario che
      // puntavano a questa materia spariscono con lei, invece di restare
      // come blocchi fantasma nella settimana.
      const campus = state.campus
        ? {
            ...state.campus,
            semestri: state.campus.semestri.map((sem) => ({
              ...sem,
              lezioni: sem.lezioni.filter((l) => l.materiaId !== action.payload.id)
            }))
          }
        : state.campus;
      return {
        ...state,
        campus,
        materie: state.materie.filter((m) => m.id !== action.payload.id),
        combatLog: pushLog(state.combatLog, `Nodo Web-Matrix eliminato: ${materia ? materia.nome : '???'}.`, 'HUB')
      };
    }

    // V41 — "Annulla" dopo l'eliminazione di una materia: rimette la
    // materia IDENTICA al suo posto e le lezioni dell'orario che le
    // appartenevano. Mirato, non un ripristino dell'intero profilo: tutto
    // ciò che è successo nel frattempo resta com'è. Idempotente: se la
    // materia c'è già, non fa nulla.
    case 'RESTORE_MATERIA': {
      const { materia, index, lezioni } = action.payload || {};
      if (!materia || typeof materia !== 'object' || !materia.id) return state;
      if (state.materie.some((m) => m && m.id === materia.id)) return state;
      const materie = [...state.materie];
      const at = Math.max(0, Math.min(materie.length, Number.isFinite(Number(index)) ? Number(index) : materie.length));
      materie.splice(at, 0, materia);
      let campus = state.campus;
      if (campus && Array.isArray(campus.semestri) && Array.isArray(lezioni) && lezioni.length > 0) {
        campus = normalizeCampus(
          {
            ...campus,
            semestri: campus.semestri.map((sem) => {
              const own = Array.isArray(sem.lezioni) ? sem.lezioni : [];
              const add = lezioni
                .filter((x) => x && x.semestreId === sem.id && x.lezione && !own.some((l) => l.id === x.lezione.id))
                .map((x) => x.lezione);
              return add.length > 0 ? { ...sem, lezioni: [...own, ...add] } : sem;
            })
          },
          materie.map((m) => m.id)
        );
      }
      return {
        ...state,
        materie,
        campus,
        combatLog: pushLog(state.combatLog, `Eliminazione annullata: ${materia.nome} è tornata nel Web-Matrix.`, 'HUB')
      };
    }

    /* -------------------------------------------------------------- *
     * V39.0 — EMPIRE STATE UNIVERSITY (utils/campusEngine.js)
     * Ogni azione ripassa da normalizeCampus: le stesse regole di
     * validità valgono per ciò che arriva dal form e per ciò che arriva
     * da un import, e nessun consumatore deve difendersi da dati rotti.
     * -------------------------------------------------------------- */
    case 'CAMPUS_ADD_SEMESTRE': {
      const sem = createSemestre(action.payload || {});
      const campus = normalizeCampus(
        { ...state.campus, semestri: [...(state.campus?.semestri || []), sem] },
        state.materie.map((m) => m.id)
      );
      return {
        ...state,
        campus,
        combatLog: pushLog(state.combatLog, `Empire State University — semestre aggiunto: ${sem.nome}.`, 'HUB')
      };
    }

    case 'CAMPUS_UPDATE_SEMESTRE': {
      const { id, patch } = action.payload || {};
      const campus = normalizeCampus(
        {
          ...state.campus,
          semestri: (state.campus?.semestri || []).map((s) =>
            s.id === id ? { ...s, ...patch, id: s.id, lezioni: patch?.lezioni ?? s.lezioni } : s
          )
        },
        state.materie.map((m) => m.id)
      );
      return { ...state, campus };
    }

    case 'CAMPUS_DELETE_SEMESTRE': {
      const sem = (state.campus?.semestri || []).find((s) => s.id === action.payload?.id);
      return {
        ...state,
        campus: { ...state.campus, semestri: (state.campus?.semestri || []).filter((s) => s.id !== action.payload?.id) },
        combatLog: sem
          ? pushLog(state.combatLog, `Empire State University — semestre eliminato: ${sem.nome}.`, 'HUB')
          : state.combatLog
      };
    }

    case 'CAMPUS_SAVE_LEZIONE': {
      // Crea o aggiorna (stesso id) una lezione dentro un semestre.
      const { semestreId, lezione } = action.payload || {};
      const materieIds = state.materie.map((m) => m.id);
      const campus = normalizeCampus(
        {
          ...state.campus,
          semestri: (state.campus?.semestri || []).map((s) => {
            if (s.id !== semestreId) return s;
            const exists = s.lezioni.some((l) => l.id === lezione?.id);
            const next = exists
              ? s.lezioni.map((l) => (l.id === lezione.id ? { ...l, ...lezione } : l))
              : [...s.lezioni, lezione?.id ? lezione : createLezione(lezione)];
            return { ...s, lezioni: next };
          })
        },
        materieIds
      );
      return { ...state, campus };
    }

    case 'CAMPUS_DELETE_LEZIONE': {
      const { semestreId, id } = action.payload || {};
      return {
        ...state,
        campus: {
          ...state.campus,
          semestri: (state.campus?.semestri || []).map((s) =>
            s.id === semestreId ? { ...s, lezioni: s.lezioni.filter((l) => l.id !== id) } : s
          )
        }
      };
    }

    case 'CAMPUS_TOGGLE_SOSPENSIONE': {
      const { semestreId, dateKey } = action.payload || {};
      const campus = normalizeCampus(
        {
          ...state.campus,
          semestri: (state.campus?.semestri || []).map((s) => {
            if (s.id !== semestreId) return s;
            const has = s.sospensioni.includes(dateKey);
            return { ...s, sospensioni: has ? s.sospensioni.filter((d) => d !== dateKey) : [...s.sospensioni, dateKey] };
          })
        },
        state.materie.map((m) => m.id)
      );
      return { ...state, campus };
    }

    case 'CAMPUS_SET_OVERRIDE': {
      const payload = action.payload;
      const campus = normalizeCampus(
        { ...state.campus, override: payload && payload.fase ? { fase: payload.fase, finoA: payload.finoA } : null },
        state.materie.map((m) => m.id)
      );
      const msg = campus.override
        ? `Empire State University — modalità ${campus.override.fase === 'LEZIONI' ? 'Lezioni' : 'Sessione'} forzata fino al ${campus.override.finoA}.`
        : 'Empire State University — modalità di nuovo automatica.';
      return { ...state, campus, combatLog: pushLog(state.combatLog, msg, 'SYSTEM') };
    }

    case 'CAMPUS_SET_RAPPORTO': {
      const campus = normalizeCampus(
        { ...state.campus, rapportoSintesi: action.payload?.value },
        state.materie.map((m) => m.id)
      );
      return { ...state, campus };
    }

    // V40.0 — esito dichiarato a mano per una o più lezioni (coda "Da
    // sistemare" della Empire State University): FATTA, SALTATA, oppure
    // null per annullare. `lezioni`: [{ id, dateKey }].
    case 'CAMPUS_SET_ESITO': {
      const { lezioni, esito } = action.payload || {};
      if (!Array.isArray(lezioni) || lezioni.length === 0) return state;
      if (esito != null && !ESITO_LEZIONE[esito]) return state;
      const esiti = { ...(state.campus?.esiti || {}) };
      lezioni.forEach((l) => {
        if (!l || typeof l.id !== 'string' || typeof l.dateKey !== 'string') return;
        const k = esitoKey(l.id, l.dateKey);
        if (esito == null) delete esiti[k];
        else esiti[k] = esito;
      });
      const campus = normalizeCampus({ ...state.campus, esiti }, state.materie.map((m) => m.id));
      return { ...state, campus };
    }

    case 'ADD_SFIDA': {
      const materia = findMateria(state, action.payload.materiaId);
      if (!materia) return state;
      if (isGoblinProtocol(materia)) return state; // Goblin Protocol: niente nuovi nodi a ridosso dell'esame.
      const sfida = createSfida(action.payload);
      return {
        ...updateMateriaSfide(state, action.payload.materiaId, (sfide) => [...sfide, sfida]),
        combatLog: pushLog(state.combatLog, `Nodo aggiunto a ${materia.nome}: ${sfida.nome}.`, 'HUB')
      };
    }

    case 'UPDATE_SFIDA':
      return updateMateriaSfide(state, action.payload.materiaId, (sfide) =>
        sfide.map((s) => {
          if (s.id !== action.payload.sfidaId) return s;
          const next = { ...s, ...action.payload.patch };
          // V40.0 — la sintesi fatta FUORI dall'app e registrata a mano
          // lascia un segno temporale per la coda delle lezioni.
          // V42 — e QUANTO lavoro: pagine di fonte e di appunti in più.
          // La coda lezioni lo converte in minuti al tuo ritmo, invece di
          // considerare sistemata ogni lezione precedente per una pagina.
          if (!sintesiAvanzata(s, next)) return next;
          const pagine = Math.max(0, nodeSources(next).fatte - nodeSources(s).fatte);
          const appunti = Math.max(0, nodeNotes(next).attuali - nodeNotes(s).attuali);
          const at = nowIso();
          return {
            ...next,
            sintesiAggiornataAt: at,
            sintesiManuale: pagine + appunti > 0 ? appendCapped(s.sintesiManuale, { at, pagine, appunti }, MAX_SINTESI_MANUALE) : s.sintesiManuale || []
          };
        })
      );


    case 'DELETE_SFIDA': {
      const materia = findMateria(state, action.payload.materiaId);
      if (!materia) return state;
      const filtered = materia.sfide.filter((s) => s.id !== action.payload.sfidaId);
      const orphaned = orphanChildren(filtered, action.payload.sfidaId);
      return {
        ...updateMateriaSfide(state, action.payload.materiaId, () => orphaned),
        combatLog: pushLog(state.combatLog, `Nodo rimosso da ${materia.nome}. Eventuali nodi figli promossi a radice.`, 'HUB')
      };
    }

    // V34.2 — "Selezione Multipla Nodi": stessa identica semantica di
    // DELETE_SFIDA (nessun figlio cancellato a cascata, solo orfanizzato —
    // parentId azzerato), applicata in un colpo solo a un intero set di
    // sfidaId. Usare un Set (non un ciclo di filter/orphan ripetuti uno
    // alla volta) garantisce che orfanizzare un nodo il cui PADRE è anche
    // lui nel set di eliminazione produca comunque il risultato corretto
    // in un solo passaggio, qualunque sia l'ordine degli id selezionati.
    case 'BULK_DELETE_SFIDE': {
      const { materiaId, sfidaIds } = action.payload;
      const materia = findMateria(state, materiaId);
      if (!materia || !Array.isArray(sfidaIds) || sfidaIds.length === 0) return state;
      const deleteSet = new Set(sfidaIds);
      const remaining = materia.sfide.filter((s) => !deleteSet.has(s.id));
      const orphaned = remaining.map((s) => (deleteSet.has(s.parentId) ? { ...s, parentId: null } : s));
      const deletedCount = materia.sfide.length - remaining.length;
      if (deletedCount === 0) return state;
      return {
        ...updateMateriaSfide(state, materiaId, () => orphaned),
        combatLog: pushLog(
          state.combatLog,
          `${deletedCount} nodo/i rimossi in blocco da ${materia.nome}. Eventuali nodi figli promossi a radice.`,
          'HUB'
        )
      };
    }

    // V41 — "Annulla" dopo l'eliminazione di uno o più argomenti: li
    // reinserisce nella posizione originale e ridà ai figli "promossi a
    // radice" il loro padre di prima (solo se nel frattempo nessuno li ha
    // già spostati altrove). Idempotente.
    case 'RESTORE_SFIDE': {
      const { materiaId, removed, reparent } = action.payload || {};
      const materia = findMateria(state, materiaId);
      if (!materia || !Array.isArray(removed) || removed.length === 0) return state;
      const sfide = [...(Array.isArray(materia.sfide) ? materia.sfide : [])];
      const ids = new Set(sfide.map((s) => s && s.id));
      let restored = 0;
      [...removed]
        .filter((r) => r && r.sfida && r.sfida.id)
        .sort((a, b) => (Number(a.index) || 0) - (Number(b.index) || 0))
        .forEach(({ sfida, index }) => {
          if (ids.has(sfida.id)) return;
          const at = Math.max(0, Math.min(sfide.length, Number(index) || 0));
          sfide.splice(at, 0, sfida);
          ids.add(sfida.id);
          restored += 1;
        });
      if (restored === 0) return state;
      const parentById = new Map((Array.isArray(reparent) ? reparent : []).filter((r) => r && r.id).map((r) => [r.id, r.parentId]));
      const relinked = sfide.map((s) =>
        s && parentById.has(s.id) && (s.parentId == null || s.parentId === '') && ids.has(parentById.get(s.id))
          ? { ...s, parentId: parentById.get(s.id) }
          : s
      );
      return {
        ...updateMateriaSfide(state, materiaId, () => relinked),
        combatLog: pushLog(
          state.combatLog,
          restored === 1 ? `Eliminazione annullata in ${materia.nome}: argomento ripristinato.` : `Eliminazione annullata in ${materia.nome}: ${restored} argomenti ripristinati.`,
          'HUB'
        )
      };
    }

    case 'COMPLETE_SFIDA': {
      const { materiaId, sfidaId } = action.payload;
      const materia = findMateria(state, materiaId);
      if (!materia) return state;
      const target = materia.sfide.find((s) => s.id === sfidaId);
      if (!target) return state;
      const displayStatus = deriveNodeStatus(target, materia.sfide);
      // V35.5 — un nodo "In corso" resta completabile come uno disponibile;
      // qualunque altro stato (bloccato, già completato) è un no-op.
      if (displayStatus !== NODE_STATUS.AVAILABLE && displayStatus !== NODE_STATUS.IN_PROGRESS) return state;
      const isHard = target.difficulty === DIFFICULTY.HARD;
      const skillEffects = computeSkillEffects(state.profile.unlockedSkills);
      const isMaxCarnage = isMaxCarnageActive(state.profile);
      const tracked = trackedMinutes(target);
      const conStudio = tracked >= NODE_COMPLETION_MIN_MINUTES;

      // V42 — il completamento è un TRAGUARDO pagato una volta sola: se il
      // nodo era già stato premiato (completato prima della V42, poi
      // riaperto), rifarlo non paga di nuovo.
      const xpGain =
        target.xpLegacyPaid === true
          ? 0
          : computeNodeCompletionXp({
              difficulty: target.difficulty,
              cfu: materia.cfu,
              trackedMinutes: tracked,
              streak: state.profile.streak,
              streakThresholdBonus: skillEffects.streakThresholdBonus,
              xpBonusPct: skillEffects.xpBonusPct,
              isMaxCarnage
            });

      const now = nowIso();
      const oggi = todayDateOnlyKey();
      const completato = markFirstCompletion(target, planningExamDate(materia, oggi), {
        load: reviewLoadByDate(materia.sfide, sfidaId),
        todayKey: oggi,
        nowIso: now
      });
      const { xpLegacyPaid: _legacy, ...pulito } = completato;
      const completedSfide = materia.sfide.map((s) => (s.id === sfidaId ? { ...pulito, xpAwarded: xpGain, xpAwardedAt: now } : s));
      const firstReviewDate = pulito.nextReviewDate;

      let profile = xpGain > 0 ? applyXpDeltaWithTokens(state.profile, xpGain) : state.profile;
      profile = { ...profile, hardNodesCompleted: (profile.hardNodesCompleted || 0) + (isHard && conStudio ? 1 : 0) };

      let combatLog = pushLog(
        state.combatLog,
        `Argomento "${target.nome}" completato in ${materia.nome}. +${xpGain} XP${isMaxCarnage && xpGain > 0 ? ' [MAXIMUM CARNAGE x2]' : ''}${
          conStudio ? '' : ' (nessuno studio tracciato: premio minimo)'
        }. Primo ripasso il ${firstReviewDate}.`,
        'SUCCESS'
      );

      // Maximum Carnage: un argomento Hard STUDIATO è un'azione critica.
      const carnageUpdate = applyCriticalAction(profile, combatLog, isHard && conStudio);
      profile = carnageUpdate.profile;
      combatLog = carnageUpdate.combatLog;

      // Daily Patrol: "Node Hunter" e "Boss Hunter" (nodo con figli agganciati).
      const isBossNode = materia.sfide.some((s) => s.parentId === sfidaId);
      const questUpdate = applyQuestProgressAndProfile(state, profile, combatLog, QUEST_EVENTS.NODE_COMPLETED, { isBoss: isBossNode, tracked: conStudio });

      return {
        ...updateMateriaSfide(state, materiaId, () => completedSfide),
        profile: questUpdate.profile,
        combatLog: questUpdate.combatLog,
        dailyPatrols: questUpdate.dailyPatrols
      };
    }


    // V34.4 — "Riporta a da completare": undo di un COMPLETE_SFIDA.
    // V42 — ritira l'XP del completamento (tracciato su `xpAwarded`): prima
    // completa/riapri a ripetizione regalava migliaia di XP. La memoria
    // stimata (stabilità, difficoltà) resta: quanto sai non cambia perché
    // hai annullato un click. Per i nodi completati prima della V42
    // l'importo non è noto: niente ritiro, e un nuovo completamento non paga.
    case 'REOPEN_SFIDA': {
      const { materiaId, sfidaId } = action.payload;
      const materia = findMateria(state, materiaId);
      if (!materia) return state;
      const target = materia.sfide.find((s) => s.id === sfidaId);
      if (!target) return state;
      if (target.status !== PERSISTED_STATUS.COMPLETED) return state;

      const pagato = Number(target.xpAwarded);
      const revoca = target.xpAwarded != null && Number.isFinite(pagato) && pagato > 0 ? pagato : 0;
      const legacy = target.xpAwarded == null && target.chiusoDaVerbale !== true;
      const reopenedSfide = materia.sfide.map((s) =>
        s.id === sfidaId
          ? {
              ...s,
              status: PERSISTED_STATUS.PENDING,
              completionTimestamp: null,
              nextReviewDate: null,
              lastReviewRating: null,
              srsIntervalDays: 0,
              xpAwarded: 0,
              xpAwardedAt: null,
              ...(legacy || s.xpLegacyPaid ? { xpLegacyPaid: true } : {})
            }
          : s
      );

      let profile = state.profile;
      if (revoca > 0) profile = applyXpDelta(profile, -revoca);
      const eraHardStudiato = target.difficulty === DIFFICULTY.HARD && revoca > 0 && trackedMinutes(target) >= NODE_COMPLETION_MIN_MINUTES;
      if (eraHardStudiato) profile = { ...profile, hardNodesCompleted: Math.max(0, (profile.hardNodesCompleted || 0) - 1) };

      return {
        ...updateMateriaSfide(state, materiaId, () => reopenedSfide),
        profile,
        combatLog: pushLog(
          state.combatLog,
          revoca > 0
            ? `Argomento "${target.nome}" riportato a "da completare" in ${materia.nome}: −${revoca} XP del completamento.`
            : `Argomento "${target.nome}" riportato a "da completare" in ${materia.nome}.`,
          'HUB'
        )
      };
    }


    // V42 — ripasso con quattro giudizi e memoria FSRS (utils/spiderSense.js).
    // XP e missione solo se il ripasso era DOVUTO e non già fatto oggi: il
    // ripasso anticipato resta possibile (aggiorna la memoria), ma non si
    // "farma". Prima 20 ripassi dello stesso nodo davano 225 XP.
    case 'REVIEW_SFIDA': {
      const { materiaId, sfidaId, rating, source } = action.payload;
      const materia = findMateria(state, materiaId);
      if (!materia) return state;
      const target = materia.sfide.find((s) => s.id === sfidaId);
      const out = reviewOutcome(materia, target, rating, { source: source || 'MANUALE' });
      if (!out) return state;

      const skillEffects = computeSkillEffects(state.profile.unlockedSkills);
      const pagato = out.wasDue && !out.alreadyToday;
      const reviewXp = pagato ? computeReviewXp(skillEffects.reviewXpBonus) : 0;
      let profile = reviewXp > 0 ? applyXpDeltaWithTokens(state.profile, reviewXp) : state.profile;
      if (pagato) profile = { ...profile, reviewsCompleted: (profile.reviewsCompleted || 0) + 1 };

      const meta = REVIEW_RATING_META[out.rating] || REVIEW_RATING_META.MEDIUM;
      const giorni = Math.max(1, Math.round((Date.parse(out.schedule.nextReviewDate) - Date.parse(todayDateOnlyKey())) / 86400000));
      let combatLog = pushLog(
        state.combatLog,
        pagato
          ? `Ripasso di "${target.nome}" (${meta.label}): prossimo fra ${giorni} gg (${out.schedule.nextReviewDate}). +${reviewXp} XP.`
          : `Ripasso ${out.alreadyToday ? 'ripetuto oggi' : 'anticipato'} di "${target.nome}" (${meta.label}): memoria aggiornata, nessun XP. Prossimo il ${out.schedule.nextReviewDate}.`,
        'SUCCESS'
      );

      const questUpdate = applyQuestProgressAndProfile(state, profile, combatLog, QUEST_EVENTS.REVIEW_DONE, { wasDue: pagato });
      profile = questUpdate.profile;
      combatLog = questUpdate.combatLog;

      return {
        ...updateMateriaSfide(state, materiaId, () => out.sfide),
        profile,
        combatLog,
        dailyPatrols: questUpdate.dailyPatrols
      };
    }

    // V42 — l'esito di un'interrogazione (quiz di K.A.R.E.N. o orale
    // simulato): Sapevo / Parziale / Non lo sapevo, domanda per domanda.
    // Diventa un ripasso vero del nodo (se completato) e alimenta il
    // pilastro "Pratica" della prontezza.
    case 'QUIZ_RESULT': {
      const { materiaId, sfidaId, sapevo = 0, parziale = 0, no = 0, modo = 'QUIZ' } = action.payload || {};
      const materia = findMateria(state, materiaId);
      if (!materia) return state;
      const target = materia.sfide.find((s) => s.id === sfidaId);
      if (!target) return state;
      const sv = Math.max(0, Math.round(Number(sapevo) || 0));
      const pz = Math.max(0, Math.round(Number(parziale) || 0));
      const nn = Math.max(0, Math.round(Number(no) || 0));
      const tot = sv + pz + nn;
      if (tot === 0) return state;
      const esito = { at: nowIso(), sapevo: sv, parziale: pz, no: nn, modo: modo === 'ORALE' ? 'ORALE' : 'QUIZ' };
      let next = updateMateriaSfide(state, materiaId, (sfide) =>
        sfide.map((s) => (s.id === sfidaId ? { ...s, quizEsiti: appendCapped(s.quizEsiti, esito, MAX_QUIZ_LOG) } : s))
      );
      const ratio = (sv + pz * 0.5) / tot;
      if (target.status === PERSISTED_STATUS.COMPLETED) {
        const rating = ratio >= 0.85 ? REVIEW_RATING.EASY : ratio >= 0.6 ? REVIEW_RATING.MEDIUM : ratio >= 0.35 ? REVIEW_RATING.HARD : REVIEW_RATING.AGAIN;
        next = reducer(next, { type: 'REVIEW_SFIDA', payload: { materiaId, sfidaId, rating, source: esito.modo } });
      } else {
        next = {
          ...next,
          combatLog: pushLog(next.combatLog, `Interrogazione su "${target.nome}": ${sv} sapute, ${pz} a metà, ${nn} da rivedere.`, 'HUB')
        };
      }
      return next;
    }


    case 'FOCUS_COMPLETED': {
      const p = action.payload || {};
      const { wasOverdrive, materiaId, sfidaId } = p;
      // Il payload porta il totale dei minuti dell'intera catena Focus +
      // Overdrive (vedi endFocusSession in useFocusTimer).
      const focusMinutes = Math.max(0, Math.round(Number(p.focusMinutes != null ? p.focusMinutes : state.settings.focusTime) || 0));
      if (focusMinutes <= 0) return state;
      // V42 — i minuti dei blocchi NON Overdrive: il bonus vale solo sul resto.
      const baseMinutes = Number.isFinite(Number(p.baseMinutes)) ? Math.max(0, Math.min(focusMinutes, Number(p.baseMinutes))) : focusMinutes;
      const quality = p.quality || DEFAULT_FOCUS_QUALITY;
      const qualityMeta = FOCUS_QUALITY_META[quality] || FOCUS_QUALITY_META[DEFAULT_FOCUS_QUALITY];
      // V38.0/V42 — il modo della sessione (Sintesi, Studio, Ripasso,
      // Esercizi). Non dichiarato (sessione recuperata al boot): i minuti
      // entrano nel totale ma in nessun contatore separato.
      const workMode = isWorkMode(p.workMode) ? p.workMode : null;
      let pagineFonte = Math.max(0, Math.round(Number(p.pagineFonte) || 0));
      const pagineAppuntiProdotte = workMode === WORK_MODE.SINTESI ? Math.max(0, Math.round(Number(p.pagineAppuntiProdotte) || 0)) : 0;
      const eserciziFatti = workMode === WORK_MODE.ESERCIZI ? Math.max(0, Math.min(200, Math.round(Number(p.eserciziFatti) || 0))) : 0;
      const eserciziCorretti = Math.max(0, Math.min(eserciziFatti, Math.round(Number(p.eserciziCorretti) || 0)));

      const materia = materiaId ? findMateria(state, materiaId) : null;
      const targetNode = materia && sfidaId ? materia.sfide.find((s) => s.id === sfidaId) : null;

      // V40.2 — pagine snellite FONTE PER FONTE (Debriefing), mai oltre le
      // pagine che le restano. V42 — e per TIPO di fonte, per misurare i
      // ritmi di sintesi di libro, slide e dispense separatamente.
      let fontiPerFonte = null;
      const pagineFontePerTipo = {};
      const perFonte = p.pagineFontePer;
      if (workMode === WORK_MODE.SINTESI && targetNode && perFonte && typeof perFonte === 'object') {
        let applicate = 0;
        fontiPerFonte = (Array.isArray(targetNode.fonti) ? targetNode.fonti : []).map((f) => {
          const richieste = Math.max(0, Math.round(Number(perFonte[f?.id]) || 0));
          if (!f || richieste <= 0) return f;
          const totali = Math.max(0, Math.round(Number(f.pagine) || 0));
          const fatte = Math.min(totali, Math.max(0, Math.round(Number(f.pagineFatte) || 0)));
          const quota = Math.min(richieste, totali - fatte);
          if (quota <= 0) return f;
          applicate += quota;
          const tipo = f.tipo || 'ALTRO';
          pagineFontePerTipo[tipo] = (pagineFontePerTipo[tipo] || 0) + quota;
          return { ...f, pagineFatte: fatte + quota };
        });
        pagineFonte = applicate;
      }
      if (workMode !== WORK_MODE.SINTESI) pagineFonte = 0;
      const difficulty = targetNode ? targetNode.difficulty : DIFFICULTY.MEDIUM;
      const isFatigued = state.profile.stamina < FATIGUE_STAMINA_THRESHOLD;
      const skillEffects = computeSkillEffects(state.profile.unlockedSkills);
      const isMaxCarnage = isMaxCarnageActive(state.profile);

      const xpGain = computeFocusXp({
        focusMinutes,
        baseMinutes,
        cfu: materia ? materia.cfu : 0,
        isOverdrive: wasOverdrive,
        isFatigued,
        difficulty,
        streak: state.profile.streak,
        quality,
        xpBonusPct: skillEffects.xpBonusPct,
        overdriveMultiplier: skillEffects.overdriveMultiplier,
        streakThresholdBonus: skillEffects.streakThresholdBonus,
        isMaxCarnage
      });
      // V42 — Stamina tarata sulla capacità giornaliera (passata dal Provider).
      const capacityHours = Number(p.capacityHours) > 0 ? Number(p.capacityHours) : 4.5;
      const staminaCost = computeFocusStaminaCost(focusMinutes, difficulty, skillEffects.staminaCostMultiplier, false, capacityHours);
      // V42 — bonus proporzionale ai minuti, solo per sessioni da almeno 20'.
      const spiderSenseBonus = materia ? computeSpiderSenseSurgeXp(materia.perceivedDifficulty, focusMinutes) : 0;

      let profile = applyXpDeltaWithTokens(state.profile, xpGain);
      profile = {
        ...profile,
        stamina: Math.max(0, profile.stamina - staminaCost),
        overdriveCount: profile.overdriveCount + (wasOverdrive ? 1 : 0)
      };

      const key = getDateKey();
      const starLog = [...state.starLog];
      const todayIdx = starLog.findIndex((e) => e.type === 'FOCUS_MINUTES' && e.dateKey === key);
      if (todayIdx >= 0) {
        starLog[todayIdx] = {
          ...starLog[todayIdx],
          minutes: starLog[todayIdx].minutes + focusMinutes,
          xp: (starLog[todayIdx].xp || 0) + xpGain
        };
      } else {
        starLog.push({ type: 'FOCUS_MINUTES', dateKey: key, minutes: focusMinutes, xp: xpGain });
      }
      starLog.push({
        type: 'FOCUS_SESSION',
        dateKey: key,
        minutes: focusMinutes,
        baseMinutes,
        xp: xpGain,
        surgeXp: spiderSenseBonus,
        hour: new Date().getHours(),
        timestamp: nowIso(),
        quality,
        materiaId: materiaId || null,
        // V42 — anche l'argomento: serve a K.A.R.E.N. ("ieri: Integrali,
        // in sintesi") e al bilancio settimanale.
        sfidaId: targetNode ? targetNode.id : null,
        workMode,
        pagineFonte,
        pagineFontePerTipo: Object.keys(pagineFontePerTipo).length > 0 ? pagineFontePerTipo : null,
        pagineAppuntiProdotte,
        eserciziFatti,
        eserciziCorretti
      });

      let nextState = { ...state, profile, starLog };
      if (materia && targetNode) {
        nextState = updateMateriaSfide(nextState, materiaId, (sfide) =>
          sfide.map((s) => {
            if (s.id !== sfidaId) return s;
            const aggiornato = {
              ...s,
              focusMinutes: (Number(s.focusMinutes) || 0) + focusMinutes,
              // I contatori separati alimentano ritmi diversi: mescolarli
              // darebbe velocità sbagliate. V42 — gli ESERCIZI contano come
              // studio (sono studio dell'argomento) e anche a parte; il
              // RIPASSO mai come studio (non è primo apprendimento).
              focusMinutesSintesi: (Number(s.focusMinutesSintesi) || 0) + (workMode === WORK_MODE.SINTESI ? focusMinutes : 0),
              focusMinutesStudio:
                (Number(s.focusMinutesStudio) || 0) + (workMode === WORK_MODE.STUDIO || workMode === WORK_MODE.ESERCIZI ? focusMinutes : 0),
              minutiEsercizi: (Number(s.minutiEsercizi) || 0) + (workMode === WORK_MODE.ESERCIZI ? focusMinutes : 0),
              minutiRipasso: (Number(s.minutiRipasso) || 0) + (workMode === WORK_MODE.RIPASSO ? focusMinutes : 0)
            };
            if (workMode === WORK_MODE.ESERCIZI && eserciziFatti > 0) {
              aggiornato.esercizi = appendCapped(s.esercizi, { at: key, fatti: eserciziFatti, corretti: eserciziCorretti, minuti: focusMinutes }, MAX_ESERCIZI_LOG);
            }
            if (workMode !== WORK_MODE.SINTESI) return aggiornato;
            // V42 — una sessione col timer NON segna più `sintesiAggiornataAt`:
            // i suoi minuti sistemano le lezioni per quello che valgono (una
            // sessione da 5 minuti con una pagina sistemava 6 ore di lezioni).
            return {
              ...aggiornato,
              fonti: fontiPerFonte || applySintesiProgress(aggiornato.fonti, pagineFonte),
              pagineAppunti: (Number(aggiornato.pagineAppunti) || 0) + pagineAppuntiProdotte
            };
          })
        );
      } else if (materia && workMode !== WORK_MODE.RIPASSO) {
        // V42 — studio sulla materia senza un argomento scelto: accorcia la
        // stima di una materia non ancora mappata.
        nextState = {
          ...nextState,
          materie: nextState.materie.map((m) => (m.id === materia.id ? { ...m, focusMinutesLibere: (Number(m.focusMinutesLibere) || 0) + focusMinutes } : m))
        };
      }

      const modoLabel = workMode ? ` [${workMode.charAt(0)}${workMode.slice(1).toLowerCase()}]` : '';
      let combatLog = pushLog(
        nextState.combatLog,
        `Sessione Focus completata${modoLabel}${wasOverdrive ? ' [OVERDRIVE]' : ''}${isMaxCarnage ? ' [MAXIMUM CARNAGE x2]' : ''}${targetNode ? ` su "${targetNode.nome}"` : ''} — ${qualityMeta.shortLabel}. +${xpGain} XP, -${staminaCost} Stamina (${focusMinutes} min).`,
        wasOverdrive ? 'OVERDRIVE' : 'FOCUS'
      );
      if (workMode === WORK_MODE.SINTESI && targetNode && (pagineFonte > 0 || pagineAppuntiProdotte > 0)) {
        const pezzi = [];
        if (pagineFonte > 0) pezzi.push(`${pagineFonte} pagine di fonte snellite`);
        if (pagineAppuntiProdotte > 0) pezzi.push(`+${pagineAppuntiProdotte} pagine dei tuoi appunti`);
        combatLog = pushLog(combatLog, `Forgia degli Appunti — "${targetNode.nome}": ${pezzi.join(', ')}.`, 'SYSTEM');
      }
      if (workMode === WORK_MODE.ESERCIZI && eserciziFatti > 0) {
        combatLog = pushLog(combatLog, `Esercizi${targetNode ? ` su "${targetNode.nome}"` : ''}: ${eserciziCorretti}/${eserciziFatti} corretti.`, 'SYSTEM');
      }
      if (p.recovered) {
        combatLog = pushLog(
          combatLog,
          'K.A.R.E.N. — Sessione Focus recuperata automaticamente dopo una chiusura imprevista (tab chiusa/crash prima del Tactical Debriefing).',
          'SYSTEM'
        );
      }

      // V42 — la serie avanza quando oggi arriva a 25 minuti veri.
      {
        const streakUpdate = applyStudyDayStreak(nextState.profile, combatLog, { todayMinutes: todayFocusMinutes(starLog, key), settings: state.settings });
        profile = streakUpdate.profile;
        combatLog = streakUpdate.combatLog;
      }

      // Maximum Carnage: un Overdrive su una sessione vera è un'azione critica.
      {
        const carnageUpdate = applyCriticalAction(profile, combatLog, !!wasOverdrive && focusMinutes >= CRITICAL_OVERDRIVE_MIN_MINUTES);
        profile = carnageUpdate.profile;
        combatLog = carnageUpdate.combatLog;
      }

      if (spiderSenseBonus > 0) {
        profile = applyXpDeltaWithTokens(profile, spiderSenseBonus);
        combatLog = pushLog(
          combatLog,
          `Spider-Sense Surge — ${focusMinutes} minuti puliti su "${materia.nome}": +${spiderSenseBonus} XP (difficoltà ${Number.isFinite(materia.perceivedDifficulty) ? materia.perceivedDifficulty : 3}/5).`,
          'SPIDERSENSE'
        );
      }
      nextState = { ...nextState, profile, combatLog };

      // V42 — un blocco di RIPASSO col giudizio del Debriefing è un ripasso vero.
      if (workMode === WORK_MODE.RIPASSO && targetNode && REVIEW_RATING[p.reviewRating]) {
        nextState = reducer(nextState, { type: 'REVIEW_SFIDA', payload: { materiaId, sfidaId, rating: p.reviewRating, source: 'FOCUS' } });
        profile = nextState.profile;
        combatLog = nextState.combatLog;
      }

      // Daily Patrol: il bersaglio del piano arriva dal Provider (lo stesso
      // mostrato in Mission Control); il ricalcolo qui è solo il ripiego.
      let primaryTargetMateriaId = p.primaryTargetMateriaId;
      if (primaryTargetMateriaId === undefined) {
        const calNow = computeCalibration(state);
        const plannable = withPlanningDates(state.materie);
        const planNow = computeDailyPlan(plannable, { calibration: calNow });
        const primaryTargetNow = computePrimaryTarget(plannable, calNow, planNow.dailyFocusQuotas[0]?.materiaId ?? null);
        primaryTargetMateriaId = primaryTargetNow ? primaryTargetNow.materia.id : null;
      }
      let questUpdate = applyQuestProgressAndProfile(nextState, profile, combatLog, QUEST_EVENTS.FOCUS_SESSION, {
        minutes: focusMinutes,
        wasOverdrive,
        quality,
        hour: new Date().getHours(),
        materiaId: materiaId || null,
        primaryTargetMateriaId: primaryTargetMateriaId || null,
        workMode,
        pagineAppuntiProdotte,
        lessonMateriaIds: Array.isArray(p.lessonMateriaIds) ? p.lessonMateriaIds : []
      });
      if (eserciziFatti > 0) {
        questUpdate = applyQuestProgressAndProfile(
          { ...nextState, dailyPatrols: questUpdate.dailyPatrols },
          questUpdate.profile,
          questUpdate.combatLog,
          QUEST_EVENTS.EXERCISES_LOGGED,
          { count: eserciziFatti }
        );
      }

      return {
        ...nextState,
        profile: questUpdate.profile,
        combatLog: questUpdate.combatLog,
        dailyPatrols: questUpdate.dailyPatrols
      };
    }

    // V42 — una pausa fatta davvero (arrivata a zero) ricarica Stamina.
    case 'BREAK_COMPLETED': {
      const minutes = Math.max(0, Math.min(60, Number(action.payload?.minutes) || 0));
      if (minutes <= 0) return state;
      const skillEffects = computeSkillEffects(state.profile.unlockedSkills);
      const gain = computeBreakStaminaRestore(minutes, skillEffects.breakStaminaBonus);
      const stamina = Math.min(100, (Number(state.profile.stamina) || 0) + gain);
      if (stamina === state.profile.stamina) return state;
      return {
        ...state,
        profile: { ...state.profile, stamina },
        combatLog: pushLog(state.combatLog, `Pausa di ${minutes} min completata: +${stamina - state.profile.stamina} Stamina.`, 'REFUEL')
      };
    }


    case 'BLOOD_PACT_INTERRUPT': {
      const skillEffects = computeSkillEffects(state.profile.unlockedSkills);
      const penalty = computeBloodPactPenalty(skillEffects.bloodPactReduction);
      let profile = applyXpDelta(state.profile, -penalty);
      profile = { ...profile, bloodPactCount: profile.bloodPactCount + 1 };
      return {
        ...state,
        profile,
        combatLog: pushLog(state.combatLog, `Blood Pact invocato: Focus interrotto. -${penalty} XP.`, 'DANGER')
      };
    }

    case 'APPLY_QUICK_QUEST': {
      const quest = state.quickQuests.find((q) => q.id === action.payload.questId);
      if (!quest) return state;
      const usedToday = state.profile.dailyProtocolsCompletedToday || [];
      if (usedToday.includes(quest.id)) return state; // Daily Hero Duties: una volta al giorno, reset alle 03:00.
      // V42 — tetti giornalieri: i Daily Protocols sono benessere, non una
      // fonte di XP o di Stamina infinita ("8 Ore di Sonno" alle 16 non
      // cancella più la stanchezza di una giornata oltre il limite).
      const oggi = getDateKey();
      const stessoGiorno = state.profile.protocolDayKey === oggi;
      const staminaGia = stessoGiorno ? Number(state.profile.protocolStaminaToday) || 0 : 0;
      const xpGia = stessoGiorno ? Number(state.profile.protocolXpToday) || 0 : 0;
      const staminaGain = Math.max(0, Math.min(Number(quest.staminaReward) || 0, PROTOCOL_STAMINA_DAY_CAP - staminaGia, 100 - state.profile.stamina));
      const xpGain = Math.max(0, Math.min(Number(quest.xpReward) || 0, PROTOCOL_MAX_XP, PROTOCOL_XP_DAY_CAP - xpGia));
      let profile = {
        ...state.profile,
        stamina: state.profile.stamina + staminaGain,
        quickQuestsUsed: (state.profile.quickQuestsUsed || 0) + 1,
        dailyProtocolsCompletedToday: [...usedToday, quest.id],
        protocolDayKey: oggi,
        protocolStaminaToday: staminaGia + staminaGain,
        protocolXpToday: xpGia + xpGain
      };
      if (xpGain > 0) profile = applyXpDeltaWithTokens(profile, xpGain);
      const tetto = staminaGain < (Number(quest.staminaReward) || 0) || xpGain < (Number(quest.xpReward) || 0);
      return {
        ...state,
        profile,
        combatLog: pushLog(
          state.combatLog,
          `Daily Protocol "${quest.nome}" completato. +${staminaGain} Stamina${xpGain > 0 ? `, +${xpGain} XP` : ''}${tetto ? ' (tetto giornaliero dei protocolli)' : ''}.`,
          'REFUEL'
        )
      };
    }

    case 'ADD_QUICK_QUEST': {
      const nome = typeof action.payload?.nome === 'string' ? action.payload.nome.trim().slice(0, 60) : '';
      if (!nome) return state;
      // V42 — un protocollo vale al massimo 40 Stamina e 30 XP (prima fino a 500).
      const staminaReward = Math.max(0, Math.min(PROTOCOL_MAX_STAMINA, Math.round(Number(action.payload.staminaReward) || 0)));
      const xpReward = Math.max(0, Math.min(PROTOCOL_MAX_XP, Math.round(Number(action.payload.xpReward) || 0)));
      return {
        ...state,
        quickQuests: [...state.quickQuests, { id: `qq_${Date.now()}`, nome, staminaReward, xpReward }]
      };
    }


    case 'DELETE_QUICK_QUEST':
      return { ...state, quickQuests: state.quickQuests.filter((q) => q.id !== action.payload.id) };

    case 'RESET_STAMINA':
      return {
        ...state,
        profile: {
          ...state.profile,
          stamina: 100,
          lastStaminaResetDate: nowIso(),
          dailyProtocolsCompletedToday: [],
          protocolStaminaToday: 0,
          protocolXpToday: 0
        },
        combatLog: pushLog(state.combatLog, 'Reset giornaliero (03:00): Stamina e Daily Protocols ripristinati.', 'SYSTEM')
      };


    // V41 — validazione: prima un nome vuoto o un costo NaN/negativo
    // (campo svuotato nel form) finivano nello Shop così com'erano, e una
    // ricompensa a costo NaN non si poteva più né riscattare né capire.
    case 'ADD_SHOP_REWARD': {
      const nome = typeof action.payload?.nome === 'string' ? action.payload.nome.trim().slice(0, 80) : '';
      const costoXp = Math.round(Number(action.payload?.costoXp));
      if (!nome || !Number.isFinite(costoXp) || costoXp < 1) return state;
      return {
        ...state,
        shopRewards: [
          ...state.shopRewards,
          { id: `reward_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, nome, costoXp: Math.min(costoXp, 10000000) }
        ]
      };
    }

    case 'DELETE_SHOP_REWARD':
      return { ...state, shopRewards: state.shopRewards.filter((r) => r.id !== action.payload.id) };

    case 'REDEEM_SHOP_REWARD': {
      const reward = state.shopRewards.find((r) => r.id === action.payload.id);
      if (!reward) return state;
      if (computeTotalBankedXp(state.profile) < reward.costoXp) return state; // Blindatura: niente saldo negativo.
      const profile = applyXpDelta(state.profile, -reward.costoXp);

      const inventory = [...state.inventory];
      const existingIdx = inventory.findIndex((i) => i.rewardId === reward.id);
      if (existingIdx >= 0) {
        inventory[existingIdx] = { ...inventory[existingIdx], quantity: inventory[existingIdx].quantity + 1 };
      } else {
        inventory.push({ id: `inv_${Date.now()}`, rewardId: reward.id, nome: reward.nome, quantity: 1 });
      }

      return {
        ...state,
        profile,
        inventory,
        combatLog: pushLog(state.combatLog, `Ricompensa riscattata: ${reward.nome} (-${reward.costoXp} XP). Aggiunta all'Inventario.`, 'SHOP')
      };
    }

    case 'CONSUME_INVENTORY_ITEM': {
      const item = state.inventory.find((i) => i.id === action.payload.id);
      if (!item) return state;
      const inventory = item.quantity > 1
        ? state.inventory.map((i) => (i.id === item.id ? { ...i, quantity: i.quantity - 1 } : i))
        : state.inventory.filter((i) => i.id !== item.id);
      return {
        ...state,
        inventory,
        combatLog: pushLog(state.combatLog, `Ricompensa consumata: ${item.nome}. Goditela, Cadetto.`, 'SHOP')
      };
    }

    // V42 — la Boss Fight è una SIMULAZIONE D'ESAME: XP in proporzione al
    // tempo davvero passato sotto esame (prima 500-600 XP anche dichiarando
    // la vittoria al primo secondo), niente XP sotto i 20 minuti, il tempo
    // conta come studio della materia e — se registri il punteggio —
    // diventa una simulazione che alimenta la prontezza.
    case 'BOSS_FIGHT_RESULT': {
      const p = action.payload || {};
      const win = !!p.win;
      const hpRemaining = Math.max(0, Math.min(100, Number(p.hpRemaining) || 0));
      const totalSeconds = Math.max(0, Number(p.totalSeconds) || 0);
      const timeRemainingSeconds = Math.max(0, Number(p.timeRemainingSeconds) || 0);
      const elapsedSeconds = Number.isFinite(Number(p.elapsedSeconds)) ? Math.max(0, Number(p.elapsedSeconds)) : Math.max(0, totalSeconds - timeRemainingSeconds);
      const minuti = Math.floor(elapsedSeconds / 60);
      const materia = p.materiaId ? findMateria(state, p.materiaId) : null;
      const skillEffects = computeSkillEffects(state.profile.unlockedSkills);
      const isMaxCarnage = isMaxCarnageActive(state.profile);
      const streakMult = computeStreakMultiplier(state.profile.streak, skillEffects.streakThresholdBonus);
      let xpGain = 0;
      if (minuti >= SIMULATION_MIN_MINUTES) {
        xpGain = win ? minuti * 2.5 * (0.6 + (0.4 * hpRemaining) / 100) * streakMult : minuti * streakMult;
        if (isMaxCarnage) xpGain *= MAX_CARNAGE_MULTIPLIER;
        xpGain = Math.round(xpGain);
      }
      let profile = xpGain > 0 ? applyXpDeltaWithTokens(state.profile, xpGain) : state.profile;
      const key = getDateKey();
      const starLog = [
        ...state.starLog,
        {
          type: win ? 'BOSS_WIN' : 'BOSS_LOSS',
          dateKey: key,
          hpRemaining,
          xp: xpGain,
          timeRemainingSeconds,
          totalSeconds,
          elapsedSeconds,
          timestamp: nowIso(),
          materiaId: materia ? materia.id : null,
          materiaNome: materia ? materia.nome : p.materiaNome || null
        }
      ];
      // Il tempo della simulazione è studio: entra nei minuti di oggi.
      if (minuti > 0) {
        const idx = starLog.findIndex((e) => e.type === 'FOCUS_MINUTES' && e.dateKey === key);
        if (idx >= 0) starLog[idx] = { ...starLog[idx], minutes: starLog[idx].minutes + minuti, xp: (starLog[idx].xp || 0) + xpGain };
        else starLog.push({ type: 'FOCUS_MINUTES', dateKey: key, minutes: minuti, xp: xpGain });
        starLog.push({
          type: 'FOCUS_SESSION',
          dateKey: key,
          minutes: minuti,
          xp: xpGain,
          hour: new Date().getHours(),
          timestamp: nowIso(),
          quality: DEFAULT_FOCUS_QUALITY,
          materiaId: materia ? materia.id : null,
          sfidaId: null,
          workMode: WORK_MODE.ESERCIZI,
          simulazione: true
        });
      }
      let materie = state.materie;
      if (materia && minuti > 0) {
        materie = materie.map((m) => (m.id === materia.id && (!m.sfide || m.sfide.length === 0) ? { ...m, focusMinutesLibere: (Number(m.focusMinutesLibere) || 0) + minuti } : m));
      }
      let combatLog = pushLog(
        state.combatLog,
        minuti < SIMULATION_MIN_MINUTES
          ? `Simulazione chiusa dopo ${minuti} min: sotto i ${SIMULATION_MIN_MINUTES} minuti non vale come prova d'esame, nessun XP.`
          : win
          ? `Simulazione superata${materia ? ` (${materia.nome})` : ''}: ${minuti} min sotto esame, ${hpRemaining} HP residui. +${xpGain} XP${isMaxCarnage ? ' [MAXIMUM CARNAGE x2]' : ''}.`
          : `Simulazione persa${materia ? ` (${materia.nome})` : ''} dopo ${minuti} min: +${xpGain} XP per l'allenamento.`,
        win ? 'SUCCESS' : 'DANGER'
      );
      let next = { ...state, profile, starLog, combatLog, materie };
      if (materia && Number.isFinite(Number(p.punteggioPct))) {
        next = reducer(next, {
          type: 'ADD_SIMULAZIONE',
          payload: {
            materiaId: materia.id,
            simulazione: { tipo: p.tipo === 'ORALE' ? 'ORALE' : 'SCRITTO', punteggioPct: Number(p.punteggioPct), voto: p.voto, durataMin: minuti, nota: p.nota, fonte: 'BOSS_FIGHT' }
          }
        });
      }
      profile = next.profile;
      combatLog = next.combatLog;
      if (minuti > 0) {
        const streakUpdate = applyStudyDayStreak(profile, combatLog, { todayMinutes: todayFocusMinutes(next.starLog, key), settings: state.settings });
        profile = streakUpdate.profile;
        combatLog = streakUpdate.combatLog;
      }
      let dailyPatrols = next.dailyPatrols;
      if (minuti >= SIMULATION_MIN_MINUTES) {
        const questUpdate = applyQuestProgressAndProfile(next, profile, combatLog, QUEST_EVENTS.BOSS_FIGHT_WIN, { minutes: minuti });
        profile = questUpdate.profile;
        combatLog = questUpdate.combatLog;
        dailyPatrols = questUpdate.dailyPatrols;
      }
      if (win && minuti >= SIMULATION_MIN_MINUTES) {
        const carnageUpdate = applyCriticalAction(profile, combatLog, true);
        profile = carnageUpdate.profile;
        combatLog = carnageUpdate.combatLog;
      }
      return { ...next, profile, combatLog, dailyPatrols };
    }


    case 'GAUNTLET_CLEARED': {
      // V33.1 — Sinister Six Gauntlet: dispatchata UNA sola volta da
      // BossFight.jsx, solo alla vittoria sul sesto e ultimo Villain di
      // una run (mai su un semplice Boss Fight singolo). Puramente
      // additiva: non tocca XP/HP/starLog, già gestiti round per round
      // dal normale BOSS_FIGHT_RESULT — qui si limita a incrementare il
      // contatore lifetime che alimenta il trofeo dedicato.
      const profile = { ...state.profile, gauntletsCleared: (state.profile.gauntletsCleared || 0) + 1 };
      return {
        ...state,
        profile,
        combatLog: pushLog(state.combatLog, 'SINISTER SIX GAUNTLET COMPLETATA — tutti e 6 i Villain abbattuti in fila.', 'SUCCESS')
      };
    }

    case 'LAST_STAND_SACRIFICE': {
      const sacrifice = Math.round(computeTotalBankedXp(state.profile) * LAST_STAND_SACRIFICE_RATE);
      let profile = applyXpDelta(state.profile, -sacrifice);
      profile = { ...profile, lastStandCount: (profile.lastStandCount || 0) + 1 };
      return {
        ...state,
        profile,
        combatLog: pushLog(state.combatLog, `LAST STAND! Sacrificati ${sacrifice} XP per sopravvivere a 1 HP.`, 'DANGER')
      };
    }

    case 'UNLOCK_TROPHIES': {
      // V37.0 — PRESTAZIONI: qui si richiamava `evaluateTrophies` su
      // TUTTO lo stato solo per ricavare i NOMI da scrivere nel log —
      // una scansione completa di materie, nodi e starLog per stampare
      // due stringhe. I nomi arrivano ora nel payload, che li ha già:
      // chi dispatcha ha appena valutato i trofei (vedi useAchievements).
      const { ids, names } = action.payload;
      const newRecords = ids.map((id) => ({ id, unlockedAt: nowIso() }));
      const trophies = [...state.trophies, ...newRecords];
      let combatLog = state.combatLog;
      ids.forEach((id, i) => {
        const nome = (Array.isArray(names) && names[i]) || id;
        combatLog = pushLog(combatLog, `Trofeo sbloccato: ${nome}.`, 'TROPHY');
      });
      return { ...state, trophies, combatLog };
    }

    case 'UNLOCK_SKILL': {
      const { skillId } = action.payload;
      const def = getSkillDef(skillId);
      const unlockedSkills = Array.isArray(state.profile.unlockedSkills) ? state.profile.unlockedSkills : [];
      // Blindatura: rifiuta silenziosamente unlock non validi (skill
      // sconosciuta, già sbloccata, prerequisiti mancanti o Token
      // insufficienti) — mai un saldo negativo di Tech Token.
      if (!canUnlockSkill(def, unlockedSkills, state.profile.techTokens || 0)) return state;
      const profile = {
        ...state.profile,
        techTokens: state.profile.techTokens - def.cost,
        unlockedSkills: [...unlockedSkills, def.id]
      };
      return {
        ...state,
        profile,
        combatLog: pushLog(state.combatLog, `Skill Tree: "${def.title}" sbloccata (-${def.cost} Tech Token).`, 'SYSTEM')
      };
    }

    case 'GENERATE_DAILY_PATROLS':
      // Rigenerazione giornaliera (Quantum Router / Daily Patrol Engine):
      // sostituisce l'intero set di missioni con quelle appena generate
      // (deterministiche sulla dateKey — vedi generateDailyQuests).
      return { ...state, dailyPatrols: action.payload };

    // V27.0 — Pillar 3: scadenza naturale (o disattivazione esplicita)
    // della finestra Maximum Carnage.
    case 'DEACTIVATE_MAX_CARNAGE':
      return {
        ...state,
        profile: { ...state.profile, ...deactivateMaxCarnage() },
        combatLog: pushLog(state.combatLog, 'Maximum Carnage Mode esaurita. Il simbionte si ritira, in attesa della prossima carica.', 'CARNAGE')
      };

    // V42 — attivazione VOLONTARIA della carica (mai di notte).
    case 'ACTIVATE_MAX_CARNAGE': {
      const esito = activateMaxCarnage(state.profile);
      if (!esito.ok) return state;
      let profile = { ...state.profile, ...esito.patch };
      let combatLog = state.combatLog;
      // V31.3 — la prima attivazione sblocca per sempre la Symbiote Suit.
      if (!profile.symbioteSuitUnlocked) {
        profile = { ...profile, symbioteSuitUnlocked: true };
        combatLog = pushLog(combatLog, 'Symbiote Suit sbloccata — disponibile in Karen OS Settings.', 'CARNAGE');
      }
      combatLog = pushLog(combatLog, 'MAXIMUM CARNAGE MODE ATTIVATA — per le prossime 2 ore gli XP raddoppiano. La Stamina scende come sempre: ascoltala.', 'CARNAGE');
      return { ...state, profile, combatLog };
    }

    // V42 — "CHIUDI LA GIORNATA": il bilancio di oggi e il piano di domani,
    // preparato la sera (primo blocco e ora d'inizio compresi). La mattina
    // Mission Control si apre su quel piano: decidere la sera prima è il
    // modo più efficace di non rimandare.
    case 'CLOSE_DAY': {
      const p = action.payload || {};
      const dateKey = typeof p.dateKey === 'string' ? p.dateKey : getDateKey();
      const giaChiusa = (state.dayClosures || []).some((c) => c.dateKey === dateKey);
      const voce = {
        dateKey,
        minuti: Math.max(0, Math.round(Number(p.minuti) || 0)),
        obiettivoMin: Math.max(0, Math.round(Number(p.obiettivoMin) || 0)),
        energia: Number.isInteger(p.energia) && p.energia >= 1 && p.energia <= 5 ? p.energia : null,
        nota: typeof p.nota === 'string' ? p.nota.slice(0, 280) : ''
      };
      const dayClosures = [...(state.dayClosures || []).filter((c) => c.dateKey !== dateKey), voce]
        .sort((a, b) => a.dateKey.localeCompare(b.dateKey))
        .slice(-MAX_DAY_CLOSURES);
      const tomorrowPlan = p.tomorrowPlan ? normalizeTomorrowPlan({ ...p.tomorrowPlan, createdAt: nowIso() }) : state.tomorrowPlan;
      let next = {
        ...state,
        dayClosures,
        tomorrowPlan,
        combatLog: pushLog(
          state.combatLog,
          `Giornata chiusa: ${voce.minuti} min di studio${voce.obiettivoMin ? ` su ${voce.obiettivoMin} previsti` : ''}.${tomorrowPlan ? ` Piano di domani pronto${tomorrowPlan.oraInizio ? `, si parte alle ${tomorrowPlan.oraInizio}` : ''}.` : ''}`,
          'SYSTEM'
        )
      };
      if (!giaChiusa) {
        const q = applyQuestProgressAndProfile(next, next.profile, next.combatLog, QUEST_EVENTS.DAY_CLOSED, {});
        next = { ...next, profile: q.profile, combatLog: q.combatLog, dailyPatrols: q.dailyPatrols };
      }
      return next;
    }

    case 'SAVE_TOMORROW_PLAN':
      return { ...state, tomorrowPlan: action.payload?.plan ? normalizeTomorrowPlan({ ...action.payload.plan, createdAt: nowIso() }) : null };

    case 'MARK_TOMORROW_PLAN_STARTED':
      if (!state.tomorrowPlan) return state;
      return { ...state, tomorrowPlan: { ...state.tomorrowPlan, avviatoAt: nowIso() } };

    // V42 — copia locale dell'ultimo bilancio settimanale di K.A.R.E.N.
    case 'SAVE_KAREN_WEEKLY': {
      const { weekKey, payload, generatedAt, weekClosed } = action.payload || {};
      if (typeof weekKey !== 'string' || !payload || typeof payload !== 'object') return state;
      // V42 — la data in cui K.A.R.E.N. l'ha scritto (un bilancio dalla cache
      // non è "di oggi") e se la settimana era già chiusa allora.
      const quando = typeof generatedAt === 'string' && Number.isFinite(Date.parse(generatedAt)) ? new Date(generatedAt).toISOString() : nowIso();
      return { ...state, karenWeekly: { weekKey, payload, savedAt: quando, weekClosed: weekClosed === true } };
    }


    // V27.0 — Pillar 4: "Il Forziere di Parker" — il roll pesato avviene
    // FUORI dal reducer (vedi actions.claimWebSling), cosi' che il reducer
    // resti puro/deterministico: qui si applica solo il risultato già
    // deciso. Doppio-claim blindato sulla dateKey persistita.
    case 'WEB_SLING_CLAIM': {
      if (!canClaimWebSling(state.profile)) return state;
      const { tier, pityTriggered } = action.payload;
      let profile = tier.xp > 0 ? applyXpDeltaWithTokens(state.profile, tier.xp) : state.profile;
      profile = {
        ...profile,
        webSlingLastClaimDateKey: getDateKey(),
        stamina: tier.restoreStamina ? 100 : profile.stamina,
        techTokens: (Number.isFinite(profile.techTokens) ? profile.techTokens : 0) + (tier.techTokens || 0),
        // V31.3 — Pity System: azzerato su ogni tier Alto (Raro/Forziere di
        // Parker, sia genuino sia garantito dalla pity stessa), incrementato
        // altrimenti — un solo contatore, mai due fonti di verità.
        webSlingPityCounter: isHighTier(tier) ? 0 : (Number.isFinite(state.profile.webSlingPityCounter) ? state.profile.webSlingPityCounter : 0) + 1
      };
      const rewardParts = [`+${tier.xp} XP`];
      if (tier.restoreStamina) rewardParts.push('Stamina rigenerata al 100%');
      if (tier.techTokens > 0) rewardParts.push(`+${tier.techTokens} Tech Token`);
      return {
        ...state,
        profile,
        combatLog: pushLog(
          state.combatLog,
          `Daily Web-Sling — Forziere aperto: ${tier.label} (${tier.rarity})${pityTriggered ? ' [Spider-Sense della Fortuna — garanzia Pity attivata]' : ''}. ${rewardParts.join(', ')}.`,
          'REFUEL'
        )
      };
    }

    // V27.0 — Pillar 2: "AI Index Matrix" — importazione bulk di un
    // sotto-albero (Nodo Padre + Nodi Figli) già validato/normalizzato da
    // createSfideTreeFromAiIndex (vedi aiIndexParser.js). Il reducer si
    // limita ad appendere i nodi già pronti alla Materia target: nessuna
    // logica di parsing/validazione vive qui (mai un reducer impuro o
    // fallibile su input esterno malformato).
    case 'BULK_IMPORT_SFIDE': {
      const { materiaId, sfide } = action.payload;
      const materia = findMateria(state, materiaId);
      if (!materia || !Array.isArray(sfide) || sfide.length === 0) return state;
      const parentCount = sfide.filter((s) => !s.parentId).length;
      return {
        ...updateMateriaSfide(state, materiaId, (existing) => [...existing, ...sfide]),
        combatLog: pushLog(
          state.combatLog,
          `AI Index Matrix — importati ${sfide.length} nodi (${parentCount} Nodo/i Padre) in ${materia.nome}.`,
          'HUB'
        )
      };
    }

    case 'LOG_EVENT':
      return { ...state, combatLog: pushLog(state.combatLog, action.payload.message, action.payload.tag) };

    case 'IMPORT_PROFILE':
      return {
        ...action.payload,
        combatLog: pushLog(action.payload.combatLog || [], 'Profilo importato dal Data Ledger.', 'SYSTEM')
      };

    case 'RESET_PROFILE': {
      // V26.0 — Cloud State Sync: il reset non tocca più direttamente il
      // Cloud (niente localStorage da "clearState()" qui): lo stato fresh
      // rientra semplicemente nel normale ciclo di autosave debounced,
      // che sovrascriverà `app_state` su Supabase come qualunque altra
      // modifica — un solo punto di scrittura, mai due percorsi paralleli.
      const fresh = createDefaultState();
      return {
        ...fresh,
        combatLog: pushLog(fresh.combatLog, 'Reset totale eseguito: profilo riportato ai valori di default.', 'SYSTEM')
      };
    }

    // V35.0 — K.A.R.E.N. Daily Brain: registra un singolo "snapshot" di
    // readiness al giorno (edge-trigger, dedup su lastReadinessLogDateKey
    // — stesso idioma di RESET_STAMINA/GENERATE_DAILY_PATROLS), dispatchata
    // dal componente-ponte KarenTrophyBridge (App.jsx) quando un nuovo
    // briefing K.A.R.E.N. per oggi diventa disponibile. Alimenta SOLO i
    // contatori lifetime per la Sala Trofei (Aderenza alla Readiness
    // Biometrica) — compartimenti stagni preservati: nessuna tabella
    // biometrica viene letta o scritta da qui, si riceve solo un valore
    // già calcolato altrove (karen-oracle) come payload di un evento.
    case 'LOG_READINESS_SNAPSHOT': {
      const { dateKey, band } = action.payload;
      if (!dateKey || state.profile.lastReadinessLogDateKey === dateKey) return state; // già loggato oggi.
      const prevDateKey = state.profile.lastReadinessLogDateKey;
      const isConsecutive = !!prevDateKey && daysBetween(prevDateKey, dateKey) === 1;
      const profile = {
        ...state.profile,
        lastReadinessLogDateKey: dateKey,
        readinessLogDaysTotal: (state.profile.readinessLogDaysTotal || 0) + 1,
        readinessLogStreak: isConsecutive ? (state.profile.readinessLogStreak || 0) + 1 : 1,
        optimalReadinessDaysTotal: (state.profile.optimalReadinessDaysTotal || 0) + (band === 'OTTIMALE' ? 1 : 0)
      };
      return { ...state, profile };
    }

    default:
      return state;
  }
}

export default reducer;
