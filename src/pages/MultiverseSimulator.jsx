import React, { useMemo, useState } from 'react';
import { useArachnoForge } from '../context/ArachnoForgeContext.jsx';
import { Icon } from '../components/Icons.jsx';
import EmptyState from '../components/EmptyState.jsx';
import {
  MIN_VOTO,
  MAX_VOTO,
  WHAT_IF_SLOT_COUNT,
  DEFAULT_WHAT_IF_VOTO,
  computeWeightedAverage,
  computeGraduationProjection,
  computeMarginalProjection,
  computeWhatIfProjection,
  getTopIncompleteByScore,
  computeGraduationForecast,
  computeGradeHistory,
  CAREER_MIN_EXAMS
} from '../utils/gpaEngine.js';
import { formatDateOnlyHuman, formatMonthYearHuman, monthKeyFromDateKey, dateOnlyToUtcMs, formatHoursMinutes } from '../utils/dateUtils.js';
import { CARD, CARD_BARE, H1, H2, BADGE } from '../utils/designSystem.js';

/** Slider "Stark-Tech" per il voto ipotizzato (18-30), tinta Accento (Decay) — coerente col resto del Design System, mai uno slider nativo. */
function VotoSlider({ value, onChange }) {
  return (
    <div>
      <input
        type="range"
        min={MIN_VOTO}
        max={MAX_VOTO}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-2 rounded-full appearance-none bg-surface/80 border border-white/10 cursor-pointer accent-accent"
      />
      <div className="flex items-center justify-between mt-1.5">
        <span className="text-xs text-slate-500">{MIN_VOTO}</span>
        <span className="text-lg font-mono font-bold text-accent">{value}{value === MAX_VOTO ? ' e lode' : ''}</span>
        <span className="text-xs text-slate-500">{MAX_VOTO}</span>
      </div>
    </div>
  );
}

/** Card numerica grande — riusata per Media Ponderata e Proiezione di Laurea, mai un box piatto. */
function StatHero({ icon, label, value, suffix, accent, hint }) {
  return (
    <div className={`${CARD} flex flex-col items-center text-center`}>
      <div className={`absolute -top-12 left-1/2 -translate-x-1/2 w-48 h-48 rounded-full ${accent.glowBg} blur-3xl pointer-events-none`} />
      <div className={`relative w-12 h-12 rounded-xl ${accent.iconBg} border ${accent.border} flex items-center justify-center ${accent.text} mb-3`}>
        <Icon name={icon} className="w-6 h-6" />
      </div>
      <p className="relative text-sm tracking-widest text-slate-500">{label}</p>
      <p className={`relative text-5xl font-mono font-extrabold mt-2 ${accent.text}`}>
        {value}
        {suffix && <span className="text-2xl text-slate-500 ml-1">{suffix}</span>}
      </p>
      {hint && <p className="relative text-sm text-slate-400 mt-2 leading-relaxed">{hint}</p>}
    </div>
  );
}

/**
 * V32.0 — Storico Media Ponderata: grafico a linee SVG "a mano" (nessuna
 * nuova dipendenza npm). Asse Y fisso 18-30 (range voti italiano).
 * V39.0 — asse X nel TEMPO reale (prima: punti a distanza fissa,
 * qualunque fosse l'intervallo fra due esami), con le date di inizio e
 * fine sotto l'asse; il punto degli esami senza data è un cerchio vuoto.
 */
