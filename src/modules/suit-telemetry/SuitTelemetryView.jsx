import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Icon } from '../../components/Icons.jsx';
import EmptyState from '../../components/EmptyState.jsx';
import { formatHoursMinutes } from '../../utils/dateUtils.js';
import { CARD, CARD_ALERT, H1, BTN_PRIMARY, BTN_GHOST, INPUT, BADGE } from '../../utils/designSystem.js';
import { useKarenBrain } from '../../context/KarenBrainContext.jsx';

/**
 * SUIT TELEMETRY & NEURAL DIAGNOSTICS — v2 "Recovery Survey & Cache
 * Lifecycle" (Fase 3).
 *
 * COMPARTIMENTI STAGNI: pagina standalone, isolata in
 * src/modules/suit-telemetry/. Dipendenze verso il resto dell'app: SOLO
 * useKarenBrain (V35.0 — Provider condiviso attorno a useSuitTelemetry,
 * src/services/karenEngine/, montato una sola volta in App.jsx) e
 * componenti/utility di sola lettura già esistenti (Icon, EmptyState,
 * designSystem, formatHoursMinutes) — nessuna scrittura né lettura di
 * ArachnoForgeContext, nessuna modifica al reducer del Cloud State.
 *
 * NOVITÀ v2: Quick Log a 4 assi (Focus/Energia/Stress/Indolenzimento) al
 * posto del singolo Focus/Mood della Fase 2; badge "Dati disponibili"
 * agganciato al `dataCompleteness` REATTIVO del hook (non più al
 * `score_breakdown` congelato dentro l'ultimo briefing); gestione
 * esplicita dello stato "nessuna sessione" (Modalità Ospite non ha una
 * sessione Supabase reale, vedi AuthContext.jsx); feedback dedicato per
 * lo stato "briefing già in cache" restituito da karen-oracle.
 */

const READINESS_BAND_META = {
  OTTIMALE: {
    label: 'OTTIMALE',
    ringColor: 'text-secondary',
    textColor: 'text-secondary',
    badgeClass: 'inline-flex items-center gap-1.5 rounded-full border border-secondary/40 bg-secondary/10 text-secondary px-3 py-1 text-xs font-mono tracking-widest',
    icon: 'check',
    summary: 'Recupero completo. Via libera per la Quota Odierna al massimo regime.'
  },
  ATTENZIONE: {
    label: 'ATTENZIONE',
    ringColor: 'text-accent',
    textColor: 'text-accent',
    badgeClass: 'inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 text-accent px-3 py-1 text-xs font-mono tracking-widest',
    icon: 'alertTriangle',
    summary: 'Recupero parziale. Margini ridotti: monitora i segnali di affaticamento durante il Focus.'
  },
  CRITICO: {
    label: 'CRITICO',
    ringColor: 'text-primary',
    textColor: 'text-primary',
    badgeClass: 'inline-flex items-center gap-1.5 rounded-full border border-primary/50 bg-primary/15 text-primary px-3 py-1 text-xs font-mono tracking-widest',
    icon: 'alertTriangle',
    summary: 'Recupero insufficiente. Consigliata de-escalation: sessioni brevi, recupero attivo prima del prossimo Focus.'
  }
};

const CAFFEINE_PRESETS = [
  { label: '0mg', amount: 0, reset: true },
  { label: '+50mg Espresso', amount: 50 },
  { label: '+100mg Doppio/Energy', amount: 100 }
];

function formatSleepTotal(minutes) {
  if (minutes == null || !Number.isFinite(minutes)) return '—';
  return formatHoursMinutes(minutes / 60);
}

function formatMinutesShort(minutes) {
  if (minutes == null || !Number.isFinite(minutes)) return '—';
  return `${Math.round(minutes)}min`;
}

/** Anello SVG circolare del Readiness Score — stessa grammatica geometrica
 * dell'anello del Tactical Timer in MissionControl.jsx. */
