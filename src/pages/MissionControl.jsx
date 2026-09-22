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
import { WORK_MODE_META, nodeSources, suggestedWorkMode } from '../utils/sintesiEngine.js';
import { nodoInSintesi, GIORNI } from '../utils/campusEngine.js';
import { goTo, ROUTES } from '../hooks/useArachnoForgeRouter.js';
import EmptyState from '../components/EmptyState.jsx';
import WebSlingChest from '../components/WebSlingChest.jsx';
import { formatClock, formatHoursMinutes } from '../utils/dateUtils.js';
import { getBriefingForToday } from '../data/briefings.js';
import { deriveNodeStatus, NODE_STATUS } from '../utils/skillTree.js';
import { resolveLiveStudyFocus } from '../utils/studyFocusLive.js';
import { computeFocusStaminaCost, DIFFICULTY, DIFFICULTY_META } from '../utils/xpEngine.js';
import { QUEST_DIFFICULTY_META } from '../utils/dailyPatrol.js';
import { QUOTA_STATUS_META } from '../hooks/useKarenAutoRouter.js';
import { CARD, CARD_BARE, CARD_ALERT, BTN_PRIMARY, BTN_SECONDARY, BTN_AMBER, BTN_GHOST, INPUT, H1, BADGE } from '../utils/designSystem.js';

/** V29.0 — Pillar 1/2: riga singola della Quota Odierna, riusata per le tre sezioni (In Focus Oggi / In Coda / Congelata) — mai tre markup duplicati.
 *
 * V35.4 — "Ritmo vs Oggi": prima di questa modifica, ogni riga (anche
 * quelle IN CODA, esplicitamente NON spinte dal planner) mostrava lo
 * stesso badge blu "Oggi: Xh" — un numero calcolato in totale isolamento
 * per QUELLA sola materia (ore residue / giorni all'esame), mai un vero
 * budget condiviso fra materie. Il risultato era fuorviante: una materia
 * a 6 giorni dall'esame (davvero da spingere oggi) e una a 90+ giorni
 * (in coda, non prioritaria) potevano mostrare "Oggi: 1h40m" e
 * "Oggi: 1h23m" — numeri quasi identici che facevano sembrare le due
 * materie ugualmente urgenti OGGI, quando non lo sono affatto. La
 * matematica di computeMateriaQuota resta invariata (è un ritmo
 * sostenibile legittimo, utile come informazione), ma ora SOLO le
 * materie realmente "in focus" (spinte dal planner) mostrano quel numero
 * come "Oggi: Xh" in evidenza; le materie "in coda" mostrano lo stesso
 * valore ma etichettato onestamente come "Ritmo: Xh/giorno" in stile
 * neutro — un dato informativo ("se dovessi iniziare oggi questa
 * materia, servirebbe questo ritmo"), mai un'istruzione per la giornata
 * odierna, che resta dominata dalla materia in focus. */
/** V40.0 — una materia senza data non è "in attenzione": non ha una
 * scadenza da rischiare. Stile neutro, nessuna pulsazione. */
const SENZA_DATA_META = {
  label: 'Senza data',
  badgeClass: 'bg-slate-800/60 text-slate-300 border-slate-500/30',
  dotClass: 'bg-slate-500',
  cardClass: 'bg-surface/60 border-white/10',
  glowStyle: undefined
};

