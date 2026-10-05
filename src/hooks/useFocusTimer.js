import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useTimerEngine, TIMER_STATUS } from './useTimerEngine.js';
import { BLOOD_PACT_PENALTY, FOCUS_QUALITY, DEFAULT_FOCUS_QUALITY } from '../utils/xpEngine.js';
import {
  saveFocusCheckpoint,
  loadFocusCheckpoint,
  clearFocusCheckpoint,
  saveRunningBlock,
  loadRunningBlock,
  clearRunningBlock,
  planRunningBlockRestore,
  getTabId,
  readFocusLease,
  writeFocusLease,
  releaseFocusLease,
  isForeignLeaseAlive,
  LEASE_BEAT_MS
} from '../utils/focusRecovery.js';

const EMPTY_PENDING = { totalMinutes: 0, overdriveOccurred: false, overdriveMinutes: 0, materiaId: null, sfidaId: null, intent: null };
/**
 * V42 — l'intento di una sessione: il modo di lavoro con cui l'hai avviata
 * (Sintesi dalla coda delle lezioni, Ripasso da un argomento in scadenza,
 * Esercizi, Studio). Il Debriefing parte già su quel modo.
 */
const INTENTS = ['SINTESI', 'RIPASSO', 'ESERCIZI', 'STUDIO'];
function normIntent(v) {
  return INTENTS.includes(v) ? v : null;
}
import { notify, vibrate, requestWakeLock, releaseWakeLock } from '../utils/systemNotify.js';

/**
 * useFocusTimer — "Il Cervello" del Tactical Timer.
 *
 * Estratto dal ArachnoForgeContext (Fase 2 — Custom Hooks & State Split)
 * per isolare completamente la macchina a stati del Focus/Break dal resto
 * della logica applicativa (XP, Stamina, Skill Tree, Trofei...). Il
 * Context resta l'unico proprietario dello stato persistito: questo hook
 * gestisce solo lo stato EFFIMERO di sessione (countdown, materia/nodo
 * attivo, minuti "in sospeso" non ancora salvati) e comunica col resto
 * dell'app esclusivamente tramite `dispatch`, `audio` e `pushToast`
 * ricevuti come parametri — nessuna dipendenza diretta dal reducer.
 *
 * "Sessione in sospeso": ogni blocco Focus che arriva naturalmente a zero
 * NON viene salvato subito. Si accumula in `pendingFocus` finché l'utente
 * non chiude volontariamente la sessione con `endFocusSession(quality)`
 * (Termina Sessione / Avvia Pausa), passando per il Tactical Debriefing.
 * `overdrive()` concatena un nuovo blocco sullo stesso "conto" senza mai
 * toccare il reducer nel frattempo.
 *
 * V35.0 — "Sessione Blindata" (fix persistenza): `pendingFocus` vive SOLO
 * in memoria React finché non si passa dal Debriefing — se la scheda si
 * chiude, si ricarica o crasha prima di allora, quei minuti erano persi
 * per sempre. Ora ogni variazione di `pendingFocus` scrive un checkpoint
 * sincrono su LocalStorage (utils/focusRecovery.js) e al boot successivo
 * (mount di questo hook, cioè una volta per sessione — mai ripetuto
 * durante la normale navigazione SPA) un checkpoint orfano viene
 * recuperato e fatto confluire nella STESSA action FOCUS_COMPLETED già
 * collaudata: zero nuovo canale di scrittura remota, il recupero
 * converge sulla pipeline Cloud Sync esistente.
 */
