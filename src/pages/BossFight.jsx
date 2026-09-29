import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useArachnoForge } from '../context/ArachnoForgeContext.jsx';
import { Icon } from '../components/Icons.jsx';
import { createPortal } from 'react-dom';
import Modal, { useOverlayLayer } from '../components/Modal.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import Dropdown from '../components/Dropdown.jsx';
import { formatClock, formatDateOnlyHuman } from '../utils/dateUtils.js';
import { computeStreakMultiplier, MAX_CARNAGE_MULTIPLIER } from '../utils/xpEngine.js';
import { isMaxCarnageActive } from '../utils/maxCarnage.js';
import { CARD, CARD_NOPAD, CARD_ALERT, BTN_PRIMARY, BTN_SECONDARY, BTN_SUCCESS, BTN_GHOST, BTN_DANGER, INPUT, LABEL, BADGE } from '../utils/designSystem.js';
import PageHeader from '../components/PageHeader.jsx';
import { formatInt, minutiLabel } from '../utils/format.js';
import { SIMULATION_MIN_MINUTES } from '../state/reducer.js';
import { haProvaScritta } from '../utils/appelli.js';

const PHASES = { SETUP: 'SETUP', FIGHTING: 'FIGHTING', WON: 'WON', LOST: 'LOST' };
const HP_PENALTY = 20;
const MAX_HP = 100;
const TACTICAL_PAUSE_COST = 40;
const TACTICAL_PAUSE_MS = 3 * 60 * 1000;
const ILLUMINATION_HEAL = 10;
const ILLUMINATION_MAX_USES = 2;
const ENRAGE_THRESHOLD = 0.15;
const LAST_STAND_WINDOW_MS = 3000;
// V32.0 — Sinister Six Gauntlet: 6 Villain in fila, stessa configurazione
// (materia/durata) per ogni round, HP che torna a 100 a ogni nuovo
// ingaggio. La run finisce alla prima sconfitta OPPURE alla vittoria sul
// sesto Villain — nessun continue, nessuna seconda chance tra un round e
// l'altro (a parte gli strumenti già esistenti: Pausa Tattica, Illuminazione, Last Stand).
const GAUNTLET_SIZE = 6;
const DURATION_PRESETS = [30, 60, 90, 120, 180];

function computeEfficiency(hp, remainingSeconds, totalSeconds) {
  const hpScore = hp / 100;
  const timeScore = totalSeconds > 0 ? remainingSeconds / totalSeconds : 0;
  const score = hpScore * 0.6 + timeScore * 0.4;
  if (score >= 0.85) return { grade: 'S', color: 'text-fuchsia-300' };
  if (score >= 0.7) return { grade: 'A', color: 'text-emerald-300' };
  if (score >= 0.5) return { grade: 'B', color: 'text-secondary' };
  if (score >= 0.3) return { grade: 'C', color: 'text-accent' };
  return { grade: 'D', color: 'text-primary' };
}

/** Riga delle regole: icona + testo. */
function BriefLine({ icon, tone = 'text-secondary', children }) {
  return (
    <li className="flex items-start gap-3">
      <Icon name={icon} className={`w-4 h-4 shrink-0 mt-0.5 ${tone}`} />
      <p className="text-[13px] text-slate-300 leading-relaxed">{children}</p>
    </li>
  );
}