function QuotaRow({ q, today = true }) {
  const senzaData = q.daysRemaining == null && !q.dataScaduta && !q.frozen && q.status === 'ATTENZIONE';
  const statusMeta = senzaData ? SENZA_DATA_META : QUOTA_STATUS_META[q.status];
  // V39.0 — nelle materie in focus si mostrano le ore REALMENTE ripartite
  // dal budget del giorno (`assignedHours`), non la quota grezza: con due
  // materie in focus le righe dicevano 4h + 3h mentre il budget ne
  // assegnava 2.6 + 1.9, e la nota sotto giurava che fossero già
  // ripartite. Nelle materie in coda resta il ritmo, dichiarato come tale.
  const oreOggi = today && Number.isFinite(q.assignedHours) ? q.assignedHours : q.dailyQuotaHours;
  return (
    <div className={`p-2.5 sm:p-3.5 rounded-xl border transition-all duration-300 ${statusMeta.cardClass || 'bg-surface/60 border-secondary/15'}`}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-sm font-semibold text-slate-100 flex items-center gap-1.5 min-w-0 max-w-full">
          <span className={`w-2 h-2 rounded-full shrink-0 ${statusMeta.dotClass}`} style={statusMeta.glowStyle} />
          <span className="min-w-0 line-clamp-2 break-words">{q.nome}</span>
        </span>
        <span className="flex items-center gap-1.5 shrink-0 flex-wrap">
          <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-mono border ${statusMeta.badgeClass}`}>
            {statusMeta.label}
          </span>
          {!q.frozen && today && Number.isFinite(oreOggi) && oreOggi > 0 && (
            <span className={BADGE.blue}>Oggi: {formatHoursMinutes(oreOggi)}</span>
          )}
          {!q.frozen && !today && Number.isFinite(q.dailyQuotaHours) && q.dailyQuotaHours > 0 && (
            <span className={BADGE.slate}>Ritmo: {formatHoursMinutes(q.dailyQuotaHours)}/giorno</span>
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
          {q.status === 'ATTENZIONE' && !senzaData && q.hasNodes && !q.cumulativeOverload && (
            <p className="text-xs text-accent mt-1.5 leading-relaxed">
              Karen: il ritmo attuale è leggermente indietro rispetto alla Fine Prevista — nessun panico, ma non rallentare.
            </p>
          )}
          {q.cumulativeOverload && q.status !== 'CRITICO' && (
            <p className="text-xs text-accent mt-1.5 leading-relaxed">
              Karen: da sola ci starebbe, ma insieme agli esami che vengono prima il carico supera le ore che hai (
              {Math.round(q.cumulativeRatio * 100)}% della capacità fino a questa data).
            </p>
          )}
          <p className="text-xs text-slate-500 mt-1">
            {q.dataScaduta
              ? 'Appello passato: aggiorna la data o segna l\u2019esame come superato'
              : q.daysRemaining == null
              ? 'Nessuna data esame impostata'
              : q.daysRemaining === 0
              ? 'Esame oggi'
              : `${q.daysRemaining}gg all'esame`}
            {' · '}
            {q.stimaDaCfu && q.daysRemaining == null ? (
              <span>
                nessun nodo: fuori dal piano finché non mappi il programma o fissi l’esame
                <span className="text-slate-600"> (stima dai CFU: {formatHoursMinutes(q.hoursRemaining)})</span>
              </span>
            ) : (
              <>
                {formatHoursMinutes(q.hoursRemaining)} residue
                {q.hasNodes ? (
                  <span className="text-slate-600"> · basata sui Nodi dello Skill Tree</span>
                ) : (
                  <span className="text-slate-600"> · stima dai CFU</span>
                )}
              </>
            )}
          </p>
        </>
      )}
    </div>
  );
}

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
      className="w-full text-left rounded-2xl border border-cyan-400/25 bg-cyan-500/[0.05] hover:border-cyan-400/50 transition-colors px-4 py-3 flex items-center gap-3"
    >
      <Icon name="calendar" className="w-5 h-5 text-cyan-300 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] font-mono tracking-widest text-cyan-300">
          LEZIONI{campus.settimana ? ` · SETTIMANA ${campus.settimana}` : ''}
          {campus.lezioniInCoda > 0 && (
            <span className="text-accent">
              {' '}
              · {campus.lezioniInCoda === 1 ? '1 LEZIONE' : `${campus.lezioniInCoda} LEZIONI`} DA SISTEMARE
            </span>
          )}
        </span>
        <span className="flex flex-wrap gap-x-3 gap-y-1 mt-1 text-sm">
          {oggi.length === 0 ? (
            <span className="text-slate-400">
              Oggi niente lezioni.
              {prossima
                ? ` Prossima: ${prossima.materia.nome}, ${
                    prossima.giorniDistanza === 1 ? 'domani' : GIORNI[prossima.giorno].toLowerCase()
                  } alle ${prossima.inizio}.`
                : ''}
            </span>
          ) : (
            oggi.map((l) => (
              <span
                key={l.id}
                className={l.stato === 'IN_CORSO' ? 'text-cyan-200 font-semibold' : l.stato === 'FINITA' ? 'text-slate-500' : 'text-slate-300'}
              >
                <span className="font-mono af-mono-nums">{l.inizio}</span> {l.materia.nome}
                {l.stato === 'IN_CORSO' && ' ●'}
              </span>
            ))
          )}
        </span>
      </span>
      <Icon name="chevronDown" className="w-4 h-4 text-slate-500 -rotate-90 shrink-0" />
    </button>
  );
}

/**
 * V36.0 — "ADESSO": la prima cosa che si vede aprendo l'app.
 *
 * Prima di questa card la Home era una colonna lunga (briefing -> piano
 * argomenti -> quota -> daily patrol -> protocolli -> timer): sei
 * pannelli che reclamavano attenzione insieme per rispondere a UNA sola
 * domanda, che in una giornata normale è sempre la stessa — *cosa studio
 * adesso e per quanto*. Il numero di elementi che chiedono attenzione
 * contemporaneamente è esso stesso una fonte di stress, ed è esattamente
 * ciò che l'app esiste per togliere: qui la risposta è una riga, un
 * numero e un pulsante. Tutto il resto resta a un click di distanza.
 */
