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
import { addDaysToDateOnly, mondayOfDateKey, todayDateOnlyKey, localDateKeyOf } from '../../utils/dateUtils.js';
import { techniqueMemoryForKaren } from '../../utils/techniqueMemory.js';
import { detectPhase, lessonsOn, esitoKey, ESITO_LEZIONE, FASE, DEFAULT_RAPPORTO_SINTESI } from '../../utils/campusEngine.js';

/** V44 — i modi di lavoro contati nella settimana. */
const MODI = ['SINTESI', 'STUDIO', 'RIPASSO', 'ESERCIZI', 'SIMULAZIONE', 'ALTRO'];
const TIPI_FONTE = ['LIBRO', 'SLIDE', 'APPUNTI_PROF', 'ALTRO'];
const QUALITA = ['FLOW', 'NORMAL', 'DISTRACTED'];
const n0 = (v) => Math.max(0, Math.round(Number(v) || 0));

const MAX_MATERIE = 10;

export function buildWeeklyContext({
  weekKey = null,
  starLog = [],
  dayClosures = [],
  materie = [],
  quotas = [],
  streak = null,
  todayKey = todayDateOnlyKey(),
  techniqueMemory = null,
  campus = null
} = {}) {
  const lunedi = weekKey || mondayOfDateKey(todayKey);
  const giorni = Array.from({ length: 7 }, (_, i) => addDaysToDateOnly(lunedi, i)).filter((d) => d <= todayKey);
  const inSettimana = new Set(giorni);
  const chiusure = new Map((Array.isArray(dayClosures) ? dayClosures : []).filter((c) => c && inSettimana.has(c.dateKey)).map((c) => [c.dateKey, c]));

  const minutiGiorno = new Map(giorni.map((d) => [d, 0]));
  const perMateria = new Map();
  let simulazioni = 0;
  // V44 — la settimana anche per COME hai lavorato: modi, qualità, sintesi.
  const modi = Object.fromEntries(MODI.map((m) => [m, 0]));
  const qualita = Object.fromEntries(QUALITA.map((q) => [q, 0]));
  const perTipo = Object.fromEntries(TIPI_FONTE.map((t) => [t, 0]));
  let pagineFonte = 0;
  let pagineAppunti = 0;
  const argomentiSintesi = new Set();
  (Array.isArray(starLog) ? starLog : []).forEach((e) => {
    if (!e || !inSettimana.has(e.dateKey)) return;
    if (e.type === 'FOCUS_SESSION') {
      const min = Math.max(0, Math.round(Number(e.minutes) || 0));
      minutiGiorno.set(e.dateKey, (minutiGiorno.get(e.dateKey) || 0) + min);
      if (e.simulazione) simulazioni += 1;
      const modoSessione = e.simulazione ? 'SIMULAZIONE' : MODI.includes(e.workMode) ? e.workMode : 'ALTRO';
      modi[modoSessione] += min;
      if (QUALITA.includes(e.quality)) qualita[e.quality] += 1;
      if (e.workMode === 'SINTESI') {
        pagineFonte += n0(e.pagineFonte);
        pagineAppunti += n0(e.pagineAppuntiProdotte);
        const tipi = e.pagineFontePerTipo && typeof e.pagineFontePerTipo === 'object' ? e.pagineFontePerTipo : null;
        if (tipi) Object.entries(tipi).forEach(([t, v]) => (perTipo[TIPI_FONTE.includes(t) ? t : 'ALTRO'] += n0(v)));
        else perTipo.ALTRO += n0(e.pagineFonte);
        if (e.sfidaId) argomentiSintesi.add(e.sfidaId);
      }
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
  // V44 — appunti aggiornati, argomenti chiusi, interrogazioni.
  const appuntiAggiornati = new Map();
  let completati = 0;
  const quiz = { count: 0, sapevo: 0, parziale: 0, no: 0 };
  (Array.isArray(materie) ? materie : []).forEach((m) => {
    (Array.isArray(m?.sfide) ? m.sfide : []).forEach((s) => {
      if (!s) return;
      // La sintesi registrata a mano sui nodi (fuori dal timer) conta uguale.
      (Array.isArray(s.sintesiManuale) ? s.sintesiManuale : []).forEach((x) => {
        if (!inSettimana.has(localDateKeyOf(x?.at) || '')) return;
        pagineFonte += n0(x.pagine);
        perTipo.ALTRO += n0(x.pagine);
        pagineAppunti += n0(x.appunti);
        argomentiSintesi.add(s.id);
      });
      (Array.isArray(s.noteLog) ? s.noteLog : []).forEach((x) => {
        if (!inSettimana.has(localDateKeyOf(x?.at) || '')) return;
        const prima = appuntiAggiornati.get(s.id);
        appuntiAggiornati.set(s.id, { caratteri: n0(x.caratteri), ia: (prima?.ia || false) || x.fonte === 'IA' });
      });
      if (s.status === 'COMPLETED' && inSettimana.has(localDateKeyOf(s.completionTimestamp) || '')) completati += 1;
      (Array.isArray(s.quizEsiti) ? s.quizEsiti : []).forEach((q) => {
        if (!inSettimana.has(localDateKeyOf(q?.at) || '')) return;
        quiz.count += 1;
        quiz.sapevo += n0(q.sapevo);
        quiz.parziale += n0(q.parziale);
        quiz.no += n0(q.no);
      });
      (Array.isArray(s?.ripassi) ? s.ripassi : []).forEach((r) => {
        const d = localDateKeyOf(r?.at) || '';
        if (!inSettimana.has(d)) return;
        ripassi += 1;
        if (voti[r.voto] != null) voti[r.voto] += 1;
      });
      (Array.isArray(s?.esercizi) ? s.esercizi : []).forEach((x) => {
        const d = localDateKeyOf(x?.at) || '';
        if (!inSettimana.has(d)) return;
        eserciziFatti += Math.max(0, Number(x.fatti) || 0);
        eserciziCorretti += Math.max(0, Number(x.corretti) || 0);
      });
    });
  });

  // V44 — le lezioni della settimana (orario del Campus) e la fase dei giorni.
  const fasi = { LEZIONI: 0, SESSIONE: 0 };
  const lezioni = { programmate: 0, minuti: 0, saltate: 0, minuti_saltati: 0, sintesi_attesa_min: 0 };
  const haCampus = !!campus && Array.isArray(campus.semestri) && campus.semestri.length > 0;
  if (haCampus) {
    const materieById = new Map((Array.isArray(materie) ? materie : []).filter((m) => m && m.id).map((m) => [m.id, m]));
    const esiti = campus.esiti && typeof campus.esiti === 'object' ? campus.esiti : {};
    const rapporto = Number(campus.rapportoSintesi) > 0 ? Number(campus.rapportoSintesi) : DEFAULT_RAPPORTO_SINTESI;
    giorni.forEach((d) => {
      const fase = detectPhase(campus, d).fase;
      fasi[fase === FASE.LEZIONI ? 'LEZIONI' : 'SESSIONE'] += 1;
      if (fase !== FASE.LEZIONI) return;
      lessonsOn(campus, d, materieById).forEach((l) => {
        lezioni.programmate += 1;
        lezioni.minuti += n0(l.minuti);
        if (esiti[esitoKey(l.id, d)] === ESITO_LEZIONE.SALTATA) {
          lezioni.saltate += 1;
          lezioni.minuti_saltati += n0(l.minuti);
        }
      });
    });
    lezioni.sintesi_attesa_min = Math.round((lezioni.minuti - lezioni.minuti_saltati) * rapporto);
  } else {
    fasi.SESSIONE = giorni.length;
  }

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
    streak: streak ? { days: streak.streak, rest_used: streak.riposiUsati, rest_allowed: streak.riposiSettimana } : null,
    // V43 — la memoria delle tecniche (vedi utils/techniqueMemory.js).
    tecniche_memoria: techniqueMemoryForKaren(techniqueMemory),
    // V44 — fase dei giorni, modi di lavoro, qualità, sintesi, appunti, lezioni.
    phase: { lezioni_days: fasi.LEZIONI, sessione_days: fasi.SESSIONE, campus: haCampus },
    modes: modi,
    quality: qualita,
    sintesi: { pagine_fonte: pagineFonte, per_tipo: perTipo, pagine_appunti: pagineAppunti, argomenti: argomentiSintesi.size },
    notes: {
      argomenti: appuntiAggiornati.size,
      con_ia: [...appuntiAggiornati.values()].filter((x) => x.ia).length,
      caratteri: [...appuntiAggiornati.values()].reduce((a, x) => a + x.caratteri, 0)
    },
    lessons: haCampus ? lezioni : null,
    topics_completed: completati,
    quizzes: quiz
  };
}
