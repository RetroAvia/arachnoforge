import React, {
  createContext,
  useContext,
  useReducer,
  useEffect,
  useMemo,
  useCallback,
  useState,
  useRef
} from 'react';
import { validateImportedProfile } from '../utils/storage.js';
import { hydrateState, createDefaultState } from '../data/defaultSchema.js';
import { supabase, USER_DATA_TABLE } from '../utils/supabaseClient.js';
import { useAuthContext } from './AuthContext.jsx';
import BootScreen from '../components/BootScreen.jsx';
import {
  computeFocusXp,
  computeFocusStaminaCost,
  computeStreakMultiplier,
  applyXpDelta,
  applyXpDeltaWithTokens,
  computeTotalBankedXp,
  computeBloodPactPenalty,
  computeReviewXp,
  LAST_STAND_SACRIFICE_RATE,
  FATIGUE_STAMINA_THRESHOLD,
  DIFFICULTY,
  FOCUS_QUALITY,
  FOCUS_QUALITY_META,
  DEFAULT_FOCUS_QUALITY
} from '../utils/xpEngine.js';
import { NODE_STATUS, PERSISTED_STATUS, deriveNodeStatus, orphanChildren, createSfida, markFirstCompletion } from '../utils/skillTree.js';
import { getSkillDef, canUnlockSkill, computeSkillEffects } from '../data/techTree.js';
import { computeNextReviewDate } from '../utils/spiderSense.js';
import { isGoblinProtocol } from '../utils/materiaMeta.js';
import { nowIso, getDateKey, isSameDay, daysBetween, crossedThreeAM, daysUntilDateOnly } from '../utils/dateUtils.js';
import { evaluateTrophies } from '../data/trophies.js';
import { TIMER_STATUS } from '../hooks/useTimerEngine.js';
import { useFocusTimer } from '../hooks/useFocusTimer.js';
import { useAudioEngine } from '../hooks/useAudioEngine.js';
import { useProgression } from '../hooks/useProgression.js';
import { useSpiderSense } from '../hooks/useSpiderSense.js';
import { useKarenAutoRouter } from '../hooks/useKarenAutoRouter.js';
import { computePrimaryTarget } from '../utils/karenSuggestor.js';
import { generateDailyQuests, applyQuestEvent, QUEST_EVENTS } from '../utils/dailyPatrol.js';
import { useAchievements } from '../hooks/useAchievements.js';

const ArachnoForgeContext = createContext(null);

const MAX_COMBAT_LOG = 50;
const BURNOUT_MINUTES_THRESHOLD = 300;

function pushLog(combatLog, message, tag = 'INFO') {
  const entry = { id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, message, tag, timestamp: nowIso() };
  const next = [...combatLog, entry];
  if (next.length > MAX_COMBAT_LOG) next.splice(0, next.length - MAX_COMBAT_LOG);
  return next;
}

function findMateria(state, materiaId) {
  return state.materie.find((m) => m.id === materiaId) || null;
}

function updateMateriaSfide(state, materiaId, updater) {
  return {
    ...state,
    materie: state.materie.map((m) => (m.id === materiaId ? { ...m, sfide: updater(m.sfide) } : m))
  };
}

function updateStreakOnActivity(profile) {
  const now = nowIso();
  if (isSameDay(profile.lastActiveDate, now)) return profile;
  const gap = daysBetween(profile.lastActiveDate, now);
  const streak = gap === 1 ? profile.streak + 1 : 1;
  return { ...profile, streak, lastActiveDate: now };
}

