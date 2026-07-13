import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useArachnoForge } from '../context/ArachnoForgeContext.jsx';
import { Icon } from '../components/Icons.jsx';
import StaminaBar from '../components/StaminaBar.jsx';
import DoomsdayClock from '../components/DoomsdayClock.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import Modal from '../components/Modal.jsx';
import Dropdown from '../components/Dropdown.jsx';
import DebriefModal from '../components/DebriefModal.jsx';
import EmptyState from '../components/EmptyState.jsx';
import WebSlingChest from '../components/WebSlingChest.jsx';
import { formatClock, formatHoursMinutes } from '../utils/dateUtils.js';
import { getBriefingForToday } from '../data/briefings.js';
import { deriveNodeStatus, NODE_STATUS } from '../utils/skillTree.js';
import { computeFocusStaminaCost, DIFFICULTY, DIFFICULTY_META } from '../utils/xpEngine.js';
import { QUEST_DIFFICULTY_META } from '../utils/dailyPatrol.js';
import { QUOTA_STATUS_META } from '../hooks/useKarenAutoRouter.js';
import { CARD, CARD_ALERT, BTN_PRIMARY, BTN_SECONDARY, BTN_AMBER, BTN_GHOST, INPUT, H1, BADGE } from '../utils/designSystem.js';

/** V29.0 — Pillar 1/2: riga singola della Quota Odierna, riusata per le tre sezioni (In Focus Oggi / In Coda / Congelata) — mai tre markup duplicati. */
function QuotaRow({ q }) {
  const statusMeta = QUOTA_STATUS_META[q.status];
  return (
    <div className={`p-2.5 sm:p-3.5 rounded-xl border transition-all duration-300 ${statusMeta.cardClass || 'bg-surface/60 border-secondary/15'}`}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-sm font-semibold text-slate-100 flex items-center gap-1.5 min-w-0 max-w-full">
          <span className={`w-2 h-2 rounded-full shrink-0 ${statusMeta.dotClass}`} style={statusMeta.glowStyle} />
          <span className="truncate">{q.nome}</span>
        </span>
        <span className="flex items-center gap-1.5 shrink-0 flex-wrap">
          <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-mono border ${statusMeta.badgeClass}`}>
            {statusMeta.label}
          </span>
          {!q.frozen && (
            <span className={BADGE.blue}>
              {q.dailyQuotaHours == null ? 'n/d' : `Oggi: ${formatHoursMinutes(q.dailyQuotaHours)}`}
            </span>
          )}
        </span>
      </div>
      {q.frozen ? (
        <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
          Karen: propedeuticità mancante — {q.missingPrereqNames.join(', ')}. Scheda visualizzabile e nodi preparabili a mano, ma esclusa dal planner automatico finché non sblocchi.
        </p>
      ) : (
        <>
          {q.status === 'CRITICO' && (
            <p className="text-xs text-primary mt-1.5 leading-relaxed font-semibold">
              Karen: traiettoria insostenibile. Rischio esaurimento. Consigliato rinvio appello.
            </p>
          )}
          {q.status === 'ATTENZIONE' && q.hasNodes && (
            <p className="text-xs text-accent mt-1.5 leading-relaxed">
              Karen: il ritmo attuale è leggermente indietro rispetto alla Fine Prevista — nessun panico, ma non rallentare.
            </p>
          )}
          <p className="text-xs text-slate-500 mt-1">
            {q.daysRemaining == null
              ? 'Nessuna data esame impostata'
              : q.daysRemaining <= 0
              ? 'Esame oggi o scaduto'
              : `${q.daysRemaining}gg all'esame`}
            {' · '}
            {formatHoursMinutes(q.hoursRemaining)} residue
            {q.hasNodes && <span className="text-slate-600"> · basata sui Nodi dello Skill Tree</span>}
          </p>
        </>
      )}
    </div>
  );
}

