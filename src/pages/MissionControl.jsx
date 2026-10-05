import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useArachnoForge, useFocusTimerContext } from '../context/ArachnoForgeContext.jsx';
import { Icon } from '../components/Icons.jsx';
import StaminaBar from '../components/StaminaBar.jsx';
import { useKarenBrain } from '../context/KarenBrainContext.jsx';
import DoomsdayClock from '../components/DoomsdayClock.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import Modal from '../components/Modal.jsx';
import Dropdown from '../components/Dropdown.jsx';
import DebriefModal from '../components/DebriefModal.jsx';
import PageHeader, { HeaderStat } from '../components/PageHeader.jsx';
import TodayPanel from '../components/mission/TodayPanel.jsx';
import CloseDayModal from '../components/mission/CloseDayModal.jsx';
import StreakCard from '../components/mission/StreakCard.jsx';
import AppelloEsitoCard from '../components/mission/AppelloEsitoCard.jsx';
import { WORK_MODE_META, nodeSources, suggestedWorkMode } from '../utils/sintesiEngine.js';
import { GIORNI } from '../utils/campusEngine.js';
import { goTo, ROUTES } from '../hooks/useArachnoForgeRouter.js';
import WebSlingChest from '../components/WebSlingChest.jsx';
import { formatClock, formatHoursMinutes, getDateKey } from '../utils/dateUtils.js';
import { getBriefingForToday } from '../data/briefings.js';
import { deriveNodeStatus, NODE_STATUS } from '../utils/skillTree.js';
import { resolveLiveStudyFocus } from '../utils/studyFocusLive.js';
import { computeFocusStaminaCost, DIFFICULTY, DIFFICULTY_META } from '../utils/xpEngine.js';
import { QUEST_DIFFICULTY_META } from '../utils/dailyPatrol.js';
import { computeTodaySequence, tomorrowPlanDraft } from '../utils/nowTarget.js';
import { ESITO_APPELLO, nextAppelloAfter } from '../utils/appelli.js';
import { PROTOCOL_MAX_STAMINA, PROTOCOL_MAX_XP, PROTOCOL_STAMINA_DAY_CAP, PROTOCOL_XP_DAY_CAP } from '../state/reducer.js';
import { formatInt, minutiLabel } from '../utils/format.js';
import { INTENT, useIntent } from '../utils/uiIntents.js';
import { techniqueOfAdvice } from '../data/studyTechniques.js';
import { CARD, BTN_PRIMARY, BTN_SECONDARY, BTN_AMBER, BTN_GHOST, BTN_DANGER, BTN_LG, BTN_SM, INPUT, LABEL, BADGE } from '../utils/designSystem.js';

/**
 * V39.0 — Le lezioni di oggi, in una riga sopra "ADESSO". Compare solo
 * in modalità Lezioni e solo se oggi c'è qualcosa (o c'è una prossima
 * lezione da annunciare): in sessione non occupa spazio.
 */
function CampusStrip({ campus }) {
  if (!campus || campus.fase !== 'LEZIONI') return null;
  const oggi = campus.lezioniOggi || [];
  const prossima = campus.prossima;
  if (oggi.length === 0 && !prossima) return null;
  return (
    <button
      type="button"
      onClick={() => goTo(ROUTES.CAMPUS)}
      className="group w-full text-left rounded-xl border border-line bg-panel/70 hover:bg-panel-2 hover:border-line-strong transition-colors px-4 py-3 flex items-center gap-3.5"
    >
      <span className="ds-icon-tile text-cyan-300">
        <Icon name="calendar" className="w-[18px] h-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 flex-wrap">
          <span className="ds-eyebrow !text-cyan-300/90">Lezioni{campus.settimana ? ` · settimana ${campus.settimana}` : ''}</span>
          {campus.lezioniInCoda > 0 && (
            <span className="ds-badge ds-badge-amber">
              {campus.lezioniInCoda === 1 ? '1 lezione da sistemare' : `${campus.lezioniInCoda} lezioni da sistemare`}
            </span>
          )}
        </span>
        <span className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-sm">
          {oggi.length === 0 ? (
            <span className="text-slate-400">
              Oggi niente lezioni.
              {prossima
                ? ` Prossima: ${prossima.materia.nome}, ${prossima.giorniDistanza === 1 ? 'domani' : GIORNI[prossima.giorno].toLowerCase()} alle ${prossima.inizio}.`
                : ''}
            </span>
          ) : (
            oggi.map((l) => (
              <span
                key={l.id}
                className={`flex items-center gap-1.5 ${l.stato === 'IN_CORSO' ? 'text-cyan-200 font-semibold' : l.stato === 'FINITA' ? 'text-slate-500' : 'text-slate-300'}`}
              >
                {l.stato === 'IN_CORSO' && <span className="w-1.5 h-1.5 rounded-full bg-cyan-300 animate-pulse" />}
                <span className="ds-num text-slate-500">{l.inizio}</span>
                {l.materia.nome}
              </span>
            ))
          )}
        </span>
      </span>
      <Icon name="chevronRight" className="w-4 h-4 text-slate-500 group-hover:text-slate-300 shrink-0" />
    </button>
  );
}

/**
 * V36.0 — "ADESSO": la prima cosa che si vede aprendo l'app — una riga,
 * un numero e un pulsante per rispondere a "cosa studio adesso e per
 * quanto". Tutto il resto resta a un click di distanza.
 * V42 — la voce viene dalla SEQUENZA della giornata (utils/nowTarget.js):
 * il blocco deciso ieri sera, i ripassi dovuti, le materie del piano con
 * l'argomento e il lavoro giusti. "Solo 5 minuti" abbassa la soglia
 * d'ingresso quando partire è la parte difficile.
 */
