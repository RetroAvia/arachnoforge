import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useTimerEngine, TIMER_STATUS } from './useTimerEngine.js';
import { BLOOD_PACT_PENALTY, FOCUS_QUALITY, DEFAULT_FOCUS_QUALITY } from '../utils/xpEngine.js';
import { saveFocusCheckpoint, loadFocusCheckpoint, clearFocusCheckpoint } from '../utils/focusRecovery.js';
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
  focusReminderEnabled = true
}) {
  const [activeFocusMateriaId, setActiveFocusMateriaId] = useState(null);
  const [activeFocusSfidaId, setActiveFocusSfidaId] = useState(null);
  // V40.2 — l'intento con cui è partita la sessione: 'SINTESI' quando la
  // avvii da una lezione da sistemare (Campus o card "ADESSO"). Il
  // Debriefing parte già in modo Sintesi e chiede le pagine fonte per fonte.
  const [activeFocusIntent, setActiveFocusIntent] = useState(null);
  const [pendingFocus, setPendingFocus] = useState({
    totalMinutes: 0,
    overdriveOccurred: false,
    materiaId: null,
    sfidaId: null,
    intent: null
  });

  const activeFocusRef = useRef({ materiaId: null, sfidaId: null, intent: null });
  useEffect(() => {
    activeFocusRef.current = { materiaId: activeFocusMateriaId, sfidaId: activeFocusSfidaId, intent: activeFocusIntent };
  }, [activeFocusMateriaId, activeFocusSfidaId, activeFocusIntent]);

  // V35.0 — Recovery-on-boot: gira UNA sola volta al mount dell'hook (il
  // guard `recoveryDoneRef` assorbe anche il doppio-invoke di
  // React.StrictMode in sviluppo). Se un checkpoint orfano esiste per
  // l'utente corrente, lo si dispatcha come una FOCUS_COMPLETED con
  // qualità neutra (nessun Tactical Debriefing possibile a posteriori —
  // la sessione originale non c'è più per essere valutata) e un flag
  // `recovered` che il reducer usa SOLO per aggiungere una riga di
  // Combat Log distinta, mai per alterare XP/Stamina/StarLog (identica
  // pipeline di un FOCUS_COMPLETED normale).
  const recoveryDoneRef = useRef(false);
  useEffect(() => {
    if (recoveryDoneRef.current) return;
    recoveryDoneRef.current = true;
    const checkpoint = loadFocusCheckpoint(userId);
    if (!checkpoint) return;
    dispatch({
      type: 'FOCUS_COMPLETED',
      payload: {
        wasOverdrive: !!checkpoint.overdriveOccurred,
        materiaId: checkpoint.materiaId || null,
        sfidaId: checkpoint.sfidaId || null,
        focusMinutes: checkpoint.totalMinutes,
        quality: DEFAULT_FOCUS_QUALITY,
        // Una sessione avviata esplicitamente come Sintesi resta tale
        // anche se recuperata: l'intento l'hai dichiarato tu all'avvio.
        workMode: checkpoint.intent === 'SINTESI' ? 'SINTESI' : null,
        recovered: true
      }
    });
    clearFocusCheckpoint(userId);
    pushToast(`K.A.R.E.N. — Sessione Focus recuperata dopo chiusura imprevista: +${checkpoint.totalMinutes} min registrati.`, 'info');
    audio.playSuccessChime();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

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

  const handleFocusComplete = useCallback(({ wasOverdrive }) => {
    // V40.3 — IL suono che mancava: la fine di un blocco era muta se non
    // avevi attivato le notifiche di sistema. Se era già stato programmato
    // sul clock audio ha appena suonato da solo, e non si ripete.
    const prog = rintoccoRef.current;
    const giaSuonato = !!prog && prog.tipo === 'FOCUS' && prog.suonato();
    rintoccoRef.current = null;
    if (!giaSuonato) audio.playBlockComplete();
    const { materiaId, sfidaId, intent } = activeFocusRef.current;
    const minutes = focusTimeRef.current;
    setPendingFocus((prev) => ({
      totalMinutes: prev.totalMinutes + minutes,
      overdriveOccurred: prev.overdriveOccurred || wasOverdrive,
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
    rintoccoRef.current = null;
    if (!giaSuonato) audio.playBreakOver();
    pushToast('Pausa terminata — pronto per il prossimo blocco di Focus.', 'info');
    if (notifyRef.current) {
      notify('Pausa terminata', { body: 'Karen: pronto per il prossimo blocco di Focus.', tag: 'af-break' });
      vibrate([90]);
    }
  }, [pushToast, audio]);

  const rawTimer = useTimerEngine({ onFocusComplete: handleFocusComplete, onBreakComplete: handleBreakComplete });
  const { start: timerStart, stop: timerStop, pause: timerPause, resume: timerResume } = rawTimer;

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
    const minuti = Math.max(0, Math.floor((b.totalSeconds - b.remainingSeconds) / 60));
    annullaRintocco();
    timerStop();
    if (minuti > 0) {
      const { materiaId, sfidaId, intent } = activeFocusRef.current;
      setPendingFocus((prev) => ({
        totalMinutes: prev.totalMinutes + minuti,
        overdriveOccurred: prev.overdriveOccurred || b.overdrive,
        materiaId: prev.materiaId || materiaId,
        sfidaId: prev.sfidaId || sfidaId,
        intent: prev.totalMinutes > 0 ? prev.intent || null : intent || null
      }));
    }
    return minuti;
  }, [timerStop, annullaRintocco]);

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

  const startFocus = useCallback((materiaId = null, sfidaId = null, overdrive = false, intent = null) => {
    setActiveFocusMateriaId(materiaId);
    setActiveFocusSfidaId(sfidaId);
    setActiveFocusIntent(intent === 'SINTESI' ? 'SINTESI' : null);
    // Il ref si aggiorna subito: un blocco non deve mai partire con
    // l'intento della sessione precedente.
    activeFocusRef.current = { materiaId, sfidaId, intent: intent === 'SINTESI' ? 'SINTESI' : null };
    timerStart('FOCUS', focusTimeRef.current, { overdrive });
    programmaRintocco('FOCUS', focusTimeRef.current * 60);
  }, [timerStart, programmaRintocco]);

  const startBreak = useCallback((long = false) => {
    const minutes = long ? longBreakRef.current : shortBreakRef.current;
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
    timerResume();
    if (b.remainingSeconds > 0) programmaRintocco(b.status === TIMER_STATUS.BREAK ? 'BREAK' : 'FOCUS', b.remainingSeconds);
  }, [timerResume, programmaRintocco]);

  const interruptFocus = useCallback(() => {
    annullaRintocco();
    const finished = timerStop();
    if (finished === 'FOCUS') {
      // Blood Pact è un abbandono volontario dell'intera sessione: forfeit
      // anche di eventuali minuti già accumulati in blocchi Overdrive
      // precedenti non ancora salvati.
      setPendingFocus({ totalMinutes: 0, overdriveOccurred: false, materiaId: null, sfidaId: null, intent: null });
      reminderThresholdRef.current = 0;
      clearFocusCheckpoint(userId);
      dispatch({ type: 'BLOOD_PACT_INTERRUPT' });
      pushToast(`BLOOD PACT — -${BLOOD_PACT_PENALTY} XP`, 'danger');
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
    if (inCorso === TIMER_STATUS.FOCUS || inCorso === TIMER_STATUS.PAUSED) {
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
          quality,
          workMode: forgia?.workMode || null,
          pagineFonte: forgia?.pagineFonte || 0,
          pagineFontePer: forgia?.pagineFontePer || null,
          pagineAppuntiProdotte: forgia?.pagineAppuntiProdotte || 0
        }
      });
      audio.playSuccessChime();
      if (quality === FOCUS_QUALITY.DISTRACTED) {
        pushToast('Sessione faticosa registrata — attiva un Daily Protocol per recuperare Stamina.', 'info');
      }
      setPendingFocus({ totalMinutes: 0, overdriveOccurred: false, materiaId: null, sfidaId: null, intent: null });
      reminderThresholdRef.current = 0;
      clearFocusCheckpoint(userId);
      return true;
    }
    setPendingFocus({ totalMinutes: 0, overdriveOccurred: false, materiaId: null, sfidaId: null, intent: null });
    reminderThresholdRef.current = 0;
    clearFocusCheckpoint(userId);
    return false;
  }, [pendingFocus, dispatch, audio, pushToast, userId, timerStop, annullaRintocco]);

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
    activeFocusSfidaId
  ]);
}

export { TIMER_STATUS };
export default useFocusTimer;