function GradeHistoryChart({ history }) {
  const W = 600;
  const H = 220;
  const PAD_L = 36;
  const PAD_R = 20;
  const PAD_T = 16;
  const PAD_B = 34;
  const Y_MIN = 18;
  const Y_MAX = 30;

  const times = history.map((e) => dateOnlyToUtcMs(e.dateKey)).filter(Number.isFinite);
  const tMin = times.length ? Math.min(...times) : 0;
  const tMax = times.length ? Math.max(...times) : 0;
  const span = tMax - tMin;

  const points = history.map((entry, i) => {
    const t = dateOnlyToUtcMs(entry.dateKey);
    let x;
    if (history.length === 1) x = (PAD_L + W - PAD_R) / 2;
    else if (span > 0 && Number.isFinite(t)) x = PAD_L + ((t - tMin) / span) * (W - PAD_L - PAD_R);
    else x = PAD_L + (i / (history.length - 1)) * (W - PAD_L - PAD_R);
    const clamped = Math.min(Y_MAX, Math.max(Y_MIN, entry.average));
    const y = H - PAD_B - ((clamped - Y_MIN) / (Y_MAX - Y_MIN)) * (H - PAD_T - PAD_B);
    return { x, y, entry };
  });

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const area =
    points.length > 1
      ? `${path} L${points[points.length - 1].x.toFixed(1)},${H - PAD_B} L${points[0].x.toFixed(1)},${H - PAD_B} Z`
      : null;
  const gridLines = [18, 21, 24, 27, 30];
  const first = history[0];
  const last = history[history.length - 1];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Storico Media Ponderata">
      <defs>
        <linearGradient id="af-grade-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgb(var(--af-refuel-rgb))" stopOpacity="0.22" />
          <stop offset="100%" stopColor="rgb(var(--af-refuel-rgb))" stopOpacity="0" />
        </linearGradient>
      </defs>
      {gridLines.map((v) => {
        const y = H - PAD_B - ((v - Y_MIN) / (Y_MAX - Y_MIN)) * (H - PAD_T - PAD_B);
        return (
          <g key={v}>
            <line x1={PAD_L} y1={y} x2={W - PAD_R} y2={y} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
            <text x={4} y={y + 4} fontSize="11" fill="rgba(148,163,184,0.8)" fontFamily="monospace">
              {v}
            </text>
          </g>
        );
      })}
      {area && <path d={area} fill="url(#af-grade-area)" />}
      {points.length > 1 && (
        <path d={path} fill="none" stroke="rgb(var(--af-refuel-rgb))" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      )}
      {points.map((p, i) => (
        <circle
          key={i}
          cx={p.x}
          cy={p.y}
          r="5"
          fill={p.entry.senzaData ? '#0b1220' : 'rgb(var(--af-refuel-rgb))'}
          stroke={p.entry.senzaData ? 'rgb(var(--af-refuel-rgb))' : '#0b1220'}
          strokeWidth={p.entry.senzaData ? 2 : 1.5}
        >
          <title>
            {`${p.entry.senzaData ? 'Esami senza data' : formatDateOnlyHuman(p.entry.dateKey)} — media ${p.entry.average.toFixed(2)}${
              Array.isArray(p.entry.esami) && p.entry.esami.length ? ` · ${p.entry.esami.join(', ')}` : ''
            }`}
          </title>
        </circle>
      ))}
      {first && (
        <text x={PAD_L} y={H - 10} fontSize="11" fill="rgba(148,163,184,0.8)" fontFamily="monospace">
          {first.senzaData ? 'senza data' : formatDateOnlyHuman(first.dateKey)}
        </text>
      )}
      {last && history.length > 1 && (
        <text x={W - PAD_R} y={H - 10} fontSize="11" fill="rgba(148,163,184,0.8)" fontFamily="monospace" textAnchor="end">
          {last.senzaData ? 'oggi' : formatDateOnlyHuman(last.dateKey)}
        </text>
      )}
    </svg>
  );
}

const ACCENT = {
  secondary: {
    text: 'text-secondary',
    border: 'border-secondary/40',
    iconBg: 'bg-secondary/15',
    glowBg: 'bg-secondary/15'
  },
  primary: {
    text: 'text-primary',
    border: 'border-primary/40',
    iconBg: 'bg-primary/15',
    glowBg: 'bg-primary/15'
  }
};

/**
 * V37.0 — "QUANDO MI LAUREO".
 *
 * Il Multiverse Simulator sapeva dire con CHE VOTO ci si laurea, mai
 * quando. Ed è la domanda che conta davvero il giorno in cui decidi se
 * puoi permetterti di saltare un appello.
 *
 * Due stime affiancate, perché misurano cose diverse e sbagliano in modi
 * diversi (vedi computeGraduationForecast in utils/gpaEngine.js). Quando
 * divergono, la distanza fra le due È l'informazione: significa che il
 * ritmo di studio e il ritmo con cui gli esami vengono effettivamente
 * verbalizzati non coincidono.
 */
