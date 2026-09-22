/**
 * ArachnoForge — src/state/reducer.js (V37.0)
 * =====================================================================
 * IL REDUCER, ESTRATTO.
 *
 * Fino alla V36 queste ~1.000 righe vivevano dentro
 * `context/ArachnoForgeContext.jsx`, in mezzo a Provider, effetti e
 * azioni: un file da 1.919 righe in cui la macchina a stati — cioè il
 * posto dove nascono XP, streak, Stamina, Tech Token, scudi e quest —
 * era la parte più difficile da trovare e l'unica senza un solo test.
 *
 * Spostarla qui non cambia una riga di comportamento (è un taglio
 * meccanico, verificato dai test in reducer.test.js) ma la rende quello
 * che è sempre stata: una funzione PURA, con input e output espliciti,
 * testabile senza montare React.
 *
 * Regola che continua a valere: nessun side-effect qui dentro. Niente
 * rete, niente LocalStorage, niente audio, niente Math.random() — i tiri
 * casuali (Daily Web-Sling) avvengono nell'action creator e arrivano al
 * reducer come risultato già deciso.
 */
import { createDefaultState } from '../data/defaultSchema.js';
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
  FOCUS_QUALITY_META,
  DEFAULT_FOCUS_QUALITY,
  MAX_CARNAGE_MULTIPLIER,
  computeSpiderSenseSurgeXp
} from '../utils/xpEngine.js';
import { NODE_STATUS, PERSISTED_STATUS, deriveNodeStatus, orphanChildren, createSfida, markFirstCompletion } from '../utils/skillTree.js';
import { getSkillDef, canUnlockSkill, computeSkillEffects } from '../data/techTree.js';
import { scheduleNextReview, REVIEW_RATING } from '../utils/spiderSense.js';
import { isGoblinProtocol } from '../utils/materiaMeta.js';
import { WORK_MODE, applySintesiProgress, nodeSources, nodeNotes } from '../utils/sintesiEngine.js';
import { createSemestre, createLezione, normalizeCampus, esitoKey, ESITO_LEZIONE } from '../utils/campusEngine.js';
import { computeWeightedAverage, isGradedMateria } from '../utils/gpaEngine.js';
import { nowIso, getDateKey, isSameDay, daysBetween, currentMonthKey } from '../utils/dateUtils.js';
import { applyQuestEvent, QUEST_EVENTS } from '../utils/dailyPatrol.js';
import { isMaxCarnageActive, bumpCriticalActionStreak, deactivateMaxCarnage } from '../utils/maxCarnage.js';
import { canClaimWebSling, isHighTier } from '../utils/webSling.js';
import { computePrimaryTarget } from '../utils/karenSuggestor.js';
import { computeCalibration } from '../utils/calibration.js';
import { computeDailyPlan } from '../utils/quotaEngine.js';

/** Tetto del Combat Log: 50 voci, tagliate in testa. È il motivo per
 * cui nessun edge-trigger può basarsi sulla LUNGHEZZA dell'array — vedi
 * il fix dello Spider-Sense Surge in ArachnoForgeContext.jsx. */
export const MAX_COMBAT_LOG = 50;
/** Minuti di Focus in un giorno oltre i quali l'app segnala un rischio
 * di burnout invece di continuare a incoraggiare. */
export const BURNOUT_MINUTES_THRESHOLD = 300;

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

/**
 * V27.0 — Pillar 3 (Maximum Carnage Mode): punto unico da cui le tre
 * "azioni critiche" (Nodo Hard completato, Focus in Overdrive, vittoria
 * Boss Fight) alimentano lo streak verso lo sblocco. Isolato in un
 * helper condiviso per evitare di duplicare tre volte la stessa logica
 * di attivazione/log nei rispettivi case del reducer.
 */
function applyCriticalAction(profile, combatLog, isCriticalAction) {
  if (!isCriticalAction) return { profile, combatLog };
  const { justActivated, ...patch } = bumpCriticalActionStreak(profile, 1);
  let nextProfile = { ...profile, ...patch };
  if (!justActivated) return { profile: nextProfile, combatLog };
  // V31.3 — Suit Unlock Gating: il primo trigger di Maximum Carnage sblocca
  // per sempre la Symbiote Suit (flag one-way, mai revocato — coerente col
  // resto dei traguardi "a vita" dell'app, es. Tech Tokens/Trofei).
  let nextLog = combatLog;
  if (!nextProfile.symbioteSuitUnlocked) {
    nextProfile = { ...nextProfile, symbioteSuitUnlocked: true };
    nextLog = pushLog(nextLog, 'Symbiote Suit sbloccata — disponibile in Karen OS Settings.', 'CARNAGE');
  }
  nextLog = pushLog(
    nextLog,
    'MAXIMUM CARNAGE MODE ATTIVATA — Il simbionte prende il sopravvento per le prossime 2 ore. XP raddoppiati, Stamina illimitata.',
    'CARNAGE'
  );
  return { profile: nextProfile, combatLog: nextLog };
}