function ReadinessGauge({ score, band }) {
  const meta = READINESS_BAND_META[band] || READINESS_BAND_META.OTTIMALE;
  const radius = 85;
  const circumference = 2 * Math.PI * radius;
  const safeScore = Math.max(0, Math.min(100, score));
  const dashOffset = circumference - (safeScore / 100) * circumference;

  return (
    <div className="relative w-48 h-48 sm:w-56 sm:h-56 flex items-center justify-center shrink-0">
      <svg className="w-48 h-48 sm:w-56 sm:h-56 -rotate-90" viewBox="0 0 200 200">
        <circle cx="100" cy="100" r={radius} fill="none" stroke="currentColor" strokeOpacity="0.12" strokeWidth="10" className="text-secondary" />
        <circle
          cx="100"
          cy="100"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          className={`${meta.ringColor} transition-[stroke-dashoffset] duration-700 ease-out`}
          style={{ filter: 'drop-shadow(0 0 10px currentColor)' }}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <p className="text-[10px] tracking-widest text-slate-500 mb-1">READINESS</p>
        <p className={`text-5xl font-mono font-bold af-mono-nums tabular-nums ${meta.textColor}`}>{Math.round(safeScore)}</p>
        <p className={`mt-2 text-[11px] font-mono tracking-widest ${meta.textColor}`}>{meta.label}</p>
      </div>
    </div>
  );
}

/**
 * V40.3 — "Dati disponibili: oggettivi 67%" senza dire QUALI mancava di
 * rispondere alla sola domanda che uno si fa. Le voci sono le sette del
 * punteggio (tre oggettive dall'iPhone, quattro dal Recovery Survey);
 * per ognuna si dice se è entrata nel calcolo e, se no, perché.
 *
 * Il caso tipico: il battito a riposo c'è, ma il punteggio cardiaco è un
 * CONFRONTO con la tua media — finché non ci sono almeno 3 giorni
 * registrati negli ultimi 14 non c'è niente con cui confrontarlo, e quella
 * voce resta fuori. Non è un dato mancante: è una linea di base che si
 * deve ancora formare.
 */
