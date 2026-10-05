import React, {
  createContext,
  useContext,
  useReducer,
  useEffect,
  useMemo,
  useCallback,
  useState,
  useRef
} from 'react';
import { hydrateState, createDefaultState } from '../data/defaultSchema.js';
import { supabase, USER_DATA_TABLE } from '../utils/supabaseClient.js';
import { useAuthContext } from './AuthContext.jsx';
import BootScreen from '../components/BootScreen.jsx';
import CloudConflictDialog from '../components/CloudConflictDialog.jsx';
// V37.0 — la macchina a stati vive in src/state/reducer.js: qui resta
// solo il Provider (effetti, sincronizzazione, azioni). Vedi il commento
// in testa a quel file per il motivo dell'estrazione.
import { reducer, findMateria, BURNOUT_MINUTES_THRESHOLD } from '../state/reducer.js';
import { validateImportedProfile } from '../utils/storage.js';
import {
  computeBloodPactPenalty,
  computeTotalBankedXp,
  FATIGUE_STAMINA_THRESHOLD,
  FOCUS_QUALITY,
  FOCUS_QUALITY_META
} from '../utils/xpEngine.js';
import { getSkillDef, canUnlockSkill, computeSkillEffects } from '../data/techTree.js';
import { computeCalibration } from '../utils/calibration.js';
import { computeExamReadiness } from '../utils/examReadiness.js';
import { materiaSintesiPlan } from '../utils/sintesiEngine.js';
import { computeCampusSnapshot, FASE, buildCampusCalendar, sintesiMateria } from '../utils/campusEngine.js';
import { withPlanningDates, appelloDaChiudere, haProvaScritta } from '../utils/appelli.js';
import { buildKarenPlanContext } from '../services/karenEngine/planContext.js';
import { streakStatus, restAllowance } from '../utils/streakEngine.js';
import { findDuplicateMateria } from '../data/vanvitelliCourseMap.js';
import { isBountyTarget, computeFriction } from '../utils/friction.js';
import { getDateKey, crossedThreeAM, daysUntilDateOnly, mondayOfDateKey } from '../utils/dateUtils.js';
import { evaluateTrophies } from '../data/trophies.js';
import { TIMER_STATUS } from '../hooks/useTimerEngine.js';
import { useFocusTimer } from '../hooks/useFocusTimer.js';
import { useAudioEngine } from '../hooks/useAudioEngine.js';
import { useProgression } from '../hooks/useProgression.js';
import { useSpiderSense } from '../hooks/useSpiderSense.js';
import { useKarenAutoRouter } from '../hooks/useKarenAutoRouter.js';
import { computePrimaryTarget } from '../utils/karenSuggestor.js';
import { generateDailyQuests } from '../utils/dailyPatrol.js';
import { useAchievements } from '../hooks/useAchievements.js';
import { isMaxCarnageActive, isCarnageHour } from '../utils/maxCarnage.js';
import { canClaimWebSling, rollWebSlingRewardWithPity } from '../utils/webSling.js';
import { createSfideTreeFromAiIndex } from '../utils/aiIndexParser.js';
import { deriveNodeStatus, NODE_STATUS } from '../utils/skillTree.js';
import { validateAdminPassphrase, sandboxStorageKey, guestStorageKey, loadLocalState, saveLocalState } from '../utils/adminOverride.js';
import { saveCloudCheckpoint, loadCloudCheckpoint, clearCloudCheckpoint } from '../utils/cloudCheckpoint.js';
import { saveCloudMirror, loadCloudMirror } from '../utils/cloudMirror.js';
import {
  maybeDailySnapshot,
  saveSnapshot,
  listSnapshots as listLocalSnapshots,
  readSnapshot as readLocalSnapshot,
  deleteSnapshot as deleteLocalSnapshot,
  SNAPSHOT_REASON
} from '../utils/localBackups.js';
import { createSessionId, getDeviceId, classifyRemoteWrite } from '../utils/syncIdentity.js';
import { useKarenBrain } from './KarenBrainContext.jsx';
import { computeTechniqueMemory } from '../utils/techniqueMemory.js';
import { mergeNote, NOTE_MODE } from '../utils/aiNotes.js';

/** V44 — da quanti argomenti eliminati insieme si salva un punto di ripristino. */
const BULK_DELETE_SNAPSHOT_MIN = 5;

const ArachnoForgeContext = createContext(null);

/**
 * V37.0 — PRESTAZIONI: il Tactical Timer ha un contesto SUO.
 *
 * `timer` cambia una volta al secondo per tutta la durata di una
 * sessione di Focus — è il suo mestiere. Ma stando dentro il `value` del
 * Context principale, faceva cambiare identità a quel value ogni
 * secondo, e con esso rirenderizzava OGNI consumatore di
 * `useArachnoForge()`: Sidebar, Web-Matrix, Star Log, Armory... pagine
 * che del countdown non sanno nulla e non devono ridisegnarsi mentre
 * studi. Con un contesto separato, il tick al secondo raggiunge solo chi
 * il countdown lo mostra davvero (Mission Control).
 */
/**
 * V41 — Quanto serve per annullare l'eliminazione di alcuni argomenti:
 * gli argomenti tolti (con la loro posizione) e i figli che verranno
 * "promossi a radice" (con il padre che avevano). Null se non c'è niente.
 */
function captureSfideRemoval(state, materiaId, sfidaIds) {
  const materia = (Array.isArray(state?.materie) ? state.materie : []).find((m) => m && m.id === materiaId);
  const sfide = Array.isArray(materia?.sfide) ? materia.sfide : [];
  const del = new Set(Array.isArray(sfidaIds) ? sfidaIds : []);
  const removed = [];
  sfide.forEach((sfida, index) => {
    if (sfida && del.has(sfida.id)) removed.push({ sfida, index });
  });
  if (removed.length === 0) return null;
  const reparent = sfide
    .filter((s) => s && !del.has(s.id) && del.has(s.parentId))
    .map((s) => ({ id: s.id, parentId: s.parentId }));
  return { materiaId, removed, reparent };
}

const TimerContext = createContext(null);

export function useFocusTimerContext() {
  const ctx = useContext(TimerContext);
  if (!ctx) throw new Error('useFocusTimerContext deve essere usato dentro <ArachnoForgeProvider>.');
  return ctx;
}


/** V39 — nessuna richiesta di salvataggio può bloccare la coda per
 * sempre (rete mobile appesa, tunnel, captive portal): oltre il limite
 * la scrittura conta come fallita e la coda riparte. */
