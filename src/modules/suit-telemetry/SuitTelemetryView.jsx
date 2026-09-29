import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Icon } from '../../components/Icons.jsx';
import EmptyState from '../../components/EmptyState.jsx';
import { formatHoursMinutes } from '../../utils/dateUtils.js';
import { CARD, CARD_ALERT, BTN_PRIMARY, BTN_GHOST, INPUT, LABEL, BADGE } from '../../utils/designSystem.js';
import { useKarenBrain } from '../../context/KarenBrainContext.jsx';
import { useArachnoForge } from '../../context/ArachnoForgeContext.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import { formatInt } from '../../utils/format.js';

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
    label: 'Ottimale',
    ringColor: 'text-emerald-400',
    textColor: 'text-emerald-300',
    badgeClass: BADGE.green,
    icon: 'check',
    summary: 'Recupero completo: via libera per la quota di oggi al massimo regime.'
  },
  ATTENZIONE: {
    label: 'Attenzione',
    ringColor: 'text-accent',
    textColor: 'text-accent',
    badgeClass: BADGE.amber,
    icon: 'alertTriangle',
    summary: 'Recupero parziale: margini ridotti, tieni d’occhio i segnali di fatica durante il Focus.'
  },
  CRITICO: {
    label: 'Critico',
    ringColor: 'text-primary',
    textColor: 'text-primary',
    badgeClass: BADGE.red,
    icon: 'alertTriangle',
    summary: 'Recupero insufficiente: meglio blocchi brevi e un po’ di recupero attivo prima del prossimo Focus.'
  }
};

const CAFFEINE_PRESETS = [
  { label: 'Azzera', amount: 0, reset: true },
  { label: '+50 mg · espresso', amount: 50 },
  { label: '+100 mg · doppio o energy drink', amount: 100 }
];

function formatSleepTotal(minutes) {
  if (minutes == null || !Number.isFinite(minutes)) return '—';
  return formatHoursMinutes(minutes / 60);
}

function formatMinutesShort(minutes) {
  if (minutes == null || !Number.isFinite(minutes)) return '—';
  return formatHoursMinutes(minutes / 60);
}

/** Anello SVG circolare del Readiness Score — stessa grammatica geometrica
 * dell'anello del Tactical Timer in MissionControl.jsx. */