function ComposizionePunteggio({ breakdown, biometrics }) {
  const parts = breakdown?.parts;
  if (!parts) return null;
  const baselineHr = breakdown.baselineHr ?? null;
  const voci = [
    {
      key: 'sleep',
      gruppo: 'Dati dall\'iPhone',
      label: 'Sonno',
      manca: 'manca il sonno totale di stanotte'
    },
    {
      key: 'cardio',
      gruppo: 'Dati dall\'iPhone',
      label: 'Battito a riposo',
      manca:
        biometrics?.resting_hr != null && baselineHr == null
          ? 'il battito di oggi c\'è, ma serve la tua media di riferimento: almeno 3 giorni registrati negli ultimi 14'
          : 'manca il battito a riposo'
    },
    { key: 'activity', gruppo: 'Dati dall\'iPhone', label: 'Attività', manca: 'mancano i passi di oggi' },
    { key: 'focus', gruppo: 'Recovery Survey', label: 'Focus percepito', manca: 'non compilato oggi' },
    { key: 'energy', gruppo: 'Recovery Survey', label: 'Energia', manca: 'non compilato oggi' },
    { key: 'stress', gruppo: 'Recovery Survey', label: 'Stress', manca: 'non compilato oggi' },
    { key: 'soreness', gruppo: 'Recovery Survey', label: 'Indolenzimento', manca: 'non compilato oggi' }
  ];
  const gruppi = ['Dati dall\'iPhone', 'Recovery Survey'];

  return (
    <details className="relative rounded-xl border border-white/10 bg-black/20 p-3">
      <summary className="cursor-pointer text-sm text-slate-400 select-none">Com'è composto il punteggio</summary>
      <div className="mt-2.5 space-y-3">
        {gruppi.map((g) => (
          <div key={g}>
            <p className="text-[10px] tracking-widest text-slate-500 mb-1.5">{g.toUpperCase()}</p>
            <ul className="space-y-1">
              {voci
                .filter((v) => v.gruppo === g)
                .map((v) => {
                  const dentro = parts[v.key] != null;
                  return (
                    <li key={v.key} className="flex items-start gap-2 text-xs">
                      <Icon
                        name={dentro ? 'check' : 'close'}
                        className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${dentro ? 'text-emerald-400' : 'text-slate-600'}`}
                      />
                      <span className={dentro ? 'text-slate-300' : 'text-slate-500'}>
                        {v.label}
                        {!dentro && <span className="text-slate-600"> — {v.manca}</span>}
                      </span>
                    </li>
                  );
                })}
            </ul>
          </div>
        ))}
        {breakdown.sleepTargetMin != null && (
          <p className="text-[11px] text-slate-500 leading-relaxed">
            Obiettivo di sonno usato oggi: {formatHoursMinutes(breakdown.sleepTargetMin / 60)}
            {breakdown.sleepTargetMin !== 450 ? ' (calcolato sulle tue notti)' : ' (valore standard)'}.
          </p>
        )}
        <p className="text-[11px] text-slate-500 leading-relaxed">
          Il punteggio usa solo le voci disponibili: una voce fuori non abbassa il Readiness, riduce solo la percentuale
          di dati su cui è calcolato.
        </p>
      </div>
    </details>
  );
}

function MetricCard({ icon, label, value, sub, pending }) {
  return (
    <div className="relative bg-surface/60 border border-secondary/15 rounded-xl p-3.5 sm:p-4 flex items-start gap-3 overflow-hidden">
      <div className="w-9 h-9 rounded-lg bg-secondary/10 border border-secondary/25 flex items-center justify-center text-secondary shrink-0">
        <Icon name={icon} className="w-5 h-5" />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] tracking-widest text-slate-500 mb-0.5">{label}</p>
        {pending ? (
          <p className="text-xs text-accent font-mono">In attesa di sync da iOS</p>
        ) : (
          <>
            <p className="text-lg font-mono font-bold text-slate-100 af-mono-nums leading-tight">{value}</p>
            {sub && <p className="text-[11px] text-slate-500 mt-0.5">{sub}</p>}
          </>
        )}
      </div>
    </div>
  );
}

function SubjectiveSlider({ label, value, onChange, min = 1, max = 10, lowLabel, highLabel }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs tracking-widest text-slate-400">{label}</span>
        <span className="text-sm font-mono font-bold text-secondary af-mono-nums">{value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-2 rounded-full bg-surface/80 border border-secondary/20 accent-secondary cursor-pointer"
      />
      {(lowLabel || highLabel) && (
        <div className="flex items-center justify-between mt-1">
          <span className="text-[10px] text-slate-600">{lowLabel}</span>
          <span className="text-[10px] text-slate-600">{highLabel}</span>
        </div>
      )}
    </div>
  );
}

export default function SuitTelemetryView() {
  const {
    hasSession,
    biometrics,
    subjectiveLog,
    briefing,
    readinessScore,
    readinessBand,
    dataCompleteness,
    loading,
    scanning,
    saving,
    error,
    triggerOracleScan,
    saveSubjectiveLog,
    refresh
  } = useKarenBrain();

  const bandMeta = READINESS_BAND_META[readinessBand] || READINESS_BAND_META.OTTIMALE;
  const hasBiometricsToday = !!biometrics;

  // -- Quick Log Soggettivo: 4 assi (Focus / Energia / Stress /
  //    Indolenzimento) — stato locale controllato, sincronizzato dal log
  //    del giorno appena arriva (o resettato ai default se non esiste
  //    ancora per il giorno corrente). --
  const [focusLevel, setFocusLevel] = useState(5);
  const [energyLevel, setEnergyLevel] = useState(5);
  const [stressLevel, setStressLevel] = useState(5);
  const [muscleSoreness, setMuscleSoreness] = useState(1);
  const [caffeineMg, setCaffeineMg] = useState(0);
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (subjectiveLog) {
      setFocusLevel(subjectiveLog.focus_level ?? 5);
      // Fallback legacy: righe salvate in Fase 2 avevano solo `mood`,
      // mai perse — vengono lette come valore iniziale di Energia se
      // `energy_level` non è ancora stato loggato in questo formato.
      setEnergyLevel(subjectiveLog.energy_level ?? subjectiveLog.mood ?? 5);
      setStressLevel(subjectiveLog.stress_level ?? 5);
      setMuscleSoreness(subjectiveLog.muscle_soreness ?? 1);
      setCaffeineMg(subjectiveLog.caffeine_mg ?? 0);
      setNotes(subjectiveLog.notes ?? '');
    } else {
      setFocusLevel(5);
      setEnergyLevel(5);
      setStressLevel(5);
      setMuscleSoreness(1);
      setCaffeineMg(0);
      setNotes('');
    }
  }, [subjectiveLog]);

  const handleCaffeinePreset = useCallback((preset) => {
    setCaffeineMg((current) => (preset.reset ? 0 : Math.max(0, current + preset.amount)));
  }, []);

  const [saveFeedback, setSaveFeedback] = useState(null); // null | 'success' | 'error'
  const [scanFeedback, setScanFeedback] = useState(null); // null | 'success' | 'cached' | 'error'
  const saveFeedbackTimeoutRef = useRef(null);
  const scanFeedbackTimeoutRef = useRef(null);

  useEffect(
    () => () => {
      if (saveFeedbackTimeoutRef.current) clearTimeout(saveFeedbackTimeoutRef.current);
      if (scanFeedbackTimeoutRef.current) clearTimeout(scanFeedbackTimeoutRef.current);
    },
    []
  );

  const handleSave = useCallback(async () => {
    const { error: saveError } = await saveSubjectiveLog({
      focus_level: focusLevel,
      energy_level: energyLevel,
      stress_level: stressLevel,
      muscle_soreness: muscleSoreness,
      caffeine_mg: caffeineMg,
      notes
    });
    setSaveFeedback(saveError ? 'error' : 'success');
    if (saveFeedbackTimeoutRef.current) clearTimeout(saveFeedbackTimeoutRef.current);
    saveFeedbackTimeoutRef.current = setTimeout(() => setSaveFeedback(null), 2600);
  }, [saveSubjectiveLog, focusLevel, energyLevel, stressLevel, muscleSoreness, caffeineMg, notes]);

  const handleScan = useCallback(
    async (force) => {
      const { data, error: scanError } = await triggerOracleScan({ force });
      if (scanError) {
        setScanFeedback('error');
      } else if (data?.cached) {
        setScanFeedback('cached');
      } else {
        setScanFeedback('success');
      }
      if (scanFeedbackTimeoutRef.current) clearTimeout(scanFeedbackTimeoutRef.current);
      scanFeedbackTimeoutRef.current = setTimeout(() => setScanFeedback(null), 3200);
    },
    [triggerOracleScan]
  );

  const connectionMeta = useMemo(() => {
    if (loading) {
      return { icon: 'cloud', label: 'SINCRONIZZAZIONE...', className: 'text-accent border-accent/30 bg-accent/10', spin: true };
    }
    if (error) {
      return { icon: 'cloudOff', label: 'ERRORE TELEMETRIA', className: 'text-primary border-primary/40 bg-primary/10', spin: false };
    }
    if (hasBiometricsToday) {
      return { icon: 'cloudCheck', label: 'TELEMETRIA RICEVUTA', className: 'text-secondary border-secondary/30 bg-secondary/10', spin: false };
    }
    return { icon: 'cloudOff', label: 'IN ATTESA DI SYNC iOS', className: 'text-accent border-accent/30 bg-accent/10', spin: false };
  }, [loading, error, hasBiometricsToday]);

  if (loading && !biometrics && !briefing && !subjectiveLog) {
    return (
      <div className="flex items-center justify-center py-24">
        <span className="w-10 h-10 rounded-full border-[3px] border-secondary/25 border-t-secondary animate-spin" />
      </div>
    );
  }

  // Modalità Ospite (AuthContext.jsx, GUEST_USER) non ha una sessione
  // Supabase reale: nessuna delle 3 tabelle biometriche è raggiungibile
  // (RLS le blocca comunque per "anon"), quindi l'HUD lo dichiara subito
  // invece di mostrare card vuote che sembrano un errore di sync.
  if (!loading && !hasSession) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className={H1}>Suit Telemetry & Neural Diagnostics</h1>
          <p className="text-base text-slate-400 mt-1.5">K.A.R.E.N. OS — modulo di telemetria biometrica e readiness tattico.</p>
        </div>
        <div className={CARD}>
          <EmptyState
            variant="radar"
            title="Nessuna sessione Nexus attiva"
            subtitle="La Telemetria Biometrica richiede un account Nexus reale (login o registrazione) — la Modalità Ospite resta 100% locale e non sincronizza dati con K.A.R.E.N."
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className={H1}>Suit Telemetry & Neural Diagnostics</h1>
          <p className="text-base text-slate-400 mt-1.5">K.A.R.E.N. OS — modulo di telemetria biometrica e readiness tattico.</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-mono tracking-wide ${connectionMeta.className}`}>
            <Icon name={connectionMeta.icon} className={`w-3.5 h-3.5 ${connectionMeta.spin ? 'animate-spin' : ''}`} />
            {connectionMeta.label}
          </span>
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            aria-label="Aggiorna telemetria"
            className="w-9 h-9 rounded-xl bg-white/[0.03] backdrop-blur-md border border-white/10 text-slate-300 hover:bg-white/[0.07] hover:border-secondary/40 hover:text-white transition-all duration-300 disabled:opacity-40 disabled:pointer-events-none flex items-center justify-center"
          >
            <Icon name="undo" className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error && (
        <div className={`${CARD_ALERT} flex items-center gap-3`}>
          <Icon name="alertTriangle" className="w-5 h-5 text-primary shrink-0" />
          <p className="text-sm text-slate-300 relative">{error}</p>
        </div>
      )}

      {/* Grid Principale HUD — Readiness Gauge + Metriche Biometriche */}
      <div className={`${CARD} grid grid-cols-1 lg:grid-cols-[auto_1fr] gap-6 lg:gap-10 items-center`}>
        <div className="absolute -top-10 -left-10 w-56 h-56 rounded-full bg-secondary/10 blur-3xl pointer-events-none" />
        <div className="relative flex justify-center">
          <ReadinessGauge score={readinessScore} band={readinessBand} />
        </div>
        <div className="relative space-y-4 w-full">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={bandMeta.badgeClass}>
              <Icon name={bandMeta.icon} className="w-3.5 h-3.5" />
              {bandMeta.label}
            </span>
            <span className={BADGE.slate}>Dati disponibili: {Math.round(dataCompleteness * 100)}%</span>
            {!briefing && (
              <span className={BADGE.amber}>Diagnostica non ancora eseguita oggi</span>
            )}
          </div>
          <p className="text-sm text-slate-300 leading-relaxed">{bandMeta.summary}</p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
            <MetricCard
              icon="moon"
              label="SONNO TOTALE"
              pending={!hasBiometricsToday || biometrics?.sleep_total_min == null}
              value={formatSleepTotal(biometrics?.sleep_total_min)}
              sub={
                biometrics?.sleep_deep_min != null || biometrics?.sleep_rem_min != null
                  ? `Profondo ${formatMinutesShort(biometrics?.sleep_deep_min)} · REM ${formatMinutesShort(biometrics?.sleep_rem_min)}`
                  : null
              }
            />
            <MetricCard
              icon="heart"
              label="FREQUENZA A RIPOSO"
              pending={!hasBiometricsToday || biometrics?.resting_hr == null}
              value={biometrics?.resting_hr != null ? `${biometrics.resting_hr} bpm` : '—'}
            />
            <MetricCard
              icon="flame"
              label="ATTIVITÀ FISICA"
              pending={!hasBiometricsToday || (biometrics?.steps == null && biometrics?.active_calories == null)}
              value={biometrics?.steps != null ? `${biometrics.steps.toLocaleString('it-IT')} passi` : '—'}
              sub={biometrics?.active_calories != null ? `${biometrics.active_calories} kcal attive` : null}
            />
          </div>

          {/* V40.3 — quali voci sono entrate nel punteggio e quali no. */}
          <ComposizionePunteggio breakdown={briefing?.score_breakdown} biometrics={biometrics} />
        </div>
      </div>

      {/* K.A.R.E.N. Tactical Terminal */}
      <div className={CARD}>
        <div className="absolute -top-16 -right-16 w-56 h-56 rounded-full bg-primary/10 blur-3xl pointer-events-none" />
        <div className="relative flex items-center gap-3 mb-4">
          <div className="w-9 h-9 rounded-xl bg-primary/15 border border-primary/40 flex items-center justify-center text-primary shrink-0">
            <Icon name="terminal" className="w-5 h-5" />
          </div>
          <div>
            <p className="text-xs tracking-widest text-primary font-mono">K.A.R.E.N. TACTICAL TERMINAL</p>
            <h2 className="text-lg font-bold text-white tracking-tight">Diagnostica Neurale</h2>
          </div>
        </div>

        {briefing ? (
          <div className="relative space-y-4">
            <div className="p-3.5 rounded-xl bg-surface/60 border border-secondary/15">
              <p className="text-[10px] tracking-widest text-slate-500 mb-1.5">BRIEFING</p>
              <p className="text-base italic text-slate-300 leading-relaxed">"{briefing.briefing_text}"</p>
            </div>
            <div className="p-3.5 rounded-xl bg-primary/5 border border-primary/25">
              <p className="text-[10px] tracking-widest text-primary/80 mb-1.5">CONSIGLIO TATTICO</p>
              <p className="text-sm text-slate-200 leading-relaxed">{briefing.tactical_advice}</p>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <button
                type="button"
                onClick={() => handleScan(true)}
                disabled={scanning}
                className={`${BTN_GHOST} ${scanning ? 'animate-pulse' : ''}`}
              >
                <Icon name="radar" className={`w-4 h-4 ${scanning ? 'animate-spin' : ''}`} />
                {scanning ? 'Rigenerazione in corso...' : 'Rigenera Diagnostica'}
              </button>
              {scanFeedback === 'success' && <span className="text-xs text-secondary font-mono">Briefing rigenerato.</span>}
              {scanFeedback === 'cached' && <span className="text-xs text-slate-500 font-mono">Già presente per oggi — nessuna nuova chiamata AI.</span>}
              {scanFeedback === 'error' && <span className="text-xs text-primary font-mono">Rigenerazione non riuscita. Riprova.</span>}
            </div>
          </div>
        ) : (
          <div className="relative flex flex-col items-center text-center py-6 gap-4">
            <p className="text-sm text-slate-400 max-w-md">
              Nessun briefing generato per oggi. Avvia la Diagnostica Neurale per calcolare il Readiness Score e ricevere il briefing tattico di K.A.R.E.N.
            </p>
            <button
              type="button"
              onClick={() => handleScan(false)}
              disabled={scanning}
              className={`${BTN_PRIMARY} ${scanning ? 'animate-pulse' : ''}`}
            >
              <Icon name={scanning ? 'radar' : 'satellite'} className={`w-5 h-5 ${scanning ? 'animate-spin' : ''}`} />
              {scanning ? 'DIAGNOSTICA IN CORSO...' : 'AVVIA DIAGNOSTICA NEURALE K.A.R.E.N.'}
            </button>
            {scanFeedback === 'error' && <p className="text-xs text-primary font-mono">Diagnostica non riuscita. Riprova.</p>}
          </div>
        )}
      </div>

      {/* Quick Log Soggettivo Cadetto — Recovery Survey a 4 assi */}
      <div className={CARD}>
        <div className="relative flex items-center gap-3 mb-5">
          <div className="w-9 h-9 rounded-xl bg-secondary/15 border border-secondary/40 flex items-center justify-center text-secondary shrink-0">
            <Icon name="edit" className="w-5 h-5" />
          </div>
          <div>
            <p className="text-xs tracking-widest text-secondary font-mono">QUICK LOG CADETTO</p>
            <h2 className="text-lg font-bold text-white tracking-tight">Recovery Survey Soggettivo</h2>
          </div>
        </div>

        <div className="relative space-y-5">
          <SubjectiveSlider label="LIVELLO FOCUS" value={focusLevel} onChange={setFocusLevel} lowLabel="Disperso" highLabel="Lucido" />
          <SubjectiveSlider label="LIVELLO ENERGIA" value={energyLevel} onChange={setEnergyLevel} lowLabel="Esausto" highLabel="Carico" />
          <SubjectiveSlider label="LIVELLO STRESS" value={stressLevel} onChange={setStressLevel} lowLabel="Rilassato" highLabel="Teso" />
          <SubjectiveSlider label="INDOLENZIMENTO MUSCOLARE" value={muscleSoreness} onChange={setMuscleSoreness} lowLabel="Nessuno" highLabel="Severo" />

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs tracking-widest text-slate-400">CAFFEINA (mg)</span>
              <span className="text-sm font-mono font-bold text-secondary af-mono-nums">{caffeineMg}mg</span>
            </div>
            <div className="flex flex-wrap gap-2 mb-2">
              {CAFFEINE_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => handleCaffeinePreset(preset)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-secondary/25 bg-surface/60 text-slate-200 px-3 py-1.5 text-xs font-mono hover:border-secondary/60 hover:text-secondary transition-all duration-300 active:scale-95"
                >
                  <Icon name="bolt" className="w-3.5 h-3.5" />
                  {preset.label}
                </button>
              ))}
            </div>
            <input
              type="number"
              min={0}
              step={10}
              value={caffeineMg}
              onChange={(e) => setCaffeineMg(Math.max(0, Number(e.target.value) || 0))}
              className={INPUT}
              placeholder="Inserimento manuale (mg)"
            />
          </div>

          <div>
            <label className="text-xs tracking-widest text-slate-400 block mb-1.5">NOTA TATTICA (opzionale)</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className={INPUT}
              placeholder="Es. Notte interrotta, allenamento pesante ieri..."
              maxLength={280}
            />
          </div>

          <button type="button" onClick={handleSave} disabled={saving} className={`w-full ${BTN_PRIMARY}`}>
            <Icon name={saving ? 'radar' : 'check'} className={`w-5 h-5 ${saving ? 'animate-spin' : ''}`} />
            {saving ? 'REGISTRAZIONE...' : 'REGISTRA TELEMETRIA SOGGETTIVA'}
          </button>
          {saveFeedback === 'success' && (
            <p className="text-xs text-secondary text-center font-mono">Telemetria registrata. Karen ha aggiornato il contesto odierno.</p>
          )}
          {saveFeedback === 'error' && (
            <p className="text-xs text-primary text-center font-mono">Salvataggio non riuscito. Riprova.</p>
          )}
        </div>
      </div>
    </div>
  );
}
