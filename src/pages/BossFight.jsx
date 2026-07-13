import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useArachnoForge } from '../context/ArachnoForgeContext.jsx';
import { Icon } from '../components/Icons.jsx';
import Modal from '../components/Modal.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import Dropdown from '../components/Dropdown.jsx';
import { formatClock } from '../utils/dateUtils.js';
import { computeStreakMultiplier } from '../utils/xpEngine.js';
import { CARD, CARD_ALERT, BTN_PRIMARY, BTN_SECONDARY, BTN_SUCCESS, BTN_AMBER, BTN_GHOST, INPUT, H1 } from '../utils/designSystem.js';

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

function computeEfficiency(hp, remainingSeconds, totalSeconds) {
  const hpScore = hp / 100;
  const timeScore = totalSeconds > 0 ? remainingSeconds / totalSeconds : 0;
  const score = hpScore * 0.6 + timeScore * 0.4;
  if (score >= 0.85) return { grade: 'S', color: 'text-fuchsia-400' };
  if (score >= 0.7) return { grade: 'A', color: 'text-emerald-400' };
  if (score >= 0.5) return { grade: 'B', color: 'text-secondary' };
  if (score >= 0.3) return { grade: 'C', color: 'text-accent' };
  return { grade: 'D', color: 'text-primary' };
}

