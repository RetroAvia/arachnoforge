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
  getTopIncompleteByScore
} from '../utils/gpaEngine.js';
import { CARD, H1, H2, BADGE } from '../utils/designSystem.js';

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
 * nuova dipendenza npm, il sandbox non ha accesso al registry). Asse Y
 * fisso 18-30 (range voti italiano) per una lettura immediata senza
 * dover leggere gli assi; asse X = ordine cronologico dei punti
 * registrati (un punto per ogni Materia che diventa "votata").
 */
function GradeHistoryChart({ history }) {
  const W = 600;
  const H = 200;
  const PAD_X = 36;
  const PAD_Y = 20;
  const Y_MIN = 18;
  const Y_MAX = 30;

  const points = history.map((entry, i) => {
    const x = history.length === 1
      ? W / 2
      : PAD_X + (i / (history.length - 1)) * (W - PAD_X * 2);
    const clamped = Math.min(Y_MAX, Math.max(Y_MIN, entry.average));
    const y = H - PAD_Y - ((clamped - Y_MIN) / (Y_MAX - Y_MIN)) * (H - PAD_Y * 2);
    return { x, y, entry };
  });

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const gridLines = [18, 21, 24, 27, 30];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Storico Media Ponderata">
      {gridLines.map((v) => {
        const y = H - PAD_Y - ((v - Y_MIN) / (Y_MAX - Y_MIN)) * (H - PAD_Y * 2);
        return (
          <g key={v}>
            <line x1={PAD_X} y1={y} x2={W - PAD_X} y2={y} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
            <text x={4} y={y + 4} fontSize="10" fill="rgba(148,163,184,0.7)" fontFamily="monospace">{v}</text>
          </g>
        );
      })}
      {points.length > 1 && (
        <path d={path} fill="none" stroke="var(--color-secondary, #1D83F0)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      )}
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="4" fill="var(--color-secondary, #1D83F0)" stroke="#0b1220" strokeWidth="1.5">
          <title>{`${p.entry.dateKey} — Media ${p.entry.average.toFixed(2)}`}</title>
        </circle>
      ))}
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

export default function MultiverseSimulator() {
  const { state } = useArachnoForge();
  const materie = Array.isArray(state.materie) ? state.materie : [];

  const { average, totalCfu, gradedCount } = useMemo(() => computeWeightedAverage(materie), [materie]);
  const projection = useMemo(() => computeGraduationProjection(average), [average]);

  // V32.0 — Storico Media Ponderata: ledger append-only popolato dal
  // reducer (vedi ArachnoForgeContext, case UPDATE_MATERIA) a ogni prima
  // "votazione" di una Materia. Filtrato difensivamente qui in aggiunta
  // alla blindatura già presente in hydrateState.
  const gradeHistory = useMemo(
    () => (Array.isArray(state.gradeHistory) ? state.gradeHistory.filter((e) => e && Number.isFinite(e.average)) : []),
    [state.gradeHistory]
  );

  const gradedMaterie = useMemo(
    () => materie.filter((m) => m && m.examPassed && Number.isFinite(m.voto)).sort((a, b) => b.voto - a.voto),
    [materie]
  );

  // What-If Scenario — V20.0 (Pillar 4): i 2 esami non ancora superati con
  // lo Spider-Score più alto (gli stessi che Karen consiglierebbe nel
  // Web-Matrix), secondo la Direttiva Suprema "due slider fittizi".
  const whatIfSlots = useMemo(() => getTopIncompleteByScore(materie, WHAT_IF_SLOT_COUNT), [materie]);
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
          Karen: proiezioni multiversali attive. Media Ponderata, Proiezione di Laurea e scenari What-If in tempo reale.
        </p>
      </div>

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
            <p className="text-xs text-slate-500 mt-2">
              {gradeHistory.length === 1
                ? 'Un solo punto registrato — torna dopo il prossimo esame votato per vedere l’andamento.'
                : `Da ${gradeHistory[0].average.toFixed(2)} a ${gradeHistory[gradeHistory.length - 1].average.toFixed(2)} su ${gradeHistory.length} esami votati.`}
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