/**
 * Daily Patrol Engine — Auto-Tracking (V23.0, Modulo 2): punto unico da
 * cui OGNI azione rilevante del reducer aggiorna le missioni del giorno.
 * `applyQuestEvent` (pura, in dailyPatrol.js) incrementa `currentProgress`
 * sulle quest il cui `type` corrisponde all'evento; qui si rileva la
 * transizione false -> true e si assegna l'XP + il log in modo atomico,
 * nella STESSA azione che ha generato il progresso (mai un secondo giro
 * di dispatch, mai un "claim" separato: è auto-tracking vero).
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
      nextProfile = applyXpDelta(nextProfile, q.xpReward);
      nextProfile = { ...nextProfile, dailyPatrolsCompleted: (nextProfile.dailyPatrolsCompleted || 0) + 1 };
      nextCombatLog = pushLog(nextCombatLog, `Daily Patrol completata: ${q.title}. +${q.xpReward} XP.`, 'SUCCESS');
    }
  });
  return { dailyPatrols: { ...dailyPatrols, quests: after }, profile: nextProfile, combatLog: nextCombatLog };
}

function reducer(state, action) {
  switch (action.type) {
    case 'HYDRATE':
      return action.payload;

    case 'UPDATE_PROFILE':
      return { ...state, profile: { ...state.profile, ...action.payload } };

    case 'UPDATE_SETTINGS':
      return {
        ...state,
        settings: { ...state.settings, ...action.payload },
        combatLog: pushLog(state.combatLog, 'Parametri di sistema aggiornati.', 'CONFIG')
      };

    case 'ADD_MATERIA': {
      const materia = {
        id: `materia_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        nome: action.payload.nome,
        examDate: action.payload.examDate,
        cfu: action.payload.cfu,
        createdAt: nowIso(),
        sfide: [],
        // V17.0 — Web-Path Planner (Vanvitelli Exam Engine).
        courseId: action.payload.courseId || null,
        perceivedDifficulty: Number.isFinite(action.payload.perceivedDifficulty) ? action.payload.perceivedDifficulty : 3,
        urgency: Number.isFinite(action.payload.urgency) ? action.payload.urgency : 3,
        examPassed: !!action.payload.examPassed,
        // V18.0 — Multiverse Simulator (GPA Engine).
        voto: Number.isFinite(action.payload.voto) && action.payload.voto >= 18 && action.payload.voto <= 30 ? action.payload.voto : null,
        lode: !!action.payload.lode
      };
      return {
        ...state,
        materie: [...state.materie, materia],
        combatLog: pushLog(state.combatLog, `Nuovo Nodo del Web-Matrix aperto: ${materia.nome} (${materia.cfu} CFU).`, 'HUB')
      };
    }

    case 'UPDATE_MATERIA':
      return {
        ...state,
        materie: state.materie.map((m) => (m.id === action.payload.id ? { ...m, ...action.payload.patch } : m))
      };

    case 'DELETE_MATERIA': {
      const materia = findMateria(state, action.payload.id);
      return {
        ...state,
        materie: state.materie.filter((m) => m.id !== action.payload.id),
        combatLog: pushLog(state.combatLog, `Nodo Web-Matrix eliminato: ${materia ? materia.nome : '???'}.`, 'HUB')
      };
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
        sfide.map((s) => (s.id === action.payload.sfidaId ? { ...s, ...action.payload.patch } : s))
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

    case 'COMPLETE_SFIDA': {
      const { materiaId, sfidaId } = action.payload;
      const materia = findMateria(state, materiaId);
      if (!materia) return state;
      const target = materia.sfide.find((s) => s.id === sfidaId);
      if (!target) return state;
      const displayStatus = deriveNodeStatus(target, materia.sfide);
      if (displayStatus !== NODE_STATUS.AVAILABLE) return state; // Blindatura: doppio click non ridà XP.
      const isFatigued = state.profile.stamina < FATIGUE_STAMINA_THRESHOLD;
      const isHard = target.difficulty === DIFFICULTY.HARD;
      const skillEffects = computeSkillEffects(state.profile.unlockedSkills);

      const xpGain = computeFocusXp({
        focusMinutes: state.settings.focusTime,
        cfu: materia.cfu,
        isOverdrive: false,
        isFatigued,
        difficulty: target.difficulty,
        streak: state.profile.streak,
        xpBonusPct: skillEffects.xpBonusPct,
        streakThresholdBonus: skillEffects.streakThresholdBonus
      });

      const completedSfide = materia.sfide.map((s) => (s.id === sfidaId ? markFirstCompletion(s) : s));

      let profile = applyXpDeltaWithTokens(state.profile, xpGain);
      profile = { ...profile, hardNodesCompleted: profile.hardNodesCompleted + (isHard ? 1 : 0) };
      profile = updateStreakOnActivity(profile);

      let combatLog = pushLog(
        state.combatLog,
        `Nodo "${target.nome}" completato in ${materia.nome}. +${xpGain} XP. Prossimo Spider-Sense tra 7 giorni.`,
        'SUCCESS'
      );

      // Daily Patrol Engine: "Node Hunter" e "Boss Hunter" si aggiornano
      // da soli. Un nodo è un "Boss" se ha almeno un figlio diretto agganciato.
      const isBossNode = materia.sfide.some((s) => s.parentId === sfidaId);
      const questUpdate = applyQuestProgressAndProfile(state, profile, combatLog, QUEST_EVENTS.NODE_COMPLETED, { isBoss: isBossNode });
      profile = questUpdate.profile;
      combatLog = questUpdate.combatLog;

      return {
        ...updateMateriaSfide(state, materiaId, () => completedSfide),
        profile,
        combatLog,
        dailyPatrols: questUpdate.dailyPatrols
      };
    }

    case 'REVIEW_SFIDA': {
      const { materiaId, sfidaId, rating } = action.payload;
      const materia = findMateria(state, materiaId);
      if (!materia) return state;
      const target = materia.sfide.find((s) => s.id === sfidaId);
      if (!target) return state;
      // Un ripasso è valido su QUALSIASI nodo già completato almeno una
      // volta (status persistito COMPLETED), sia che lo Spider-Sense lo
      // segnali come scaduto (NEEDS_REVIEW) sia in caso di Forza Ripasso
      // Manuale anticipato: l'utente può sempre rinforzare la memoria.
      if (target.status !== PERSISTED_STATUS.COMPLETED) return state; // Blindatura: nessun ripasso su nodo non completato.
      const wasDue = deriveNodeStatus(target, materia.sfide) === NODE_STATUS.NEEDS_REVIEW;

      const nextReviewDate = computeNextReviewDate(rating);
      const reviewedSfide = materia.sfide.map((s) =>
        s.id === sfidaId
          ? { ...s, nextReviewDate, lastReviewRating: rating, reviewCount: (s.reviewCount || 0) + 1 }
          : s
      );

      const skillEffects = computeSkillEffects(state.profile.unlockedSkills);
      const reviewXp = computeReviewXp(skillEffects.reviewXpBonus);

      let profile = applyXpDeltaWithTokens(state.profile, reviewXp);
      profile = { ...profile, reviewsCompleted: (profile.reviewsCompleted || 0) + 1 };
      profile = updateStreakOnActivity(profile);

      let combatLog = pushLog(
        state.combatLog,
        wasDue
          ? `Spider-Sense placato su "${target.nome}": prossimo ripasso ${nextReviewDate}. +${reviewXp} XP.`
          : `Ripasso Manuale forzato su "${target.nome}": prossimo ripasso ${nextReviewDate}. +${reviewXp} XP.`,
        'SUCCESS'
      );

      // Daily Patrol Engine: "Web-Shooter" (Ripassi Azzerati) si aggiorna da solo.
      const questUpdate = applyQuestProgressAndProfile(state, profile, combatLog, QUEST_EVENTS.REVIEW_DONE, {});
      profile = questUpdate.profile;
      combatLog = questUpdate.combatLog;

      return {
        ...updateMateriaSfide(state, materiaId, () => reviewedSfide),
        profile,
        combatLog,
        dailyPatrols: questUpdate.dailyPatrols
      };
    }

    case 'FOCUS_COMPLETED': {
      const { wasOverdrive, materiaId, sfidaId } = action.payload;
      // Tactical Timer: il payload porta il totale minuti accumulati per
      // l'intera catena Focus + eventuali Overdrive concatenati (vedi
      // endFocusSession in useFocusTimer), non il singolo blocco fisso.
      const focusMinutes = action.payload.focusMinutes != null ? action.payload.focusMinutes : state.settings.focusTime;
      // Tactical Debriefing: esito qualitativo scelto nel modal
      // post-sessione ("Sessione Completata. Valuta il tuo Focus").
      const quality = action.payload.quality || DEFAULT_FOCUS_QUALITY;
      const qualityMeta = FOCUS_QUALITY_META[quality] || FOCUS_QUALITY_META[DEFAULT_FOCUS_QUALITY];
      const materia = materiaId ? findMateria(state, materiaId) : null;
      const targetNode = materia && sfidaId ? materia.sfide.find((s) => s.id === sfidaId) : null;
      const difficulty = targetNode ? targetNode.difficulty : DIFFICULTY.MEDIUM;
      const isFatigued = state.profile.stamina < FATIGUE_STAMINA_THRESHOLD;
      const sessionHour = new Date().getHours();
      const skillEffects = computeSkillEffects(state.profile.unlockedSkills);
      // "Simbiosi Notturna" (Skill Tree): +10% XP solo se l'abilità è
      // sbloccata E la sessione è realmente notturna (00:00-04:00) — mai
      // un bonus fantasma fuori dalla finestra oraria dichiarata.
      const nightBonus = skillEffects.nightBonusEnabled && sessionHour >= 0 && sessionHour < 4;

      const xpGain = computeFocusXp({
        focusMinutes,
        cfu: materia ? materia.cfu : 0,
        isOverdrive: wasOverdrive,
        isFatigued,
        difficulty,
        streak: state.profile.streak,
        quality,
        xpBonusPct: skillEffects.xpBonusPct,
        nightBonus,
        overdriveMultiplier: skillEffects.overdriveMultiplier,
        streakThresholdBonus: skillEffects.streakThresholdBonus
      });
      const staminaCost = computeFocusStaminaCost(focusMinutes, difficulty, skillEffects.staminaCostMultiplier);

      let profile = applyXpDeltaWithTokens(state.profile, xpGain);
      profile = {
        ...profile,
        stamina: Math.max(0, profile.stamina - staminaCost),
        overdriveCount: profile.overdriveCount + (wasOverdrive ? 1 : 0)
      };
      profile = updateStreakOnActivity(profile);

      const key = getDateKey();
      const starLog = [...state.starLog];
      const todayIdx = starLog.findIndex((e) => e.type === 'FOCUS_MINUTES' && e.dateKey === key);
      // V16.0 (Pillar 4): l'aggregato giornaliero traccia anche l'XP
      // guadagnato quel giorno (non solo i minuti), per alimentare i
      // tooltip precisi "Data: X Focus, Y XP" della Heatmap Calendario.
      if (todayIdx >= 0) {
        starLog[todayIdx] = {
          ...starLog[todayIdx],
          minutes: starLog[todayIdx].minutes + focusMinutes,
          xp: (starLog[todayIdx].xp || 0) + xpGain
        };
      } else {
        starLog.push({ type: 'FOCUS_MINUTES', dateKey: key, minutes: focusMinutes, xp: xpGain });
      }
      // Traccia la singola sessione con ora locale e valutazione qualitativa
      // del Tactical Debriefing: alimenta sia il trofeo segreto "Tuta
      // Simbionte" (Focus notturno 00:00-04:00) sia la sezione "Qualità del
      // Focus" dello Star Log.
      starLog.push({
        type: 'FOCUS_SESSION',
        dateKey: key,
        minutes: focusMinutes,
        xp: xpGain,
        hour: new Date().getHours(),
        timestamp: nowIso(),
        quality,
        // V20.0 — Daily Patrol (Pillar 5): la quest "Primary Target" deve
        // verificare che la sessione di oggi sia stata fatta PROPRIO
        // sull'esame suggerito da Karen, quindi il materiaId va tracciato
        // anche quando è null (Focus generico, nessuna materia collegata).
        materiaId: materiaId || null
      });

      let nextState = { ...state, profile, starLog };
      if (materia && targetNode) {
        nextState = updateMateriaSfide(nextState, materiaId, (sfide) =>
          sfide.map((s) => (s.id === sfidaId ? { ...s, focusMinutes: s.focusMinutes + focusMinutes } : s))
        );
      }

      let combatLog = pushLog(
        nextState.combatLog,
        `Sessione Focus completata${wasOverdrive ? ' [OVERDRIVE]' : ''}${targetNode ? ` su "${targetNode.nome}"` : ''} — Debriefing: ${qualityMeta.label} (${qualityMeta.badge}). +${xpGain} XP, -${staminaCost} Stamina (${focusMinutes} min).`,
        wasOverdrive ? 'OVERDRIVE' : 'FOCUS'
      );

      // Daily Patrol Engine: Focus Strike, Primary Target, Early Bird,
      // Night Owl, Flow Seeker e Overdrive Master si aggiornano TUTTI da
      // questo singolo evento — auto-tracking reale, nessun ricalcolo a
      // parte lato UI. Il Primary Target va ricalcolato qui (stesso
      // algoritmo di karenSuggestor.js) perché il reducer non ha accesso
      // al valore già memoizzato a livello di Provider.
      const primaryTargetNow = computePrimaryTarget(state.materie);
      const questUpdate = applyQuestProgressAndProfile(nextState, nextState.profile, combatLog, QUEST_EVENTS.FOCUS_SESSION, {
        minutes: focusMinutes,
        wasOverdrive,
        quality,
        hour: new Date().getHours(),
        materiaId: materiaId || null,
        primaryTargetMateriaId: primaryTargetNow ? primaryTargetNow.materia.id : null
      });

      return {
        ...nextState,
        profile: questUpdate.profile,
        combatLog: questUpdate.combatLog,
        dailyPatrols: questUpdate.dailyPatrols
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
      const stamina = Math.min(100, state.profile.stamina + quest.staminaReward);
      let profile = {
        ...state.profile,
        stamina,
        quickQuestsUsed: (state.profile.quickQuestsUsed || 0) + 1,
        dailyProtocolsCompletedToday: [...usedToday, quest.id]
      };
      if (quest.xpReward > 0) profile = applyXpDelta(profile, quest.xpReward);
      return {
        ...state,
        profile,
        combatLog: pushLog(
          state.combatLog,
          `Daily Protocol "${quest.nome}" completato. +${quest.staminaReward} Stamina${quest.xpReward > 0 ? `, +${quest.xpReward} XP` : ''}.`,
          'REFUEL'
        )
      };
    }

    case 'ADD_QUICK_QUEST':
      return {
        ...state,
        quickQuests: [
          ...state.quickQuests,
          { id: `qq_${Date.now()}`, nome: action.payload.nome, staminaReward: action.payload.staminaReward, xpReward: action.payload.xpReward || 0 }
        ]
      };

    case 'DELETE_QUICK_QUEST':
      return { ...state, quickQuests: state.quickQuests.filter((q) => q.id !== action.payload.id) };

    case 'RESET_STAMINA':
      return {
        ...state,
        profile: { ...state.profile, stamina: 100, lastStaminaResetDate: nowIso(), dailyProtocolsCompletedToday: [] },
        combatLog: pushLog(state.combatLog, 'Reset giornaliero (03:00): Stamina e Daily Protocols ripristinati.', 'SYSTEM')
      };

    case 'ADD_SHOP_REWARD':
      return {
        ...state,
        shopRewards: [
          ...state.shopRewards,
          { id: `reward_${Date.now()}`, nome: action.payload.nome, costoXp: action.payload.costoXp }
        ]
      };

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

    case 'BOSS_FIGHT_RESULT': {
      const { win, hpRemaining, materiaNome, timeRemainingSeconds, totalSeconds } = action.payload;
      const skillEffects = computeSkillEffects(state.profile.unlockedSkills);
      const xpGain = win
        ? Math.round(500 * (0.5 + hpRemaining / 200) * computeStreakMultiplier(state.profile.streak, skillEffects.streakThresholdBonus))
        : 0;
      let profile = state.profile;
      if (win) profile = applyXpDeltaWithTokens(profile, xpGain);
      const starLog = [
        ...state.starLog,
        {
          type: win ? 'BOSS_WIN' : 'BOSS_LOSS',
          dateKey: getDateKey(),
          hpRemaining,
          xp: xpGain,
          timeRemainingSeconds: timeRemainingSeconds || 0,
          totalSeconds: totalSeconds || 0,
          timestamp: nowIso(),
          materiaNome: materiaNome || null
        }
      ];
      let combatLog = pushLog(
        state.combatLog,
        win
          ? `Supercriminale sconfitto (${hpRemaining} HP residui). +${xpGain} XP.`
          : 'Il Supercriminale ha avuto la meglio. Nessun XP guadagnato.',
        win ? 'SUCCESS' : 'DANGER'
      );

      let dailyPatrols = state.dailyPatrols;
      if (win) {
        // Daily Patrol Engine: "Sinister Six Slayer" si aggiorna solo sulle vittorie.
        const questUpdate = applyQuestProgressAndProfile(state, profile, combatLog, QUEST_EVENTS.BOSS_FIGHT_WIN, {});
        profile = questUpdate.profile;
        combatLog = questUpdate.combatLog;
        dailyPatrols = questUpdate.dailyPatrols;
      }

      return { ...state, profile, starLog, combatLog, dailyPatrols };
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
      const newRecords = action.payload.ids.map((id) => ({ id, unlockedAt: nowIso() }));
      const trophies = [...state.trophies, ...newRecords];
      let combatLog = state.combatLog;
      const defs = evaluateTrophies({ ...state, trophies });
      action.payload.ids.forEach((id) => {
        const def = defs.find((d) => d.id === id);
        combatLog = pushLog(combatLog, `Trofeo sbloccato: ${def ? def.nome : id}.`, 'TROPHY');
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

    default:
      return state;
  }
}

export function ArachnoForgeProvider({ children }) {
  // V26.0 — "The Nexus Gate" (Pillar 3: Cloud State Sync). ArachnoForgeProvider
  // viene montato SOLO quando esiste una sessione valida (vedi App.jsx),
  // quindi `user` qui è garantito non-nullo. Lo stato in memoria parte
  // sempre dallo schema di default (sincrono, come richiesto da useReducer):
  // il caricamento reale arriva subito dopo, in modo asincrono, dal boot
  // effect qui sotto, che sostituisce lo stato con HYDRATE non appena la
  // query Supabase risolve.
  const { user, signOut: authSignOut } = useAuthContext();
  const [state, dispatch] = useReducer(reducer, undefined, createDefaultState);
  const [sensoryZero, setSensoryZero] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [nowTick, setNowTick] = useState(0);

  // Cloud Sync status — micro-HUD (Pillar 4): 'loading' (boot iniziale,
  // blocca il render dei children), 'syncing' (upsert in corso),
  // 'synced' (tutto scritto), 'error' (fetch o upsert falliti).
  const [syncStatus, setSyncStatus] = useState('loading');
  const cloudReadyRef = useRef(false);
  const skipNextSaveRef = useRef(true);
  const saveTimeoutRef = useRef(null);

  const pushToast = useCallback((message, type = 'info') => {
    const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    setToasts((prev) => [...prev, { id, message, type }]);
    return id;
  }, []);

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Motore Audio Procedurale (Web Audio API, nessun asset esterno). Muto
  // forzatamente quando Sensory Zero è attivo, oltre al toggle manuale in
  // Core Config — coerente con la richiesta "isolamento sensoriale totale".
  const audio = useAudioEngine({ enabled: state.settings.soundEffects !== false && !sensoryZero });

  // Web-Click app-wide: un solo listener delegato a livello di documento,
  // invece di instrumentare manualmente ogni singolo pulsante di ogni
  // pagina. Suono deliberatamente cortissimo/discreto (~90ms, gain basso).
  useEffect(() => {
    const handleClick = (e) => {
      const btn = e.target.closest('button');
      if (!btn || btn.disabled) return;
      audio.playWebClick();
    };
    document.addEventListener('click', handleClick, true);
    return () => document.removeEventListener('click', handleClick, true);
  }, [audio]);

  // Sensory Web Audio Engine — Hover Blip: un solo listener delegato per
  // TUTTA l'app (stesso pattern del Web-Click) invece di instrumentare
  // manualmente ogni bottone. Riconosce i "bottoni principali" dalla loro
  // firma di classi Design System (font-bold + uppercase, esclusiva di
  // BTN_PRIMARY/SECONDARY/SUCCESS/AMBER — mai BTN_GHOST, deliberatamente
  // silenzioso per le azioni terziarie). `lastHoveredRef` evita di
  // ri-suonare più volte durante lo stesso hover continuo (solo un
  // pointerover per elemento, mai un blip per micro-movimento del mouse).
  const lastHoveredRef = useRef(null);
  useEffect(() => {
    const isPrimaryButton = (btn) => btn.classList.contains('font-bold') && btn.classList.contains('uppercase');
    const handlePointerOver = (e) => {
      const btn = e.target.closest('button');
      if (!btn || btn.disabled || !isPrimaryButton(btn)) {
        lastHoveredRef.current = null;
        return;
      }
      if (lastHoveredRef.current === btn) return;
      lastHoveredRef.current = btn;
      audio.playHoverBlip();
    };
    const handlePointerOut = (e) => {
      const btn = e.target.closest('button');
      if (btn && lastHoveredRef.current === btn) lastHoveredRef.current = null;
    };
    document.addEventListener('pointerover', handlePointerOver, true);
    document.addEventListener('pointerout', handlePointerOut, true);
    return () => {
      document.removeEventListener('pointerover', handlePointerOver, true);
      document.removeEventListener('pointerout', handlePointerOut, true);
    };
  }, [audio]);

  // "Il Cervello" del Tactical Timer, isolato in un custom hook dedicato
  // (Fase 2 — Custom Hooks & State Split). Comunica col reducer solo via
  // `dispatch`, che useReducer garantisce stabile fra i render.
  const timer = useFocusTimer({
    focusTime: state.settings.focusTime,
    shortBreakTime: state.settings.shortBreakTime,
    longBreakTime: state.settings.longBreakTime,
    dispatch,
    audio,
    pushToast
  });

  // V26.0 — Cloud State Sync (Pillar 3): boot fetch. Un'unica query alla
  // riga `user_data` dell'utente autenticato — se esiste già uno
  // `app_state`, sostituisce l'intero stato in memoria (K.A.R.E.N. Boot
  // Sequence: gli effetti già presenti più sotto — reset Stamina alle
  // 03:00, rigenerazione Daily Patrols — si auto-correggono da soli non
  // appena HYDRATE porta uno stato con timestamp "vecchi" rispetto ad
  // ORA, senza bisogno di logica di boot duplicata qui). Se la riga non
  // esiste ancora (nuovo utente), lo stato di default viene sia caricato
  // in memoria sia scritto immediatamente su Supabase con un INSERT, cosi'
  // che il prossimo autosave possa contare su una riga già presente
  // (upsert successivi diventano puri UPDATE).
  useEffect(() => {
    let cancelled = false;
    setSyncStatus('loading');
    (async () => {
      try {
        const { data, error } = await supabase
          .from(USER_DATA_TABLE)
          .select('app_state')
          .eq('user_id', user.id)
          .maybeSingle();
        if (cancelled) return;
        if (error) throw error;

        if (data && data.app_state) {
          dispatch({ type: 'HYDRATE', payload: hydrateState(data.app_state) });
        } else {
          const fresh = createDefaultState();
          const metaUsername = user.user_metadata && typeof user.user_metadata.username === 'string' ? user.user_metadata.username.trim() : '';
          if (metaUsername) fresh.profile.username = metaUsername;
          dispatch({ type: 'HYDRATE', payload: fresh });
          const { error: insertError } = await supabase.from(USER_DATA_TABLE).insert({ user_id: user.id, app_state: fresh });
          if (insertError) throw insertError;
        }

        if (cancelled) return;
        cloudReadyRef.current = true;
        skipNextSaveRef.current = true; // l'HYDRATE che sta per innescare l'effetto di save qui sotto non è una modifica reale dell'utente
        setSyncStatus('synced');
      } catch (err) {
        console.error('[ArachnoForge] Cloud boot fallito — impossibile leggere/creare user_data.', err);
        if (!cancelled) setSyncStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id]);

  // V26.0 — Cloud State Sync (Pillar 4): Debounced Auto-Save. Ogni
  // variazione di stato riavvia un timer di 2.5s; solo l'ULTIMA variazione
  // di una raffica sopravvive abbastanza da scatenare l'upsert reale —
  // esattamente come il pattern già in uso per il salvataggio dei
  // Blueprint in Armory.jsx, applicato qui all'intero stato dell'app.
  // `cloudReadyRef` blocca qualunque scrittura finché il boot fetch non è
  // completato (mai un upsert che sovrascrive dati cloud con lo stato
  // ancora "vuoto" di default in attesa dell'HYDRATE).
  useEffect(() => {
    if (!cloudReadyRef.current) return undefined;
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false;
      return undefined;
    }
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    setSyncStatus('syncing');
    saveTimeoutRef.current = setTimeout(async () => {
      try {
        const { error } = await supabase
          .from(USER_DATA_TABLE)
          .upsert({ user_id: user.id, app_state: state }, { onConflict: 'user_id' });
        if (error) throw error;
        setSyncStatus('synced');
      } catch (err) {
        console.error('[ArachnoForge] Cloud autosave fallito.', err);
        setSyncStatus('error');
      }
    }, 2500);
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, user.id]);

  // Snapshot sempre aggiornato dello stato, letto (mai come dipendenza) da
  // funzioni dentro `actions` che hanno bisogno del valore CORRENTE senza
  // costringere l'intero oggetto `actions` a essere ricreato ad ogni
  // variazione di stato (ne romperebbe la stabilità di riferimento,
  // consumata altrove in useCallback/useEffect di più pagine).
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Reset giornaliero automatico (Stamina + Daily Protocols) alle 03:00 AM.
  useEffect(() => {
    const check = () => {
      if (crossedThreeAM(state.profile.lastStaminaResetDate)) {
        dispatch({ type: 'RESET_STAMINA' });
      }
    };
    check();
    const id = setInterval(check, 60000);
    return () => clearInterval(id);
  }, [state.profile.lastStaminaResetDate]);

  // Heartbeat temporale: lo Spider-Sense Engine dipende dal giorno solare
  // corrente (nextReviewDate <= oggi), non solo dallo stato applicativo.
  // Senza questo tick, una sessione lasciata aperta a cavallo di
  // mezzanotte mostrerebbe conteggi "in sospeso" non aggiornati finché
  // l'utente non compie un'azione qualsiasi.
  useEffect(() => {
    const id = setInterval(() => setNowTick((n) => n + 1), 60000);
    return () => clearInterval(id);
  }, []);

  // The Achievement Engine (V23.0, Modulo 3) — hook dedicato che ascolta
  // in background lo stato globale e sblocca i trofei da solo, con
  // fanfare tier-aware. Sostituisce l'effetto inline che viveva qui prima.
  useAchievements({ state, dispatch, pushToast, audio });

  // "Il Cervello" della progressione (rank, XP bancato, toast di Level Up),
  // isolato in un custom hook dedicato.
  const progression = useProgression(state.profile, pushToast, audio);

  // V25.0 — Pillar 3: effetti aggregati dello Skill Tree, ricalcolati SOLO
  // quando la lista di abilità sbloccate cambia (mai ad ogni render/XP
  // gain) — consumati sia qui (derived, per la UI) sia dentro il reducer
  // (che li ricalcola autonomamente da state.profile.unlockedSkills, per
  // restare puro e non dipendere da valori esterni memoizzati).
  const skillEffects = useMemo(
    () => computeSkillEffects(state.profile.unlockedSkills),
    [state.profile.unlockedSkills]
  );

  // "Il Cervello" dello Spider-Sense Engine (Spaced Repetition), isolato in
  // un custom hook dedicato.
  const spiderSense = useSpiderSense(state.materie);

  // "Il Cervello" del K.A.R.E.N. Auto-Router / Quantum Router (V23.0,
  // Modulo 1): Daily Quota + status a 3 livelli per ogni Materia aperta,
  // isolato in un custom hook dedicato.
  const karenAutoRouter = useKarenAutoRouter(state.materie);

  // Karen's Tactical Suggestor (Primary Target): ricalcolato qui, a
  // livello di Provider, così sia Mission Control (Daily Patrol HUD) sia
  // il Web-Matrix possono leggerlo da `derived` senza calcolarlo due volte
  // con risultati potenzialmente disallineati.
  const primaryTarget = useMemo(() => computePrimaryTarget(state.materie), [state.materie]);

  // Daily Patrol Engine (V23.0, Modulo 2) — Rigenerazione giornaliera:
  // quando la dateKey persistita non corrisponde a "oggi" (primo avvio,
  // o giornata cambiata mentre l'app era chiusa/aperta a cavallo di
  // mezzanotte), genera un nuovo set di 3 missioni deterministico. Il
  // progresso da qui in poi è interamente event-driven (vedi reducer
  // sopra): questo effetto si occupa SOLO della rigenerazione giornaliera.
  useEffect(() => {
    const todayKey = getDateKey();
    if (!state.dailyPatrols || state.dailyPatrols.dateKey !== todayKey) {
      const quests = generateDailyQuests(todayKey, { upcomingReviewsCount: spiderSense.upcomingReviews.length });
      dispatch({ type: 'GENERATE_DAILY_PATROLS', payload: { dateKey: todayKey, quests } });
    }
  }, [state.dailyPatrols, spiderSense.upcomingReviews.length, dispatch]);

  // Daily Patrol Engine — Celebrazione: rileva le transizioni
  // isCompleted false -> true (edge-triggered, come i Trofei) per
  // scatenare la Toast + il suono di Quest Complete, e una "chicca"
  // narrativa extra quando TUTTE e 3 le missioni del giorno sono
  // completate nella stessa giornata ("Patrol Perfetta").
  const prevDailyQuestsRef = useRef(null);
  useEffect(() => {
    const quests = state.dailyPatrols?.quests;
    if (!Array.isArray(quests)) return;
    const prevQuests = prevDailyQuestsRef.current;

    quests.forEach((q) => {
      const prevQ = Array.isArray(prevQuests) ? prevQuests.find((p) => p.id === q.id) : null;
      if (q.isCompleted && (!prevQ || !prevQ.isCompleted)) {
        pushToast(`🏆 DAILY PATROL — ${q.title} completata! +${q.xpReward} XP`, 'success');
        audio.playQuestComplete();
      }
    });

    const allDoneNow = quests.length > 0 && quests.every((q) => q.isCompleted);
    const wasAllDoneBefore = Array.isArray(prevQuests) && prevQuests.length > 0 && prevQuests.every((q) => q.isCompleted);
    if (allDoneNow && !wasAllDoneBefore) {
      pushToast('Karen: Patrol perfetta. Prenditi un caffè, te lo sei guadagnato. ☕', 'success');
      audio.playLevelUpChime();
    }

    prevDailyQuestsRef.current = quests;
  }, [state.dailyPatrols, pushToast, audio]);

  const actions = useMemo(
    () => ({
      updateProfile: (patch) => dispatch({ type: 'UPDATE_PROFILE', payload: patch }),
      updateSettings: (patch) => dispatch({ type: 'UPDATE_SETTINGS', payload: patch }),
      addMateria: (payload) => dispatch({ type: 'ADD_MATERIA', payload }),
      updateMateria: (id, patch) => dispatch({ type: 'UPDATE_MATERIA', payload: { id, patch } }),
      deleteMateria: (id) => dispatch({ type: 'DELETE_MATERIA', payload: { id } }),
      addSfida: (materiaId, payload) => dispatch({ type: 'ADD_SFIDA', payload: { materiaId, ...payload } }),
      updateSfida: (materiaId, sfidaId, patch) => dispatch({ type: 'UPDATE_SFIDA', payload: { materiaId, sfidaId, patch } }),
      deleteSfida: (materiaId, sfidaId) => dispatch({ type: 'DELETE_SFIDA', payload: { materiaId, sfidaId } }),
      completeSfida: (materiaId, sfidaId) => {
        // Level Up Chime per i Nodi Padre ("Boss" dello Skill Tree, cioè
        // nodi che hanno almeno un sotto-argomento agganciato): un arpeggio
        // più ricco del Success Chime standard, coerente col peso di aver
        // appena sconfitto un intero "Boss" di argomenti collegati.
        const materia = findMateria(stateRef.current, materiaId);
        const isBossNode = !!materia && materia.sfide.some((s) => s.parentId === sfidaId);
        dispatch({ type: 'COMPLETE_SFIDA', payload: { materiaId, sfidaId } });
        if (isBossNode) audio.playLevelUpChime();
        else audio.playSuccessChime();
      },
      reviewSfida: (materiaId, sfidaId, rating) => {
        dispatch({ type: 'REVIEW_SFIDA', payload: { materiaId, sfidaId, rating } });
        audio.playSuccessChime();
      },
      applyQuickQuest: (questId) => dispatch({ type: 'APPLY_QUICK_QUEST', payload: { questId } }),
      addQuickQuest: (nome, staminaReward, xpReward) => dispatch({ type: 'ADD_QUICK_QUEST', payload: { nome, staminaReward, xpReward } }),
      deleteQuickQuest: (id) => dispatch({ type: 'DELETE_QUICK_QUEST', payload: { id } }),
      addShopReward: (nome, costoXp) => dispatch({ type: 'ADD_SHOP_REWARD', payload: { nome, costoXp } }),
      deleteShopReward: (id) => dispatch({ type: 'DELETE_SHOP_REWARD', payload: { id } }),
      redeemShopReward: (id, nome) => {
        dispatch({ type: 'REDEEM_SHOP_REWARD', payload: { id } });
        pushToast(`ACQUISTATO — ${nome}`, 'success');
      },
      consumeInventoryItem: (id) => dispatch({ type: 'CONSUME_INVENTORY_ITEM', payload: { id } }),
      unlockSkill: (skillId) => {
        const def = getSkillDef(skillId);
        const unlockedSkills = Array.isArray(stateRef.current.profile.unlockedSkills) ? stateRef.current.profile.unlockedSkills : [];
        if (!def || !canUnlockSkill(def, unlockedSkills, stateRef.current.profile.techTokens || 0)) return;
        dispatch({ type: 'UNLOCK_SKILL', payload: { skillId } });
        pushToast(`SKILL SBLOCCATA — ${def.title}`, 'success');
        audio.playSkillUnlock();
      },
      bossFightResult: (payload) => {
        dispatch({ type: 'BOSS_FIGHT_RESULT', payload });
        pushToast(payload.win ? 'SUPERCRIMINALE SCONFITTO — XP accreditati' : 'GAME OVER — nessun XP', payload.win ? 'success' : 'danger');
        if (payload.win) audio.playLevelUpChime();
      },
      lastStandSacrifice: () => {
        dispatch({ type: 'LAST_STAND_SACRIFICE' });
        pushToast('LAST STAND — sei sopravvissuto a 1 HP', 'danger');
      },
      logEvent: (message, tag) => dispatch({ type: 'LOG_EVENT', payload: { message, tag } }),
      importProfile: (rawObj) => {
        const validation = validateImportedProfile(rawObj);
        if (!validation.valid) return validation;
        const hydrated = hydrateState(rawObj);
        dispatch({ type: 'IMPORT_PROFILE', payload: hydrated });
        return { valid: true };
      },
      resetProfile: () => dispatch({ type: 'RESET_PROFILE' }),
      // V26.0 — Pillar 2: Logout dal Nexus Gate. Non serve pulire lo stato
      // qui: smontando ArachnoForgeProvider (App.jsx reagisce a
      // session === null) l'intero albero di stato in memoria sparisce da
      // solo, e i dati restano al sicuro su Supabase per il prossimo login.
      signOut: () => authSignOut()
    }),
    [pushToast, audio.playSuccessChime, audio.playLevelUpChime, audio.playSkillUnlock, authSignOut]
  );

  const derived = useMemo(() => {
    const fatigued = state.profile.stamina < FATIGUE_STAMINA_THRESHOLD;
    const upcomingExams = [...state.materie]
      .filter((m) => m.examDate)
      .sort((a, b) => a.examDate.localeCompare(b.examDate));
    const nextExam = upcomingExams[0] || null;

    let trajectory = 'GREEN';
    if (nextExam) {
      const totalNodes = nextExam.sfide.length;
      const completedNodes = nextExam.sfide.filter((s) => s.status === 'COMPLETED').length;
      const daysLeft = Math.max(0, daysUntilDateOnly(nextExam.examDate));
      const remainingNodes = totalNodes - completedNodes;
      if (totalNodes === 0) {
        trajectory = 'GREEN';
      } else if (daysLeft === 0 && remainingNodes > 0) {
        trajectory = 'RED';
      } else if (remainingNodes > 0) {
        const requiredPace = remainingNodes / Math.max(1, daysLeft);
        if (requiredPace > 1) trajectory = 'RED';
        else if (requiredPace > 0.5) trajectory = 'YELLOW';
        else trajectory = 'GREEN';
      }
    }

    const trophyList = evaluateTrophies(state).map((t) => {
      const record = state.trophies.find((r) => r.id === t.id);
      return { ...t, unlockedAt: record ? record.unlockedAt : null };
    });

    const todayKey = getDateKey();
    const todayMinutes = state.starLog
      .filter((e) => e.type === 'FOCUS_MINUTES' && e.dateKey === todayKey)
      .reduce((sum, e) => sum + e.minutes, 0);
    const burnoutRisk = todayMinutes > BURNOUT_MINUTES_THRESHOLD;

    return {
      fatigued,
      nextExam,
      trajectory,
      trophyList,
      todayMinutes,
      burnoutRisk,
      // Spider-Sense Engine — delegato a useSpiderSense.
      upcomingReviews: spiderSense.upcomingReviews,
      allTrackedReviews: spiderSense.allTrackedReviews,
      memoryRadar: spiderSense.memoryRadar,
      goblinMaterie: spiderSense.goblinMaterie,
      // Progressione — delegato a useProgression.
      totalBankedXp: progression.totalBankedXp,
      rankTitle: progression.rankTitle,
      rankMeta: progression.rankMeta,
      xpNeeded: progression.xpNeeded,
      xpPct: progression.xpPct,
      // V25.0 — Pillar 3: Tech Tokens & Skill Tree, esposti come `derived`
      // per la UI (Sidebar, Armory) senza ricalcoli duplicati altrove.
      skillEffects,
      effectiveBloodPactPenalty: computeBloodPactPenalty(skillEffects.bloodPactReduction),
      // K.A.R.E.N. Auto-Router (V20.0, Pillar 1) — Daily Quota per materia.
      karenQuotas: karenAutoRouter.quotas,
      karenQuotaByMateriaId: karenAutoRouter.byMateriaId,
      karenEventHorizonList: karenAutoRouter.eventHorizonList,
      // Karen's Tactical Suggestor — Primary Target (V18.0/V20.0).
      primaryTarget
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, nowTick, spiderSense, progression, karenAutoRouter, primaryTarget, skillEffects]);

  const value = useMemo(
    () => ({
      state,
      actions,
      timer,
      audio,
      sensoryZero,
      setSensoryZero,
      derived,
      toasts,
      pushToast,
      dismissToast,
      TIMER_STATUS,
      FOCUS_QUALITY,
      FOCUS_QUALITY_META,
      // V26.0 — Pillar 4: stato del Cloud Sync, letto dal micro-HUD in Sidebar.
      syncStatus
    }),
    [state, actions, timer, audio, sensoryZero, derived, toasts, pushToast, dismissToast, syncStatus]
  );

  // K.A.R.E.N. Boot Sequence: finché il fetch iniziale da Supabase non è
  // completato, nessuna pagina dell'app viene montata — evita sia il
  // flash dello stato di default (Livello 1, 0 XP) prima dell'HYDRATE
  // reale, sia qualunque azione utente che potrebbe scattare un autosave
  // prematuro con dati non ancora sincronizzati.
  if (syncStatus === 'loading') {
    return <BootScreen message="Sincronizzazione Web-Matrix in corso..." />;
  }

  return <ArachnoForgeContext.Provider value={value}>{children}</ArachnoForgeContext.Provider>;
}

export function useArachnoForge() {
  const ctx = useContext(ArachnoForgeContext);
  if (!ctx) throw new Error('useArachnoForge deve essere usato dentro <ArachnoForgeProvider>.');
  return ctx;
}
