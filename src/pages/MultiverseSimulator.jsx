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
