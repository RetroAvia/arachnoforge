import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useArachnoForge } from '../context/ArachnoForgeContext.jsx';
import { Icon } from '../components/Icons.jsx';
import Dropdown from '../components/Dropdown.jsx';
import EmptyState from '../components/EmptyState.jsx';
import PageHeader from '../components/PageHeader.jsx';
import { getDateKey, formatHoursMinutes, daysUntilDateOnly, formatDateOnlyHuman, monthKeyFromDateKey, currentMonthKey, formatMonthYearHuman } from '../utils/dateUtils.js';
import { DIFFICULTY_META, FOCUS_QUALITY, FOCUS_QUALITY_META } from '../utils/xpEngine.js';
import { REVIEW_RATING, REVIEW_RATING_META } from '../utils/spiderSense.js';
import { CARD, CARD_NOPAD, BADGE } from '../utils/designSystem.js';
import { computeGradeHistory, computeWeightedAverage } from '../utils/gpaEngine.js';
import { formatInt, formatDecimal, minutiLabel } from '../utils/format.js';

const DIFFICULTY_RANK = { EASY: 0, MEDIUM: 1, HARD: 2 };

const QUALITY_ORDER = [FOCUS_QUALITY.FLOW, FOCUS_QUALITY.NORMAL, FOCUS_QUALITY.DISTRACTED];

/** Colore della barra di ciascuna valutazione (classi statiche, reattive al costume). */
const QUALITY_BAR_CLASS = {
  FLOW: 'bg-primary',
  NORMAL: 'bg-secondary',
  DISTRACTED: 'bg-accent'
};

const SORT_OPTIONS = [
  { value: 'data', label: 'Per data del ripasso' },
  { value: 'materia', label: 'Per materia' },
  { value: 'difficolta', label: 'Per difficoltà' }
];

const GYM_QUEST_HINT = 'palestra';

// V41 — un anno intero di attività (53 settimane), come i calendari dei
// contributi: prima erano 18 settimane con quadrati da 50 px.
const HEATMAP_WEEKS = 53;
const WEEK_MS = 7 * 86400000;
const MESI_BREVI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];

/**
 * V41 — Giorni di calendario sommati in ora LOCALE. Prima si sommavano
 * multipli di 24 ore: attraversando il cambio dell'ora legale un giorno
 * diventava le 23:00 del precedente, e la heatmap (e la media dei 14
 * giorni) attribuiva i minuti al giorno sbagliato per mezzo anno.
 */
function addLocalDays(date, n) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
}

/**
 * V37.0 — XP di un tratto di starLog contando ogni guadagno UNA volta:
 * ogni sessione scrive sia l'aggregato giornaliero `FOCUS_MINUTES` sia la
 * voce `FOCUS_SESSION` con lo stesso XP. Si contano solo le voci-evento.
 */
const XP_EVENT_TYPES = new Set(['FOCUS_SESSION', 'BOSS_WIN', 'BOSS_LOSS']);
function sumXpOnce(entries) {
  return (Array.isArray(entries) ? entries : []).reduce(
    (sum, e) => (e && XP_EVENT_TYPES.has(e.type) ? sum + (Number(e.xp) || 0) : sum),
    0
  );
}

function intensityLevel(minutes) {
  if (minutes <= 0) return 0;
  if (minutes <= 25) return 1;
  if (minutes <= 50) return 2;
  if (minutes <= 100) return 3;
  return 4;
}

/** Intensità della heatmap sul colore Primario del costume. */
const LEVEL_CLASSES = ['bg-white/[0.05]', 'bg-primary/25', 'bg-primary/45', 'bg-primary/70', 'bg-primary'];