/**
 * V35.0 — Ribilanciamento Economico: Tech Token legati anche alla
 * COSTANZA (giorni di streak consecutivi), non solo al level-up grezzo
 * (vedi applyXpDeltaWithTokens in xpEngine.js). Bonus one-shot LIFETIME
 * per soglia (mai retroattivo, mai ripetuto — stesso idioma "flag
 * one-way" già usato per Symbiote Suit in applyCriticalAction): un
 * Cadetto che interrompe e ricomincia la streak non può "grindare" lo
 * stesso traguardo più volte.
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
  const nextLog = pushLog(
    combatLog,
    `Costanza Premiata — ${nextMilestone} giorni di streak consecutivi: +1 Tech Token bonus.`,
    'SYSTEM'
  );
  return { profile: nextProfile, combatLog: nextLog };
}

// V35.5 — Streak Shield ("Scudo Streak", stile Duolingo): cap
// sull'accumulo — stesso valore del limite Duolingo storico (max 2 scudi
// contemporaneamente), scelto apposta per restare un salvagente per le
// emergenze occasionali, mai un "jolly" illimitato che azzera il valore
// della streak stessa.
export const STREAK_SHIELD_CAP = 2;

/**
 * Assegna automaticamente 1 Streak Shield ad ogni nuovo mese solare
 * (edge-trigger su `currentMonthKey()`, stesso idioma di
 * `applyStreakTokenMilestone` — un flag "ultima chiave già premiata", mai
 * un doppio assegno nello stesso mese). Nessuna attivazione manuale:
 * protegge fin dal primo giorno del mese, silenziosamente, finché non
 * raggiunge il cap.
 */
function grantMonthlyStreakShield(profile, combatLog) {
  const monthKey = currentMonthKey();
  if (profile.lastStreakShieldGrantMonthKey === monthKey) return { profile, combatLog };
  const current = Number.isFinite(profile.streakShields) ? profile.streakShields : 0;
  if (current >= STREAK_SHIELD_CAP) {
    // Il mese è comunque "consumato" ai fini del trigger, anche se il
    // cassetto è già pieno: evita di ricontrollare (e ri-loggare "pieno")
    // ad ogni singola attività per il resto del mese.
    return { profile: { ...profile, lastStreakShieldGrantMonthKey: monthKey }, combatLog };
  }
  const nextProfile = {
    ...profile,
    streakShields: current + 1,
    lastStreakShieldGrantMonthKey: monthKey
  };
  const nextLog = pushLog(
    combatLog,
    `K.A.R.E.N. — Nuovo Streak Shield assegnato (${current + 1}/${STREAK_SHIELD_CAP}): copre automaticamente un giorno saltato senza spezzare la streak.`,
    'SYSTEM'
  );
  return { profile: nextProfile, combatLog: nextLog };
}