export default function BossFight() {
  const { state, actions, audio, derived } = useArachnoForge();
  // V25.0 — Skill Tree ("Istinto di Ragno"): riduce il danno subito da
  // ogni Penalità. Arrotondato per eccesso a 1 HP minimo, cosi' la
  // Penalità mantiene sempre un peso reale anche a riduzione massima.
  const effectiveHpPenalty = Math.max(1, Math.round(HP_PENALTY * (1 - derived.skillEffects.bossDamageReduction)));
  const [phase, setPhase] = useState(PHASES.SETUP);
  const [materiaId, setMateriaId] = useState('');
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [hp, setHp] = useState(MAX_HP);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [totalSeconds, setTotalSeconds] = useState(0);
  const [abandonConfirmOpen, setAbandonConfirmOpen] = useState(false);
  const [penaltyLog, setPenaltyLog] = useState(0);
  const [shake, setShake] = useState(false);
  const [flash, setFlash] = useState(false);
  const [frozen, setFrozen] = useState(false);
  const [freezeRemainingMs, setFreezeRemainingMs] = useState(0);
  const [illuminazioniUsate, setIlluminazioniUsate] = useState(0);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportData, setReportData] = useState(null);
  const [lastStandActive, setLastStandActive] = useState(false);
  const [lastStandMsLeft, setLastStandMsLeft] = useState(0);
  // V32.0 — Sinister Six Gauntlet.
  const [gauntletMode, setGauntletMode] = useState(false);
  const [gauntletRound, setGauntletRound] = useState(1);
  const [gauntletHistory, setGauntletHistory] = useState([]);

  const endTimestampRef = useRef(null);
  const intervalRef = useRef(null);
  const hpRef = useRef(hp);
  const freezeEndRef = useRef(null);
  const freezeIntervalRef = useRef(null);
  const lastStandTimeoutRef = useRef(null);
  const lastStandIntervalRef = useRef(null);
  const remainingSecondsRef = useRef(remainingSeconds);
  // Ref stabile verso `endRound` (definito più sotto, dopo `tick`): rompe
  // la dipendenza circolare tick -> endRound -> tick senza mai lasciare
  // `tick` con una closure stantia sull'ultimo round del Gauntlet.
  const endRoundRef = useRef(null);
  useEffect(() => { hpRef.current = hp; }, [hp]);
  useEffect(() => { remainingSecondsRef.current = remainingSeconds; }, [remainingSeconds]);

  const materie = Array.isArray(state.materie) ? state.materie : [];
  const materia = materie.find((m) => m.id === materiaId) || null;

  // V42 — solo le materie ancora da sostenere: una simulazione serve a prepararle.
  const materiaOptions = [
    { value: '', label: 'Simulazione generica' },
    ...materie.filter((m) => m && !m.examPassed).map((m) => ({ value: m.id, label: m.nome }))
  ];

  // V42 — punteggio della prova, da registrare nel report (prontezza d'esame).
  const [scorePunti, setScorePunti] = useState('');
  const [scoreSu, setScoreSu] = useState('30');
  const [scoreSalvato, setScoreSalvato] = useState(false);

  const clearAllIntervals = () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (freezeIntervalRef.current) clearInterval(freezeIntervalRef.current);
    if (lastStandTimeoutRef.current) clearTimeout(lastStandTimeoutRef.current);
    if (lastStandIntervalRef.current) clearInterval(lastStandIntervalRef.current);
    intervalRef.current = null;
    freezeIntervalRef.current = null;
    lastStandTimeoutRef.current = null;
    lastStandIntervalRef.current = null;
  };

  // V42 — gli XP di una simulazione sono A TEMPO, come nel reducer: 2,5 al
  // minuto di prova vinta (di più con HP alti e streak), 1 al minuto se
  // persa (l'allenamento conta), niente sotto i 20 minuti. Prima una
  // vittoria valeva fino a 500 XP qualunque fosse la durata: cinque
  // minuti "vinti" pagavano come un compito di tre ore.
  const buildReport = (win, finalHp, finalRemaining, finalTotal) => {
    const elapsedSeconds = Math.max(0, finalTotal - finalRemaining);
    const minuti = Math.floor(elapsedSeconds / 60);
    const streakMult = computeStreakMultiplier(state.profile.streak, derived.skillEffects.streakThresholdBonus);
    let xpGain = 0;
    if (minuti >= SIMULATION_MIN_MINUTES) {
      xpGain = win ? minuti * 2.5 * (0.6 + (0.4 * finalHp) / 100) * streakMult : minuti * streakMult;
      if (isMaxCarnageActive(state.profile)) xpGain *= MAX_CARNAGE_MULTIPLIER;
      xpGain = Math.round(xpGain);
    }
    const efficiency = win ? computeEfficiency(finalHp, finalRemaining, finalTotal) : { grade: 'F', color: 'text-primary' };
    return { win, xpGain, hpRemaining: finalHp, timeRemainingSeconds: finalRemaining, totalSeconds: finalTotal, elapsedSeconds, minuti, efficiency };
  };

  const endFight = useCallback((win, finalHp) => {
    clearAllIntervals();
    endTimestampRef.current = null;
    freezeEndRef.current = null;
    const finalRemaining = remainingSeconds;
    const finalTotal = totalSeconds;
    setFrozen(false);
    setPhase(win ? PHASES.WON : PHASES.LOST);
    actions.bossFightResult({
      win,
      hpRemaining: finalHp,
      materiaId: materia ? materia.id : null,
      materiaNome: materia ? materia.nome : null,
      timeRemainingSeconds: finalRemaining,
      totalSeconds: finalTotal,
      elapsedSeconds: Math.max(0, finalTotal - finalRemaining)
    });
    setReportData(buildReport(win, finalHp, finalRemaining, finalTotal));
    setScorePunti('');
    setScoreSalvato(false);
    setReportOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actions, materia, remainingSeconds, totalSeconds]);

  const tick = useCallback(() => {
    if (!endTimestampRef.current) return;
    const remainingMs = endTimestampRef.current - Date.now();
    const remaining = Math.max(0, Math.ceil(remainingMs / 1000));
    setRemainingSeconds(remaining);
    if (remainingMs <= 0) {
      endRoundRef.current?.(hpRef.current > 0, hpRef.current);
    }
  }, []);

  /**
   * V32.0 — Sinister Six Gauntlet: wrapper attorno a `endFight` che resta
   * l'UNICA via d'uscita da un round, sia in Boss Fight singolo che in
   * Gauntlet. Fuori dal Gauntlet il comportamento è identico, byte per
   * byte, a prima (chiama `endFight` e basta — nessun rischio di
   * regressione sul percorso stabile). Dentro il Gauntlet: registra il
   * round in `gauntletHistory` tramite lo stesso `actions.bossFightResult`
   * già usato dal Boss Fight singolo (nessuna nuova fonte di XP), poi
   * incatena il Villain successivo se si è vinto e mancano round, oppure
   * chiude la run (sconfitta in qualunque round, o vittoria sul sesto).
   */
  const endRound = useCallback((win, finalHp) => {
    if (!gauntletMode) {
      endFight(win, finalHp);
      return;
    }
    clearAllIntervals();
    endTimestampRef.current = null;
    freezeEndRef.current = null;
    const finalRemaining = remainingSeconds;
    const finalTotal = totalSeconds;
    setFrozen(false);
    const roundReport = buildReport(win, finalHp, finalRemaining, finalTotal);
    actions.bossFightResult({
      win,
      hpRemaining: finalHp,
      materiaId: materia ? materia.id : null,
      materiaNome: materia ? materia.nome : null,
      timeRemainingSeconds: finalRemaining,
      totalSeconds: finalTotal,
      elapsedSeconds: Math.max(0, finalTotal - finalRemaining)
    });
    setGauntletHistory((prev) => [...prev, { round: gauntletRound, win, hp: finalHp, xpGain: roundReport.xpGain, efficiency: roundReport.efficiency }]);

    if (win && gauntletRound < GAUNTLET_SIZE) {
      actions.logEvent(`Sinister Six Gauntlet — Villain ${gauntletRound}/${GAUNTLET_SIZE} abbattuto. Prossimo ingaggio in arrivo.`, 'SUCCESS');
      setGauntletRound((r) => r + 1);
      const durationSeconds = Math.max(60, Math.round(durationMinutes * 60));
      endTimestampRef.current = Date.now() + durationSeconds * 1000;
      setTotalSeconds(durationSeconds);
      setRemainingSeconds(durationSeconds);
      setHp(MAX_HP);
      setPenaltyLog(0);
      setIlluminazioniUsate(0);
      intervalRef.current = setInterval(tick, 250);
      // phase resta FIGHTING: nessuna schermata WON intermedia tra un Villain e l'altro.
    } else {
      setPhase(win ? PHASES.WON : PHASES.LOST);
      setReportData(roundReport);
      setScorePunti('');
      setScoreSalvato(false);
      setReportOpen(true);
      // V33.1 — Run "pulita": tutti e 6 i Villain abbattuti in fila,
      // senza mai perdere un round. Segnale distinto da un normale round
      // vinto — alimenta il trofeo dedicato (che a sua volta innesca già
      // da solo Toast + Trophy Fanfare tramite useAchievements, nessuna
      // duplicazione di feedback da gestire qui).
      if (win && gauntletRound === GAUNTLET_SIZE) {
        actions.completeGauntlet();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gauntletMode, gauntletRound, actions, materia, remainingSeconds, totalSeconds, durationMinutes, tick, endFight]);

  useEffect(() => { endRoundRef.current = endRound; }, [endRound]);

  useEffect(() => () => clearAllIntervals(), []);

  /**
   * V37.0 — Una run in corso non sparisce più in silenzio.
   *
   * Tutto lo stato della Boss Fight vive in memoria di questa pagina:
   * bastava un tocco sbagliato nella Sidebar per perdere la run intera —
   * niente XP, niente `BOSS_LOSS` registrata, niente Gauntlet — senza un
   * solo avviso. Il browser non permette di intercettare una navigazione
   * interna con un dialogo asincrono, quindi si usa il meccanismo
   * nativo: `beforeunload` per chiusura/ricarica, e un listener sui
   * click della Sidebar per il cambio rotta.
   */
  const fightInCorso = phase === PHASES.FIGHTING;
  useEffect(() => {
    if (!fightInCorso) return undefined;
    const warn = (e) => {
      e.preventDefault();
      // Testo ignorato dai browser moderni, ma il prompt compare.
      e.returnValue = '';
      return '';
    };
    const onHashChange = () => {
      // La rotta è già cambiata: la run non è recuperabile, ma almeno
      // viene registrata come abbandonata invece di svanire.
      actions.logEvent('Sinister Six Simulator abbandonato: hai lasciato la pagina a simulazione in corso.', 'DANGER');
      clearAllIntervals();
    };
    window.addEventListener('beforeunload', warn);
    window.addEventListener('hashchange', onHashChange);
    return () => {
      window.removeEventListener('beforeunload', warn);
      window.removeEventListener('hashchange', onHashChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fightInCorso]);

  const startFight = () => {
    const durationSeconds = Math.max(60, Math.round(durationMinutes * 60));
    endTimestampRef.current = Date.now() + durationSeconds * 1000;
    setTotalSeconds(durationSeconds);
    setRemainingSeconds(durationSeconds);
    setHp(MAX_HP);
    setPenaltyLog(0);
    setIlluminazioniUsate(0);
    setFrozen(false);
    if (gauntletMode) {
      setGauntletRound(1);
      setGauntletHistory([]);
    }
    setPhase(PHASES.FIGHTING);
    intervalRef.current = setInterval(tick, 250);
  };

  const triggerShakeAndFlash = () => {
    setShake(true);
    setFlash(true);
    setTimeout(() => setShake(false), 400);
    setTimeout(() => setFlash(false), 500);
  };

  const applyPenalty = () => {
    if (frozen || lastStandActive) return;
    const next = Math.max(0, hpRef.current - effectiveHpPenalty);
    setPenaltyLog((n) => n + 1);
    triggerShakeAndFlash();
    audio.playPenaltyBuzzer();
    actions.logEvent(`Penalità Sinister Six Simulator: soluzione sbirciata, -${effectiveHpPenalty} HP.`, 'DANGER');
    if (next === 0) {
      setHp(0);
      setLastStandActive(true);
      setLastStandMsLeft(LAST_STAND_WINDOW_MS);
      const deadline = Date.now() + LAST_STAND_WINDOW_MS;
      lastStandIntervalRef.current = setInterval(() => {
        const msLeft = deadline - Date.now();
        setLastStandMsLeft(Math.max(0, msLeft));
      }, 100);
      lastStandTimeoutRef.current = setTimeout(() => {
        if (lastStandIntervalRef.current) clearInterval(lastStandIntervalRef.current);
        lastStandTimeoutRef.current = null;
        lastStandIntervalRef.current = null;
        setLastStandActive(false);
        endRoundRef.current?.(false, 0);
      }, LAST_STAND_WINDOW_MS);
    } else {
      setHp(next);
    }
  };

  const triggerLastStand = () => {
    if (lastStandTimeoutRef.current) clearTimeout(lastStandTimeoutRef.current);
    if (lastStandIntervalRef.current) clearInterval(lastStandIntervalRef.current);
    lastStandTimeoutRef.current = null;
    lastStandIntervalRef.current = null;
    setLastStandActive(false);
    actions.lastStandSacrifice();
    setHp(1);
  };

  const declareVictory = () => endRoundRef.current?.(true, hpRef.current);

  const abandon = () => endRoundRef.current?.(false, hpRef.current);

  const activateTacticalPause = () => {
    if (frozen || hpRef.current < TACTICAL_PAUSE_COST) return;
    const next = hpRef.current - TACTICAL_PAUSE_COST;
    setHp(next);
    if (intervalRef.current) clearInterval(intervalRef.current);
    setFrozen(true);
    freezeEndRef.current = Date.now() + TACTICAL_PAUSE_MS;
    setFreezeRemainingMs(TACTICAL_PAUSE_MS);
    actions.logEvent('Pausa Tattica attivata: timer congelato per 3 minuti (-40 HP).', 'CONFIG');

    freezeIntervalRef.current = setInterval(() => {
      const msLeft = freezeEndRef.current - Date.now();
      if (msLeft <= 0) {
        clearInterval(freezeIntervalRef.current);
        freezeIntervalRef.current = null;
        setFreezeRemainingMs(0);
        setFrozen(false);
        endTimestampRef.current = Date.now() + remainingSecondsRef.current * 1000;
        intervalRef.current = setInterval(tick, 250);
      } else {
        setFreezeRemainingMs(msLeft);
      }
    }, 250);
  };

  const useIllumination = () => {
    if (illuminazioniUsate >= ILLUMINATION_MAX_USES || frozen) return;
    setHp((prev) => Math.min(MAX_HP, prev + ILLUMINATION_HEAL));
    setIlluminazioniUsate((n) => n + 1);
    actions.logEvent(`Illuminazione: calcolo risolto al volo, +${ILLUMINATION_HEAL} HP.`, 'SUCCESS');
  };

  const resetToSetup = () => {
    setPhase(PHASES.SETUP);
    setHp(MAX_HP);
    setRemainingSeconds(0);
    setTotalSeconds(0);
    setPenaltyLog(0);
    setIlluminazioniUsate(0);
    setFrozen(false);
    setLastStandActive(false);
    setLastStandMsLeft(0);
    setReportOpen(false);
    setReportData(null);
    // Il toggle Gauntlet resta com'era (comodo per incatenare più run),
    // ma round/storico ripartono sempre puliti.
    setGauntletRound(1);
    setGauntletHistory([]);
  };

  const hpPct = (hp / MAX_HP) * 100;
  const isEnrage = totalSeconds > 0 && remainingSeconds / totalSeconds < ENRAGE_THRESHOLD && phase === PHASES.FIGHTING;

  // Goblin Alert: ronzio ansiogeno riprodotto una sola volta all'ingresso
  // in Fase Enrage (edge-triggered), mai in loop, per restare discreto.
  const prevEnrageRef = useRef(false);
  useEffect(() => {
    if (isEnrage && !prevEnrageRef.current) audio.playGoblinAlert();
    prevEnrageRef.current = isEnrage;
  }, [isEnrage, audio]);

  // V41 — le ultime simulazioni, accanto alla configurazione: il senso di
  // progresso fra una prova e l'altra (e un promemoria di come è andata).
  const recentFights = (Array.isArray(state.starLog) ? state.starLog : [])
    .filter((e) => e && (e.type === 'BOSS_WIN' || e.type === 'BOSS_LOSS'))
    .slice(-6)
    .reverse();
  const hpBarClass = hpPct > 60 ? 'bg-emerald-400' : hpPct > 25 ? 'bg-accent' : 'bg-primary';
  const durationValid = Number.isFinite(durationMinutes) && durationMinutes >= 1;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Simulazione d'esame"
        icon="crosshair"
        title="Sinister Six Simulator"
        subtitle="Una prova d'esame a tempo, come quella vera. Ogni soluzione sbirciata è un colpo del Villain."
      />

      {phase === PHASES.SETUP && (
        <div className="grid grid-cols-1 xl:grid-cols-5 gap-5 items-start">
          <section className={`${CARD} xl:col-span-3 space-y-5`} aria-label="Configura la simulazione">
            <div className="flex items-center gap-3">
              <span className="ds-icon-tile text-primary">
                <Icon name="crosshair" className="w-[18px] h-[18px]" />
              </span>
              <div>
                <p className="ds-eyebrow">Terminale di ingaggio</p>
                <h2 className="text-[17px] font-semibold text-white">Configura la simulazione</h2>
              </div>
            </div>

            <div>
              <label className={LABEL}>Materia</label>
              <Dropdown value={materiaId} onChange={setMateriaId} options={materiaOptions} placeholder="Simulazione generica" ariaLabel="Materia della simulazione" />
            </div>

            <div>
              <label className={LABEL} htmlFor="boss-durata">
                Durata della prova
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <div className="ds-segmented" role="radiogroup" aria-label="Durate rapide">
                  {DURATION_PRESETS.map((m) => (
                    <button key={m} type="button" role="radio" aria-checked={durationMinutes === m} onClick={() => setDurationMinutes(m)} className="ds-num">
                      {m < 60 ? `${m}m` : minutiLabel(m)}
                    </button>
                  ))}
                </div>
                <div className="relative w-32">
                  <input
                    id="boss-durata"
                    type="number"
                    min={1}
                    max={600}
                    value={Number.isFinite(durationMinutes) ? durationMinutes : ''}
                    onChange={(e) => setDurationMinutes(Number(e.target.value))}
                    className={`${INPUT} ds-input-sm ds-num !pr-10`}
                    aria-label="Durata in minuti"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500 pointer-events-none">min</span>
                </div>
              </div>
            </div>

            <div>
              <p className={LABEL}>Modalità</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" role="radiogroup" aria-label="Modalità">
                {[
                  { v: false, title: 'Villain singolo', hint: 'Una prova, un avversario.', icon: 'crosshair' },
                  { v: true, title: `Gauntlet · ${GAUNTLET_SIZE} in fila`, hint: 'HP pieni a ogni round; una sconfitta chiude la run.', icon: 'skull' }
                ].map((o) => {
                  const active = gauntletMode === o.v;
                  return (
                    <button
                      key={String(o.v)}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setGauntletMode(o.v)}
                      className={`flex items-start gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors ${
                        active ? (o.v ? 'border-primary/50 bg-primary/[0.07]' : 'border-secondary/50 bg-secondary/[0.07]') : 'border-line bg-surface/70 hover:border-line-strong'
                      }`}
                    >
                      <Icon name={o.icon} className={`w-4 h-4 mt-0.5 shrink-0 ${active ? (o.v ? 'text-primary' : 'text-secondary') : 'text-slate-500'}`} />
                      <span className="min-w-0">
                        <span className={`block text-sm font-semibold ${active ? 'text-white' : 'text-slate-300'}`}>{o.title}</span>
                        <span className="block text-xs text-slate-500 mt-0.5">{o.hint}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <button type="button" onClick={startFight} disabled={!durationValid} className={`w-full ${BTN_PRIMARY} ds-btn-lg`}>
              <Icon name="crosshair" className="w-5 h-5" />
              {gauntletMode ? `Ingaggia il Gauntlet (${GAUNTLET_SIZE} Villain)` : 'Ingaggia il Villain'}
            </button>
          </section>

          <div className="xl:col-span-2 space-y-5">
            <section className={`${CARD} space-y-3`} aria-label="Regole">
              <h2 className="text-[15px] font-semibold text-white">Regole dello scontro</h2>
              <ul className="space-y-2.5">
                <BriefLine icon="heart" tone="text-emerald-300">
                  Parti con {MAX_HP} HP. Ogni soluzione sbirciata costa {effectiveHpPenalty} HP
                  {derived.skillEffects.bossDamageReduction > 0 && (
                    <span className="text-secondary"> (Istinto di Ragno: −{Math.round(derived.skillEffects.bossDamageReduction * 100)}% danno)</span>
                  )}
                  .
                </BriefLine>
                <BriefLine icon="moon">Pausa Tattica: congela il timer per 3 minuti al costo di {TACTICAL_PAUSE_COST} HP.</BriefLine>
                <BriefLine icon="bolt" tone="text-accent">
                  Illuminazione: +{ILLUMINATION_HEAL} HP quando risolvi un passaggio da solo, al massimo {ILLUMINATION_MAX_USES} volte.
                </BriefLine>
                <BriefLine icon="alertTriangle" tone="text-primary">
                  Sotto il {Math.round(ENRAGE_THRESHOLD * 100)}% del tempo il Villain entra in Fase Enrage.
                </BriefLine>
                <BriefLine icon="skull" tone="text-primary">
                  A 0 HP hai 3 secondi per il Last Stand: sacrifichi il 10% dell'XP e resti in piedi a 1 HP.
                </BriefLine>
                <BriefLine icon="trophy" tone="text-amber-300">
                  XP a tempo: 2,5 al minuto di prova vinta (di più con HP alti e una serie lunga), 1 al minuto se la perdi — l’allenamento conta. Sotto i{' '}
                  {SIMULATION_MIN_MINUTES} minuti non vale come prova.
                </BriefLine>
                <BriefLine icon="chartBar" tone="text-secondary">
                  Alla fine registri il punteggio: le simulazioni sono il dato più forte della prontezza d’esame della materia.
                </BriefLine>
              </ul>
            </section>

            <section className={CARD_NOPAD} aria-label="Ultime simulazioni">
              <div className="flex items-center justify-between gap-2 px-5 py-3.5 border-b border-line">
                <h2 className="text-[15px] font-semibold text-white">Ultime simulazioni</h2>
                {recentFights.length > 0 && (
                  <span className="text-xs text-slate-500 ds-num">
                    {recentFights.filter((f) => f.type === 'BOSS_WIN').length}/{recentFights.length} vinte
                  </span>
                )}
              </div>
              {recentFights.length === 0 ? (
                <p className="px-5 py-4 text-[13px] text-slate-400">Nessuna ancora: la prima è quella che conta.</p>
              ) : (
                <ul className="divide-y divide-white/[0.06]">
                  {recentFights.map((f, i) => {
                    const won = f.type === 'BOSS_WIN';
                    return (
                      <li key={`${f.timestamp || f.dateKey}-${i}`} className="flex items-center justify-between gap-3 px-5 py-2.5">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <Icon name={won ? 'trophy' : 'skull'} className={`w-4 h-4 shrink-0 ${won ? 'text-emerald-300' : 'text-primary'}`} />
                          <div className="min-w-0">
                            <p className="text-[13px] text-slate-100 truncate">{f.materiaNome || 'Simulazione generica'}</p>
                            <p className="text-xs text-slate-500 ds-num">
                              {formatDateOnlyHuman(f.dateKey)} · {formatInt(f.hpRemaining)} HP
                            </p>
                          </div>
                        </div>
                        <span className={`${won ? BADGE.green : BADGE.red} ds-num`}>
                          {won ? `+${formatInt(f.xp)} XP` : f.xp > 0 ? `Persa · +${formatInt(f.xp)} XP` : 'Persa'}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>
        </div>
      )}

      {phase === PHASES.FIGHTING && (
        <div className={`relative w-full max-w-2xl mx-auto ${shake ? 'af-shake' : ''}`}>
          {/* V39 — il flash vive in document.body: dentro .af-shake (che
              anima `transform`) il `fixed` diventava relativo alla card. */}
          {flash && typeof document !== 'undefined' &&
            createPortal(<div className="af-flash fixed inset-0 z-50 bg-primary pointer-events-none" />, document.body)}
          <div className={`${isEnrage ? CARD_ALERT : CARD} space-y-6`}>
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="min-w-0">
                <p className="ds-eyebrow flex items-center gap-2">
                  {isEnrage ? <span className="text-primary">Fase Enrage</span> : 'Scontro in corso'}
                  {gauntletMode && (
                    <span key={gauntletRound} className={`af-gauntlet-round-pop ${BADGE.red}`}>
                      Villain {gauntletRound}/{GAUNTLET_SIZE}
                    </span>
                  )}
                </p>
                <p className="text-lg font-semibold text-white mt-1 break-words">{materia ? materia.nome : 'Simulazione generica'}</p>
              </div>
              <span className={`text-5xl font-bold ds-num tracking-tight shrink-0 ${isEnrage ? 'text-primary af-enrage' : 'text-white'}`}>
                {formatClock(remainingSeconds)}
              </span>
            </div>

            {frozen && (
              <div className="rounded-xl border border-secondary/35 bg-secondary/[0.07] px-4 py-2.5 flex items-center justify-between">
                <span className="text-sm font-medium text-secondary flex items-center gap-2">
                  <Icon name="moon" className="w-4 h-4" />
                  Pausa Tattica: timer congelato
                </span>
                <span className="text-sm ds-num text-secondary">{formatClock(Math.ceil(freezeRemainingMs / 1000))}</span>
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-slate-300 flex items-center gap-1.5">
                  <Icon name="heart" className="w-4 h-4" />
                  HP
                </span>
                <span className="text-sm ds-num text-white font-semibold">
                  {hp}
                  <span className="text-slate-500 font-normal">/{MAX_HP}</span>
                </span>
              </div>
              <div className="ds-progress !h-3">
                <span className={hpBarClass} style={{ width: `${hpPct}%` }} />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <button type="button" onClick={applyPenalty} disabled={frozen || lastStandActive} className={`${BTN_DANGER} ds-btn-lg flex-col !gap-1`}>
                <Icon name="skull" className="w-5 h-5" />
                <span>Ho sbirciato</span>
                <span className="text-xs font-normal opacity-80">−{effectiveHpPenalty} HP</span>
              </button>
              <button
                type="button"
                onClick={activateTacticalPause}
                disabled={frozen || hp < TACTICAL_PAUSE_COST || lastStandActive}
                className={`${BTN_GHOST} ds-btn-lg flex-col !gap-1`}
              >
                <Icon name="moon" className="w-5 h-5 text-secondary" />
                <span>Pausa Tattica</span>
                <span className="text-xs font-normal text-slate-500">3 min · −{TACTICAL_PAUSE_COST} HP</span>
              </button>
              <button
                type="button"
                onClick={useIllumination}
                disabled={illuminazioniUsate >= ILLUMINATION_MAX_USES || frozen || lastStandActive}
                className={`${BTN_GHOST} ds-btn-lg flex-col !gap-1`}
              >
                <Icon name="bolt" className="w-5 h-5 text-accent" />
                <span>Illuminazione</span>
                <span className="text-xs font-normal text-slate-500">
                  +{ILLUMINATION_HEAL} HP · {ILLUMINATION_MAX_USES - illuminazioniUsate} rimaste
                </span>
              </button>
            </div>

            <div className="flex flex-col-reverse sm:flex-row gap-2.5">
              <button type="button" onClick={() => setAbandonConfirmOpen(true)} disabled={lastStandActive} className={`${BTN_GHOST} sm:w-40`}>
                Abbandona
              </button>
              <button type="button" onClick={declareVictory} disabled={frozen || lastStandActive} className={`${BTN_SUCCESS} flex-1`}>
                <Icon name="trophy" className="w-4 h-4" />
                Prova completata: dichiaro vittoria
              </button>
            </div>

            <p className="text-xs text-slate-500 text-center ds-num">
              {penaltyLog === 0 ? 'Nessuna soluzione sbirciata finora.' : penaltyLog === 1 ? '1 soluzione sbirciata.' : `${penaltyLog} soluzioni sbirciate.`}
            </p>
          </div>
        </div>
      )}

      {(phase === PHASES.WON || phase === PHASES.LOST) && (
        <div className={`w-full max-w-xl mx-auto ${phase === PHASES.WON ? CARD : CARD_ALERT} text-center space-y-4 !py-8`}>
          <span
            className={`mx-auto w-14 h-14 rounded-2xl border flex items-center justify-center ${
              phase === PHASES.WON ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-300' : 'border-primary/40 bg-primary/10 text-primary'
            }`}
          >
            <Icon name={phase === PHASES.WON ? 'trophy' : 'skull'} className="w-7 h-7" />
          </span>
          <h2 className={`text-2xl font-bold ${phase === PHASES.WON ? 'text-emerald-300' : 'text-primary'}`}>
            {gauntletMode
              ? phase === PHASES.WON
                ? 'Gauntlet completato'
                : `Gauntlet interrotto al Villain ${gauntletRound}/${GAUNTLET_SIZE}`
              : phase === PHASES.WON
              ? 'Villain abbattuto'
              : 'Game over'}
          </h2>
          <p className="text-sm text-slate-400 max-w-md mx-auto">
            {gauntletMode
              ? phase === PHASES.WON
                ? `Tutti e ${GAUNTLET_SIZE} i Villain abbattuti in fila. Il report ha il riepilogo round per round.`
                : "La run si ferma qui. L'XP dei round già vinti resta tuo."
              : phase === PHASES.WON
              ? 'Prova superata. Nel report trovi XP, HP e grado di efficienza, e puoi registrare il punteggio.'
              : reportData?.xpGain > 0
              ? `Prova persa, ma ${reportData.minuti} minuti di allenamento valgono comunque +${formatInt(reportData.xpGain)} XP. Rivedi dove hai sbirciato.`
              : 'Nessun XP questa volta. Rivedi dove hai sbirciato e riprova quando sei pronto.'}
          </p>
          <div className="flex items-center justify-center gap-2 pt-1">
            <button type="button" onClick={() => setReportOpen(true)} className={BTN_SECONDARY}>
              Rivedi il report
            </button>
            <button type="button" onClick={resetToSetup} className={BTN_GHOST}>
              Nuova simulazione
            </button>
          </div>
        </div>
      )}

      {lastStandActive && <LastStandOverlay msLeft={lastStandMsLeft} onTrigger={triggerLastStand} />}

      <ConfirmDialog
        open={abandonConfirmOpen}
        onClose={() => setAbandonConfirmOpen(false)}
        onConfirm={abandon}
        title={gauntletMode ? 'Abbandonare il Gauntlet?' : 'Abbandonare la simulazione?'}
        message={
          gauntletMode
            ? `Il Gauntlet si chiude come sconfitta al Villain ${gauntletRound}/${GAUNTLET_SIZE}: questo round non dà XP, quelli già vinti restano.`
            : `Conta come sconfitta. Se hai lavorato almeno ${SIMULATION_MIN_MINUTES} minuti il tempo vale come allenamento (1 XP al minuto).`
        }
        confirmLabel="Abbandona"
      />

      <Modal open={reportOpen} onClose={() => setReportOpen(false)} title="Post-Match Report">
        {reportData && (
          <div className="space-y-4">
            <div className="text-center">
              <span className={`text-6xl font-bold ds-num ${reportData.efficiency.color}`}>{reportData.efficiency.grade}</span>
              <p className="ds-eyebrow mt-1">Grado di efficienza</p>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="ds-well px-3 py-2.5 text-center">
                <p className="text-lg font-bold ds-num text-accent">+{formatInt(reportData.xpGain)}</p>
                <p className="text-[11px] text-slate-500">XP</p>
              </div>
              <div className="ds-well px-3 py-2.5 text-center">
                <p className="text-lg font-bold ds-num text-white">{reportData.hpRemaining}</p>
                <p className="text-[11px] text-slate-500">HP rimasti</p>
              </div>
              <div className="ds-well px-3 py-2.5 text-center">
                <p className="text-lg font-bold ds-num text-secondary">{formatClock(reportData.timeRemainingSeconds)}</p>
                <p className="text-[11px] text-slate-500">tempo avanzato</p>
              </div>
            </div>

            <p className="text-xs text-slate-500 text-center ds-num">
              {minutiLabel(reportData.minuti || 0)} di prova
              {(reportData.minuti || 0) < SIMULATION_MIN_MINUTES ? ` · sotto i ${SIMULATION_MIN_MINUTES} minuti non dà XP` : ''}
            </p>

            {/* V42 — il punteggio della prova entra nella prontezza d'esame. */}
            {materia && (reportData.minuti || 0) >= SIMULATION_MIN_MINUTES && (
              <div className="ds-well p-3.5 space-y-2.5">
                <p className="text-sm font-semibold text-slate-100">Com’è andata la prova?</p>
                {scoreSalvato ? (
                  <p className="text-xs text-emerald-300">Punteggio registrato su {materia.nome}: conta nella prontezza d’esame.</p>
                ) : (
                  <div className="flex items-end gap-2.5 flex-wrap">
                    <label className="block">
                      <span className="block text-[11px] text-slate-500 mb-1">Punti</span>
                      <input type="number" min={0} value={scorePunti} onChange={(e) => setScorePunti(e.target.value)} className={`${INPUT} ds-input-sm !w-24 ds-num`} />
                    </label>
                    <label className="block">
                      <span className="block text-[11px] text-slate-500 mb-1">su</span>
                      <input type="number" min={1} value={scoreSu} onChange={(e) => setScoreSu(e.target.value)} className={`${INPUT} ds-input-sm !w-24 ds-num`} />
                    </label>
                    <button
                      type="button"
                      disabled={!(Number(scoreSu) > 0 && Number(scorePunti) >= 0 && scorePunti !== '' && Number(scorePunti) <= Number(scoreSu))}
                      onClick={() => {
                        const p = Number(scorePunti);
                        const t = Number(scoreSu);
                        actions.addSimulazione(materia.id, {
                          tipo: haProvaScritta(materia) ? 'SCRITTO' : 'ORALE',
                          punteggioPct: Math.round((p / t) * 100),
                          voto: t === 30 ? p : null,
                          durataMin: reportData.minuti || 0,
                          fonte: 'BOSS_FIGHT'
                        });
                        setScoreSalvato(true);
                      }}
                      className={`${BTN_SECONDARY} ds-btn-sm`}
                    >
                      Registra
                    </button>
                  </div>
                )}
              </div>
            )}

            {gauntletMode && gauntletHistory.length > 0 && (
              <div className="space-y-2 pt-3 border-t border-line">
                <p className="ds-eyebrow">Gauntlet · round per round</p>
                <ul className="space-y-1.5">
                  {gauntletHistory.map((r) => (
                    <li key={r.round} className="flex items-center justify-between gap-2 ds-well px-3 py-2">
                      <span className="text-sm text-slate-200 flex items-center gap-2">
                        <Icon name={r.win ? 'trophy' : 'skull'} className={`w-4 h-4 ${r.win ? 'text-emerald-300' : 'text-primary'}`} />
                        Villain {r.round}/{GAUNTLET_SIZE}
                      </span>
                      <span className="text-xs ds-num text-slate-400">
                        {r.hp} HP · +{formatInt(r.xpGain)} XP
                      </span>
                    </li>
                  ))}
                </ul>
                {gauntletHistory.length === GAUNTLET_SIZE && gauntletHistory.every((r) => r.win) && (
                  <p className="text-xs text-emerald-300 text-center pt-1">Gauntlet pulito: {GAUNTLET_SIZE} Villain su {GAUNTLET_SIZE}.</p>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                setReportOpen(false);
                if (phase === PHASES.WON || phase === PHASES.LOST) resetToSetup();
              }}
              className={`w-full ${BTN_GHOST}`}
            >
              Chiudi il report
            </button>
          </div>
        )}
      </Modal>
    </div>
  );
}

/**
 * V39.0 — Last Stand come livello sovrapposto vero: portal su
 * document.body (prima restava dentro la pagina e poteva essere catturato
 * da un antenato con `transform`/`filter`), pila Esc/Tab condivisa con le
 * modali (Esc non chiude: la scelta è a tempo, non si annulla), focus
 * portato subito sul pulsante — da tastiera basta Invio — e margine
 * laterale sui telefoni. La classe `af-enrage-pulse` usata prima non
 * esisteva: ora pulsa davvero con `af-enrage`.
 */
function LastStandOverlay({ msLeft, onTrigger }) {
  const panelRef = useRef(null);
  const btnRef = useRef(null);
  useOverlayLayer({ open: true, onClose: null, panelRef, initialFocusRef: btnRef, priority: 50 });
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center px-4 bg-black/75 backdrop-blur-sm"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="af-last-stand-title"
    >
      <div ref={panelRef} className={`${CARD_ALERT} !shadow-pop w-full max-w-sm text-center space-y-4 !py-7`}>
        <span className="mx-auto w-14 h-14 rounded-2xl border border-primary/40 bg-primary/10 text-primary flex items-center justify-center">
          <Icon name="skull" className="w-7 h-7" />
        </span>
        <h3 id="af-last-stand-title" className="text-2xl font-bold text-primary af-enrage">
          Last Stand
        </h3>
        <p className="text-sm text-slate-300 leading-relaxed">
          Sei a 0 HP. Sacrifica il 10% del tuo XP disponibile per restare in piedi a 1 HP e continuare la prova.
        </p>
        <p className="text-4xl font-bold ds-num text-primary" aria-live="off">
          {(msLeft / 1000).toFixed(1).replace('.', ',')} s
        </p>
        <button ref={btnRef} type="button" onClick={onTrigger} className={`w-full ${BTN_PRIMARY} ds-btn-lg`}>
          Sacrifica XP e resisti
        </button>
      </div>
    </div>,
    document.body
  );
}