/** Anello percentuale (SVG puro). */
function Ring({ pct, size = 96, stroke = 8, tone = 'text-secondary', label }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = pct == null ? 0 : Math.max(0, Math.min(100, pct));
  return (
    <div className={`relative shrink-0 ${tone}`} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(255 255 255 / 0.08)" strokeWidth={stroke} />
        {pct != null && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="currentColor"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${(v / 100) * c} ${c}`}
            style={{ transition: 'stroke-dasharray 0.8s ease' }}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-bold text-white ds-num leading-none" style={{ fontSize: size * 0.22 }}>
          {pct == null ? 'n/d' : `${pct}%`}
        </span>
        {label && <span className="text-[10px] text-slate-500 mt-1">{label}</span>}
      </div>
    </div>
  );
}

/** Numero grande di una card KPI. */
function Kpi({ icon, iconTone, label, value, hint, valueTone = 'text-white' }) {
  return (
    <div className={`${CARD} !p-4 sm:!p-5`}>
      <p className="text-xs text-slate-400 flex items-center gap-1.5">
        <Icon name={icon} className={`w-3.5 h-3.5 ${iconTone}`} />
        {label}
      </p>
      <p className={`mt-2 text-2xl font-bold tracking-tight ds-num ${valueTone}`}>{value}</p>
      {hint && <p className="text-xs text-slate-500 mt-0.5">{hint}</p>}
    </div>
  );
}

/** Testata di una card della pagina. */
function CardHead({ icon, iconTone = 'text-slate-300', title, subtitle, children }) {
  return (
    <div className="flex items-start justify-between gap-3 flex-wrap">
      <div className="flex items-start gap-3 min-w-0">
        <span className={`ds-icon-tile ${iconTone}`}>
          <Icon name={icon} className="w-[18px] h-[18px]" />
        </span>
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-white leading-snug">{title}</h2>
          {subtitle && <p className="text-[13px] text-slate-400 mt-0.5 leading-relaxed">{subtitle}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}

/** V16.0 (Pillar 5) — un evento della cronologia mensile. */
function TimelineEntry({ entry }) {
  if (entry.type === 'FOCUS_SESSION') {
    const qualityMeta = FOCUS_QUALITY_META[entry.quality] || null;
    return (
      <div className="flex items-center justify-between gap-3 py-2 px-3 rounded-lg bg-surface/70 border border-line">
        <div className="flex items-center gap-2.5 min-w-0">
          <Icon name="target" className="w-4 h-4 text-secondary shrink-0" />
          <div className="min-w-0">
            <p className="text-sm text-slate-200 truncate">
              Sessione di Focus{typeof entry.hour === 'number' ? ` · ${String(entry.hour).padStart(2, '0')}:00` : ''}
            </p>
            <p className="text-xs text-slate-500 truncate">
              {formatDateOnlyHuman(entry.dateKey)}
              {qualityMeta ? ` · ${qualityMeta.shortLabel}` : ''}
            </p>
          </div>
        </div>
        <p className="shrink-0 text-xs ds-num text-right">
          <span className="text-slate-200 font-medium">{minutiLabel(entry.minutes)}</span>
          {entry.xp > 0 && <span className="text-accent"> · +{formatInt(entry.xp)} XP</span>}
          {/* V31.3 — Spider-Sense Surge scorporato, riga per riga. */}
          {entry.surgeXp > 0 && <span className="text-secondary"> · +{formatInt(entry.surgeXp)} Surge</span>}
        </p>
      </div>
    );
  }
  const won = entry.type === 'BOSS_WIN';
  return (
    <div className={`flex items-center justify-between gap-3 py-2 px-3 rounded-lg bg-surface/70 border ${won ? 'border-emerald-400/20' : 'border-primary/20'}`}>
      <div className="flex items-center gap-2.5 min-w-0">
        <Icon name={won ? 'trophy' : 'skull'} className={`w-4 h-4 shrink-0 ${won ? 'text-emerald-300' : 'text-primary'}`} />
        <div className="min-w-0">
          <p className="text-sm text-slate-200 truncate">
            {won ? 'Sinister Six vinta' : 'Sinister Six persa'}
            {entry.materiaNome ? ` · ${entry.materiaNome}` : ''}
          </p>
          <p className="text-xs text-slate-500">
            {formatDateOnlyHuman(entry.dateKey)} · HP residui {formatInt(entry.hpRemaining)}
          </p>
        </div>
      </div>
      {entry.xp > 0 && <p className="text-accent ds-num text-xs shrink-0">+{formatInt(entry.xp)} XP</p>}
    </div>
  );
}

export default function StarLog() {
  const { derived, state, actions } = useArachnoForge();
  const [sortKey, setSortKey] = useState('data');
  const [openMonths, setOpenMonths] = useState(() => new Set([currentMonthKey()]));

  const toggleMonth = (monthKey) => {
    setOpenMonths((prev) => {
      const next = new Set(prev);
      if (next.has(monthKey)) next.delete(monthKey);
      else next.add(monthKey);
      return next;
    });
  };

  const gymQuest = useMemo(
    () => state.quickQuests.find((q) => q.nome.toLowerCase().includes(GYM_QUEST_HINT)),
    [state.quickQuests]
  );

  // V16.0 (Pillar 4) — l'aggregato giornaliero porta ora anche l'XP
  // guadagnato quel giorno (retro-compatibile: entry legacy senza `xp`
  // ricadono su 0, nessun dato inventato).
  const dayStatsByDay = useMemo(() => {
    const map = new Map();
    state.starLog.forEach((entry) => {
      if (entry.type === 'FOCUS_MINUTES') map.set(entry.dateKey, { minutes: entry.minutes, xp: entry.xp || 0 });
    });
    return map;
  }, [state.starLog]);

  // Heatmap: colonne = settimane (da lunedì), righe = giorni. Aritmetica
  // di calendario locale (vedi addLocalDays), i giorni futuri della
  // settimana in corso restano vuoti.
  const heatmap = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayKey = getDateKey(today);
    const dow = (today.getDay() + 6) % 7; // lunedì = 0
    const lastMonday = addLocalDays(today, -dow);
    const gridStart = addLocalDays(lastMonday, -(HEATMAP_WEEKS - 1) * 7);
    const cols = [];
    const monthLabels = [];
    let prevMonth = -1;
    let activeDays = 0;
    let best = null;
    let activeMinutes = 0;
    for (let w = 0; w < HEATMAP_WEEKS; w += 1) {
      const col = [];
      for (let d = 0; d < 7; d += 1) {
        const date = addLocalDays(gridStart, w * 7 + d);
        const key = getDateKey(date);
        const future = key > todayKey;
        const stats = future ? null : dayStatsByDay.get(key);
        const minutes = stats?.minutes || 0;
        if (minutes > 0) {
          activeDays += 1;
          activeMinutes += minutes;
          if (!best || minutes > best.minutes) best = { key, minutes };
        }
        col.push({ key, minutes, xp: stats?.xp || 0, future });
      }
      const firstOfCol = addLocalDays(gridStart, w * 7);
      const m = firstOfCol.getMonth();
      monthLabels.push(m !== prevMonth ? MESI_BREVI[m] : '');
      prevMonth = m;
      cols.push(col);
    }
    return {
      cols,
      monthLabels,
      activeDays,
      best,
      avgActive: activeDays > 0 ? Math.round(activeMinutes / activeDays) : 0
    };
  }, [dayStatsByDay]);
  const [hoverDay, setHoverDay] = useState(null);
  const heatmapScrollRef = useRef(null);
  // Su schermi stretti la heatmap scorre di lato: si parte dalla settimana di oggi.
  useEffect(() => {
    const el = heatmapScrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, []);

  const totalMinutes = useMemo(
    () => Array.from(dayStatsByDay.values()).reduce((a, b) => a + b.minutes, 0),
    [dayStatsByDay]
  );

  const totalSessions = useMemo(() => state.starLog.filter((e) => e && e.type === 'FOCUS_SESSION').length, [state.starLog]);

  const bossStats = useMemo(() => {
    const wins = state.starLog.filter((e) => e.type === 'BOSS_WIN').length;
    const losses = state.starLog.filter((e) => e.type === 'BOSS_LOSS').length;
    return { wins, losses };
  }, [state.starLog]);

  /**
   * V32.0 — Weekly Bugle: prima pagina settimanale ricomposta interamente
   * da dati già esistenti (starLog + gradeHistory + trophyList), NESSUN
   * nuovo campo persistito. Confronto per `dateKey` (stringa YYYY-MM-DD,
   * ordinabile lessicograficamente) — coerente col resto della pagina.
   * Piccola imprecisione accettata ai bordi fuso orario (± un giorno),
   * irrilevante per un riepilogo settimanale informativo.
   */
  const weeklyBugle = useMemo(() => {
    const cutoffKey = getDateKey(new Date(Date.now() - WEEK_MS));
    const recentLog = state.starLog.filter((e) => e && typeof e.dateKey === 'string' && e.dateKey >= cutoffKey);
    const focusEntries = recentLog.filter((e) => e.type === 'FOCUS_SESSION');
    const focusMinutes = recentLog.filter((e) => e.type === 'FOCUS_MINUTES').reduce((sum, e) => sum + (e.minutes || 0), 0);
    // V37.0 — FIX: la somma girava su TUTTE le voci, ma ogni sessione ne
    // scrive due che portano lo stesso XP — l'aggregato giornaliero
    // FOCUS_MINUTES e la voce puntuale FOCUS_SESSION. Il totale
    // settimanale risultava quindi raddoppiato, e con esso il confronto
    // settimana-su-settimana. Si contano solo le voci "evento".
    const totalXp = sumXpOnce(recentLog);
    const surgeXp = focusEntries.reduce((sum, e) => sum + (e.surgeXp || 0), 0);
    const bossWins = recentLog.filter((e) => e.type === 'BOSS_WIN').length;
    const bossLosses = recentLog.filter((e) => e.type === 'BOSS_LOSS').length;
    // V39 — dalla curva ricostruita sulle Materie (computeGradeHistory),
    // la stessa del Multiverse Simulator: un solo racconto della media.
    const todayKeyBugle = getDateKey();
    const examsGraded = computeGradeHistory(state.materie).points.filter(
      (e) => !e.senzaData && typeof e.dateKey === 'string' && e.dateKey >= cutoffKey && e.dateKey <= todayKeyBugle
    );
    // La media "aggiornata" è quella vera di oggi, esami senza data inclusi.
    const currentAverage = computeWeightedAverage(state.materie).average;
    const trophiesUnlocked = (derived.trophyList || []).filter(
      (t) => typeof t.unlockedAt === 'string' && t.unlockedAt.slice(0, 10) >= cutoffKey
    );
    const hasActivity = recentLog.length > 0 || examsGraded.length > 0 || trophiesUnlocked.length > 0;

    // V35.5 — Ripartizione per Materia: quanti minuti di Focus di questa
    // settimana sono andati su ciascuna Materia. `materiaId` è già
    // tracciato su ogni FOCUS_SESSION dal V20.0 (Daily Patrol) — zero nuovo
    // campo persistito, solo un'aggregazione di sola lettura. Il nome
    // viene risolto dal vivo su `state.materie` (mai congelato/stale: se
    // una Materia viene rinominata, la ripartizione della settimana in
    // corso riflette subito il nome aggiornato).
    const materieById = new Map((state.materie || []).map((m) => [m.id, m.nome]));
    const byMateria = new Map();
    focusEntries.forEach((e) => {
      const key = e.materiaId || 'GENERIC';
      if (!byMateria.has(key)) byMateria.set(key, { materiaId: e.materiaId || null, minutes: 0, sessions: 0 });
      const entry = byMateria.get(key);
      entry.minutes += e.minutes || 0;
      entry.sessions += 1;
    });
    const materiaBreakdown = Array.from(byMateria.values())
      .map((e) => ({
        ...e,
        materiaNome: e.materiaId ? (materieById.get(e.materiaId) || 'Materia rimossa') : 'Focus generico'
      }))
      .sort((a, b) => b.minutes - a.minutes);

    // V35.5 — Confronto settimana su settimana: stessa identica pipeline
    // di calcolo applicata ai 7 giorni PRECEDENTI il cutoff corrente (una
    // finestra scorrevole distinta, mai sovrapposta a `recentLog`), solo
    // per dare un senso di trend a "The Weekly Bugle" — nessun nuovo dato
    // persistito, puro confronto derivato dallo stesso `starLog`.
    const prevCutoffKey = getDateKey(new Date(Date.now() - 2 * WEEK_MS));
    const previousLog = state.starLog.filter(
      (e) => e && typeof e.dateKey === 'string' && e.dateKey >= prevCutoffKey && e.dateKey < cutoffKey
    );
    const prevFocusMinutes = previousLog.filter((e) => e.type === 'FOCUS_MINUTES').reduce((sum, e) => sum + (e.minutes || 0), 0);
    const prevSessions = previousLog.filter((e) => e.type === 'FOCUS_SESSION').length;
    const prevTotalXp = sumXpOnce(previousLog);
    // Percentuale onesta: se la settimana precedente era a zero minuti,
    // un "+∞%" non racconterebbe nulla di utile — meglio nessun confronto
    // percentuale piuttosto che un numero fuorviante.
    const minutesDeltaPct = prevFocusMinutes > 0 ? Math.round(((focusMinutes - prevFocusMinutes) / prevFocusMinutes) * 100) : null;

    return {
      cutoffKey,
      focusMinutes,
      sessions: focusEntries.length,
      totalXp,
      surgeXp,
      bossWins,
      bossLosses,
      examsGraded,
      currentAverage,
      trophiesUnlocked,
      hasActivity,
      materiaBreakdown,
      previousWeek: { focusMinutes: prevFocusMinutes, sessions: prevSessions, totalXp: prevTotalXp, minutesDeltaPct }
    };
  }, [state.starLog, state.materie, derived.trophyList]);

  // V31.3 — Spider-Sense Surge Analytics: prima d'ora il bonus finiva
  // impastato dentro l'XP totale della sessione, invisibile a posteriori
  // nella cronologia. `surgeXp` (campo dedicato sulla voce FOCUS_SESSION)
  // lo rende finalmente misurabile nel tempo.
  const spiderSenseSurgeStats = useMemo(() => {
    const surges = state.starLog.filter((e) => e.type === 'FOCUS_SESSION' && e.surgeXp > 0);
    const totalXp = surges.reduce((sum, e) => sum + e.surgeXp, 0);
    return { count: surges.length, totalXp };
  }, [state.starLog]);

  // Tactical Debriefing Analytics — riassume la "Qualità del Focus"
  // raccolta dal Post-Session Debriefing Modal (Stark-Web Terminal) su ogni
  // sessione salvata. Le sessioni precedenti all'introduzione del
  // Debriefing non hanno `quality`: vengono conteggiate nel totale ma
  // escluse dalla ripartizione percentuale (nessun dato inventato).
  const focusQualityStats = useMemo(() => {
    const sessions = state.starLog.filter((e) => e.type === 'FOCUS_SESSION');
    const counts = { FLOW: 0, NORMAL: 0, DISTRACTED: 0 };
    let ratedTotal = 0;
    sessions.forEach((s) => {
      if (s.quality && Object.prototype.hasOwnProperty.call(counts, s.quality)) {
        counts[s.quality] += 1;
        ratedTotal += 1;
      }
    });
    return { counts, ratedTotal, totalSessions: sessions.length };
  }, [state.starLog]);

  // Web-Velocity Focus Analytics: media minuti di Focus/giorno (finestra
  // mobile di 14 giorni) confrontata con il ritmo richiesto per completare
  // i nodi rimanenti della prossima materia in scadenza entro l'esame.
  const WINDOW_DAYS = 14;
  const focusVelocity = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let sum = 0;
    for (let i = 0; i < WINDOW_DAYS; i += 1) {
      sum += dayStatsByDay.get(getDateKey(addLocalDays(today, -i)))?.minutes || 0;
    }
    const avgDailyMinutes = Math.round((sum / WINDOW_DAYS) * 10) / 10;

    const nextExam = derived.nextExam;
    if (!nextExam || !Array.isArray(nextExam.sfide) || !nextExam.examDate) {
      return { avgDailyMinutes, avgSubjectMinutes: null, targetDailyMinutes: null, velocityPct: null, daysLeft: null, materiaNome: null, remainingNodes: null, hoursRemaining: null };
    }
    const totalNodes = nextExam.sfide.length;
    const completedNodes = nextExam.sfide.filter((s) => s.status === 'COMPLETED').length;
    const remainingNodes = Math.max(0, totalNodes - completedNodes);
    const daysLeft = Math.max(1, daysUntilDateOnly(nextExam.examDate) ?? 1);

    // V39 — il ritmo è quello della MATERIA, confrontato con la quota
    // calcolata dallo stesso motore di Mission Control e del Web-Matrix.
    // Prima: minuti di TUTTE le materie contro "nodi residui × durata di
    // un pomodoro" (10 nodi, 25 min, 20 giorni = 12 min al giorno): un
    // numero che non aveva niente a che vedere con il piano di studio e
    // dava "in anticipo" anche a chi era indietro.
    const cutoffKey = getDateKey(addLocalDays(today, -(WINDOW_DAYS - 1)));
    let subjectSum = 0;
    (Array.isArray(state.starLog) ? state.starLog : []).forEach((e) => {
      if (e?.type === 'FOCUS_SESSION' && e.materiaId === nextExam.id && typeof e.dateKey === 'string' && e.dateKey >= cutoffKey) {
        subjectSum += Number(e.minutes) || 0;
      }
    });
    const avgSubjectMinutes = Math.round((subjectSum / WINDOW_DAYS) * 10) / 10;

    const quota = derived.karenQuotaByMateriaId?.get?.(nextExam.id) || null;
    const hoursRemaining = quota && Number.isFinite(quota.hoursRemaining) ? quota.hoursRemaining : null;
    const focusTime = state.settings.focusTime || 25;
    const targetDailyMinutesRaw =
      quota && Number.isFinite(quota.dailyQuotaHours) && quota.dailyQuotaHours > 0
        ? quota.dailyQuotaHours * 60
        : (remainingNodes * focusTime) / daysLeft;
    const targetDailyMinutes = Math.round(targetDailyMinutesRaw);
    const nothingLeft = remainingNodes === 0 || (hoursRemaining != null && hoursRemaining <= 0);
    const velocityPct = nothingLeft ? 100 : Math.round((avgSubjectMinutes / Math.max(0.5, targetDailyMinutesRaw)) * 100);

    return { avgDailyMinutes, avgSubjectMinutes, targetDailyMinutes, velocityPct, daysLeft, materiaNome: nextExam.nome, remainingNodes, hoursRemaining };
  }, [dayStatsByDay, derived.nextExam, derived.karenQuotaByMateriaId, state.starLog, state.settings.focusTime]);

  const sortedReviews = useMemo(() => {
    const rows = [...derived.upcomingReviews];
    rows.sort((a, b) => {
      if (sortKey === 'materia') return a.materiaNome.localeCompare(b.materiaNome);
      // V39 — ordine per difficoltà reale (Difficile → Facile), non
      // alfabetico ('EASY' < 'HARD' < 'MEDIUM').
      if (sortKey === 'difficolta') return (DIFFICULTY_RANK[b.difficulty] ?? 1) - (DIFFICULTY_RANK[a.difficulty] ?? 1);
      return (a.nextReviewDate || '').localeCompare(b.nextReviewDate || '');
    });
    return rows;
  }, [derived.upcomingReviews, sortKey]);

  // V16.0 (Pillar 5) — Cronologia Sessioni raggruppata per Mese/Anno,
  // ordine cronologico inverso (mese corrente per primo), Accordion aperto
  // di default solo sul mese corrente: la pagina resta leggibile anche
  // dopo centinaia di sessioni accumulate.
  const monthGroups = useMemo(() => {
    const relevant = state.starLog.filter(
      (e) => e.type === 'FOCUS_SESSION' || e.type === 'BOSS_WIN' || e.type === 'BOSS_LOSS'
    );
    const byMonth = new Map();
    relevant.forEach((entry) => {
      const monthKey = monthKeyFromDateKey(entry.dateKey);
      if (!monthKey) return;
      if (!byMonth.has(monthKey)) byMonth.set(monthKey, []);
      byMonth.get(monthKey).push(entry);
    });
    return Array.from(byMonth.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([monthKey, entries]) => {
        const sorted = [...entries].sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
        const focusEntries = entries.filter((e) => e.type === 'FOCUS_SESSION');
        const totalMinutesMonth = focusEntries.reduce((sum, e) => sum + (e.minutes || 0), 0);
        const totalXpMonth = entries.reduce((sum, e) => sum + (e.xp || 0), 0);
        const wins = entries.filter((e) => e.type === 'BOSS_WIN').length;
        const losses = entries.filter((e) => e.type === 'BOSS_LOSS').length;
        return { monthKey, label: formatMonthYearHuman(monthKey), entries: sorted, totalMinutesMonth, totalXpMonth, wins, losses };
      });
  }, [state.starLog]);

  const flowPct =
    focusQualityStats.ratedTotal > 0 ? Math.round((focusQualityStats.counts.FLOW / focusQualityStats.ratedTotal) * 100) : null;
  const delta = weeklyBugle.previousWeek.minutesDeltaPct;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Storico e statistiche"
        icon="newspaper"
        title="Daily Bugle Archives"
        subtitle="Cosa hai fatto, quanto e come: attività giorno per giorno, qualità del Focus, memoria e ripassi."
      />

      {derived.burnoutRisk && (
        <div className="ds-card ds-card-alert !py-4 flex items-start gap-3 flex-wrap">
          <Icon name="alertTriangle" className="w-5 h-5 text-primary shrink-0 mt-0.5" />
          <div className="flex-1 min-w-[220px]">
            <p className="text-sm font-semibold text-primary">Rischio burnout</p>
            <p className="text-[13px] text-slate-300 mt-0.5 leading-relaxed">
              Oggi hai già {minutiLabel(derived.todayMinutes)} di Focus, oltre la soglia di sicurezza di 5 ore. Una pausa
              fisica adesso rende di più di un altro blocco.
            </p>
          </div>
          {gymQuest && (
            <button type="button" onClick={() => actions.applyQuickQuest(gymQuest.id)} className="ds-btn ds-btn-danger ds-btn-sm shrink-0">
              {gymQuest.nome}
            </button>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <Kpi icon="clock" iconTone="text-secondary" label="Focus totale" value={minutiLabel(totalMinutes)} hint={`${formatInt(totalSessions)} sessioni registrate`} />
        <Kpi
          icon="bolt"
          iconTone="text-primary"
          label="Sessioni in Flow State"
          value={flowPct == null ? '—' : `${flowPct}%`}
          hint={focusQualityStats.ratedTotal > 0 ? `su ${formatInt(focusQualityStats.ratedTotal)} valutate` : 'nessuna sessione valutata'}
        />
        <Kpi
          icon="crosshair"
          iconTone="text-accent"
          label="Sinister Six"
          value={
            <>
              {formatInt(bossStats.wins)}
              <span className="text-slate-500 text-lg font-semibold"> vinte</span>
              <span className="text-slate-600 text-lg font-semibold"> · </span>
              {formatInt(bossStats.losses)}
              <span className="text-slate-500 text-lg font-semibold"> perse</span>
            </>
          }
          hint={bossStats.wins + bossStats.losses > 0 ? `${Math.round((bossStats.wins / (bossStats.wins + bossStats.losses)) * 100)}% di vittorie` : 'nessuna simulazione ancora'}
        />
        <Kpi
          icon="sparkles"
          iconTone="text-secondary"
          label="Spider-Sense Surge"
          value={spiderSenseSurgeStats.count > 0 ? `+${formatInt(spiderSenseSurgeStats.totalXp)} XP` : '—'}
          valueTone={spiderSenseSurgeStats.count > 0 ? 'text-secondary' : 'text-slate-500'}
          hint={spiderSenseSurgeStats.count > 0 ? `${formatInt(spiderSenseSurgeStats.count)} sessioni pulite senza interruzioni` : 'nessuna sessione pulita ancora'}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 items-stretch">
        {/* V32.0 — The Weekly Bugle: la prima pagina degli ultimi 7 giorni. */}
        <section className={`${CARD} xl:col-span-2 space-y-4`} aria-label="The Weekly Bugle">
          <CardHead icon="chartBar" iconTone="text-primary" title="The Weekly Bugle" subtitle={`Edizione dal ${formatDateOnlyHuman(weeklyBugle.cutoffKey)} a oggi`}>
            {delta !== null && (
              <span
                className={delta >= 0 ? BADGE.green : BADGE.red}
                title={`Settimana scorsa: ${minutiLabel(weeklyBugle.previousWeek.focusMinutes)} di Focus`}
              >
                <Icon name="trendUp" className={`w-3 h-3 ${delta < 0 ? 'rotate-180' : ''}`} />
                {delta >= 0 ? '+' : ''}
                {delta}% sulla settimana scorsa
              </span>
            )}
          </CardHead>

          {!weeklyBugle.hasActivity ? (
            <EmptyState
              variant="log"
              compact
              title="Nessuna notizia questa settimana"
              subtitle="Completa una sessione di Focus, una simulazione o registra un esame per far uscire la prossima edizione."
            />
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {[
                  { v: minutiLabel(weeklyBugle.focusMinutes), l: 'di Focus', tone: 'text-white' },
                  { v: `${weeklyBugle.totalXp >= 0 ? '+' : ''}${formatInt(weeklyBugle.totalXp)}`, l: 'XP guadagnati', tone: 'text-accent' },
                  { v: formatInt(weeklyBugle.sessions), l: 'sessioni', tone: 'text-secondary' },
                  { v: `${weeklyBugle.bossWins}/${weeklyBugle.bossLosses}`, l: 'Sinister Six vinte/perse', tone: 'text-white' }
                ].map((x) => (
                  <div key={x.l} className="ds-well px-3 py-2.5">
                    <p className={`text-lg font-bold ds-num ${x.tone}`}>{x.v}</p>
                    <p className="text-[11px] text-slate-500">{x.l}</p>
                  </div>
                ))}
              </div>

              {(weeklyBugle.surgeXp > 0 || weeklyBugle.examsGraded.length > 0) && (
                <div className="space-y-1.5">
                  {weeklyBugle.surgeXp > 0 && (
                    <p className="text-[13px] text-secondary flex items-center gap-1.5">
                      <Icon name="bolt" className="w-4 h-4" />
                      +{formatInt(weeklyBugle.surgeXp)} XP da Spider-Sense Surge questa settimana.
                    </p>
                  )}
                  {weeklyBugle.examsGraded.length > 0 && (
                    <p className="text-[13px] text-slate-300 flex items-center gap-1.5">
                      <Icon name="book" className="w-4 h-4 text-slate-500" />
                      {(() => {
                        const n = weeklyBugle.examsGraded.reduce((sum, e) => sum + (Array.isArray(e.esami) ? e.esami.length : 1), 0);
                        return n === 1 ? '1 esame registrato questa settimana' : `${n} esami registrati questa settimana`;
                      })()}
                      {Number.isFinite(weeklyBugle.currentAverage) && ` — media aggiornata a ${formatDecimal(weeklyBugle.currentAverage, 2)}.`}
                    </p>
                  )}
                </div>
              )}

              {weeklyBugle.trophiesUnlocked.length > 0 && (
                <div className="space-y-1.5 pt-3 border-t border-line">
                  <p className="ds-eyebrow">Trofei sbloccati</p>
                  <div className="flex flex-wrap gap-1.5">
                    {weeklyBugle.trophiesUnlocked.map((t) => (
                      <span key={t.id} className={BADGE.amber}>
                        <Icon name="trophy" className="w-3 h-3" />
                        {t.nome}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* V35.5 — dove sono andati davvero i minuti di questa settimana. */}
              {weeklyBugle.materiaBreakdown.length > 0 && (
                <div className="space-y-2.5 pt-3 border-t border-line">
                  <p className="ds-eyebrow">Ripartizione per materia</p>
                  {weeklyBugle.materiaBreakdown.map((m) => {
                    const pct = weeklyBugle.focusMinutes > 0 ? Math.round((m.minutes / weeklyBugle.focusMinutes) * 100) : 0;
                    return (
                      <div key={m.materiaId || 'GENERIC'} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 items-center">
                        <span className="text-[13px] text-slate-200 truncate">{m.materiaNome}</span>
                        <span className="text-xs ds-num text-slate-500 text-right">
                          {minutiLabel(m.minutes)} · {m.sessions === 1 ? '1 sessione' : `${m.sessions} sessioni`}
                        </span>
                        <div className="ds-progress col-span-2">
                          <span className="bg-secondary" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </section>

        {/* Tactical Debriefing — la qualità del Focus dichiarata a fine sessione. */}
        <section className={`${CARD} space-y-4`} aria-label="Qualità del Focus">
          <CardHead icon="target" iconTone="text-secondary" title="Qualità del Focus" subtitle="Dal Tactical Debriefing a fine sessione" />
          {focusQualityStats.ratedTotal === 0 ? (
            <EmptyState
              variant="log"
              compact
              title="Nessun Debriefing ancora"
              subtitle="Completa e valuta la prima sessione di Focus nello Stark-Web Terminal."
            />
          ) : (
            <div className="space-y-4">
              {QUALITY_ORDER.map((quality) => {
                const meta = FOCUS_QUALITY_META[quality];
                const count = focusQualityStats.counts[quality];
                const pct = focusQualityStats.ratedTotal > 0 ? Math.round((count / focusQualityStats.ratedTotal) * 100) : 0;
                return (
                  <div key={quality} className="space-y-1.5">
                    <div className="flex items-center justify-between text-sm gap-2">
                      <span className={`flex items-center gap-2 font-medium ${meta.color}`}>
                        <Icon name={meta.icon} className="w-4 h-4" />
                        {meta.shortLabel}
                      </span>
                      <span className="ds-num text-slate-400 text-xs">
                        {formatInt(count)} · <span className="text-slate-200 font-semibold">{pct}%</span>
                      </span>
                    </div>
                    <div className="ds-progress !h-2">
                      <span className={QUALITY_BAR_CLASS[quality]} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
              <p className="text-xs text-slate-500 pt-1">
                {formatInt(focusQualityStats.ratedTotal)} sessioni valutate su {formatInt(focusQualityStats.totalSessions)} registrate.
              </p>
            </div>
          )}
        </section>
      </div>

      {/* Heatmap: un anno di attività, un quadrato per giorno. */}
      <section className={`${CARD} space-y-4`} aria-label="Heatmap dell'attività">
        <CardHead
          icon="calendar"
          iconTone="text-primary"
          title="Heatmap dell'attività"
          subtitle={
            hoverDay
              ? `${formatDateOnlyHuman(hoverDay.key)} · ${hoverDay.minutes > 0 ? `${minutiLabel(hoverDay.minutes)} di Focus · ${formatInt(hoverDay.xp)} XP` : 'nessuna sessione'}`
              : 'Ultime 53 settimane. Passa sopra un giorno per i dettagli.'
          }
        >
          <div className="flex items-center gap-1.5 text-xs text-slate-500" aria-hidden="true">
            <span>Meno</span>
            {LEVEL_CLASSES.map((cls, i) => (
              <span key={i} className={`w-3 h-3 rounded-[3px] ${cls}`} />
            ))}
            <span>Più</span>
          </div>
        </CardHead>

        <div ref={heatmapScrollRef} className="overflow-x-auto af-scroll pb-1" onMouseLeave={() => setHoverDay(null)}>
          <div
            className="grid gap-[3px] min-w-[640px]"
            style={{ gridTemplateColumns: `1.75rem repeat(${HEATMAP_WEEKS}, minmax(0, 1fr))` }}
            role="img"
            aria-label={`Attività degli ultimi 12 mesi: ${heatmap.activeDays} giorni con almeno una sessione`}
          >
            <span />
            {heatmap.monthLabels.map((m, i) => (
              <span key={`m${i}`} className="text-[10px] text-slate-500 leading-none h-3 overflow-visible whitespace-nowrap">
                {m}
              </span>
            ))}
            {[0, 1, 2, 3, 4, 5, 6].map((d) => (
              <React.Fragment key={`r${d}`}>
                <span className="text-[10px] text-slate-500 leading-none self-center">{d === 0 ? 'Lun' : d === 2 ? 'Mer' : d === 4 ? 'Ven' : ''}</span>
                {heatmap.cols.map((col, wi) => {
                  const day = col[d];
                  return (
                    <span
                      key={day.key}
                      onMouseEnter={() => setHoverDay(day.future ? null : day)}
                      className={`aspect-square rounded-[3px] ${day.future ? 'bg-transparent' : LEVEL_CLASSES[intensityLevel(day.minutes)]} ${
                        hoverDay?.key === day.key ? 'ring-1 ring-white/70' : ''
                      }`}
                      title={day.future ? undefined : `${formatDateOnlyHuman(day.key)}: ${day.minutes > 0 ? minutiLabel(day.minutes) : 'nessuna sessione'}`}
                      data-week={wi}
                    />
                  );
                })}
              </React.Fragment>
            ))}
          </div>
        </div>

        <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3 border-t border-line">
          <div>
            <dt className="text-[11px] text-slate-500">Giorni con almeno una sessione</dt>
            <dd className="text-sm font-semibold text-slate-100 ds-num mt-0.5">{formatInt(heatmap.activeDays)} su 365</dd>
          </div>
          <div>
            <dt className="text-[11px] text-slate-500">Media nei giorni attivi</dt>
            <dd className="text-sm font-semibold text-slate-100 ds-num mt-0.5">{heatmap.activeDays > 0 ? minutiLabel(heatmap.avgActive) : '—'}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-slate-500">Giorno migliore</dt>
            <dd className="text-sm font-semibold text-slate-100 ds-num mt-0.5">
              {heatmap.best ? `${minutiLabel(heatmap.best.minutes)} · ${formatDateOnlyHuman(heatmap.best.key)}` : '—'}
            </dd>
          </div>
        </dl>
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 items-stretch">
        {/* Web-Velocity — ritmo reale sulla materia del prossimo esame contro quello richiesto dal piano. */}
        <section className={`${CARD} space-y-4`} aria-label="Ritmo verso il prossimo esame">
          <CardHead icon="bolt" iconTone="text-accent" title="Ritmo verso il prossimo esame" subtitle={`Media degli ultimi ${WINDOW_DAYS} giorni contro la quota del piano`} />
          {focusVelocity.materiaNome ? (
            <div className="flex flex-col sm:flex-row items-center gap-5">
              <Ring
                pct={focusVelocity.velocityPct == null ? null : Math.min(100, focusVelocity.velocityPct)}
                size={112}
                stroke={9}
                tone={focusVelocity.velocityPct >= 100 ? 'text-emerald-400' : focusVelocity.velocityPct >= 60 ? 'text-accent' : 'text-primary'}
                label="del ritmo"
              />
              <div className="flex-1 min-w-0 space-y-2 text-center sm:text-left">
                <p className="text-base font-semibold text-white break-words">{focusVelocity.materiaNome}</p>
                <p className="text-[13px] text-slate-400">
                  Su questa materia: <span className="ds-num text-slate-100">{minutiLabel(focusVelocity.avgSubjectMinutes)} al giorno</span>
                  <span className="text-slate-500"> · {minutiLabel(focusVelocity.avgDailyMinutes)} al giorno in totale</span>
                </p>
                <p className="text-[13px] text-slate-400">
                  Richiesto dal piano: <span className="ds-num text-slate-100">{minutiLabel(focusVelocity.targetDailyMinutes)} al giorno</span>
                  {focusVelocity.remainingNodes > 0 || (focusVelocity.hoursRemaining ?? 0) > 0
                    ? ` · ${focusVelocity.hoursRemaining != null ? `${formatHoursMinutes(focusVelocity.hoursRemaining)} residue` : `${focusVelocity.remainingNodes} argomenti`} in ${focusVelocity.daysLeft} giorni`
                    : ' — programma già chiuso'}
                </p>
                <p
                  className={`text-sm font-semibold ${
                    focusVelocity.velocityPct >= 100 ? 'text-emerald-300' : focusVelocity.velocityPct >= 60 ? 'text-accent' : 'text-primary'
                  }`}
                >
                  {focusVelocity.velocityPct >= 100
                    ? 'Sei in linea o in anticipo sulla tabella di marcia.'
                    : focusVelocity.velocityPct >= 60
                    ? "Un po' sotto l'obiettivo: aggiungi un blocco al giorno."
                    : 'Ritmo insufficiente: serve intensificare le sessioni su questa materia.'}
                </p>
              </div>
            </div>
          ) : (
            <p className="text-[13px] text-slate-400">Dai una data d'esame a una materia nel Web-Matrix per vedere qui il ritmo richiesto.</p>
          )}
        </section>

        {/* Web-Matrix Radar — stabilità della memoria, globale e per materia. */}
        <section className={`${CARD} space-y-4`} aria-label="Web-Matrix Radar">
          <CardHead icon="grid" iconTone="text-secondary" title="Web-Matrix Radar" subtitle="Argomenti che reggono in memoria contro quelli da rinforzare" />
          <div className="flex items-center gap-5">
            <Ring pct={derived.memoryRadar.global.stabilityPct} size={96} stroke={8} tone="text-secondary" label="stabili" />
            {derived.memoryRadar.global.total === 0 ? (
              <p className="text-[13px] text-slate-400">Nessun argomento tracciato: completa il primo per accendere il radar.</p>
            ) : (
              <ul className="space-y-1 text-[13px]">
                <li className="flex items-center gap-2 text-slate-300">
                  <span className="w-2 h-2 rounded-full bg-secondary" /> <span className="ds-num font-semibold text-white">{derived.memoryRadar.global.stable}</span> stabili
                </li>
                <li className="flex items-center gap-2 text-slate-300">
                  <span className="w-2 h-2 rounded-full bg-primary" /> <span className="ds-num font-semibold text-white">{derived.memoryRadar.global.attention}</span> da rinforzare
                </li>
                {derived.memoryRadar.global.observing > 0 && (
                  <li className="flex items-center gap-2 text-slate-400">
                    <span className="w-2 h-2 rounded-full bg-slate-500" /> <span className="ds-num font-semibold text-slate-200">{derived.memoryRadar.global.observing}</span> in osservazione
                  </li>
                )}
              </ul>
            )}
          </div>
          {derived.memoryRadar.byMateria.some((m) => m.total > 0) && (
            <ul className="space-y-2.5 pt-3 border-t border-line">
              {derived.memoryRadar.byMateria.filter((m) => m.total > 0).map((m) => (
                <li key={m.materiaId} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 items-center">
                  <span className="text-[13px] text-slate-200 truncate">{m.materiaNome}</span>
                  <span className="text-xs ds-num text-slate-400 text-right">
                    {m.stabilityPct == null ? 'n/d' : `${m.stabilityPct}%`}
                    <span className="text-slate-600">
                      {' '}
                      · {m.stable} stabili · {m.attention} da rinforzare
                    </span>
                  </span>
                  <div className="ds-progress col-span-2">
                    <span className="bg-secondary" style={{ width: `${m.stabilityPct || 0}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
          {derived.memoryRadar.byMateria.some((m) => m.total === 0) && (
            <p className="text-xs text-slate-500">
              {(() => {
                const n = derived.memoryRadar.byMateria.filter((m) => m.total === 0).length;
                return n === 1 ? '1 materia non ha ancora argomenti completati.' : `${n} materie non hanno ancora argomenti completati.`;
              })()}
            </p>
          )}
        </section>
      </div>

      {/* Radar Spider-Sense — i ripassi in sospeso, da fare qui in fila. */}
      <section className={`${CARD} space-y-4`} aria-label="Radar Spider-Sense">
        <CardHead
          icon="radar"
          iconTone="text-accent"
          title="Radar Spider-Sense"
          subtitle={sortedReviews.length === 0 ? 'Nessun ripasso in sospeso' : sortedReviews.length === 1 ? '1 ripasso in sospeso' : `${sortedReviews.length} ripassi in sospeso`}
        >
          {sortedReviews.length > 1 && (
            <div className="w-full sm:w-60">
              <Dropdown value={sortKey} onChange={setSortKey} options={SORT_OPTIONS} compact ariaLabel="Ordine dei ripassi" />
            </div>
          )}
        </CardHead>

        {sortedReviews.length === 0 ? (
          <EmptyState variant="safe" compact title="La città è sicura." subtitle="Nessun ripasso in sospeso: torna dopo aver completato nuovi argomenti." />
        ) : (
          <ul className="divide-y divide-white/[0.06] rounded-xl border border-line overflow-hidden">
            {sortedReviews.map((row) => {
              const diffMeta = DIFFICULTY_META[row.difficulty] || DIFFICULTY_META.MEDIUM;
              return (
                <li key={row.sfidaId} className="flex flex-col md:flex-row md:items-center gap-3 px-3.5 py-3 bg-surface/50 hover:bg-surface transition-colors">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-100 break-words">{row.sfidaNome}</p>
                    <p className="text-xs text-slate-500 break-words">
                      {row.materiaNome} · {diffMeta.label} · ripasso dal {row.nextReviewDate ? formatDateOnlyHuman(row.nextReviewDate) : '—'}
                    </p>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5 md:w-[300px] shrink-0">
                    {Object.values(REVIEW_RATING).map((rating) => (
                      <button
                        key={rating}
                        type="button"
                        onClick={() => actions.reviewSfida(row.materiaId, row.sfidaId, rating)}
                        className="ds-btn ds-btn-ghost ds-btn-sm"
                      >
                        <span className={REVIEW_RATING_META[rating].color}>{REVIEW_RATING_META[rating].label}</span>
                      </button>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* V16.0 (Pillar 5) — Cronologia per mese: il mese corrente aperto, i
          passati chiusi. Scala a centinaia di sessioni. */}
      <section className="space-y-3" aria-label="Cronologia sessioni">
        <div className="flex items-center justify-between gap-3 px-1">
          <h2 className="ds-h2">Cronologia</h2>
          {monthGroups.length > 1 && (
            <button
              type="button"
              onClick={() =>
                setOpenMonths((prev) => (prev.size >= monthGroups.length ? new Set() : new Set(monthGroups.map((g) => g.monthKey))))
              }
              className="ds-btn ds-btn-quiet ds-btn-sm"
            >
              {openMonths.size >= monthGroups.length ? 'Chiudi tutti' : 'Apri tutti'}
            </button>
          )}
        </div>
        {monthGroups.length === 0 ? (
          <div className={CARD}>
            <EmptyState
              variant="log"
              compact
              title="Nessuna sessione registrata"
              subtitle="Completa una sessione di Focus o un Sinister Six Simulator per iniziare la cronologia."
            />
          </div>
        ) : (
          monthGroups.map((g) => {
            const open = openMonths.has(g.monthKey);
            return (
              <div key={g.monthKey} className={CARD_NOPAD}>
                <button
                  type="button"
                  onClick={() => toggleMonth(g.monthKey)}
                  className="w-full flex items-center justify-between gap-3 px-4 sm:px-5 py-3.5 text-left hover:bg-white/[0.02] transition-colors"
                  aria-expanded={open}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="ds-icon-tile text-secondary">
                      <Icon name="calendar" className="w-4 h-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white truncate first-letter:uppercase">{g.label}</p>
                      <p className="text-xs text-slate-500 truncate ds-num">
                        {g.entries.length === 1 ? '1 evento' : `${formatInt(g.entries.length)} eventi`} · {minutiLabel(g.totalMinutesMonth)} di Focus ·{' '}
                        {formatInt(g.totalXpMonth)} XP
                        {(g.wins > 0 || g.losses > 0) && ` · Sinister Six ${g.wins} vinte, ${g.losses} perse`}
                      </p>
                    </div>
                  </div>
                  <Icon name="chevronDown" className={`w-4 h-4 text-slate-500 shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
                </button>
                {open && (
                  <div className="px-4 sm:px-5 pb-4 pt-3 space-y-1.5 border-t border-line">
                    {g.entries.map((entry, i) => (
                      // V41 — chiave stabile anche con eventi nello stesso istante
                      // (prima: solo il timestamp, chiavi duplicate).
                      <TimelineEntry key={`${entry.type}-${entry.timestamp || entry.dateKey}-${i}`} entry={entry} />
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </section>
    </div>
  );
}
