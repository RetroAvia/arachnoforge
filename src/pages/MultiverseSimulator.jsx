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
import { CARD, CARD_NOPAD, BADGE } from '../utils/designSystem.js';
import PageHeader from '../components/PageHeader.jsx';
import { formatDecimal, formatInt, formatNumber } from '../utils/format.js';

/** Cursore del voto ipotizzato (18–30). La lode entra in media come 30. */
function VotoSlider({ value, onChange, label }) {
  const pct = ((value - MIN_VOTO) / (MAX_VOTO - MIN_VOTO)) * 100;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <span className="text-xs text-slate-400">Voto ipotizzato</span>
        <span className="text-lg font-bold text-accent ds-num">{value}</span>
      </div>
      <input
        type="range"
        min={MIN_VOTO}
        max={MAX_VOTO}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="ds-range"
        style={{ '--range-pct': `${pct}%`, '--range-fill': 'rgb(var(--af-decay-rgb))' }}
        aria-label={label}
        aria-valuetext={`${value} su 30`}
      />
      <div className="flex items-center justify-between mt-1 text-[11px] text-slate-500 ds-num">
        <span>{MIN_VOTO}</span>
        <span>{MAX_VOTO}</span>
      </div>
    </div>
  );
}

/** Card numerica: il numero grande a sinistra, il contesto sotto. */
function StatCard({ icon, iconTone, label, value, suffix, valueTone = 'text-white', hint, children }) {
  return (
    <div className={`${CARD} !p-5`}>
      <p className="text-xs text-slate-400 flex items-center gap-1.5">
        <Icon name={icon} className={`w-3.5 h-3.5 ${iconTone}`} />
        {label}
      </p>
      <p className={`mt-2 text-4xl font-bold tracking-tight ds-num ${valueTone}`}>
        {value}
        {suffix && <span className="text-lg font-semibold text-slate-500 ml-1.5">{suffix}</span>}
      </p>
      {hint && <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">{hint}</p>}
      {children}
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
            <text x={4} y={y + 4} fontSize="11" fill="rgba(148,163,184,0.75)">
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
          r="4"
          fill={p.entry.senzaData ? 'rgb(var(--af-panel-rgb))' : 'rgb(var(--af-refuel-rgb))'}
          stroke={p.entry.senzaData ? 'rgb(var(--af-refuel-rgb))' : 'rgb(var(--af-panel-rgb))'}
          strokeWidth={p.entry.senzaData ? 2 : 1.5}
        >
          <title>
            {`${p.entry.senzaData ? 'Esami senza data' : formatDateOnlyHuman(p.entry.dateKey)} — media ${formatDecimal(p.entry.average, 2)}${
              Array.isArray(p.entry.esami) && p.entry.esami.length ? ` · ${p.entry.esami.join(', ')}` : ''
            }`}
          </title>
        </circle>
      ))}
      {first && (
        <text x={PAD_L} y={H - 10} fontSize="11" fill="rgba(148,163,184,0.75)">
          {first.senzaData ? 'senza data' : formatDateOnlyHuman(first.dateKey)}
        </text>
      )}
      {last && history.length > 1 && (
        <text x={W - PAD_R} y={H - 10} fontSize="11" fill="rgba(148,163,184,0.75)" textAnchor="end">
          {last.senzaData ? 'oggi' : formatDateOnlyHuman(last.dateKey)}
        </text>
      )}
    </svg>
  );
}

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
      <div className={`${CARD} !border-emerald-400/35 flex items-center gap-3`}>
        <span className="ds-icon-tile text-emerald-300">
          <Icon name="trophy" className="w-[18px] h-[18px]" />
        </span>
        <div>
          <p className="ds-eyebrow !text-emerald-300">Piano completato</p>
          <p className="text-base font-semibold text-white">
            {forecast.cfuAcquisiti}/{forecast.cfuTotali} CFU acquisiti: non manca più niente.
          </p>
        </div>
      </div>
    );
  }

  const CONFIDENCE_META = {
    ALTA: { label: 'Stima affidabile', badge: BADGE.green },
    MEDIA: { label: 'Stima indicativa', badge: BADGE.amber },
    BASSA: { label: 'Stima ancora grezza', badge: BADGE.slate }
  };
  const conf = CONFIDENCE_META[forecast.confidence] || CONFIDENCE_META.BASSA;

  return (
    <section className={CARD_NOPAD} aria-label="Tempo stimato alla laurea">
      <div className="p-5 flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3.5 min-w-0">
          <span className="ds-icon-tile text-accent">
            <Icon name="calendar" className="w-[18px] h-[18px]" />
          </span>
          <div className="min-w-0">
            <p className="ds-eyebrow">Tempo stimato alla laurea</p>
            <p className="text-3xl font-bold text-white tracking-tight mt-0.5 first-letter:uppercase">
              {formatMonthYearHuman(monthKeyFromDateKey(forecast.dateKey))}
            </p>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <span className={conf.badge}>{conf.label}</span>
              <span className="text-xs text-slate-500">
                {forecast.metodo === 'CARRIERA' ? 'dal tuo ritmo di carriera' : 'dal carico di studio residuo'}
              </span>
            </div>
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="text-3xl font-bold text-white ds-num leading-none">{forecast.progressPct}%</p>
          <p className="text-xs text-slate-500 mt-1 ds-num">
            {forecast.cfuAcquisiti} di {forecast.cfuTotali} CFU
          </p>
        </div>
      </div>

      {/* L'unico numero che non è una proiezione: i CFU già acquisiti. */}
      <div className="px-5">
        <div className="ds-progress !h-2">
          <span className="bg-accent" style={{ width: `${forecast.progressPct}%` }} />
        </div>
      </div>

      <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="ds-well p-4">
          <p className="text-xs font-semibold text-secondary">Ritmo di studio</p>
          <p className="text-xl font-bold text-white mt-1 ds-num">
            {formatNumber(forecast.byWorkload.mesi, 1)} <span className="text-sm font-medium text-slate-400">mesi</span>
          </p>
          <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
            {formatInt(forecast.byWorkload.oreResidue)} ore di lavoro residuo a {formatHoursMinutes(forecast.byWorkload.capacitaOreGiorno)} al giorno.
            {!forecast.byWorkload.confident && ' Capacità non ancora calibrata sulle tue giornate reali.'}
            {forecast.byWorkload.oreNonTracciate > 0 &&
              ` Include ${formatInt(forecast.byWorkload.oreNonTracciate)} ore stimate per i CFU non ancora aperti nel Web-Matrix.`}
          </p>
        </div>

        <div className="ds-well p-4">
          <p className="text-xs font-semibold text-accent">Ritmo di carriera</p>
          {forecast.byCareer ? (
            <>
              <p className="text-xl font-bold text-white mt-1 ds-num">
                {formatNumber(forecast.byCareer.mesi, 1)} <span className="text-sm font-medium text-slate-400">mesi</span>
              </p>
              <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
                {formatNumber(forecast.byCareer.cfuAlMese, 1)} CFU al mese, misurati su {forecast.byCareer.esamiOsservati} esami superati.
                {forecast.byCareer.stimateDaAppello > 0 &&
                  ` Per ${forecast.byCareer.stimateDaAppello} manca la data di verbalizzazione: si usa quella dell’appello.`}
                {!forecast.byCareer.confident && ' Servono almeno 5 esami con data e un anno di storico per renderla solida.'}
              </p>
            </>
          ) : (
            <p className="text-xs text-slate-500 mt-2 leading-relaxed">
              Non ancora calcolabile: servono almeno {CAREER_MIN_EXAMS} esami superati con una data (quella di verbalizzazione, o
              quella dell&apos;appello se è già passata).
              {forecast.esamiSuperati > 0 && (
                <>
                  {' '}
                  Ora: <span className="ds-num text-slate-300">{forecast.esamiConData}</span> con data su{' '}
                  <span className="ds-num text-slate-300">{forecast.esamiSuperati}</span> superati
                  {forecast.esamiConData < forecast.esamiSuperati ? ': aggiungi la data agli altri nel Web-Matrix.' : '.'}
                </>
              )}
            </p>
          )}
        </div>
      </div>

      <div className="px-5 pb-5 space-y-2">
        {forecast.limitataDaAppello && (
          <p className="text-xs text-accent leading-relaxed flex items-start gap-1.5">
            <Icon name="alertTriangle" className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            Il lavoro sarebbe finito prima, ma l'appello più lontano già fissato è il {formatDateOnlyHuman(forecast.ultimoAppello)}: è
            quello a dettare la data.
          </p>
        )}
        <p className="text-xs text-slate-500 leading-relaxed">
          È una proiezione, non una promessa: migliora da sola man mano che registri le date di verbalizzazione e accumuli
          sessioni di Focus reali.
        </p>
      </div>
    </section>
  );
}