export default function MissionControl() {
  const { state, actions, timer, derived, sensoryZero, setSensoryZero, TIMER_STATUS, spiderSenseSurgeAt } = useArachnoForge();
  const [selectedMateriaId, setSelectedMateriaId] = useState('');
  const [selectedSfidaId, setSelectedSfidaId] = useState('');
  const [confirmInterruptOpen, setConfirmInterruptOpen] = useState(false);
  const [awaitingPostFocus, setAwaitingPostFocus] = useState(false);
  const [questModalOpen, setQuestModalOpen] = useState(false);
  const [questNome, setQuestNome] = useState('');
  const [questReward, setQuestReward] = useState(20);
  const [questXpReward, setQuestXpReward] = useState(0);

  // Tactical Debriefing: "Sessione Completata. Valuta il tuo Focus." si
  // apre quando l'utente chiude volontariamente la sessione in sospeso
  // (Termina Sessione e Salva / Avvia Pausa). `pendingAction` ricorda cosa
  // fare DOPO che l'utente ha scelto una valutazione: nessuna azione per
  // "Termina", avviare la pausa (breve/lunga) per "Avvia Pausa".
  const [debriefOpen, setDebriefOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);

  const briefing = useMemo(() => getBriefingForToday(), []);

  // Daily Patrol Engine (V23.0, Modulo 2): le quest vivono direttamente in
  // `state.dailyPatrols.quests` — nessuna derivazione, il Context le tiene
  // già aggiornate in tempo reale (auto-tracking event-driven nel reducer).
  const dailyQuests = Array.isArray(state.dailyPatrols?.quests) ? state.dailyPatrols.quests : [];

  // "Burst" di completamento: rileva localmente le transizioni
  // isCompleted false -> true per applicare l'animazione `af-quest-pop`
  // SOLO per un breve istante (mai un'animazione permanente sulla card).
  const prevQuestsRef = useRef([]);
  const [celebratingIds, setCelebratingIds] = useState(() => new Set());
  useEffect(() => {
    const prev = prevQuestsRef.current;
    const justCompleted = dailyQuests.filter((q) => {
      const prevQ = prev.find((p) => p.id === q.id);
      return q.isCompleted && (!prevQ || !prevQ.isCompleted);
    });
    if (justCompleted.length > 0) {
      setCelebratingIds((current) => {
        const next = new Set(current);
        justCompleted.forEach((q) => next.add(q.id));
        return next;
      });
      const timeoutId = setTimeout(() => {
        setCelebratingIds((current) => {
          const next = new Set(current);
          justCompleted.forEach((q) => next.delete(q.id));
          return next;
        });
      }, 550);
      prevQuestsRef.current = dailyQuests;
      return () => clearTimeout(timeoutId);
    }
    prevQuestsRef.current = dailyQuests;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dailyQuests]);

  const prevStatusRef = useRef(timer.status);
  useEffect(() => {
    if (prevStatusRef.current === TIMER_STATUS.FOCUS && timer.status === TIMER_STATUS.IDLE) {
      setAwaitingPostFocus(true);
    }
    prevStatusRef.current = timer.status;
  }, [timer.status, TIMER_STATUS.FOCUS, TIMER_STATUS.IDLE]);

  // V28.1 — Pillar 3 (Spider-Sense Focus Surge): l'animazione di sblocco è
  // "one-shot" — si accende per ~1.1s ad ogni nuovo `spiderSenseSurgeAt`
  // (timestamp aggiornato dal Context solo al completamento pulito di una
  // sessione su una Materia) e si spegne da sola, mai un loop permanente.
  const [spiderSenseUnlockActive, setSpiderSenseUnlockActive] = useState(false);
  useEffect(() => {
    if (!spiderSenseSurgeAt) return undefined;
    setSpiderSenseUnlockActive(true);
    const id = setTimeout(() => setSpiderSenseUnlockActive(false), 1100);
    return () => clearTimeout(id);
  }, [spiderSenseSurgeAt]);

  const progressPct = timer.totalSeconds > 0 ? ((timer.totalSeconds - timer.remainingSeconds) / timer.totalSeconds) * 100 : 0;

  const ringColor =
    timer.status === TIMER_STATUS.FOCUS
      ? 'text-primary'
      : timer.status === TIMER_STATUS.BREAK
      ? 'text-secondary'
      : 'text-slate-500';

  // Anello HUD del Tactical Timer — gradiente reattivo al costume attivo
  // (mai due colori fissi): Focus va da Attacco a Decay (energia che si
  // consuma), Pausa va da Refuel a Refuel scuro, Idle resta neutro/slate.
  // Le `<stop>` leggono direttamente le CSS custom properties del True
  // Theme Engine, quindi cambiano costume istantaneamente come ogni altro
  // colore dell'app.
  const timerGradientStops =
    timer.status === TIMER_STATUS.FOCUS
      ? ['rgb(var(--af-attack-rgb))', 'rgb(var(--af-decay-rgb))']
      : timer.status === TIMER_STATUS.BREAK
      ? ['rgb(var(--af-refuel-rgb))', 'rgb(var(--af-refuel-dark-rgb))']
      : ['rgb(100 116 139)', 'rgb(51 65 85)'];

  const materie = Array.isArray(state.materie) ? state.materie : [];

  const selectedMateria = useMemo(
    () => materie.find((m) => m.id === selectedMateriaId) || null,
    [materie, selectedMateriaId]
  );

  const studiableNodes = useMemo(() => {
    if (!selectedMateria || !Array.isArray(selectedMateria.sfide)) return [];
    return selectedMateria.sfide.filter((s) => deriveNodeStatus(s, selectedMateria.sfide) === NODE_STATUS.AVAILABLE);
  }, [selectedMateria]);

  const selectedSfida = useMemo(
    () => studiableNodes.find((s) => s.id === selectedSfidaId) || null,
    [studiableNodes, selectedSfidaId]
  );

  const previewDifficulty = selectedSfida ? selectedSfida.difficulty : DIFFICULTY.MEDIUM;
  const previewStaminaCost = computeFocusStaminaCost(state.settings.focusTime, previewDifficulty, derived.skillEffects.staminaCostMultiplier);

  const materiaOptions = useMemo(
    () => [
      { value: '', label: 'Focus generico (nessuna materia)' },
      ...materie.map((m) => ({ value: m.id, label: `${m.nome} (${m.cfu} CFU)` }))
    ],
    [materie]
  );

  const sfidaOptions = useMemo(
    () => [
      { value: '', label: 'Focus sul Quadrante (nessun nodo specifico)' },
      ...studiableNodes.map((s) => ({ value: s.id, label: `${s.nome} · ${DIFFICULTY_META[s.difficulty].label}` }))
    ],
    [studiableNodes]
  );

  const handleMateriaChange = useCallback((id) => {
    setSelectedMateriaId(id);
    setSelectedSfidaId('');
  }, []);

  const handleStartFocus = useCallback(() => {
    setAwaitingPostFocus(false);
    timer.startFocus(selectedMateriaId || null, selectedSfidaId || null, false);
  }, [timer, selectedMateriaId, selectedSfidaId]);

  const handleInterrupt = useCallback(() => setConfirmInterruptOpen(true), []);

  const confirmInterrupt = useCallback(() => {
    timer.interruptFocus();
    setAwaitingPostFocus(false);
  }, [timer]);

  const handleOverdrive = useCallback(() => {
    setAwaitingPostFocus(false);
    timer.overdrive();
  }, [timer]);

  // Avviare una pausa chiude comunque la sessione: prima si passa dal
  // Tactical Debriefing (Fase 1), poi si registrano XP/Stamina/minuti
  // accumulati (incluse eventuali fasi Overdrive) e infine parte la pausa.
  const handleTakeBreak = useCallback((long) => {
    setPendingAction({ type: 'break', long });
    setDebriefOpen(true);
  }, []);

  const handleEndAndSave = useCallback(() => {
    setPendingAction({ type: 'end' });
    setDebriefOpen(true);
  }, []);

  const handleDebriefSubmit = useCallback((quality) => {
    timer.endFocusSession(quality);
    setDebriefOpen(false);
    setAwaitingPostFocus(false);
    if (pendingAction && pendingAction.type === 'break') {
      timer.startBreak(pendingAction.long);
    }
    setPendingAction(null);
  }, [timer, pendingAction]);

  // Chiudere il Debriefing senza valutare (Esc/click fuori) è non
  // distruttivo: i minuti restano "in sospeso" e l'utente torna al
  // pannello di decisione post-Focus, senza perdere nulla.
  const handleDebriefClose = useCallback(() => {
    setDebriefOpen(false);
    setPendingAction(null);
  }, []);

  // Daily Hero Duties: click pulito e diretto sul protocollo. Il pulsante è
  // già `disabled` quando il protocollo risulta "fatto oggi" (i browser non
  // emettono onClick su elementi disabled), ma la guardia esplicita qui
  // rende l'azione sicura anche se chiamata programmaticamente altrove, e
  // impedisce qualunque doppio-invio accidentale (es. tap rapido ripetuto).
  const handleQuickQuest = useCallback((questId, alreadyUsedToday) => {
    if (alreadyUsedToday) return;
    actions.applyQuickQuest(questId);
  }, [actions]);

  const activeMateria = useMemo(
    () => materie.find((m) => m.id === timer.activeFocusMateriaId) || null,
    [materie, timer.activeFocusMateriaId]
  );
  const activeSfida = useMemo(
    () => (activeMateria && Array.isArray(activeMateria.sfide) ? activeMateria.sfide.find((s) => s.id === timer.activeFocusSfidaId) : null) || null,
    [activeMateria, timer.activeFocusSfidaId]
  );

  // Active SVG Progress Ring — cerchio reale che si svuota in tempo reale
  // (stroke-dashoffset ricalcolato ad ogni tick del Tactical Timer, mai un
  // placeholder statico), font monospace tecnologico per i numeri.
  const circumference = 2 * Math.PI * 120;
  const dashOffset = circumference - (progressPct / 100) * circumference;

  // V28.1 — Pillar 3 (Spider-Sense Focus Surge): la pulsazione di tensione
  // HUD è attiva SOLO durante una sessione di Focus reale (non in pausa)
  // agganciata a una Materia — mai su Focus generico (nessuna Materia
  // selezionata, quindi nessuna Difficoltà su cui basare il bonus).
  const spiderSenseTensionActive = timer.status === TIMER_STATUS.FOCUS && !!activeMateria;

  if (sensoryZero) {
    return (
      <div className="fixed inset-0 z-[100] bg-[radial-gradient(ellipse_at_center,rgb(var(--af-surface-rgb))_0%,#000000_100%)] flex flex-col items-center justify-center">
        <button
          type="button"
          onClick={() => setSensoryZero(false)}
          className="absolute top-6 right-6 text-slate-500 hover:text-primary transition-all duration-300"
          aria-label="Esci da Sensory Zero"
        >
          <Icon name="close" className="w-8 h-8" />
        </button>
        <p className="text-base tracking-[0.3em] text-slate-500 mb-6">
          {timer.status === TIMER_STATUS.FOCUS ? 'FOCUS ATTIVO' : timer.status === TIMER_STATUS.BREAK ? 'PAUSA' : 'ISOLAMENTO SENSORIALE'}
        </p>
        <p className={`text-[3.75rem] sm:text-[5.5rem] md:text-[7rem] leading-none font-mono font-bold af-mono-nums ${ringColor}`}>
          {formatClock(timer.remainingSeconds)}
        </p>
        {timer.status === TIMER_STATUS.FOCUS && (
          <button type="button" onClick={handleInterrupt} className={`mt-10 ${BTN_GHOST}`}>
            Interrompi (Blood Pact)
          </button>
        )}
        <ConfirmDialog
          open={confirmInterruptOpen}
          onClose={() => setConfirmInterruptOpen(false)}
          onConfirm={confirmInterrupt}
          title="Blood Pact"
          message={`Interrompere ora la sessione di Focus costa ${derived.effectiveBloodPactPenalty} XP. Confermi il sacrificio?`}
          confirmLabel="Sacrifica XP"
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className={H1}>Stark-Web Terminal</h1>
        <p className="text-base text-slate-400 mt-1.5">Karen: sistemi operativi. Centro di comando del ciclo di studio.</p>
      </div>

      <div className={`${CARD} flex items-start gap-3`}>
        <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-secondary/10 blur-3xl pointer-events-none" />
        <div className="relative w-9 h-9 rounded-xl bg-secondary/10 flex items-center justify-center text-secondary shrink-0">
          <Icon name="radar" className="w-5 h-5" />
        </div>
        <div className="relative">
          <p className="text-xs tracking-widest text-slate-500 mb-1">DAILY BRIEFING</p>
          <p className="text-base italic text-slate-300 leading-relaxed">"{briefing}"</p>
        </div>
      </div>

      {/* K.A.R.E.N. QUANTUM ROUTER — Daily Quota HUD (V23.0, Modulo 1) e
          Daily Patrol Engine (V23.0, Modulo 2): entrambi sempre visibili
          in cima allo Stark-Web Terminal, prima del Tactical Timer. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className={CARD}>
          <div className="relative flex items-center gap-3 mb-4">
            <div className="w-9 h-9 rounded-xl bg-primary/15 border border-primary/40 flex items-center justify-center text-primary shrink-0">
              <Icon name="satellite" className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs tracking-widest text-primary font-mono">K.A.R.E.N. QUANTUM ROUTER</p>
              <h2 className="text-lg font-bold text-white tracking-tight">Quota Odierna</h2>
            </div>
          </div>
          {derived.karenQuotas.length === 0 ? (
            <EmptyState
              variant="radar"
              compact
              title="Karen: nessuna rotta attiva"
              subtitle="Apri un nodo nel Web-Matrix con una data d'esame per calcolare la Quota Odierna."
            />
          ) : (
            <div className="relative space-y-4 max-h-80 overflow-y-auto af-scroll pr-1">
              {/* V29.0 — Pillar 1 (Planner Restriction): mai più "tutto
                  insieme" — al massimo 2 materie spinte oggi (1 in
                  monotask se una è a distanza critica), il resto resta
                  visibile ma in coda o congelato. */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-[11px] font-mono tracking-widest text-secondary">IN FOCUS OGGI</span>
                  {derived.karenMonotaskActive && (
                    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-mono border border-primary/50 bg-primary/10 text-primary">
                      <Icon name="crosshair" className="w-3 h-3" />
                      MONOTASK — distanza critica
                    </span>
                  )}
                </div>
                {derived.karenDailyFocusQuotas.length === 0 ? (
                  <p className="text-xs text-slate-500 italic">Nessuna materia da spingere oggi.</p>
                ) : (
                  derived.karenDailyFocusQuotas.map((q) => <QuotaRow key={q.materiaId} q={q} />)
                )}
              </div>

              {derived.karenQueuedQuotas.length > 0 && (
                <div className="space-y-2.5 pt-3 border-t border-white/10">
                  <span className="text-[11px] font-mono tracking-widest text-slate-500">IN CODA</span>
                  {derived.karenQueuedQuotas.map((q) => <QuotaRow key={q.materiaId} q={q} />)}
                </div>
              )}

              {derived.karenFrozenQuotas.length > 0 && (
                <div className="space-y-2.5 pt-3 border-t border-white/10">
                  <span className="text-[11px] font-mono tracking-widest text-slate-500">CONGELATE — propedeuticità mancante</span>
                  {derived.karenFrozenQuotas.map((q) => <QuotaRow key={q.materiaId} q={q} />)}
                </div>
              )}
            </div>
          )}
        </div>

        <div className={CARD}>
          <div className="relative flex items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-secondary/15 border border-secondary/40 flex items-center justify-center text-secondary shrink-0">
                <Icon name="flag" className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs tracking-widest text-secondary font-mono">DAILY PATROL</p>
                <h2 className="text-lg font-bold text-white tracking-tight">Missioni Giornaliere</h2>
              </div>
            </div>
            {state.profile.dailyPatrolsCompleted > 0 && (
              <span className={BADGE.slate}>{state.profile.dailyPatrolsCompleted} completate a vita</span>
            )}
          </div>
          <div className="relative space-y-3">
            {dailyQuests.map((q) => {
              const diffMeta = QUEST_DIFFICULTY_META[q.difficulty] || QUEST_DIFFICULTY_META.EASY;
              const pct = Math.min(100, Math.round((q.currentProgress / Math.max(1, q.targetAmount)) * 100));
              const celebrating = celebratingIds.has(q.id);
              return (
                <div
                  key={q.id}
                  className={`p-3.5 rounded-xl border transition-all duration-300 ${
                    q.isCompleted ? 'bg-emerald-900/20 border-emerald-400/40' : `${diffMeta.bg} ${diffMeta.border}`
                  } ${celebrating ? 'af-quest-pop' : ''}`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-9 h-9 rounded-lg border flex items-center justify-center shrink-0 ${
                        q.isCompleted ? 'border-emerald-400/50 text-emerald-400' : `${diffMeta.border} ${diffMeta.color}`
                      }`}
                    >
                      <Icon name={q.isCompleted ? 'check' : q.icon} className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-slate-100">{q.title}</p>
                        <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full border ${diffMeta.border} ${diffMeta.color}`}>
                          {diffMeta.label}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 truncate">{q.description}</p>
                    </div>
                    <span className={q.isCompleted ? BADGE.green : BADGE.amber}>+{q.xpReward}xp</span>
                  </div>
                  {/* Vera Progress Bar (Tailwind w-[x%]), mai un placeholder statico. */}
                  <div className="mt-3 h-2 af-web-bar bg-surface/80 rounded-full overflow-hidden border border-white/10 relative">
                    <div
                      className={`h-full bg-gradient-to-r ${diffMeta.bar} transition-[width] duration-500 ease-out relative ${
                        q.isCompleted ? 'af-quest-bar-complete' : ''
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1.5 font-mono">
                    {Math.min(q.currentProgress, q.targetAmount)}/{q.targetAmount} — {pct}%
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* V28.1 — Pillar 1: griglia principale ristrutturata — split 60/40
          (invece del precedente 66/33 a xl:) che scatta già da `lg:`, cosi'
          la Home resta ariosa e simmetrica su più fascie di schermo, con
          Tactical Timer e Quantum Router come veri fuochi visivi della
          pagina (il Combat Log, ora in Karen OS Settings, non affolla più
          la colonna secondaria). */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 lg:gap-8">
        <div className="lg:col-span-3 space-y-6">
          {/* Tactical Timer — V28.1 (Pillar 3): pulsazione olografica di
              tensione HUD durante una sessione su una Materia, anello di
              sblocco al completamento pulito (Spider-Sense Focus Surge). */}
          <div
            className={`${CARD} flex flex-col items-center ${spiderSenseTensionActive ? 'af-spidersense-pulse' : ''} ${
              spiderSenseUnlockActive ? 'af-spidersense-unlock' : ''
            }`}
          >
            <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-72 h-72 rounded-full bg-primary/10 blur-3xl pointer-events-none" />
            <div className="relative flex items-center justify-between w-full mb-4">
              <span className="text-base tracking-widest text-slate-400 flex items-center gap-2">
                TACTICAL TIMER
                {spiderSenseTensionActive && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-secondary/50 bg-secondary/10 text-secondary px-2 py-0.5 text-[10px] font-mono tracking-wide">
                    <Icon name="radar" className="w-3 h-3" />
                    SPIDER-SENSE
                  </span>
                )}
              </span>
              <button
                type="button"
                onClick={() => setSensoryZero(true)}
                className="flex items-center gap-1.5 text-base text-slate-400 hover:text-secondary transition-all duration-300"
              >
                <Icon name="eye" className="w-5 h-5" />
                Sensory Zero
              </button>
            </div>

            <div className="relative w-52 h-52 sm:w-64 sm:h-64 flex items-center justify-center">
              <svg className="w-52 h-52 sm:w-64 sm:h-64 -rotate-90" viewBox="0 0 260 260">
                <defs>
                  <linearGradient id="timerGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor={timerGradientStops[0]} />
                    <stop offset="100%" stopColor={timerGradientStops[1]} />
                  </linearGradient>
                </defs>
                <circle cx="130" cy="130" r="120" fill="none" stroke="currentColor" strokeOpacity="0.12" strokeWidth="10" className="text-secondary" />
                <circle
                  cx="130"
                  cy="130"
                  r="120"
                  fill="none"
                  stroke="url(#timerGrad)"
                  strokeWidth="10"
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={dashOffset}
                  className={`${ringColor} transition-[stroke-dashoffset] duration-[250ms] ease-linear`}
                  style={{ filter: `drop-shadow(0 0 10px currentColor)` }}
                />
              </svg>
              <div className="absolute flex flex-col items-center">
                <p className="text-4xl sm:text-5xl font-mono font-bold af-mono-nums tabular-nums text-white">{formatClock(timer.remainingSeconds)}</p>
                <p className="text-base text-slate-400 mt-2 tracking-widest">
                  {timer.status === TIMER_STATUS.FOCUS && (timer.isOverdriveActive ? 'OVERDRIVE' : 'FOCUS')}
                  {timer.status === TIMER_STATUS.BREAK && 'PAUSA'}
                  {timer.status === TIMER_STATUS.PAUSED && 'IN PAUSA'}
                  {timer.status === TIMER_STATUS.IDLE && 'PRONTO AL LANCIO'}
                </p>
                {activeMateria && timer.status !== TIMER_STATUS.IDLE && (
                  <div className="text-center mt-1">
                    <p className="text-xs text-secondary">{activeMateria.nome}</p>
                    {activeSfida && <p className="text-xs text-slate-500">{activeSfida.nome}</p>}
                  </div>
                )}
              </div>
            </div>

            {timer.status === TIMER_STATUS.IDLE && !awaitingPostFocus && (
              <div className="relative w-full mt-6 space-y-3">
                <Dropdown
                  value={selectedMateriaId}
                  onChange={handleMateriaChange}
                  options={materiaOptions}
                  placeholder="Focus generico (nessuna materia)"
                />

                {selectedMateria && (
                  <Dropdown
                    value={selectedSfidaId}
                    onChange={setSelectedSfidaId}
                    options={sfidaOptions}
                    placeholder="Focus sul Quadrante (nessun nodo specifico)"
                  />
                )}

                <button type="button" onClick={handleStartFocus} className={`w-full ${BTN_PRIMARY}`}>
                  <Icon name="play" className="w-6 h-6" />
                  Avvia Focus ({state.settings.focusTime} min · -{previewStaminaCost} Stamina)
                </button>
                {selectedSfida && (
                  <p className={`text-[11px] text-center ${DIFFICULTY_META[selectedSfida.difficulty].color}`}>
                    Nodo {DIFFICULTY_META[selectedSfida.difficulty].label}
                    {selectedSfida.difficulty === DIFFICULTY.HARD ? ' — costo Stamina maggiorato, +30% XP' : ''}
                  </p>
                )}
              </div>
            )}

            {awaitingPostFocus && (
              <div className="relative w-full mt-6 space-y-3">
                <p className="text-[11px] text-center text-slate-500 font-mono">
                  Sessione in sospeso: {timer.pendingFocusMinutes} min{timer.pendingFocusOverdrive ? ' · overdrive attivo' : ''} — non ancora salvata
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <button type="button" onClick={handleOverdrive} className={BTN_AMBER}>
                    <Icon name="bolt" className="w-6 h-6" />
                    OVERDRIVE (x1.5 XP)
                  </button>
                  <button type="button" onClick={() => handleTakeBreak(false)} className={BTN_SECONDARY}>
                    <Icon name="pause" className="w-6 h-6" />
                    PAUSA ({state.settings.shortBreakTime} min)
                  </button>
                  <button type="button" onClick={handleEndAndSave} className={BTN_PRIMARY}>
                    <Icon name="check" className="w-6 h-6" />
                    TERMINA SESSIONE E SALVA
                  </button>
                </div>
              </div>
            )}

            {(timer.status === TIMER_STATUS.FOCUS || timer.status === TIMER_STATUS.PAUSED) && (
              <div className="relative w-full mt-6 grid grid-cols-2 gap-3">
                {timer.status === TIMER_STATUS.FOCUS ? (
                  <button type="button" onClick={timer.pause} className={BTN_GHOST}>
                    <Icon name="pause" className="w-5 h-5" />
                    Pausa
                  </button>
                ) : (
                  <button type="button" onClick={timer.resume} className={BTN_SECONDARY}>
                    <Icon name="play" className="w-5 h-5" />
                    Riprendi
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleInterrupt}
                  className="inline-flex items-center justify-center gap-2 bg-white/[0.03] backdrop-blur-md border border-primary/30 text-primary font-semibold tracking-wide text-sm px-5 py-2.5 rounded-xl hover:bg-primary/10 hover:border-primary/60 transition-all duration-300"
                >
                  <Icon name="stop" className="w-5 h-5" />
                  Interrompi
                </button>
              </div>
            )}

            {timer.status === TIMER_STATUS.BREAK && (
              <p className="relative text-base text-slate-400 mt-4">La pausa termina automaticamente.</p>
            )}
          </div>

          <DoomsdayClock nextExam={derived.nextExam} trajectory={derived.trajectory} />
        </div>

        <div className="lg:col-span-2 space-y-6">
          <div className={derived.fatigued ? CARD_ALERT : CARD}>
            {derived.fatigued && !state.settings.calmMode && <div className="af-interference rounded-2xl" />}
            <StaminaBar stamina={state.profile.stamina} />
          </div>

          {/* V27.0 — Pillar 4: Daily Web-Sling, widget compatto e non
              invadente nella colonna secondaria della Home. */}
          <WebSlingChest />

          <div className={CARD}>
            <div className="relative flex items-center justify-between mb-3">
              <span className="text-base tracking-widest text-slate-400">DAILY PROTOCOLS</span>
              <button
                type="button"
                onClick={() => setQuestModalOpen(true)}
                className="text-slate-400 hover:text-secondary transition-all duration-300 hover:scale-110 active:scale-95"
                aria-label="Aggiungi Quick Quest"
              >
                <Icon name="plus" className="w-5 h-5" />
              </button>
            </div>
            <div className="relative space-y-2">
              {(Array.isArray(state.quickQuests) ? state.quickQuests : []).map((q) => {
                const usedToday = (Array.isArray(state.profile.dailyProtocolsCompletedToday) ? state.profile.dailyProtocolsCompletedToday : []).includes(q.id);
                return (
                <div key={q.id} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleQuickQuest(q.id, usedToday)}
                    disabled={usedToday}
                    aria-disabled={usedToday}
                    className="flex-1 flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-surface/70 border border-secondary/15 hover:border-secondary/50 transition-all duration-300 hover:scale-[1.01] active:scale-95 text-base disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-secondary/15 disabled:hover:scale-100"
                  >
                    <span className="text-slate-200">{q.nome}{usedToday ? ' — fatto oggi' : ''}</span>
                    <span className="flex items-center gap-2">
                      <span className="text-secondary font-mono text-base">+{q.staminaReward}</span>
                      {q.xpReward > 0 && <span className="text-accent font-mono text-base">+{q.xpReward}xp</span>}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => actions.deleteQuickQuest(q.id)}
                    className="text-slate-500 hover:text-primary transition-all duration-300 hover:scale-110 active:scale-95"
                    aria-label="Elimina quest"
                  >
                    <Icon name="trash" className="w-5 h-5" />
                  </button>
                </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmInterruptOpen}
        onClose={() => setConfirmInterruptOpen(false)}
        onConfirm={confirmInterrupt}
        title="Blood Pact"
        message={`Interrompere ora la sessione di Focus costa ${derived.effectiveBloodPactPenalty} XP. Confermi il sacrificio?`}
        confirmLabel="Sacrifica XP"
      />

      <DebriefModal
        open={debriefOpen}
        onClose={handleDebriefClose}
        onSubmit={handleDebriefSubmit}
        minutes={timer.pendingFocusMinutes}
        overdrive={timer.pendingFocusOverdrive}
      />

      <Modal open={questModalOpen} onClose={() => setQuestModalOpen(false)} title="Nuova Quick Quest">
        <div className="space-y-4">
          <div>
            <label className="text-base text-slate-400 block mb-1.5">Nome attività</label>
            <input
              type="text"
              value={questNome}
              onChange={(e) => setQuestNome(e.target.value)}
              className={INPUT}
              placeholder="Es. Doccia fredda"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-base text-slate-400 block mb-1.5">Ricarica Stamina</label>
              <input
                type="number"
                min={1}
                max={100}
                value={questReward}
                onChange={(e) => setQuestReward(Number(e.target.value))}
                className={INPUT}
              />
            </div>
            <div>
              <label className="text-base text-slate-400 block mb-1.5">Bonus XP (opz.)</label>
              <input
                type="number"
                min={0}
                value={questXpReward}
                onChange={(e) => setQuestXpReward(Number(e.target.value))}
                className={INPUT}
              />
            </div>
          </div>
          <button
            type="button"
            disabled={!questNome.trim()}
            onClick={() => {
              actions.addQuickQuest(questNome.trim(), questReward, questXpReward);
              setQuestNome('');
              setQuestReward(20);
              setQuestXpReward(0);
              setQuestModalOpen(false);
            }}
            className={`w-full ${BTN_SECONDARY}`}
          >
            Aggiungi Quest
          </button>
        </div>
      </Modal>
    </div>
  );
}