export function useFocusTimer({
  focusTime,
  shortBreakTime,
  longBreakTime,
  dispatch,
  audio,
  pushToast,
  userId,
  // V36.0 — entrambi governati da Karen OS Settings, entrambi best
  // effort: un permesso negato o un browser senza l'API non cambia una
  // riga del comportamento del timer.
  notificationsEnabled = false,
  keepScreenAwake = true,
  // V40.3 — il rintocco ogni 30 minuti di Focus accumulato si può
  // spegnere: senza un suono di fine blocco sembrava casuale.
  focusReminderEnabled = true,
  // V41 — true quando lo stato del profilo è stato caricato: il recupero
  // di una sessione orfana deve arrivare DOPO i dati veri, non prima.
  ready = true,
  // V42 — la penalità Blood Pact effettiva (Skill Tree compreso), per un
  // messaggio che dica il vero (prima diceva sempre −50).
  bloodPactPenalty = BLOOD_PACT_PENALTY
}) {
  const [activeFocusMateriaId, setActiveFocusMateriaId] = useState(null);
  const [activeFocusSfidaId, setActiveFocusSfidaId] = useState(null);
  // V40.2 — l'intento con cui è partita la sessione: 'SINTESI' quando la
  // avvii da una lezione da sistemare (Campus o card "ADESSO"). Il
  // Debriefing parte già in modo Sintesi e chiede le pagine fonte per fonte.
  const [activeFocusIntent, setActiveFocusIntent] = useState(null);
  const [pendingFocus, setPendingFocus] = useState(EMPTY_PENDING);
  const bloodPactPenaltyRef = useRef(bloodPactPenalty);
  useEffect(() => {
    bloodPactPenaltyRef.current = bloodPactPenalty;
  }, [bloodPactPenalty]);
  // V42 — durata dell'ultima pausa avviata: a fine pausa ricarica Stamina.
  const breakMinutesRef = useRef(0);

  const activeFocusRef = useRef({ materiaId: null, sfidaId: null, intent: null });
  useEffect(() => {
    activeFocusRef.current = { materiaId: activeFocusMateriaId, sfidaId: activeFocusSfidaId, intent: activeFocusIntent };
  }, [activeFocusMateriaId, activeFocusSfidaId, activeFocusIntent]);

  // V35.0 / V41 — Il recupero al boot vive più sotto, dopo il motore del
  // timer: oltre ai blocchi finiti ora riprende anche quello in corso.
  const recoveryDoneRef = useRef(false);
  // V41 — identità di questa finestra (vedi "una sola finestra alla
  // volta" in utils/focusRecovery.js).
  const tabIdRef = useRef(null);
  if (tabIdRef.current === null) tabIdRef.current = getTabId();
  // V41 — Web Locks: un lucchetto esclusivo per utente, tenuto dalla
  // finestra che ha una sessione in corso. Il browser lo libera da solo
  // quando la finestra si chiude, va in crash o viene scartata, e lo
  // lascia a una finestra in secondo piano anche se rallentata o
  // congelata: esattamente la regola che serve. Il "possesso" a tempo
  // resta solo per i browser senza Web Locks.
  const locksOk = typeof navigator !== 'undefined' && !!navigator.locks && typeof navigator.locks.request === 'function';
  const lockName = `arachnoforge-focus-session-${userId || 'anon'}`;
  // 'idle' finché i dati non sono pronti, 'pending' in attesa del
  // lucchetto (un'altra finestra ha la sessione), 'done' a recupero fatto.
  const [recoveryPhase, setRecoveryPhase] = useState('idle');
  const recuperaRef = useRef(null);
  // Vero se da più di un istante un'altra finestra tiene la sessione.
  const [sessionElsewhere, setSessionElsewhere] = useState(false);

  // V35.0 — Checkpoint sincrono: scrive (MAI cancella) ad ogni blocco
  // accumulato — la cancellazione è sempre esplicita, nei punti in cui
  // `pendingFocus` viene intenzionalmente risolto (endFocusSession,
  // interruptFocus), cosi' non esiste una finestra in cui questo effetto
  // potrebbe cancellare un checkpoint che il boot successivo deve ancora
  // leggere.
  useEffect(() => {
    if (pendingFocus.totalMinutes > 0) {
      saveFocusCheckpoint(userId, {
        totalMinutes: pendingFocus.totalMinutes,
        overdriveOccurred: pendingFocus.overdriveOccurred,
        overdriveMinutes: pendingFocus.overdriveMinutes || 0,
        materiaId: pendingFocus.materiaId,
        sfidaId: pendingFocus.sfidaId,
        intent: pendingFocus.intent || null
      });
    }
  }, [pendingFocus, userId]);

  // V35.0 — Belt-and-braces: `beforeunload`/`pagehide` forzano un ultimo
  // flush sincrono del checkpoint corrente. Ridondante rispetto
  // all'effetto sopra nel caso comune (React ha già scritto), ma copre
  // il caso limite di una chiusura scheda cosi' rapida da precedere il
  // commit dell'effetto — `pagehide` copre anche iOS Safari, che non
  // garantisce sempre `beforeunload`.
  const pendingFocusRef = useRef(pendingFocus);
  useEffect(() => {
    pendingFocusRef.current = pendingFocus;
  }, [pendingFocus]);
  useEffect(() => {
    const flush = () => {
      if (pendingFocusRef.current.totalMinutes > 0) {
        saveFocusCheckpoint(userId, {
          totalMinutes: pendingFocusRef.current.totalMinutes,
          overdriveOccurred: pendingFocusRef.current.overdriveOccurred,
          overdriveMinutes: pendingFocusRef.current.overdriveMinutes || 0,
          materiaId: pendingFocusRef.current.materiaId,
          sfidaId: pendingFocusRef.current.sfidaId,
          intent: pendingFocusRef.current.intent || null
        });
      }
    };
    window.addEventListener('beforeunload', flush);
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('beforeunload', flush);
      window.removeEventListener('pagehide', flush);
    };
  }, [userId]);

  // Focus Reminder — "rintocco tibetano" ogni 30 minuti ESATTI di Focus
  // ininterrotto (accumulo su tutta la catena Focus + Overdrive concatenati,
  // non solo il blocco corrente). Un ref conta quante soglie da 1800s sono
  // già state annunciate in questo arco continuo di studio, per non
  // ri-suonare ad ogni tick da 250ms una volta superata la soglia.
  const REMINDER_INTERVAL_SECONDS = 1800;
  const reminderThresholdRef = useRef(0);

  // Letto tramite ref (non come dipendenza di useCallback) cosi' i timer
  // duration usano sempre il valore corrente delle impostazioni senza
  // costringere startFocus/startBreak a essere ricreate ad ogni modifica
  // di stato non correlata al timer stesso (zero re-render inutili).
  const focusTimeRef = useRef(focusTime);
  const shortBreakRef = useRef(shortBreakTime);
  const longBreakRef = useRef(longBreakTime);
  useEffect(() => { focusTimeRef.current = focusTime; }, [focusTime]);
  useEffect(() => { shortBreakRef.current = shortBreakTime; }, [shortBreakTime]);
  useEffect(() => { longBreakRef.current = longBreakTime; }, [longBreakTime]);

  // V36.0 — le preferenze di notifica/wake lock viaggiano su ref: i
  // callback del motore timer non devono essere ricreati (e quindi il
  // countdown non deve essere ri-agganciato) solo perché l'utente ha
  // toccato un toggle in Karen OS Settings.
  // V40.3 — rintocco di fine blocco programmato sul clock audio (vedi
  // scheduleEndChime): resta puntuale anche con la scheda in secondo
  // piano, dove i timer JS vengono rallentati a un tick al minuto.
  const rintoccoRef = useRef(null);
  const annullaRintocco = useCallback(() => {
    if (rintoccoRef.current) {
      rintoccoRef.current.annulla();
      rintoccoRef.current = null;
    }
  }, []);
  const programmaRintocco = useCallback(
    (tipo, secondi) => {
      annullaRintocco();
      const prog = audio.scheduleEndChime ? audio.scheduleEndChime(tipo, secondi) : null;
      if (prog) rintoccoRef.current = { ...prog, tipo };
    },
    [audio, annullaRintocco]
  );

  const reminderEnabledRef = useRef(focusReminderEnabled);
  useEffect(() => {
    reminderEnabledRef.current = focusReminderEnabled;
  }, [focusReminderEnabled]);

  const notifyRef = useRef(notificationsEnabled);
  const wakeRef = useRef(keepScreenAwake);
  useEffect(() => { notifyRef.current = notificationsEnabled; }, [notificationsEnabled]);
  useEffect(() => { wakeRef.current = keepScreenAwake; }, [keepScreenAwake]);

  const handleFocusComplete = useCallback(({ wasOverdrive, durationSeconds }) => {
    // V40.3 — IL suono che mancava: la fine di un blocco era muta se non
    // avevi attivato le notifiche di sistema. Se era già stato programmato
    // sul clock audio ha appena suonato da solo, e non si ripete.
    const prog = rintoccoRef.current;
    const giaSuonato = !!prog && prog.tipo === 'FOCUS' && prog.suonato();
    // V43 — se NON ha suonato (iOS: lo schermo bloccato sospende l'audio e
    // ferma il suo orologio) il rintocco programmato va annullato prima di
    // suonare adesso: restava in coda e risuonava più tardi, a caso,
    // magari in mezzo alla pausa.
    if (prog && !giaSuonato) prog.annulla();
    rintoccoRef.current = null;
    if (!giaSuonato) audio.playBlockComplete();
    const { materiaId, sfidaId, intent } = activeFocusRef.current;
    // V41 — i minuti del blocco che è finito davvero, non quelli
    // dell'impostazione di adesso (vedi totalSecondsRef in useTimerEngine).
    const minutes =
      Number.isFinite(durationSeconds) && durationSeconds > 0 ? Math.max(1, Math.round(durationSeconds / 60)) : focusTimeRef.current;
    setPendingFocus((prev) => ({
      totalMinutes: prev.totalMinutes + minutes,
      overdriveOccurred: prev.overdriveOccurred || wasOverdrive,
      // V42 — i minuti dei blocchi Overdrive, a parte: il bonus vale solo su quelli.
      overdriveMinutes: (prev.overdriveMinutes || 0) + (wasOverdrive ? minutes : 0),
      materiaId: prev.materiaId || materiaId,
      sfidaId: prev.sfidaId || sfidaId,
      intent: prev.totalMinutes > 0 ? prev.intent || null : intent || null
    }));
    // V36.0 — il momento esatto in cui il vecchio timer diventava muto:
    // blocco finito, schermo bloccato, nessuno te lo diceva.
    if (notifyRef.current) {
      notify('Blocco Focus completato', {
        body: `${minutes} minuti registrati. Avvia la pausa o concatena un Overdrive.`,
        tag: 'af-focus'
      });
      vibrate();
    }
  }, [audio]);

  const handleBreakComplete = useCallback(() => {
    const prog = rintoccoRef.current;
    const giaSuonato = !!prog && prog.tipo === 'BREAK' && prog.suonato();
    // V43 — se NON ha suonato (iOS: lo schermo bloccato sospende l'audio e
    // ferma il suo orologio) il rintocco programmato va annullato prima di
    // suonare adesso: restava in coda e risuonava più tardi, a caso,
    // magari in mezzo alla pausa.
    if (prog && !giaSuonato) prog.annulla();
    rintoccoRef.current = null;
    if (!giaSuonato) audio.playBreakOver();
    // V42 — una pausa fatta davvero ricarica Stamina.
    if (breakMinutesRef.current > 0) dispatch({ type: 'BREAK_COMPLETED', payload: { minutes: breakMinutesRef.current } });
    breakMinutesRef.current = 0;
    pushToast('Pausa finita: pronto per il prossimo blocco di Focus.', 'info');
    if (notifyRef.current) {
      notify('Pausa terminata', { body: 'Karen: pronto per il prossimo blocco di Focus.', tag: 'af-break' });
      vibrate([90]);
    }
  }, [pushToast, audio, dispatch]);

  const rawTimer = useTimerEngine({ onFocusComplete: handleFocusComplete, onBreakComplete: handleBreakComplete });
  const {
    start: timerStart,
    stop: timerStop,
    pause: timerPause,
    resume: timerResume,
    restore: timerRestore,
    snapshot: timerSnapshot
  } = rawTimer;

  /**
   * Recovery-on-boot, UNA sola volta per sessione (il guard assorbe anche
   * il doppio montaggio di React.StrictMode), e solo quando i dati del
   * profilo sono caricati (`ready`).
   *
   * V41 — prima si guarda il blocco che stava correndo
   * (planRunningBlockRestore in utils/focusRecovery.js):
   *  - ancora in corso o in pausa → riparte da dov'era, e i blocchi già
   *    finiti della stessa sessione tornano "in sospeso" (la sessione
   *    continua, non va chiusa d'ufficio);
   *  - finito mentre l'app era chiusa → i suoi minuti si aggiungono a
   *    quelli in sospeso e si salvano col Debriefing, con un "Non
   *    contarlo" nel toast per chi l'aveva abbandonato;
   *  - niente da riprendere → il recupero della V35: i blocchi finiti e
   *    mai salvati vengono accreditati con qualità neutra, nella stessa
   *    action FOCUS_COMPLETED di sempre (flag `recovered` solo per il
   *    Combat Log).
   */
  useEffect(() => {
    if (!ready || recoveryDoneRef.current) return undefined;
    const tabId = tabIdRef.current;

    const recupera = () => {
      recoveryDoneRef.current = true;
      const checkpoint = loadFocusCheckpoint(userId);
      const running = loadRunningBlock(userId);
      const plan = planRunningBlockRestore(running);
      const pendingSalvato = checkpoint
        ? {
            totalMinutes: checkpoint.totalMinutes,
            overdriveOccurred: !!checkpoint.overdriveOccurred,
            overdriveMinutes: Math.min(checkpoint.totalMinutes, Math.max(0, Number(checkpoint.overdriveMinutes) || 0)),
            materiaId: checkpoint.materiaId || null,
            sfidaId: checkpoint.sfidaId || null,
            intent: normIntent(checkpoint.intent)
          }
        : null;
      const riprendiArgomento = () => {
        const intent = normIntent(running.intent);
        setActiveFocusMateriaId(running.materiaId || null);
        setActiveFocusSfidaId(running.sfidaId || null);
        setActiveFocusIntent(intent);
        activeFocusRef.current = { materiaId: running.materiaId || null, sfidaId: running.sfidaId || null, intent };
      };

      if (plan.action === 'resume' || plan.action === 'paused') {
        if (pendingSalvato) setPendingFocus(pendingSalvato);
        if (running.mode === 'FOCUS') {
          riprendiArgomento();
          // Il rintocco dei 30 minuti non deve suonare subito per il
          // tempo già passato prima del ricaricamento.
          const trascorsi = Math.max(0, Number(running.totalSeconds) - Math.ceil(plan.remainingMs / 1000));
          reminderThresholdRef.current = Math.floor(((pendingSalvato?.totalMinutes || 0) * 60 + trascorsi) / REMINDER_INTERVAL_SECONDS);
        }
        timerRestore({
          mode: running.mode,
          endsAt: plan.action === 'resume' ? plan.endsAt : null,
          pausedRemainingMs: plan.action === 'paused' ? plan.remainingMs : null,
          totalSeconds: running.totalSeconds,
          overdrive: running.overdrive
        });
        if (plan.action === 'resume') programmaRintocco(running.mode, Math.ceil(plan.remainingMs / 1000));
        const breakMode = running.mode === 'BREAK';
        pushToast(
          plan.action === 'paused'
            ? breakMode
              ? 'Pausa ritrovata: è sospesa, come l’avevi lasciata.'
              : 'Blocco di Focus ritrovato: è in pausa, come l’avevi lasciato.'
            : breakMode
            ? 'Pausa ripresa: il tempo ha continuato a scorrere mentre l’app era chiusa.'
            : 'Blocco di Focus ripreso: il timer ha continuato a contare mentre l’app era chiusa.',
          'info'
        );
        return;
      }

      clearRunningBlock(userId);

      if (plan.action === 'complete') {
        const minutes = plan.minutes;
        const intentBlocco = normIntent(running.intent);
        const totale = (pendingSalvato?.totalMinutes || 0) + minutes;
        // Come dopo un blocco finito con l'app aperta: stesso argomento
        // per un eventuale Overdrive, e il rintocco dei 30 minuti tiene
        // conto del tempo già fatto.
        riprendiArgomento();
        reminderThresholdRef.current = Math.floor((totale * 60) / REMINDER_INTERVAL_SECONDS);
        setPendingFocus({
          totalMinutes: totale,
          overdriveOccurred: !!pendingSalvato?.overdriveOccurred || !!running.overdrive,
          overdriveMinutes: (pendingSalvato?.overdriveMinutes || 0) + (running.overdrive ? minutes : 0),
          materiaId: pendingSalvato?.materiaId || running.materiaId || null,
          sfidaId: pendingSalvato?.sfidaId || running.sfidaId || null,
          intent: pendingSalvato && pendingSalvato.totalMinutes > 0 ? pendingSalvato.intent : intentBlocco
        });
        pushToast(`Il blocco di Focus è finito mentre l’app era chiusa: ${minutes} min da salvare con il Debriefing.`, 'info', {
          duration: 12000,
          action: {
            label: 'Non contarlo',
            onClick: () => {
              // Se nel frattempo non è cambiato niente si torna ESATTAMENTE
              // a com'era prima (anche l'Overdrive del blocco scartato non
              // conta più); altrimenti si tolgono solo i suoi minuti.
              const invariato = pendingFocusRef.current.totalMinutes === totale;
              const restano = invariato ? pendingSalvato?.totalMinutes || 0 : Math.max(0, pendingFocusRef.current.totalMinutes - minutes);
              if (restano === 0) clearFocusCheckpoint(userId);
              setPendingFocus((prev) => {
                if (restano === 0) return EMPTY_PENDING;
                if (invariato && pendingSalvato) return pendingSalvato;
                return { ...prev, totalMinutes: Math.max(0, prev.totalMinutes - minutes) };
              });
              reminderThresholdRef.current = Math.floor((restano * 60) / REMINDER_INTERVAL_SECONDS);
            }
          }
        });
        return;
      }

      if (!checkpoint) return;
      dispatch({
        type: 'FOCUS_COMPLETED',
        payload: {
          wasOverdrive: !!checkpoint.overdriveOccurred,
          materiaId: checkpoint.materiaId || null,
          sfidaId: checkpoint.sfidaId || null,
          focusMinutes: checkpoint.totalMinutes,
          baseMinutes: Math.max(0, checkpoint.totalMinutes - (pendingSalvato?.overdriveMinutes || 0)),
          quality: DEFAULT_FOCUS_QUALITY,
          // Una sessione avviata con un modo esplicito (Sintesi, Ripasso,
          // Esercizi) resta tale anche se recuperata: l'hai dichiarato tu.
          workMode: normIntent(checkpoint.intent),
          recovered: true
        }
      });
      clearFocusCheckpoint(userId);
      pushToast(`Sessione di Focus interrotta da una chiusura imprevista: recuperati ${checkpoint.totalMinutes} min.`, 'info');
      audio.playSuccessChime();
    };

    // V41 — Un'altra finestra aperta ha la sessione in mano: niente
    // recupero finché la tiene (il blocco finirebbe due volte).
    // Con Web Locks il recupero parte quando il lucchetto si libera (vedi
    // l'effetto qui sotto); senza, si ricontrolla il possesso a tempo.
    recuperaRef.current = recupera;
    if (locksOk) {
      setRecoveryPhase((p) => (p === 'done' ? p : 'pending'));
      return undefined;
    }
    if (!isForeignLeaseAlive(readFocusLease(userId), tabId)) {
      recupera();
      return undefined;
    }
    setSessionElsewhere(true);
    const id = setInterval(() => {
      if (recoveryDoneRef.current) {
        clearInterval(id);
        setSessionElsewhere(false);
        return;
      }
      if (!isForeignLeaseAlive(readFocusLease(userId), tabId)) {
        clearInterval(id);
        setSessionElsewhere(false);
        recupera();
      }
    }, LEASE_BEAT_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, ready]);

  const sessioneAttiva = rawTimer.status !== TIMER_STATUS.IDLE || pendingFocus.totalMinutes > 0;

  // V41 — Il lucchetto della sessione (Web Locks). Richiesto in attesa del
  // recupero e poi tenuto finché in questa finestra c'è una sessione:
  // chi lo ottiene per primo recupera, gli altri aspettano in fila. Fra
  // il recupero e la sessione non viene mai lasciato, così nessun'altra
  // finestra in coda può infilarsi e riprendere lo stesso blocco.
  const wantLock = locksOk && (recoveryPhase === 'pending' || (recoveryPhase === 'done' && sessioneAttiva));
  useEffect(() => {
    if (!wantLock) return undefined;
    const ctrl = new AbortController();
    let release = null;
    let disposed = false;
    const onGranted = () => {
      // Concesso proprio mentre l'effetto veniva smontato: si restituisce
      // subito, invece di tenerlo per sempre.
      if (disposed) return undefined;
      return new Promise((resolve) => {
        release = resolve;
        if (!recoveryDoneRef.current && recuperaRef.current) recuperaRef.current();
        recoveryDoneRef.current = true;
        setRecoveryPhase('done');
        setSessionElsewhere(false);
      });
    };
    navigator.locks.request(lockName, { signal: ctrl.signal }, onGranted).catch(() => {
      /* richiesta annullata: niente da fare */
    });
    return () => {
      disposed = true;
      ctrl.abort();
      if (release) release();
    };
  }, [wantLock, lockName]);

  // In attesa da più di un istante = la sessione è davvero in un'altra
  // finestra (all'avvio normale il lucchetto arriva in pochi millisecondi).
  useEffect(() => {
    if (recoveryPhase !== 'pending') return undefined;
    const id = setTimeout(() => setSessionElsewhere(true), 1500);
    return () => clearTimeout(id);
  }, [recoveryPhase]);

  // V41 — Possesso a tempo (solo senza Web Locks): rinnovato ogni pochi
  // secondi finché in questa finestra c'è un blocco (anche in pausa) o
  // dei minuti da salvare, rilasciato quando la sessione finisce o la
  // finestra si chiude.
  useEffect(() => {
    if (!sessioneAttiva || locksOk) return undefined;
    const tabId = tabIdRef.current;
    const beat = () => writeFocusLease(userId, tabId);
    const release = () => releaseFocusLease(userId, tabId);
    beat();
    const id = setInterval(beat, LEASE_BEAT_MS);
    window.addEventListener('pagehide', release);
    window.addEventListener('pageshow', beat);
    return () => {
      clearInterval(id);
      window.removeEventListener('pagehide', release);
      window.removeEventListener('pageshow', beat);
      release();
    };
  }, [sessioneAttiva, userId, locksOk]);

  // V41 — Il blocco in corso si riscrive a ogni cambio di stato del
  // timer (avvio, pausa, ripresa, Overdrive) e si cancella quando torna
  // fermo. Mai prima del recupero qui sopra: al primo render il timer è
  // IDLE, e cancellare il record in quel momento vorrebbe dire perderlo.
  useEffect(() => {
    if (!recoveryDoneRef.current) return;
    if (rawTimer.status === TIMER_STATUS.IDLE) {
      clearRunningBlock(userId);
      return;
    }
    const snap = timerSnapshot();
    if (snap.mode !== 'FOCUS' && snap.mode !== 'BREAK') return;
    const focus = snap.mode === 'FOCUS';
    const { materiaId, sfidaId, intent } = activeFocusRef.current;
    saveRunningBlock(userId, {
      mode: snap.mode,
      endsAt: snap.endsAt,
      pausedRemainingMs: snap.pausedRemainingMs,
      totalSeconds: rawTimer.totalSeconds,
      overdrive: focus && snap.overdrive,
      materiaId: focus ? materiaId : null,
      sfidaId: focus ? sfidaId : null,
      intent: focus ? intent : null
    });
  }, [rawTimer.runId, rawTimer.status, rawTimer.totalSeconds, userId, timerSnapshot]);

  // V40.3 — lo stato del blocco in corso, leggibile dentro le callback
  // senza doverle ricreare ad ogni tick del countdown.
  const bloccoRef = useRef({ status: TIMER_STATUS.IDLE, remainingSeconds: 0, totalSeconds: 0, overdrive: false });
  useEffect(() => {
    bloccoRef.current = {
      status: rawTimer.status,
      remainingSeconds: rawTimer.remainingSeconds,
      totalSeconds: rawTimer.totalSeconds,
      overdrive: rawTimer.isOverdriveActive
    };
  }, [rawTimer.status, rawTimer.remainingSeconds, rawTimer.totalSeconds, rawTimer.isOverdriveActive]);

  /**
   * V40.3 — Ferma il blocco di Focus in corso e mette i suoi minuti interi
   * in "sessione in sospeso", senza penalità. Ritorna i minuti recuperati.
   *
   * Prima non esisteva: "TERMINA SESSIONE E SALVA" salvava i minuti già
   * accumulati ma lasciava il countdown in corsa (succede dopo un
   * Overdrive, quando il pannello resta visibile mentre un nuovo blocco
   * gira), e l'unico modo per fermarlo era il Blood Pact — cioè perdere
   * XP per chiudere una sessione appena salvata.
   */
  const freezeRunningBlock = useCallback(() => {
    const b = bloccoRef.current;
    if (b.status !== TIMER_STATUS.FOCUS && b.status !== TIMER_STATUS.PAUSED) return 0;
    // V41 — una PAUSA sospesa non è un Focus sospeso: i suoi minuti non
    // sono studio.
    if (timerSnapshot().mode !== 'FOCUS') return 0;
    const minuti = Math.max(0, Math.floor((b.totalSeconds - b.remainingSeconds) / 60));
    annullaRintocco();
    timerStop();
    if (minuti > 0) {
      const { materiaId, sfidaId, intent } = activeFocusRef.current;
      setPendingFocus((prev) => ({
        totalMinutes: prev.totalMinutes + minuti,
        overdriveOccurred: prev.overdriveOccurred || b.overdrive,
        overdriveMinutes: (prev.overdriveMinutes || 0) + (b.overdrive ? minuti : 0),
        materiaId: prev.materiaId || materiaId,
        sfidaId: prev.sfidaId || sfidaId,
        intent: prev.totalMinutes > 0 ? prev.intent || null : intent || null
      }));
    }
    return minuti;
  }, [timerStop, annullaRintocco, timerSnapshot]);

  // V36.0 — Wake Lock: lo schermo resta acceso per tutta la durata di un
  // blocco di Focus (mai durante una pausa: lì spegnere è il punto), e
  // viene rilasciato appena il blocco finisce o l'hook si smonta. Senza
  // questo, Sensory Zero si spegneva da solo dopo 30 secondi.
  useEffect(() => {
    if (rawTimer.status === TIMER_STATUS.FOCUS && wakeRef.current) {
      requestWakeLock();
    } else {
      releaseWakeLock();
    }
    return () => releaseWakeLock();
  }, [rawTimer.status]);

  useEffect(() => {
    if (rawTimer.status !== TIMER_STATUS.FOCUS) return;
    const elapsedInBlock = rawTimer.totalSeconds - rawTimer.remainingSeconds;
    const totalElapsedSeconds = pendingFocus.totalMinutes * 60 + elapsedInBlock;
    const reachedThresholds = Math.floor(totalElapsedSeconds / REMINDER_INTERVAL_SECONDS);
    if (reachedThresholds > reminderThresholdRef.current) {
      reminderThresholdRef.current = reachedThresholds;
      if (reminderEnabledRef.current) audio.playFocusReminder();
    }
  }, [rawTimer.status, rawTimer.remainingSeconds, rawTimer.totalSeconds, pendingFocus.totalMinutes, audio]);

  const startFocus = useCallback((materiaId = null, sfidaId = null, overdrive = false, intent = null, options = null) => {
    // V41 — una sessione avviata qui chiude l'eventuale attesa del
    // recupero (vedi "una sola finestra alla volta").
    recoveryDoneRef.current = true;
    const i = normIntent(intent);
    setActiveFocusMateriaId(materiaId);
    setActiveFocusSfidaId(sfidaId);
    setActiveFocusIntent(i);
    // Il ref si aggiorna subito: un blocco non deve mai partire con
    // l'intento della sessione precedente.
    activeFocusRef.current = { materiaId, sfidaId, intent: i };
    // V42 — durata su misura (es. "Solo 5 minuti" contro la procrastinazione).
    const custom = Number(options?.minutes);
    const minutes = Number.isFinite(custom) && custom >= 1 && custom <= 180 ? Math.round(custom) : focusTimeRef.current;
    timerStart('FOCUS', minutes, { overdrive });
    programmaRintocco('FOCUS', minutes * 60);
  }, [timerStart, programmaRintocco]);

  const startBreak = useCallback((long = false) => {
    recoveryDoneRef.current = true;
    const minutes = long ? longBreakRef.current : shortBreakRef.current;
    breakMinutesRef.current = minutes;
    timerStart('BREAK', minutes);
    programmaRintocco('BREAK', minutes * 60);
  }, [timerStart, programmaRintocco]);

  // V40.3 — mettere in pausa toglie di mezzo il rintocco programmato;
  // riprendendo lo si riprogramma sul tempo che resta davvero.
  const pause = useCallback(() => {
    annullaRintocco();
    timerPause();
  }, [timerPause, annullaRintocco]);

  const resume = useCallback(() => {
    const b = bloccoRef.current;
    // V41 — in pausa lo stato è PAUSED per entrambi i tipi di blocco: il
    // tipo vero lo sa il motore. Prima una pausa ripresa programmava il
    // rintocco di fine Focus.
    const tipo = timerSnapshot().mode === 'BREAK' ? 'BREAK' : 'FOCUS';
    timerResume();
    if (b.remainingSeconds > 0) programmaRintocco(tipo, b.remainingSeconds);
  }, [timerResume, programmaRintocco, timerSnapshot]);

  const interruptFocus = useCallback(() => {
    annullaRintocco();
    const finished = timerStop();
    if (finished === 'FOCUS') {
      // Blood Pact è un abbandono volontario dell'intera sessione: forfeit
      // anche di eventuali minuti già accumulati in blocchi Overdrive
      // precedenti non ancora salvati.
      setPendingFocus(EMPTY_PENDING);
      reminderThresholdRef.current = 0;
      clearFocusCheckpoint(userId);
      dispatch({ type: 'BLOOD_PACT_INTERRUPT' });
      pushToast(`Blood Pact: −${bloodPactPenaltyRef.current} XP per la sessione interrotta.`, 'danger');
    }
  }, [timerStop, dispatch, pushToast, userId, annullaRintocco]);

  const overdrive = useCallback(() => {
    timerStop();
    const { materiaId, sfidaId, intent } = activeFocusRef.current;
    startFocus(materiaId, sfidaId, true, intent);
  }, [timerStop, startFocus]);

  /**
   * Chiude volontariamente la sessione Focus corrente applicando l'esito
   * del Tactical Debriefing ("Sessione Completata. Valuta il tuo Focus").
   * Blindato contro il doppio invio: se non c'è nulla in sospeso
   * (`totalMinutes` a 0, es. sessione già chiusa da un click precedente),
   * non fa nulla e ritorna `false` — sicuro anche se richiamato due volte
   * di seguito per un click ripetuto sul modal di rating.
   */
  // V38.0 — `forgia` porta il modo della sessione (Sintesi/Studio) e,
  // per la sola sintesi, le pagine di fonte coperte e le pagine di
  // appunti prodotte. Parametro OPZIONALE con default neutro: ogni
  // chiamante che non lo passa (recupero automatico di una sessione
  // orfana, test) si comporta esattamente come in V37.
  const endFocusSession = useCallback((quality = DEFAULT_FOCUS_QUALITY, forgia = null) => {
    // Difesa: chiudere la sessione ferma sempre il countdown, da qualunque
    // punto arrivi la chiamata (i minuti interi del blocco in corso sono
    // già stati messi in sospeso da freezeRunningBlock).
    const inCorso = bloccoRef.current.status;
    if ((inCorso === TIMER_STATUS.FOCUS || inCorso === TIMER_STATUS.PAUSED) && timerSnapshot().mode === 'FOCUS') {
      annullaRintocco();
      timerStop();
    }
    if (pendingFocus.totalMinutes > 0) {
      dispatch({
        type: 'FOCUS_COMPLETED',
        payload: {
          wasOverdrive: pendingFocus.overdriveOccurred,
          materiaId: pendingFocus.materiaId,
          // V40.2 — nel Debriefing puoi indicare su quale argomento hai
          // lavorato davvero (sempre della stessa materia).
          sfidaId: forgia && forgia.sfidaId !== undefined ? forgia.sfidaId || null : pendingFocus.sfidaId,
          focusMinutes: pendingFocus.totalMinutes,
          baseMinutes: Math.max(0, pendingFocus.totalMinutes - (pendingFocus.overdriveMinutes || 0)),
          quality,
          workMode: forgia?.workMode || null,
          pagineFonte: forgia?.pagineFonte || 0,
          pagineFontePer: forgia?.pagineFontePer || null,
          pagineAppuntiProdotte: forgia?.pagineAppuntiProdotte || 0,
          // V42 — esercizi svolti (modo Esercizi) e giudizio del ripasso (modo Ripasso).
          eserciziFatti: forgia?.eserciziFatti || 0,
          eserciziCorretti: forgia?.eserciziCorretti || 0,
          reviewRating: forgia?.reviewRating || null,
          // V43 — la tecnica usata e quella consigliata (memoria delle tecniche).
          tecnica: forgia?.tecnica || null,
          tecnicaConsigliata: forgia?.tecnicaConsigliata || null
        }
      });
      audio.playSuccessChime();
      if (quality === FOCUS_QUALITY.DISTRACTED) {
        pushToast('Sessione faticosa registrata: Karen ne tiene conto per timer e carico dei prossimi giorni.', 'info');
      }
      setPendingFocus(EMPTY_PENDING);
      reminderThresholdRef.current = 0;
      clearFocusCheckpoint(userId);
      return true;
    }
    setPendingFocus(EMPTY_PENDING);
    reminderThresholdRef.current = 0;
    clearFocusCheckpoint(userId);
    return false;
  }, [pendingFocus, dispatch, audio, pushToast, userId, timerStop, annullaRintocco, timerSnapshot]);

  // Smontaggio del Provider (logout, chiusura): nessun rintocco fantasma
  // programmato sul clock audio.
  useEffect(() => () => annullaRintocco(), [annullaRintocco]);

  // V37.0 — PRESTAZIONI: anche questo era un letterale nuovo ad ogni
  // render, ed entra nel `value` del Context. Memoizzarlo non elimina il
  // re-render al secondo (il countdown cambia davvero ogni secondo), ma
  // evita che cambi identità anche quando NON è cambiato nulla — per
  // esempio ad ogni modifica di stato mentre il timer è fermo.
  return useMemo(() => ({
    status: rawTimer.status,
    remainingSeconds: rawTimer.remainingSeconds,
    totalSeconds: rawTimer.totalSeconds,
    isOverdriveActive: rawTimer.isOverdriveActive,
    // V41 — 'FOCUS' | 'BREAK' | null: distingue un Focus in pausa da una
    // pausa sospesa (lo stato è PAUSED in entrambi i casi).
    blockMode: rawTimer.mode,
    // V41 — la sessione è aperta in un'altra finestra di ArachnoForge.
    sessionElsewhere,
    startFocus,
    startBreak,
    pause,
    resume,
    interruptFocus,
    overdrive,
    endFocusSession,
    freezeRunningBlock,
    pendingFocusMinutes: pendingFocus.totalMinutes,
    pendingFocusOverdrive: pendingFocus.overdriveOccurred,
    // V38.0 — gli id della sessione IN SOSPESO, distinti da quelli della
    // sessione attiva qui sotto. Coincidono quasi sempre, ma non dopo
    // "Avvia Comunque": lì si apre un Focus su un altro argomento
    // mentre il Debriefing precedente è ancora da compilare, e i due
    // divergono. Il reducer scrive sempre su `pendingFocus.sfidaId`,
    // quindi è questo che il Debriefing deve mostrare — altrimenti si
    // chiedono le pagine di un argomento e si accreditano a un altro.
    pendingFocusMateriaId: pendingFocus.materiaId,
    pendingFocusSfidaId: pendingFocus.sfidaId,
    pendingFocusIntent: pendingFocus.intent || null,
    activeFocusMateriaId,
    activeFocusSfidaId,
    // V42 — il lavoro dichiarato alla partenza (Sintesi, Studio, Ripasso, Esercizi).
    activeFocusIntent,
    // V35.0 — sostituisce la logica fragile locale (`awaitingPostFocus`,
    // ex MissionControl.jsx) basata su un edge-trigger che si perdeva ad
    // ogni smontaggio/rimontaggio della pagina: `awaitingDebrief` è
    // derivato direttamente da `pendingFocus`, quindi resta corretto
    // indipendentemente da quale pagina era montata quando il blocco è
    // scaduto.
    awaitingDebrief: pendingFocus.totalMinutes > 0
  }), [
    rawTimer.status,
    rawTimer.remainingSeconds,
    rawTimer.totalSeconds,
    rawTimer.isOverdriveActive,
    rawTimer.mode,
    sessionElsewhere,
    startFocus,
    startBreak,
    pause,
    resume,
    interruptFocus,
    overdrive,
    endFocusSession,
    freezeRunningBlock,
    pendingFocus.totalMinutes,
    pendingFocus.overdriveOccurred,
    pendingFocus.materiaId,
    pendingFocus.sfidaId,
    pendingFocus.intent,
    activeFocusMateriaId,
    activeFocusSfidaId,
    activeFocusIntent
  ]);
}

export { TIMER_STATUS };
export default useFocusTimer;