export default function MultiverseSimulator() {
  const { state, derived } = useArachnoForge();
  const materie = useMemo(() => (Array.isArray(state.materie) ? state.materie : []), [state.materie]);

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

  const cfuTotali = graduationForecast?.cfuTotali || 180;
  const cfuAcquisiti = graduationForecast?.cfuAcquisiti ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Media e laurea"
        icon="multiverse"
        title="Multiverse Simulator"
        subtitle="La tua media vera, il voto di partenza alla laurea, quando ti laurei e cosa cambierebbe con i prossimi esami."
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard
          icon="chartBar"
          iconTone="text-secondary"
          label="Media ponderata"
          value={average != null ? formatDecimal(average, 2) : '—'}
          suffix={average != null ? '/ 30' : ''}
          valueTone={average != null ? 'text-secondary' : 'text-slate-500'}
          hint={
            average != null
              ? `${gradedCount} ${gradedCount === 1 ? 'esame votato' : 'esami votati'} · ${totalCfu} CFU pesati`
              : 'Segna un esame come superato, con il voto, nel Web-Matrix.'
          }
        />
        <StatCard
          icon="trophy"
          iconTone="text-primary"
          label="Voto di partenza alla laurea"
          value={projection != null ? formatDecimal(projection, 1) : '—'}
          suffix={projection != null ? '/ 110' : ''}
          valueTone={projection != null ? 'text-primary' : 'text-slate-500'}
          hint={projection != null ? 'Media × 11 / 3, senza i punti di tesi e attività.' : 'Si attiva col primo voto registrato.'}
        />
        <StatCard
          icon="layers"
          iconTone="text-accent"
          label="CFU acquisiti"
          value={formatInt(cfuAcquisiti)}
          suffix={`/ ${formatInt(cfuTotali)}`}
          hint={`${Math.max(0, cfuTotali - cfuAcquisiti)} CFU ancora da conquistare`}
        >
          <div className="ds-progress mt-3">
            <span className="bg-accent" style={{ width: `${Math.min(100, (cfuAcquisiti / Math.max(1, cfuTotali)) * 100)}%` }} />
          </div>
        </StatCard>
      </div>

      {/* V37.0 — la domanda che l'app non sapeva rispondere: quando. */}
      <GraduationForecastCard forecast={graduationForecast} />

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-5 items-start">
        {/* Storico della media */}
        <section className={`${CARD} xl:col-span-3 space-y-3`} aria-label="Storico della media ponderata">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-[15px] font-semibold text-white flex items-center gap-2">
              <Icon name="trendUp" className="w-4 h-4 text-secondary" />
              Andamento della media
            </h2>
            {gradeHistory.length > 1 && (
              <span className="text-xs text-slate-500 ds-num">
                da {formatDecimal(gradeHistory[0].average, 2)} a {formatDecimal(gradeHistory[gradeHistory.length - 1].average, 2)}
              </span>
            )}
          </div>
          {gradeHistory.length === 0 ? (
            <EmptyState
              variant="log"
              compact
              title="Nessuno storico ancora"
              subtitle="Ogni esame superato con il voto aggiunge un punto: qui vedrai come si muove la media nel tempo."
            />
          ) : (
            <div key={gradeHistory.length} className="af-chart-reveal">
              <GradeHistoryChart history={gradeHistory} />
              <p className="text-xs text-slate-500 mt-2 leading-relaxed">
                {gradeHistory.length === 1
                  ? 'Un solo punto: col prossimo esame votato (o aggiungendo la data a quelli già inseriti) comparirà l’andamento.'
                  : `${gradeHistory[gradeHistory.length - 1].gradedCount} esami votati.`}
                {gradeHistoryInfo.stimateDaAppello > 0 &&
                  ` ${gradeHistoryInfo.stimateDaAppello === 1 ? '1 esame è collocato' : `${gradeHistoryInfo.stimateDaAppello} esami sono collocati`} alla data dell’appello perché manca quella di verbalizzazione.`}
                {gradeHistoryInfo.undatedCount > 0 &&
                  ` ${gradeHistoryInfo.undatedCount === 1 ? '1 esame senza data entra' : `${gradeHistoryInfo.undatedCount} esami senza data entrano`} solo nell’ultimo punto (cerchio vuoto): aggiungi la data nel Web-Matrix per collocarli nel tempo.`}
              </p>
            </div>
          )}
        </section>

        {/* Esami votati */}
        <section className={`${CARD_NOPAD} xl:col-span-2`} aria-label="Esami votati">
          <div className="flex items-center justify-between gap-2 px-5 py-4 border-b border-line">
            <h2 className="text-[15px] font-semibold text-white flex items-center gap-2">
              <Icon name="book" className="w-4 h-4 text-secondary" />
              Esami votati
            </h2>
            <span className={BADGE.slate}>{gradedMaterie.length}</span>
          </div>
          {gradedMaterie.length === 0 ? (
            <div className="p-5">
              <EmptyState
                variant="log"
                compact
                title="Nessun esame votato"
                subtitle="Nel Web-Matrix, segna un esame come superato e inserisci il voto."
              />
            </div>
          ) : (
            <ul className="max-h-[360px] overflow-y-auto af-scroll divide-y divide-white/[0.06]">
              {gradedMaterie.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                  <div className="min-w-0">
                    <p className="text-[13.5px] text-slate-100 truncate">{m.nome}</p>
                    <p className="text-xs text-slate-500 ds-num">
                      {m.cfu} CFU{m.examPassedDate ? ` · ${formatDateOnlyHuman(m.examPassedDate)}` : ''}
                    </p>
                  </div>
                  <span className={`${m.voto >= 28 ? BADGE.green : m.voto >= 24 ? BADGE.blue : BADGE.amber} ds-num`}>
                    {m.voto}
                    {m.lode ? ' e lode' : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* What-If: i prossimi esami prioritari, simulati senza toccare i dati veri. */}
      <section className={`${CARD} space-y-4`} aria-label="Scenario What-If">
        <div>
          <h2 className="text-[15px] font-semibold text-white flex items-center gap-2">
            <Icon name="bolt" className="w-4 h-4 text-accent" />
            Scenario What-If
          </h2>
          <p className="text-[13px] text-slate-400 mt-0.5">
            I tuoi prossimi esami prioritari (lo stesso ordine del Web-Matrix): muovi il voto e guarda cosa succede alla laurea. I dati
            veri non cambiano.
          </p>
        </div>

        {whatIfSlots.length === 0 ? (
          <EmptyState
            variant="radar"
            compact
            title="Nessun esame da simulare"
            subtitle="Aggiungi nel Web-Matrix almeno una materia ancora da superare."
          />
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {whatIfSlots.map((m) => {
                const voto = getVoto(m.id);
                const marginal = computeMarginalProjection(materie, m.cfu, voto);
                const baseline = projection;
                const delta = baseline != null && marginal.projection != null ? Math.round((marginal.projection - baseline) * 10) / 10 : null;
                return (
                  <div key={m.id} className="ds-well p-4 space-y-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-100 truncate">{m.nome}</p>
                      <p className="text-xs text-slate-500">{m.cfu} CFU</p>
                    </div>
                    <VotoSlider value={voto} onChange={(v) => setVoto(m.id, v)} label={`Voto ipotizzato per ${m.nome}`} />
                    <p className="text-xs text-slate-400 leading-relaxed pt-2.5 border-t border-line">
                      Con <span className="text-accent font-semibold ds-num">{voto}</span> il voto di partenza{' '}
                      {marginal.projection == null ? (
                        'non cambia.'
                      ) : baseline == null ? (
                        <>
                          si fisserebbe a <span className="ds-num text-white font-semibold">{formatDecimal(marginal.projection, 1)}</span>.
                        </>
                      ) : delta > 0 ? (
                        <>
                          sale a <span className="ds-num text-emerald-300 font-semibold">{formatDecimal(marginal.projection, 1)}</span> (+
                          {formatDecimal(delta, 1)}).
                        </>
                      ) : delta < 0 ? (
                        <>
                          scende a <span className="ds-num text-primary font-semibold">{formatDecimal(marginal.projection, 1)}</span> (
                          {formatDecimal(delta, 1)}).
                        </>
                      ) : (
                        <>
                          resta a <span className="ds-num text-white font-semibold">{formatDecimal(marginal.projection, 1)}</span>.
                        </>
                      )}
                    </p>
                  </div>
                );
              })}
            </div>

            <div className="flex items-center justify-between gap-3 flex-wrap rounded-xl border border-accent/30 bg-accent/[0.06] px-5 py-4">
              <div>
                <p className="text-sm font-semibold text-accent flex items-center gap-1.5">
                  <Icon name="chip" className="w-4 h-4" />
                  Tutti insieme
                </p>
                <p className="text-xs text-slate-400 mt-0.5">
                  Se {whatIfSlots.length === 1 ? 'l’esame simulato andasse' : `i ${whatIfSlots.length} esami simulati andassero`} così.
                </p>
              </div>
              <p className="text-3xl font-bold text-white ds-num">
                {combinedWhatIf.projection != null ? formatDecimal(combinedWhatIf.projection, 1) : '—'}
                <span className="text-lg font-semibold text-slate-500 ml-1.5">/ 110</span>
              </p>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
