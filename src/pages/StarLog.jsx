import React, { useMemo, useState } from 'react';
import { useArachnoForge } from '../context/ArachnoForgeContext.jsx';
import { Icon } from '../components/Icons.jsx';
import Dropdown from '../components/Dropdown.jsx';
import EmptyState from '../components/EmptyState.jsx';
import { getDateKey, daysUntilDateOnly, formatDateOnlyHuman, monthKeyFromDateKey, currentMonthKey, formatMonthYearHuman } from '../utils/dateUtils.js';
import { DIFFICULTY_META, FOCUS_QUALITY, FOCUS_QUALITY_META } from '../utils/xpEngine.js';
import { REVIEW_RATING, REVIEW_RATING_META } from '../utils/spiderSense.js';
import { CARD, CARD_NOPAD, H1, H2 } from '../utils/designSystem.js';

const QUALITY_ORDER = [FOCUS_QUALITY.FLOW, FOCUS_QUALITY.NORMAL, FOCUS_QUALITY.DISTRACTED];

/** Classi Tailwind reattive al costume (mai concatenate a runtime) per la
 * barra di ciascuna valutazione — Primario/Secondario/Accento dinamici. */
const QUALITY_BAR_CLASS = {
  FLOW: 'bg-gradient-to-r from-primary to-primary-dark shadow-primary-glow',
  NORMAL: 'bg-gradient-to-r from-secondary to-secondary-dark shadow-secondary-glow',
  DISTRACTED: 'bg-gradient-to-r from-accent to-accent/70 shadow-accent-glow'
};

const SORT_OPTIONS = [
  { value: 'data', label: 'Ordina per Data ripasso' },
  { value: 'materia', label: 'Ordina per Materia' },
  { value: 'difficolta', label: 'Ordina per Difficoltà' }
];

const GYM_QUEST_HINT = 'palestra';

const WEEKS_VISIBLE = 18;
const DAY_MS = 86400000;
const WEEK_MS = 7 * DAY_MS;

function intensityLevel(minutes) {
  if (minutes <= 0) return 0;
  if (minutes <= 25) return 1;
  if (minutes <= 50) return 2;
  if (minutes <= 100) return 3;
  return 4;
}

/** V16.0 (Pillar 3) — intensità della Heatmap sul canale Primario dinamico:
 * cambia costume, cambia colore, sempre coerente col resto dell'app. */
const LEVEL_CLASSES = [
  'bg-surface/80 border-secondary/15',
  'bg-primary/20 border-primary/30',
  'bg-primary/45 border-primary/50',
  'bg-primary/70 border-primary/70',
  'bg-primary border-primary shadow-primary-glow'
];

/**
 * Web-Matrix Radar — anello HUD che mostra la percentuale di nodi
 * "stabili" nella memoria a lungo termine (ultimo giudizio Facile/Medio,
 * non attualmente in allerta Spider-Sense) rispetto al totale dei nodi
 * già entrati nel motore SRS. Puro SVG, nessuna libreria esterna.
 */
function RadarRing({ pct, size = 128, stroke = 12 }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const filled = pct == null ? 0 : Math.max(0, Math.min(100, pct)) / 100 * c;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="af-radar-ring shrink-0 text-secondary">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(var(--af-attack-rgb) / 0.18)" strokeWidth={stroke} />
      {pct != null && (
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${filled} ${c - filled}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dasharray 0.8s ease' }}
        />
      )}
      <text
        x="50%"
        y="50%"
        textAnchor="middle"
        dominantBaseline="central"
        fill="#f8fafc"
        className="font-mono font-bold"
        style={{ fontSize: size * 0.22 }}
      >
        {pct == null ? 'N/D' : `${pct}%`}
      </text>
    </svg>
  );
}