/** Riga informativa del Terminale di Ingaggio — icona + testo, mai un blocco di testo nudo. */
function BriefLine({ icon, children }) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon name={icon} className="w-4 h-4 text-secondary shrink-0 mt-0.5" />
      <p className="text-sm text-slate-400 leading-relaxed">{children}</p>
    </div>
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

  const materiaOptions = [
    { value: '', label: 'Simulazione generica' },
    ...materie.map((m) => ({ value: m.id, label: m.nome }))
  ];

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

  const buildReport = (win, finalHp, finalRemaining, finalTotal) => {
    const xpGain = win
      ? Math.round(500 * (0.5 + finalHp / 200) * computeStreakMultiplier(state.profile.streak, derived.skillEffects.streakThresholdBonus))
      : 0;
    const efficiency = win ? computeEfficiency(finalHp, finalRemaining, finalTotal) : { grade: 'F', color: 'text-primary' };
    return { win, xpGain, hpRemaining: finalHp, timeRemainingSeconds: finalRemaining, totalSeconds: finalTotal, efficiency };
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
      materiaNome: materia ? materia.nome : null,
      timeRemainingSeconds: finalRemaining,
      totalSeconds: finalTotal
    });
    setReportData(buildReport(win, finalHp, finalRemaining, finalTotal));
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
      materiaNome: materia ? materia.nome : null,
      timeRemainingSeconds: finalRemaining,
      totalSeconds: finalTotal
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
  const hpColor = hpPct > 60 ? 'from-emerald-400 to-emerald-600' : hpPct > 25 ? 'from-accent to-accent/70' : 'from-primary to-primary-dark';
  const isEnrage = totalSeconds > 0 && remainingSeconds / totalSeconds < ENRAGE_THRESHOLD && phase === PHASES.FIGHTING;

  // Goblin Alert: ronzio ansiogeno riprodotto una sola volta all'ingresso
  // in Fase Enrage (edge-triggered), mai in loop, per restare discreto.
  const prevEnrageRef = useRef(false);
  useEffect(() => {
    if (isEnrage && !prevEnrageRef.current) audio.playGoblinAlert();
    prevEnrageRef.current = isEnrage;
  }, [isEnrage, audio]);

  return (
    <div className="space-y-6 min-h-[calc(100dvh-4rem)] flex flex-col">
      <div>
        <h1 className={H1}>Sinister Six Simulator</h1>
        <p className="text-base text-slate-400 mt-1.5">Karen: modalità isolata per la simulazione di prove d'esame a tempo.</p>
      </div>

      <div className="flex-1 flex items-center justify-center py-6">
        {phase === PHASES.SETUP && (
          <div className={`w-full max-w-lg ${CARD} space-y-6`}>
            {/* Cornici angolari da "Terminale di Ingaggio" — stile cockpit, non un form qualunque. */}
            <span className="absolute top-3 left-3 w-6 h-6 border-t-2 border-l-2 border-secondary/50 rounded-tl-lg pointer-events-none" />
            <span className="absolute top-3 right-3 w-6 h-6 border-t-2 border-r-2 border-secondary/50 rounded-tr-lg pointer-events-none" />
            <span className="absolute bottom-3 left-3 w-6 h-6 border-b-2 border-l-2 border-secondary/50 rounded-bl-lg pointer-events-none" />
            <span className="absolute bottom-3 right-3 w-6 h-6 border-b-2 border-r-2 border-secondary/50 rounded-br-lg pointer-events-none" />
            <div className="absolute inset-x-0 top-0 h-1/2 opacity-[0.04] pointer-events-none animate-scanline bg-gradient-to-b from-transparent via-white to-transparent" />

            <div className="relative flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-primary/10 border border-primary/40 flex items-center justify-center text-primary shrink-0">
                <Icon name="crosshair" className="w-6 h-6" />
              </div>
              <div>
                <p className="text-xs tracking-[0.2em] text-slate-500 font-mono">TERMINALE DI INGAGGIO</p>
                <p className="text-lg font-bold text-white">Configura la Simulazione</p>
              </div>
            </div>

            <div className="relative space-y-4">
              <div>
                <label className="text-sm text-slate-400 flex items-center gap-1.5 mb-1.5">
                  <Icon name="book" className="w-4 h-4" />
                  Materia (opzionale)
                </label>
                <Dropdown value={materiaId} onChange={setMateriaId} options={materiaOptions} placeholder="Simulazione generica" />
              </div>
              <div>
                <label className="text-sm text-slate-400 flex items-center gap-1.5 mb-1.5">
                  <Icon name="radar" className="w-4 h-4" />
                  Tempo prova (minuti)
                </label>
                <input
                  type="number"
                  min={1}
                  value={durationMinutes}
                  onChange={(e) => setDurationMinutes(Number(e.target.value))}
                  className={INPUT}
                />
              </div>
              <div>
                <label className="text-sm text-slate-400 flex items-center gap-1.5 mb-1.5">
                  <Icon name="skull" className="w-4 h-4" />
                  Modalità
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setGauntletMode(false)}
                    className={`py-2.5 rounded-xl border text-sm font-semibold transition-all duration-300 ${
                      !gauntletMode
                        ? 'border-secondary/60 bg-secondary/10 text-secondary shadow-secondary-glow'
                        : 'border-white/10 bg-white/[0.02] text-slate-400 hover:border-white/20'
                    }`}
                  >
                    Villain Singolo
                  </button>
                  <button
                    type="button"
                    onClick={() => setGauntletMode(true)}
                    className={`py-2.5 rounded-xl border text-sm font-semibold transition-all duration-300 ${
                      gauntletMode
                        ? 'border-primary/60 bg-primary/10 text-primary shadow-primary-glow'
                        : 'border-white/10 bg-white/[0.02] text-slate-400 hover:border-white/20'
                    }`}
                  >
                    Gauntlet (6 in fila)
                  </button>
                </div>
              </div>
            </div>

            <div className="relative bg-surface/70 border border-secondary/15 rounded-xl p-4 space-y-2.5">
              <BriefLine icon="skull">
                HP iniziali: 100. Penalità -{effectiveHpPenalty} HP per sbirciare una soluzione.
                {derived.skillEffects.bossDamageReduction > 0 && (
                  <span className="text-secondary"> (Istinto di Ragno: -{Math.round(derived.skillEffects.bossDamageReduction * 100)}% danno)</span>
                )}
              </BriefLine>
              <BriefLine icon="moon">Pausa Tattica: congela il timer 3 minuti per -{TACTICAL_PAUSE_COST} HP.</BriefLine>
              <BriefLine icon="bolt">Illuminazione: +{ILLUMINATION_HEAL} HP, usabile max {ILLUMINATION_MAX_USES} volte a run.</BriefLine>
              <BriefLine icon="alertTriangle">Sotto il {Math.round(ENRAGE_THRESHOLD * 100)}% del tempo residuo: Fase Enrage.</BriefLine>
              {gauntletMode && (
                <BriefLine icon="skull">
                  <span className="text-primary">Sinister Six Gauntlet:</span> {GAUNTLET_SIZE} Villain in fila, HP che torna a 100 a ogni nuovo ingaggio. La sconfitta in un QUALSIASI round chiude subito l'intera run.
                </BriefLine>
              )}
            </div>

            <button type="button" onClick={startFight} className={`relative w-full ${BTN_PRIMARY}`}>
              <Icon name="crosshair" className="w-6 h-6" />
              {gauntletMode ? `Ingaggia il Sinister Six Gauntlet (${GAUNTLET_SIZE} Villain)` : 'Ingaggia Sinister Six Simulator'}
            </button>
          </div>
        )}

        {phase === PHASES.FIGHTING && (
          <div className={`relative w-full max-w-xl ${shake ? 'af-shake' : ''}`}>
            {flash && <div className="af-flash fixed inset-0 z-50 bg-primary pointer-events-none" />}
            <div className={isEnrage ? `${CARD_ALERT} space-y-6` : `${CARD} space-y-6`}>
              {isEnrage && <div className="absolute -inset-1 rounded-2xl bg-primary/10 blur-xl pointer-events-none" />}
              <div className="relative flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-base tracking-widest text-slate-400 font-mono truncate min-w-0">{materia ? materia.nome.toUpperCase() : 'SIMULAZIONE'}</span>
                  {gauntletMode && (
                    <span
                      key={gauntletRound}
                      className="af-gauntlet-round-pop shrink-0 text-[11px] font-mono px-2 py-0.5 rounded-full border border-primary/50 bg-primary/10 text-primary"
                    >
                      VILLAIN {gauntletRound}/{GAUNTLET_SIZE}
                    </span>
                  )}
                </div>
                <span className={`text-3xl sm:text-4xl font-mono font-bold af-mono-nums shrink-0 ${isEnrage ? 'text-primary af-enrage' : 'text-white'}`}>
                  {formatClock(remainingSeconds)}
                </span>
              </div>

              {frozen && (
                <div className="relative bg-secondary/10 border border-secondary/40 rounded-xl px-4 py-2.5 flex items-center justify-between">
                  <span className="text-base text-secondary flex items-center gap-2">
                    <Icon name="moon" className="w-5 h-5" />
                    PAUSA TATTICA ATTIVA
                  </span>
                  <span className="text-base font-mono text-secondary">{formatClock(Math.ceil(freezeRemainingMs / 1000))}</span>
                </div>
              )}

              <div className="relative">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-base font-semibold text-slate-300 flex items-center gap-1.5">
                    <Icon name="heart" className="w-5 h-5" />
                    HP BOSS
                  </span>
                  <span className="text-base font-mono text-white">{hp}/100</span>
                </div>
                <div className="w-full h-4 bg-surface/80 border border-white/10 rounded-full overflow-hidden">
                  <div className={`h-full bg-gradient-to-r ${hpColor} transition-all duration-300`} style={{ width: `${hpPct}%` }} />
                </div>
              </div>

              <div className="relative grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={applyPenalty}
                  disabled={frozen || lastStandActive}
                  className="py-3 rounded-xl bg-white/[0.03] backdrop-blur-md border border-primary/30 text-primary font-semibold hover:bg-primary/10 hover:border-primary/60 transition-all duration-300 flex flex-col items-center gap-1 disabled:opacity-40 disabled:pointer-events-none"
                >
                  <Icon name="skull" className="w-6 h-6" />
                  <span className="text-center">PENALITÀ (-{effectiveHpPenalty} HP)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setAbandonConfirmOpen(true)}
                  disabled={lastStandActive}
                  className={BTN_GHOST}
                >
                  Abbandona
                </button>
              </div>

              <div className="relative grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={activateTacticalPause}
                  disabled={frozen || hp < TACTICAL_PAUSE_COST || lastStandActive}
                  className={BTN_SECONDARY}
                >
                  <Icon name="moon" className="w-5 h-5 shrink-0" />
                  <span className="truncate">Pausa Tattica (-{TACTICAL_PAUSE_COST} HP)</span>
                </button>
                <button
                  type="button"
                  onClick={useIllumination}
                  disabled={illuminazioniUsate >= ILLUMINATION_MAX_USES || frozen || lastStandActive}
                  className={BTN_AMBER}
                >
                  <Icon name="bolt" className="w-5 h-5 shrink-0" />
                  <span className="truncate">Illuminazione ({ILLUMINATION_MAX_USES - illuminazioniUsate} rim.)</span>
                </button>
              </div>

              <button
                type="button"
                onClick={declareVictory}
                disabled={frozen || lastStandActive}
                className={`relative w-full ${BTN_SUCCESS}`}
              >
                Dichiaro Vittoria (prova completata)
              </button>

              <p className="relative text-[11px] text-slate-500 text-center">Penalità usate: {penaltyLog}</p>
            </div>
          </div>
        )}

        {(phase === PHASES.WON || phase === PHASES.LOST) && (
          <div className={`w-full max-w-xl ${phase === PHASES.WON ? CARD : CARD_ALERT} text-center space-y-5`}>
            <div className={`absolute -top-16 left-1/2 -translate-x-1/2 w-56 h-56 rounded-full blur-3xl pointer-events-none ${phase === PHASES.WON ? 'bg-emerald-500/20' : 'bg-primary/20'}`} />
            <Icon name={phase === PHASES.WON ? 'trophy' : 'skull'} className={`relative w-16 h-16 mx-auto ${phase === PHASES.WON ? 'text-emerald-400' : 'text-primary'}`} />
            <h2 className={`relative text-3xl font-extrabold ${phase === PHASES.WON ? 'text-emerald-400' : 'text-primary'}`}>
              {gauntletMode
                ? (phase === PHASES.WON ? 'SINISTER SIX GAUNTLET COMPLETATA' : `GAUNTLET FALLITA — VILLAIN ${gauntletRound}/${GAUNTLET_SIZE}`)
                : (phase === PHASES.WON ? 'BOSS ABBATTUTO' : 'GAME OVER')}
            </h2>
            <p className="relative text-base text-slate-400">
              {gauntletMode
                ? (phase === PHASES.WON
                    ? `Tutti e ${GAUNTLET_SIZE} i Villain abbattuti in fila. Consulta il Post-Match Report per il riepilogo round per round.`
                    : 'La run si è interrotta qui. L\'XP dei round già vinti resta comunque accreditato — consulta il report.')
                : (phase === PHASES.WON
                    ? 'Prova superata. Consulta il Post-Match Report per il dettaglio.'
                    : 'La simulazione è fallita. Nessun XP guadagnato — riprova quando sei pronto.')}
            </p>
            <div className="relative flex items-center justify-center gap-3">
              <button type="button" onClick={() => setReportOpen(true)} className={BTN_SECONDARY}>
                Rivedi Report
              </button>
              <button type="button" onClick={resetToSetup} className={BTN_GHOST}>
                Nuova Simulazione
              </button>
            </div>
          </div>
        )}
      </div>

      {lastStandActive && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-surface/85 backdrop-blur-md">
          <div className={`${CARD_ALERT} max-w-sm text-center space-y-4 af-enrage-pulse`}>
            <div className="absolute -inset-2 rounded-2xl bg-primary/15 blur-2xl pointer-events-none" />
            <Icon name="skull" className="relative w-16 h-16 mx-auto text-primary" />
            <h3 className="relative text-3xl font-extrabold text-primary tracking-wide">LAST STAND</h3>
            <p className="relative text-base text-slate-400 leading-relaxed">
              Lo Spider-Sense ti grida di reagire: 0 HP. Sacrifica il 10% del tuo XP totale bancato per sopravvivere a 1 HP e continuare la prova.
            </p>
            <p className="relative text-4xl font-mono font-bold text-primary af-mono-nums">{(lastStandMsLeft / 1000).toFixed(1)}s</p>
            <button type="button" onClick={triggerLastStand} className={`relative w-full ${BTN_PRIMARY}`}>
              SACRIFICA XP — LAST STAND
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={abandonConfirmOpen}
        onClose={() => setAbandonConfirmOpen(false)}
        onConfirm={abandon}
        title={gauntletMode ? 'Abbandona il Sinister Six Gauntlet' : 'Abbandona Sinister Six Simulator'}
        message={
          gauntletMode
            ? `Abbandonare ora chiude l'intero Gauntlet come sconfitta al Villain ${gauntletRound}/${GAUNTLET_SIZE}: quel round non darà XP, ma l'XP dei round già vinti resta accreditato. Confermi?`
            : 'Abbandonare ora la simulazione conta come sconfitta: nessun XP verrà accreditato. Confermi?'
        }
        confirmLabel="Abbandona"
      />

      <Modal open={reportOpen} onClose={() => setReportOpen(false)} title="Post-Match Report">
        {reportData && (
          <div className="space-y-4">
            <div className="flex items-center justify-center">
              <span className={`text-6xl font-mono font-bold ${reportData.efficiency.color}`}>{reportData.efficiency.grade}</span>
            </div>
            <p className="text-center text-base text-slate-500 -mt-2">GRADO DI EFFICIENZA</p>
            <div className="grid grid-cols-2 gap-2 sm:gap-3">
              <div className="bg-surface/70 border border-secondary/15 rounded-xl p-2.5 sm:p-3 text-center">
                <p className="text-lg sm:text-xl font-mono text-accent">+{reportData.xpGain}</p>
                <p className="text-[10px] sm:text-xs text-slate-500">XP Guadagnati</p>
              </div>
              <div className="bg-surface/70 border border-secondary/15 rounded-xl p-2.5 sm:p-3 text-center">
                <p className="text-lg sm:text-xl font-mono text-white">{reportData.hpRemaining}/100</p>
                <p className="text-[10px] sm:text-xs text-slate-500">HP Rimanenti</p>
              </div>
              <div className="bg-surface/70 border border-secondary/15 rounded-xl p-2.5 sm:p-3 text-center col-span-2">
                <p className="text-lg sm:text-xl font-mono text-secondary">{formatClock(reportData.timeRemainingSeconds)}</p>
                <p className="text-[10px] sm:text-xs text-slate-500">Tempo Avanzato</p>
              </div>
            </div>

            {gauntletMode && gauntletHistory.length > 0 && (
              <div className="space-y-2 pt-2 border-t border-white/5">
                <p className="text-xs tracking-widest text-slate-500 font-mono">SINISTER SIX GAUNTLET — RIEPILOGO</p>
                <div className="space-y-1.5">
                  {gauntletHistory.map((r) => (
                    <div key={r.round} className="flex items-center justify-between gap-2 bg-surface/60 border border-white/5 rounded-lg px-3 py-1.5">
                      <span className="text-sm text-slate-300 flex items-center gap-1.5">
                        <Icon name={r.win ? 'trophy' : 'skull'} className={`w-4 h-4 ${r.win ? 'text-emerald-400' : 'text-primary'}`} />
                        Villain {r.round}/{GAUNTLET_SIZE}
                      </span>
                      <span className="text-xs font-mono text-slate-400">HP {r.hp}/100 · +{r.xpGain} XP</span>
                    </div>
                  ))}
                </div>
                {gauntletHistory.length === GAUNTLET_SIZE && gauntletHistory.every((r) => r.win) && (
                  <p className="text-xs text-emerald-400 font-mono text-center pt-1">GAUNTLET PULITA — {GAUNTLET_SIZE}/{GAUNTLET_SIZE} VILLAIN ABBATTUTI</p>
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
              Chiudi Report
            </button>
          </div>
        )}
      </Modal>
    </div>
  );
}