const SAVE_TIMEOUT_MS = 20000;
/** V41 — tetto di attesa della lettura iniziale del profilo. */
const BOOT_TIMEOUT_MS = 15000;
function withTimeout(promise, ms = SAVE_TIMEOUT_MS) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Timeout della sincronizzazione')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function ArachnoForgeProvider({ children }) {
  // V26.0 — "The Nexus Gate" (Pillar 3: Cloud State Sync). ArachnoForgeProvider
  // viene montato SOLO quando esiste una sessione valida (vedi App.jsx),
  // quindi `user` qui è garantito non-nullo. Lo stato in memoria parte
  // sempre dallo schema di default (sincrono, come richiesto da useReducer):
  // il caricamento reale arriva subito dopo, in modo asincrono, dal boot
  // effect qui sotto, che sostituisce lo stato con HYDRATE non appena la
  // query Supabase risolve.
  const { user, signOut: authSignOut, isGuest } = useAuthContext();
  // V35.0 — K.A.R.E.N. Daily Brain: unica dipendenza da KarenBrainContext,
  // montato come antenato in App.jsx. Lettura sola andata (nessuna
  // scrittura verso le tabelle biometriche da qui) — usata solo per
  // calcolare gli "effective" minuti del Focus Timer Adattivo più sotto.
  const karenBrain = useKarenBrain();
  const [state, dispatch] = useReducer(reducer, undefined, createDefaultState);
  // V41 — ogni sostituzione INTERA dello stato (boot, aggiornamento da un
  // altro dispositivo, conflitto, import, reset) passa da qui. Ricordare
  // l'oggetto esatto permette agli effetti "a fronte di salita" (nuovo
  // rango, Symbiote sbloccata, missioni completate, Spider-Sense Surge,
  // Maximum Carnage) di riconoscere il render dell'idratazione e di
  // riallinearsi SENZA festeggiare: prima, a ogni avvio, ripartivano dallo
  // stato di default e al caricamento dei dati veri suonavano e
  // mostravano notifiche per traguardi raggiunti giorni prima.
  // Un contatore ("epoca") cresce a ogni idratazione; ogni effetto ricorda
  // l'ultima epoca vista e, se è cambiata, si riallinea invece di
  // reagire. Funziona anche quando React raggruppa l'idratazione con altre
  // azioni nello stesso render (per esempio la rigenerazione delle
  // missioni del giorno all'avvio).
  const [hydrationEpoch, setHydrationEpoch] = useState(0);
  const hydrate = useCallback((payload) => {
    setHydrationEpoch((e) => e + 1);
    dispatch({ type: 'HYDRATE', payload });
  }, []);
  const [sensoryZero, setSensoryZero] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [nowTick, setNowTick] = useState(0);

  // V28.1 — Pillar 2 (Secure Admin Override): terzo backend di
  // persistenza, attivabile SOLO per utenti reali (mai in Modalità
  // Ospite, che è già interamente locale). `storageMode` è la singola
  // fonte di verità letta da boot fetch + autosave qui sotto — mai due
  // rami di codice che decidono la destinazione di lettura/scrittura in
  // modo indipendente e potenzialmente disallineato.
  const [sandboxActive, setSandboxActive] = useState(false);
  const storageMode = isGuest ? 'guest' : sandboxActive ? 'sandbox' : 'cloud';
  // Snapshot dello stato Cloud reale, congelato nell'istante esatto in cui
  // si entra in Sandbox — permette un ritorno ISTANTANEO al profilo
  // standard (nessun secondo round-trip di rete) e, se la Sandbox non ha
  // ancora un proprio salvataggio locale, serve anche da punto di partenza
  // realistico ("una copia da cui sperimentare", mai uno stato vuoto).
  const cloudSnapshotRef = useRef(null);

  // Cloud Sync status — micro-HUD (Pillar 4): 'loading' (boot iniziale,
  // blocca il render dei children), 'syncing' (upsert in corso),
  // 'synced' (tutto scritto), 'error' (fetch o upsert falliti).
  const [syncStatus, setSyncStatus] = useState('loading');
  const cloudReadyRef = useRef(false);
  const skipNextSaveRef = useRef(true);
  const saveTimeoutRef = useRef(null);
  // V37.0 — true quando il boot ha ripescato del lavoro non confermato da
  // un checkpoint locale: serve sia a forzarne il ri-salvataggio sia ad
  // avvisare il Cadetto una sola volta (vedi l'effetto più in basso).
  const recoveredCheckpointRef = useRef(false);
  // V39.0 — Identità di sincronizzazione (vedi utils/syncIdentity.js):
  // chi sta scrivendo (questa scheda) e da dove (questo browser), più le
  // ultime versioni che sappiamo essere "nostre". Servono a distinguere un
  // conflitto vero (un altro dispositivo ha salvato) da un falso allarme
  // (una nostra scrittura precedente, un doppio salvataggio).
  const sessionIdRef = useRef(null);
  if (!sessionIdRef.current) sessionIdRef.current = createSessionId();
  const deviceIdRef = useRef(null);
  if (!deviceIdRef.current) deviceIdRef.current = getDeviceId();
  /** Oggetto di stato confermato dal backend per ultimo (identità, non contenuto). */
  const lastPersistedRef = useRef(null);
  /** Ultimo `app_state` grezzo scritto da questa scheda. */
  const lastSentRef = useRef(null);
  /** `app_state` grezzo letto dal backend al boot / all'ultimo aggiornamento. */
  const baseRemoteStateRef = useRef(null);
  /** Sessione che aveva scritto il checkpoint recuperato al boot (pagina ricaricata). */
  const recoveredWriterRef = useRef(null);
  /** Modalità di salvataggio corrente, leggibile da un job già in coda. */
  const storageModeRef = useRef(storageMode);
  storageModeRef.current = storageMode;

  // V41 — `options` facoltativo: `{ action: { label, onClick }, duration }`
  // (es. "Annulla" dopo un'eliminazione). Un messaggio identico già a
  // schermo non viene ripetuto: due eventi gemelli ravvicinati non
  // impilano due card uguali. Mai però un toast con un'azione: ogni
  // "Annulla" annulla la SUA operazione, e scartarlo la renderebbe
  // irrecuperabile.
  const pushToast = useCallback((message, type = 'info', options = null) => {
    const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const hasAction = !!(options && options.action);
    setToasts((prev) => {
      if (!hasAction && prev.some((t) => t.message === message && t.type === type && !t.action)) return prev;
      return [
        ...prev,
        {
          id,
          message,
          type,
          ...(options && options.action ? { action: options.action } : {}),
          ...(options && Number.isFinite(options.duration) ? { duration: options.duration } : {})
        }
      ];
    });
    return id;
  }, []);

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Motore Audio Procedurale (Web Audio API, nessun asset esterno). Muto
  // forzatamente quando Sensory Zero è attivo, oltre al toggle manuale in
  // Core Config — coerente con la richiesta "isolamento sensoriale totale".
  const audio = useAudioEngine({ enabled: state.settings.soundEffects !== false && !sensoryZero });

  // Web-Click app-wide: un solo listener delegato a livello di documento,
  // invece di instrumentare manualmente ogni singolo pulsante di ogni
  // pagina. Suono deliberatamente cortissimo/discreto (~90ms, gain basso).
  useEffect(() => {
    const handleClick = (e) => {
      const btn = e.target.closest('button');
      if (!btn || btn.disabled) return;
      audio.playWebClick();
    };
    document.addEventListener('click', handleClick, true);
    return () => document.removeEventListener('click', handleClick, true);
  }, [audio]);

  // Sensory Web Audio Engine — Hover Blip: un solo listener delegato per
  // TUTTA l'app (stesso pattern del Web-Click) invece di instrumentare
  // manualmente ogni bottone. Riconosce i "bottoni principali" dalla loro
  // firma di classi Design System (font-bold + uppercase, esclusiva di
  // BTN_PRIMARY/SECONDARY/SUCCESS/AMBER — mai BTN_GHOST, deliberatamente
  // silenzioso per le azioni terziarie). `lastHoveredRef` evita di
  // ri-suonare più volte durante lo stesso hover continuo (solo un
  // pointerover per elemento, mai un blip per micro-movimento del mouse).
  const lastHoveredRef = useRef(null);
  useEffect(() => {
    // V41 — i bottoni principali si riconoscono dalla loro ricetta del
    // design system (classi `ds-btn-*` "piene"), non più da maiuscolo +
    // grassetto: il nuovo stile non usa più il maiuscolo spaziato.
    const MAIN_BUTTON_CLASSES = ['ds-btn-primary', 'ds-btn-secondary', 'ds-btn-success', 'ds-btn-amber'];
    const isPrimaryButton = (btn) => MAIN_BUTTON_CLASSES.some((c) => btn.classList.contains(c));
    const handlePointerOver = (e) => {
      const btn = e.target.closest('button');
      if (!btn || btn.disabled || !isPrimaryButton(btn)) {
        lastHoveredRef.current = null;
        return;
      }
      if (lastHoveredRef.current === btn) return;
      lastHoveredRef.current = btn;
      audio.playHoverBlip();
    };
    const handlePointerOut = (e) => {
      const btn = e.target.closest('button');
      if (btn && lastHoveredRef.current === btn) lastHoveredRef.current = null;
    };
    document.addEventListener('pointerover', handlePointerOver, true);
    document.addEventListener('pointerout', handlePointerOut, true);
    return () => {
      document.removeEventListener('pointerover', handlePointerOver, true);
      document.removeEventListener('pointerout', handlePointerOut, true);
    };
  }, [audio]);

  // "Il Cervello" del Tactical Timer, isolato in un custom hook dedicato
  // (Fase 2 — Custom Hooks & State Split). Comunica col reducer solo via
  // `dispatch`, che useReducer garantisce stabile fra i render.
  // V35.0 — Focus Timer Adattivo: quando `settings.karenAdaptiveTimer` è
  // attivo (default true, disattivabile in Karen OS Settings — mai un
  // override silenzioso e non disattivabile) e il Daily Brain di oggi ha
  // prodotto una direttiva `focus_timer`, i minuti effettivi di
  // Focus/Pausa Breve vengono presi da lì invece che dalle impostazioni
  // manuali. La Pausa Lunga resta SEMPRE una scelta manuale dell'utente
  // (mai automatizzata: è un blocco deliberato, non un ciclo ricorrente).
  // Fallback totale alle impostazioni manuali se karen-oracle non ha
  // ancora girato oggi (`directives` null) — mai un valore assente.
  const karenFocusDirective =
    state.settings.karenAdaptiveTimer !== false && karenBrain.directives && karenBrain.directives.focus_timer
      ? karenBrain.directives.focus_timer
      : null;
  const effectiveFocusTime =
    karenFocusDirective && Number.isFinite(karenFocusDirective.focus_minutes) && karenFocusDirective.focus_minutes > 0
      ? karenFocusDirective.focus_minutes
      : state.settings.focusTime;
  const effectiveShortBreakTime =
    karenFocusDirective && Number.isFinite(karenFocusDirective.break_minutes) && karenFocusDirective.break_minutes > 0
      ? karenFocusDirective.break_minutes
      : state.settings.shortBreakTime;

  // V42 — la chiusura di una sessione porta con sé il contesto del piano
  // che l'utente vedeva (bersaglio di oggi, capacità, lezioni in coda):
  // missioni e Stamina usano gli stessi numeri della UI, senza che il
  // reducer debba ricalcolarli (e magari diversamente).
  const timerCtxRef = useRef({ primaryTargetMateriaId: undefined, capacityHours: 4.5, readinessScore: null, lessonMateriaIds: [] });
  const timerDispatch = useCallback((action) => {
    if (action && action.type === 'FOCUS_COMPLETED') {
      const c = timerCtxRef.current;
      dispatch({
        ...action,
        payload: {
          primaryTargetMateriaId: c.primaryTargetMateriaId,
          capacityHours: c.capacityHours,
          readinessScore: c.readinessScore,
          lessonMateriaIds: c.lessonMateriaIds,
          ...action.payload
        }
      });
      return;
    }
    dispatch(action);
  }, []);
  const bloodPactPenaltyNow = computeBloodPactPenalty(computeSkillEffects(state.profile.unlockedSkills).bloodPactReduction);

  const timer = useFocusTimer({
    focusTime: effectiveFocusTime,
    shortBreakTime: effectiveShortBreakTime,
    longBreakTime: state.settings.longBreakTime,
    dispatch: timerDispatch,
    bloodPactPenalty: bloodPactPenaltyNow,
    audio,
    pushToast,
    userId: user.id,
    // V36.0 — notifiche di sistema e Wake Lock, governati da Karen OS
    // Settings. Entrambi best effort dentro l'hook: un permesso negato o
    // un browser senza le API non cambia nulla del resto del timer.
    notificationsEnabled: state.settings.systemNotifications === true,
    keepScreenAwake: state.settings.keepScreenAwake !== false,
    // V40.3 — il rintocco ogni 30 minuti di Focus accumulato.
    focusReminderEnabled: state.settings.focusReminder !== false,
    // V41 — il recupero di una sessione orfana aspetta i dati veri: prima
    // veniva applicato allo stato di DEFAULT del primo render e poi
    // cancellato dall'idratazione, perdendo i minuti che annunciava.
    ready: syncStatus !== 'loading' && cloudReadyRef.current
  });

  // V26.0 — Cloud State Sync (Pillar 3): boot fetch. Un'unica query alla
  // riga `user_data` dell'utente autenticato — se esiste già uno
  // `app_state`, sostituisce l'intero stato in memoria (K.A.R.E.N. Boot
  // Sequence: gli effetti già presenti più sotto — reset Stamina alle
  // 03:00, rigenerazione Daily Patrols — si auto-correggono da soli non
  // appena HYDRATE porta uno stato con timestamp "vecchi" rispetto ad
  // ORA, senza bisogno di logica di boot duplicata qui). Se la riga non
  // esiste ancora (nuovo utente), lo stato di default viene sia caricato
  // in memoria sia scritto immediatamente su Supabase con un INSERT, cosi'
  // che il prossimo autosave possa contare su una riga già presente
  // (upsert successivi diventano puri UPDATE).
  // V41 — un avvio non riuscito non mostra più un profilo vuoto come se
  // fosse vero: resta sulla schermata di avvio con "Riprova" e, se su
  // questo dispositivo c'è una copia dei tuoi dati (utils/cloudMirror.js o
  // un checkpoint non ancora salvato), con "Continua offline".
  const [bootError, setBootError] = useState(null);
  const [bootAttempt, setBootAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setSyncStatus('loading');
    setBootError(null);
    cloudReadyRef.current = false;
    recoveredCheckpointRef.current = false;
    (async () => {
      try {
        // V37.0 — Recupero del lavoro non confermato. Un checkpoint
        // locale esiste solo se l'ultima modifica NON ha mai raggiunto il
        // backend (chiusura improvvisa, crash, PWA uccisa in background,
        // rete caduta durante l'upsert). In quel caso è più recente della
        // riga remota per costruzione, quindi vince — e viene subito
        // ri-salvato dal normale ciclo di autosave.
        const pendingCheckpoint = loadCloudCheckpoint(user.id, storageMode);

        if (storageMode === 'cloud') {
          // V37.0 — si legge anche `updated_at`: è il token di versione
          // che rende condizionale ogni scrittura successiva. Se la
          // migrazione non è ancora stata eseguita Postgres risponde
          // 42703 e si ricade sulla vecchia query, senza locking.
          // V41 — con un tetto di tempo: una rete appesa non tiene più
          // l'app ferma sulla schermata di avvio per sempre.
          let { data, error } = await withTimeout(
            supabase.from(USER_DATA_TABLE).select('app_state, updated_at').eq('user_id', user.id).maybeSingle(),
            BOOT_TIMEOUT_MS
          );
          if (error && error.code === '42703') {
            lockingSupportedRef.current = false;
            ({ data, error } = await withTimeout(
              supabase.from(USER_DATA_TABLE).select('app_state').eq('user_id', user.id).maybeSingle(),
              BOOT_TIMEOUT_MS
            ));
          }
          if (cancelled) return;
          if (error) throw error;
          remoteVersionRef.current = data?.updated_at || null;
          baseRemoteStateRef.current = data?.app_state || null;
          if (data && data.app_state) saveCloudMirror(user.id, data.app_state, data.updated_at || null);

          if (pendingCheckpoint) {
            // V39 — il checkpoint riparte dal token su cui era stato fatto:
            // se nel frattempo un altro dispositivo ha salvato, la prima
            // scrittura fallisce e passa dal controllo dei conflitti
            // invece di cancellarne il lavoro in silenzio. Il contenuto
            // remoto attuale NON è la base di quel lavoro.
            if (pendingCheckpoint.baseVersion && pendingCheckpoint.baseVersion !== remoteVersionRef.current) {
              remoteVersionRef.current = pendingCheckpoint.baseVersion;
              baseRemoteStateRef.current = null;
            }
            recoveredWriterRef.current = pendingCheckpoint.writer || null;
            hydrate(hydrateState(pendingCheckpoint.state));
            recoveredCheckpointRef.current = true;
          } else if (data && data.app_state) {
            const hydrated = hydrateState(data.app_state);
            lastPersistedRef.current = hydrated;
            hydrate(hydrated);
          } else {
            const fresh = createDefaultState();
            const metaUsername = user.user_metadata && typeof user.user_metadata.username === 'string' ? user.user_metadata.username.trim() : '';
            if (metaUsername) fresh.profile.username = metaUsername;
            // V39 — prima la riga, poi l'HYDRATE: con l'HYDRATE durante
            // l'await il suo render trovava cloudReady ancora false, il
            // flag "salta il prossimo salvataggio" restava armato e si
            // mangiava la PRIMA modifica vera del nuovo utente.
            const { data: inserted, error: insertError } = await withTimeout(
              supabase
                .from(USER_DATA_TABLE)
                .insert({ user_id: user.id, app_state: fresh })
                .select(lockingSupportedRef.current ? 'updated_at' : 'user_id')
                .maybeSingle(),
              BOOT_TIMEOUT_MS
            );
            if (insertError) throw insertError;
            if (cancelled) return;
            remoteVersionRef.current = inserted?.updated_at || null;
            lastPersistedRef.current = fresh;
            baseRemoteStateRef.current = fresh;
            hydrate(fresh);
          }
        } else {
          // V28.1 — Pillar 2: backend locale (Guest o Sandbox Admin) — mai
          // una query di rete. La Sandbox, al primo ingresso (nessun
          // salvataggio locale ancora presente), riparte da una COPIA
          // dello stato Cloud reale appena congelato (`cloudSnapshotRef`),
          // cosi' l'admin sperimenta su dati realistici invece che su un
          // profilo vuoto — mai lo stato Cloud reale viene toccato da qui.
          const key = storageMode === 'guest' ? guestStorageKey() : sandboxStorageKey(user.id);
          const saved = loadLocalState(key);
          if (pendingCheckpoint) {
            hydrate(hydrateState(pendingCheckpoint.state));
            recoveredCheckpointRef.current = true;
          } else if (saved) {
            hydrate(hydrateState(saved));
          } else if (storageMode === 'sandbox' && cloudSnapshotRef.current) {
            hydrate(hydrateState(cloudSnapshotRef.current));
          } else {
            const fresh = createDefaultState();
            const metaUsername = user.user_metadata && typeof user.user_metadata.username === 'string' ? user.user_metadata.username.trim() : '';
            if (metaUsername) fresh.profile.username = metaUsername;
            hydrate(fresh);
          }
        }

        if (cancelled) return;
        cloudReadyRef.current = true;
        // V37.0 — un HYDRATE che viene dal backend non è una modifica
        // dell'utente e non va ri-salvato. Un HYDRATE che viene da un
        // checkpoint recuperato invece SÌ: quel lavoro non ha ancora
        // raggiunto il backend, e lasciare `skipNextSave` attivo lo
        // terrebbe ostaggio del prossimo dispatch qualunque esso sia.
        skipNextSaveRef.current = !recoveredCheckpointRef.current;
        setSyncStatus('synced');
      } catch (err) {
        console.error('[ArachnoForge] Boot dello stato fallito — impossibile leggere/creare i dati del profilo.', err);
        if (cancelled) return;
        const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
        const localCopy = storageMode === 'cloud' ? loadCloudCheckpoint(user.id, 'cloud') || loadCloudMirror(user.id) : null;
        setBootError({
          message: offline
            ? 'Il dispositivo è offline. Appena torna la connessione riprova, oppure continua con la copia dei tuoi dati salvata qui.'
            : 'Il server del Nexus non risponde. Riprova tra qualche secondo, oppure continua con la copia dei tuoi dati salvata su questo dispositivo.',
          canOffline: !!localCopy,
          savedAt: localCopy?.savedAt || null
        });
        setSyncStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id, storageMode, bootAttempt]);

  // V41 — Riprova automatica dell'avvio al ritorno della rete.
  useEffect(() => {
    if (!bootError) return undefined;
    const onOnline = () => setBootAttempt((n) => n + 1);
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [bootError]);

  /** V41 — Avvio offline dalla copia locale (checkpoint o specchio del Cloud). */
  const startOffline = useCallback(() => {
    const cp = loadCloudCheckpoint(user.id, 'cloud');
    const mirror = loadCloudMirror(user.id);
    const source = cp?.state || mirror?.state;
    if (!source) return;
    // Il primo salvataggio al ritorno della rete parte dal token di
    // allora: se un altro dispositivo ha salvato nel frattempo, si passa
    // dal dialogo di conflitto invece di sovrascrivere.
    remoteVersionRef.current = cp?.baseVersion || mirror?.version || null;
    baseRemoteStateRef.current = cp ? null : mirror?.state || null;
    recoveredWriterRef.current = cp?.writer || null;
    const hydrated = hydrateState(source);
    recoveredCheckpointRef.current = !!cp;
    lastPersistedRef.current = cp ? null : hydrated;
    hydrate(hydrated);
    cloudReadyRef.current = true;
    skipNextSaveRef.current = !cp;
    setBootError(null);
    setSyncStatus(typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'error');
  }, [user.id, hydrate]);

  // V26.0 — Cloud State Sync (Pillar 4): Debounced Auto-Save. Ogni
  // variazione di stato riavvia un timer di 2.5s; solo l'ULTIMA variazione
  // di una raffica sopravvive abbastanza da scatenare l'upsert reale —
  // esattamente come il pattern già in uso per il salvataggio dei
  // Blueprint in Armory.jsx, applicato qui all'intero stato dell'app.
  // `cloudReadyRef` blocca qualunque scrittura finché il boot fetch non è
  // completato (mai un upsert che sovrascrive dati cloud con lo stato
  // ancora "vuoto" di default in attesa dell'HYDRATE).
  // V37.0 — La scrittura reale vive ora in una funzione sola, che sia
  // chiamata dal debounce, da un flush d'uscita o dal logout: un solo
  // punto di verità, mai due percorsi che possono divergere. Legge SEMPRE
  // lo stato corrente da `pendingStateRef`, mai da una closure, così un
  // flush scatenato fuori dal ciclo di render salva davvero l'ultimo
  // stato e non quello del render in cui l'handler è stato registrato.
  const pendingStateRef = useRef(state);

  /**
   * V37.0 — Concorrenza fra dispositivi. `updated_at` (vedi
   * supabase/user_data_v6_optimistic_locking.sql) è il token di versione
   * della riga: si scrive solo se il valore è ancora quello letto al
   * boot. Se non lo è, un altro dispositivo ha scritto nel frattempo e
   * l'update tocca ZERO righe invece di cancellarne il lavoro.
   *
   * `lockingSupportedRef` rende la cosa retro-compatibile: finché la
   * migrazione non è stata eseguita, la colonna non esiste, Postgres
   * risponde 42703 e si ricade sul vecchio upsert incondizionato —
   * esattamente il comportamento V36, mai un'app che smette di salvare
   * perché manca una migrazione.
   */
  const remoteVersionRef = useRef(null);
  const lockingSupportedRef = useRef(true);
  const [cloudConflict, setCloudConflict] = useState(null);
  // Specchio in ref dello stato di conflitto: l'effetto di autosave deve
  // poterlo leggere senza entrare nelle proprie dipendenze.
  const conflictActiveRef = useRef(false);
  const cloudConflictRef = useRef(null);
  useEffect(() => {
    conflictActiveRef.current = !!cloudConflict;
    cloudConflictRef.current = cloudConflict;
  }, [cloudConflict]);

  /** Dopo una scrittura riuscita: se nel frattempo non è arrivato niente
   * di nuovo il checkpoint ha esaurito il suo scopo; altrimenti viene
   * riscritto con il token appena ricevuto (prima veniva cancellato
   * anche quando conteneva una modifica successiva ancora in attesa). */
  const settleCheckpoint = useCallback(
    (snapshot) => {
      // V41 — la versione appena confermata diventa anche la copia locale
      // di riserva per un eventuale avvio offline (utils/cloudMirror.js).
      if (storageMode === 'cloud') saveCloudMirror(user.id, snapshot, remoteVersionRef.current);
      if (pendingStateRef.current === snapshot) {
        clearCloudCheckpoint(user.id, storageMode);
      } else {
        saveCloudCheckpoint(user.id, storageMode, pendingStateRef.current, {
          baseVersion: remoteVersionRef.current,
          writer: sessionIdRef.current
        });
      }
    },
    [storageMode, user.id]
  );

  const persistState = useCallback(async () => {
    const snapshot = pendingStateRef.current;
    if (storageMode === 'cloud') {
      // V39 — firma di sincronizzazione dentro ogni scrittura: permette di
      // riconoscere le NOSTRE versioni quando una scrittura condizionale
      // fallisce (vedi runPersist).
      const payload = {
        ...snapshot,
        _sync: { writer: sessionIdRef.current, device: deviceIdRef.current, at: new Date().toISOString() }
      };
      const useLocking = lockingSupportedRef.current && remoteVersionRef.current;

      if (useLocking) {
        const { data, error } = await supabase
          .from(USER_DATA_TABLE)
          .update({ app_state: payload })
          .eq('user_id', user.id)
          .eq('updated_at', remoteVersionRef.current)
          .select('updated_at')
          .maybeSingle();
        if (error && error.code === '42703') {
          // Migrazione non ancora eseguita: si degrada una volta sola.
          lockingSupportedRef.current = false;
        } else if (error) {
          throw error;
        } else if (!data) {
          // Zero righe toccate a fronte di un user_id valido = la riga è
          // cambiata sotto di noi. Non si sovrascrive nulla.
          return { ok: false, conflict: true };
        } else {
          remoteVersionRef.current = data.updated_at;
          lastSentRef.current = payload;
          lastPersistedRef.current = snapshot;
          settleCheckpoint(snapshot);
          return { ok: true };
        }
      }

      // Primo salvataggio della sessione, oppure locking non disponibile.
      const columns = lockingSupportedRef.current ? 'updated_at' : 'user_id';
      const { data, error } = await supabase
        .from(USER_DATA_TABLE)
        .upsert({ user_id: user.id, app_state: payload }, { onConflict: 'user_id' })
        .select(columns)
        .maybeSingle();
      if (error) {
        if (error.code === '42703') {
          lockingSupportedRef.current = false;
          const { error: plainError } = await supabase
            .from(USER_DATA_TABLE)
            .upsert({ user_id: user.id, app_state: payload }, { onConflict: 'user_id' });
          if (plainError) throw plainError;
        } else {
          throw error;
        }
      } else if (data && data.updated_at) {
        remoteVersionRef.current = data.updated_at;
      }
      lastSentRef.current = payload;
      lastPersistedRef.current = snapshot;
      settleCheckpoint(snapshot);
      return { ok: true };
    }
    // V28.1 — Pillar 2: Guest/Sandbox scrivono SOLO in locale — mai
    // una riga Supabase creata/toccata per queste due modalità.
    const key = storageMode === 'guest' ? guestStorageKey() : sandboxStorageKey(user.id);
    saveLocalState(key, snapshot);
    lastPersistedRef.current = snapshot;
    // Confermato: il checkpoint locale ha esaurito il suo scopo.
    clearCloudCheckpoint(user.id, storageMode);
    return { ok: true };
  }, [storageMode, user.id, settleCheckpoint]);

  const readRemoteRow = useCallback(async () => {
    const { data, error } = await supabase
      .from(USER_DATA_TABLE)
      .select('app_state, updated_at')
      .eq('user_id', user.id)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  }, [user.id]);

  /**
   * V39.0 — UNA sola coda di scrittura. Prima tre strade scrivevano sul
   * Cloud in modo indipendente — il debounce dell'autosave, il flush
   * d'uscita (scheda nascosta / chiusa) e il salvataggio immediato
   * dell'editor dei nodi — e potevano partire insieme con lo stesso
   * token di versione: la prima vinceva, la seconda trovava la riga
   * "cambiata da un altro dispositivo" e mostrava il conflitto. Con un
   * solo PC acceso. Il salvataggio dell'editor, in più, scriveva senza
   * condizione e senza aggiornare il token: il successivo autosave
   * falliva SEMPRE. Ora ogni scrittura si mette in fila dietro la
   * precedente e parte con il token che quella ha appena ricevuto.
   *
   * Se una scrittura condizionale fallisce lo stesso, si guarda chi ha
   * scritto: se la versione trovata è nostra (o ha lo stesso contenuto di
   * una versione che conoscevamo) si adotta il nuovo token e si riprova
   * in silenzio. Il dialogo di conflitto resta solo per i conflitti veri.
   */
  const saveChainRef = useRef(Promise.resolve());
  const runPersist = useCallback(
    ({ force = false } = {}) => {
      const queuedMode = storageMode;
      const job = saveChainRef.current
        .catch(() => undefined)
        .then(async () => {
          // Un job accodato prima di un cambio di modalità (ingresso in
          // Sandbox) non deve MAI scrivere lo stato della nuova modalità
          // nel backend della vecchia.
          if (storageModeRef.current !== queuedMode) return { ok: true, skipped: true };
          if (!force && pendingStateRef.current === lastPersistedRef.current) return { ok: true, skipped: true };
          let result = await withTimeout(persistState());
          if (!result || !result.conflict) return result;
          let remote;
          try {
            remote = await withTimeout(readRemoteRow());
          } catch {
            remote = null;
          }
          const kind = remote
            ? classifyRemoteWrite(remote.app_state, {
                sessionId: [sessionIdRef.current, recoveredWriterRef.current],
                deviceId: deviceIdRef.current,
                knownStates: [lastSentRef.current, baseRemoteStateRef.current]
              })
            : 'foreign';
          if (kind === 'own' && remote?.updated_at && storageModeRef.current === queuedMode) {
            remoteVersionRef.current = remote.updated_at;
            result = await withTimeout(persistState());
            if (!result || !result.conflict) return result;
            try {
              remote = await withTimeout(readRemoteRow());
            } catch {
              remote = null;
            }
          }
          return { ok: false, conflict: true, remote, kind };
        });
      saveChainRef.current = job;
      return job;
    },
    [persistState, readRemoteRow, storageMode]
  );

  /** Mostra la versione remota che ha causato il conflitto, così il
   * Cadetto può scegliere consapevolmente quale tenere invece di subire
   * una sovrascrittura decisa dall'app. */
  const enterConflictState = useCallback(
    async (prefetched = null) => {
      setSyncStatus('conflict');
      conflictActiveRef.current = true;
      try {
        const data = prefetched || (await readRemoteRow());
        const sig = data?.app_state?._sync || null;
        setCloudConflict({
          remoteState: data?.app_state || null,
          remoteUpdatedAt: data?.updated_at || null,
          sameDevice: !!(sig && sig.device === deviceIdRef.current),
          remoteSavedAt: sig?.at || data?.updated_at || null
        });
      } catch (err) {
        console.error('[ArachnoForge] Lettura della versione remota fallita.', err);
        setCloudConflict({ remoteState: null, remoteUpdatedAt: null, sameDevice: false, remoteSavedAt: null });
      }
    },
    [readRemoteRow]
  );

  /** V41 — "offline" quando il browser sa di non avere rete, "error" altrimenti. */
  const failureStatus = () => (typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'error');

  /** Salva SUBITO, annullando il debounce in corso. Non lancia mai:
   * ritorna `true`/`false` così il chiamante (il logout, l'editor dei
   * nodi) può decidere. */
  const flushSave = useCallback(async () => {
    if (!cloudReadyRef.current) return true;
    if (conflictActiveRef.current) return false;
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    try {
      const result = await runPersist();
      if (result && result.conflict) {
        await enterConflictState(result.remote);
        return false;
      }
      setSyncStatus('synced');
      return true;
    } catch (err) {
      console.error('[ArachnoForge] Flush del salvataggio fallito.', err);
      setSyncStatus(failureStatus());
      return false;
    }
  }, [runPersist, enterConflictState]);

  useEffect(() => {
    pendingStateRef.current = state;
    if (!cloudReadyRef.current) return undefined;
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false;
      return undefined;
    }
    // Conflitto aperto: il checkpoint locale continua ad aggiornarsi (il
    // lavoro non si perde) ma non si ritenta la scrittura finché il
    // Cadetto non ha scelto quale versione tenere — altrimenti ogni
    // dispatch rigenererebbe lo stesso conflitto in un ciclo infinito.
    const checkpointMeta = { baseVersion: remoteVersionRef.current, writer: sessionIdRef.current };
    if (conflictActiveRef.current) {
      saveCloudCheckpoint(user.id, storageMode, state, checkpointMeta);
      return undefined;
    }
    // V37.0 — Checkpoint locale SINCRONO, scritto prima ancora di
    // programmare l'upsert: da questo istante la modifica sopravvive a
    // una chiusura improvvisa, a un crash o a un kill della PWA in
    // background. Viene cancellato appena il Cloud conferma.
    saveCloudCheckpoint(user.id, storageMode, state, checkpointMeta);
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    setSyncStatus('syncing');
    saveTimeoutRef.current = setTimeout(async () => {
      saveTimeoutRef.current = null;
      try {
        const result = await runPersist();
        if (result && result.conflict) {
          await enterConflictState(result.remote);
          return;
        }
        // Un'altra modifica è arrivata mentre questa scrittura era in
        // volo: il suo debounce è già programmato, lo stato resta
        // "in sincronizzazione" finché non parte.
        if (!saveTimeoutRef.current) setSyncStatus('synced');
      } catch (err) {
        console.error('[ArachnoForge] Autosave fallito.', err);
        setSyncStatus(failureStatus());
      }
    }, 2500);
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [state, user.id, storageMode, runPersist, enterConflictState]);

  // V43 — Prima di ogni chiamata a K.A.R.E.N. il lavoro in attesa va sul
  // Cloud: l'IA legge gli appunti da lì (vedi useSuitTelemetry,
  // registerBeforeAiCall). Solo in modalità Cloud: Ospite e Sandbox non
  // scrivono su Supabase, e il loro flush non cambierebbe ciò che legge il
  // server.
  const registerBeforeAiCall = karenBrain.registerBeforeAiCall;
  useEffect(() => {
    if (typeof registerBeforeAiCall !== 'function' || storageMode !== 'cloud') return undefined;
    return registerBeforeAiCall(flushSave);
  }, [registerBeforeAiCall, flushSave, storageMode]);

  // V37.0 — Flush d'uscita. `visibilitychange -> hidden` è l'unico evento
  // su cui si può contare su mobile (iOS non garantisce `beforeunload`, e
  // una PWA messa in background può essere uccisa senza altro preavviso);
  // `pagehide` copre la chiusura vera della scheda su desktop. Entrambi
  // fanno partire la scrittura mentre la pagina è ancora viva.
  // V39 — con la coda unica, due eventi ravvicinati (hidden + pagehide)
  // non producono più due scritture: la seconda trova lo stato già
  // confermato e non fa nulla.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') flushSave();
    };
    const onPageHide = () => flushSave();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [flushSave]);

  /**
   * V39.0 — Aggiornamento al rientro. Tornando su questa scheda (o
   * riaprendo la PWA) si controlla se il profilo è cambiato altrove —
   * il telefono, un'altra finestra — e, se QUI non ci sono modifiche in
   * attesa, si carica in silenzio la versione più recente. È il caso
   * normale "studio sul PC, poi ripasso sul telefono, poi torno al PC":
   * prima finiva sempre nel dialogo di conflitto alla prima modifica.
   * Con modifiche locali in attesa non si tocca nulla: ci pensa la
   * scrittura condizionale, che in caso di conflitto vero chiede.
   */
  const lastRemoteCheckRef = useRef(0);
  // V41 — la stessa verifica è richiamabile dai nuovi tentativi dopo un
  // periodo offline (vedi l'effetto successivo): ritorna true se il Cloud
  // ha risposto.
  const remoteCheckRef = useRef(null);
  useEffect(() => {
    if (storageMode !== 'cloud') return undefined;
    let busy = false;
    const isClean = () =>
      cloudReadyRef.current &&
      !conflictActiveRef.current &&
      !saveTimeoutRef.current &&
      lastPersistedRef.current != null &&
      pendingStateRef.current === lastPersistedRef.current;
    const check = async ({ force = false } = {}) => {
      if (busy) return false;
      if (!force && document.visibilityState !== 'visible') return false;
      if (!lockingSupportedRef.current || !isClean()) return false;
      const now = Date.now();
      if (!force && now - lastRemoteCheckRef.current < 15000) return false;
      lastRemoteCheckRef.current = now;
      busy = true;
      try {
        await saveChainRef.current.catch(() => undefined);
        const { data, error } = await withTimeout(
          supabase.from(USER_DATA_TABLE).select('updated_at').eq('user_id', user.id).maybeSingle()
        );
        if (error) return false;
        if (!data?.updated_at || data.updated_at === remoteVersionRef.current || !isClean()) return true;
        const remote = await withTimeout(readRemoteRow());
        if (!remote?.app_state || !isClean()) return true;
        const kind = classifyRemoteWrite(remote.app_state, {
          sessionId: [sessionIdRef.current, recoveredWriterRef.current],
          deviceId: deviceIdRef.current,
          knownStates: [lastSentRef.current, baseRemoteStateRef.current]
        });
        remoteVersionRef.current = remote.updated_at;
        if (kind === 'own') return true;
        const hydrated = hydrateState(remote.app_state);
        baseRemoteStateRef.current = remote.app_state;
        lastPersistedRef.current = hydrated;
        skipNextSaveRef.current = true;
        saveCloudMirror(user.id, remote.app_state, remote.updated_at || null);
        hydrate(hydrated);
        pushToast(
          kind === 'sameDevice'
            ? 'Profilo aggiornato con le modifiche fatte in un’altra finestra.'
            : 'Profilo aggiornato con le modifiche fatte su un altro dispositivo.',
          'info'
        );
        return true;
      } catch (err) {
        console.warn('[ArachnoForge] Controllo della versione remota non riuscito.', err);
        return false;
      } finally {
        busy = false;
      }
    };
    remoteCheckRef.current = check;
    const onVisibility = () => {
      if (document.visibilityState === 'visible') check();
    };
    const onFocus = () => check();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);
    return () => {
      remoteCheckRef.current = null;
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
    };
  }, [storageMode, user.id, readRemoteRow, pushToast, hydrate]);

  // V41 — Nuovi tentativi dopo un salvataggio fallito o un avvio offline.
  // Prima, se l'autosave falliva (rete caduta) e poi non cambiava più
  // nulla, lo stato restava "non salvato" per sempre: il checkpoint locale
  // c'era, ma nessuno riprovava a mandarlo. Ora si riprova al ritorno
  // della rete e comunque ogni 30 secondi.
  useEffect(() => {
    if (storageMode !== 'cloud') return undefined;
    if (syncStatus !== 'error' && syncStatus !== 'offline') return undefined;
    let running = false;
    const retry = async () => {
      if (running || !cloudReadyRef.current || conflictActiveRef.current) return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      running = true;
      try {
        if (pendingStateRef.current !== lastPersistedRef.current) {
          await flushSave();
        } else {
          const ok = remoteCheckRef.current ? await remoteCheckRef.current({ force: true }) : false;
          if (ok) setSyncStatus('synced');
        }
      } finally {
        running = false;
      }
    };
    const id = setInterval(retry, 30000);
    window.addEventListener('online', retry);
    return () => {
      clearInterval(id);
      window.removeEventListener('online', retry);
    };
  }, [syncStatus, storageMode, flushSave]);

  // V41 — Il browser segnala la perdita di rete: lo si dice subito nella
  // barra laterale invece di aspettare il prossimo salvataggio fallito.
  useEffect(() => {
    if (storageMode !== 'cloud') return undefined;
    const onOffline = () => setSyncStatus((s) => (s === 'loading' || s === 'conflict' ? s : 'offline'));
    window.addEventListener('offline', onOffline);
    return () => window.removeEventListener('offline', onOffline);
  }, [storageMode]);

  // V37.0 — Avviso one-shot quando il boot ha recuperato del lavoro non
  // confermato: il Cadetto deve sapere che quei dati sono tornati, non
  // scoprirlo per caso. Il ref viene letto dopo che syncStatus esce da
  // 'loading', cioè quando l'HYDRATE è già avvenuto.
  const recoveryNoticeShownRef = useRef(false);
  useEffect(() => {
    if (syncStatus === 'loading') return;
    if (!recoveredCheckpointRef.current || recoveryNoticeShownRef.current) return;
    recoveryNoticeShownRef.current = true;
    pushToast(
      'Karen: ho recuperato modifiche della sessione precedente che non erano ancora salvate. Le sto salvando ora.',
      'info'
    );
  }, [syncStatus, pushToast]);

  // V41 — Punto di ripristino automatico del giorno (utils/localBackups.js):
  // al primo avvio della giornata, a dati caricati. Silenzioso e in
  // sottofondo: se IndexedDB non c'è, semplicemente non succede nulla.
  const todayKeyForSnapshot = getDateKey();
  const dataReady = syncStatus !== 'loading' && !bootError;
  useEffect(() => {
    if (!dataReady || !cloudReadyRef.current) return undefined;
    const t = setTimeout(() => {
      maybeDailySnapshot(user.id, pendingStateRef.current);
    }, 4000);
    return () => clearTimeout(t);
  }, [dataReady, todayKeyForSnapshot, user.id]);

  // Snapshot sempre aggiornato dello stato, letto (mai come dipendenza) da
  // funzioni dentro `actions` che hanno bisogno del valore CORRENTE senza
  // costringere l'intero oggetto `actions` a essere ricreato ad ogni
  // variazione di stato (ne romperebbe la stabilità di riferimento,
  // consumata altrove in useCallback/useEffect di più pagine).
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Reset giornaliero automatico (Stamina + Daily Protocols) alle 03:00 AM.
  useEffect(() => {
    const check = () => {
      if (crossedThreeAM(state.profile.lastStaminaResetDate)) {
        dispatch({ type: 'RESET_STAMINA' });
      }
    };
    check();
    const id = setInterval(check, 60000);
    return () => clearInterval(id);
  }, [state.profile.lastStaminaResetDate]);

  // V27.0 — Pillar 3 (Maximum Carnage Mode): scadenza naturale della
  // finestra da 2 ore. Poll ogni 15s (più fine del reset a 03:00: qui il
  // "momento esatto" in cui la furia si esaurisce merita un feedback
  // rapido, non un ritardo fino a un minuto) — appena il timestamp di
  // scadenza è superato, dispatcha la disattivazione una sola volta.
  const carnageActive = state.profile.maxCarnageActive;
  const carnageExpiresAt = state.profile.maxCarnageExpiresAt;
  useEffect(() => {
    if (!carnageActive) return undefined;
    const check = () => {
      if (!isMaxCarnageActive({ maxCarnageActive: carnageActive, maxCarnageExpiresAt: carnageExpiresAt })) {
        dispatch({ type: 'DEACTIVATE_MAX_CARNAGE' });
      }
    };
    check();
    const id = setInterval(check, 15000);
    return () => clearInterval(id);
  }, [carnageActive, carnageExpiresAt]);

  // V27.0 — Pillar 3: Feedback Sensoriale Completo — transizione edge-
  // triggered (come i Trofei / Daily Patrol) su `maxCarnageActive`: al
  // fronte di salita si scatena il ruggito + si avvia il drone ambientale
  // continuo; al fronte di discesa (scadenza o disattivazione) il drone
  // si ferma esplicitamente. Mai un secondo avvio sovrapposto: il ref
  // interno di useAudioEngine (`carnageDroneRef`) è già blindato.
  const prevMaxCarnageRef = useRef(state.profile.maxCarnageActive);
  const carnageEpochRef = useRef(0);
  useEffect(() => {
    const wasActive = prevMaxCarnageRef.current;
    const isActive = state.profile.maxCarnageActive;
    // V41 — idratazione (avvio, altro dispositivo): nessun ruggito per una
    // finestra già in corso. Il drone ambientale, se va, lo riaccende
    // l'effetto qui sotto.
    if (carnageEpochRef.current !== hydrationEpoch) {
      carnageEpochRef.current = hydrationEpoch;
      prevMaxCarnageRef.current = isActive;
      return;
    }
    if (!wasActive && isActive) {
      pushToast('Maximum Carnage: il simbionte prende il sopravvento. XP ×2 per 2 ore — la Stamina scende come sempre.', 'danger');
      audio.playMaxCarnageActivate();
      // V40.3 — il drone ambientale si può spegnere da Karen OS Settings
      // senza rinunciare al resto degli effetti sonori.
      if (state.settings.carnageDrone !== false) audio.startMaxCarnageDrone();
    } else if (wasActive && !isActive) {
      pushToast('Maximum Carnage Mode esaurita. Il simbionte si ritira.', 'info');
      audio.stopMaxCarnageDrone();
    }
    prevMaxCarnageRef.current = isActive;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.profile.maxCarnageActive, pushToast, audio, hydrationEpoch]);

  // V40.3 — l'interruttore del drone agisce anche su un drone già in
  // corso: spegnerlo a metà finestra lo zittisce subito, riaccenderlo lo
  // fa ripartire. Prima il flag valeva solo al momento dell'attivazione.
  useEffect(() => {
    if (!isMaxCarnageActive(state.profile)) return;
    if (state.settings.carnageDrone === false) audio.stopMaxCarnageDrone();
    else audio.startMaxCarnageDrone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.settings.carnageDrone, state.profile.maxCarnageActive, state.profile.maxCarnageExpiresAt, audio]);

  // V33.1 — Suit Unlock Gating: prima d'ora lo sblocco della Symbiote
  // Suit era segnalato SOLO da una riga nel Combat Log (collassato di
  // default in Karen OS Settings dalla V28.1) — un traguardo lifetime
  // one-way che rischiava concretamente di passare inosservato. Stesso
  // pattern edge-trigger del Maximum Carnage qui sopra, ma
  // deliberatamente SENZA un suono dedicato: il flip di questo flag
  // avviene nello STESSO istante del primo trigger di Maximum Carnage
  // (vedi applyCriticalAction), che già riproduce il proprio ruggito —
  // un secondo effetto sonoro sovrapposto sarebbe rumore, non chiarezza.
  const prevSymbioteUnlockRef = useRef(state.profile.symbioteSuitUnlocked);
  const symbioteEpochRef = useRef(0);
  useEffect(() => {
    const was = prevSymbioteUnlockRef.current;
    const is = state.profile.symbioteSuitUnlocked;
    if (symbioteEpochRef.current !== hydrationEpoch) {
      symbioteEpochRef.current = hydrationEpoch;
      prevSymbioteUnlockRef.current = is;
      return;
    }
    if (!was && is) {
      pushToast('Costume Symbiote sbloccato: lo trovi in Karen OS Settings.', 'success');
    }
    prevSymbioteUnlockRef.current = is;
  }, [state.profile.symbioteSuitUnlocked, pushToast, hydrationEpoch]);

  // V28.1 — Pillar 3 (Spider-Sense Focus Surge): edge-trigger sulle nuove
  // righe di Combat Log taggate 'SPIDERSENSE' (stesso pattern del Daily
  // Patrol/Max Carnage sopra) — tiene traccia SOLO delle voci aggiunte
  // dall'ultimo render, mai un doppio trigger se il log viene ritagliato
  // dal cap a 50 voci. `spiderSenseSurgeAt` è un timestamp "one-shot" letto
  // da Mission Control per l'animazione di sblocco sul Tactical Timer.
  // V37.0 — FIX: l'edge-trigger confrontava la LUNGHEZZA del combatLog
  // con quella del render precedente. Ma `pushLog` tiene il log a un cap
  // di 50 voci: superate le 50, la lunghezza non cresce più, `slice()`
  // restituisce sempre un array vuoto e il feedback dello Spider-Sense
  // Surge (toast + suono + animazione) smetteva di comparire PER SEMPRE.
  // Ora il confronto avviene sull'ID dell'ultima voce — un valore che
  // resta univoco anche quando l'array viene ritagliato in testa.
  const lastSeenLogIdRef = useRef(state.combatLog.length > 0 ? state.combatLog[state.combatLog.length - 1].id : null);
  const [spiderSenseSurgeAt, setSpiderSenseSurgeAt] = useState(0);
  const surgeEpochRef = useRef(0);
  useEffect(() => {
    const log = state.combatLog;
    if (log.length === 0) {
      lastSeenLogIdRef.current = null;
      return;
    }
    // V41 — le voci arrivate con un'idratazione sono storia, non eventi
    // nuovi: prima l'ultima voce del log caricato poteva far ripartire
    // toast, suono e animazione dello Spider-Sense Surge a ogni avvio.
    if (surgeEpochRef.current !== hydrationEpoch) {
      surgeEpochRef.current = hydrationEpoch;
      lastSeenLogIdRef.current = log[log.length - 1].id;
      return;
    }
    const lastSeenId = lastSeenLogIdRef.current;
    // Indice dell'ultima voce già vista: tutto ciò che viene dopo è nuovo.
    // Se quell'id non esiste più (voce uscita dal cap) consideriamo nuovo
    // solo l'ultimo blocco, mai l'intero log — niente raffiche di toast.
    const seenIdx = lastSeenId == null ? -1 : log.findIndex((e) => e.id === lastSeenId);
    const newEntries = seenIdx >= 0 ? log.slice(seenIdx + 1) : log.slice(-1);
    const surgeEntry = newEntries.find((e) => e.tag === 'SPIDERSENSE');
    if (surgeEntry) {
      pushToast(surgeEntry.message, 'success');
      audio.playSpiderSenseUnlock();
      setSpiderSenseSurgeAt(Date.now());
    }
    lastSeenLogIdRef.current = log[log.length - 1].id;
  }, [state.combatLog, pushToast, audio, hydrationEpoch]);

  // Heartbeat temporale: lo Spider-Sense Engine dipende dal giorno solare
  // corrente (nextReviewDate <= oggi), non solo dallo stato applicativo.
  // Senza questo tick, una sessione lasciata aperta a cavallo di
  // mezzanotte mostrerebbe conteggi "in sospeso" non aggiornati finché
  // l'utente non compie un'azione qualsiasi.
  useEffect(() => {
    const id = setInterval(() => setNowTick((n) => n + 1), 60000);
    return () => clearInterval(id);
  }, []);

  // V37.0 — PRESTAZIONI: `evaluateTrophies` è una scansione completa di
  // profilo, materie, nodi e starLog, e girava DUE volte per ogni cambio
  // di stato — una in useAchievements e una dentro `derived`. Ora la
  // valutazione vive qui, una sola volta, con dipendenze strette: solo i
  // contatori che un trofeo può davvero leggere. Entrambi i consumatori
  // ricevono lo stesso risultato, che quindi non può nemmeno divergere.
  const evaluatedTrophies = useMemo(
    () => evaluateTrophies(state),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      state.profile,
      state.materie,
      state.starLog,
      state.trophies,
      state.inventory,
      state.gradeHistory
    ]
  );

  const unlockedTrophyIds = useMemo(
    () => new Set(state.trophies.map((t) => t.id)),
    [state.trophies]
  );

  // The Achievement Engine (V23.0, Modulo 3) — hook dedicato che ascolta
  // in background lo stato globale e sblocca i trofei da solo, con
  // fanfare tier-aware.
  useAchievements({ evaluated: evaluatedTrophies, unlockedIds: unlockedTrophyIds, dispatch, pushToast, audio });

  // "Il Cervello" della progressione (rank, XP bancato, toast di Level Up),
  // isolato in un custom hook dedicato.
  const progression = useProgression(state.profile, pushToast, audio, hydrationEpoch);

  // V25.0 — Pillar 3: effetti aggregati dello Skill Tree, ricalcolati SOLO
  // quando la lista di abilità sbloccate cambia (mai ad ogni render/XP
  // gain) — consumati sia qui (derived, per la UI) sia dentro il reducer
  // (che li ricalcola autonomamente da state.profile.unlockedSkills, per
  // restare puro e non dipendere da valori esterni memoizzati).
  const skillEffects = useMemo(
    () => computeSkillEffects(state.profile.unlockedSkills),
    [state.profile.unlockedSkills]
  );

  // V39.0 — La chiave del giorno corrente, come dipendenza ESPLICITA dei
  // calcoli che dipendono da "oggi". Il battito `nowTick` qui sopra
  // rilanciava solo `derived`, che però ricopiava valori già calcolati:
  // con l'app aperta a cavallo della mezzanotte i ripassi scaduti non
  // comparivano, la capacità non si aggiornava e Primary Target contava
  // un giorno in più della Quota Odierna. È una stringa: cambia una
  // volta al giorno, quindi non costa nulla tenerla nelle dipendenze.
  const dayKey = getDateKey();

  // "Il Cervello" dello Spider-Sense Engine (Spaced Repetition), isolato in
  // un custom hook dedicato.
  // V42 — le materie con la data della PROSSIMA prova (lo scritto, poi
  // l'orale) al posto di `examDate`: è la vista che ogni motore del piano
  // riceve (vedi utils/appelli.js#withPlanningDates).
  const materiePiano = useMemo(() => withPlanningDates(state.materie, dayKey), [state.materie, dayKey]);
  const spiderSense = useSpiderSense(materiePiano, dayKey);

  // V36.0 — "Karen impara da te": capacità giornaliera reale e fattore di
  // calibrazione delle stime, misurati sul TUO storico (utils/calibration.js)
  // e calcolati UNA volta sola qui, a livello di Provider. Da qui in giù
  // ogni motore (Quota Odierna, Spider-Score, Fine Prevista, Exam
  // Readiness) parte dagli stessi due numeri: nessun consumatore li
  // ricalcola per conto proprio, quindi non possono divergere.
  const calibration = useMemo(
    () => computeCalibration(state),
    // Dipendenze minime reali: la capacità viene dallo storico sessioni
    // (e dalla fase del semestre), il bias dai nodi completati, più le due
    // impostazioni del piano. `dayKey` perché la finestra è relativa a oggi.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.starLog, state.materie, state.campus, state.settings.capacitaManuale, state.settings.giorniRiposo, dayKey]
  );

  // V36.0 — la riduzione di carico consigliata dal Daily Brief smette di
  // essere un banner decorativo e diventa il moltiplicatore REALE del
  // budget di studio del giorno (vedi allocateDailyBudget).
  const karenLoadAdjustmentPct =
    karenBrain.directives && Number.isFinite(karenBrain.directives.mission_control?.load_adjustment_pct)
      ? karenBrain.directives.mission_control.load_adjustment_pct
      : 0;

  // V42 — il calendario accademico per il planner (fase e ore di lezione
  // di ogni giorno futuro).
  const calendar = useMemo(() => buildCampusCalendar(state.campus, state.materie), [state.campus, state.materie]);

  // V42 — il lavoro FATTO OGGI per materia, per tipo: il planner lo usa per
  // tenere fermi gli obiettivi di oggi mentre studi ("fatto 2h10 di 4h30").
  const { doneToday, doneKey, todayMinutesByMode } = useMemo(() => {
    const map = new Map();
    const perModo = { SINTESI: 0, STUDIO: 0, RIPASSO: 0, ESERCIZI: 0, ALTRO: 0 };
    const materieById = new Map(state.materie.map((m) => [m.id, m]));
    state.starLog.forEach((e) => {
      if (!e || e.type !== 'FOCUS_SESSION' || e.dateKey !== dayKey) return;
      const min = Number(e.minutes) || 0;
      const modo = perModo[e.workMode] != null ? e.workMode : 'ALTRO';
      perModo[e.simulazione ? 'ESERCIZI' : modo] += min;
      if (!e.materiaId) return;
      const d = map.get(e.materiaId) || { sintesi: 0, studio: 0, esercizi: 0, ripasso: 0, altro: 0 };
      const h = min / 60;
      const m = materieById.get(e.materiaId);
      const senzaNodi = !m || !Array.isArray(m.sfide) || m.sfide.length === 0;
      // Conta nel residuo solo ciò che il residuo ha davvero scalato:
      // il lavoro su un argomento (o su una materia senza argomenti).
      const suNodo = !!e.sfidaId || senzaNodi;
      if (e.simulazione) d.altro += h;
      else if (e.workMode === 'SINTESI') d.sintesi += h;
      else if (e.workMode === 'RIPASSO') d.ripasso += h;
      else if ((e.workMode === 'STUDIO' || e.workMode === 'ESERCIZI') && suNodo) d[e.workMode === 'ESERCIZI' ? 'esercizi' : 'studio'] += h;
      else d.altro += h;
      map.set(e.materiaId, d);
    });
    const key = [...map.entries()]
      .map(([id, d]) => `${id}:${Math.round((d.sintesi + d.studio + d.esercizi + d.ripasso + d.altro) * 60)}`)
      .join('|');
    return { doneToday: map, doneKey: key, todayMinutesByMode: perModo };
  }, [state.starLog, state.materie, dayKey]);

  // "Il Cervello" del K.A.R.E.N. Auto-Router / Quantum Router (V23.0,
  // Modulo 1): Daily Quota + status a 3 livelli per ogni Materia aperta,
  // isolato in un custom hook dedicato.
  // V39.0 — "Empire State University": fase (lezioni/sessione), lezioni
  // di oggi, prossima lezione, coda post-lezione e passo settimanale.
  // Ricalcolato col battito di un minuto (`nowTick`) perché dipende
  // dall'ora: una lezione passa da "in corso" a "da sistemare" alle
  // 11:00, non al prossimo salvataggio.
  const campusSnapshot = useMemo(
    () => computeCampusSnapshot(state.campus, new Date(), state.materie, state.starLog, { ritmoSintesi: calibration.sintesiPagesPerHourRaw }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.campus, state.materie, state.starLog, nowTick, calibration.sintesiPagesPerHourRaw]
  );

  // V40.0 — la sintesi delle lezioni davvero da sistemare entra nel piano
  // come riserva di tempo limitata (mai uno slot rubato a un esame).
  const sintesiLezioni = useMemo(() => {
    if (campusSnapshot.fase !== FASE.LEZIONI || campusSnapshot.coda.length === 0) return null;
    return campusSnapshot.coda.map((l) => ({ materiaId: l.materiaId, ore: (l.sintesiMancanteMin || 0) / 60 }));
  }, [campusSnapshot]);

  const karenAutoRouter = useKarenAutoRouter(materiePiano, {
    calibration,
    loadAdjustmentPct: karenLoadAdjustmentPct,
    sintesiLezioni,
    lessonPhase: campusSnapshot.fase === FASE.LEZIONI,
    calendar,
    doneToday,
    doneKey
  });

  // Karen's Tactical Suggestor (Primary Target): ricalcolato qui, a
  // livello di Provider, così sia Mission Control (Daily Patrol HUD) sia
  // il Web-Matrix possono leggerlo da `derived` senza calcolarlo due volte
  // con risultati potenzialmente disallineati.
  // V39.0 — coincide con la prima materia in focus del planner (vedi
  // computePrimaryTarget): una sola risposta a "cosa faccio oggi".
  const focusTopId = karenAutoRouter.dailyFocusQuotas[0]?.materiaId ?? null;
  const primaryTarget = useMemo(
    () => computePrimaryTarget(materiePiano, calibration, focusTopId, karenAutoRouter.byMateriaId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [materiePiano, calibration, focusTopId, karenAutoRouter.byMateriaId, dayKey]
  );

  // V43 — la Readiness di OGGI (Suit Telemetry), solo se misurata: regola
  // quanto consuma la Stamina. Un briefing di ieri non conta.
  const staminaReadinessScore =
    karenBrain.readinessKnown && karenBrain.briefing && karenBrain.briefing.date === karenBrain.todayStr && Number.isFinite(Number(karenBrain.readinessScore))
      ? Number(karenBrain.readinessScore)
      : null;

  // V42 — il contesto del piano che accompagna ogni chiusura di sessione.
  useEffect(() => {
    timerCtxRef.current = {
      primaryTargetMateriaId: primaryTarget ? primaryTarget.materia.id : null,
      capacityHours: Number(calibration.hoursPerDay) > 0 ? Number(calibration.hoursPerDay) : 4.5,
      readinessScore: staminaReadinessScore,
      lessonMateriaIds: (campusSnapshot.coda || []).map((l) => l.materiaId)
    };
  }, [primaryTarget, calibration.hoursPerDay, staminaReadinessScore, campusSnapshot.coda]);

  // Daily Patrol Engine (V23.0, Modulo 2) — Rigenerazione giornaliera:
  // quando la dateKey persistita non corrisponde a "oggi" (primo avvio,
  // o giornata cambiata mentre l'app era chiusa/aperta a cavallo di
  // mezzanotte), genera un nuovo set di 3 missioni deterministico. Il
  // progresso da qui in poi è interamente event-driven (vedi reducer
  // sopra): questo effetto si occupa SOLO della rigenerazione giornaliera.
  // V42 — le missioni si scelgono sul contesto di OGGI: fase del
  // semestre, ripassi dovuti, lezioni da sistemare, esami con scritto,
  // obiettivo del piano (nessuna missione impossibile).
  const patrolCtx = useMemo(
    () => ({
      fase: campusSnapshot.fase,
      upcomingReviewsCount: spiderSense.upcomingReviews.length,
      reviewTargetCount: karenAutoRouter.reviews?.targetCount ?? spiderSense.upcomingReviews.length,
      hasLessonsToProcess: (campusSnapshot.coda || []).length > 0,
      hasSintesiWork: state.materie.some((m) => m && !m.examPassed && sintesiMateria(m).aperta),
      hasWrittenExam: materiePiano.some(
        (m) => m && !m.examPassed && m.examDate && haProvaScritta(m) && (daysUntilDateOnly(m.examDate) ?? -1) >= 0 && daysUntilDateOnly(m.examDate) <= 60
      ),
      hasUpcomingExam: materiePiano.some((m) => m && !m.examPassed && m.examDate && (daysUntilDateOnly(m.examDate) ?? -1) >= 0),
      hasPrimaryTarget: !!primaryTarget,
      todayTargetMinutes: Math.round((karenAutoRouter.today?.targetHours || 0) * 60)
    }),
    [campusSnapshot, spiderSense.upcomingReviews.length, karenAutoRouter, state.materie, materiePiano, primaryTarget]
  );
  useEffect(() => {
    const todayKey = getDateKey();
    if (!dataReady) return;
    if (!state.dailyPatrols || state.dailyPatrols.dateKey !== todayKey) {
      const quests = generateDailyQuests(todayKey, patrolCtx);
      dispatch({ type: 'GENERATE_DAILY_PATROLS', payload: { dateKey: todayKey, quests } });
    }
  }, [state.dailyPatrols, dayKey, dataReady, patrolCtx, dispatch]);

  // Daily Patrol Engine — Celebrazione: rileva le transizioni
  // isCompleted false -> true (edge-triggered, come i Trofei) per
  // scatenare la Toast + il suono di Quest Complete, e una "chicca"
  // narrativa extra quando TUTTE e 3 le missioni del giorno sono
  // completate nella stessa giornata ("Patrol Perfetta").
  const prevDailyQuestsRef = useRef(null);
  const patrolEpochRef = useRef(0);
  useEffect(() => {
    const quests = state.dailyPatrols?.quests;
    if (!Array.isArray(quests)) return;
    const prevQuests = prevDailyQuestsRef.current;
    // V41 — missioni già completate prima del caricamento: nessuna
    // fanfara a ogni riavvio dell'app.
    if (patrolEpochRef.current !== hydrationEpoch || prevQuests === null) {
      patrolEpochRef.current = hydrationEpoch;
      prevDailyQuestsRef.current = quests;
      return;
    }

    quests.forEach((q) => {
      const prevQ = Array.isArray(prevQuests) ? prevQuests.find((p) => p.id === q.id) : null;
      if (q.isCompleted && (!prevQ || !prevQ.isCompleted)) {
        pushToast(`Daily Patrol completata: ${q.title} · +${q.xpReward} XP`, 'success');
        audio.playQuestComplete();
      }
    });

    const allDoneNow = quests.length > 0 && quests.every((q) => q.isCompleted);
    const wasAllDoneBefore = Array.isArray(prevQuests) && prevQuests.length > 0 && prevQuests.every((q) => q.isCompleted);
    if (allDoneNow && !wasAllDoneBefore) {
      pushToast('Karen: Patrol perfetta. Prenditi un caffè, te lo sei guadagnato.', 'success');
      audio.playLevelUpChime();
    }

    prevDailyQuestsRef.current = quests;
  }, [state.dailyPatrols, pushToast, audio, hydrationEpoch]);

  const actions = useMemo(
    () => ({
      updateProfile: (patch) => dispatch({ type: 'UPDATE_PROFILE', payload: patch }),
      updateSettings: (patch) => dispatch({ type: 'UPDATE_SETTINGS', payload: patch }),
      // V42 — niente doppioni: lo dice subito, invece di aggiungere di nuovo
      // Analisi 1 (12 CFU in più nella stima di laurea).
      addMateria: (payload) => {
        const doppione = findDuplicateMateria(stateRef.current.materie, { courseId: payload?.courseId || null, nome: payload?.nome || '' });
        if (doppione) {
          pushToast(`"${doppione.nome}" è già nel Web-Matrix.`, 'danger');
          return { ok: false, duplicate: doppione };
        }
        dispatch({ type: 'ADD_MATERIA', payload });
        return { ok: true };
      },
      // V42 — esito di un appello (superato / non superato / in attesa).
      setAppelloEsito: (materiaId, appelloId, esito, extra = {}) =>
        dispatch({ type: 'SET_APPELLO_ESITO', payload: { materiaId, appelloId, esito, ...extra } }),
      addSimulazione: (materiaId, simulazione) => dispatch({ type: 'ADD_SIMULAZIONE', payload: { materiaId, simulazione } }),
      logEsercizi: (materiaId, sfidaId, fatti, corretti) => dispatch({ type: 'LOG_ESERCIZI', payload: { materiaId, sfidaId, fatti, corretti } }),
      quizResult: (materiaId, sfidaId, esito) => {
        dispatch({ type: 'QUIZ_RESULT', payload: { materiaId, sfidaId, ...esito } });
        audio.playSuccessChime();
      },
      // V42 — "Chiudi la giornata" e piano di domani.
      closeDay: (payload) => dispatch({ type: 'CLOSE_DAY', payload }),
      saveTomorrowPlan: (plan) => dispatch({ type: 'SAVE_TOMORROW_PLAN', payload: { plan } }),
      markTomorrowPlanStarted: () => dispatch({ type: 'MARK_TOMORROW_PLAN_STARTED' }),
      saveKarenWeekly: (weekKey, payload, meta = {}) =>
        dispatch({ type: 'SAVE_KAREN_WEEKLY', payload: { weekKey, payload, generatedAt: meta.generatedAt, weekClosed: meta.weekClosed } }),
      // V42 — Maximum Carnage si attiva a mano, con una carica, di giorno.
      activateMaxCarnage: () => {
        const p = stateRef.current.profile;
        if (!(Number(p.carnageCharges) > 0)) {
          pushToast('Nessuna carica: servono 5 azioni critiche nella stessa giornata.', 'info');
          return false;
        }
        if (!isCarnageHour()) {
          pushToast('Il simbionte dorme fra le 23 e le 6: attivalo di giorno.', 'info');
          return false;
        }
        dispatch({ type: 'ACTIVATE_MAX_CARNAGE' });
        return true;
      },
      // V42 — "Ricomincio da zero" su una materia, con Annulla.
      ricostruisciMateria: (materiaId, opzioni = {}) => {
        const prima = findMateria(stateRef.current, materiaId);
        if (!prima) return;
        dispatch({ type: 'RICOSTRUISCI_MATERIA', payload: { materiaId, rifaiAppunti: !!opzioni.rifaiAppunti } });
        pushToast(`${prima.nome}: ricostruzione da zero avviata.`, 'info', {
          duration: 10000,
          action: { label: 'Annulla', onClick: () => dispatch({ type: 'REPLACE_MATERIA', payload: { materia: prima } }) }
        });
      },
      updateMateria: (id, patch) => dispatch({ type: 'UPDATE_MATERIA', payload: { id, patch } }),
      // V41 — eliminare una materia si può annullare: la notifica offre
      // "Annulla" per qualche secondo (ripristino mirato, vedi
      // RESTORE_MATERIA nel reducer) e prima di eliminare si salva una
      // copia di sicurezza locale (Karen OS Settings → Backup).
      deleteMateria: (id) => {
        const prev = stateRef.current;
        const list = Array.isArray(prev.materie) ? prev.materie : [];
        const index = list.findIndex((m) => m && m.id === id);
        if (index < 0) return;
        const materia = list[index];
        const lezioni = [];
        (Array.isArray(prev.campus?.semestri) ? prev.campus.semestri : []).forEach((sem) => {
          (Array.isArray(sem?.lezioni) ? sem.lezioni : []).forEach((lezione) => {
            if (lezione && lezione.materiaId === id) lezioni.push({ semestreId: sem.id, lezione });
          });
        });
        saveSnapshot(user.id, prev, { reason: SNAPSHOT_REASON.PRE_DELETE, label: materia.nome }).catch(() => undefined);
        dispatch({ type: 'DELETE_MATERIA', payload: { id } });
        pushToast(`"${materia.nome}" eliminata.`, 'info', {
          duration: 9000,
          action: {
            label: 'Annulla',
            onClick: () => dispatch({ type: 'RESTORE_MATERIA', payload: { materia, index, lezioni } })
          }
        });
      },
      addSfida: (materiaId, payload) => dispatch({ type: 'ADD_SFIDA', payload: { materiaId, ...payload } }),
      updateSfida: (materiaId, sfidaId, patch) => dispatch({ type: 'UPDATE_SFIDA', payload: { materiaId, sfidaId, patch } }),
      // V31.2 — Pillar 2 (Robust State & Supabase Sync): salvataggio
      // dedicato dell'Editor di Personalizzazione Nodo. Il Context globale
      // viene aggiornato PRIMA di ogni round-trip di rete (dispatch
      // sincrono via reducer) cosi' la UI riflette il nodo modificato
      // istantaneamente, senza sfarfallio ne' attesa del debounce di
      // autosave da 2.5s usato altrove. Subito dopo, esegue una query di
      // update mirata alla riga Cloud dell'utente (unica chiave reale
      // dello schema JSONB `user_data`), incorporando SOLO la patch del
      // nodo appena modificato dentro `app_state.materie[].sfide[]`,
      // individuato dal suo identificativo unico (sfidaId). Ritorna una
      // Promise { success, error } così il chiamante può pilotare il
      // proprio feedback di salvataggio/errore in tempo reale.
      updateSfidaAndSync: async (materiaId, sfidaId, patch, opts = {}) => {
        // V44 — `noteFonte: 'IA'` quando gli appunti arrivano dall'IA esterna (registro del nodo).
        const action = { type: 'UPDATE_SFIDA', payload: { materiaId, sfidaId, patch, noteFonte: opts && opts.noteFonte === 'IA' ? 'IA' : null } };
        dispatch(action);
        // V40.0 — lo stato da salvare subito è quello che produce il
        // reducer stesso (con `sintesiAggiornataAt` e ogni altra regola),
        // non una fusione fatta a mano che poteva divergere.
        const nextState = reducer(stateRef.current, action);

        // V39 — il salvataggio immediato passa dalla STESSA coda
        // dell'autosave (flushSave → runPersist). Prima scriveva
        // direttamente con un update senza condizione e senza aggiornare
        // il token di versione: il successivo autosave trovava la riga
        // "cambiata" e mostrava il conflitto fra dispositivi anche con un
        // solo PC acceso — a OGNI salvataggio dall'editor di un nodo.
        if (!cloudReadyRef.current) return { success: true };
        pendingStateRef.current = nextState;
        const ok = await flushSave();
        return ok
          ? { success: true }
          : { success: false, error: new Error(conflictActiveRef.current ? 'Conflitto di sincronizzazione' : 'Salvataggio non riuscito') };
      },
      // V41 — anche gli argomenti eliminati (uno o in blocco) si
      // recuperano con "Annulla" dalla notifica (RESTORE_SFIDE).
      deleteSfida: (materiaId, sfidaId) => {
        const undo = captureSfideRemoval(stateRef.current, materiaId, [sfidaId]);
        dispatch({ type: 'DELETE_SFIDA', payload: { materiaId, sfidaId } });
        if (undo) {
          pushToast(`"${undo.removed[0].sfida.nome}" eliminato.`, 'info', {
            duration: 9000,
            action: { label: 'Annulla', onClick: () => dispatch({ type: 'RESTORE_SFIDE', payload: undo }) }
          });
        }
      },
      // V39.0 — Empire State University (vedi utils/campusEngine.js).
      campusAddSemestre: (payload) => dispatch({ type: 'CAMPUS_ADD_SEMESTRE', payload }),
      campusUpdateSemestre: (id, patch) => dispatch({ type: 'CAMPUS_UPDATE_SEMESTRE', payload: { id, patch } }),
      campusDeleteSemestre: (id) => dispatch({ type: 'CAMPUS_DELETE_SEMESTRE', payload: { id } }),
      campusSaveLezione: (semestreId, lezione) => dispatch({ type: 'CAMPUS_SAVE_LEZIONE', payload: { semestreId, lezione } }),
      campusDeleteLezione: (semestreId, id) => dispatch({ type: 'CAMPUS_DELETE_LEZIONE', payload: { semestreId, id } }),
      campusToggleSospensione: (semestreId, dateKey) =>
        dispatch({ type: 'CAMPUS_TOGGLE_SOSPENSIONE', payload: { semestreId, dateKey } }),
      campusSetOverride: (fase, finoA) => dispatch({ type: 'CAMPUS_SET_OVERRIDE', payload: fase ? { fase, finoA } : null }),
      campusSetRapporto: (value) => dispatch({ type: 'CAMPUS_SET_RAPPORTO', payload: { value } }),
      // V40.0 — "Fatta" / "Niente da sistemare" / annulla (esito null).
      campusSetEsito: (lezioni, esito) => dispatch({ type: 'CAMPUS_SET_ESITO', payload: { lezioni, esito } }),
      // V34.2 — "Selezione Multipla Nodi": eliminazione in blocco dal
      // pannello di selezione del Web-Matrix (QuadrantHub.jsx). `sfidaIds`
      // è un array semplice (mai un Set: i reducer restano serializzabili,
      // coerente col resto dell'app che finisce su Supabase come JSONB).
      bulkDeleteSfide: (materiaId, sfidaIds) => {
        const undo = captureSfideRemoval(stateRef.current, materiaId, sfidaIds);
        // V44 — un'eliminazione grossa (anche tutto lo Skill Tree in un
        // colpo) lascia un punto di ripristino: l'"Annulla" del messaggio
        // dura pochi secondi, la copia resta.
        if (undo && undo.removed.length >= BULK_DELETE_SNAPSHOT_MIN) {
          const m = findMateria(stateRef.current, materiaId);
          saveSnapshot(user.id, stateRef.current, {
            reason: SNAPSHOT_REASON.PRE_DELETE,
            label: `${undo.removed.length} argomenti${m ? ` · ${m.nome}` : ''}`
          }).catch(() => undefined);
        }
        dispatch({ type: 'BULK_DELETE_SFIDE', payload: { materiaId, sfidaIds } });
        if (undo) {
          const n = undo.removed.length;
          pushToast(n === 1 ? `"${undo.removed[0].sfida.nome}" eliminato.` : `${n} argomenti eliminati.`, 'info', {
            duration: 9000,
            action: { label: 'Annulla', onClick: () => dispatch({ type: 'RESTORE_SFIDE', payload: undo }) }
          });
        }
      },
      completeSfida: (materiaId, sfidaId) => {
        // Level Up Chime per i Nodi Padre ("Boss" dello Skill Tree, cioè
        // nodi che hanno almeno un sotto-argomento agganciato): un arpeggio
        // più ricco del Success Chime standard, coerente col peso di aver
        // appena sconfitto un intero "Boss" di argomenti collegati.
        const materia = findMateria(stateRef.current, materiaId);
        const target = materia ? materia.sfide.find((s) => s.id === sfidaId) : null;
        // V41 — stesso controllo del reducer, fatto prima: un nodo
        // bloccato (o già completato) non suona più il chime di un
        // completamento che non avviene.
        const status = target ? deriveNodeStatus(target, materia.sfide) : null;
        if (status !== NODE_STATUS.AVAILABLE && status !== NODE_STATUS.IN_PROGRESS) return false;
        const isBossNode = materia.sfide.some((s) => s.parentId === sfidaId);
        dispatch({ type: 'COMPLETE_SFIDA', payload: { materiaId, sfidaId } });
        if (isBossNode) audio.playLevelUpChime();
        else audio.playSuccessChime();
        return true;
      },
      reviewSfida: (materiaId, sfidaId, rating, source = 'MANUALE') => {
        dispatch({ type: 'REVIEW_SFIDA', payload: { materiaId, sfidaId, rating, source } });
        audio.playSuccessChime();
      },
      // V34.4 — Undo di un Nodo completato per errore: nessun fanfare di
      // successo qui, solo un click neutro (non è né una ricompensa né una
      // penalità, semplice correzione di stato).
      reopenSfida: (materiaId, sfidaId) => {
        dispatch({ type: 'REOPEN_SFIDA', payload: { materiaId, sfidaId } });
        audio.playWebClick();
      },
      applyQuickQuest: (questId) => dispatch({ type: 'APPLY_QUICK_QUEST', payload: { questId } }),
      addQuickQuest: (nome, staminaReward, xpReward) => dispatch({ type: 'ADD_QUICK_QUEST', payload: { nome, staminaReward, xpReward } }),
      deleteQuickQuest: (id) => dispatch({ type: 'DELETE_QUICK_QUEST', payload: { id } }),
      addShopReward: (nome, costoXp) => dispatch({ type: 'ADD_SHOP_REWARD', payload: { nome, costoXp } }),
      deleteShopReward: (id) => dispatch({ type: 'DELETE_SHOP_REWARD', payload: { id } }),
      // V41 — il toast di conferma solo se il riscatto passa davvero:
      // prima diceva "ACQUISTATO" anche quando il reducer lo rifiutava
      // per saldo insufficiente.
      redeemShopReward: (id, nome) => {
        const reward = (Array.isArray(stateRef.current.shopRewards) ? stateRef.current.shopRewards : []).find((r) => r.id === id);
        if (!reward) return false;
        if (computeTotalBankedXp(stateRef.current.profile) < reward.costoXp) {
          pushToast(`XP insufficienti per "${reward.nome || nome}".`, 'danger');
          return false;
        }
        dispatch({ type: 'REDEEM_SHOP_REWARD', payload: { id } });
        pushToast(`Riscattata: ${reward.nome || nome}. La trovi nell'inventario.`, 'success');
        return true;
      },
      consumeInventoryItem: (id) => dispatch({ type: 'CONSUME_INVENTORY_ITEM', payload: { id } }),
      unlockSkill: (skillId) => {
        const def = getSkillDef(skillId);
        const unlockedSkills = Array.isArray(stateRef.current.profile.unlockedSkills) ? stateRef.current.profile.unlockedSkills : [];
        if (!def || !canUnlockSkill(def, unlockedSkills, stateRef.current.profile.techTokens || 0)) return;
        dispatch({ type: 'UNLOCK_SKILL', payload: { skillId } });
        pushToast(`Abilità sbloccata: ${def.title}.`, 'success');
        audio.playSkillUnlock();
      },
      bossFightResult: (payload) => {
        dispatch({ type: 'BOSS_FIGHT_RESULT', payload });
        pushToast(payload.win ? 'Supercriminale sconfitto: XP accreditati.' : 'Game over: nessun XP questa volta.', payload.win ? 'success' : 'danger');
        if (payload.win) audio.playLevelUpChime();
      },
      // V33.1 — Sinister Six Gauntlet: chiamata UNA sola volta da
      // BossFight.jsx alla vittoria sul sesto Villain di una run pulita.
      // Nessun payload: il reducer si limita a incrementare il contatore
      // lifetime, tutta l'XP/HP/starLog della run è già gestita round per
      // round dalle chiamate a bossFightResult già in corso.
      completeGauntlet: () => dispatch({ type: 'GAUNTLET_CLEARED' }),
      lastStandSacrifice: () => {
        dispatch({ type: 'LAST_STAND_SACRIFICE' });
        pushToast('Last Stand: sei sopravvissuto con 1 HP.', 'danger');
      },
      logEvent: (message, tag) => dispatch({ type: 'LOG_EVENT', payload: { message, tag } }),
      // V41 — import e reset sostituiscono l'intero profilo: prima si
      // mette da parte un punto di ripristino (utils/localBackups.js), poi
      // si passa dall'idratazione, così nessun effetto scambia i dati
      // importati per traguardi appena raggiunti.
      importProfile: (rawObj) => {
        const validation = validateImportedProfile(rawObj);
        if (!validation.valid) return validation;
        saveSnapshot(user.id, stateRef.current, { reason: SNAPSHOT_REASON.PRE_IMPORT });
        const next = reducer(stateRef.current, { type: 'IMPORT_PROFILE', payload: hydrateState(rawObj) });
        hydrate(next);
        return { valid: true };
      },
      resetProfile: () => {
        saveSnapshot(user.id, stateRef.current, { reason: SNAPSHOT_REASON.PRE_RESET });
        hydrate(reducer(stateRef.current, { type: 'RESET_PROFILE' }));
      },
      /** V41 — punto di ripristino creato a mano (Karen OS Settings → Backup). */
      createSnapshot: (label = '') => saveSnapshot(user.id, stateRef.current, { reason: SNAPSHOT_REASON.MANUAL, label }),
      // V41 — elenco, lettura ed eliminazione dei punti di ripristino
      // locali (Karen OS Settings → Backup).
      listSnapshots: () => listLocalSnapshots(user.id),
      readSnapshot: (id) => readLocalSnapshot(id),
      deleteSnapshot: (id) => deleteLocalSnapshot(id),
      /** V41 — ripristina un punto salvato su questo dispositivo. */
      restoreSnapshot: async (snapshotState) => {
        const validation = validateImportedProfile(snapshotState);
        if (!validation.valid) return validation;
        await saveSnapshot(user.id, stateRef.current, { reason: SNAPSHOT_REASON.PRE_RESTORE });
        const next = reducer(stateRef.current, { type: 'IMPORT_PROFILE', payload: hydrateState(snapshotState) });
        hydrate({ ...next, combatLog: next.combatLog.map((e, i, arr) => (i === arr.length - 1 ? { ...e, message: 'Profilo ripristinato da un punto di ripristino locale.' } : e)) });
        return { valid: true };
      },
      // V27.0 — Pillar 4 (Daily Web-Sling): il roll pesato avviene QUI
      // (fuori dal reducer, che resta puro) — un solo claim al giorno,
      // guardia esplicita anche a livello di action creator così una UI
      // disattenta (o un doppio tap rapidissimo) non può mai innescare due
      // roll per lo stesso giorno. Ritorna il tier estratto così il
      // componente chiamante (WebSlingChest) può orchestrare l'animazione
      // di apertura sul risultato reale, mai un placeholder ottimistico.
      claimWebSling: () => {
        if (!canClaimWebSling(stateRef.current.profile)) return null;
        const pityCounter = Number.isFinite(stateRef.current.profile.webSlingPityCounter) ? stateRef.current.profile.webSlingPityCounter : 0;
        const { tier, pityTriggered } = rollWebSlingRewardWithPity(pityCounter);
        dispatch({ type: 'WEB_SLING_CLAIM', payload: { tier, pityTriggered } });
        audio.playChestOpen();
        return tier;
      },
      // V27.0 — Pillar 2 (AI Index Matrix): importazione bulk di un
      // sotto-albero già validato/normalizzato da createSfideTreeFromAiIndex
      // (parsing/validazione vivono interamente in aiIndexParser.js, mai
      // nel reducer). Ritorna l'esito così la modale può mostrare l'errore
      // o chiudersi con un toast di successo.
      // V44 — appunti preparati da un'IA esterna (utils/aiNotes.js), più
      // argomenti in un colpo. Punto di ripristino se si sovrascrive del
      // testo esistente, e "Annulla" dal messaggio.
      importAiNotes: (materiaId, blocchi, mode = NOTE_MODE.SOSTITUISCI) => {
        const materia = findMateria(stateRef.current, materiaId);
        if (!materia || !Array.isArray(blocchi) || blocchi.length === 0) return { count: 0 };
        const byId = new Map(materia.sfide.map((s) => [s.id, s]));
        const entries = [];
        const prima = [];
        blocchi.forEach((b) => {
          const s = b && byId.get(b.sfidaId);
          if (!s) return;
          const note = mergeNote(s.note, b.note, mode);
          if (note === (typeof s.note === 'string' ? s.note.trim() : '')) return;
          entries.push({ sfidaId: s.id, note });
          prima.push({ sfidaId: s.id, note: typeof s.note === 'string' ? s.note : '', noteAggiornataAt: s.noteAggiornataAt || null });
        });
        if (entries.length === 0) {
          pushToast('Niente da aggiornare: gli appunti sono già questi.', 'info');
          return { count: 0 };
        }
        if (prima.some((p) => p.note.trim())) {
          saveSnapshot(user.id, stateRef.current, { reason: SNAPSHOT_REASON.PRE_IMPORT, label: `Appunti IA · ${materia.nome}` }).catch(() => undefined);
        }
        const at = new Date().toISOString();
        dispatch({ type: 'IMPORT_NOTE_IA', payload: { materiaId, entries, at } });
        pushToast(`Appunti salvati in ${entries.length} ${entries.length === 1 ? 'argomento' : 'argomenti'}.`, 'success', {
          duration: 9000,
          action: { label: 'Annulla', onClick: () => dispatch({ type: 'RESTORE_NOTE_IA', payload: { materiaId, entries: prima, at } }) }
        });
        audio.playDataImport();
        return { count: entries.length };
      },
      bulkImportSkillTree: (materiaId, parsedNodes) => {
        const result = createSfideTreeFromAiIndex(parsedNodes);
        if (!result.valid) return result;
        dispatch({ type: 'BULK_IMPORT_SFIDE', payload: { materiaId, sfide: result.sfide } });
        // V41 — un indice sbagliato (materia sbagliata, capitoli doppi) si
        // toglie con un click, invece che selezionando decine di nodi.
        const importedIds = result.sfide.map((sf) => sf.id);
        pushToast(
          `AI Index Matrix: ${result.sfide.length} ${result.sfide.length === 1 ? 'argomento importato' : 'argomenti importati'}.`,
          'success',
          {
            duration: 9000,
            action: {
              label: 'Annulla',
              onClick: () => dispatch({ type: 'BULK_DELETE_SFIDE', payload: { materiaId, sfidaIds: importedIds } })
            }
          }
        );
        audio.playDataImport();
        return { valid: true, count: result.sfide.length };
      },
      // V28.1 — Pillar 2: Secure Admin Override. La validazione della
      // passphrase vive interamente in `utils/adminOverride.js` (unico
      // punto di verità) — qui ci si limita a reagire all'esito. Il
      // congelamento dello snapshot Cloud avviene PRIMA di attivare il
      // flag: l'effetto di boot (sopra) lo troverà già pronto al render
      // successivo, per un eventuale primo ingresso in Sandbox "a copia".
      activateSandbox: (password) => {
        if (!validateAdminPassphrase(password)) {
          pushToast('Karen: passphrase di override non riconosciuta. Accesso Admin negato.', 'danger');
          audio.playAccessDenied();
          return { valid: false };
        }
        cloudSnapshotRef.current = stateRef.current;
        setSandboxActive(true);
        pushToast('Protocollo Admin attivo: stai usando la Sandbox.', 'info');
        audio.playAccessGranted();
        return { valid: true };
      },
      // Ritorno al profilo standard: SOLO un flip di flag — lo snapshot
      // Cloud congelato all'ingresso resta la fonte per il prossimo
      // HYDRATE (effetto di boot), mai un nuovo fetch di rete necessario.
      deactivateSandbox: () => {
        setSandboxActive(false);
        pushToast('Sandbox disattivata: profilo Cloud ripristinato.', 'info');
        audio.playWebClick();
      },
      // V35.0 — K.A.R.E.N. Daily Brain: bookkeeping silenzioso, lato
      // Cloud State, dell'aderenza alla readiness biometrica (Sala
      // Trofei). Dispatchata dal componente-ponte KarenTrophyBridge —
      // mai un'azione visibile/rumorosa (nessun toast, nessun suono).
      logReadinessSnapshot: (dateKey, band) => dispatch({ type: 'LOG_READINESS_SNAPSHOT', payload: { dateKey, band } }),
      // V26.0 — Pillar 2: Logout dal Nexus Gate (o uscita dalla Modalità
      // Ospite — stesso ingresso unico, vedi AuthContext.signOut). Non
      // serve pulire lo stato qui: smontando ArachnoForgeProvider (App.jsx
      // reagisce a session === null && !isGuest) l'intero albero di stato
      // in memoria sparisce da solo, e i dati restano al sicuro sul
      // rispettivo backend (Cloud o locale) per il prossimo accesso. Uscire
      // da una Sandbox attiva torna sempre al profilo Cloud per pulizia.
      // V37.0 — Risoluzione di un conflitto fra dispositivi. Due sole
      // scelte, entrambe esplicite: nessuna fusione automatica di due
      // `app_state` (produrrebbe un profilo che non è mai esistito né
      // qui né là, ed è esattamente il tipo di magia che fa perdere
      // fiducia in un sistema di sincronizzazione).
      resolveConflictKeepLocal: async () => {
        // V41 — la versione dell'altro dispositivo, che sta per essere
        // sovrascritta, resta recuperabile da Backup.
        if (cloudConflictRef.current?.remoteState) {
          saveSnapshot(user.id, cloudConflictRef.current.remoteState, {
            reason: SNAPSHOT_REASON.PRE_CONFLICT,
            label: 'Versione dell’altro dispositivo'
          });
        }
        conflictActiveRef.current = false;
        setCloudConflict(null);
        setSyncStatus('syncing');
        try {
          // Si rilegge il token corrente e si scrive con quello: è una
          // sovrascrittura voluta, non una condizione persa.
          const { data } = await supabase
            .from(USER_DATA_TABLE)
            .select('updated_at')
            .eq('user_id', user.id)
            .maybeSingle();
          remoteVersionRef.current = data?.updated_at || null;
          const result = await runPersist({ force: true });
          if (result && result.conflict) {
            await enterConflictState(result.remote);
            return;
          }
          setSyncStatus('synced');
        } catch (err) {
          console.error('[ArachnoForge] Sovrascrittura del conflitto fallita.', err);
          setSyncStatus('error');
        }
      },
      resolveConflictTakeRemote: (remoteState, remoteUpdatedAt) => {
        // V41 — e il lavoro di questo dispositivo, che sta per essere
        // scartato, anche.
        saveSnapshot(user.id, stateRef.current, {
          reason: SNAPSHOT_REASON.PRE_CONFLICT,
          label: 'Versione di questo dispositivo'
        });
        conflictActiveRef.current = false;
        remoteVersionRef.current = remoteUpdatedAt || null;
        clearCloudCheckpoint(user.id, storageMode);
        if (remoteState) {
          const hydrated = hydrateState(remoteState);
          baseRemoteStateRef.current = remoteState;
          lastPersistedRef.current = hydrated;
          skipNextSaveRef.current = true;
          hydrate(hydrated);
        }
        setCloudConflict(null);
        setSyncStatus('synced');
      },
      // V37.0 — il logout ATTENDE il salvataggio. Prima smontava il
      // Provider all'istante, e il cleanup dell'effetto di autosave
      // cancellava il timer pendente: fino a 2,5 secondi di lavoro
      // sparivano senza un avviso. Ora si forza la scrittura e solo dopo
      // si chiude la sessione; se fallisce, il checkpoint locale resta al
      // suo posto e verrà recuperato al prossimo accesso.
      signOut: async () => {
        await flushSave();
        setSandboxActive(false);
        await authSignOut();
      }
    }),
    // storageMode/user entrano nelle dipendenze per via di updateSfidaAndSync
    // (V31.2, Pillar 2), che li legge in chiusura per decidere backend
    // Cloud vs locale — evita una closure "stale" se l'utente attiva/esce
    // dalla Sandbox mentre l'editor di un nodo è aperto.
    // V37.0 — `user.id` al posto di `user`: l'oggetto user viene
    // ricreato da Supabase ad ogni refresh del token (circa ogni ora),
    // e con esso l'intero oggetto `actions` — proprio quello che il
    // commento qui sopra dichiara stabile, e su cui si appoggiano
    // useCallback/useEffect di più pagine. L'id è la sola cosa che
    // `updateSfidaAndSync` legge davvero.
    [pushToast, audio, authSignOut, storageMode, user.id, flushSave, runPersist, enterConflictState, hydrate]
  );

  const derived = useMemo(() => {
    const fatigued = state.profile.stamina < FATIGUE_STAMINA_THRESHOLD;
    // Il "prossimo esame" è la prossima PROVA nel futuro di una materia non
    // superata (V42: dopo lo scritto, l'orale dello stesso appello).
    const upcomingExams = materiePiano
      .filter((m) => m && m.examDate && !m.examPassed && (daysUntilDateOnly(m.examDate) ?? -1) >= 0)
      .sort((a, b) => a.examDate.localeCompare(b.examDate));
    const nextExam = upcomingExams[0] || null;

    // V42 — la Traiettoria guarda TUTTI gli esami dei prossimi 30 giorni
    // (prima solo il prossimo: un esame critico al secondo posto restava
    // "verde" in Sidebar).
    let trajectory = 'GREEN';
    upcomingExams
      .filter((m) => (daysUntilDateOnly(m.examDate) ?? 99) <= 30)
      .forEach((m) => {
        const q = karenAutoRouter.byMateriaId.get(m.id);
        if (q?.status === 'CRITICO') trajectory = 'RED';
        else if (q?.status === 'ATTENZIONE' && trajectory !== 'RED') trajectory = 'YELLOW';
      });

    const unlockedAtById = new Map(state.trophies.map((r) => [r.id, r.unlockedAt]));
    const trophyList = evaluatedTrophies.map((t) => ({
      ...t,
      unlockedAt: unlockedAtById.get(t.id) || null
    }));

    // V31.3 — Bounty Board (Friction Analytics). V42 — solo materie ancora
    // da sostenere: un esame superato non ha più "argomenti che ti costano".
    const bountyTargets = state.materie
      .filter((m) => m && !m.examPassed)
      .flatMap((m) => (Array.isArray(m.sfide) ? m.sfide : []).map((s) => ({ materia: m, sfida: s })))
      .filter(({ sfida }) => (sfida.tentativiSuccessi || 0) + (sfida.tentativiFalliti || 0) >= 3 && isBountyTarget(sfida))
      .map(({ materia, sfida }) => ({
        materiaId: materia.id,
        materiaNome: materia.nome,
        sfidaId: sfida.id,
        sfidaNome: sfida.nome,
        friction: computeFriction(sfida.tentativiSuccessi, sfida.tentativiFalliti)
      }))
      .sort((a, b) => b.friction - a.friction)
      .slice(0, 5);

    const todayKey = dayKey;
    const todayMinutes = state.starLog
      .filter((e) => e.type === 'FOCUS_MINUTES' && e.dateKey === todayKey)
      .reduce((sum, e) => sum + e.minutes, 0);
    // V42 — il rischio burnout si misura sulla TUA giornata: oltre una volta
    // e mezza la capacità (mai sotto le 5 ore).
    const capacityMin = Math.round((Number(calibration.hoursPerDay) || 4.5) * 60);
    const burnoutThresholdMin = Math.max(BURNOUT_MINUTES_THRESHOLD, Math.round(capacityMin * 1.5));
    const burnoutRisk = todayMinutes > burnoutThresholdMin;

    // V36.0/V42 — EXAM READINESS: sui pilastri veri (copertura di studio,
    // memoria, pratica, piano globale).
    const radarByMateriaId = new Map(spiderSense.memoryRadar.byMateria.map((r) => [r.materiaId, r]));
    const examReadinessByMateriaId = new Map(
      materiePiano
        .filter((m) => m && !m.examPassed)
        .map((m) => [
          m.id,
          computeExamReadiness(m, radarByMateriaId.get(m.id) || null, calibration, { planQuota: karenAutoRouter.byMateriaId.get(m.id) || null, todayKey })
        ])
    );
    const nextExamReadiness = nextExam ? examReadinessByMateriaId.get(nextExam.id) || null : null;

    // V38.0/V42 — piano di sintesi di ogni materia, con la data di chiusura
    // degli appunti del piano GLOBALE (tutte le materie insieme).
    const sintesiPlanByMateriaId = new Map(
      materiePiano
        .filter((m) => m && !m.examPassed)
        .map((m) => [m.id, materiaSintesiPlan(m, calibration, { chiusuraAppunti: karenAutoRouter.byMateriaId.get(m.id)?.chiusuraAppuntiDateKey })])
    );

    // V42 — la serie di studio, con i riposi della settimana.
    const streak = streakStatus(state.profile, { todayKey, todayMinutes, restDaysPerWeek: restAllowance(state.settings) });

    // V42 — appelli passati di cui registrare l'esito.
    const appelliDaChiudere = state.materie.map((m) => appelloDaChiudere(m, todayKey)).filter(Boolean);

    // V42 — il piano preparato ieri sera, e se oggi è già stata chiusa.
    const tomorrowPlanToday = state.tomorrowPlan && state.tomorrowPlan.dateKey === todayKey ? state.tomorrowPlan : null;
    const dayClosedToday = (state.dayClosures || []).some((c) => c.dateKey === todayKey);
    const weekKey = mondayOfDateKey(todayKey);

    // V42 — gli ingressi del planner, per gli scenari del Piano della
    // sessione ("e se spostassi questo appello?"): stessi numeri del piano vero.
    const planInputs = {
      calibration,
      loadAdjustmentPct: karenLoadAdjustmentPct,
      sintesiLezioni,
      lessonPhase: campusSnapshot.fase === FASE.LEZIONI,
      calendar,
      doneToday,
      todayKey
    };

    // V43 — quale tecnica di studio funziona per te (dai ripassi, dalle
    // interrogazioni e dagli esercizi dopo le sessioni in cui l'hai usata).
    const techniqueMemory = computeTechniqueMemory(state.materie);

    // V42 — il piano di oggi da consegnare a K.A.R.E.N. a ogni rigenerazione.
    const karenPlanContext = buildKarenPlanContext({
      planToday: karenAutoRouter.today,
      quotas: karenAutoRouter.quotas,
      materie: materiePiano,
      campus: campusSnapshot,
      streak,
      starLog: state.starLog,
      todayKey,
      techniqueMemory
    });

    return {
      techniqueMemory,
      fatigued,
      nextExam,
      upcomingExams,
      trajectory,
      trophyList,
      todayMinutes,
      todayMinutesByMode,
      burnoutRisk,
      burnoutThresholdMin,
      // Spider-Sense Engine — delegato a useSpiderSense.
      upcomingReviews: spiderSense.upcomingReviews,
      allTrackedReviews: spiderSense.allTrackedReviews,
      memoryRadar: spiderSense.memoryRadar,
      goblinMaterie: spiderSense.goblinMaterie,
      // Progressione — delegato a useProgression.
      totalBankedXp: progression.totalBankedXp,
      rankTitle: progression.rankTitle,
      rankMeta: progression.rankMeta,
      xpNeeded: progression.xpNeeded,
      xpPct: progression.xpPct,
      skillEffects,
      effectiveBloodPactPenalty: computeBloodPactPenalty(skillEffects.bloodPactReduction),
      // Il piano (V42: globale, vedi utils/studyPlanner.js).
      materiePiano,
      karenQuotas: karenAutoRouter.quotas,
      karenQuotaByMateriaId: karenAutoRouter.byMateriaId,
      karenEventHorizonList: karenAutoRouter.eventHorizonList,
      karenDailyFocusIds: karenAutoRouter.dailyFocusIds,
      karenMonotaskActive: karenAutoRouter.monotaskActive,
      karenDailyFocusQuotas: karenAutoRouter.dailyFocusQuotas,
      karenQueuedQuotas: karenAutoRouter.queuedQuotas,
      karenFrozenQuotas: karenAutoRouter.frozenQuotas,
      karenBudget: karenAutoRouter.budget,
      karenCumulativeOverload: karenAutoRouter.cumulativeOverload,
      karenSintesi: karenAutoRouter.sintesi,
      planToday: karenAutoRouter.today,
      planReviews: karenAutoRouter.reviews,
      planTimeline: karenAutoRouter.timeline,
      primaryTarget,
      isMaxCarnageActive: isMaxCarnageActive(state.profile),
      carnageCharges: Number(state.profile.carnageCharges) || 0,
      carnageCanActivate: (Number(state.profile.carnageCharges) || 0) > 0 && !isMaxCarnageActive(state.profile) && isCarnageHour(),
      canClaimWebSling: canClaimWebSling(state.profile),
      bountyTargets,
      karenAdaptiveTimerActive: !!karenFocusDirective,
      karenFocusDirective,
      calibration,
      examReadinessByMateriaId,
      sintesiPlanByMateriaId,
      campus: campusSnapshot,
      nextExamReadiness,
      streak,
      appelliDaChiudere,
      tomorrowPlanToday,
      dayClosedToday,
      weekKey,
      karenPlanContext,
      planInputs
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, nowTick, spiderSense, progression, karenAutoRouter, primaryTarget, skillEffects, karenFocusDirective, calibration, evaluatedTrophies, campusSnapshot, materiePiano, todayMinutesByMode, dayKey, karenLoadAdjustmentPct, sintesiLezioni, calendar, doneToday]);

  const value = useMemo(
    () => ({
      state,
      actions,
      // V37.0 — `timer` NON vive più qui: ha un contesto suo
      // (useFocusTimerContext), perché cambiava una volta al secondo e
      // trascinava con sé il re-render di ogni pagina dell'app.
      audio,
      sensoryZero,
      setSensoryZero,
      derived,
      toasts,
      pushToast,
      dismissToast,
      TIMER_STATUS,
      FOCUS_QUALITY,
      FOCUS_QUALITY_META,
      // V26.0 — Pillar 4: stato del Cloud Sync, letto dal micro-HUD in Sidebar.
      syncStatus,
      // V28.1 — Pillar 2: 'cloud' | 'guest' | 'sandbox' — letto da
      // Sidebar/CoreConfig per adattare copy e badge senza duplicare la
      // logica di derivazione (isGuest || sandboxActive) altrove.
      storageMode,
      // V28.1 — Pillar 3: timestamp one-shot dell'ultimo Spider-Sense
      // Focus Surge, letto da Mission Control per l'animazione di sblocco.
      spiderSenseSurgeAt
    }),
    [state, actions, audio, sensoryZero, derived, toasts, pushToast, dismissToast, syncStatus, storageMode, spiderSenseSurgeAt]
  );

  // K.A.R.E.N. Boot Sequence: finché il fetch iniziale da Supabase non è
  // completato, nessuna pagina dell'app viene montata — evita sia il
  // flash dello stato di default (Livello 1, 0 XP) prima dell'HYDRATE
  // reale, sia qualunque azione utente che potrebbe scattare un autosave
  // prematuro con dati non ancora sincronizzati.
  if (syncStatus === 'loading') {
    return <BootScreen message="Sincronizzazione del Web-Matrix in corso…" />;
  }
  if (bootError) {
    const when = bootError.savedAt
      ? new Date(bootError.savedAt).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
      : null;
    return (
      <BootScreen
        error={bootError.message}
        onRetry={() => setBootAttempt((n) => n + 1)}
        onOffline={bootError.canOffline ? startOffline : null}
        offlineLabel={when ? `Continua offline (copia del ${when})` : 'Continua offline'}
      />
    );
  }

  return (
    <ArachnoForgeContext.Provider value={value}>
      <TimerContext.Provider value={timer}>{children}</TimerContext.Provider>
      {/* V37.0 — vive qui, fuori dalle pagine: un conflitto di
          sincronizzazione riguarda l'intero profilo, non la schermata che
          per caso era aperta. */}
      <CloudConflictDialog
        conflict={cloudConflict}
        localState={state}
        onKeepLocal={actions.resolveConflictKeepLocal}
        onTakeRemote={actions.resolveConflictTakeRemote}
      />
    </ArachnoForgeContext.Provider>
  );
}

export function useArachnoForge() {
  const ctx = useContext(ArachnoForgeContext);
  if (!ctx) throw new Error('useArachnoForge deve essere usato dentro <ArachnoForgeProvider>.');
  return ctx;
}