function ReadinessGauge({ score, band, pending = false, unknown = false }) {
  const meta = READINESS_BAND_META[band] || READINESS_BAND_META.OTTIMALE;
  const radius = 84;
  const circumference = 2 * Math.PI * radius;
  const safeScore = pending || unknown ? 0 : Math.max(0, Math.min(100, Number(score) || 0));
  const dashOffset = circumference - (safeScore / 100) * circumference;

  return (
    <div className="relative w-44 h-44 sm:w-48 sm:h-48 flex items-center justify-center shrink-0">
      <svg className="w-full h-full -rotate-90" viewBox="0 0 200 200" aria-hidden="true">
        <circle cx="100" cy="100" r={radius} fill="none" stroke="rgb(255 255 255 / 0.08)" strokeWidth="12" />
        <circle
          cx="100"
          cy="100"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          className={`${meta.ringColor} transition-[stroke-dashoffset] duration-700 ease-out`}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <p className="text-[11px] text-slate-500">Readiness</p>
        {pending || unknown ? (
          <>
            <p className="text-5xl font-bold ds-num leading-none mt-1 text-slate-600">{unknown ? 'n/d' : '—'}</p>
            <p className="mt-1.5 text-xs font-semibold text-slate-500">{unknown ? 'Non misurata' : 'Da calcolare'}</p>
          </>
        ) : (
          <>
            <p className={`text-5xl font-bold ds-num leading-none mt-1 ${meta.textColor}`}>{Math.round(safeScore)}</p>
            <p className={`mt-1.5 text-xs font-semibold ${meta.textColor}`}>{meta.label}</p>
          </>
        )}
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
    <details className="group rounded-xl border border-line bg-surface/60 px-3.5 py-3">
      <summary className="cursor-pointer text-[13px] text-slate-300 select-none flex items-center justify-between gap-2 list-none">
        Com'è composto il punteggio
        <Icon name="chevronDown" className="w-4 h-4 text-slate-500 transition-transform group-open:rotate-180" />
      </summary>
      <div className="mt-2.5 space-y-3">
        {gruppi.map((g) => (
          <div key={g}>
            <p className="ds-eyebrow mb-1.5">{g}</p>
            <ul className="space-y-1">
              {voci
                .filter((v) => v.gruppo === g)
                .map((v) => {
                  const dentro = parts[v.key] != null;
                  return (
                    <li key={v.key} className="flex items-start gap-2 text-xs">
                      <Icon
                        name={dentro ? 'check' : 'close'}
                        className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${dentro ? 'text-emerald-300' : 'text-slate-600'}`}
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
    <div className="ds-well p-3.5 flex items-start gap-3">
      <span className="ds-icon-tile !w-8 !h-8 text-secondary">
        <Icon name={icon} className="w-4 h-4" />
      </span>
      <div className="min-w-0">
        <p className="text-[11px] text-slate-500">{label}</p>
        {pending ? (
          <p className="text-xs text-accent mt-0.5">In attesa del sync dall'iPhone</p>
        ) : (
          <>
            <p className="text-lg font-bold text-slate-100 ds-num leading-tight mt-0.5">{value}</p>
            {sub && <p className="text-[11px] text-slate-500 mt-0.5">{sub}</p>}
          </>
        )}
      </div>
    </div>
  );
}

function SubjectiveSlider({ label, value, onChange, min = 1, max = 10, lowLabel, highLabel, invert = false }) {
  const pct = ((value - min) / (max - min)) * 100;
  // Per stress e indolenzimento "alto" è peggio: il colore lo dice.
  const good = invert ? value <= 3 : value >= 7;
  const bad = invert ? value >= 8 : value <= 3;
  const fill = bad ? 'rgb(var(--af-attack-rgb))' : good ? 'rgb(52 211 153)' : 'rgb(var(--af-refuel-rgb))';
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-slate-300">{label}</span>
        <span className="text-sm font-bold text-white ds-num">
          {value}
          <span className="text-slate-500 font-normal">/{max}</span>
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="ds-range"
        style={{ '--range-pct': `${pct}%`, '--range-fill': fill }}
        aria-label={label}
        aria-valuetext={`${value} su ${max}`}
      />
      {(lowLabel || highLabel) && (
        <div className="flex items-center justify-between mt-1">
          <span className="text-[11px] text-slate-500">{lowLabel}</span>
          <span className="text-[11px] text-slate-500">{highLabel}</span>
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
    readinessKnown,
    briefingFallback,
    dataCompleteness,
    loading,
    scanning,
    saving,
    error,
    triggerOracleScan,
    saveSubjectiveLog,
    refresh
  } = useKarenBrain();
  // V42 — ogni rigenerazione porta il piano di oggi (vedi planContext.js).
  const { derived } = useArachnoForge();
  const planContextRef = useRef(null);
  planContextRef.current = derived.karenPlanContext;

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
  const [scanFeedback, setScanFeedback] = useState(null); // null | 'success' | 'cached' | 'fallback' | 'error'
  const [scanMessage, setScanMessage] = useState(null);
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
      const { data, error: scanError } = await triggerOracleScan({ force, planContext: planContextRef.current });
      setScanMessage(scanError || data?.warning || null);
      if (scanError) {
        setScanFeedback('error');
      } else if (data?.fallback) {
        setScanFeedback('fallback');
      } else if (data?.cached) {
        setScanFeedback('cached');
      } else {
        setScanFeedback('success');
      }
      if (scanFeedbackTimeoutRef.current) clearTimeout(scanFeedbackTimeoutRef.current);
      scanFeedbackTimeoutRef.current = setTimeout(() => {
        setScanFeedback(null);
        setScanMessage(null);
      }, scanError ? 6000 : 3200);
    },
    [triggerOracleScan]
  );

  const connectionMeta = useMemo(() => {
    if (loading) return { icon: 'cloud', label: 'Sincronizzazione…', badge: BADGE.amber, spin: true };
    if (error) return { icon: 'cloudOff', label: 'Errore di telemetria', badge: BADGE.red, spin: false };
    if (hasBiometricsToday) return { icon: 'cloudCheck', label: 'Dati di oggi ricevuti', badge: BADGE.green, spin: false };
    return { icon: 'cloudOff', label: 'In attesa del sync dall’iPhone', badge: BADGE.amber, spin: false };
  }, [loading, error, hasBiometricsToday]);

  const header = (actions = null) => (
    <PageHeader
      eyebrow="Readiness e dati biometrici"
      icon="heart"
      title="Suit Telemetry & Neural Diagnostics"
      subtitle="Quanto sei pronto oggi, dai dati del tuo iPhone e da come ti senti. Karen usa il Readiness per calibrare timer e carico della giornata."
      actions={actions}
    />
  );

  if (loading && !biometrics && !briefing && !subjectiveLog) {
    return (
      <div className="space-y-6">
        {header()}
        <div className="flex items-center justify-center py-24" role="status" aria-label="Caricamento della telemetria">
          <span className="w-10 h-10 rounded-full border-[3px] border-secondary/25 border-t-secondary animate-spin" />
        </div>
      </div>
    );
  }

  // Modalità Ospite (AuthContext.jsx, GUEST_USER): nessuna sessione
  // Supabase reale, quindi nessuna delle tabelle biometriche è
  // raggiungibile. Lo si dice subito invece di mostrare card vuote.
  if (!loading && !hasSession) {
    return (
      <div className="space-y-6">
        {header()}
        <div className={CARD}>
          <EmptyState
            variant="radar"
            title="Serve un account"
            subtitle="La telemetria arriva dall'iPhone al tuo account Nexus: in Modalità Ospite tutto resta su questo browser e Karen non riceve i dati biometrici. Accedi o registrati dal Nexus Gate."
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header(
        <>
          <span className={connectionMeta.badge}>
            <Icon name={connectionMeta.icon} className={`w-3 h-3 ${connectionMeta.spin ? 'animate-spin' : ''}`} />
            {connectionMeta.label}
          </span>
          <button type="button" onClick={refresh} disabled={loading} aria-label="Aggiorna la telemetria" title="Aggiorna" className="ds-icon-btn border border-line">
            <Icon name="refresh" className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </>
      )}

      {error && (
        <div className={`${CARD_ALERT} !py-4 flex items-center gap-3`}>
          <Icon name="alertTriangle" className="w-5 h-5 text-primary shrink-0" />
          <p className="text-sm text-slate-300">{error}</p>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-5 items-start">
        {/* Readiness + metriche biometriche */}
        <section className={`${CARD} xl:col-span-3 space-y-5`} aria-label="Readiness di oggi">
          <div className="flex flex-col sm:flex-row items-center gap-6">
            {/* V41 — senza la diagnostica di oggi il punteggio non esiste
                ancora: prima si vedeva il valore di default (100, "ottimale")
                come se fosse misurato. */}
            <ReadinessGauge score={readinessScore} band={readinessBand} pending={!briefing} unknown={!!briefing && !readinessKnown} />
            <div className="min-w-0 flex-1 space-y-3 text-center sm:text-left">
              <div className="flex items-center gap-2 flex-wrap justify-center sm:justify-start">
                {briefing && readinessKnown && (
                  <span className={bandMeta.badgeClass}>
                    <Icon name={bandMeta.icon} className="w-3 h-3" />
                    {bandMeta.label}
                  </span>
                )}
                {briefing && !readinessKnown && <span className={BADGE.slate}>Pochi dati: non misurata</span>}
                <span className={BADGE.slate} title="Quota delle voci del punteggio disponibili oggi">
                  Dati disponibili {Math.round(dataCompleteness * 100)}%
                </span>
                {!briefing && <span className={BADGE.amber}>Diagnostica di oggi da fare</span>}
              </div>
              <p className="text-[15px] text-slate-200 leading-relaxed">
                {!briefing
                  ? 'Il Readiness di oggi si calcola con la diagnostica di Karen, dai dati dell’iPhone e dal log di come ti senti.'
                  : readinessKnown
                    ? bandMeta.summary
                    : 'Con meno di due voci del punteggio il Readiness non è una misura: Karen resta neutra (nessuna riduzione del carico, il timer resta il tuo). Compila il Quick Log e rigenera la diagnostica.'}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <MetricCard
              icon="moon"
              label="Sonno"
              pending={!hasBiometricsToday || biometrics?.sleep_total_min == null}
              value={formatSleepTotal(biometrics?.sleep_total_min)}
              sub={
                biometrics?.sleep_deep_min != null || biometrics?.sleep_rem_min != null
                  ? `profondo ${formatMinutesShort(biometrics?.sleep_deep_min)} · REM ${formatMinutesShort(biometrics?.sleep_rem_min)}`
                  : null
              }
            />
            <MetricCard
              icon="heart"
              label="Battito a riposo"
              pending={!hasBiometricsToday || biometrics?.resting_hr == null}
              value={biometrics?.resting_hr != null ? `${biometrics.resting_hr} bpm` : '—'}
            />
            <MetricCard
              icon="flame"
              label="Attività"
              pending={!hasBiometricsToday || (biometrics?.steps == null && biometrics?.active_calories == null)}
              value={biometrics?.steps != null ? `${formatInt(biometrics.steps)} passi` : '—'}
              sub={biometrics?.active_calories != null ? `${formatInt(biometrics.active_calories)} kcal attive` : null}
            />
          </div>

          {/* V40.3 — quali voci sono entrate nel punteggio e quali no. */}
          <ComposizionePunteggio breakdown={briefing?.score_breakdown} biometrics={biometrics} />
        </section>

        {/* K.A.R.E.N. Tactical Terminal */}
        <section className={`${CARD} xl:col-span-2 space-y-4`} aria-label="Diagnostica di Karen">
          <div className="flex items-center gap-3">
            <span className="ds-icon-tile text-primary">
              <Icon name="terminal" className="w-[18px] h-[18px]" />
            </span>
            <div>
              <p className="ds-eyebrow">K.A.R.E.N. Tactical Terminal</p>
              <h2 className="text-[15px] font-semibold text-white">Diagnostica neurale</h2>
            </div>
          </div>

          {briefing ? (
            <div className="space-y-3">
              {briefingFallback && (
                <div className="rounded-xl border border-accent/30 bg-accent/[0.06] px-3.5 py-2.5 flex items-start gap-2">
                  <Icon name="alertTriangle" className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                  <p className="text-xs text-slate-300 leading-relaxed">
                    <span className="font-semibold text-accent">Piano di ripiego.</span> Karen non era raggiungibile: direttive calcolate dall’app sul piano di
                    oggi. Riprova fra qualche minuto per il briefing completo.
                  </p>
                </div>
              )}
              <div className="ds-well p-3.5">
                <p className="ds-eyebrow mb-1.5">Briefing</p>
                <p className="text-[15px] text-slate-200 leading-relaxed">“{briefing.briefing_text}”</p>
              </div>
              {briefing.tactical_advice && (
                <div className="rounded-xl border border-primary/25 bg-primary/[0.05] p-3.5">
                  <p className="ds-eyebrow !text-primary/90 mb-1.5">Consiglio tattico</p>
                  <p className="text-sm text-slate-200 leading-relaxed">{briefing.tactical_advice}</p>
                </div>
              )}
              <div className="flex items-center gap-3 flex-wrap">
                {/* Su un piano di ripiego "Rigenera" è un nuovo tentativo (non consuma le rigenerazioni). */}
                <button type="button" onClick={() => handleScan(!briefingFallback)} disabled={scanning} className={`${BTN_GHOST} ds-btn-sm`}>
                  <Icon name="refresh" className={`w-3.5 h-3.5 ${scanning ? 'animate-spin' : ''}`} />
                  {scanning ? 'Rigenerazione…' : briefingFallback ? 'Riprova con Karen' : 'Rigenera'}
                </button>
                {scanFeedback === 'success' && <span className="text-xs text-secondary">Briefing rigenerato.</span>}
                {scanFeedback === 'cached' && <span className="text-xs text-slate-500">Già presente per oggi: nessuna nuova chiamata all'IA.</span>}
                {scanFeedback === 'fallback' && <span className="text-xs text-accent">{scanMessage || 'Karen non ha risposto: piano di ripiego.'}</span>}
                {scanFeedback === 'error' && <span className="text-xs text-primary">{scanMessage || 'Rigenerazione non riuscita. Riprova.'}</span>}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center text-center py-6 gap-4">
              <p className="text-sm text-slate-400 max-w-sm">
                Nessun briefing per oggi. Avvia la diagnostica: Karen calcola il Readiness e ti dà il consiglio tattico della giornata.
              </p>
              <button type="button" onClick={() => handleScan(false)} disabled={scanning} className={BTN_PRIMARY}>
                <Icon name={scanning ? 'radar' : 'satellite'} className={`w-4 h-4 ${scanning ? 'animate-spin' : ''}`} />
                {scanning ? 'Diagnostica in corso…' : 'Avvia la diagnostica'}
              </button>
              {scanFeedback === 'error' && <p className="text-xs text-primary">{scanMessage || 'Diagnostica non riuscita. Riprova.'}</p>}
            </div>
          )}
        </section>
      </div>

      {/* Recovery Survey — come ti senti oggi, su quattro assi */}
      <section className={`${CARD} space-y-5`} aria-label="Recovery Survey">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <span className="ds-icon-tile text-secondary">
              <Icon name="edit" className="w-[18px] h-[18px]" />
            </span>
            <div>
              <p className="ds-eyebrow">Quick Log del Cadetto</p>
              <h2 className="text-[15px] font-semibold text-white">Come ti senti oggi</h2>
            </div>
          </div>
          {subjectiveLog && <span className={BADGE.green}>Già compilato oggi · puoi aggiornarlo</span>}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-5">
          <SubjectiveSlider label="Focus" value={focusLevel} onChange={setFocusLevel} lowLabel="Disperso" highLabel="Lucido" />
          <SubjectiveSlider label="Energia" value={energyLevel} onChange={setEnergyLevel} lowLabel="Esausto" highLabel="Carico" />
          <SubjectiveSlider label="Stress" value={stressLevel} onChange={setStressLevel} lowLabel="Rilassato" highLabel="Teso" invert />
          <SubjectiveSlider
            label="Indolenzimento muscolare"
            value={muscleSoreness}
            onChange={setMuscleSoreness}
            lowLabel="Nessuno"
            highLabel="Forte"
            invert
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-5 pt-4 border-t border-line">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-slate-300">Caffeina di oggi</span>
              <span className="text-sm font-bold text-white ds-num">{formatInt(caffeineMg)} mg</span>
            </div>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {CAFFEINE_PRESETS.map((preset) => (
                <button key={preset.label} type="button" onClick={() => handleCaffeinePreset(preset)} className="ds-btn ds-btn-ghost ds-btn-sm">
                  {!preset.reset && <Icon name="bolt" className="w-3.5 h-3.5 text-accent" />}
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
              className={`${INPUT} ds-input-sm ds-num`}
              placeholder="mg a mano"
              aria-label="Caffeina in milligrammi"
            />
          </div>
          <div>
            <label className={LABEL} htmlFor="telemetry-note">
              Nota <span className="text-slate-500 font-normal">(facoltativa)</span>
            </label>
            <textarea
              id="telemetry-note"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className={`${INPUT} resize-none`}
              placeholder="Es. notte interrotta, allenamento pesante ieri…"
              maxLength={280}
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 flex-wrap">
          {saveFeedback === 'success' && <p className="text-xs text-emerald-300">Registrato: Karen ha aggiornato il contesto di oggi.</p>}
          {saveFeedback === 'error' && <p className="text-xs text-primary">Salvataggio non riuscito. Riprova.</p>}
          <button type="button" onClick={handleSave} disabled={saving} className={BTN_PRIMARY}>
            <Icon name={saving ? 'radar' : 'check'} className={`w-4 h-4 ${saving ? 'animate-spin' : ''}`} />
            {saving ? 'Registrazione…' : subjectiveLog ? 'Aggiorna il log di oggi' : 'Registra il log di oggi'}
          </button>
        </div>
      </section>
    </div>
  );
}
