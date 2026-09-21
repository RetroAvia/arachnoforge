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
  FATIGUE_STAMINA_THRESHOLD,
  FOCUS_QUALITY,
  FOCUS_QUALITY_META
} from '../utils/xpEngine.js';
import { getSkillDef, canUnlockSkill, computeSkillEffects } from '../data/techTree.js';
import { computeCalibration } from '../utils/calibration.js';
import { computeExamReadiness } from '../utils/examReadiness.js';
import { materiaSintesiPlan } from '../utils/sintesiEngine.js';
import { computeCampusSnapshot, FASE } from '../utils/campusEngine.js';
import { isBountyTarget, computeFriction } from '../utils/friction.js';
import { getDateKey, crossedThreeAM, daysUntilDateOnly } from '../utils/dateUtils.js';
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
import { isMaxCarnageActive } from '../utils/maxCarnage.js';
import { canClaimWebSling, rollWebSlingRewardWithPity } from '../utils/webSling.js';
import { createSfideTreeFromAiIndex } from '../utils/aiIndexParser.js';
import { validateAdminPassphrase, sandboxStorageKey, guestStorageKey, loadLocalState, saveLocalState } from '../utils/adminOverride.js';
import { saveCloudCheckpoint, loadCloudCheckpoint, clearCloudCheckpoint } from '../utils/cloudCheckpoint.js';
import { createSessionId, getDeviceId, classifyRemoteWrite } from '../utils/syncIdentity.js';
import { useKarenBrain } from './KarenBrainContext.jsx';

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

  const pushToast = useCallback((message, type = 'info') => {
    const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    setToasts((prev) => [...prev, { id, message, type }]);
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
    const isPrimaryButton = (btn) => btn.classList.contains('font-bold') && btn.classList.contains('uppercase');
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

  const timer = useFocusTimer({
    focusTime: effectiveFocusTime,
    shortBreakTime: effectiveShortBreakTime,
    longBreakTime: state.settings.longBreakTime,
    dispatch,
    audio,
    pushToast,
    userId: user.id,
    // V36.0 — notifiche di sistema e Wake Lock, governati da Karen OS
    // Settings. Entrambi best effort dentro l'hook: un permesso negato o
    // un browser senza le API non cambia nulla del resto del timer.
    notificationsEnabled: state.settings.systemNotifications === true,
    keepScreenAwake: state.settings.keepScreenAwake !== false
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
  useEffect(() => {
    let cancelled = false;
    setSyncStatus('loading');
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
          let { data, error } = await supabase
            .from(USER_DATA_TABLE)
            .select('app_state, updated_at')
            .eq('user_id', user.id)
            .maybeSingle();
          if (error && error.code === '42703') {
            lockingSupportedRef.current = false;
            ({ data, error } = await supabase
              .from(USER_DATA_TABLE)
              .select('app_state')
              .eq('user_id', user.id)
              .maybeSingle());
          }
          if (cancelled) return;
          if (error) throw error;
          remoteVersionRef.current = data?.updated_at || null;
          baseRemoteStateRef.current = data?.app_state || null;

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
            dispatch({ type: 'HYDRATE', payload: hydrateState(pendingCheckpoint.state) });
            recoveredCheckpointRef.current = true;
          } else if (data && data.app_state) {
            const hydrated = hydrateState(data.app_state);
            lastPersistedRef.current = hydrated;
            dispatch({ type: 'HYDRATE', payload: hydrated });
          } else {
            const fresh = createDefaultState();
            const metaUsername = user.user_metadata && typeof user.user_metadata.username === 'string' ? user.user_metadata.username.trim() : '';
            if (metaUsername) fresh.profile.username = metaUsername;
            // V39 — prima la riga, poi l'HYDRATE: con l'HYDRATE durante
            // l'await il suo render trovava cloudReady ancora false, il
            // flag "salta il prossimo salvataggio" restava armato e si
            // mangiava la PRIMA modifica vera del nuovo utente.
            const { data: inserted, error: insertError } = await supabase
              .from(USER_DATA_TABLE)
              .insert({ user_id: user.id, app_state: fresh })
              .select(lockingSupportedRef.current ? 'updated_at' : 'user_id')
              .maybeSingle();
            if (insertError) throw insertError;
            if (cancelled) return;
            remoteVersionRef.current = inserted?.updated_at || null;
            lastPersistedRef.current = fresh;
            baseRemoteStateRef.current = fresh;
            dispatch({ type: 'HYDRATE', payload: fresh });
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
            dispatch({ type: 'HYDRATE', payload: hydrateState(pendingCheckpoint.state) });
            recoveredCheckpointRef.current = true;
          } else if (saved) {
            dispatch({ type: 'HYDRATE', payload: hydrateState(saved) });
          } else if (storageMode === 'sandbox' && cloudSnapshotRef.current) {
            dispatch({ type: 'HYDRATE', payload: hydrateState(cloudSnapshotRef.current) });
          } else {
            const fresh = createDefaultState();
            const metaUsername = user.user_metadata && typeof user.user_metadata.username === 'string' ? user.user_metadata.username.trim() : '';
            if (metaUsername) fresh.profile.username = metaUsername;
            dispatch({ type: 'HYDRATE', payload: fresh });
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
        if (!cancelled) setSyncStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id, storageMode]);

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
  useEffect(() => {
    conflictActiveRef.current = !!cloudConflict;
  }, [cloudConflict]);

  /** Dopo una scrittura riuscita: se nel frattempo non è arrivato niente
   * di nuovo il checkpoint ha esaurito il suo scopo; altrimenti viene
   * riscritto con il token appena ricevuto (prima veniva cancellato
   * anche quando conteneva una modifica successiva ancora in attesa). */
  const settleCheckpoint = (snapshot) => {
    if (pendingStateRef.current === snapshot) {
      clearCloudCheckpoint(user.id, storageMode);
    } else {
      saveCloudCheckpoint(user.id, storageMode, pendingStateRef.current, {
        baseVersion: remoteVersionRef.current,
        writer: sessionIdRef.current
      });
    }
  };

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
  }, [storageMode, user.id]);

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
          let remote = null;
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
      setSyncStatus('error');
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
        setSyncStatus('error');
      }
    }, 2500);
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
     
  }, [state, user.id, storageMode, runPersist, enterConflictState]);

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
  useEffect(() => {
    if (storageMode !== 'cloud') return undefined;
    let busy = false;
    const isClean = () =>
      cloudReadyRef.current &&
      !conflictActiveRef.current &&
      !saveTimeoutRef.current &&
      lastPersistedRef.current != null &&
      pendingStateRef.current === lastPersistedRef.current;
    const check = async () => {
      if (document.visibilityState !== 'visible' || busy) return;
      if (!lockingSupportedRef.current || !isClean()) return;
      const now = Date.now();
      if (now - lastRemoteCheckRef.current < 15000) return;
      lastRemoteCheckRef.current = now;
      busy = true;
      try {
        await saveChainRef.current.catch(() => undefined);
        const { data, error } = await withTimeout(
          supabase.from(USER_DATA_TABLE).select('updated_at').eq('user_id', user.id).maybeSingle()
        );
        if (error || !data?.updated_at || data.updated_at === remoteVersionRef.current || !isClean()) return;
        const remote = await withTimeout(readRemoteRow());
        if (!remote?.app_state || !isClean()) return;
        const kind = classifyRemoteWrite(remote.app_state, {
          sessionId: [sessionIdRef.current, recoveredWriterRef.current],
          deviceId: deviceIdRef.current,
          knownStates: [lastSentRef.current, baseRemoteStateRef.current]
        });
        remoteVersionRef.current = remote.updated_at;
        if (kind === 'own') return;
        const hydrated = hydrateState(remote.app_state);
        baseRemoteStateRef.current = remote.app_state;
        lastPersistedRef.current = hydrated;
        skipNextSaveRef.current = true;
        dispatch({ type: 'HYDRATE', payload: hydrated });
        pushToast(
          kind === 'sameDevice'
            ? 'Profilo aggiornato con le modifiche fatte in un’altra finestra.'
            : 'Profilo aggiornato con le modifiche fatte su un altro dispositivo.',
          'info'
        );
      } catch (err) {
        console.warn('[ArachnoForge] Controllo della versione remota non riuscito.', err);
      } finally {
        busy = false;
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') check();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', check);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', check);
    };
  }, [storageMode, user.id, readRemoteRow, pushToast]);

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
      'K.A.R.E.N. — Recuperate modifiche non ancora sincronizzate dalla sessione precedente. Le sto risalvando ora.',
      'info'
    );
  }, [syncStatus, pushToast]);

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
  useEffect(() => {
    if (!state.profile.maxCarnageActive) return undefined;
    const check = () => {
      if (!isMaxCarnageActive(state.profile)) {
        dispatch({ type: 'DEACTIVATE_MAX_CARNAGE' });
      }
    };
    check();
    const id = setInterval(check, 15000);
    return () => clearInterval(id);
  }, [state.profile.maxCarnageActive, state.profile.maxCarnageExpiresAt]);

  // V27.0 — Pillar 3: Feedback Sensoriale Completo — transizione edge-
  // triggered (come i Trofei / Daily Patrol) su `maxCarnageActive`: al
  // fronte di salita si scatena il ruggito + si avvia il drone ambientale
  // continuo; al fronte di discesa (scadenza o disattivazione) il drone
  // si ferma esplicitamente. Mai un secondo avvio sovrapposto: il ref
  // interno di useAudioEngine (`carnageDroneRef`) è già blindato.
  const prevMaxCarnageRef = useRef(state.profile.maxCarnageActive);
  useEffect(() => {
    const wasActive = prevMaxCarnageRef.current;
    const isActive = state.profile.maxCarnageActive;
    if (!wasActive && isActive) {
      pushToast('MAXIMUM CARNAGE MODE — Il simbionte prende il sopravvento. XP x2, Stamina illimitata per 2 ore.', 'danger');
      audio.playMaxCarnageActivate();
      audio.startMaxCarnageDrone();
    } else if (wasActive && !isActive) {
      pushToast('Maximum Carnage Mode esaurita. Il simbionte si ritira.', 'info');
      audio.stopMaxCarnageDrone();
    }
    prevMaxCarnageRef.current = isActive;
  }, [state.profile.maxCarnageActive, pushToast, audio]);

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
  useEffect(() => {
    const was = prevSymbioteUnlockRef.current;
    const is = state.profile.symbioteSuitUnlocked;
    if (!was && is) {
      pushToast('🕷️ SYMBIOTE SUIT SBLOCCATA — disponibile in Karen OS Settings.', 'success');
    }
    prevSymbioteUnlockRef.current = is;
  }, [state.profile.symbioteSuitUnlocked, pushToast]);

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
  useEffect(() => {
    const log = state.combatLog;
    if (log.length === 0) {
      lastSeenLogIdRef.current = null;
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
  }, [state.combatLog, pushToast, audio]);

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
  const progression = useProgression(state.profile, pushToast, audio);

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
  const spiderSense = useSpiderSense(state.materie, dayKey);

  // V36.0 — "Karen impara da te": capacità giornaliera reale e fattore di
  // calibrazione delle stime, misurati sul TUO storico (utils/calibration.js)
  // e calcolati UNA volta sola qui, a livello di Provider. Da qui in giù
  // ogni motore (Quota Odierna, Spider-Score, Fine Prevista, Exam
  // Readiness) parte dagli stessi due numeri: nessun consumatore li
  // ricalcola per conto proprio, quindi non possono divergere.
  const calibration = useMemo(
    () => computeCalibration(state),
    // Dipendenze minime reali: la capacità viene dallo storico sessioni,
    // il bias dai nodi completati — non da tutto lo stato. `dayKey`
    // perché la finestra della capacità è relativa a oggi.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.starLog, state.materie, dayKey]
  );

  // V36.0 — la riduzione di carico consigliata dal Daily Brief smette di
  // essere un banner decorativo e diventa il moltiplicatore REALE del
  // budget di studio del giorno (vedi allocateDailyBudget).
  const karenLoadAdjustmentPct =
    karenBrain.directives && Number.isFinite(karenBrain.directives.mission_control?.load_adjustment_pct)
      ? karenBrain.directives.mission_control.load_adjustment_pct
      : 0;

  // "Il Cervello" del K.A.R.E.N. Auto-Router / Quantum Router (V23.0,
  // Modulo 1): Daily Quota + status a 3 livelli per ogni Materia aperta,
  // isolato in un custom hook dedicato.
  // V39.0 — "Empire State University": fase (lezioni/sessione), lezioni
  // di oggi, prossima lezione, coda post-lezione e passo settimanale.
  // Ricalcolato col battito di un minuto (`nowTick`) perché dipende
  // dall'ora: una lezione passa da "in corso" a "da sistemare" alle
  // 11:00, non al prossimo salvataggio.
  const campusSnapshot = useMemo(
    () => computeCampusSnapshot(state.campus, new Date(), state.materie, state.starLog),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.campus, state.materie, state.starLog, nowTick]
  );

  // Le materie seguite a lezione oggi (o con una lezione ancora da
  // sistemare): il planner di Karen dà a una di loro il secondo slot
  // "in focus oggi". Solo in modalità Lezioni.
  const campusPriorityIds = useMemo(() => {
    if (campusSnapshot.fase !== FASE.LEZIONI) return null;
    const ids = new Set();
    campusSnapshot.coda.forEach((l) => ids.add(l.materiaId));
    campusSnapshot.lezioniOggi.forEach((l) => ids.add(l.materiaId));
    return ids.size ? ids : null;
  }, [campusSnapshot]);

  const karenAutoRouter = useKarenAutoRouter(state.materie, {
    calibration,
    loadAdjustmentPct: karenLoadAdjustmentPct,
    priorityIds: campusPriorityIds
  });

  // Karen's Tactical Suggestor (Primary Target): ricalcolato qui, a
  // livello di Provider, così sia Mission Control (Daily Patrol HUD) sia
  // il Web-Matrix possono leggerlo da `derived` senza calcolarlo due volte
  // con risultati potenzialmente disallineati.
  // V39.0 — coincide con la prima materia in focus del planner (vedi
  // computePrimaryTarget): una sola risposta a "cosa faccio oggi".
  const focusTopId = karenAutoRouter.dailyFocusQuotas[0]?.materiaId ?? null;
  const primaryTarget = useMemo(
    () => computePrimaryTarget(state.materie, calibration, focusTopId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.materie, calibration, focusTopId, dayKey]
  );

  // Daily Patrol Engine (V23.0, Modulo 2) — Rigenerazione giornaliera:
  // quando la dateKey persistita non corrisponde a "oggi" (primo avvio,
  // o giornata cambiata mentre l'app era chiusa/aperta a cavallo di
  // mezzanotte), genera un nuovo set di 3 missioni deterministico. Il
  // progresso da qui in poi è interamente event-driven (vedi reducer
  // sopra): questo effetto si occupa SOLO della rigenerazione giornaliera.
  useEffect(() => {
    const todayKey = getDateKey();
    if (!state.dailyPatrols || state.dailyPatrols.dateKey !== todayKey) {
      const quests = generateDailyQuests(todayKey, { upcomingReviewsCount: spiderSense.upcomingReviews.length });
      dispatch({ type: 'GENERATE_DAILY_PATROLS', payload: { dateKey: todayKey, quests } });
    }
  }, [state.dailyPatrols, spiderSense.upcomingReviews.length, dispatch]);

  // Daily Patrol Engine — Celebrazione: rileva le transizioni
  // isCompleted false -> true (edge-triggered, come i Trofei) per
  // scatenare la Toast + il suono di Quest Complete, e una "chicca"
  // narrativa extra quando TUTTE e 3 le missioni del giorno sono
  // completate nella stessa giornata ("Patrol Perfetta").
  const prevDailyQuestsRef = useRef(null);
  useEffect(() => {
    const quests = state.dailyPatrols?.quests;
    if (!Array.isArray(quests)) return;
    const prevQuests = prevDailyQuestsRef.current;

    quests.forEach((q) => {
      const prevQ = Array.isArray(prevQuests) ? prevQuests.find((p) => p.id === q.id) : null;
      if (q.isCompleted && (!prevQ || !prevQ.isCompleted)) {
        pushToast(`🏆 DAILY PATROL — ${q.title} completata! +${q.xpReward} XP`, 'success');
        audio.playQuestComplete();
      }
    });

    const allDoneNow = quests.length > 0 && quests.every((q) => q.isCompleted);
    const wasAllDoneBefore = Array.isArray(prevQuests) && prevQuests.length > 0 && prevQuests.every((q) => q.isCompleted);
    if (allDoneNow && !wasAllDoneBefore) {
      pushToast('Karen: Patrol perfetta. Prenditi un caffè, te lo sei guadagnato. ☕', 'success');
      audio.playLevelUpChime();
    }

    prevDailyQuestsRef.current = quests;
  }, [state.dailyPatrols, pushToast, audio]);

  const actions = useMemo(
    () => ({
      updateProfile: (patch) => dispatch({ type: 'UPDATE_PROFILE', payload: patch }),
      updateSettings: (patch) => dispatch({ type: 'UPDATE_SETTINGS', payload: patch }),
      addMateria: (payload) => dispatch({ type: 'ADD_MATERIA', payload }),
      updateMateria: (id, patch) => dispatch({ type: 'UPDATE_MATERIA', payload: { id, patch } }),
      deleteMateria: (id) => dispatch({ type: 'DELETE_MATERIA', payload: { id } }),
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
      updateSfidaAndSync: async (materiaId, sfidaId, patch) => {
        dispatch({ type: 'UPDATE_SFIDA', payload: { materiaId, sfidaId, patch } });

        const nextState = {
          ...stateRef.current,
          materie: stateRef.current.materie.map((m) =>
            m.id === materiaId
              ? { ...m, sfide: m.sfide.map((s) => (s.id === sfidaId ? { ...s, ...patch } : s)) }
              : m
          )
        };

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
      deleteSfida: (materiaId, sfidaId) => dispatch({ type: 'DELETE_SFIDA', payload: { materiaId, sfidaId } }),
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
      // V34.2 — "Selezione Multipla Nodi": eliminazione in blocco dal
      // pannello di selezione del Web-Matrix (QuadrantHub.jsx). `sfidaIds`
      // è un array semplice (mai un Set: i reducer restano serializzabili,
      // coerente col resto dell'app che finisce su Supabase come JSONB).
      bulkDeleteSfide: (materiaId, sfidaIds) => dispatch({ type: 'BULK_DELETE_SFIDE', payload: { materiaId, sfidaIds } }),
      completeSfida: (materiaId, sfidaId) => {
        // Level Up Chime per i Nodi Padre ("Boss" dello Skill Tree, cioè
        // nodi che hanno almeno un sotto-argomento agganciato): un arpeggio
        // più ricco del Success Chime standard, coerente col peso di aver
        // appena sconfitto un intero "Boss" di argomenti collegati.
        const materia = findMateria(stateRef.current, materiaId);
        const isBossNode = !!materia && materia.sfide.some((s) => s.parentId === sfidaId);
        dispatch({ type: 'COMPLETE_SFIDA', payload: { materiaId, sfidaId } });
        if (isBossNode) audio.playLevelUpChime();
        else audio.playSuccessChime();
      },
      reviewSfida: (materiaId, sfidaId, rating) => {
        dispatch({ type: 'REVIEW_SFIDA', payload: { materiaId, sfidaId, rating } });
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
      redeemShopReward: (id, nome) => {
        dispatch({ type: 'REDEEM_SHOP_REWARD', payload: { id } });
        pushToast(`ACQUISTATO — ${nome}`, 'success');
      },
      consumeInventoryItem: (id) => dispatch({ type: 'CONSUME_INVENTORY_ITEM', payload: { id } }),
      unlockSkill: (skillId) => {
        const def = getSkillDef(skillId);
        const unlockedSkills = Array.isArray(stateRef.current.profile.unlockedSkills) ? stateRef.current.profile.unlockedSkills : [];
        if (!def || !canUnlockSkill(def, unlockedSkills, stateRef.current.profile.techTokens || 0)) return;
        dispatch({ type: 'UNLOCK_SKILL', payload: { skillId } });
        pushToast(`SKILL SBLOCCATA — ${def.title}`, 'success');
        audio.playSkillUnlock();
      },
      bossFightResult: (payload) => {
        dispatch({ type: 'BOSS_FIGHT_RESULT', payload });
        pushToast(payload.win ? 'SUPERCRIMINALE SCONFITTO — XP accreditati' : 'GAME OVER — nessun XP', payload.win ? 'success' : 'danger');
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
        pushToast('LAST STAND — sei sopravvissuto a 1 HP', 'danger');
      },
      logEvent: (message, tag) => dispatch({ type: 'LOG_EVENT', payload: { message, tag } }),
      importProfile: (rawObj) => {
        const validation = validateImportedProfile(rawObj);
        if (!validation.valid) return validation;
        const hydrated = hydrateState(rawObj);
        dispatch({ type: 'IMPORT_PROFILE', payload: hydrated });
        return { valid: true };
      },
      resetProfile: () => dispatch({ type: 'RESET_PROFILE' }),
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
      bulkImportSkillTree: (materiaId, parsedNodes) => {
        const result = createSfideTreeFromAiIndex(parsedNodes);
        if (!result.valid) return result;
        dispatch({ type: 'BULK_IMPORT_SFIDE', payload: { materiaId, sfide: result.sfide } });
        pushToast(`AI Index Matrix — ${result.sfide.length} nodi importati.`, 'success');
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
        pushToast('Protocollo Admin Attivato — Sandbox in uso.', 'info');
        audio.playAccessGranted();
        return { valid: true };
      },
      // Ritorno al profilo standard: SOLO un flip di flag — lo snapshot
      // Cloud congelato all'ingresso resta la fonte per il prossimo
      // HYDRATE (effetto di boot), mai un nuovo fetch di rete necessario.
      deactivateSandbox: () => {
        setSandboxActive(false);
        pushToast('Sandbox disattivata — profilo Cloud ripristinato.', 'info');
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
        conflictActiveRef.current = false;
        remoteVersionRef.current = remoteUpdatedAt || null;
        clearCloudCheckpoint(user.id, storageMode);
        if (remoteState) {
          const hydrated = hydrateState(remoteState);
          baseRemoteStateRef.current = remoteState;
          lastPersistedRef.current = hydrated;
          skipNextSaveRef.current = true;
          dispatch({ type: 'HYDRATE', payload: hydrated });
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
    [pushToast, audio, authSignOut, storageMode, user.id, flushSave, runPersist, enterConflictState]
  );

  const derived = useMemo(() => {
    const fatigued = state.profile.stamina < FATIGUE_STAMINA_THRESHOLD;
    // V34.1 — FIX: una Materia già superata (`examPassed`, voto registrato)
    // restava candidata a "Prossimo Esame" finché la sua `examDate` non
    // veniva manualmente cambiata/rimossa — bastava che la data fosse la
    // più vicina nell'ordinamento per far comparire una materia CHIUSA
    // nella Traiettoria (Sidebar), nel Doomsday Clock (Mission Control) e
    // nel Web-Velocity Focus Analytics (Daily Bugle Archives), che quindi
    // mostrava "100% — quadrante già completato" all'infinito invece di
    // sparire e lasciare spazio al prossimo esame REALE. Stesso identico
    // filtro già usato da K.A.R.E.N. Auto-Router (vedi useKarenAutoRouter,
    // `.filter((m) => !m.examPassed)`) — un solo criterio di "esame ancora
    // da sostenere", condiviso da ogni consumatore di `derived.nextExam`.
    // V39.0 — il "prossimo esame" è il prossimo NEL FUTURO: un appello di
    // tre settimane fa, sostenuto e in attesa di verbale, restava
    // "prossimo esame" per sempre nella Sidebar e nel Doomsday Clock.
    const upcomingExams = [...state.materie]
      .filter((m) => m.examDate && !m.examPassed && (daysUntilDateOnly(m.examDate) ?? -1) >= 0)
      .sort((a, b) => a.examDate.localeCompare(b.examDate));
    const nextExam = upcomingExams[0] || null;

    // V39.0 — la Traiettoria legge lo STESSO stato della Quota Odierna.
    // Prima contava i NODI rimasti diviso i giorni: venti nodi da mezz'ora
    // in dieci giorni risultavano ROSSO (sono 10 ore, OTTIMALE), tre nodi
    // da trenta ore VERDE (sono 90 ore, CRITICO). Ora un solo verdetto.
    let trajectory = 'GREEN';
    if (nextExam) {
      const quota = karenAutoRouter.byMateriaId.get(nextExam.id);
      if (quota?.status === 'CRITICO') trajectory = 'RED';
      else if (quota?.status === 'ATTENZIONE') trajectory = 'YELLOW';
    }

    // V37.0 — riusa la valutazione già fatta a monte (vedi
    // `evaluatedTrophies`), invece di rifarla da capo.
    const unlockedAtById = new Map(state.trophies.map((r) => [r.id, r.unlockedAt]));
    const trophyList = evaluatedTrophies.map((t) => ({
      ...t,
      unlockedAt: unlockedAtById.get(t.id) || null
    }));

    // V31.3 — Bounty Board (Friction Analytics): riattiva utils/friction.js,
    // rimasto scaffoldato ma mai collegato a nessuna UI. Richiede almeno 3
    // tentativi di ripasso registrati prima di segnalare un nodo, per non
    // marcare come "Bounty" un nodo dopo un solo giudizio "Difficile"
    // (rumore statistico su un campione troppo piccolo). Top 5 per frizione
    // decrescente, letto da QuadrantHub per il pannello dedicato.
    const bountyTargets = state.materie
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

    const todayKey = getDateKey();
    const todayMinutes = state.starLog
      .filter((e) => e.type === 'FOCUS_MINUTES' && e.dateKey === todayKey)
      .reduce((sum, e) => sum + e.minutes, 0);
    const burnoutRisk = todayMinutes > BURNOUT_MINUTES_THRESHOLD;

    // V36.0 — EXAM READINESS INDEX: il verdetto "sostieni / rimanda" per
    // ogni materia ancora aperta, calcolato una sola volta qui e letto
    // sia dal Web-Matrix sia da Mission Control. `byMateriaId` perché è
    // così che lo consuma la UI (lookup su una card, non scorrimento).
    const radarByMateriaId = new Map(spiderSense.memoryRadar.byMateria.map((r) => [r.materiaId, r]));
    const examReadinessByMateriaId = new Map(
      state.materie
        .filter((m) => !m.examPassed)
        .map((m) => [m.id, computeExamReadiness(m, radarByMateriaId.get(m.id) || null, calibration)])
    );
    const nextExamReadiness = nextExam ? examReadinessByMateriaId.get(nextExam.id) || null : null;

    // V38.0 — "La Forgia degli Appunti": il piano di sintesi di ogni
    // materia ancora aperta. Stesso pattern dei due sopra (mappa per id,
    // calcolata una volta sola qui) perché lo leggono in tre punti
    // diversi — Web-Matrix, Mission Control e il Debriefing — e
    // ricalcolarlo in ognuno significherebbe tre risposte che nel tempo
    // divergono.
    const sintesiPlanByMateriaId = new Map(
      state.materie.filter((m) => !m.examPassed).map((m) => [m.id, materiaSintesiPlan(m, calibration)])
    );

    return {
      fatigued,
      nextExam,
      trajectory,
      trophyList,
      todayMinutes,
      burnoutRisk,
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
      // V25.0 — Pillar 3: Tech Tokens & Skill Tree, esposti come `derived`
      // per la UI (Sidebar, Armory) senza ricalcoli duplicati altrove.
      skillEffects,
      effectiveBloodPactPenalty: computeBloodPactPenalty(skillEffects.bloodPactReduction),
      // K.A.R.E.N. Auto-Router (V20.0, Pillar 1) — Daily Quota per materia.
      karenQuotas: karenAutoRouter.quotas,
      karenQuotaByMateriaId: karenAutoRouter.byMateriaId,
      karenEventHorizonList: karenAutoRouter.eventHorizonList,
      // V29.0 — Pillar 1 (Planner Restriction) + Pillar 2 (Precedence
      // Engine): tre liste distinte per la UI — mai più "tutto insieme".
      karenDailyFocusIds: karenAutoRouter.dailyFocusIds,
      karenMonotaskActive: karenAutoRouter.monotaskActive,
      karenDailyFocusQuotas: karenAutoRouter.dailyFocusQuotas,
      karenQueuedQuotas: karenAutoRouter.queuedQuotas,
      karenFrozenQuotas: karenAutoRouter.frozenQuotas,
      // Karen's Tactical Suggestor — Primary Target (V18.0/V20.0).
      primaryTarget,
      // V27.0 — Pillar 3 (Maximum Carnage Mode): stato derivato, letto da
      // Sidebar/Shell/MissionControl per il feedback sensoriale globale.
      // Ricalcolato ad ogni `nowTick` (heartbeat 60s) cosi' la finestra
      // scade visivamente anche senza altre azioni dell'utente.
      isMaxCarnageActive: isMaxCarnageActive(state.profile),
      // V27.0 — Pillar 4 (Daily Web-Sling): true se il forziere di oggi è
      // ancora disponibile — letto dal widget in Mission Control.
      canClaimWebSling: canClaimWebSling(state.profile),
      // V31.3 — Bounty Board (Friction Analytics).
      bountyTargets,
      // V35.0 — K.A.R.E.N. Daily Brain: Focus Timer Adattivo, letto dal
      // widget del Tactical Timer per il badge "Preset Adattivo K.A.R.E.N.".
      karenAdaptiveTimerActive: !!karenFocusDirective,
      karenFocusDirective,
      // V36.0 — Budget Giornaliero Globale: ore realmente assegnate oggi,
      // deficit dichiarato, riduzione di carico applicata davvero.
      karenBudget: karenAutoRouter.budget,
      // V36.0 — "Karen impara da te": capacità reale e bias delle stime.
      calibration,
      // V36.0 — Exam Readiness Index.
      examReadinessByMateriaId,
      sintesiPlanByMateriaId,
      // V39.0 — Empire State University.
      campus: campusSnapshot,
      karenCumulativeOverload: karenAutoRouter.cumulativeOverload,
      nextExamReadiness
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, nowTick, spiderSense, progression, karenAutoRouter, primaryTarget, skillEffects, karenFocusDirective, calibration, evaluatedTrophies, campusSnapshot]);

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
    return <BootScreen message="Sincronizzazione Web-Matrix in corso..." />;
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
