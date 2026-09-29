// =====================================================================
// ArachnoForge — src/services/karenEngine/planContext.js (V42)
// IL PIANO DI OGGI, PER K.A.R.E.N.
//
// Fino alla V41 karen-oracle sceglieva l'argomento del giorno guardando
// solo le date d'esame salvate: poteva proporre una materia che il
// planner oggi non aveva messo, e non sapeva quante ore c'erano, cosa era
// già fatto, se si era in periodo di lezioni. Ora ogni rigenerazione
// porta con sé il piano calcolato qui (lo stesso che vedi a schermo).
//
// Il server NON si fida ciecamente: usa solo gli id di materia che
// esistono davvero nel tuo stato salvato (e non superate), prende i nomi
// dal database e non da qui, e tronca ogni numero a un intervallo sano.
// Questo modulo è puro: nessun React, nessuna rete.
// =====================================================================
import { nextProvaTipo, formatoMeta } from '../../utils/appelli.js';
import { addDaysToDateOnly } from '../../utils/dateUtils.js';

export const PLAN_CONTEXT_VERSION = 1;
const MAX_SUBJECTS = 8;

const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

function minutiIeri(starLog, todayKey) {
  const ieri = addDaysToDateOnly(todayKey, -1);
  const perMateria = new Map();
  let totale = 0;
  (Array.isArray(starLog) ? starLog : []).forEach((e) => {
    if (!e || e.type !== 'FOCUS_SESSION' || e.dateKey !== ieri) return;
    const min = Math.max(0, Math.round(Number(e.minutes) || 0));
    totale += min;
    if (!e.materiaId) return;
    const x = perMateria.get(e.materiaId) || { minuti: 0, modi: new Set(), sfide: new Set() };
    x.minuti += min;
    if (e.workMode) x.modi.add(e.workMode);
    if (e.sfidaId) x.sfide.add(e.sfidaId);
    perMateria.set(e.materiaId, x);
  });
  return {
    minutes: totale,
    by_materia: [...perMateria.entries()]
      .sort((a, b) => b[1].minuti - a[1].minuti)
      .slice(0, MAX_SUBJECTS)
      .map(([id, x]) => ({ materia_id: id, minutes: x.minuti, modes: [...x.modi].slice(0, 4), sfida_ids: [...x.sfide].slice(0, 6) }))
  };
}

/**
 * @param {object} a
 * @param {object} a.planToday    derived.planToday
 * @param {Array}  a.quotas       derived.karenQuotas
 * @param {Array}  a.materie      derived.materiePiano (date di pianificazione)
 * @param {object} [a.campus]     derived.campus
 * @param {object} [a.streak]     derived.streak
 * @param {Array}  [a.starLog]
 * @param {string} a.todayKey
 */
export function buildKarenPlanContext({ planToday, quotas = [], materie = [], campus = null, streak = null, starLog = [], todayKey }) {
  if (!planToday || typeof todayKey !== 'string') return null;
  const byId = new Map((Array.isArray(materie) ? materie : []).filter(Boolean).map((m) => [m.id, m]));
  const oggi = (planToday.subjects || []).slice(0, MAX_SUBJECTS).map((p) => {
    const m = byId.get(p.materiaId);
    return {
      materia_id: p.materiaId,
      exam_date: p.examDate || null,
      days_to_exam: p.daysRemaining,
      prova: m ? nextProvaTipo(m, todayKey) : null,
      formato: m ? formatoMeta(m).label : null,
      target_hours: r2(p.todayTargetHours),
      min_hours: r2(p.todayMinHours),
      done_hours: r2(p.doneTodayHours),
      sintesi_hours: r2(p.todaySintesiHours),
      studio_hours: r2(p.todayStudioHours),
      finale_hours: r2(p.todayFinalReviewHours),
      status: p.status,
      late_hours: r2(p.lateHours),
      fine_prevista: p.finePrevistaDateKey || null,
      chiusura_appunti: p.chiusuraAppuntiDateKey || null
    };
  });
  const idsOggi = new Set(oggi.map((s) => s.materia_id));
  const altre = (Array.isArray(quotas) ? quotas : [])
    .filter((q) => q && !idsOggi.has(q.materiaId))
    .slice(0, MAX_SUBJECTS)
    .map((q) => ({
      materia_id: q.materiaId,
      exam_date: q.examDate || null,
      days_to_exam: q.daysRemaining,
      status: q.status,
      frozen: !!q.frozen,
      hours_remaining: r2(q.hoursRemaining),
      inizio_entro: q.inizioEntroDateKey || null
    }));
  const rev = planToday.reviews || {};
  const lessons = planToday.lessons || {};
  return {
    v: PLAN_CONTEXT_VERSION,
    date: todayKey,
    fase: campus?.fase === 'LEZIONI' ? 'LEZIONI' : 'SESSIONE',
    capacity_hours: r2(planToday.capacityHours),
    target_hours: r2(planToday.targetHours),
    done_hours: r2(planToday.doneHours),
    over_capacity: !!planToday.overCapacity,
    deficit_hours: r2(planToday.deficitHours),
    monotask: !!planToday.monotaskActive,
    subjects_today: oggi,
    other_subjects: altre,
    reviews: {
      due: Math.max(0, Number(rev.due) || 0),
      done: Math.max(0, Number(rev.done) || 0),
      target: Math.max(0, Number(rev.targetCount) || 0),
      postponed: Math.max(0, Number(rev.rinviati) || 0)
    },
    lessons: {
      reserved_hours: r2(lessons.riservateOre),
      first: !!lessons.prima,
      queue: (Array.isArray(campus?.coda) ? campus.coda : []).slice(0, 6).map((l) => ({ materia_id: l.materiaId, lessons: Math.max(1, Number(l.lezioniDaSistemare) || 1) }))
    },
    streak: streak ? { days: Math.max(0, Number(streak.streak) || 0), valid_today: !!streak.validaOggi, rest_left: Math.max(0, Number(streak.riposiRimasti) || 0) } : null,
    yesterday: minutiIeri(starLog, todayKey)
  };
}