function RadarCard({ title, radar, compact = false }) {
  return (
    <div className={`flex items-center gap-4 ${compact ? 'bg-surface/60 border border-secondary/15 rounded-2xl p-4' : ''}`}>
      <RadarRing pct={radar.stabilityPct} size={compact ? 84 : 128} stroke={compact ? 8 : 12} />
      <div className="min-w-0">
        <p className={`font-semibold truncate text-white ${compact ? 'text-base' : 'text-lg'}`}>{title}</p>
        {radar.total === 0 ? (
          <p className="text-base text-slate-500 mt-0.5">Nessun nodo tracciato.</p>
        ) : (
          <div className="mt-1.5 space-y-1">
            <p className="text-base text-secondary flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-secondary shrink-0" /> {radar.stable} stabili
            </p>
            <p className="text-base text-primary flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-primary shrink-0" /> {radar.attention} da rinforzare
            </p>
            {radar.observing > 0 && (
              <p className="text-base text-slate-500 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-slate-500 shrink-0" /> {radar.observing} in osservazione
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** V16.0 (Pillar 4) — quadratino della Heatmap con tooltip preciso
 * "Data: X Focus, Y XP" a comparsa (hover), stile HUD coerente col resto
 * dell'app invece del solo `title` nativo del browser. */
function HeatmapDay({ day }) {
  return (
    <div className="relative group w-full">
      <div
        className={`w-full aspect-square rounded-sm border transition-all duration-300 group-hover:scale-125 group-hover:z-10 ${LEVEL_CLASSES[intensityLevel(day.minutes)]}`}
      />
      <div className="pointer-events-none absolute z-20 bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:flex flex-col items-center whitespace-nowrap">
        <div className="bg-surface border border-secondary/30 rounded-lg px-2.5 py-1.5 shadow-[0_8px_24px_rgba(0,0,0,0.5)]">
          <p className="text-[11px] font-mono text-slate-200">{formatDateOnlyHuman(day.key)}</p>
          <p className="text-[11px] font-mono text-secondary">{day.minutes} min Focus</p>
          <p className="text-[11px] font-mono text-accent">{day.xp} XP</p>
        </div>
      </div>
    </div>
  );
}

/** V16.0 (Pillar 5) — riga di un singolo evento dentro l'Accordion mensile. */
function TimelineEntry({ entry }) {
  if (entry.type === 'FOCUS_SESSION') {
    const qualityMeta = FOCUS_QUALITY_META[entry.quality] || null;
    return (
      <div className="flex items-center justify-between gap-3 py-2.5 px-3.5 rounded-xl bg-surface/60 border border-secondary/10">
        <div className="flex items-center gap-2.5 min-w-0">
          <Icon name="target" className="w-4 h-4 text-secondary shrink-0" />
          <div className="min-w-0">
            <p className="text-sm text-slate-200 truncate">
              Sessione Focus{typeof entry.hour === 'number' ? ` · ${String(entry.hour).padStart(2, '0')}:00` : ''}
            </p>
            <p className="text-xs text-slate-500 truncate">
              {formatDateOnlyHuman(entry.dateKey)}{qualityMeta ? ` · ${qualityMeta.shortLabel}` : ''}
            </p>
          </div>
        </div>
        <div className="text-right shrink-0 font-mono text-xs">
          <p className="text-slate-300">{entry.minutes} min</p>
          {entry.xp > 0 && <p className="text-accent">+{entry.xp} XP</p>}
          {/* V31.3 — Spider-Sense Surge scorporato dalla voce storica (era
              impastato nel totale XP): visibile qui riga per riga. */}
          {entry.surgeXp > 0 && <p className="text-secondary">+{entry.surgeXp} Surge</p>}
        </div>
      </div>
    );
  }
  const won = entry.type === 'BOSS_WIN';
  return (
    <div className={`flex items-center justify-between gap-3 py-2.5 px-3.5 rounded-xl bg-surface/60 border ${won ? 'border-emerald-400/20' : 'border-primary/20'}`}>
      <div className="flex items-center gap-2.5 min-w-0">
        <Icon name={won ? 'trophy' : 'skull'} className={`w-4 h-4 shrink-0 ${won ? 'text-emerald-400' : 'text-primary'}`} />
        <div className="min-w-0">
          <p className="text-sm text-slate-200 truncate">
            {won ? 'Sinister Six Simulator vinta' : 'Sinister Six Simulator persa'}{entry.materiaNome ? ` · ${entry.materiaNome}` : ''}
          </p>
          <p className="text-xs text-slate-500">{formatDateOnlyHuman(entry.dateKey)} · HP residui {entry.hpRemaining}</p>
        </div>
      </div>
      {entry.xp > 0 && <p className="text-accent font-mono text-xs shrink-0">+{entry.xp} XP</p>}
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

  const weeks = useMemo(() => {
    const totalDays = WEEKS_VISIBLE * 7;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startOffset = today.getDay();
    const gridStart = new Date(today.getTime() - (totalDays - 1 - startOffset) * DAY_MS);

    const cols = [];
    for (let w = 0; w < WEEKS_VISIBLE; w += 1) {
      const col = [];
      for (let d = 0; d < 7; d += 1) {
        const date = new Date(gridStart.getTime() + (w * 7 + d) * DAY_MS);
        const key = getDateKey(date);
        const stats = dayStatsByDay.get(key);
        col.push({ key, date, minutes: stats?.minutes || 0, xp: stats?.xp || 0 });
      }
      cols.push(col);
    }
    return cols;
  }, [dayStatsByDay]);

  const totalMinutes = useMemo(
    () => Array.from(dayStatsByDay.values()).reduce((a, b) => a + b.minutes, 0),
    [dayStatsByDay]
  );

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
    const totalXp = recentLog.reduce((sum, e) => sum + (e.xp || 0), 0);
    const surgeXp = focusEntries.reduce((sum, e) => sum + (e.surgeXp || 0), 0);
    const bossWins = recentLog.filter((e) => e.type === 'BOSS_WIN').length;
    const bossLosses = recentLog.filter((e) => e.type === 'BOSS_LOSS').length;
    const gradeHistory = Array.isArray(state.gradeHistory) ? state.gradeHistory : [];
    const examsGraded = gradeHistory.filter((e) => e && typeof e.dateKey === 'string' && e.dateKey >= cutoffKey);
    const trophiesUnlocked = (derived.trophyList || []).filter(
      (t) => typeof t.unlockedAt === 'string' && t.unlockedAt.slice(0, 10) >= cutoffKey
    );
    const hasActivity = recentLog.length > 0 || examsGraded.length > 0 || trophiesUnlocked.length > 0;
    return {
      cutoffKey,
      focusMinutes,
      sessions: focusEntries.length,
      totalXp,
      surgeXp,
      bossWins,
      bossLosses,
      examsGraded,
      trophiesUnlocked,
      hasActivity
    };
  }, [state.starLog, state.gradeHistory, derived.trophyList]);

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
      const d = new Date(today.getTime() - i * DAY_MS);
      sum += dayStatsByDay.get(getDateKey(d))?.minutes || 0;
    }
    const avgDailyMinutes = Math.round((sum / WINDOW_DAYS) * 10) / 10;

    const nextExam = derived.nextExam;
    if (!nextExam || !Array.isArray(nextExam.sfide) || !nextExam.examDate) {
      return { avgDailyMinutes, targetDailyMinutes: null, velocityPct: null, daysLeft: null, materiaNome: null, remainingNodes: null };
    }
    const totalNodes = nextExam.sfide.length;
    const completedNodes = nextExam.sfide.filter((s) => s.status === 'COMPLETED').length;
    const remainingNodes = Math.max(0, totalNodes - completedNodes);
    const daysLeft = Math.max(1, daysUntilDateOnly(nextExam.examDate) ?? 1);
    const focusTime = state.settings.focusTime || 25;
    const targetDailyMinutesRaw = (remainingNodes * focusTime) / daysLeft;
    const targetDailyMinutes = Math.round(targetDailyMinutesRaw);
    const velocityPct = remainingNodes === 0
      ? 100
      : Math.round((avgDailyMinutes / Math.max(0.5, targetDailyMinutesRaw)) * 100);

    return { avgDailyMinutes, targetDailyMinutes, velocityPct, daysLeft, materiaNome: nextExam.nome, remainingNodes };
  }, [dayStatsByDay, derived.nextExam, state.settings.focusTime]);

  const sortedReviews = useMemo(() => {
    const rows = [...derived.upcomingReviews];
    rows.sort((a, b) => {
      if (sortKey === 'materia') return a.materiaNome.localeCompare(b.materiaNome);
      if (sortKey === 'difficolta') return a.difficulty.localeCompare(b.difficulty);
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className={H1}>Daily Bugle Archives</h1>
        <p className="text-base text-slate-400 mt-1.5">Karen: archivio cronologico delle tue imprese. Heatmap dell'attività, Radar Spider-Sense e cronologia sessioni.</p>
      </div>

      {derived.burnoutRisk && (
        <div className="relative bg-surface/70 backdrop-blur-2xl border border-primary/40 rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.5)] px-5 py-4 flex items-start gap-3 overflow-hidden">
          <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-primary/15 blur-3xl pointer-events-none" />
          <Icon name="alertTriangle" className="relative w-6 h-6 text-primary shrink-0 mt-0.5" />
          <div className="relative flex-1">
            <p className="text-base font-semibold text-primary">Rischio Burnout Rilevato</p>
            <p className="text-base text-slate-400 mt-1 leading-relaxed">
              Hai registrato {derived.todayMinutes} minuti di Focus oggi, oltre la soglia di sicurezza (300 min).
              Considera una pausa fisica prima di continuare a spingere.
            </p>
          </div>
          {gymQuest && (
            <button
              type="button"
              onClick={() => actions.applyQuickQuest(gymQuest.id)}
              className="relative shrink-0 px-3.5 py-2 rounded-xl bg-primary/15 border border-primary/50 text-primary text-base font-semibold hover:bg-primary hover:text-white transition-all duration-300 whitespace-nowrap"
            >
              {gymQuest.nome}
            </button>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className={CARD}>
          <p className="text-base text-slate-400">Minuti totali registrati</p>
          <p className="text-3xl font-mono font-bold mt-1.5 text-white">{totalMinutes}</p>
        </div>
        <div className={CARD}>
          <p className="text-base text-slate-400">Sinister Six vinte</p>
          <p className="text-3xl font-mono font-bold mt-1.5 text-emerald-400">{bossStats.wins}</p>
        </div>
        <div className={CARD}>
          <p className="text-base text-slate-400">Sinister Six perse</p>
          <p className="text-3xl font-mono font-bold mt-1.5 text-primary">{bossStats.losses}</p>
        </div>
      </div>

      {/* V32.0 — Weekly Bugle: prima pagina degli ultimi 7 giorni, in stile
          "edizione del Daily Bugle" coerente col tema della pagina. */}
      <div className={`${CARD} space-y-4`}>
        {/* V33.0 — bagliore di sfondo dedicato (accento/decay, "carta da
            giornale dorata"): prima l'unica card "editoriale" della pagina
            senza il trattamento premium che StatHero/le altre hero-card
            hanno già altrove nell'app. */}
        <div className="absolute -top-14 left-1/2 -translate-x-1/2 w-56 h-56 rounded-full bg-accent/10 blur-3xl pointer-events-none" />
        <div className="relative flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Icon name="chartBar" className="w-5 h-5 text-primary" />
            <span className={H2}>THE WEEKLY BUGLE</span>
          </div>
          <span className="text-xs font-mono text-slate-500">
            Edizione dal {formatDateOnlyHuman(weeklyBugle.cutoffKey)} a oggi
          </span>
        </div>

        {!weeklyBugle.hasActivity ? (
          <EmptyState
            variant="log"
            compact
            title="Karen: nessuna notizia questa settimana"
            subtitle="Completa una sessione di Focus, una simulazione o vota un esame per far uscire la prossima edizione."
          />
        ) : (
          <>
            <div className="relative grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-surface/70 border border-secondary/15 rounded-xl p-3 text-center">
                <p className="text-xl font-mono font-bold text-white">{weeklyBugle.focusMinutes}</p>
                <p className="text-[11px] text-slate-500 mt-0.5">min Focus</p>
              </div>
              <div className="bg-surface/70 border border-secondary/15 rounded-xl p-3 text-center">
                <p className="text-xl font-mono font-bold text-accent">+{weeklyBugle.totalXp}</p>
                <p className="text-[11px] text-slate-500 mt-0.5">XP totali</p>
              </div>
              <div className="bg-surface/70 border border-secondary/15 rounded-xl p-3 text-center">
                <p className="text-xl font-mono font-bold text-secondary">{weeklyBugle.sessions}</p>
                <p className="text-[11px] text-slate-500 mt-0.5">sessioni Focus</p>
              </div>
              <div className="bg-surface/70 border border-secondary/15 rounded-xl p-3 text-center">
                <p className="text-xl font-mono font-bold text-white">{weeklyBugle.bossWins}<span className="text-slate-500">/{weeklyBugle.bossLosses}</span></p>
                <p className="text-[11px] text-slate-500 mt-0.5">Sinister Six V/S</p>
              </div>
            </div>

            {weeklyBugle.surgeXp > 0 && (
              <p className="relative text-sm text-secondary flex items-center gap-1.5">
                <Icon name="bolt" className="w-4 h-4" />
                +{weeklyBugle.surgeXp} XP da Spider-Sense Surge questa settimana.
              </p>
            )}

            {weeklyBugle.examsGraded.length > 0 && (
              <p className="relative text-sm text-slate-400 flex items-center gap-1.5">
                <Icon name="book" className="w-4 h-4 text-slate-500" />
                {weeklyBugle.examsGraded.length} esame{weeklyBugle.examsGraded.length > 1 ? 'i' : ''} votat{weeklyBugle.examsGraded.length > 1 ? 'i' : 'o'} questa settimana
                {weeklyBugle.examsGraded.length > 0 && ` — Media aggiornata a ${weeklyBugle.examsGraded[weeklyBugle.examsGraded.length - 1].average.toFixed(2)}.`}
              </p>
            )}

            {weeklyBugle.trophiesUnlocked.length > 0 && (
              <div className="relative space-y-1.5 pt-1 border-t border-white/5">
                <p className="text-xs tracking-widest text-slate-500 font-mono">TROFEI SBLOCCATI</p>
                {weeklyBugle.trophiesUnlocked.map((t) => (
                  <p key={t.id} className="text-sm text-white flex items-center gap-1.5">
                    <Icon name="trophy" className="w-4 h-4 text-amber-400 shrink-0" />
                    {t.nome}
                  </p>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* V31.3 — Spider-Sense Surge Analytics: bonus totale accumulato
          nel tempo dalle sessioni pulite, prima invisibile a posteriori. */}
      {spiderSenseSurgeStats.count > 0 && (
        <div className={`${CARD} flex items-center justify-between gap-3 flex-wrap`}>
          <div className="relative flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-secondary/10 border border-secondary/30 flex items-center justify-center text-secondary shrink-0">
              <Icon name="bolt" className="w-5 h-5" />
            </div>
            <div>
              <p className="text-base font-semibold text-white">Spider-Sense Surge</p>
              <p className="text-sm text-slate-500">{spiderSenseSurgeStats.count} sessioni pulite senza interruzioni</p>
            </div>
          </div>
          <p className="relative text-2xl font-mono font-bold text-secondary">+{spiderSenseSurgeStats.totalXp} XP</p>
        </div>
      )}

      {/* Tactical Debriefing Analytics — Qualità del Focus raccolta dal
          Post-Session Debriefing Modal di Stark-Web Terminal. */}
      <div className={CARD}>
        <div className="relative flex items-center gap-2 mb-5">
          <Icon name="target" className="w-5 h-5 text-secondary" />
          <span className={H2}>TACTICAL DEBRIEFING — QUALITÀ DEL FOCUS</span>
        </div>
        {focusQualityStats.ratedTotal === 0 ? (
          <EmptyState
            variant="log"
            compact
            title="Karen: nessun Debriefing registrato"
            subtitle="Completa e valuta la tua prima sessione di Focus in Stark-Web Terminal per popolare questa sezione."
          />
        ) : (
          <div className="relative space-y-4">
            {QUALITY_ORDER.map((quality) => {
              const meta = FOCUS_QUALITY_META[quality];
              const count = focusQualityStats.counts[quality];
              const pct = focusQualityStats.ratedTotal > 0 ? Math.round((count / focusQualityStats.ratedTotal) * 100) : 0;
              return (
                <div key={quality} className="space-y-1.5">
                  <div className="flex items-center justify-between text-base gap-2">
                    <span className={`flex items-center gap-2 font-semibold ${meta.color}`}>
                      <Icon name={meta.icon} className="w-5 h-5" />
                      {meta.shortLabel}
                    </span>
                    <span className="font-mono text-slate-400 text-sm">{count} sessioni · {pct}%</span>
                  </div>
                  <div className="h-2.5 rounded-full bg-surface/80 border border-secondary/15 overflow-hidden">
                    <div
                      className={`h-full transition-all duration-700 ${QUALITY_BAR_CLASS[quality]}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
            <p className="text-sm text-slate-500 pt-1">
              {focusQualityStats.ratedTotal} sessioni valutate su {focusQualityStats.totalSessions} registrate in totale.
            </p>
          </div>
        )}
      </div>

      {/* Web-Velocity Focus Analytics — ritmo di studio reale vs richiesto. */}
      <div className={CARD}>
        <div className="relative flex items-center gap-2 mb-5">
          <Icon name="bolt" className="w-5 h-5 text-accent" />
          <span className={H2}>WEB-VELOCITY FOCUS ANALYTICS</span>
        </div>
        {focusVelocity.materiaNome ? (
          <div className="relative flex flex-col sm:flex-row items-center gap-6">
            <RadarRing pct={focusVelocity.velocityPct} size={140} stroke={13} />
            <div className="flex-1 min-w-0 space-y-2 text-center sm:text-left">
              <p className="text-lg font-semibold text-white">
                Ritmo verso <span className="text-secondary">{focusVelocity.materiaNome}</span>
              </p>
              <p className="text-base text-slate-400">
                Media ultimi {WINDOW_DAYS} giorni: <span className="font-mono text-slate-200">{focusVelocity.avgDailyMinutes} min/giorno</span>
              </p>
              <p className="text-base text-slate-400">
                Ritmo richiesto: <span className="font-mono text-slate-200">{focusVelocity.targetDailyMinutes} min/giorno</span>
                {focusVelocity.remainingNodes > 0
                  ? ` per ${focusVelocity.remainingNodes} nodi in ${focusVelocity.daysLeft}gg`
                  : ' — quadrante già completato'}
              </p>
              <p
                className={`text-base font-semibold ${
                  focusVelocity.velocityPct >= 100
                    ? 'text-emerald-400'
                    : focusVelocity.velocityPct >= 60
                    ? 'text-accent'
                    : 'text-primary'
                }`}
              >
                {focusVelocity.velocityPct >= 100
                  ? 'Sei in anticipo sulla tabella di marcia.'
                  : focusVelocity.velocityPct >= 60
                  ? "Ritmo leggermente sotto l'obiettivo — spingi un po' di più."
                  : 'Ritmo critico: intensifica le sessioni di Focus.'}
              </p>
            </div>
          </div>
        ) : (
          <p className="relative text-base text-slate-400">
            Imposta una data d'esame su un nodo nel Web-Matrix per vedere qui il ritmo di avanzamento richiesto.
          </p>
        )}
      </div>

      {/* V16.0 (Pillar 4) — Heatmap Calendario a piena larghezza: nessuno
          scroll orizzontale, i quadratini si ridimensionano in proporzione
          al contenitore, tooltip preciso "Data: X Focus, Y XP" on-hover. */}
      <div className={`${CARD} w-full`}>
        <div className="relative flex items-center justify-between mb-4 flex-wrap gap-2">
          <span className={H2}>HEATMAP CALENDARIO</span>
          <div className="flex items-center gap-1.5 text-base text-slate-400">
            <span>Meno</span>
            {LEVEL_CLASSES.map((cls, i) => (
              <div key={i} className={`w-3.5 h-3.5 rounded-sm border ${cls}`} />
            ))}
            <span>Più</span>
          </div>
        </div>
        <div className="relative w-full flex-1 flex gap-1">
          {weeks.map((col, wi) => (
            <div key={wi} className="flex-1 flex flex-col gap-1 min-w-0">
              {col.map((day) => (
                <HeatmapDay key={day.key} day={day} />
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Web-Matrix Radar — stabilità sinaptica globale e per materia. */}
      <div className={`${CARD} space-y-6`}>
        <div className="relative flex items-center gap-2">
          <Icon name="grid" className="w-5 h-5 text-secondary" />
          <span className={H2}>WEB-MATRIX RADAR</span>
        </div>

        <div className="relative pb-2 border-b border-white/10">
          <RadarCard title="Stabilità Sinaptica Globale" radar={derived.memoryRadar.global} />
        </div>

        {derived.memoryRadar.byMateria.length === 0 ? (
          <p className="relative text-base text-slate-500">Nessuna materia ancora attiva.</p>
        ) : (
          <div className="relative grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {derived.memoryRadar.byMateria.map((m) => (
              <RadarCard key={m.materiaId} title={m.materiaNome} radar={m} compact />
            ))}
          </div>
        )}
      </div>

      <div className={CARD}>
        <div className="relative flex items-center justify-between mb-4 flex-wrap gap-3">
          <span className={`${H2} flex items-center gap-2`}>
            <Icon name="alertTriangle" className="w-5 h-5 text-accent" />
            RADAR SPIDER-SENSE
          </span>
          <Dropdown value={sortKey} onChange={setSortKey} options={SORT_OPTIONS} className="w-64" />
        </div>

        {sortedReviews.length === 0 ? (
          <EmptyState
            variant="safe"
            compact
            title="La città è sicura."
            subtitle="Nessun ripasso in sospeso — torna dopo aver completato nuovi nodi."
          />
        ) : (
          <div className="relative overflow-x-auto af-scroll">
            <table className="w-full text-base">
              <thead>
                <tr className="text-left text-base text-slate-500 border-b border-white/10">
                  <th className="py-2 pr-4 font-medium">Materia</th>
                  <th className="py-2 pr-4 font-medium">Nodo</th>
                  <th className="py-2 pr-4 font-medium">Difficoltà</th>
                  <th className="py-2 pr-4 font-medium">Ripasso da</th>
                  <th className="py-2 pr-4 font-medium">Azione</th>
                </tr>
              </thead>
              <tbody>
                {sortedReviews.map((row) => {
                  const diffMeta = DIFFICULTY_META[row.difficulty];
                  return (
                    <tr key={row.sfidaId} className="border-b border-white/5 hover:bg-white/5 transition-all duration-300">
                      <td className="py-2.5 pr-4 text-slate-200">{row.materiaNome}</td>
                      <td className="py-2.5 pr-4 text-slate-200">{row.sfidaNome}</td>
                      <td className="py-2.5 pr-4">
                        <span className={`text-base font-mono px-2 py-0.5 rounded-full border ${diffMeta.border} ${diffMeta.color}`}>
                          {diffMeta.label}
                        </span>
                      </td>
                      <td className="py-2.5 pr-4 font-mono text-accent">{row.nextReviewDate}</td>
                      <td className="py-2.5 pr-4">
                        <div className="flex gap-1.5">
                          {Object.values(REVIEW_RATING).map((rating) => (
                            <button
                              key={rating}
                              type="button"
                              onClick={() => actions.reviewSfida(row.materiaId, row.sfidaId, rating)}
                              className={`text-base px-2.5 py-1 rounded-lg border ${REVIEW_RATING_META[rating].border} ${REVIEW_RATING_META[rating].color} bg-white/[0.02] hover:brightness-125 transition-all duration-300`}
                            >
                              {REVIEW_RATING_META[rating].label}
                            </button>
                          ))}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* V16.0 (Pillar 5) — Cronologia Sessioni: Accordion per Mese/Anno,
          mese corrente aperto di default, mesi passati collassati. Scala a
          centinaia di sessioni senza diventare un ammasso illeggibile. */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 px-1">
          <Icon name="chartBar" className="w-5 h-5 text-secondary" />
          <span className={H2}>CRONOLOGIA SESSIONI</span>
        </div>
        {monthGroups.length === 0 ? (
          <div className={CARD}>
            <EmptyState
              variant="log"
              compact
              title="Karen: nessuna sessione registrata"
              subtitle="Completa una sessione di Focus o un Sinister Six Simulator per iniziare a popolare la cronologia mensile."
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
                  className="w-full flex items-center justify-between gap-3 px-6 py-4 text-left"
                  aria-expanded={open}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-secondary/10 border border-secondary/25 flex items-center justify-center text-secondary shrink-0">
                      <Icon name="chartBar" className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-base font-semibold text-white truncate">{g.label}</p>
                      <p className="text-xs text-slate-500 truncate">
                        {g.entries.length} eventi · {g.totalMinutesMonth} min · {g.totalXpMonth} XP
                        {(g.wins > 0 || g.losses > 0) && ` · Boss ${g.wins}V/${g.losses}S`}
                      </p>
                    </div>
                  </div>
                  <Icon
                    name="chevronDown"
                    className={`w-5 h-5 text-slate-500 shrink-0 transition-transform duration-300 ${open ? 'rotate-180' : ''}`}
                  />
                </button>
                {open && (
                  <div className="px-6 pb-6 pt-1 space-y-2 border-t border-secondary/10">
                    {g.entries.map((entry) => (
                      <TimelineEntry key={entry.timestamp || `${entry.type}-${entry.dateKey}-${entry.minutes || entry.hpRemaining || 0}`} entry={entry} />
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
