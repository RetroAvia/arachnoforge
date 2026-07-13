import { isReviewDue } from '../utils/spiderSense.js';
import { computeWeightedAverage, computeGraduationProjection } from '../utils/gpaEngine.js';
import { VANVITELLI_COURSES } from './vanvitelliCourseMap.js';

/**
 * Definizioni statiche dei trofei (Trophy Room) — Spider-Verse Tier System.
 * NEIGHBORHOOD: i primi passi da Ragno di quartiere (Bronzo/Grigio).
 * AVENGER: costanza e padronanza, il salto di qualità (Argento/Blu).
 * MULTIVERSE: le imprese più rare del Ragno-Verso, quasi tutte segrete
 * (descrizione oscurata finché non sbloccate) — Oro/Rosso acceso.
 * `id` è stabile e usato come chiave di persistenza in `state.trophies`.
 */
export const TIER = {
  NEIGHBORHOOD: 'NEIGHBORHOOD',
  AVENGER: 'AVENGER',
  MULTIVERSE: 'MULTIVERSE'
};

export const TIER_META = {
  NEIGHBORHOOD: {
    label: 'Neighborhood',
    color: 'text-zinc-400',
    border: 'border-zinc-400/50',
    bg: 'bg-zinc-400/10',
    glow: 'shadow-[0_0_10px_rgba(161,161,170,0.35)]'
  },
  AVENGER: {
    label: 'Avenger',
    color: 'text-af-refuel',
    border: 'border-af-refuel/50',
    bg: 'bg-af-refuel/10',
    glow: 'shadow-[0_0_12px_rgba(29,131,240,0.4)]'
  },
  MULTIVERSE: {
    label: 'Multiverse',
    color: 'text-af-attack',
    border: 'border-af-attack/60',
    bg: 'bg-af-attack/10',
    glow: 'shadow-[0_0_16px_rgba(226,54,54,0.5),0_0_10px_rgba(251,191,36,0.3)]'
  }
};

function totalCompletedNodes(state) {
  return state.materie.reduce((sum, m) => sum + m.sfide.filter((s) => s.status === 'COMPLETED').length, 0);
}

function totalFocusMinutes(state) {
  return (state.starLog || [])
    .filter((e) => e.type === 'FOCUS_MINUTES')
    .reduce((sum, e) => sum + e.minutes, 0);
}

/** Numero di sessioni FOCUS_SESSION la cui `hour` cade nella finestra [startHour, endHour) — con wrap-around su mezzanotte (es. 22 -> 4). */
function countFocusSessionsInHourWindow(state, startHour, endHour) {
  const inWindow = (hour) => (startHour < endHour ? hour >= startHour && hour < endHour : hour >= startHour || hour < endHour);
  return (state.starLog || []).filter((e) => e.type === 'FOCUS_SESSION' && typeof e.hour === 'number' && inWindow(e.hour)).length;
}