function updateStreakOnActivity(profile, combatLog) {
  const now = nowIso();
  if (isSameDay(profile.lastActiveDate, now)) return { profile, combatLog };
  const gap = daysBetween(profile.lastActiveDate, now);

  let bumped;
  let nextLog = combatLog;

  // V37.0 — due casi che prima finivano entrambi nel ramo "reset a 1":
  //  - `gap` nullo: data precedente illeggibile (import manuale, campo
  //    corrotto). Non è colpa del Cadetto: si riallinea la data senza
  //    toccare la streak.
  //  - `gap` negativo: l'orologio del dispositivo è andato indietro (fuso
  //    cambiato, ora legale, data sistemata a mano). Azzerare una streak
  //    di 40 giorni per un orologio sbagliato sarebbe la peggior
  //    punizione possibile, e non recuperabile.
  if (gap == null || gap <= 0) {
    bumped = { ...profile, lastActiveDate: now };
  } else if (gap === 1) {
    bumped = { ...profile, streak: profile.streak + 1, lastActiveDate: now };
  } else {
    // V35.5 — Streak Shield: `gap - 1` giorni di calendario sono stati
    // saltati del tutto. Se il Cadetto ha abbastanza scudi in cassa per
    // coprirli TUTTI, la streak resta esattamente dov'era (mai un
    // incremento indebito, mai un reset) e gli scudi usati vengono
    // scalati; altrimenti (copertura solo parziale o nulla) si applica il
    // normale reset a 1 — nessuna protezione "a metà" che complicherebbe
    // silenziosamente la lettura del numero mostrato in Sidebar.
    const skippedDays = Math.max(0, gap - 1);
    const availableShields = Number.isFinite(profile.streakShields) ? profile.streakShields : 0;
    if (skippedDays > 0 && availableShields >= skippedDays) {
      bumped = {
        ...profile,
        streakShields: availableShields - skippedDays,
        streakShieldsUsedTotal: (Number.isFinite(profile.streakShieldsUsedTotal) ? profile.streakShieldsUsedTotal : 0) + skippedDays,
        lastActiveDate: now
      };
      nextLog = pushLog(
        nextLog,
        `K.A.R.E.N. — Streak Shield attivato: ${skippedDays} giorno/i saltato/i coperto/i, streak preservata a ${profile.streak}.`,
        'SYSTEM'
      );
    } else {
      bumped = { ...profile, streak: 1, lastActiveDate: now };
    }
  }

  const shieldGrant = grantMonthlyStreakShield(bumped, nextLog);
  return applyStreakTokenMilestone(shieldGrant.profile, shieldGrant.combatLog);
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

export function reducer(state, action) {
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
        // V37.0 — data reale di verbalizzazione, usata dallo storico
        // della media e dalla stima del tempo di laurea.
        examPassedDate: action.payload.examPassedDate || null,
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

    case 'UPDATE_MATERIA': {
      const prevMateria = findMateria(state, action.payload.id);
      const wasGraded = isGradedMateria(prevMateria);
      const wasPassed = !!prevMateria?.examPassed;

      let nextMaterie = state.materie.map((m) => (m.id === action.payload.id ? { ...m, ...action.payload.patch } : m));
      let updatedMateria = nextMaterie.find((m) => m.id === action.payload.id);
      let extraLog = null;

      // V37.0 — "Esame superato" chiude davvero la Materia.
      // Prima il flag era puramente contabile: i nodi restavano aperti,
      // quindi la materia continuava a pesare sul monte ore del piano e
      // i suoi nodi tornavano a scadere nello Spider-Sense per ripassi
      // di un esame già verbalizzato. Alla transizione NON superato ->
      // superato tutti i nodi passano a COMPLETED e la loro curva SRS
      // viene chiusa (`nextReviewDate: null`), così spariscono da
      // entrambi i motori. È una transizione a senso unico: togliere la
      // spunta NON riapre i nodi, perché non sapremmo quali erano
      // davvero incompleti — restano completati e si riaprono a mano.
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
                // V39.0 — chiuso dal verbale, non studiato in app: la
                // calibrazione (fattore, ritmo, resa) NON deve usarlo come
                // campione, o poche ore tracciate su un nodo mai studiato
                // farebbero crollare ogni stima futura.
                chiusoDaVerbale: true
              }
        );
        updatedMateria = { ...updatedMateria, sfide: closedSfide };
        nextMaterie = nextMaterie.map((m) => (m.id === updatedMateria.id ? updatedMateria : m));
        extraLog =
          daChiudere > 0
            ? `Esame superato: ${updatedMateria.nome}. ${daChiudere} nodo/i chiusi automaticamente e rimossi da piano di studio e Spider-Sense.`
            : `Esame superato: ${updatedMateria.nome}. Materia archiviata: non pesa più sul piano di studio.`;
      }

      const isNowGraded = isGradedMateria(updatedMateria);
      // V32.0 — Storico Media Ponderata: registra un punto SOLO alla
      // transizione "non ancora votata -> votata" (mai su ogni singola
      // modifica della Materia, altrimenti correggere un voto già
      // registrato o toccare altri campi gonfierebbe lo storico con punti
      // ridondanti/fuorvianti).
      // V37.0 — il punto dello storico porta la data REALE di
      // verbalizzazione (`examPassedDate`), non il giorno in cui hai
      // spuntato la casella. Registrare un esame di due mesi fa
      // schiacciava tutti i punti sulla data di inserimento e rendeva il
      // grafico della media una scalinata senza alcun rapporto col
      // tempo. Il fallback a oggi resta per chi non indica la data.
      // Le voci vengono riordinate: inserendo esami vecchi in ritardo,
      // un ledger puramente append-only produrrebbe una linea che torna
      // indietro nel tempo.
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
          // sul nodo (più pagine snellite, sintesi chiusa, più pagine dei
          // tuoi appunti) lascia un segno temporale: la coda delle
          // lezioni da sistemare lo usa per capire che la lezione di oggi
          // è già stata sistemata, anche senza una sessione col timer.
          return sintesiAvanzata(s, next) ? { ...next, sintesiAggiornataAt: nowIso() } : next;
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

    case 'COMPLETE_SFIDA': {
      const { materiaId, sfidaId } = action.payload;
      const materia = findMateria(state, materiaId);
      if (!materia) return state;
      const target = materia.sfide.find((s) => s.id === sfidaId);
      if (!target) return state;
      const displayStatus = deriveNodeStatus(target, materia.sfide);
      // V35.5 — "In Corso": un nodo con Focus già investito (IN_PROGRESS)
      // deve restare completabile esattamente come uno AVAILABLE — SENZA
      // questa aggiunta un nodo su cui l'utente ha già studiato non
      // potrebbe più essere chiuso (regressione severa: la Blindatura
      // anti-doppio-click bloccherebbe anche il primo click legittimo).
      if (displayStatus !== NODE_STATUS.AVAILABLE && displayStatus !== NODE_STATUS.IN_PROGRESS) return state; // Blindatura: doppio click non ridà XP.
      const isFatigued = state.profile.stamina < FATIGUE_STAMINA_THRESHOLD;
      const isHard = target.difficulty === DIFFICULTY.HARD;
      const skillEffects = computeSkillEffects(state.profile.unlockedSkills);
      const isMaxCarnage = isMaxCarnageActive(state.profile);

      const xpGain = computeFocusXp({
        focusMinutes: state.settings.focusTime,
        cfu: materia.cfu,
        isOverdrive: false,
        isFatigued,
        difficulty: target.difficulty,
        streak: state.profile.streak,
        xpBonusPct: skillEffects.xpBonusPct,
        streakThresholdBonus: skillEffects.streakThresholdBonus,
        isMaxCarnage
      });

      // V36.0 — la data d'esame entra nella schedulazione: nessun primo
      // ripasso oltre l'esame (vedi capIntervalToExam in spiderSense.js).
      const completedSfide = materia.sfide.map((s) => (s.id === sfidaId ? markFirstCompletion(s, materia.examDate) : s));
      const firstReviewDate = completedSfide.find((s) => s.id === sfidaId)?.nextReviewDate;

      let profile = applyXpDeltaWithTokens(state.profile, xpGain);
      profile = { ...profile, hardNodesCompleted: profile.hardNodesCompleted + (isHard ? 1 : 0) };

      let combatLog = pushLog(
        state.combatLog,
        `Nodo "${target.nome}" completato in ${materia.nome}. +${xpGain} XP${isMaxCarnage ? ' [MAXIMUM CARNAGE x2]' : ''}. Primo Spider-Sense il ${firstReviewDate}.`,
        'SUCCESS'
      );

      {
        const streakUpdate = updateStreakOnActivity(profile, combatLog);
        profile = streakUpdate.profile;
        combatLog = streakUpdate.combatLog;
      }

      // Maximum Carnage Mode (V27.0, Pillar 3): un Nodo Hard completato è
      // un'"azione critica" — alimenta lo streak verso il prossimo sblocco.
      const carnageUpdate = applyCriticalAction(profile, combatLog, isHard);
      profile = carnageUpdate.profile;
      combatLog = carnageUpdate.combatLog;

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

    // V34.4 — "Riporta a da completare": undo di un COMPLETE_SFIDA per
    // errori di click. Riporta il nodo a PERSISTED_STATUS.PENDING (torna
    // così AVAILABLE/LOCKED secondo deriveNodeStatus, in base ai suoi
    // figli) SENZA ritirare XP/Tech Token/streak/Daily Patrol già
    // assegnati: replicare esattamente l'inverso di applyXpDeltaWithTokens,
    // updateStreakOnActivity, applyCriticalAction e
    // applyQuestProgressAndProfile richiederebbe di ricostruire uno stato
    // "prima" che l'app non persiste — un tentativo approssimato
    // rischierebbe di produrre XP negativa, streak incoerenti o Daily
    // Patrol/Trofei "ritirati" a metà. Coerente col resto dell'app (i
    // ripassi via Spider-Sense funzionano allo stesso modo: registrano
    // nuovi eventi, non riscrivono la storia).
    case 'REOPEN_SFIDA': {
      const { materiaId, sfidaId } = action.payload;
      const materia = findMateria(state, materiaId);
      if (!materia) return state;
      const target = materia.sfide.find((s) => s.id === sfidaId);
      if (!target) return state;
      // Blindatura: si può riaprire solo un nodo davvero COMPLETED
      // (persistito) — no-op su un nodo già PENDING.
      if (target.status !== PERSISTED_STATUS.COMPLETED) return state;

      const reopenedSfide = materia.sfide.map((s) =>
        s.id === sfidaId
          ? {
              ...s,
              status: PERSISTED_STATUS.PENDING,
              completionTimestamp: null,
              nextReviewDate: null,
              lastReviewRating: null,
              // V36.0 — la curva SRS riparte da zero (nessun ripasso
              // pendente su un nodo riaperto) ma l'ease appreso resta:
              // quanto QUEL contenuto ti è facile non cambia perché hai
              // annullato un click.
              srsIntervalDays: 0
            }
          : s
      );

      return {
        ...updateMateriaSfide(state, materiaId, () => reopenedSfide),
        combatLog: pushLog(
          state.combatLog,
          `Nodo "${target.nome}" riportato a "da completare" in ${materia.nome}. XP e progressi già assegnati non vengono ritirati.`,
          'HUB'
        )
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

      // V36.0 — SM-2 lite: l'intervallo non è più una costante per
      // giudizio (4/2/1 giorni a vita) ma cresce moltiplicativamente
      // sull'ease personale del nodo, e non supera mai la data d'esame.
      const { nextReviewDate, srsEase, srsIntervalDays } = scheduleNextReview(target, rating, materia.examDate);
      // V31.3 — Bounty Board (Friction Analytics): un giudizio "Difficile"
      // conta come tentativo fallito (segnale di attrito reale sul nodo),
      // "Facile"/"Medio" come tentativo riuscito — alimenta isBountyTarget
      // in utils/friction.js senza toccarne la formula.
      const reviewedSfide = materia.sfide.map((s) =>
        s.id === sfidaId
          ? {
              ...s,
              nextReviewDate,
              srsEase,
              srsIntervalDays,
              lastReviewRating: rating,
              reviewCount: (s.reviewCount || 0) + 1,
              tentativiSuccessi: (s.tentativiSuccessi || 0) + (rating === REVIEW_RATING.HARD ? 0 : 1),
              tentativiFalliti: (s.tentativiFalliti || 0) + (rating === REVIEW_RATING.HARD ? 1 : 0)
            }
          : s
      );

      const skillEffects = computeSkillEffects(state.profile.unlockedSkills);
      const reviewXp = computeReviewXp(skillEffects.reviewXpBonus);

      let profile = applyXpDeltaWithTokens(state.profile, reviewXp);
      profile = { ...profile, reviewsCompleted: (profile.reviewsCompleted || 0) + 1 };

      let combatLog = pushLog(
        state.combatLog,
        wasDue
          ? `Spider-Sense placato su "${target.nome}": prossimo ripasso fra ${srsIntervalDays}gg (${nextReviewDate}). +${reviewXp} XP.`
          : `Ripasso Manuale forzato su "${target.nome}": prossimo ripasso fra ${srsIntervalDays}gg (${nextReviewDate}). +${reviewXp} XP.`,
        'SUCCESS'
      );

      {
        const streakUpdate = updateStreakOnActivity(profile, combatLog);
        profile = streakUpdate.profile;
        combatLog = streakUpdate.combatLog;
      }

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
      // V38.0 — "La Forgia degli Appunti": una sessione non è più solo
      // tempo. Se è stata una sessione di SINTESI porta con sé quante
      // pagine di fonte hai snellito e quante pagine dei tuoi appunti ne
      // sono uscite, e quei due numeri sono l'unico modo in cui il piano
      // di una materia può avanzare mentre il semestre va avanti: senza
      // di loro l'app saprebbe quanto hai studiato ma non quanto
      // materiale hai costruito, cioè proprio la metà del lavoro che
      // questa versione esiste per misurare.
      //
      // Entrambi i numeri sono FACOLTATIVI. Saltare il campo non rompe
      // niente: si registra solo il tempo, come prima.
      // Il modo può anche NON essere dichiarato: succede quando la
      // sessione viene recuperata automaticamente al boot dopo una
      // chiusura imprevista (vedi useFocusTimer.js), dove nessuno ha
      // risposto al Debriefing. In quel caso i minuti entrano nel
      // totale — che alimenta XP, streak e bias come sempre — ma NON in
      // uno dei due contatori separati: attribuirli d'ufficio allo
      // studio inquinerebbe il ritmo misurato con ore che potevano
      // benissimo essere di sintesi.
      const workModeDichiarato =
        action.payload.workMode === WORK_MODE.SINTESI || action.payload.workMode === WORK_MODE.STUDIO
          ? action.payload.workMode
          : null;
      let pagineFonte = Math.max(0, Math.round(Number(action.payload.pagineFonte) || 0));
      const pagineAppuntiProdotte = Math.max(0, Math.round(Number(action.payload.pagineAppuntiProdotte) || 0));

      const materia = materiaId ? findMateria(state, materiaId) : null;
      const targetNode = materia && sfidaId ? materia.sfide.find((s) => s.id === sfidaId) : null;

      // V40.2 — pagine snellite FONTE PER FONTE (Debriefing): ogni numero
      // va sulla sua fonte, mai oltre le pagine che le restano. Il totale
      // registrato è quello davvero applicato. Senza questo dettaglio si
      // ripiega sul totale unico, distribuito in ordine come prima.
      let fontiPerFonte = null;
      const perFonte = action.payload.pagineFontePer;
      if (workModeDichiarato === WORK_MODE.SINTESI && targetNode && perFonte && typeof perFonte === 'object') {
        let applicate = 0;
        fontiPerFonte = (Array.isArray(targetNode.fonti) ? targetNode.fonti : []).map((f) => {
          const richieste = Math.max(0, Math.round(Number(perFonte[f?.id]) || 0));
          if (!f || richieste <= 0) return f;
          const totali = Math.max(0, Math.round(Number(f.pagine) || 0));
          const fatte = Math.min(totali, Math.max(0, Math.round(Number(f.pagineFatte) || 0)));
          const quota = Math.min(richieste, totali - fatte);
          if (quota <= 0) return f;
          applicate += quota;
          return { ...f, pagineFatte: fatte + quota };
        });
        pagineFonte = applicate;
      }
      const difficulty = targetNode ? targetNode.difficulty : DIFFICULTY.MEDIUM;
      const isFatigued = state.profile.stamina < FATIGUE_STAMINA_THRESHOLD;
      const sessionHour = new Date().getHours();
      const skillEffects = computeSkillEffects(state.profile.unlockedSkills);
      // "Simbiosi Notturna" (Skill Tree): +10% XP solo se l'abilità è
      // sbloccata E la sessione è realmente notturna (00:00-04:00) — mai
      // un bonus fantasma fuori dalla finestra oraria dichiarata.
      const nightBonus = skillEffects.nightBonusEnabled && sessionHour >= 0 && sessionHour < 4;
      const isMaxCarnage = isMaxCarnageActive(state.profile);

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
        streakThresholdBonus: skillEffects.streakThresholdBonus,
        isMaxCarnage
      });
      const staminaCost = computeFocusStaminaCost(focusMinutes, difficulty, skillEffects.staminaCostMultiplier, isMaxCarnage);
      // V31.3 — Spider-Sense Surge XP calcolato QUI (anziché più sotto),
      // così può essere allegato come campo dedicato `surgeXp` sulla stessa
      // voce FOCUS_SESSION dello Star Log invece di restare impastato nel
      // totale XP della sessione — StarLog.jsx può cosi' mostrarlo come
      // riga a sé stante nelle statistiche storiche. Zero voci aggiuntive
      // in starLog (nessun impatto sulla crescita dell'array).
      const spiderSenseBonus = materia ? computeSpiderSenseSurgeXp(materia.perceivedDifficulty) : 0;

      let profile = applyXpDeltaWithTokens(state.profile, xpGain);
      profile = {
        ...profile,
        stamina: Math.max(0, profile.stamina - staminaCost),
        overdriveCount: profile.overdriveCount + (wasOverdrive ? 1 : 0)
      };

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
        // V31.3 — Spider-Sense Surge scorporato come campo dedicato (0
        // quando la sessione non è agganciata a una Materia), cosi' resta
        // visibile nella cronologia invece di sparire dentro `xp`.
        surgeXp: spiderSenseBonus,
        hour: new Date().getHours(),
        timestamp: nowIso(),
        quality,
        // V20.0 — Daily Patrol (Pillar 5): la quest "Primary Target" deve
        // verificare che la sessione di oggi sia stata fatta PROPRIO
        // sull'esame suggerito da Karen, quindi il materiaId va tracciato
        // anche quando è null (Focus generico, nessuna materia collegata).
        materiaId: materiaId || null,
        // V38.0 — in che modo è stata spesa questa sessione, e quanto
        // materiale ne è uscito. Due campi su una voce che già esiste:
        // nessuna riga nuova nello Star Log, che è l'array che cresce.
        workMode: workModeDichiarato,
        pagineFonte: workModeDichiarato === WORK_MODE.SINTESI ? pagineFonte : 0,
        pagineAppuntiProdotte: workModeDichiarato === WORK_MODE.SINTESI ? pagineAppuntiProdotte : 0
      });

      let nextState = { ...state, profile, starLog };
      if (materia && targetNode) {
        nextState = updateMateriaSfide(nextState, materiaId, (sfide) =>
          sfide.map((s) => {
            if (s.id !== sfidaId) return s;
            const aggiornato = {
              ...s,
              focusMinutes: s.focusMinutes + focusMinutes,
              // I due contatori separati alimentano i due ritmi misurati
              // (vedi utils/sintesiEngine.js e utils/calibration.js):
              // mescolarli darebbe due velocità entrambe sbagliate.
              focusMinutesSintesi:
                (Number(s.focusMinutesSintesi) || 0) +
                (workModeDichiarato === WORK_MODE.SINTESI ? focusMinutes : 0),
              focusMinutesStudio:
                (Number(s.focusMinutesStudio) || 0) + (workModeDichiarato === WORK_MODE.STUDIO ? focusMinutes : 0)
            };
            if (workModeDichiarato !== WORK_MODE.SINTESI) return aggiornato;
            const avanzata = pagineFonte > 0 || pagineAppuntiProdotte > 0;
            return {
              ...aggiornato,
              fonti: fontiPerFonte || applySintesiProgress(aggiornato.fonti, pagineFonte),
              pagineAppunti: (Number(aggiornato.pagineAppunti) || 0) + pagineAppuntiProdotte,
              // Stessa marca del salvataggio a mano (UPDATE_SFIDA): la
              // sintesi di questo nodo è avanzata adesso.
              ...(avanzata ? { sintesiAggiornataAt: nowIso() } : {})
            };
          })
        );
      }

      let combatLog = pushLog(
        nextState.combatLog,
        `Sessione Focus completata${wasOverdrive ? ' [OVERDRIVE]' : ''}${isMaxCarnage ? ' [MAXIMUM CARNAGE x2]' : ''}${targetNode ? ` su "${targetNode.nome}"` : ''} — Debriefing: ${qualityMeta.label} (${qualityMeta.badge}). +${xpGain} XP, -${staminaCost} Stamina (${focusMinutes} min).`,
        wasOverdrive ? 'OVERDRIVE' : 'FOCUS'
      );

      // V38.0 — la riga che racconta il lavoro di costruzione. Vale la
      // pena di esistere perché è l'unico avanzamento che, guardando i
      // soli minuti, non si vedrebbe: due ore di sintesi e due ore di
      // studio sono identiche nel Combat Log della V37, e non lo sono
      // affatto nel semestre.
      if (workModeDichiarato === WORK_MODE.SINTESI && targetNode && (pagineFonte > 0 || pagineAppuntiProdotte > 0)) {
        const pezzi = [];
        if (pagineFonte > 0) pezzi.push(`${pagineFonte} pagine di fonte snellite`);
        if (pagineAppuntiProdotte > 0) pezzi.push(`+${pagineAppuntiProdotte} pagine dei tuoi appunti`);
        combatLog = pushLog(
          combatLog,
          `Forgia degli Appunti — "${targetNode.nome}": ${pezzi.join(', ')}.`,
          'SYSTEM'
        );
      }

      // V35.0 — "Sessione Blindata": una FOCUS_COMPLETED originata da un
      // recupero automatico (checkpoint orfano ritrovato al boot, vedi
      // useFocusTimer.js) riceve una riga di log distinta — stessa,
      // identica pipeline XP/Stamina/StarLog di qualunque altra sessione,
      // mai un trattamento numerico speciale.
      if (action.payload.recovered) {
        combatLog = pushLog(
          combatLog,
          'K.A.R.E.N. — Sessione Focus recuperata automaticamente dopo una chiusura imprevista (tab chiusa/crash prima del Tactical Debriefing).',
          'SYSTEM'
        );
      }

      {
        const streakUpdate = updateStreakOnActivity(profile, combatLog);
        profile = streakUpdate.profile;
        combatLog = streakUpdate.combatLog;
        nextState = { ...nextState, profile };
      }

      // Maximum Carnage Mode (V27.0, Pillar 3): una sessione conclusa in
      // Overdrive è un'"azione critica" — alimenta lo streak verso il
      // prossimo sblocco della modalità.
      {
        const carnageUpdate = applyCriticalAction(profile, combatLog, wasOverdrive);
        profile = carnageUpdate.profile;
        combatLog = carnageUpdate.combatLog;
        nextState = { ...nextState, profile };
      }

      // V28.1 — Pillar 3 (Spider-Sense Focus Surge): premia una sessione di
      // Focus completata PULITA su una Materia universitaria. "Pulita" è
      // garantito per costruzione — un'interruzione (Blood Pact) azzera
      // `pendingFocus` PRIMA che questa azione possa mai essere
      // dispatchata (vedi interruptFocus in useFocusTimer.js), quindi il
      // solo fatto di essere qui dentro implica zero interruzioni sull'intera
      // catena Focus/Overdrive. Bonus proporzionale alla Difficoltà
      // Percepita della Materia (1-5, Web-Path Planner) — mai al singolo
      // nodo, coerente con "difficoltà della materia" richiesta.
      if (materia) {
        profile = applyXpDeltaWithTokens(profile, spiderSenseBonus);
        combatLog = pushLog(
          combatLog,
          `Spider-Sense Surge — sessione pulita su "${materia.nome}" senza interruzioni. Bonus +${spiderSenseBonus} XP (difficoltà ${Number.isFinite(materia.perceivedDifficulty) ? materia.perceivedDifficulty : 3}/5).`,
          'SPIDERSENSE'
        );
        nextState = { ...nextState, profile };
      }

      // Daily Patrol Engine: Focus Strike, Primary Target, Early Bird,
      // Night Owl, Flow Seeker e Overdrive Master si aggiornano TUTTI da
      // questo singolo evento — auto-tracking reale, nessun ricalcolo a
      // parte lato UI. Il Primary Target va ricalcolato qui (stesso
      // algoritmo di karenSuggestor.js) perché il reducer non ha accesso
      // al valore già memoizzato a livello di Provider.
      // V39.0 — stesso motore, stessi input della UI: calibrazione
      // personale e prima materia in focus del planner. Prima qui si
      // chiamava computePrimaryTarget SENZA calibrazione, e la missione
      // poteva verificare una materia diversa da quella mostrata.
      const calNow = computeCalibration(state);
      const planNow = computeDailyPlan(state.materie, { calibration: calNow });
      const primaryTargetNow = computePrimaryTarget(
        state.materie,
        calNow,
        planNow.dailyFocusQuotas[0]?.materiaId ?? null
      );
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
      const isMaxCarnage = isMaxCarnageActive(state.profile);
      let xpGain = win
        ? Math.round(500 * (0.5 + hpRemaining / 200) * computeStreakMultiplier(state.profile.streak, skillEffects.streakThresholdBonus))
        : 0;
      if (win && isMaxCarnage) xpGain = Math.round(xpGain * MAX_CARNAGE_MULTIPLIER);
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
          ? `Supercriminale sconfitto (${hpRemaining} HP residui). +${xpGain} XP${isMaxCarnage ? ' [MAXIMUM CARNAGE x2]' : ''}.`
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

        // Maximum Carnage Mode (V27.0, Pillar 3): una vittoria in Boss
        // Fight è un'"azione critica" — alimenta lo streak verso il
        // prossimo sblocco della modalità.
        const carnageUpdate = applyCriticalAction(profile, combatLog, true);
        profile = carnageUpdate.profile;
        combatLog = carnageUpdate.combatLog;
      }

      return { ...state, profile, starLog, combatLog, dailyPatrols };
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
    // della finestra Maximum Carnage — dispatchata dall'effetto dedicato
    // nel Provider non appena `isMaxCarnageActive` torna false.
    case 'DEACTIVATE_MAX_CARNAGE':
      return {
        ...state,
        profile: { ...state.profile, ...deactivateMaxCarnage() },
        combatLog: pushLog(state.combatLog, 'Maximum Carnage Mode esaurita. Il simbionte si ritira, in attesa della prossima furia.', 'CARNAGE')
      };

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