function GraduationForecastCard({ forecast }) {
  if (!forecast) return null;

  if (forecast.done) {
    return (
      <div className={`${CARD_BARE} border-emerald-400/40`}>
        <div className="relative flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-emerald-900/40 border border-emerald-400/40 flex items-center justify-center text-emerald-400 shrink-0">
            <Icon name="trophy" className="w-6 h-6" />
          </div>
          <div>
            <p className="text-[11px] font-mono tracking-[0.2em] text-emerald-400">PIANO COMPLETATO</p>
            <p className="text-lg font-bold text-white">
              {forecast.cfuAcquisiti}/{forecast.cfuTotali} CFU acquisiti. Non manca più niente.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const CONFIDENCE_META = {
    ALTA: { label: 'stima affidabile', cls: 'text-emerald-300' },
    MEDIA: { label: 'stima indicativa', cls: 'text-accent' },
    BASSA: { label: 'stima ancora grezza', cls: 'text-slate-400' }
  };
  const conf = CONFIDENCE_META[forecast.confidence] || CONFIDENCE_META.BASSA;

  return (
    <div className={`${CARD_BARE} border-accent/30`}>
      <div className="absolute -top-20 -right-16 w-64 h-64 rounded-full bg-accent/10 blur-3xl pointer-events-none" />

      <div className="relative flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-11 h-11 rounded-xl bg-accent/15 border border-accent/40 flex items-center justify-center text-accent shrink-0">
            <Icon name="calendar" className="w-6 h-6" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-mono tracking-[0.2em] text-accent">TEMPO STIMATO ALLA LAUREA</p>
            <p className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
              {formatMonthYearHuman(monthKeyFromDateKey(forecast.dateKey))}
            </p>
            <p className={`text-xs mt-0.5 ${conf.cls}`}>
              {conf.label} ·{' '}
              {forecast.metodo === 'CARRIERA' ? 'basata sul tuo ritmo di carriera' : 'basata sul carico di studio residuo'}
            </p>
          </div>
        </div>

        <div className="text-right shrink-0">
          <p className="text-3xl font-mono font-bold af-mono-nums text-white leading-none">{forecast.progressPct}%</p>
          <p className="text-[11px] text-slate-500 tracking-widest mt-1">
            {forecast.cfuAcquisiti}/{forecast.cfuTotali} CFU
          </p>
        </div>
      </div>

      {/* Barra di avanzamento del piano: l'unico numero che non è una
          proiezione ma un fatto già acquisito. */}
      <div className="relative mt-4 h-2.5 af-web-bar bg-surface/80 rounded-full overflow-hidden border border-white/10">
        <div
          className="h-full bg-gradient-to-r from-accent to-accent/60 transition-[width] duration-700"
          style={{ width: `${forecast.progressPct}%` }}
        />
      </div>

      <div className="relative mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="rounded-xl border border-secondary/25 bg-secondary/[0.06] p-3.5">
          <p className="text-[11px] font-mono tracking-[0.2em] text-secondary">RITMO DI STUDIO</p>
          <p className="text-xl font-extrabold text-white mt-1">
            {forecast.byWorkload.mesi} <span className="text-sm font-semibold text-slate-400">mesi</span>
          </p>
          <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
            {forecast.byWorkload.oreResidue}h di lavoro residuo a {formatHoursMinutes(forecast.byWorkload.capacitaOreGiorno)} al giorno.
            {!forecast.byWorkload.confident && ' Capacità non ancora calibrata sulle tue giornate reali.'}
            {forecast.byWorkload.oreNonTracciate > 0 &&
              ` Include ${forecast.byWorkload.oreNonTracciate}h stimate per i CFU non ancora aperti nel Web-Matrix.`}
          </p>
        </div>

        <div
          className={`rounded-xl border p-3.5 ${
            forecast.byCareer ? 'border-accent/25 bg-accent/[0.06]' : 'border-white/10 bg-white/[0.02]'
          }`}
        >
          <p className="text-[11px] font-mono tracking-[0.2em] text-accent">RITMO DI CARRIERA</p>
          {forecast.byCareer ? (
            <>
              <p className="text-xl font-extrabold text-white mt-1">
                {forecast.byCareer.mesi} <span className="text-sm font-semibold text-slate-400">mesi</span>
              </p>
              <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
                {forecast.byCareer.cfuAlMese} CFU/mese, misurati su {forecast.byCareer.esamiOsservati} esami superati.
                {forecast.byCareer.stimateDaAppello > 0 &&
                  ` Per ${forecast.byCareer.stimateDaAppello} manca la data di verbalizzazione: si usa quella dell\u2019appello.`}
                {!forecast.byCareer.confident && ' Servono almeno 5 esami con data e un anno di storico per renderla solida.'}
              </p>
            </>
          ) : (
            <p className="text-xs text-slate-500 mt-2 leading-relaxed">
              Non ancora calcolabile: servono almeno {CAREER_MIN_EXAMS} esami superati con una data (quella di{' '}
              <span className="text-slate-300">verbalizzazione</span>, oppure quella dell&apos;appello se è già passata).
              {forecast.esamiSuperati > 0 && (
                <>
                  {' '}
                  Ora: <span className="font-mono text-slate-300">{forecast.esamiConData}</span> con data su{' '}
                  <span className="font-mono text-slate-300">{forecast.esamiSuperati}</span> superati
                  {forecast.esamiConData < forecast.esamiSuperati ? ' — apri gli altri nel Web-Matrix e aggiungi la data.' : '.'}
                </>
              )}
            </p>
          )}
        </div>
      </div>

      {forecast.limitataDaAppello && (
        <p className="relative text-xs text-accent mt-3 leading-relaxed flex items-start gap-1.5">
          <Icon name="alertTriangle" className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          Il lavoro sarebbe finito prima, ma l'appello più lontano già fissato è il{' '}
          {formatDateOnlyHuman(forecast.ultimoAppello)}: è quello a dettare la data.
        </p>
      )}

      <p className="relative text-xs text-slate-500 mt-3 leading-relaxed">
        Karen: è una proiezione, non una promessa. Migliora da sola man mano che registri le date di verbalizzazione e
        accumuli sessioni di Focus reali.
      </p>
    </div>
  );
}

export default function MultiverseSimulator() {
  const { state, derived } = useArachnoForge();
  const materie = Array.isArray(state.materie) ? state.materie : [];

  // V37.0 — la stima usa la calibrazione reale (capacità giornaliera,
  // bias sulle stime, ritmo pagine/ora) già calcolata una sola volta a
  // livello di Provider: nessun secondo motore che possa divergere.
  const graduationForecast = useMemo(
    () => computeGraduationForecast(materie, derived.calibration),
    [materie, derived.calibration]
  );

  const { average, totalCfu, gradedCount } = useMemo(() => computeWeightedAverage(materie), [materie]);
  const projection = useMemo(() => computeGraduationProjection(average), [average]);

  // V32.0 — Storico Media Ponderata: ledger append-only popolato dal
  // reducer (vedi ArachnoForgeContext, case UPDATE_MATERIA) a ogni prima
  // "votazione" di una Materia. Filtrato difensivamente qui in aggiunta
  // alla blindatura già presente in hydrateState.
  // V39.0 — ricostruito dalle Materie (utils/gpaEngine.js,
  // computeGradeHistory): un voto o una data corretti nel Web-Matrix
  // spostano subito la curva, e gli esami inseriti già "superati" ci
  // sono tutti — col vecchio registro a parte ne compariva uno solo.
  const gradeHistoryInfo = useMemo(() => computeGradeHistory(materie), [materie]);
  const gradeHistory = gradeHistoryInfo.points;

  const gradedMaterie = useMemo(
    () => materie.filter((m) => m && m.examPassed && Number.isFinite(m.voto)).sort((a, b) => b.voto - a.voto),
    [materie]
  );

  // What-If Scenario — V20.0 (Pillar 4): i 2 esami non ancora superati con
  // lo Spider-Score più alto (gli stessi che Karen consiglierebbe nel
  // Web-Matrix), secondo la Direttiva Suprema "due slider fittizi".
  const whatIfSlots = useMemo(
    () => getTopIncompleteByScore(materie, WHAT_IF_SLOT_COUNT, derived.calibration),
    [materie, derived.calibration]
  );
  const [simulatedVoti, setSimulatedVoti] = useState({});

  const getVoto = (materiaId) => simulatedVoti[materiaId] ?? DEFAULT_WHAT_IF_VOTO;
  const setVoto = (materiaId, voto) => setSimulatedVoti((prev) => ({ ...prev, [materiaId]: voto }));

  const combinedWhatIf = useMemo(() => {
    const entries = whatIfSlots.map((m) => ({ cfu: m.cfu, voto: getVoto(m.id) }));
    return computeWhatIfProjection(materie, entries);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [whatIfSlots, simulatedVoti, materie]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className={H1}>Multiverse Simulator</h1>
        <p className="text-base text-slate-400 mt-1.5">
          Karen: proiezioni multiversali attive. Tempo alla laurea, Media Ponderata e scenari What-If in tempo reale.
        </p>
      </div>

      {/* V37.0 — la domanda che l'app non sapeva rispondere: quando. */}
      <GraduationForecastCard forecast={graduationForecast} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <StatHero
          icon="chartBar"
          label="MEDIA PONDERATA REALE"
          value={average != null ? average.toFixed(2) : '—'}
          suffix={average != null ? '/ 30' : ''}
          accent={ACCENT.secondary}
          hint={
            average != null
              ? `${gradedCount} esami votati · ${totalCfu} CFU pesati.`
              : 'Nessun voto registrato ancora. Segna "Esame Superato" con un Voto su una Materia del Web-Matrix per attivare il calcolo.'
          }
        />
        <StatHero
          icon="trophy"
          label="PROIEZIONE DI LAUREA"
          value={projection != null ? projection.toFixed(1) : '—'}
          suffix={projection != null ? '/ 110' : ''}
          accent={ACCENT.primary}
          hint={
            projection != null
              ? 'Voto di partenza = Media Ponderata × 11 / 3. Punteggio puro: bonus tesi/attività non inclusi.'
              : 'La proiezione si attiva non appena la Media Ponderata ha almeno un voto.'
          }
        />
      </div>

      {/* Dettaglio esami votati */}
      <div className={CARD}>
        <div className="relative flex items-center gap-2 mb-4">
          <Icon name="book" className="w-5 h-5 text-secondary" />
          <span className={H2}>Esami Votati</span>
          <span className={`${BADGE.blue} ml-auto`}>{gradedMaterie.length}</span>
        </div>
        {gradedMaterie.length === 0 ? (
          <EmptyState
            variant="log"
            compact
            title="Karen: nessun esame votato ancora"
            subtitle="Torna nel Web-Matrix, segna un esame come Superato e inserisci il Voto per popolare questa lista."
          />
        ) : (
          <div className="relative space-y-2">
            {gradedMaterie.map((m) => (
              <div key={m.id} className="flex items-center justify-between gap-3 py-2.5 px-3.5 rounded-xl bg-surface/60 border border-secondary/10">
                <div className="min-w-0">
                  <p className="text-sm text-slate-200 truncate">{m.nome}</p>
                  <p className="text-xs text-slate-500">{m.cfu} CFU</p>
                </div>
                <span className={m.voto >= 28 ? BADGE.green : m.voto >= 24 ? BADGE.blue : BADGE.amber}>
                  {m.voto}{m.lode ? ' e lode' : ''}/30
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Storico Media Ponderata */}
      <div className={CARD}>
        <div className="relative flex items-center gap-2 mb-4">
          <Icon name="trendUp" className="w-5 h-5 text-secondary" />
          <span className={H2}>Storico Media Ponderata</span>
          {gradeHistory.length > 0 && <span className={`${BADGE.blue} ml-auto`}>{gradeHistory.length}</span>}
        </div>
        {gradeHistory.length === 0 ? (
          <EmptyState
            variant="log"
            compact
            title="Karen: nessuno storico ancora"
            subtitle="Ogni volta che registri il Voto di un nuovo esame superato, un punto viene aggiunto qui — traccia l'andamento della tua Media nel multiverso."
          />
        ) : (
          <div key={gradeHistory.length} className="relative af-chart-reveal">
            <GradeHistoryChart history={gradeHistory} />
            <p className="text-xs text-slate-500 mt-2 leading-relaxed">
              {gradeHistory.length === 1
                ? 'Un solo punto: con il prossimo esame votato (o aggiungendo la data agli esami già inseriti) comparirà l’andamento.'
                : `Da ${gradeHistory[0].average.toFixed(2)} a ${gradeHistory[gradeHistory.length - 1].average.toFixed(2)} · ${
                    gradeHistory[gradeHistory.length - 1].gradedCount
                  } esami votati.`}
              {gradeHistoryInfo.stimateDaAppello > 0 &&
                ` ${gradeHistoryInfo.stimateDaAppello === 1 ? '1 esame è collocato' : `${gradeHistoryInfo.stimateDaAppello} esami sono collocati`} alla data dell’appello perché manca quella di verbalizzazione.`}
              {gradeHistoryInfo.undatedCount > 0 &&
                ` ${gradeHistoryInfo.undatedCount === 1 ? '1 esame senza alcuna data entra' : `${gradeHistoryInfo.undatedCount} esami senza alcuna data entrano`} solo nell’ultimo punto (cerchio vuoto): aggiungi la data nel Web-Matrix per collocarli nel tempo.`}
            </p>

          </div>
        )}
      </div>

      {/* What-If Scenario */}
      <div className={`${CARD} space-y-5`}>
        <div className="relative flex items-center gap-2">
          <Icon name="bolt" className="w-5 h-5 text-accent" />
          <span className={H2}>What-If Scenario</span>
        </div>
        <p className="relative text-sm text-slate-400 -mt-3">
          Karen simula i tuoi prossimi esami prioritari (stesso ordine del Web-Path Planner) e proietta l'effetto sul voto di laurea, senza toccare i tuoi dati reali.
        </p>

        {whatIfSlots.length === 0 ? (
          <EmptyState
            variant="radar"
            compact
            title="Karen: nessun esame da simulare"
            subtitle="Apri almeno un nodo nel Web-Matrix ancora da superare per attivare il What-If Scenario."
          />
        ) : (
          <>
            <div className="relative grid grid-cols-1 md:grid-cols-2 gap-4">
              {whatIfSlots.map((m) => {
                const voto = getVoto(m.id);
                const marginal = computeMarginalProjection(materie, m.cfu, voto);
                const baseline = projection;
                const delta = baseline != null && marginal.projection != null ? Math.round((marginal.projection - baseline) * 10) / 10 : null;
                return (
                  <div key={m.id} className="bg-surface/70 border border-accent/20 rounded-2xl p-4 space-y-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-100 truncate">{m.nome}</p>
                      <p className="text-xs text-slate-500">{m.cfu} CFU</p>
                    </div>
                    <VotoSlider value={voto} onChange={(v) => setVoto(m.id, v)} />
                    <p className="text-xs text-slate-400 leading-relaxed pt-2 border-t border-white/5">
                      Karen: se prendi <span className="text-accent font-mono">{voto}</span> in <span className="text-slate-200">{m.nome}</span>, il tuo voto di partenza{' '}
                      {baseline == null
                        ? <>si stabilirebbe a <span className="font-mono text-white">{marginal.projection?.toFixed(1)}</span>.</>
                        : delta > 0
                        ? <>salirà a <span className="font-mono text-emerald-400">{marginal.projection.toFixed(1)}</span> (+{delta.toFixed(1)}).</>
                        : delta < 0
                        ? <>scenderà a <span className="font-mono text-primary">{marginal.projection.toFixed(1)}</span> ({delta.toFixed(1)}).</>
                        : <>resterà a <span className="font-mono text-white">{marginal.projection.toFixed(1)}</span>.</>}
                    </p>
                  </div>
                );
              })}
            </div>

            <div className="relative flex items-center justify-between gap-3 bg-accent/10 border border-accent/30 rounded-xl px-5 py-4">
              <div>
                <p className="text-sm text-accent font-semibold flex items-center gap-1.5">
                  <Icon name="chip" className="w-4 h-4" />
                  Proiezione Combinata What-If
                </p>
                <p className="text-xs text-slate-400 mt-0.5">Se tutti e {whatIfSlots.length} gli esami simulati si verificassero insieme.</p>
              </div>
              <p className="text-3xl font-mono font-extrabold text-white">
                {combinedWhatIf.projection != null ? combinedWhatIf.projection.toFixed(1) : '—'}
                <span className="text-lg text-slate-500 ml-1">/ 110</span>
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