export const TROPHY_DEFINITIONS = [
  // ---------------------------------------------------------------- NEIGHBORHOOD
  {
    id: 'first_launch',
    nome: 'Primo Lancio',
    tier: TIER.NEIGHBORHOOD,
    secret: false,
    descrizione: 'Completa il primo nodo di uno Skill Tree.',
    condizione: (state) => state.materie.some((m) => m.sfide.some((s) => s.status === 'COMPLETED')),
    iconPath: 'M13 2 3 14h7l-1 8 11-14h-7l1-6Z'
  },
  {
    id: 'first_focus_session',
    nome: 'Prima Sessione Sul Campo',
    tier: TIER.NEIGHBORHOOD,
    secret: false,
    descrizione: 'Completa e salva la tua prima sessione di Focus.',
    condizione: (state) => (state.starLog || []).some((e) => e.type === 'FOCUS_MINUTES'),
    iconPath: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z M12 6v6l4 2'
  },
  {
    id: 'web_shooter_recharge',
    nome: 'Ricarica Web-Shooter',
    tier: TIER.NEIGHBORHOOD,
    secret: false,
    descrizione: 'Completa 5 Daily Protocols di ricarica Stamina.',
    condizione: (state) => (state.profile.quickQuestsUsed || 0) >= 5,
    iconPath: 'M12 2s7 8 7 13a7 7 0 0 1-14 0c0-5 7-13 7-13Z'
  },
  {
    id: 'spider_reflexes_3',
    nome: 'Riflessi Aracnidi',
    tier: TIER.NEIGHBORHOOD,
    secret: false,
    descrizione: '3 giorni consecutivi di attività registrata.',
    condizione: (state) => state.profile.streak >= 3,
    iconPath: 'M12 2 4 6v6c0 5 3.8 9.5 8 10 4.2-.5 8-5 8-10V6l-8-4Z'
  },
  {
    id: 'five_nodes_cleared',
    nome: 'Debutto Da Quartiere',
    tier: TIER.NEIGHBORHOOD,
    secret: false,
    descrizione: 'Completa 5 nodi in totale, in qualsiasi nodo del Web-Matrix.',
    condizione: (state) => totalCompletedNodes(state) >= 5,
    iconPath: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z M8 12l3 3 5-6'
  },
  // V23.0 — INIZIATIVA LIBERA: disciplina totale su un esame, nessun nodo lasciato indietro.
  {
    id: 'zero_rimpianti',
    nome: 'Zero Rimpianti',
    tier: TIER.NEIGHBORHOOD,
    secret: false,
    descrizione: 'Supera un esame avendo completato TUTTI i nodi del suo Skill Tree, nessuno escluso.',
    condizione: (state) => state.materie.some((m) => m.examPassed && m.sfide.length > 0 && m.sfide.every((s) => s.status === 'COMPLETED')),
    iconPath: 'M9 11l2 2 4-4 M12 2 4 6v6c0 5 3.8 9.5 8 10 4.2-.5 8-5 8-10V6l-8-4Z'
  },
  // V23.0 — INIZIATIVA LIBERA (chicca): easter egg per chi studia all'alba.
  {
    id: 'alba_del_ragno',
    nome: "L'Alba Del Ragno",
    tier: TIER.NEIGHBORHOOD,
    secret: true,
    descrizione: 'Completa una sessione di Focus fra le 4:00 e le 6:00 del mattino.',
    condizione: (state) => (state.starLog || []).some((e) => e.type === 'FOCUS_SESSION' && e.hour >= 4 && e.hour < 6),
    iconPath: 'M12 3v3 M4.5 12H2 M22 12h-2.5 M5.6 5.6l1.8 1.8 M16.6 7.4l1.8-1.8 M5 20h14 M8 20a4 4 0 0 1 8 0'
  },

  // ---------------------------------------------------------------- AVENGER
  {
    id: 'clean_spider_sense',
    nome: 'Senso Di Ragno Pulito',
    tier: TIER.AVENGER,
    secret: false,
    descrizione: 'Azzera i ripassi in sospeso: nessun nodo segnalato dallo Spider-Sense.',
    condizione: (state) => {
      const tracked = state.materie.flatMap((m) => m.sfide).filter((s) => s.status === 'COMPLETED' && s.nextReviewDate);
      return tracked.length > 0 && tracked.every((s) => !isReviewDue(s.nextReviewDate));
    },
    iconPath: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z'
  },
  {
    id: 'avenger_week_streak',
    nome: 'Settimana Da Vendicatore',
    tier: TIER.AVENGER,
    secret: false,
    descrizione: '7 giorni consecutivi di attività registrata.',
    condizione: (state) => state.profile.streak >= 7,
    iconPath: 'M12 2c1 4-3 5-3 9a5 5 0 0 0 10 0c0-2-1-3-1-3s0 2-2 2c-2 0-1.5-2-1.5-4C14.5 3 12 2 12 2Z'
  },
  {
    id: 'sixth_sense_overdrive_3',
    nome: 'Sesto Senso Attivato',
    tier: TIER.AVENGER,
    secret: false,
    descrizione: '3 Overdrive attivati in sessioni di Focus.',
    condizione: (state) => (state.profile.overdriveCount || 0) >= 3,
    iconPath: 'M13 2 3 14h6l-1 8 11-14h-6l1-6Z M4.5 3.5l1.5 1.5'
  },
  {
    id: 'steel_nerves_hard10',
    nome: 'Nervi Di Acciaio',
    tier: TIER.AVENGER,
    secret: false,
    descrizione: 'Completa 10 nodi di difficoltà Hard.',
    condizione: (state) => (state.profile.hardNodesCompleted || 0) >= 10,
    iconPath: 'M3 20 9 8l4 6 3-4 5 10H3Z'
  },
  {
    id: 'guardian_level10',
    nome: 'Guardiano Di New York',
    tier: TIER.AVENGER,
    secret: false,
    descrizione: 'Raggiungi il Livello 10.',
    condizione: (state) => state.profile.level >= 10,
    iconPath: 'M12 2 4 6v6c0 5 3.8 9.5 8 10 4.2-.5 8-5 8-10V6l-8-4Z M12 8l1.5 3 3.3.3-2.5 2.2.8 3.2L12 15l-2.9 1.7.8-3.2-2.5-2.2 3.3-.3Z'
  },
  {
    id: 'peter_parker_mind_6h',
    nome: 'Mente Di Peter Parker',
    tier: TIER.AVENGER,
    secret: false,
    descrizione: 'Accumula 6 ore totali di Focus registrate nei Daily Bugle Archives.',
    condizione: (state) => totalFocusMinutes(state) >= 360,
    iconPath: 'M12 3a5 5 0 0 0-5 5c0 1 .3 1.8.8 2.5A4 4 0 0 0 6 14a4 4 0 0 0 4 4h1v2h2v-2h1a4 4 0 0 0 4-4 4 4 0 0 0-1.8-3.3c.5-.7.8-1.5.8-2.7a5 5 0 0 0-5-5Z'
  },
  // V23.0 — "Secchione di Midtown": esplicitamente richiesto dalla
  // Direttiva Suprema, collegato al Multiverse Simulator (Voto registrato).
  {
    id: 'midtown_nerd_28',
    nome: 'Secchione Di Midtown',
    tier: TIER.AVENGER,
    secret: false,
    descrizione: 'Registra un Voto pari o superiore a 28 su un esame superato.',
    condizione: (state) => state.materie.some((m) => m.examPassed && Number.isFinite(m.voto) && m.voto >= 28),
    iconPath: 'M12 3 3 8l9 5 9-5-9-5Z M3 8v6l9 5 9-5V8 M12 13v6'
  },
  // V23.0 — INIZIATIVA LIBERA: 10 sessioni di Focus notturno (22:00-04:00),
  // eco del trofeo segreto "Tuta Simbionte" ma sulla costanza, non
  // sull'episodio singolo — e agganciato alla quest Night Owl Protocol.
  {
    id: 'notturno_recidivo',
    nome: 'Il Ragno Notturno',
    tier: TIER.AVENGER,
    secret: true,
    descrizione: 'Completa 10 sessioni di Focus fra le 22:00 e le 4:00.',
    condizione: (state) => countFocusSessionsInHourWindow(state, 22, 4) >= 10,
    iconPath: 'M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z M15 3l1 2 2 1-2 1-1 2-1-2-2-1 2-1Z'
  },
  // V23.0 — INIZIATIVA LIBERA: una vera "Focus Marathon" in un solo giorno.
  {
    id: 'maratoneta_quantico',
    nome: 'Maratoneta Quantico',
    tier: TIER.AVENGER,
    secret: false,
    descrizione: 'Accumula almeno 4 ore (240 min) di Focus in un solo giorno.',
    condizione: (state) => (state.starLog || []).some((e) => e.type === 'FOCUS_MINUTES' && e.minutes >= 240),
    iconPath: 'M12 2v3 M12 19v3 M4.2 4.2l2.1 2.1 M17.7 17.7l2.1 2.1 M2 12h3 M19 12h3 M4.2 19.8l2.1-2.1 M17.7 6.3l2.1-2.1 M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Z'
  },
  // V23.0 — INIZIATIVA LIBERA: streak intermedia fra i 7 e i 30 giorni.
  {
    id: 'non_stop_cadetto',
    nome: 'Non-Stop Cadetto',
    tier: TIER.AVENGER,
    secret: false,
    descrizione: '14 giorni consecutivi di attività registrata.',
    condizione: (state) => state.profile.streak >= 14,
    iconPath: 'M12 2 4 6v6c0 5 3.8 9.5 8 10 4.2-.5 8-5 8-10V6l-8-4Z M9 12l2 2 4-4'
  },

  // ---------------------------------------------------------------- MULTIVERSE (segreti)
  {
    id: 'symbiote_suit',
    nome: 'Tuta Simbionte',
    tier: TIER.MULTIVERSE,
    secret: true,
    descrizione: 'Completa una sessione di Focus da almeno 25 minuti nel cuore della notte (00:00–04:00).',
    condizione: (state) =>
      (state.starLog || []).some((e) => e.type === 'FOCUS_SESSION' && e.minutes >= 25 && e.hour >= 0 && e.hour < 4),
    iconPath: 'M12 2c3 3 6 6 6 11a6 6 0 0 1-12 0c0-5 3-8 6-11Z M9 15c1 1 5 1 6 0'
  },
  {
    id: 'parkers_luck',
    nome: 'La Fortuna Di Parker',
    tier: TIER.MULTIVERSE,
    secret: true,
    descrizione: 'Vinci un Sinister Six Simulator sopravvivendo con esattamente 1 HP grazie al Last Stand.',
    condizione: (state) => (state.starLog || []).some((e) => e.type === 'BOSS_WIN' && e.hpRemaining === 1),
    iconPath:
      'M12 4a3 3 0 0 1 3 3c0 1-1 2-3 5-2-3-3-4-3-5a3 3 0 0 1 3-3Z M12 20a3 3 0 0 1-3-3c0-1 1-2 3-5 2 3 3 4 3 5a3 3 0 0 1-3 3Z M4 12a3 3 0 0 1 3-3c1 0 2 1 5 3-3 2-4 3-5 3a3 3 0 0 1-3-3Z M20 12a3 3 0 0 1-3 3c-1 0-2-1-5-3 3-2 4-3 5-3a3 3 0 0 1 3 3Z'
  },
  {
    id: 'last_stand_used',
    nome: 'Sopravvissuto Al Sacrificio',
    tier: TIER.MULTIVERSE,
    secret: true,
    descrizione: 'Sopravvivi a 0 HP in un Sinister Six Simulator sacrificando XP (Last Stand).',
    condizione: (state) => (state.profile.lastStandCount || 0) >= 1,
    iconPath: 'M12 2 4 6v6c0 5.2 3.8 9.9 8 11 4.2-1.1 8-5.8 8-11V6l-8-4Zm0 4 2 4h4l-6 8 1-6H9l3-6Z'
  },
  {
    id: 'multiverse_streak_30',
    nome: 'Streak Multiversale',
    tier: TIER.MULTIVERSE,
    secret: true,
    descrizione: 'Mantieni una streak di 30 giorni consecutivi.',
    condizione: (state) => state.profile.streak >= 30,
    iconPath: 'M6 12c0-2 1.5-3 3-3s3 2 3 3-1.5 3-3 3-3-1-3-3Zm9 0c0-2 1.5-3 3-3s3 2 3 3-1.5 3-3 3-3-1-3-3Z'
  },
  {
    id: 'honorary_avenger_15',
    nome: 'Vendicatore Onorario',
    tier: TIER.MULTIVERSE,
    secret: true,
    descrizione: 'Raggiungi il Livello 15.',
    condizione: (state) => state.profile.level >= 15,
    iconPath: 'M12 2l2.6 6.6L21 9l-5 4.4L17.4 20 12 16.6 6.6 20 8 13.4 3 9l6.4-.4Z'
  },
  // V23.0 — "Supremo Accademico": esplicitamente richiesto, agganciato in
  // tempo reale alla Proiezione di Laurea del Multiverse Simulator.
  {
    id: 'supremo_accademico',
    nome: 'Supremo Accademico',
    tier: TIER.MULTIVERSE,
    secret: true,
    descrizione: 'Raggiungi una Proiezione di Laurea di almeno 105/110 nel Multiverse Simulator.',
    condizione: (state) => {
      const { average } = computeWeightedAverage(state.materie);
      const projection = computeGraduationProjection(average);
      return projection != null && projection >= 105;
    },
    iconPath: 'M12 2 2 7l10 5 10-5-10-5Z M2 7v6l10 5 10-5V7 M12 12v9'
  },
  // V23.0 — "Ingegnere Aerospaziale": il trofeo definitivo, richiede il
  // superamento di TUTTI i corsi ufficiali (non "ungraded") del piano di
  // studi Vanvitelli hardcoded in vanvitelliCourseMap.js.
  {
    id: 'ingegnere_aerospaziale',
    nome: 'Ingegnere Aerospaziale',
    tier: TIER.MULTIVERSE,
    secret: true,
    descrizione: 'Supera tutti gli esami ufficiali del piano di studi di Ingegneria Aerospaziale — Vanvitelli.',
    condizione: (state) => {
      const gradableCourses = VANVITELLI_COURSES.filter((c) => !c.ungraded);
      return gradableCourses.every((c) => state.materie.some((m) => m.courseId === c.id && m.examPassed));
    },
    iconPath: 'M12 2 2 7l10 5 10-5-10-5Z M6 9.5V15c0 1.5 2.7 3 6 3s6-1.5 6-3V9.5 M22 7v6'
  },
  // V23.0 — INIZIATIVA LIBERA: fedeltà al Daily Patrol Engine nel tempo.
  {
    id: 'karens_favorite',
    nome: "Karen's Favorite",
    tier: TIER.MULTIVERSE,
    secret: true,
    descrizione: 'Completa 50 missioni della Daily Patrol nel corso della tua carriera.',
    condizione: (state) => (state.profile.dailyPatrolsCompleted || 0) >= 50,
    iconPath: 'M12 21s-7-5-7-11a4.5 4.5 0 0 1 7-3.5A4.5 4.5 0 0 1 19 10c0 6-7 11-7 11Z M9 10l2 2 4-4'
  },
  // V23.0 — INIZIATIVA LIBERA: eccellenza pura sulla Media Ponderata Reale.
  {
    id: 'multiverso_perfetto',
    nome: 'Il Multiverso Perfetto',
    tier: TIER.MULTIVERSE,
    secret: true,
    descrizione: 'Mantieni una Media Ponderata Reale di almeno 29/30 con almeno 5 esami votati.',
    condizione: (state) => {
      const { average, gradedCount } = computeWeightedAverage(state.materie);
      return average != null && average >= 29 && gradedCount >= 5;
    },
    iconPath: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Z M8 3c-2 3-2 15 0 18 M16 3c2 3 2 15 0 18'
  }
];

export function evaluateTrophies(state) {
  return TROPHY_DEFINITIONS.map((def) => {
    const unlocked = def.condizione(state);
    return {
      id: def.id,
      nome: unlocked || !def.secret ? def.nome : '???',
      descrizione: unlocked || !def.secret ? def.descrizione : '??? — Continua a volteggiare.',
      iconPath: def.iconPath,
      tier: def.tier,
      secret: def.secret,
      unlocked
    };
  });
}
