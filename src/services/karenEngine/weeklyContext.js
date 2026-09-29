// =====================================================================
// ArachnoForge — src/services/karenEngine/weeklyContext.js (V42)
// LA SETTIMANA, IN NUMERI, PER IL BILANCIO DI K.A.R.E.N.
//
// Il bilancio settimanale deve parlare dei FATTI: quanto hai studiato
// giorno per giorno contro quanto il piano chiedeva, su quali materie e
// in che modo (sintesi, studio, ripasso, esercizi), com'era l'energia la
// sera, quanti ripassi hai fatto e con che esito, cosa ti aspetta. Qui si
// raccolgono, compatti; il server li valida (id veri, numeri sani) e
// prende i nomi delle materie dal database.
// =====================================================================
import { addDaysToDateOnly, mondayOfDateKey, todayDateOnlyKey } from '../../utils/dateUtils.js';

const MAX_MATERIE = 10;

export function buildWeeklyContext({ weekKey = null, starLog = [], dayClosures = [], materie = [], quotas = [], streak = null, todayKey = todayDateOnlyKey() } = {}) {
  const lunedi = weekKey || mondayOfDateKey(todayKey);
  const giorni = Array.from({ length: 7 }, (_, i) => addDaysToDateOnly(lunedi, i)).filter((d) => d <= todayKey);
  const inSettimana = new Set(giorni);
  const chiusure = new Map((Array.isArray(dayClosures) ? dayClosures : []).filter((c) => c && inSettimana.has(c.dateKey)).map((c) => [c.dateKey, c]));

  const minutiGiorno = new Map(giorni.map((d) => [d, 0]));
  const perMateria = new Map();
  let simulazioni = 0;
  (Array.isArray(starLog) ? starLog : []).forEach((e) => {
    if (!e || !inSettimana.has(e.dateKey)) return;
    if (e.type === 'FOCUS_SESSION') {
      const min = Math.max(0, Math.round(Number(e.minutes) || 0));
      minutiGiorno.set(e.dateKey, (minutiGiorno.get(e.dateKey) || 0) + min);
      if (e.simulazione) simulazioni += 1;
      if (!e.materiaId) return;
      const x = perMateria.get(e.materiaId) || { minutes: 0, modes: {} };
      x.minutes += min;
      const modo = e.simulazione ? 'SIMULAZIONE' : e.workMode || 'ALTRO';
      x.modes[modo] = (x.modes[modo] || 0) + min;
      perMateria.set(e.materiaId, x);
    }
  });

  // Ripassi della settimana, dagli storici dei nodi.
  let ripassi = 0;
  const voti = { AGAIN: 0, HARD: 0, MEDIUM: 0, EASY: 0 };
  let eserciziFatti = 0;
  let eserciziCorretti = 0;
  (Array.isArray(materie) ? materie : []).forEach((m) => {
    (Array.isArray(m?.sfide) ? m.sfide : []).forEach((s) => {
      (Array.isArray(s?.ripassi) ? s.ripassi : []).forEach((r) => {
        const d = typeof r?.at === 'string' ? r.at.slice(0, 10) : '';
        if (!inSettimana.has(d)) return;
        ripassi += 1;
        if (voti[r.voto] != null) voti[r.voto] += 1;
      });
      (Array.isArray(s?.esercizi) ? s.esercizi : []).forEach((x) => {
        const d = typeof x?.at === 'string' ? x.at.slice(0, 10) : '';
        if (!inSettimana.has(d)) return;
        eserciziFatti += Math.max(0, Number(x.fatti) || 0);
        eserciziCorretti += Math.max(0, Number(x.corretti) || 0);
      });
    });
  });

  const totale = [...minutiGiorno.values()].reduce((a, b) => a + b, 0);
  const obiettivo = [...chiusure.values()].reduce((a, c) => a + (Number(c.obiettivoMin) || 0), 0);

  return {
    week: lunedi,
    days: giorni.map((d) => {
      const c = chiusure.get(d);
      return {
        date: d,
        minutes: minutiGiorno.get(d) || 0,
        target_minutes: c ? Math.max(0, Math.round(Number(c.obiettivoMin) || 0)) : null,
        energy: c && Number.isInteger(c.energia) ? c.energia : null,
        closed: !!c
      };
    }),
    total_minutes: totale,
    target_minutes_closed_days: obiettivo,
    by_materia: [...perMateria.entries()]
      .sort((a, b) => b[1].minutes - a[1].minutes)
      .slice(0, MAX_MATERIE)
      .map(([id, x]) => ({ materia_id: id, minutes: x.minutes, modes: x.modes })),
    reviews: { count: ripassi, ratings: voti },
    exercises: { done: eserciziFatti, correct: eserciziCorretti },
    simulations: simulazioni,
    upcoming: (Array.isArray(quotas) ? quotas : [])
      .filter((q) => q && !q.frozen && q.daysRemaining != null && q.daysRemaining <= 45)
      .slice(0, 6)
      .map((q) => ({ materia_id: q.materiaId, days_to_exam: q.daysRemaining, status: q.status, late_hours: Math.round((Number(q.lateHours) || 0) * 10) / 10 })),
    streak: streak ? { days: streak.streak, rest_used: streak.riposiUsati, rest_allowed: streak.riposiSettimana } : null
  };
}