function NowCard({ seq, minutes, plan, onStart, onStartShort, onOpenDetails, detailsOpen, staminaCost, onCloseDay, dayClosed, anticipo, onAnticipa }) {
  const target = seq?.current || null;
  const next = seq?.next || null;
  const modo = target?.intent && WORK_MODE_META[target.intent] ? WORK_MODE_META[target.intent] : null;
  const minuti = target?.minutes || minutes;
  const targetH = plan?.targetHours || 0;
  const doneH = plan?.doneHours || 0;
  const pct = targetH > 0 ? Math.min(100, Math.round((doneH / targetH) * 100)) : 0;
  // V42 — "in ritardo" è il ritardo agli ESAMI previsto dal piano (lo stesso
  // numero del Piano della sessione); "slittano" è solo la giornata troppo piena.
  const inRitardo = Number(plan?.lateHours) >= 0.5;
  const badgeTone = target?.badgeTone === 'red' ? BADGE.red : target?.badgeTone === 'amber' ? BADGE.amber : target?.kind === 'PIANO_IERI' ? BADGE.violet : BADGE.slate;

  let corpo;
  if (target) {
    corpo = (
      <>
        <h2 className="text-[22px] sm:text-[26px] font-bold text-white tracking-tight leading-tight mt-2 break-words">{target.argomento}</h2>
        <p className="text-sm text-slate-400 mt-1">{target.materia}</p>
      </>
    );
  } else if (seq?.doneForToday) {
    corpo = (
      <>
        <h2 className="text-[22px] font-bold text-white tracking-tight leading-tight mt-2">Obiettivo di oggi raggiunto</h2>
        <p className="text-sm text-slate-400 mt-1">
          {anticipo
            ? `Se hai ancora energia puoi anticipare ${anticipo.nome}, che il piano mette domani. Altrimenti chiudi la giornata e fissa il primo blocco di domani.`
            : 'Chiudi la giornata e fissa il primo blocco di domani: domattina basta un click.'}
        </p>
      </>
    );
  } else if (seq?.restDay) {
    corpo = (
      <>
        <h2 className="text-[22px] font-bold text-white tracking-tight leading-tight mt-2">Giorno di riposo</h2>
        <p className="text-sm text-slate-400 mt-1">Il piano oggi non ti chiede niente: recuperare fa parte del piano. Se ti va, un blocco libero non guasta.</p>
      </>
    );
  } else {
    corpo = (
      <>
        <h2 className="text-[22px] font-bold text-white tracking-tight leading-tight mt-2">Nessun bersaglio attivo</h2>
        <p className="text-sm text-slate-400 mt-1">
          Apri una materia nel Web-Matrix e dalle un appello in calendario: il piano sceglierà da solo cosa viene prima.
        </p>
      </>
    );
  }

  return (
    <div className="ds-card !p-0 flex flex-col">
      <div className="p-5 sm:p-6 flex flex-col gap-4 flex-1">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="ds-eyebrow !text-primary flex items-center gap-1.5 flex-wrap">
              <span className="w-1.5 h-1.5 rounded-full bg-primary" />
              Adesso
              {target?.badge && <span className={`${badgeTone} !normal-case !tracking-normal ml-1`}>{target.badge}</span>}
            </p>
            {corpo}
          </div>
          {target && (
            <div className="text-right shrink-0 ds-well px-3.5 py-2.5">
              <p className="text-2xl font-bold ds-num text-white leading-none">{minuti}′</p>
              <p className="text-[11px] text-slate-500 mt-1">blocco</p>
            </div>
          )}
        </div>

        {target && modo && (
          <p className="text-sm flex items-start gap-2">
            <Icon name={modo.icon} className={`w-4 h-4 mt-0.5 shrink-0 ${modo.color}`} />
            <span className={`font-semibold ${modo.color}`}>{target.kind === 'FINALE' ? 'Ripasso finale' : modo.label}</span>
          </p>
        )}
        {target?.rationale && <p className="text-sm text-slate-300 leading-relaxed">{target.rationale}</p>}
        {target?.metodo && (
          <p className="text-sm text-secondary leading-relaxed border-l-2 border-secondary/50 pl-3">
            {target.daKaren && <span className="font-semibold">K.A.R.E.N.: </span>}
            {target.metodo}
          </p>
        )}

        {next && (
          <p className="text-sm text-slate-400 flex items-start gap-2.5">
            <span className="ds-badge ds-badge-slate !text-[11px] shrink-0">Poi</span>
            <span className="min-w-0 pt-0.5">
              <span className="text-slate-200">{next.breve}</span>
              {next.oreOggi > 0 && (
                <span className="text-slate-500">
                  {' '}
                  · {formatHoursMinutes(next.oreOggi)} {next.etichettaOre || (next.kind === 'RIPASSI' ? 'di ripassi' : 'oggi')}
                </span>
              )}
              {next.dopoGliEsami && <span className="text-slate-500"> · col tempo che gli esami lasciano libero</span>}
            </span>
          </p>
        )}
      </div>

      <div className="px-5 sm:px-6 py-4 border-t border-line bg-surface/50 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5 flex-wrap">
          {target ? (
            <>
              <button type="button" onClick={onStart} className={`${BTN_PRIMARY} ${BTN_LG}`} title="Avvia il blocco (Spazio)">
                <Icon name="play" className="w-4 h-4" />
                Avvia su questo
              </button>
              {minuti > 10 && (
                <button type="button" onClick={onStartShort} className={BTN_GHOST} title="Parti con 5 minuti: il difficile è cominciare. Poi decidi se continuare.">
                  <Icon name="bolt" className="w-4 h-4" />
                  Solo 5 minuti
                </button>
              )}
            </>
          ) : seq?.doneForToday ? (
            <>
              {anticipo && (
                <button type="button" onClick={onAnticipa} className={`${BTN_SECONDARY} ${BTN_LG}`}>
                  <Icon name="arrowRight" className="w-4 h-4" />
                  Anticipa {anticipo.nome}
                </button>
              )}
              {onCloseDay && (
                <button type="button" onClick={onCloseDay} className={anticipo ? BTN_GHOST : `${BTN_PRIMARY} ${BTN_LG}`}>
                  <Icon name={dayClosed ? 'check' : 'moon'} className="w-4 h-4" />
                  {dayClosed ? 'Giornata chiusa' : 'Chiudi la giornata'}
                </button>
              )}
            </>
          ) : (
            <button type="button" onClick={onStart} className={`${BTN_PRIMARY} ${BTN_LG}`}>
              <Icon name="play" className="w-4 h-4" />
              Avvia Focus
            </button>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-500">
          {Number.isFinite(staminaCost) && (target || !seq?.doneForToday) && <span className="ds-num">−{staminaCost} Stamina</span>}
          <button type="button" onClick={onOpenDetails} className="ds-btn ds-btn-quiet ds-btn-sm !px-2" aria-expanded={detailsOpen}>
            <Icon name={detailsOpen ? 'chevronUp' : 'chevronDown'} className="w-3.5 h-3.5" />
            {detailsOpen ? 'Nascondi piano' : 'Briefing e piano'}
            <span className="ds-kbd ml-0.5">D</span>
          </button>
        </div>
      </div>

      {targetH > 0 && (
        <div className={`px-5 sm:px-6 py-3 border-t text-xs ${plan.overCapacity || inRitardo ? 'border-primary/25 bg-primary/[0.05]' : 'border-line'}`}>
          <div className="flex items-center justify-between gap-3 flex-wrap text-slate-400">
            <span className="flex items-center gap-2">
              <Icon name="clock" className="w-3.5 h-3.5 shrink-0" />
              <span>
                Oggi fatto <span className="font-semibold text-slate-100 ds-num">{formatHoursMinutes(doneH)}</span> di{' '}
                <span className="font-semibold text-slate-100 ds-num">{formatHoursMinutes(targetH)}</span> previste
                {plan.reviews?.targetCount > 0 ? ` · ripassi ${plan.reviews.done || 0}/${plan.reviews.targetCount}` : ''}
              </span>
            </span>
            {inRitardo ? (
              <span className="font-medium text-primary">piano in ritardo di {formatHoursMinutes(plan.lateHours)}</span>
            ) : plan.overCapacity ? (
              <span className="font-medium text-primary">{formatHoursMinutes(plan.deficitHours)} slittano a domani</span>
            ) : plan.loadAdjustmentPct < 0 ? (
              <span className="text-accent">capacità ridotta del {Math.abs(plan.loadAdjustmentPct)}% da K.A.R.E.N.</span>
            ) : null}
          </div>
          <div className="ds-progress mt-2">
            <span className={pct >= 100 ? 'bg-emerald-400' : 'bg-primary'} style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}
    </div>
  );
}

/** V41 — La sessione in corso, al posto di "ADESSO" mentre il timer gira. */
function SessionCard({ timer, TIMER_STATUS, activeMateria, activeSfida, modoConsigliato, minutiSalvabili, onOpenDetails, detailsOpen }) {
  const running = timer.status === TIMER_STATUS.FOCUS;
  const breakPaused = timer.status === TIMER_STATUS.PAUSED && timer.blockMode === 'BREAK';
  const paused = timer.status === TIMER_STATUS.PAUSED && !breakPaused;
  const onBreak = timer.status === TIMER_STATUS.BREAK || breakPaused;
  const label = breakPaused
    ? 'Pausa sospesa'
    : onBreak
    ? 'Pausa'
    : paused
    ? 'In pausa'
    : timer.awaitingDebrief && timer.status === TIMER_STATUS.IDLE
    ? 'Blocco completato'
    : timer.isOverdriveActive
    ? 'Overdrive'
    : 'Focus in corso';
  const tone = onBreak ? 'text-secondary' : paused ? 'text-accent' : 'text-primary';
  return (
    <div className="ds-card flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className={`ds-eyebrow flex items-center gap-1.5 !text-current ${tone}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${onBreak ? 'bg-secondary' : paused ? 'bg-accent' : 'bg-primary'} ${running ? 'animate-pulse' : ''}`} />
            {label}
          </p>
          <h2 className="text-[22px] sm:text-[26px] font-bold text-white tracking-tight leading-tight mt-2 break-words">
            {activeSfida ? activeSfida.nome : activeMateria ? activeMateria.nome : 'Focus generico'}
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            {activeSfida && activeMateria ? activeMateria.nome : activeMateria ? 'Tutta la materia' : 'Nessuna materia collegata'}
          </p>
        </div>
        {(timer.pendingFocusMinutes > 0 || minutiSalvabili > 0) && (
          <div className="text-right shrink-0 ds-well px-3.5 py-2.5">
            <p className="text-2xl font-bold ds-num text-white leading-none">{minutiSalvabili}′</p>
            <p className="text-[11px] text-slate-500 mt-1">già fatti</p>
          </div>
        )}
      </div>
      {modoConsigliato && (
        <p className="text-sm text-slate-300 flex items-start gap-2">
          <Icon name={WORK_MODE_META[modoConsigliato].icon} className={`w-4 h-4 mt-0.5 shrink-0 ${WORK_MODE_META[modoConsigliato].color}`} />
          <span>
            <span className={`font-semibold ${WORK_MODE_META[modoConsigliato].color}`}>{WORK_MODE_META[modoConsigliato].label}</span>
            {WORK_MODE_META[modoConsigliato].hint ? ` — ${WORK_MODE_META[modoConsigliato].hint}` : ''}
          </span>
        </p>
      )}
      <div className="flex items-center gap-2.5 flex-wrap">
        <button type="button" onClick={onOpenDetails} className={BTN_GHOST}>
          <Icon name={detailsOpen ? 'chevronUp' : 'chevronDown'} className="w-4 h-4" />
          {detailsOpen ? 'Nascondi briefing e quota' : 'Briefing e quota'}
        </button>
        <span className="text-xs text-slate-500 flex items-center gap-1">
          <span className="ds-kbd">Spazio</span> pausa · <span className="ds-kbd">Esc</span> Sensory Zero
        </span>
      </div>
    </div>
  );
}

export default function MissionControl() {
  const { state, actions, derived, sensoryZero, setSensoryZero, TIMER_STATUS, spiderSenseSurgeAt, pushToast } = useArachnoForge();
  // V37.0 — il Tactical Timer arriva da un contesto dedicato: cambia una
  // volta al secondo, e prima quel tick rirenderizzava anche Web-Matrix,
  // Star Log e Sidebar, che del countdown non sanno nulla.
  const timer = useFocusTimerContext();

  // Fase 2 — Biometric Suit HUD: il Readiness Score calcolato da K.A.R.E.N.
  // (karen-oracle) sostituisce la vecchia lettura statica della Stamina
  // SOLO nella card qui sotto — il costo/recupero di state.profile.stamina
  // che governa Fatigue e XP dimezzati (xpEngine.js) resta invariato e
  // indipendente da questo hook.
  // V35.0 — Daily Brain: un solo Provider condiviso (App.jsx) al posto del
  // montaggio diretto di useSuitTelemetry — stesso identico shape di
  // ritorno, più `directives` (mission_control/focus_timer/study_window),
  // il payload esteso della stessa, unica chiamata Claude giornaliera.
  const karen = useKarenBrain();
  const { readinessScore } = karen;
  const [selectedMateriaId, setSelectedMateriaId] = useState('');
  const [selectedSfidaId, setSelectedSfidaId] = useState('');
  const [confirmInterruptOpen, setConfirmInterruptOpen] = useState(false);
  // V35.0 — guardia "sessione non salvata": se l'utente prova ad avviare
  // un nuovo Focus mentre `timer.awaitingDebrief` è true (blocco
  // precedente concluso ma non ancora Debriefato), chiede conferma invece
  // di lasciare che il nuovo Focus si sovrapponga silenziosamente.
  const [confirmRestartOpen, setConfirmRestartOpen] = useState(false);
  const [questModalOpen, setQuestModalOpen] = useState(false);
  const [deleteQuestTarget, setDeleteQuestTarget] = useState(null);
  const [questNome, setQuestNome] = useState('');
  const [questReward, setQuestReward] = useState(20);
  const [questXpReward, setQuestXpReward] = useState(0);

  // V36.0 — "Una cosa alla volta": briefing, piano completo, Quota Odierna
  // e Daily Patrol partono collassati quando `settings.focusFirstHome` è
  // attivo (default). Non spariscono — sono a un click — ma smettono di
  // competere con la decisione del momento. Stato volutamente LOCALE alla
  // pagina: è una preferenza di sessione, non un dato da sincronizzare.
  const [detailsOpen, setDetailsOpen] = useState(() => state.settings.focusFirstHome === false);

  // Tactical Debriefing: "Sessione Completata. Valuta il tuo Focus." si
  // apre quando l'utente chiude volontariamente la sessione in sospeso
  // (Termina Sessione e Salva / Avvia Pausa). `pendingAction` ricorda cosa
  // fare DOPO che l'utente ha scelto una valutazione: nessuna azione per
  // "Termina", avviare la pausa (breve/lunga) per "Avvia Pausa".
  const [debriefOpen, setDebriefOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);

  // V35.4 — "Aggiorna piano": feedback locale (mai persistito) sull'ultima
  // rigenerazione manuale del piano — stesso pattern già in uso in
  // SuitTelemetryView.handleScan, qui isolato per non confondersi con
  // un'eventuale Diagnostica Neurale lanciata da quella pagina.
  const [planRefreshFeedback, setPlanRefreshFeedback] = useState(null);
  const [planRefreshMessage, setPlanRefreshMessage] = useState(null);
  const planRefreshFeedbackTimeoutRef = useRef(null);
  useEffect(() => () => clearTimeout(planRefreshFeedbackTimeoutRef.current), []);

  // V35.0 — Daily Brain: la citazione statica a rotazione resta come
  // fallback elegante — mai rimossa, solo declassata — quando K.A.R.E.N.
  // non ha ancora generato (o non può generare) il briefing di oggi.
  const staticBriefing = useMemo(() => getBriefingForToday(), []);
  const karenBriefingToday = karen.briefing && karen.briefing.date === karen.todayStr ? karen.briefing : null;
  const karenDirectivesToday = karenBriefingToday ? karen.directives : null;

  // Daily Patrol Engine (V23.0, Modulo 2): le quest vivono direttamente in
  // `state.dailyPatrols.quests` — nessuna derivazione, il Context le tiene
  // già aggiornate in tempo reale (auto-tracking event-driven nel reducer).
  const dailyQuests = useMemo(
    () => (Array.isArray(state.dailyPatrols?.quests) ? state.dailyPatrols.quests : []),
    [state.dailyPatrols]
  );

  // "Burst" di completamento: rileva localmente le transizioni
  // isCompleted false -> true per applicare l'animazione `af-quest-pop`
  // SOLO per un breve istante (mai un'animazione permanente sulla card).
  // V41 — parte dalle missioni già a schermo: aprire la pagina con una
  // missione completata stamattina non deve rifarle l'animazione.
  const prevQuestsRef = useRef(dailyQuests);
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
  }, [dailyQuests]);

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

  const materie = useMemo(() => (Array.isArray(state.materie) ? state.materie : []), [state.materie]);

  // V35.4 — Riconciliazione live del "Piano Argomenti di Oggi": lo
  // study_focus ricevuto oggi da K.A.R.E.N. resta invariato in cache, ma
  // qui viene proiettato sullo stato VIVO di `materie` ad ogni render —
  // appena l'utente completa il nodo suggerito, la prossima opzione già
  // pronta nel payload viene promossa istantaneamente, zero chiamate di
  // rete (vedi src/utils/studyFocusLive.js per il motivo esteso).
  const liveStudyFocus = useMemo(
    () => resolveLiveStudyFocus(karenDirectivesToday?.study_focus, materie),
    [karenDirectivesToday, materie]
  );

  const handleRefreshStudyPlan = useCallback(async () => {
    // V42 — con il piano di oggi: K.A.R.E.N. sceglie dentro le materie del piano.
    // Su un piano di ripiego è un nuovo tentativo, non una rigenerazione.
    const { data: refreshData, error: refreshError } = await karen.triggerOracleScan({ force: !karen.briefingFallback, planContext: derived.karenPlanContext });
    setPlanRefreshFeedback(refreshError ? 'error' : refreshData?.fallback ? 'fallback' : 'success');
    setPlanRefreshMessage(refreshError ? null : refreshData?.warning || null);
    clearTimeout(planRefreshFeedbackTimeoutRef.current);
    planRefreshFeedbackTimeoutRef.current = setTimeout(() => setPlanRefreshFeedback(null), 3200);
  }, [karen, derived.karenPlanContext]);

  const selectedMateria = useMemo(
    () => materie.find((m) => m.id === selectedMateriaId) || null,
    [materie, selectedMateriaId]
  );

  const studiableNodes = useMemo(() => {
    if (!selectedMateria || !Array.isArray(selectedMateria.sfide)) return [];
    // V35.5 — "In Corso": un nodo su cui è già stato investito tempo di
    // Focus resta scelto come target valido per la sessione successiva
    // (deve poter continuare lo stesso argomento), non solo i nodi mai
    // ancora toccati.
    return selectedMateria.sfide.filter((s) => {
      const status = deriveNodeStatus(s, selectedMateria.sfide);
      return status === NODE_STATUS.AVAILABLE || status === NODE_STATUS.IN_PROGRESS;
    });
  }, [selectedMateria]);

  const selectedSfida = useMemo(
    () => studiableNodes.find((s) => s.id === selectedSfidaId) || null,
    [studiableNodes, selectedSfidaId]
  );

  const previewDifficulty = selectedSfida ? selectedSfida.difficulty : DIFFICULTY.MEDIUM;

  // V35.0 — Focus Timer Adattivo: quando K.A.R.E.N. ha emesso una
  // direttiva `focus_timer` per oggi (e `settings.karenAdaptiveTimer` non
  // è disattivato — vedi `derived.karenAdaptiveTimerActive`, calcolato una
  // sola volta in ArachnoForgeContext.jsx e già quello che governa i
  // minuti REALI passati a `useFocusTimer`), i minuti mostrati qui
  // seguono la stessa fonte di verità — mai un'anteprima disallineata dal
  // timer che poi parte davvero.
  const effectiveFocusMinutes = derived.karenAdaptiveTimerActive
    ? derived.karenFocusDirective.focus_minutes
    : state.settings.focusTime;
  const effectiveShortBreakMinutes = derived.karenAdaptiveTimerActive
    ? derived.karenFocusDirective.break_minutes
    : state.settings.shortBreakTime;
  // V40.3 — minuti che verrebbero salvati chiudendo adesso: quelli già in
  // sospeso più i minuti interi del blocco in corso.
  // V41 — solo un blocco di FOCUS: una pausa sospesa è PAUSED anche lei.
  const focusInPausa = timer.status === TIMER_STATUS.PAUSED && timer.blockMode !== 'BREAK';
  const minutiBloccoInCorso =
    timer.status === TIMER_STATUS.FOCUS || focusInPausa ? Math.max(0, Math.floor((timer.totalSeconds - timer.remainingSeconds) / 60)) : 0;
  const minutiSalvabili = timer.pendingFocusMinutes + minutiBloccoInCorso;
  // V37.0 — l'anteprima ignorava Maximum Carnage: annunciava un costo di
  // Stamina mentre il costo reale applicato dal reducer è zero per tutta
  // la finestra attiva. Stessa firma, stesso motore: nessun secondo
  // calcolo che possa divergere da quello vero.
  // V42 — la Stamina si misura sulla TUA giornata (capacità calibrata) e
  // Maximum Carnage non la rende più gratis.
  const staminaCapacityHours = Number(derived.calibration?.hoursPerDay) > 0 ? Number(derived.calibration.hoursPerDay) : 4.5;
  // V43 — e sulla Readiness di oggi (stessa regola del reducer).
  const staminaReadiness = karenBriefingToday && karen.readinessKnown && Number.isFinite(Number(readinessScore)) ? Number(readinessScore) : null;
  const previewStaminaCost = computeFocusStaminaCost(
    effectiveFocusMinutes,
    previewDifficulty,
    derived.skillEffects.staminaCostMultiplier,
    derived.isMaxCarnageActive,
    staminaCapacityHours,
    staminaReadiness
  );

  // V34.5 — "Timer pulito": le Materie già superate (esame passato,
  // `examPassed`) non hanno più nulla da studiare, quindi spariscono dal
  // picker del Timer — restano solo quelle in corso o ancora da dare.
  // Le Materie "congelate" (propedeuticità mancante, vedi
  // useKarenAutoRouter.js) NON vengono nascoste — sono comunque
  // preparabili a mano — ma vengono segnalate con 🧊 + etichetta "Congelata"
  // per non farle sembrare identiche a una Materia pienamente attiva.
  const activeMaterie = useMemo(() => materie.filter((m) => !m.examPassed), [materie]);

  const materiaOptions = useMemo(
    () => [
      { value: '', label: 'Focus generico (nessuna materia)' },
      ...activeMaterie.map((m) => {
        const isFrozen = derived.karenQuotaByMateriaId.get(m.id)?.status === 'CONGELATA';
        return {
          value: m.id,
          label: isFrozen ? `🧊 ${m.nome} (${m.cfu} CFU) · Congelata` : `${m.nome} (${m.cfu} CFU)`
        };
      })
    ],
    [activeMaterie, derived.karenQuotaByMateriaId]
  );

  // Blindatura: se la Materia selezionata viene segnata come superata (o
  // eliminata) mentre il Timer la puntava ancora, il picker torna a "Focus
  // generico" invece di restare agganciato a un valore non più nell'elenco.
  useEffect(() => {
    if (selectedMateriaId && !activeMaterie.some((m) => m.id === selectedMateriaId)) {
      setSelectedMateriaId('');
      setSelectedSfidaId('');
    }
  }, [selectedMateriaId, activeMaterie]);

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

  // V40.2 — intento della prossima partenza dopo la conferma "Avvia
  // Comunque": resta 'SINTESI' se la partenza era dalla card di una lezione.
  // V42 — con l'intento viaggiano anche la durata forzata e l'eventuale
  // "blocco deciso ieri sera" da segnare come avviato.
  const intentoInAttesaRef = useRef(null);
  const partenzaInAttesaRef = useRef(null);
  const doStartFocus = useCallback(() => {
    const intento = intentoInAttesaRef.current;
    const extra = partenzaInAttesaRef.current;
    intentoInAttesaRef.current = null;
    partenzaInAttesaRef.current = null;
    if (extra?.pianoIeri) actions.markTomorrowPlanStarted();
    timer.startFocus(selectedMateriaId || null, selectedSfidaId || null, false, intento, extra?.minuti ? { minutes: extra.minuti } : null);
  }, [timer, selectedMateriaId, selectedSfidaId, actions]);

  // V35.0 — guardia "sessione non salvata": `timer.awaitingDebrief` è ora
  // derivato direttamente dall'hook (mai una copia locale che si perde a
  // cambio pagina) — se true, un nuovo Focus concatenerebbe silenziosamente
  // minuti su una materia/nodo potenzialmente diversi da quelli in sospeso.
  // Si chiede conferma esplicita invece di permetterlo senza preavviso.
  const handleStartFocus = useCallback(() => {
    intentoInAttesaRef.current = null;
    partenzaInAttesaRef.current = null;
    if (timer.awaitingDebrief) {
      setConfirmRestartOpen(true);
      return;
    }
    doStartFocus();
  }, [timer.awaitingDebrief, doStartFocus]);

  const confirmRestartFocus = useCallback(() => {
    setConfirmRestartOpen(false);
    doStartFocus();
  }, [doStartFocus]);

  /**
   * V42 — la giornata come SEQUENZA (utils/nowTarget.js): il blocco deciso
   * ieri sera, la lezione appena finita (se il piano lo consente), i
   * ripassi dovuti, le materie del piano con l'argomento e il lavoro
   * giusti, poi la lezione col tempo che avanza. K.A.R.E.N. sceglie
   * argomento e metodo solo dentro le materie che il piano ha messo oggi.
   */
  const todayKey = getDateKey();
  const sequenza = useMemo(
    () =>
      computeTodaySequence({
        materie: derived.materiePiano,
        planToday: derived.planToday,
        dueReviews: derived.upcomingReviews,
        campus: derived.campus,
        karen: liveStudyFocus,
        tomorrowPlan: derived.tomorrowPlanToday,
        reviewMinutes: derived.calibration?.reviewMinutes,
        todayKey
      }),
    [derived.materiePiano, derived.planToday, derived.upcomingReviews, derived.campus, liveStudyFocus, derived.tomorrowPlanToday, derived.calibration, todayKey]
  );
  const nowTarget = sequenza.current;

  // La bozza di domani: serve a "Chiudi la giornata" e ad "Anticipa".
  const bozzaDomani = useMemo(
    () => tomorrowPlanDraft({ timeline: derived.planTimeline, materie: derived.materiePiano, allTrackedReviews: derived.allTrackedReviews, todayKey }),
    [derived.planTimeline, derived.materiePiano, derived.allTrackedReviews, todayKey]
  );
  const anticipo = sequenza.doneForToday ? bozzaDomani.items[0] || null : null;

  // Il costo di Stamina del blocco proposto da "ADESSO" (durata e difficoltà vere).
  const nowStaminaCost = useMemo(() => {
    if (!nowTarget) return previewStaminaCost;
    const m = materie.find((x) => x.id === nowTarget.materiaId);
    const nodo = m && nowTarget.sfidaId ? (m.sfide || []).find((x) => x.id === nowTarget.sfidaId) : null;
    return computeFocusStaminaCost(
      nowTarget.minutes || effectiveFocusMinutes,
      nodo ? nodo.difficulty : DIFFICULTY.MEDIUM,
      derived.skillEffects.staminaCostMultiplier,
      derived.isMaxCarnageActive,
      staminaCapacityHours,
      staminaReadiness
    );
  }, [
    nowTarget,
    materie,
    effectiveFocusMinutes,
    derived.skillEffects.staminaCostMultiplier,
    derived.isMaxCarnageActive,
    staminaCapacityHours,
    staminaReadiness,
    previewStaminaCost
  ]);

  /** Avvio in un solo gesto dalla card "ADESSO": seleziona il bersaglio
   * (così i due Dropdown restano coerenti con ciò che sta girando) e fa
   * partire il blocco, passando comunque dalla stessa guardia "sessione
   * non salvata" di handleStartFocus. `minuti` forza la durata ("Solo 5
   * minuti", ripassi brevi, blocco deciso ieri sera). */
  const avviaVoce = useCallback(
    (voce, minutiForzati = null) => {
      const materiaId = voce?.materiaId || selectedMateriaId || null;
      const sfidaId = voce ? voce.sfidaId || null : selectedSfidaId || null;
      const intento = voce?.intent || null;
      const minuti = minutiForzati || voce?.minutes || null;
      setSelectedMateriaId(materiaId || '');
      setSelectedSfidaId(sfidaId || '');
      if (timer.awaitingDebrief) {
        intentoInAttesaRef.current = intento;
        partenzaInAttesaRef.current = { minuti, pianoIeri: voce?.kind === 'PIANO_IERI' };
        setConfirmRestartOpen(true);
        return;
      }
      if (voce?.kind === 'PIANO_IERI') actions.markTomorrowPlanStarted();
      timer.startFocus(materiaId, sfidaId, false, intento, minuti ? { minutes: minuti } : null);
    },
    [selectedMateriaId, selectedSfidaId, timer, actions]
  );
  const handleStartNow = useCallback(() => avviaVoce(nowTarget), [avviaVoce, nowTarget]);
  const handleStartShort = useCallback(() => avviaVoce(nowTarget, 5), [avviaVoce, nowTarget]);
  const handleAnticipa = useCallback(() => {
    if (!anticipo) return;
    avviaVoce({ materiaId: anticipo.materiaId, sfidaId: anticipo.sfidaId, intent: anticipo.modo, kind: 'ANTICIPO' });
  }, [anticipo, avviaVoce]);

  // V42 — dopo "Solo 5 minuti": continuare sullo stesso bersaglio con un
  // blocco pieno, senza chiudere la sessione (i minuti si sommano).
  const handleContinue = useCallback(() => {
    timer.startFocus(timer.pendingFocusMateriaId || null, timer.pendingFocusSfidaId || null, false, timer.pendingFocusIntent || null);
  }, [timer]);

  // V42 — "Chiudi la giornata".
  const [closeDayOpen, setCloseDayOpen] = useState(false);
  const handleCloseDaySave = useCallback(
    (payload) => {
      actions.closeDay(payload);
      setCloseDayOpen(false);
      pushToast(
        payload.tomorrowPlan?.primoBlocco
          ? `Giornata chiusa. Domani si parte${payload.tomorrowPlan.oraInizio ? ` alle ${payload.tomorrowPlan.oraInizio}` : ''}: il primo blocco ti aspetta qui.`
          : 'Giornata chiusa. Buon riposo.',
        'success'
      );
    },
    [actions, pushToast]
  );
  const oraAttuale = new Date().getHours();
  const seraDiChiusura = oraAttuale >= (Number(state.settings.chiusuraOra) || 19) && !derived.dayClosedToday;

  // V42 — esito di un appello passato.
  const handleEsitoAppello = useCallback(
    (materia, appello, esito, extra) => {
      actions.setAppelloEsito(materia.id, appello.id, esito, extra);
      if (esito === ESITO_APPELLO.SUPERATO) {
        pushToast(`${materia.nome}: esame superato${Number.isFinite(extra?.voto) ? ` con ${extra.voto}${extra.lode ? ' e lode' : ''}` : ''}. Esce dal piano.`, 'success');
      } else if (esito === ESITO_APPELLO.NON_SUPERATO) {
        const prossimo = nextAppelloAfter(materia, appello, todayKey);
        pushToast(
          prossimo
            ? `${materia.nome}: si punta al prossimo appello (${prossimo.scritto || prossimo.orale}). Il piano è già ricalcolato.`
            : `${materia.nome}: nessun altro appello in calendario. Aggiungine uno nel Web-Matrix per riattivare il piano.`,
          'info'
        );
      } else {
        pushToast(`${materia.nome}: te lo richiedo fra qualche giorno.`, 'info');
      }
    },
    [actions, pushToast, todayKey]
  );

  /**
   * V36.0 — Scorciatoie da tastiera. Tre soli tasti, quelli che si usano
   * davvero durante una sessione:
   *   Spazio  avvia / mette in pausa / riprende il blocco corrente
   *   Esc     entra ed esce da Sensory Zero
   *   D       apre/chiude i pannelli informativi
   * Ignorate quando il fuoco è su un campo di testo o è aperto un modal:
   * premere spazio mentre si scrive un appunto non deve mai far partire
   * un pomodoro.
   */
  useEffect(() => {
    const isTypingTarget = (el) =>
      !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);

    // V39 — un pulsante, un link o un controllo col focus reagisce già da
    // solo a Spazio: prima partiva ANCHE il timer (doppia azione).
    const INTERACTIVE =
      'button, a[href], input, textarea, select, summary, [role="button"], [role="option"], [role="switch"], [role="tab"], [role="radio"], [role="checkbox"], [role="menuitem"], [contenteditable="true"]';

    const onKeyDown = (e) => {
      // V39 — un livello sovrapposto (modale, drawer, menu) ha già usato
      // questo tasto: la sua chiusura toglie il dialogo dal DOM prima che
      // questo listener giri, e il controllo sul DOM qui sotto non basta
      // più — Esc chiudeva la conferma E attivava Sensory Zero.
      if (e.defaultPrevented) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      if (e.code === 'Space' && e.target instanceof Element && e.target.closest(INTERACTIVE)) return;
      if (debriefOpen || questModalOpen || confirmInterruptOpen || confirmRestartOpen || closeDayOpen) return;
      // V37.0 — Escape è anche il tasto standard per chiudere una
      // modale o un menu. L'elenco esplicito di stati qui sopra copriva
      // solo i quattro modali di QUESTA pagina: un Dropdown aperto o un
      // dialogo montato altrove restava scoperto, e premere Esc usciva
      // da Sensory Zero invece di chiudere ciò che era aperto. Si
      // interroga il DOM, che sa sempre la verità.
      if (document.querySelector('[role="dialog"], [role="alertdialog"], [role="listbox"]')) return;

      if (e.code === 'Space') {
        e.preventDefault();
        if (timer.status === TIMER_STATUS.IDLE && !timer.awaitingDebrief) handleStartNow();
        else if (timer.status === TIMER_STATUS.PAUSED) timer.resume();
        else if (timer.status === TIMER_STATUS.FOCUS || timer.status === TIMER_STATUS.BREAK) timer.pause();
      } else if (e.key === 'Escape') {
        setSensoryZero((v) => !v);
      } else if (e.key === 'd' || e.key === 'D') {
        setDetailsOpen((v) => !v);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [timer, handleStartNow, debriefOpen, questModalOpen, confirmInterruptOpen, confirmRestartOpen, closeDayOpen, setSensoryZero, TIMER_STATUS]);

  // V41 — "Avvia Focus" dalla palette comandi (Ctrl K).
  useIntent(INTENT.TIMER_START_NOW, () => {
    if (timer.status === TIMER_STATUS.IDLE && !timer.awaitingDebrief) handleStartNow();
  });

  // V41 — "Avvia Focus" dal dettaglio di un argomento nel Web-Matrix: si
  // arriva qui con materia e argomento già scelti e il blocco parte. Con
  // una sessione ancora da valutare passa dalla stessa conferma di sempre.
  useIntent(INTENT.TIMER_FOCUS_ON, (payload) => {
    if (!payload || typeof payload !== 'object') return;
    if (timer.status !== TIMER_STATUS.IDLE) return;
    const materiaId = payload.materiaId || null;
    const sfidaId = payload.sfidaId || null;
    setSelectedMateriaId(materiaId || '');
    setSelectedSfidaId(sfidaId || '');
    intentoInAttesaRef.current = payload.intent || null;
    partenzaInAttesaRef.current = null;
    if (timer.awaitingDebrief) {
      setConfirmRestartOpen(true);
      return;
    }
    timer.startFocus(materiaId, sfidaId, false, payload.intent || null);
  });

  const handleInterrupt = useCallback(() => setConfirmInterruptOpen(true), []);

  const confirmInterrupt = useCallback(() => {
    timer.interruptFocus();
  }, [timer]);

  const handleOverdrive = useCallback(() => {
    timer.overdrive();
  }, [timer]);

  // Avviare una pausa chiude comunque la sessione: prima si passa dal
  // Tactical Debriefing (Fase 1), poi si registrano XP/Stamina/minuti
  // accumulati (incluse eventuali fasi Overdrive) e infine parte la pausa.
  // V40.3 — prima di aprire il Debriefing si FERMA il blocco in corso e i
  // suoi minuti interi entrano nella sessione: "termina e salva" lasciava
  // il countdown in corsa (tipico dopo un Overdrive) e l'unico modo per
  // fermarlo era il Blood Pact, cioè perdere XP.
  const handleTakeBreak = useCallback((long) => {
    timer.freezeRunningBlock();
    setPendingAction({ type: 'break', long });
    setDebriefOpen(true);
  }, [timer]);

  const handleEndAndSave = useCallback(() => {
    timer.freezeRunningBlock();
    setPendingAction({ type: 'end' });
    setDebriefOpen(true);
  }, [timer]);

  // V37.0 — FIX CRITICO: qui viveva una chiamata a `setAwaitingPostFocus`,
  // rimasta orfana dal refactor V35.0 che aveva sostituito quello stato
  // locale con `timer.awaitingDebrief`. Essendo una funzione inesistente,
  // OGNI conferma del Debriefing lanciava un ReferenceError PRIMA di
  // arrivare alle due righe sottostanti: il pulsante "PAUSA" salvava la
  // sessione ma non avviava mai la pausa, e `pendingAction` restava
  // sporco. Gli errori lanciati da un event handler non passano da un
  // Error Boundary, quindi il guasto era invisibile in UI.
  // V38.0 — `forgia` (modo della sessione + pagine coperte/prodotte)
  // arriva dal Debriefing e viene passato pari pari al timer, che lo
  // gira al reducer. Può essere `null`: in quel caso si registra solo
  // il tempo, come prima.
  const handleDebriefSubmit = useCallback((quality, forgia = null) => {
    // V40.2 — "Argomento terminato" dal Debriefing: prima si registra la
    // sessione, poi si completa il nodo (stesso percorso del Web-Matrix).
    const materiaDaChiudere = timer.pendingFocusMateriaId;
    const nodoDaChiudere =
      forgia && forgia.sfidaId !== undefined ? forgia.sfidaId || null : timer.pendingFocusSfidaId;
    timer.endFocusSession(quality, forgia);
    if (forgia?.completaNodo && materiaDaChiudere && nodoDaChiudere) {
      actions.completeSfida(materiaDaChiudere, nodoDaChiudere);
    }
    setDebriefOpen(false);
    if (pendingAction && pendingAction.type === 'break') {
      timer.startBreak(pendingAction.long);
    }
    setPendingAction(null);
  }, [timer, pendingAction, actions]);

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
  // V38.0 — quale dei due lavori ha senso fare su questo argomento
  // adesso (vedi utils/sintesiEngine.js). `null` quando il nodo non ha
  // fonti: lì non c'è una scelta da suggerire.
  const activeSfida = useMemo(
    () => (activeMateria && Array.isArray(activeMateria.sfide) ? activeMateria.sfide.find((s) => s.id === timer.activeFocusSfidaId) : null) || null,
    [activeMateria, timer.activeFocusSfidaId]
  );

  // V38.0 — il nodo della sessione DA VALUTARE, che dopo "Avvia
  // Comunque" non è quello attualmente attivo: il Debriefing deve
  // chiedere e accreditare le pagine sull'argomento giusto.
  const debriefMateria = useMemo(
    () => materie.find((m) => m.id === timer.pendingFocusMateriaId) || null,
    [materie, timer.pendingFocusMateriaId]
  );
  const debriefSfida = useMemo(() => {
    if (!debriefMateria || !Array.isArray(debriefMateria.sfide)) return null;
    return debriefMateria.sfide.find((s) => s.id === timer.pendingFocusSfidaId) || null;
  }, [debriefMateria, timer.pendingFocusSfidaId]);

  // V43 — la tecnica che K.A.R.E.N. ha consigliato oggi per QUESTO argomento:
  // il Debriefing la propone già selezionata (la cambi con un tocco).
  const debriefTecnicaConsigliata = useMemo(() => {
    const ap = karenDirectivesToday?.study_focus?.argomento_principale;
    if (!ap || !debriefSfida || ap.sfidaId !== debriefSfida.id) return null;
    return techniqueOfAdvice(ap);
  }, [karenDirectivesToday, debriefSfida]);

  // V42 — il lavoro dichiarato alla partenza vince sul suggerito.
  const modoConsigliato = useMemo(() => {
    if (timer.activeFocusIntent && WORK_MODE_META[timer.activeFocusIntent]) return timer.activeFocusIntent;
    if (!activeSfida) return null;
    const src = nodeSources(activeSfida);
    if (src.totali === 0 && activeSfida.status !== 'COMPLETED') return null;
    return suggestedWorkMode(activeSfida);
  }, [activeSfida, timer.activeFocusIntent]);

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

  // V31.3 — Feedback loop chiuso: le skill passive dello Skill Tree
  // modificano la matematica della sessione ma finora restavano invisibili
  // fuori dalla tab Skill Tree della Suit Lab. Mostra qui SOLO i bonus
  // realmente in gioco nella sessione corrente (mai un elenco statico di
  // "tutto ciò che hai sbloccato" — quello vive già in Armory).
  const activeSkillChips = [];
  if (timer.status === TIMER_STATUS.FOCUS) {
    const eff = derived.skillEffects;
    if (eff.xpBonusPct > 0) activeSkillChips.push(`+${Math.round(eff.xpBonusPct * 100)}% XP`);
    if (eff.staminaCostMultiplier < 1) activeSkillChips.push(`-${Math.round((1 - eff.staminaCostMultiplier) * 100)}% Stamina`);
    if (eff.streakThresholdBonus > 0) activeSkillChips.push(`Streak soglie -${eff.streakThresholdBonus}gg`);
    if (timer.isOverdriveActive) activeSkillChips.push(`Overdrive x${eff.overdriveMultiplier.toFixed(2)}`);
  }

  if (sensoryZero) {
    // V39 — portal su document.body e z-[60] come le modali: la conferma
    // "Blood Pact" (anch'essa in un portal, montata dopo) compare SOPRA
    // l'isolamento. Nessun role="dialog": Esc/Spazio della pagina devono
    // continuare a funzionare dentro Sensory Zero.
    if (typeof document === 'undefined') return null;
    return createPortal(
      <div className="fixed inset-0 z-[60] px-4 bg-app flex flex-col items-center justify-center">
        <div className="absolute inset-0 bg-[radial-gradient(600px_360px_at_50%_45%,rgb(var(--af-attack-rgb)/0.06),transparent_70%)] pointer-events-none" />
        <button
          type="button"
          onClick={() => setSensoryZero(false)}
          className="absolute top-4 right-4 sm:top-6 sm:right-6 ds-icon-btn !w-11 !h-11"
          aria-label="Esci da Sensory Zero"
        >
          <Icon name="close" className="w-6 h-6" />
        </button>
        <p className="relative ds-eyebrow !text-sm mb-6">
          {timer.status === TIMER_STATUS.FOCUS
            ? 'Focus attivo'
            : timer.status === TIMER_STATUS.BREAK
            ? 'Pausa'
            : timer.status === TIMER_STATUS.PAUSED
            ? timer.blockMode === 'BREAK'
              ? 'Pausa sospesa'
              : 'In pausa'
            : 'Isolamento sensoriale'}
        </p>
        <p className={`relative text-[4rem] sm:text-[6rem] md:text-[8rem] leading-none font-mono font-semibold ds-num ${ringColor}`}>
          {timer.status === TIMER_STATUS.IDLE && !timer.awaitingDebrief
            ? formatClock(Math.round((Number(effectiveFocusMinutes) || 25) * 60))
            : formatClock(timer.remainingSeconds)}
        </p>
        {activeMateria && timer.status !== TIMER_STATUS.IDLE && (
          <p className="relative text-sm text-slate-500 mt-5">
            {activeMateria.nome}
            {activeSfida ? ` · ${activeSfida.nome}` : ''}
          </p>
        )}
        <div className="relative mt-10 flex items-center gap-3">
          {timer.status === TIMER_STATUS.FOCUS && (
            <button type="button" onClick={timer.pause} className={BTN_GHOST}>
              <Icon name="pause" className="w-4 h-4" />
              Pausa
            </button>
          )}
          {timer.status === TIMER_STATUS.PAUSED && (
            <button type="button" onClick={timer.resume} className={BTN_SECONDARY}>
              <Icon name="play" className="w-4 h-4" />
              Riprendi
            </button>
          )}
          {timer.status === TIMER_STATUS.FOCUS && (
            <button type="button" onClick={handleInterrupt} className={BTN_DANGER}>
              Interrompi (Blood Pact)
            </button>
          )}
        </div>
        <p className="relative mt-8 text-xs text-slate-600 flex items-center gap-1.5">
          <span className="ds-kbd">Spazio</span> pausa / riprendi · <span className="ds-kbd">Esc</span> esci
        </p>
        <ConfirmDialog
          open={confirmInterruptOpen}
          onClose={() => setConfirmInterruptOpen(false)}
          onConfirm={confirmInterrupt}
          title="Blood Pact"
          message={`Interrompere ora la sessione di Focus costa ${derived.effectiveBloodPactPenalty} XP${
            minutiSalvabili > 0 ? ` e butta via ${minutiSalvabili} minuti già fatti — per tenerli usa "Termina e salva"` : ''
          }. Confermi il sacrificio?`}
          confirmLabel="Sacrifica XP"
        />
      </div>,
      document.body
    );
  }

  const idle = timer.status === TIMER_STATUS.IDLE && !timer.awaitingDebrief;
  const todayXp = (Array.isArray(state.starLog) ? state.starLog : [])
    .filter((e) => e && e.type === 'FOCUS_MINUTES' && e.dateKey === getDateKey())
    .reduce((sum, e) => sum + (Number(e.xp) || 0), 0);
  const questsDone = dailyQuests.filter((q) => q.isCompleted).length;
  const oggiLabel = new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });

  const timerCard = (
    <div
      className={`ds-card flex flex-col items-center ${spiderSenseTensionActive ? 'af-spidersense-pulse' : ''} ${
        spiderSenseUnlockActive ? 'af-spidersense-unlock' : ''
      }`}
    >
      <div className="flex items-center justify-between w-full mb-2">
        <span className="flex items-center gap-2">
          <span className="ds-eyebrow">Tactical Timer</span>
          {spiderSenseTensionActive && (
            <span className={BADGE.blue}>
              <Icon name="radar" className="w-3 h-3" />
              Spider-Sense
            </span>
          )}
        </span>
        <button
          type="button"
          onClick={() => setSensoryZero(true)}
          className="ds-btn ds-btn-quiet ds-btn-sm !px-2"
          title="Sensory Zero: solo il countdown, a tutto schermo (Esc)"
        >
          <Icon name="eye" className="w-4 h-4" />
          Sensory Zero
        </button>
      </div>

      {activeSkillChips.length > 0 && (
        <div className="flex flex-wrap items-center justify-center gap-1.5 mb-2">
          {activeSkillChips.map((label) => (
            <span key={label} className={BADGE.violet}>
              <Icon name="chip" className="w-3 h-3" />
              {label}
            </span>
          ))}
        </div>
      )}

      <div className="relative w-56 h-56 sm:w-60 sm:h-60 flex items-center justify-center my-2">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 260 260">
          <defs>
            <linearGradient id="timerGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={timerGradientStops[0]} />
              <stop offset="100%" stopColor={timerGradientStops[1]} />
            </linearGradient>
          </defs>
          <circle cx="130" cy="130" r="120" fill="none" stroke="rgb(255 255 255 / 0.06)" strokeWidth="8" />
          <circle
            cx="130"
            cy="130"
            r="120"
            fill="none"
            stroke="url(#timerGrad)"
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            className={ringColor}
          />
        </svg>
        <div className="absolute flex flex-col items-center">
          <p className="text-[44px] sm:text-5xl font-mono font-semibold ds-num text-white leading-none">
            {idle ? formatClock(Math.round((Number(effectiveFocusMinutes) || 25) * 60)) : formatClock(timer.remainingSeconds)}
          </p>
          <p className="text-xs font-semibold text-slate-400 mt-3 uppercase tracking-[0.12em]">
            {timer.status === TIMER_STATUS.FOCUS && (timer.isOverdriveActive ? 'Overdrive' : 'Focus')}
            {timer.status === TIMER_STATUS.BREAK && 'Pausa'}
            {timer.status === TIMER_STATUS.PAUSED && (timer.blockMode === 'BREAK' ? 'Pausa sospesa' : 'In pausa')}
            {timer.status === TIMER_STATUS.IDLE && (timer.awaitingDebrief ? 'Blocco finito' : 'Pronto')}
          </p>
        </div>
      </div>

      {derived.karenAdaptiveTimerActive && timer.status === TIMER_STATUS.IDLE && (
        <span className={`${BADGE.blue} mb-1`}>
          <Icon name="chip" className="w-3 h-3" />
          Preset K.A.R.E.N.: {derived.karenFocusDirective.preset_label || `${effectiveFocusMinutes}/${effectiveShortBreakMinutes}`}
        </span>
      )}

      {idle && (
        <div className="w-full mt-3 space-y-2.5">
          {/* V41 — la sessione vive in un'altra finestra (PWA e browser
              insieme, o due schede): meglio saperlo prima di avviarne una
              seconda. Chiudendo l'altra, il blocco riprende qui da solo. */}
          {timer.sessionElsewhere && (
            <p role="status" className="flex items-start gap-2 rounded-lg border border-secondary/30 bg-secondary/[0.07] px-3 py-2.5 text-[13px] text-slate-300 leading-relaxed">
              <Icon name="layers" className="w-4 h-4 shrink-0 mt-0.5 text-secondary" />
              <span>
                Hai una sessione di Focus aperta in un’altra finestra di ArachnoForge. Continua lì, oppure chiudila: qui riprendo il blocco da
                solo.
              </span>
            </p>
          )}
          <Dropdown value={selectedMateriaId} onChange={handleMateriaChange} options={materiaOptions} placeholder="Focus generico (nessuna materia)" ariaLabel="Materia" />
          {selectedMateria && (
            <Dropdown
              value={selectedSfidaId}
              onChange={setSelectedSfidaId}
              options={sfidaOptions}
              placeholder="Tutta la materia (nessun nodo specifico)"
              ariaLabel="Argomento"
            />
          )}
          <button type="button" onClick={handleStartFocus} className={`w-full ${BTN_PRIMARY}`}>
            <Icon name="play" className="w-4 h-4" />
            Avvia Focus · {effectiveFocusMinutes} min
            <span className="opacity-75 font-medium">· −{previewStaminaCost} Stamina</span>
          </button>
          {selectedSfida && (
            <p className={`text-xs text-center ${DIFFICULTY_META[selectedSfida.difficulty].color}`}>
              Nodo {DIFFICULTY_META[selectedSfida.difficulty].label}
              {selectedSfida.difficulty === DIFFICULTY.HARD ? ' — più Stamina, +30% XP' : ''}
            </p>
          )}
        </div>
      )}

      {timer.awaitingDebrief && (
        <div className="w-full mt-3 space-y-2.5">
          <p className="text-xs text-center text-slate-400">
            Sessione in sospeso: <span className="font-semibold text-white ds-num">{timer.pendingFocusMinutes} min</span>
            {timer.pendingFocusOverdrive ? ' · Overdrive' : ''} — non ancora salvata
          </p>
          {timer.status !== TIMER_STATUS.IDLE && (
            <p className="text-xs text-center text-slate-500">Un blocco è ancora in corso: “Termina e salva” lo ferma e aggiunge i suoi minuti interi.</p>
          )}
          {/* V42 — dopo un avvio da "Solo 5 minuti" la cosa più utile è
              continuare: un blocco pieno sullo stesso argomento, i minuti si
              sommano alla sessione. */}
          {timer.status === TIMER_STATUS.IDLE && timer.pendingFocusMinutes > 0 && timer.pendingFocusMinutes <= 10 && (
            <button type="button" onClick={handleContinue} className={`w-full ${BTN_PRIMARY}`}>
              <Icon name="play" className="w-4 h-4" />
              Il difficile è fatto: continua · {effectiveFocusMinutes} min
            </button>
          )}
          <button
            type="button"
            onClick={handleEndAndSave}
            className={`w-full ${timer.status === TIMER_STATUS.IDLE && timer.pendingFocusMinutes > 0 && timer.pendingFocusMinutes <= 10 ? BTN_GHOST : BTN_PRIMARY}`}
          >
            <Icon name="check" className="w-4 h-4" />
            Termina sessione e salva
          </button>
          <div className="grid grid-cols-2 gap-2.5">
            <button type="button" onClick={handleOverdrive} className={BTN_AMBER}>
              <Icon name="bolt" className="w-4 h-4" />
              Overdrive ×1,5
            </button>
            <button type="button" onClick={() => handleTakeBreak(false)} className={BTN_SECONDARY}>
              <Icon name="pause" className="w-4 h-4" />
              Pausa {effectiveShortBreakMinutes}′
            </button>
          </div>
        </div>
      )}

      {(timer.status === TIMER_STATUS.FOCUS || focusInPausa) && (
        <div className="w-full mt-3 grid grid-cols-2 gap-2.5">
          {timer.status === TIMER_STATUS.FOCUS ? (
            <button type="button" onClick={timer.pause} className={BTN_GHOST}>
              <Icon name="pause" className="w-4 h-4" />
              Pausa
            </button>
          ) : (
            <button type="button" onClick={timer.resume} className={BTN_SECONDARY}>
              <Icon name="play" className="w-4 h-4" />
              Riprendi
            </button>
          )}
          <button type="button" onClick={handleInterrupt} className={BTN_DANGER}>
            <Icon name="stop" className="w-4 h-4" />
            Interrompi
          </button>
          {!timer.awaitingDebrief && minutiSalvabili > 0 && (
            <button type="button" onClick={handleEndAndSave} className={`${BTN_GHOST} col-span-2`}>
              <Icon name="check" className="w-4 h-4 text-emerald-400" />
              Termina e salva ({minutiSalvabili} min)
            </button>
          )}
        </div>
      )}

      {/* V41 — la pausa si può sospendere e anche saltare: tornare a
          studiare prima non costa niente (nessun Blood Pact su una pausa). */}
      {(timer.status === TIMER_STATUS.BREAK || (timer.status === TIMER_STATUS.PAUSED && timer.blockMode === 'BREAK')) && (
        <div className="w-full mt-3 space-y-2.5">
          <div className="grid grid-cols-2 gap-2.5">
            {timer.status === TIMER_STATUS.BREAK ? (
              <button type="button" onClick={timer.pause} className={BTN_GHOST}>
                <Icon name="pause" className="w-4 h-4" />
                Sospendi
              </button>
            ) : (
              <button type="button" onClick={timer.resume} className={BTN_SECONDARY}>
                <Icon name="play" className="w-4 h-4" />
                Riprendi
              </button>
            )}
            <button type="button" onClick={timer.interruptFocus} className={BTN_GHOST}>
              <Icon name="arrowRight" className="w-4 h-4" />
              Salta la pausa
            </button>
          </div>
          {timer.status === TIMER_STATUS.BREAK && <p className="text-xs text-slate-500 text-center">La pausa termina da sola, con un rintocco.</p>}
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={oggiLabel.charAt(0).toUpperCase() + oggiLabel.slice(1)}
        icon="calendar"
        title="Stark-Web Terminal"
        subtitle="Il centro di comando della giornata: cosa studiare adesso, per quanto, e come sta andando."
        actions={
          <>
            <HeaderStat icon="clock" label="studio oggi" value={minutiLabel(derived.todayMinutes)} tone="text-secondary" />
            <HeaderStat icon="star" label="XP oggi" value={`+${formatInt(todayXp)}`} tone="text-accent" />
            <HeaderStat icon="flag" label="missioni" value={`${questsDone}/${dailyQuests.length || 3}`} tone={questsDone === dailyQuests.length && questsDone > 0 ? 'text-emerald-300' : 'text-slate-100'} />
          </>
        }
      />

      <CampusStrip campus={derived.campus} />

      {/* V42 — appelli passati: l'esito in un gesto. */}
      <AppelloEsitoCard voci={derived.appelliDaChiudere} todayKey={todayKey} onEsito={handleEsitoAppello} />

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        <div className="xl:col-span-7 space-y-6 min-w-0">
          {idle ? (
            <NowCard
              seq={sequenza}
              minutes={effectiveFocusMinutes}
              plan={derived.planToday}
              onStart={handleStartNow}
              onStartShort={handleStartShort}
              onOpenDetails={() => setDetailsOpen((v) => !v)}
              detailsOpen={detailsOpen}
              staminaCost={nowStaminaCost}
              onCloseDay={() => setCloseDayOpen(true)}
              dayClosed={derived.dayClosedToday}
              anticipo={anticipo}
              onAnticipa={handleAnticipa}
            />
          ) : (
            <SessionCard
              timer={timer}
              TIMER_STATUS={TIMER_STATUS}
              activeMateria={activeMateria}
              activeSfida={activeSfida}
              modoConsigliato={modoConsigliato}
              minutiSalvabili={minutiSalvabili}
              onOpenDetails={() => setDetailsOpen((v) => !v)}
              detailsOpen={detailsOpen}
            />
          )}

          {/* La timer card: a destra su schermi larghi, qui sotto altrimenti. */}
          <div className="xl:hidden">{timerCard}</div>

          {detailsOpen && (
            <>
              {/* V35.0 — Daily Brain: briefing generato da K.A.R.E.N. quando
                  c'è, altrimenti la citazione a rotazione. */}
              <div className={`${CARD} flex items-start gap-3.5`}>
                <span className="ds-icon-tile text-secondary">
                  <Icon name="radar" className="w-[18px] h-[18px]" />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 flex-wrap mb-1.5">
                    <p className="ds-eyebrow">{karenBriefingToday ? 'K.A.R.E.N. · Daily Briefing' : 'Daily Briefing'}</p>
                    {karenBriefingToday && karen.briefingFallback && (
                      <span className={BADGE.amber} title="Karen non era raggiungibile: direttive calcolate dall’app. Rigenera dalla Suit Telemetry.">
                        Piano di ripiego
                      </span>
                    )}
                    {karenDirectivesToday?.study_window?.label && (
                      <span className={BADGE.blue}>
                        <Icon name="clock" className="w-3 h-3" />
                        Picco cognitivo: {karenDirectivesToday.study_window.label}
                      </span>
                    )}
                  </div>
                  {karenBriefingToday ? (
                    <>
                      <p className="text-[15px] text-slate-200 leading-relaxed">“{karenBriefingToday.briefing_text}”</p>
                      {karenBriefingToday.tactical_advice && (
                        <p className="text-sm text-secondary mt-2 leading-relaxed">{karenBriefingToday.tactical_advice}</p>
                      )}
                    </>
                  ) : (
                    <p className="text-[15px] text-slate-300 leading-relaxed italic">“{staticBriefing}”</p>
                  )}
                </div>
              </div>

              {karenDirectivesToday?.mission_control?.load_adjustment_pct < 0 && (
                <div className="rounded-xl border border-accent/30 bg-accent/[0.06] px-4 py-3 flex items-start gap-3">
                  <Icon name="bolt" className="w-4 h-4 text-accent mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-accent">
                      Karen consiglia {karenDirectivesToday.mission_control.load_adjustment_pct}% di carico oggi
                    </p>
                    {karenDirectivesToday.mission_control.rationale && (
                      <p className="text-xs text-slate-400 mt-1 leading-relaxed">{karenDirectivesToday.mission_control.rationale}</p>
                    )}
                  </div>
                </div>
              )}

              {/* V35.3/V35.4 — Piano Argomenti del Giorno, riconciliato live
                  con l'albero (src/utils/studyFocusLive.js). */}
              {karenDirectivesToday?.study_focus && (liveStudyFocus.primary || liveStudyFocus.exhausted) && (
                <div className={`${CARD} flex items-start gap-3.5`}>
                  <span className="ds-icon-tile text-secondary">
                    <Icon name="target" className="w-[18px] h-[18px]" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 flex-wrap mb-1.5">
                      <p className="ds-eyebrow">Piano argomenti di oggi</p>
                      <button
                        type="button"
                        onClick={handleRefreshStudyPlan}
                        disabled={karen.scanning}
                        className="ds-btn ds-btn-quiet ds-btn-sm !px-2"
                        title="Chiede a K.A.R.E.N. una nuova valutazione completa del piano di oggi"
                      >
                        <Icon name="refresh" className={`w-3.5 h-3.5 ${karen.scanning ? 'animate-spin' : ''}`} />
                        {karen.scanning ? 'Aggiornamento…' : 'Aggiorna piano'}
                      </button>
                    </div>
                    {planRefreshFeedback === 'success' && <p className="text-xs text-emerald-300 mb-1.5">Piano rivalutato da K.A.R.E.N.</p>}
                    {planRefreshFeedback === 'fallback' && (
                      <p className="text-xs text-accent mb-1.5">{planRefreshMessage || 'K.A.R.E.N. non ha risposto: piano di ripiego sulle materie di oggi. Riprova fra qualche minuto.'}</p>
                    )}
                    {planRefreshFeedback === 'error' && (
                      <p className="text-xs text-primary mb-1.5">{karen.error || 'Rigenerazione non riuscita — riprova.'}</p>
                    )}
                    {liveStudyFocus.primary ? (
                      <>
                        {liveStudyFocus.promoted && (
                          <p className="text-xs text-accent mb-1 flex items-center gap-1">
                            <Icon name="bolt" className="w-3 h-3" />
                            Argomento precedente completato: promossa la prossima opzione
                          </p>
                        )}
                        <p className="text-sm font-semibold text-white">
                          {liveStudyFocus.primary.argomento}
                          <span className="text-slate-500 font-normal"> — {liveStudyFocus.primary.materia}</span>
                        </p>
                        {liveStudyFocus.primary.rationale && (
                          <p className="text-xs text-slate-400 mt-1 leading-relaxed">{liveStudyFocus.primary.rationale}</p>
                        )}
                        {liveStudyFocus.primary.metodo && (
                          <p className="text-sm text-secondary mt-2 leading-relaxed">{liveStudyFocus.primary.metodo}</p>
                        )}
                      </>
                    ) : (
                      <p className="text-sm text-slate-300 leading-relaxed">
                        Piano di oggi completato: nessun altro argomento o ripasso in sospeso fra quelli proposti. “Aggiorna piano” per una nuova valutazione.
                      </p>
                    )}
                    {liveStudyFocus.otherOpenOptions.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-line space-y-1.5">
                        <p className="ds-eyebrow">Altre opzioni</p>
                        {liveStudyFocus.otherOpenOptions.map((o, i) => (
                          <p key={o.sfidaId || `${o.materiaId || 'opt'}-${i}`} className="text-xs text-slate-400 leading-relaxed">
                            <span className="text-slate-200 font-medium">{o.argomento}</span> · {o.materia}
                          </p>
                        ))}
                      </div>
                    )}
                    {liveStudyFocus.ripassiDaNonSaltare.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-line space-y-1.5">
                        <p className="ds-eyebrow">Ripassi da non saltare</p>
                        {liveStudyFocus.ripassiDaNonSaltare.map((r, idx) => (
                          <p key={`${r.sfidaId || r.materia}-${r.argomento}-${idx}`} className="text-xs text-slate-400 leading-relaxed">
                            <span className="text-slate-200 font-medium">{r.argomento}</span> ({r.materia}): {r.nota}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* V42 — il piano di oggi, materia per materia (fatto / previsto,
                  minimo e anticipo, ripassi, lezioni, le altre materie). */}
              <TodayPanel
                plan={derived.planToday}
                quotas={derived.karenQuotas}
                calibration={derived.calibration}
                monotask={derived.karenMonotaskActive}
                onCloseDay={() => setCloseDayOpen(true)}
                dayClosed={derived.dayClosedToday}
                todayKey={todayKey}
              />
            </>
          )}

          {/* V42 — la sera: chiudere la giornata e decidere il primo blocco di domani. */}
          {idle && seraDiChiusura && (
            <div className="rounded-xl border border-violet-400/25 bg-violet-400/[0.05] px-4 py-3.5 flex items-center gap-3.5 flex-wrap">
              <span className="ds-icon-tile text-violet-300">
                <Icon name="moon" className="w-[18px] h-[18px]" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-white">È sera: chiudi la giornata</p>
                <p className="text-xs text-slate-400 mt-0.5">Un minuto: il bilancio di oggi e il primo blocco di domani, con l’ora di partenza. Domattina basta un click.</p>
              </div>
              <button type="button" onClick={() => setCloseDayOpen(true)} className={`${BTN_SECONDARY} ${BTN_SM}`}>
                <Icon name="moon" className="w-3.5 h-3.5" />
                Chiudi la giornata
              </button>
            </div>
          )}

          {/* Daily Patrol — sempre in vista: la gamification resta in primo piano. */}
          <div className={CARD}>
            <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
              <div className="flex items-center gap-3">
                <span className="ds-icon-tile text-secondary">
                  <Icon name="flag" className="w-[18px] h-[18px]" />
                </span>
                <div>
                  <p className="ds-eyebrow">Daily Patrol</p>
                  <h2 className="ds-h2">Missioni di oggi</h2>
                </div>
              </div>
              <span className="flex items-center gap-2">
                <span className={questsDone === dailyQuests.length && questsDone > 0 ? BADGE.green : BADGE.slate}>
                  {questsDone}/{dailyQuests.length} completate
                </span>
                {state.profile.dailyPatrolsCompleted > 0 && (
                  <span className="hidden sm:inline text-xs text-slate-500 ds-num">{formatInt(state.profile.dailyPatrolsCompleted)} a vita</span>
                )}
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {dailyQuests.map((q) => {
                const diffMeta = QUEST_DIFFICULTY_META[q.difficulty] || QUEST_DIFFICULTY_META.EASY;
                const pct = Math.min(100, Math.round((q.currentProgress / Math.max(1, q.targetAmount)) * 100));
                const celebrating = celebratingIds.has(q.id);
                return (
                  <div
                    key={q.id}
                    className={`relative rounded-xl border p-3.5 flex flex-col gap-3 ${
                      q.isCompleted ? 'border-emerald-400/30 bg-emerald-400/[0.05]' : 'border-line bg-surface'
                    } ${celebrating ? 'af-quest-pop' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className={`w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 ${q.isCompleted ? 'border-emerald-400/40 text-emerald-300' : `${diffMeta.border} ${diffMeta.color}`}`}>
                        <Icon name={q.isCompleted ? 'check' : q.icon} className="w-4 h-4" />
                      </span>
                      <span className={q.isCompleted ? BADGE.green : BADGE.amber}>+{q.xpReward} XP</span>
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-100 leading-snug">{q.title}</p>
                      <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{q.description}</p>
                    </div>
                    <div className="mt-auto">
                      <div className="ds-progress relative">
                        <span
                          className={`${q.isCompleted ? 'bg-emerald-400 af-quest-bar-complete relative' : diffMeta.solid || 'bg-secondary'}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <p className="flex items-center justify-between text-[11px] text-slate-500 mt-1.5 ds-num">
                        <span className={diffMeta.color}>{diffMeta.label}</span>
                        <span>
                          {Math.min(q.currentProgress, q.targetAmount)}/{q.targetAmount}
                        </span>
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <DoomsdayClock nextExam={derived.nextExam} trajectory={derived.trajectory} />
        </div>

        <div className="xl:col-span-5 space-y-6 min-w-0">
          <div className="hidden xl:block">{timerCard}</div>

          <div className={derived.fatigued ? 'ds-card ds-card-alert' : CARD}>
            <StaminaBar
              stamina={state.profile.stamina}
              readinessScore={
                karen.hasSession && karen.briefing && karen.readinessKnown && karen.briefing.date === karen.todayStr ? readinessScore : null
              }
              readinessBand={karen.readinessBand}
            />
          </div>

          {/* V42 — serie di studio con i riposi, e la carica del simbionte. */}
          <StreakCard
            streak={derived.streak}
            profile={state.profile}
            todayKey={todayKey}
            carnageActive={derived.isMaxCarnageActive}
            onActivateCarnage={actions.activateMaxCarnage}
          />

          <WebSlingChest />

          <div className={CARD}>
            <div className="flex items-center justify-between mb-3.5">
              <div className="flex items-center gap-3">
                <span className="ds-icon-tile text-secondary">
                  <Icon name="bolt" className="w-[18px] h-[18px]" />
                </span>
                <div>
                  <p className="ds-eyebrow">Ricarica Stamina</p>
                  <h2 className="ds-h2">Daily Protocols</h2>
                </div>
              </div>
              <button type="button" onClick={() => setQuestModalOpen(true)} className="ds-icon-btn" aria-label="Aggiungi Daily Protocol" title="Aggiungi un protocollo">
                <Icon name="plus" className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-2">
              {(Array.isArray(state.quickQuests) ? state.quickQuests : []).map((q) => {
                const usedToday = (Array.isArray(state.profile.dailyProtocolsCompletedToday) ? state.profile.dailyProtocolsCompletedToday : []).includes(q.id);
                return (
                  <div key={q.id} className="group flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleQuickQuest(q.id, usedToday)}
                      disabled={usedToday}
                      aria-disabled={usedToday}
                      className="flex-1 min-w-0 flex items-center justify-between gap-3 rounded-lg border border-line bg-surface px-3.5 py-2.5 text-sm hover:border-secondary/40 hover:bg-panel-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-line disabled:hover:bg-surface"
                    >
                      <span className="flex items-center gap-2.5 min-w-0">
                        <span className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${usedToday ? 'border-emerald-400 bg-emerald-400/20 text-emerald-300' : 'border-slate-600'}`}>
                          {usedToday && <Icon name="check" className="w-3 h-3" strokeWidth={2.4} />}
                        </span>
                        <span className={`text-left min-w-0 break-words ${usedToday ? 'text-slate-400 line-through decoration-slate-600' : 'text-slate-200'}`}>{q.nome}</span>
                      </span>
                      <span className="flex items-center gap-2 shrink-0 text-xs font-semibold ds-num">
                        <span className="text-secondary">+{q.staminaReward} Stamina</span>
                        {q.xpReward > 0 && <span className="text-accent">+{q.xpReward} XP</span>}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteQuestTarget(q)}
                      className="ds-icon-btn opacity-60 group-hover:opacity-100 hover:!text-primary"
                      aria-label={`Elimina protocollo ${q.nome}`}
                    >
                      <Icon name="trash" className="w-4 h-4" />
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
        message={`Interrompere ora la sessione di Focus costa ${derived.effectiveBloodPactPenalty} XP${
          minutiSalvabili > 0 ? ` e butta via ${minutiSalvabili} minuti già fatti — per tenerli usa "Termina e salva"` : ''
        }. Confermi il sacrificio?`}
        confirmLabel="Sacrifica XP"
      />

      {/* V39 — eliminare un protocollo passa da una conferma. */}
      <ConfirmDialog
        open={!!deleteQuestTarget}
        onClose={() => setDeleteQuestTarget(null)}
        onConfirm={() => {
          if (deleteQuestTarget) actions.deleteQuickQuest(deleteQuestTarget.id);
          setDeleteQuestTarget(null);
        }}
        title="Elimina protocollo"
        message={`Eliminare "${deleteQuestTarget?.nome || ''}" dai Daily Protocols?`}
        confirmLabel="Elimina"
      />

      {/* V35.0 — guardia "sessione non salvata". */}
      <ConfirmDialog
        open={confirmRestartOpen}
        onClose={() => setConfirmRestartOpen(false)}
        onConfirm={confirmRestartFocus}
        title="Sessione non salvata"
        message={`Hai una sessione da ${timer.pendingFocusMinutes} minuti non ancora salvata. Avviarne una nuova la lascia in sospeso: confermi comunque?`}
        confirmLabel="Avvia comunque"
      />

      <DebriefModal
        open={debriefOpen}
        onClose={handleDebriefClose}
        onSubmit={handleDebriefSubmit}
        minutes={timer.pendingFocusMinutes}
        overdrive={timer.pendingFocusOverdrive}
        sfida={debriefSfida}
        materia={debriefMateria}
        intent={timer.pendingFocusIntent}
        calibration={derived.calibration}
        tecnicaConsigliata={debriefTecnicaConsigliata}
      />

      <CloseDayModal
        open={closeDayOpen}
        onClose={() => setCloseDayOpen(false)}
        onSave={handleCloseDaySave}
        todayKey={todayKey}
        todayMinutes={derived.todayMinutes}
        plan={derived.planToday}
        draft={bozzaDomani}
        materie={derived.materiePiano}
        streak={derived.streak}
        existingPlan={state.tomorrowPlan && state.tomorrowPlan.dateKey === bozzaDomani.dateKey ? state.tomorrowPlan : null}
        defaultFocusMinutes={Number(effectiveFocusMinutes) || 25}
        defaultOraInizio={state.tomorrowPlan?.oraInizio || '09:00'}
        alreadyClosed={derived.dayClosedToday}
      />

      <Modal open={questModalOpen} onClose={() => setQuestModalOpen(false)} title="Nuovo Daily Protocol">
        <div className="space-y-4">
          <div>
            <label className={LABEL} htmlFor="af-quest-nome">
              Nome attività
            </label>
            <input
              id="af-quest-nome"
              type="text"
              value={questNome}
              onChange={(e) => setQuestNome(e.target.value)}
              className={INPUT}
              placeholder="Es. Doccia fredda"
              maxLength={60}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL} htmlFor="af-quest-stamina">
                Ricarica Stamina
              </label>
              <input
                id="af-quest-stamina"
                type="number"
                min={1}
                max={PROTOCOL_MAX_STAMINA}
                value={questReward}
                onChange={(e) => setQuestReward(e.target.value)}
                className={INPUT}
              />
            </div>
            <div>
              <label className={LABEL} htmlFor="af-quest-xp">
                Bonus XP (facoltativo)
              </label>
              <input
                id="af-quest-xp"
                type="number"
                min={0}
                max={PROTOCOL_MAX_XP}
                value={questXpReward}
                onChange={(e) => setQuestXpReward(e.target.value)}
                className={INPUT}
              />
            </div>
          </div>
          <p className="text-xs text-slate-500 leading-relaxed">
            Stamina da 1 a {PROTOCOL_MAX_STAMINA}, bonus XP da 0 a {PROTOCOL_MAX_XP}. Ogni protocollo vale una volta al giorno; in tutto, i protocolli ricaricano al
            massimo {PROTOCOL_STAMINA_DAY_CAP} Stamina e {PROTOCOL_XP_DAY_CAP} XP al giorno: gli XP veri arrivano dallo studio.
          </p>
          <button
            type="button"
            disabled={!questNome.trim()}
            onClick={() => {
              // V41 — valori sempre validi: prima un campo svuotato arrivava
              // al reducer come NaN e rendeva la Stamina "NaN%" per sempre.
              const stamina = Math.min(PROTOCOL_MAX_STAMINA, Math.max(1, Math.round(Number(questReward) || 0)));
              const xp = Math.min(PROTOCOL_MAX_XP, Math.max(0, Math.round(Number(questXpReward) || 0)));
              actions.addQuickQuest(questNome.trim(), stamina, xp);
              setQuestNome('');
              setQuestReward(20);
              setQuestXpReward(0);
              setQuestModalOpen(false);
            }}
            className={`w-full ${BTN_SECONDARY}`}
          >
            <Icon name="plus" className="w-4 h-4" />
            Aggiungi protocollo
          </button>
        </div>
      </Modal>
    </div>
  );
}