function NowCard({ target, minutes, budget, canStart, onStart, onOpenDetails, detailsOpen }) {
  return (
    <div className={`${CARD_BARE} border-primary/25`}>
      <div className="absolute -top-16 -right-10 w-56 h-56 rounded-full bg-primary/10 blur-3xl pointer-events-none" />
      <div className="relative flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <p className="text-[11px] font-mono tracking-[0.25em] text-primary">ADESSO</p>
            {target ? (
              <>
                <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight leading-tight mt-1 break-words">
                  {target.argomento}
                </h2>
                <p className="text-sm text-slate-400 mt-1">{target.materia}</p>
              </>
            ) : (
              <>
                <h2 className="text-2xl font-extrabold text-white tracking-tight leading-tight mt-1">Nessun bersaglio attivo</h2>
                <p className="text-sm text-slate-400 mt-1">
                  Apri una materia nel Web-Matrix e dalle una data d'esame: Karen sceglierà da sola cosa viene prima.
                </p>
              </>
            )}
          </div>
          <div className="text-right shrink-0">
            <p className="text-3xl font-mono font-bold af-mono-nums text-white leading-none">{minutes}′</p>
            <p className="text-[11px] text-slate-500 tracking-widest mt-1">BLOCCO</p>
          </div>
        </div>

        {target?.rationale && <p className="text-sm text-slate-400 leading-relaxed">{target.rationale}</p>}
        {target?.metodo && (
          <p className="text-sm text-secondary leading-relaxed border-l-2 border-secondary/40 pl-3">{target.metodo}</p>
        )}

        {/* V40.0 — il secondo candidato, dichiarato: "POI". */}
        {target?.dopo && (
          <p className="text-sm text-slate-400 flex items-start gap-2">
            <span className="text-[11px] font-mono tracking-[0.2em] text-slate-500 mt-0.5 shrink-0">POI</span>
            <span className="min-w-0">
              <span className="text-slate-200">{target.dopo.testo}</span>
              {target.dopo.minuti ? (
                <span className="text-slate-500">
                  {' '}
                  · {formatHoursMinutes(target.dopo.minuti / 60)} {target.dopo.etichetta}
                </span>
              ) : target.dopo.nota ? (
                <span className="text-slate-500"> · {target.dopo.nota}</span>
              ) : null}
            </span>
          </p>
        )}

        {/* Budget del giorno: una riga, non due numeri da sommare a mente. */}
        {budget && ((budget.assegnateHours ?? budget.totalNeedHours) > 0 || budget.sintesiHours > 0) && (
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <span className={budget.overCapacity ? BADGE.red : BADGE.blue}>
              <Icon name="clock" className="w-3 h-3" />
              Oggi: {formatHoursMinutes(budget.assegnateHours ?? budget.totalNeedHours)} di studio
              {budget.sintesiHours > 0 ? ` + ${formatHoursMinutes(budget.sintesiHours)} di sintesi` : ''} su{' '}
              {formatHoursMinutes(budget.budgetHours)} disponibili
            </span>
            {budget.overCapacity && (
              <span className="text-primary">
                Deficit di {formatHoursMinutes(budget.deficitHours)}: al tuo ritmo reale il piano di oggi non ci sta.
              </span>
            )}
            {budget.loadAdjustmentPct < 0 && (
              <span className="text-accent font-mono">carico ridotto del {Math.abs(budget.loadAdjustmentPct)}% da K.A.R.E.N.</span>
            )}
          </div>
        )}

        <div className="flex items-center gap-3 flex-wrap">
          <button type="button" onClick={onStart} disabled={!canStart} className={BTN_PRIMARY}>
            <Icon name="play" className="w-5 h-5" />
            {target ? 'Avvia su questo' : 'Avvia Focus'}
          </button>
          <button type="button" onClick={onOpenDetails} className={BTN_GHOST}>
            <Icon name={detailsOpen ? 'chevronUp' : 'chevronDown'} className="w-4 h-4" />
            {detailsOpen ? 'Nascondi il resto' : 'Briefing, quota e missioni'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function MissionControl() {
  const { state, actions, derived, sensoryZero, setSensoryZero, TIMER_STATUS, spiderSenseSurgeAt } = useArachnoForge();
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

  const materie = Array.isArray(state.materie) ? state.materie : [];

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
    const { error: refreshError } = await karen.triggerOracleScan({ force: true });
    setPlanRefreshFeedback(refreshError ? 'error' : 'success');
    clearTimeout(planRefreshFeedbackTimeoutRef.current);
    planRefreshFeedbackTimeoutRef.current = setTimeout(() => setPlanRefreshFeedback(null), 3200);
  }, [karen]);

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
  const minutiBloccoInCorso =
    timer.status === TIMER_STATUS.FOCUS || timer.status === TIMER_STATUS.PAUSED
      ? Math.max(0, Math.floor((timer.totalSeconds - timer.remainingSeconds) / 60))
      : 0;
  const minutiSalvabili = timer.pendingFocusMinutes + minutiBloccoInCorso;
  // V37.0 — l'anteprima ignorava Maximum Carnage: annunciava un costo di
  // Stamina mentre il costo reale applicato dal reducer è zero per tutta
  // la finestra attiva. Stessa firma, stesso motore: nessun secondo
  // calcolo che possa divergere da quello vero.
  const previewStaminaCost = computeFocusStaminaCost(
    effectiveFocusMinutes,
    previewDifficulty,
    derived.skillEffects.staminaCostMultiplier,
    derived.isMaxCarnageActive
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
  const intentoInAttesaRef = useRef(null);
  const doStartFocus = useCallback(() => {
    const intento = intentoInAttesaRef.current;
    intentoInAttesaRef.current = null;
    timer.startFocus(selectedMateriaId || null, selectedSfidaId || null, false, intento);
  }, [timer, selectedMateriaId, selectedSfidaId]);

  // V35.0 — guardia "sessione non salvata": `timer.awaitingDebrief` è ora
  // derivato direttamente dall'hook (mai una copia locale che si perde a
  // cambio pagina) — se true, un nuovo Focus concatenerebbe silenziosamente
  // minuti su una materia/nodo potenzialmente diversi da quelli in sospeso.
  // Si chiede conferma esplicita invece di permetterlo senza preavviso.
  const handleStartFocus = useCallback(() => {
    intentoInAttesaRef.current = null;
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
   * V36.0 — il bersaglio della card "ADESSO", in ordine di specificità
   * decrescente: l'argomento scelto oggi da K.A.R.E.N. (già riconciliato
   * live con l'albero), altrimenti il Primary Target di materia, altrimenti
   * niente — mai un suggerimento inventato quando non c'è nulla da
   * suggerire.
   */
  const nowTarget = useMemo(() => {
    // V40.0 — due candidati, e un arbitro.
    //  - lo STUDIO per gli esami (argomento scelto oggi da K.A.R.E.N.,
    //    altrimenti il Primary Target di materia);
    //  - la SINTESI di una lezione davvero da sistemare (coda del Campus,
    //    solo con fonti aperte o non dichiarata già fatta).
    // La lezione passa davanti solo se il piano lo consente
    // (`karenSintesi.prima`: nessun esame in focus a rischio, niente
    // monotask) o se non c'è altro da fare. Altrimenti resta come "POI":
    // visibile, con il suo tempo riservato, ma mai sopra un esame che
    // rischia di non starci. Prima vinceva sempre la lezione.
    const campus = derived.campus;
    const sintesiPlan = derived.karenSintesi;
    let lezione = null;
    if (campus?.fase === 'LEZIONI' && campus.coda?.length > 0) {
      const l = campus.coda[0];
      const materia = materie.find((m) => m.id === l.materiaId);
      const nodo = nodoInSintesi(materia);
      lezione = {
        argomento: nodo ? nodo.nome : `Appunti di ${l.materia.nome}`,
        materia: `${l.materia.nome} · sistema la lezione ${
          l.lezioniDaSistemare > 1 ? `(${l.lezioniDaSistemare} lezioni)` : `delle ${l.inizio}`
        }`,
        rationale:
          l.oreFa < 1
            ? 'La lezione è appena finita: trasformarla nei tuoi appunti adesso costa una frazione di quanto costerà fra una settimana.'
            : `Finita ${l.oreFa}h fa. Sistemarla oggi, finché la ricordi, è il lavoro di sintesi che rende di più.`,
        metodo: 'Modalità Sintesi: dal libro, dalle slide e da ciò che hai scritto in aula ai tuoi appunti definitivi.',
        materiaId: l.materiaId,
        sfidaId: nodo?.id || null,
        daLezione: true,
        breve: `Sistema la lezione di ${l.materia.nome}`
      };
    }
    let studio = null;
    if (liveStudyFocus.primary) {
      studio = {
        argomento: liveStudyFocus.primary.argomento,
        materia: liveStudyFocus.primary.materia,
        rationale: liveStudyFocus.primary.rationale,
        metodo: liveStudyFocus.primary.metodo,
        materiaId: liveStudyFocus.primary.materiaId || null,
        sfidaId: liveStudyFocus.primary.sfidaId || null,
        breve: liveStudyFocus.primary.argomento
      };
    } else if (derived.primaryTarget) {
      studio = {
        argomento: derived.primaryTarget.materia.nome,
        materia: `Primary Target · Spider-Score ${derived.primaryTarget.spiderScore}`,
        rationale: derived.primaryTarget.reason,
        metodo: null,
        materiaId: derived.primaryTarget.materia.id,
        sfidaId: null,
        breve: derived.primaryTarget.materia.nome
      };
    }
    const minutiSintesi = Math.round((sintesiPlan?.riservateOre || 0) * 60);
    if (lezione && (sintesiPlan?.prima || !studio)) {
      const oreStudio = derived.karenDailyFocusQuotas?.find((q) => q.materiaId === studio?.materiaId)?.assignedHours;
      return {
        ...lezione,
        dopo: studio
          ? { testo: studio.breve, minuti: Number.isFinite(oreStudio) && oreStudio > 0 ? Math.round(oreStudio * 60) : null, etichetta: 'di studio oggi' }
          : null
      };
    }
    if (studio) {
      return {
        ...studio,
        dopo: lezione
          ? minutiSintesi > 0
            ? { testo: lezione.breve, minuti: minutiSintesi, etichetta: 'riservati oggi' }
            : {
                testo: lezione.breve,
                minuti: null,
                nota: derived.karenMonotaskActive
                  ? 'dopo l’esame: con un appello entro 10 giorni il tempo va tutto lì'
                  : 'quando avanzi tempo: oggi gli esami occupano tutta la giornata'
              }
          : null
      };
    }
    return null;
  }, [liveStudyFocus, derived.primaryTarget, derived.campus, derived.karenSintesi, derived.karenDailyFocusQuotas, derived.karenMonotaskActive, materie]);

  /** Avvio in un solo gesto dalla card "ADESSO": seleziona il bersaglio
   * (così i due Dropdown restano coerenti con ciò che sta girando) e fa
   * partire il blocco, passando comunque dalla stessa guardia "sessione
   * non salvata" di handleStartFocus. */
  const handleStartNow = useCallback(() => {
    const materiaId = nowTarget?.materiaId || selectedMateriaId || null;
    const sfidaId = nowTarget?.sfidaId || (nowTarget?.materiaId ? null : selectedSfidaId) || null;
    setSelectedMateriaId(materiaId || '');
    setSelectedSfidaId(sfidaId || '');
    if (timer.awaitingDebrief) {
      intentoInAttesaRef.current = nowTarget?.daLezione ? 'SINTESI' : null;
      setConfirmRestartOpen(true);
      return;
    }
    // V40.2 — dalla card di una lezione da sistemare la sessione nasce
    // come Sintesi: il Debriefing chiederà le pagine fonte per fonte.
    timer.startFocus(materiaId, sfidaId, false, nowTarget?.daLezione ? 'SINTESI' : null);
  }, [nowTarget, selectedMateriaId, selectedSfidaId, timer]);

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
      if (debriefOpen || questModalOpen || confirmInterruptOpen || confirmRestartOpen) return;
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
  }, [timer, handleStartNow, debriefOpen, questModalOpen, confirmInterruptOpen, confirmRestartOpen, setSensoryZero, TIMER_STATUS]);

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

  const modoConsigliato = useMemo(() => {
    if (!activeSfida) return null;
    const src = nodeSources(activeSfida);
    if (src.totali === 0) return null;
    return suggestedWorkMode(activeSfida);
  }, [activeSfida]);

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
    const sessionHour = new Date().getHours();
    if (eff.nightBonusEnabled && sessionHour >= 0 && sessionHour < 4) activeSkillChips.push('+10% XP notturno');
    if (timer.isOverdriveActive) activeSkillChips.push(`Overdrive x${eff.overdriveMultiplier.toFixed(2)}`);
  }

  if (sensoryZero) {
    // V39 — portal su document.body e z-[60] come le modali: la conferma
    // "Blood Pact" (anch'essa in un portal, montata dopo) ora compare
    // SOPRA l'isolamento invece di restare nascosta dietro. Nessun
    // role="dialog" qui: la scorciatoia Esc/Spazio della pagina deve
    // continuare a funzionare dentro Sensory Zero.
    if (typeof document === 'undefined') return null;
    return createPortal(
      <div className="fixed inset-0 z-[60] px-4 bg-[radial-gradient(ellipse_at_center,rgb(var(--af-surface-rgb))_0%,#000000_100%)] flex flex-col items-center justify-center">
        <button
          type="button"
          onClick={() => setSensoryZero(false)}
          className="absolute top-4 right-4 sm:top-6 sm:right-6 w-12 h-12 flex items-center justify-center rounded-xl text-slate-500 hover:text-primary hover:bg-white/[0.04] transition-all duration-300"
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
          message={`Interrompere ora la sessione di Focus costa ${derived.effectiveBloodPactPenalty} XP${
            minutiSalvabili > 0 ? ` e butta via ${minutiSalvabili} minuti già fatti — per tenerli usa "Termina e salva"` : ''
          }. Confermi il sacrificio?`}
          confirmLabel="Sacrifica XP"
        />
      </div>,
      document.body
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className={H1}>Stark-Web Terminal</h1>
        <p className="text-base text-slate-400 mt-1.5">Karen: sistemi operativi. Centro di comando del ciclo di studio.</p>
      </div>

      {/* V39.0 — Empire State University: le lezioni di oggi in una riga,
          solo in modalità Lezioni. Un tocco porta all'orario completo. */}
      <CampusStrip campus={derived.campus} />

      {/* V36.0 — "ADESSO": la decisione operativa del momento, prima di
          qualunque cruscotto. Visibile solo a timer fermo — durante una
          sessione la domanda "cosa studio adesso" ha già risposta. */}
      {timer.status === TIMER_STATUS.IDLE && !timer.awaitingDebrief ? (
        <NowCard
          target={nowTarget}
          minutes={effectiveFocusMinutes}
          budget={derived.karenBudget}
          canStart
          onStart={handleStartNow}
          onOpenDetails={() => setDetailsOpen((v) => !v)}
          detailsOpen={detailsOpen}
        />
      ) : (
        // A sessione avviata la card "ADESSO" non serve (la domanda ha già
        // risposta), ma il comando per aprire i pannelli deve restare
        // raggiungibile: mai un toggle che scompare col suo contenuto.
        <button type="button" onClick={() => setDetailsOpen((v) => !v)} className={BTN_GHOST}>
          <Icon name={detailsOpen ? 'chevronUp' : 'chevronDown'} className="w-4 h-4" />
          {detailsOpen ? 'Nascondi briefing e quota' : 'Mostra briefing e quota'}
        </button>
      )}

      {detailsOpen && (
        <>
      {/* V35.0 — Daily Brain: il box briefing mostra ora il vero
          briefing_text/tactical_advice generato dall'unica chiamata
          K.A.R.E.N. giornaliera, quando disponibile per oggi — se
          la telemetria non c'è ancora, degrado con grazia alla citazione
          statica a rotazione (mai rimossa, solo declassata a fallback). */}
      <div className={`${CARD} flex items-start gap-3`}>
        <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-secondary/10 blur-3xl pointer-events-none" />
        <div className="relative w-9 h-9 rounded-xl bg-secondary/10 flex items-center justify-center text-secondary shrink-0">
          <Icon name="radar" className="w-5 h-5" />
        </div>
        <div className="relative flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
            <p className="text-xs tracking-widest text-slate-500">
              {karenBriefingToday ? 'K.A.R.E.N. — DAILY BRIEFING' : 'DAILY BRIEFING'}
            </p>
            {karenDirectivesToday?.study_window?.label && (
              <span className={BADGE.blue}>
                <Icon name="calendar" className="w-3 h-3" />
                Picco cognitivo: {karenDirectivesToday.study_window.label}
              </span>
            )}
          </div>
          {karenBriefingToday ? (
            <>
              <p className="text-base italic text-slate-300 leading-relaxed">"{karenBriefingToday.briefing_text}"</p>
              {karenBriefingToday.tactical_advice && (
                <p className="text-sm text-secondary mt-2 leading-relaxed">{karenBriefingToday.tactical_advice}</p>
              )}
            </>
          ) : (
            <p className="text-base italic text-slate-300 leading-relaxed">"{staticBriefing}"</p>
          )}
        </div>
      </div>

      {karenDirectivesToday?.mission_control?.load_adjustment_pct < 0 && (
        <div className={`${CARD} flex items-start gap-3 !py-3.5`}>
          <div className="relative w-9 h-9 rounded-xl bg-accent/15 border border-accent/40 flex items-center justify-center text-accent shrink-0">
            <Icon name="bolt" className="w-5 h-5" />
          </div>
          <div className="relative">
            <p className="text-sm font-semibold text-accent">
              Karen consiglia {karenDirectivesToday.mission_control.load_adjustment_pct}% di carico oggi
            </p>
            {karenDirectivesToday.mission_control.rationale && (
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">{karenDirectivesToday.mission_control.rationale}</p>
            )}
          </div>
        </div>
      )}

      {/* V35.3/V35.4 — Study Focus Engine ("Piano Argomenti del Giorno"):
          unica superficie in cui K.A.R.E.N. nomina un argomento SPECIFICO
          (non solo una materia) letto dal Web-Matrix reale, con la tecnica
          di studio motivata sul suo contenuto — vedi directives.study_focus
          (supabase/functions/karen-oracle/_logic.ts). Card indipendente
          da mission_control/study_window: può comparire anche quando il
          carico non viene ridotto (banda OTTIMALE), perché il piano
          sull'argomento è utile ogni giorno, non solo nei giorni critici.
          V35.4: il payload del giorno non cambia, ma `liveStudyFocus`
          (src/utils/studyFocusLive.js) lo riconcilia in tempo reale con lo
          stato vivo dell'albero — completare il nodo suggerito promuove
          istantaneamente la prossima opzione, mai una card "congelata". */}
      {karenDirectivesToday?.study_focus && (liveStudyFocus.primary || liveStudyFocus.exhausted) && (
        <div className={`${CARD} flex items-start gap-3`}>
          <div className="relative w-9 h-9 rounded-xl bg-secondary/15 border border-secondary/40 flex items-center justify-center text-secondary shrink-0">
            <Icon name="target" className="w-5 h-5" />
          </div>
          <div className="relative flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
              <p className="text-xs tracking-widest text-slate-500">PIANO ARGOMENTI DI OGGI</p>
              <button
                type="button"
                onClick={handleRefreshStudyPlan}
                disabled={karen.scanning}
                className={`inline-flex items-center gap-1 text-[11px] font-mono text-slate-500 hover:text-secondary transition-colors ${karen.scanning ? 'opacity-60' : ''}`}
                title="Chiede a K.A.R.E.N. una nuova valutazione completa del piano di oggi"
              >
                <Icon name="radar" className={`w-3.5 h-3.5 ${karen.scanning ? 'animate-spin' : ''}`} />
                {karen.scanning ? 'Aggiornamento...' : 'Aggiorna piano'}
              </button>
            </div>
            {planRefreshFeedback === 'success' && (
              <p className="text-[11px] text-green-400 mb-1.5">Piano rivalutato da K.A.R.E.N.</p>
            )}
            {planRefreshFeedback === 'error' && (
              <p className="text-[11px] text-primary mb-1.5">{karen.error || 'Rigenerazione non riuscita — riprova.'}</p>
            )}

            {liveStudyFocus.primary ? (
              <>
                {liveStudyFocus.promoted && (
                  <p className="text-[11px] font-mono text-accent mb-1 flex items-center gap-1">
                    <Icon name="bolt" className="w-3 h-3" />
                    Argomento precedente completato — promossa la prossima opzione
                  </p>
                )}
                <p className="text-sm font-semibold text-white">
                  {liveStudyFocus.primary.argomento}
                  <span className="text-slate-500 font-normal"> — {liveStudyFocus.primary.materia}</span>
                </p>
                {liveStudyFocus.primary.rationale && (
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">{liveStudyFocus.primary.rationale}</p>
                )}
                {liveStudyFocus.primary.metodo && (
                  <p className="text-sm text-secondary mt-2 leading-relaxed">{liveStudyFocus.primary.metodo}</p>
                )}
              </>
            ) : (
              <p className="text-sm text-slate-300 leading-relaxed">
                Piano di oggi completato — nessun altro argomento o ripasso in sospeso fra quelli proposti. Usa "Aggiorna piano" per una nuova valutazione.
              </p>
            )}

            {liveStudyFocus.otherOpenOptions.length > 0 && (
              <div className="mt-3 pt-3 border-t border-white/10 space-y-1.5">
                <p className="text-[11px] font-mono tracking-widest text-slate-500 flex items-center gap-1.5">
                  <Icon name="grid" className="w-3.5 h-3.5" />
                  ALTRE OPZIONI DISPONIBILI
                </p>
                {liveStudyFocus.otherOpenOptions.map((o, i) => (
                  <p key={o.sfidaId || `${o.materiaId || 'opt'}-${i}`} className="text-xs text-slate-400 leading-relaxed">
                    <span className="text-slate-300 font-medium">{o.argomento}</span> ({o.materia})
                  </p>
                ))}
              </div>
            )}

            {liveStudyFocus.ripassiDaNonSaltare.length > 0 && (
              <div className="mt-3 pt-3 border-t border-white/10 space-y-2">
                <p className="text-[11px] font-mono tracking-widest text-slate-500 flex items-center gap-1.5">
                  <Icon name="book" className="w-3.5 h-3.5" />
                  RIPASSI DA NON SALTARE
                </p>
                {liveStudyFocus.ripassiDaNonSaltare.map((r, idx) => (
                  <p key={`${r.sfidaId || r.materia}-${r.argomento}-${idx}`} className="text-xs text-slate-400 leading-relaxed">
                    <span className="text-slate-300 font-medium">{r.argomento}</span> ({r.materia}): {r.nota}
                  </p>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

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
                  derived.karenDailyFocusQuotas.map((q) => <QuotaRow key={q.materiaId} q={q} today />)
                )}
              </div>

              {derived.karenQueuedQuotas.length > 0 && (
                <div className="space-y-2.5 pt-3 border-t border-white/10">
                  <span className="text-[11px] font-mono tracking-widest text-slate-500">IN CODA — non spinta oggi</span>
                  {derived.karenMonotaskActive && (
                    <p className="text-xs text-slate-500 italic -mt-1">
                      Monotask attivo: il tempo di oggi va sulla materia in focus qui sopra. Il "Ritmo" qui sotto è il passo sostenibile SE iniziassi questa materia da oggi, non un'indicazione per la giornata odierna.
                    </p>
                  )}
                  {derived.karenQueuedQuotas.map((q) => <QuotaRow key={q.materiaId} q={q} today={false} />)}
                </div>
              )}

              {derived.karenFrozenQuotas.length > 0 && (
                <div className="space-y-2.5 pt-3 border-t border-white/10">
                  <span className="text-[11px] font-mono tracking-widest text-slate-500">CONGELATE — propedeuticità mancante</span>
                  {derived.karenFrozenQuotas.map((q) => <QuotaRow key={q.materiaId} q={q} />)}
                </div>
              )}

              {/* V36.0 — Budget Giornaliero Globale: il totale che prima
                  non esisteva. Con due materie in focus l'app mostrava due
                  "Oggi: Xh" indipendenti che sommati potevano superare
                  qualunque giornata reale, e lo si scopriva solo a sera. */}
              {derived.karenBudget?.totalNeedHours > 0 && (
                <div className="pt-3 border-t border-white/10">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-[11px] font-mono tracking-widest text-slate-500">BUDGET DI OGGI</span>
                    <span className={derived.karenBudget.overCapacity ? BADGE.red : BADGE.green}>
                      {formatHoursMinutes(derived.karenBudget.totalNeedHours)} richieste /{' '}
                      {formatHoursMinutes(derived.karenBudget.studioHours ?? derived.karenBudget.budgetHours)} per lo studio
                    </span>
                  </div>
                  {derived.karenBudget.sintesiHours > 0 && (
                    <p className="text-xs text-cyan-300/90 mt-1.5">
                      + {formatHoursMinutes(derived.karenBudget.sintesiHours)} riservate alla sintesi delle lezioni (su{' '}
                      {formatHoursMinutes(derived.karenBudget.budgetHours)} della giornata), prese solo dal tempo che gli
                      esami lasciano libero.
                    </p>
                  )}
                  <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
                    {derived.karenBudget.overCapacity ? (
                      <>
                        Karen: il piano di oggi eccede di {formatHoursMinutes(derived.karenBudget.deficitHours)} la tua
                        capacità reale misurata. Le ore qui sopra sono già state ripartite in proporzione all'urgenza —
                        ma un deficit che si ripete significa che va spostata una data d'esame o tagliato del programma,
                        non recuperato a forza di volontà.
                      </>
                    ) : (
                      <>
                        Margine libero: {formatHoursMinutes(derived.karenBudget.slackHours)}.
                        {derived.calibration?.capacityConfident
                          ? ` Capacità calcolata sulle tue ultime ${derived.calibration.observedDays} giornate reali.`
                          : ' Capacità ancora sul valore di default: servono almeno 7 giorni di sessioni registrate per calibrarla su di te.'}
                      </>
                    )}
                  </p>
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

        </>
      )}

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

            {/* V31.3 — Skill Tree Feedback Loop: bonus passivi realmente
                attivi sulla sessione in corso, mai un doppione dell'elenco
                skill statico già presente in Armory. */}
            {activeSkillChips.length > 0 && (
              <div className="relative flex flex-wrap items-center justify-center gap-1.5 -mt-1 mb-3">
                {activeSkillChips.map((label) => (
                  <span key={label} className={BADGE.blue}>
                    <Icon name="chip" className="w-3 h-3" />
                    {label}
                  </span>
                ))}
              </div>
            )}

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
                  // V40.0 — niente transizione CSS sull'anello: con un tick
                  // ogni 250 ms la transizione di 250 ms lo teneva in
                  // animazione continua, ridisegnando l'ombra luminosa a
                  // ogni frame per tutta la sessione. Il passo per tick è
                  // di una frazione di pixel: a occhio è identico.
                  className={ringColor}
                  style={{ filter: `drop-shadow(0 0 10px currentColor)` }}
                />
              </svg>
              <div className="absolute flex flex-col items-center">
                {/* V40.0 — a timer fermo mostra la durata del prossimo blocco
                    (25:00), non un "00:00" che sembra un conto già finito. */}
                <p className="text-4xl sm:text-5xl font-mono font-bold af-mono-nums tabular-nums text-white">
                  {timer.status === TIMER_STATUS.IDLE && !timer.awaitingDebrief
                    ? formatClock(Math.round((Number(effectiveFocusMinutes) || 25) * 60))
                    : formatClock(timer.remainingSeconds)}
                </p>
                <p className="text-base text-slate-400 mt-2 tracking-widest">
                  {timer.status === TIMER_STATUS.FOCUS && (timer.isOverdriveActive ? 'OVERDRIVE' : 'FOCUS')}
                  {timer.status === TIMER_STATUS.BREAK && 'PAUSA'}
                  {timer.status === TIMER_STATUS.PAUSED && 'IN PAUSA'}
                  {timer.status === TIMER_STATUS.IDLE && 'PRONTO AL LANCIO'}
                </p>
                {activeMateria && timer.status !== TIMER_STATUS.IDLE && (
                  <div className="text-center mt-1 flex flex-col items-center gap-1.5">
                    <p className="text-xs text-secondary">{activeMateria.nome}</p>
                    {activeSfida && <p className="text-xs text-slate-500">{activeSfida.nome}</p>}
                    {/* V38.0 — il modo consigliato per QUESTO argomento,
                        sotto il countdown: è la differenza fra aprire il
                        libro e aprire il quaderno, e si decide prima di
                        mettersi a sedere, non a sessione finita. */}
                    {activeSfida && modoConsigliato && (
                      <span
                        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-mono ${WORK_MODE_META[modoConsigliato].border} ${WORK_MODE_META[modoConsigliato].bg} ${WORK_MODE_META[modoConsigliato].color}`}
                        title={WORK_MODE_META[modoConsigliato].hint}
                      >
                        <Icon name={WORK_MODE_META[modoConsigliato].icon} className="w-3 h-3" />
                        {WORK_MODE_META[modoConsigliato].label}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* V35.0 — Focus Timer Adattivo: badge visibile SOLO quando
                `settings.karenAdaptiveTimer` è attivo E K.A.R.E.N. ha
                davvero sovrascritto i minuti odierni (mai un override
                silenzioso — l'utente vede sempre perché il timer non è più
                sui minuti di Core Config). */}
            {derived.karenAdaptiveTimerActive && timer.status === TIMER_STATUS.IDLE && (
              <div className="relative -mt-1 mb-1">
                <span className={BADGE.blue}>
                  <Icon name="chip" className="w-3 h-3" />
                  Preset Adattivo K.A.R.E.N.: {derived.karenFocusDirective.preset_label || `${effectiveFocusMinutes}/${effectiveShortBreakMinutes}`}
                </span>
              </div>
            )}

            {timer.status === TIMER_STATUS.IDLE && !timer.awaitingDebrief && (
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
                  Avvia Focus ({effectiveFocusMinutes} min · -{previewStaminaCost} Stamina)
                </button>
                {selectedSfida && (
                  <p className={`text-[11px] text-center ${DIFFICULTY_META[selectedSfida.difficulty].color}`}>
                    Nodo {DIFFICULTY_META[selectedSfida.difficulty].label}
                    {selectedSfida.difficulty === DIFFICULTY.HARD ? ' — costo Stamina maggiorato, +30% XP' : ''}
                  </p>
                )}
              </div>
            )}

            {timer.awaitingDebrief && (
              <div className="relative w-full mt-6 space-y-3">
                <p className="text-[11px] text-center text-slate-500 font-mono">
                  Sessione in sospeso: {timer.pendingFocusMinutes} min{timer.pendingFocusOverdrive ? ' · overdrive attivo' : ''} — non ancora salvata
                </p>
                {timer.status !== TIMER_STATUS.IDLE && (
                  <p className="text-[11px] text-center text-slate-500">
                    Un blocco è ancora in corso: "Termina sessione e salva" lo ferma e aggiunge i suoi minuti interi.
                  </p>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <button type="button" onClick={handleOverdrive} className={BTN_AMBER}>
                    <Icon name="bolt" className="w-6 h-6" />
                    OVERDRIVE (x1.5 XP)
                  </button>
                  <button type="button" onClick={() => handleTakeBreak(false)} className={BTN_SECONDARY}>
                    <Icon name="pause" className="w-6 h-6" />
                    PAUSA ({effectiveShortBreakMinutes} min)
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
                {/* V40.3 — chiudere una sessione senza aspettare la fine
                    del blocco e senza il Blood Pact: i minuti interi già
                    fatti si salvano, nessuna penalità. */}
                {!timer.awaitingDebrief && minutiSalvabili > 0 && (
                  <button type="button" onClick={handleEndAndSave} className={`${BTN_GHOST} col-span-2`}>
                    <Icon name="check" className="w-5 h-5 text-emerald-400" />
                    Termina e salva ({minutiSalvabili} min)
                  </button>
                )}
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
            {/* V37.0 — la Stamina REALE (quella che dimezza gli XP) è
                tornata la barra principale; il Readiness biometrico
                resta, accanto, con il proprio nome. */}
            <StaminaBar
              stamina={state.profile.stamina}
              readinessScore={karen.hasSession ? readinessScore : null}
              readinessBand={karen.readinessBand}
            />
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
                className="-mr-2 w-10 h-10 flex items-center justify-center rounded-xl text-slate-400 hover:text-secondary hover:bg-white/[0.04] transition-all duration-300 active:scale-95"
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
                    className="flex-1 min-w-0 flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl bg-surface/70 border border-secondary/15 hover:border-secondary/50 transition-all duration-300 hover:scale-[1.01] active:scale-95 text-base disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-secondary/15 disabled:hover:scale-100"
                  >
                    <span className="text-slate-200 text-left min-w-0 break-words">{q.nome}{usedToday ? ' — fatto oggi' : ''}</span>
                    <span className="flex items-center gap-2 shrink-0">
                      <span className="text-secondary font-mono text-base">+{q.staminaReward}</span>
                      {q.xpReward > 0 && <span className="text-accent font-mono text-base">+{q.xpReward}xp</span>}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteQuestTarget(q)}
                    className="w-10 h-10 shrink-0 flex items-center justify-center rounded-xl text-slate-500 hover:text-primary hover:bg-white/[0.04] transition-all duration-300 active:scale-95"
                    aria-label={`Elimina protocollo ${q.nome}`}
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
        message={`Interrompere ora la sessione di Focus costa ${derived.effectiveBloodPactPenalty} XP${
            minutiSalvabili > 0 ? ` e butta via ${minutiSalvabili} minuti già fatti — per tenerli usa "Termina e salva"` : ''
          }. Confermi il sacrificio?`}
        confirmLabel="Sacrifica XP"
      />

      {/* V39 — eliminare un protocollo passa da una conferma: il cestino
          stava a pochi pixel dal protocollo stesso e un tocco impreciso lo
          cancellava senza possibilità di tornare indietro. */}
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

      {/* V35.0 — guardia "sessione non salvata": mai più una concatenazione
          silenziosa di una nuova sessione su una materia/nodo diversi
          mentre minuti già chiusi restano ancora da Debriefare. */}
      <ConfirmDialog
        open={confirmRestartOpen}
        onClose={() => setConfirmRestartOpen(false)}
        onConfirm={confirmRestartFocus}
        title="Sessione Non Salvata"
        message={`Hai una sessione da ${timer.pendingFocusMinutes} minuti non ancora Debriefata. Avviarne una nuova ora la lascia in sospeso: confermi comunque?`}
        confirmLabel="Avvia Comunque"
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
